import { zValidator } from "@hono/zod-validator";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  autoMergeSchema,
  dismissSchema,
  duplicateReasons,
  mergeRequestSchema,
  type DuplicateGroup,
  geoStatusOf,
} from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import { completeness, findDuplicateEdges, groupEdges, pickPair } from "../lib/duplicates.js";
import { autoMerge, autoMergePreview, mergeContacts } from "../lib/merge.js";
import { tagsForContacts } from "../lib/tags.js";

const c = schema.contacts;
const dd = schema.duplicateDismissals;
const pair = (x: string, y: string) => (x < y ? [x, y] : [y, x]) as [string, string];

const addressText = (a: { street: string; city: string; postalCode: string; region: string; country: string }) =>
  [a.street, [a.postalCode, a.city].filter(Boolean).join(" "), a.region, a.country].filter(Boolean).join(", ");

/** Calcula los grupos de posibles duplicados entre los contactos PROPIOS del usuario. */
async function computeGroups(userId: string, userName: string): Promise<DuplicateGroup[]> {
  const rows = await db.select().from(c).where(and(eq(c.ownerId, userId), isNull(c.deletedAt)));
  const dismissed = new Set((await db.select().from(dd).where(eq(dd.userId, userId))).map((d) => `${d.aId}|${d.bId}`));
  const groups = groupEdges(findDuplicateEdges(rows, dismissed));
  if (!groups.length) return [];

  const ids = groups.flatMap((g) => g.ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tags = await tagsForContacts(ids, userId);

  // Datos personales que se perderían si se borra uno sin combinar
  const extras = new Map<string, number>();
  const addExtras = (list: { id: string; n: number }[]) => list.forEach((x) => extras.set(x.id, (extras.get(x.id) ?? 0) + x.n));
  addExtras(
    await db.select({ id: schema.giftIdeas.contactId, n: count() }).from(schema.giftIdeas)
      .where(and(eq(schema.giftIdeas.userId, userId), inArray(schema.giftIdeas.contactId, ids))).groupBy(schema.giftIdeas.contactId),
  );
  addExtras(
    await db.select({ id: schema.giftsReceived.contactId, n: count() }).from(schema.giftsReceived)
      .where(and(eq(schema.giftsReceived.userId, userId), inArray(schema.giftsReceived.contactId, ids))).groupBy(schema.giftsReceived.contactId),
  );
  addExtras(
    await db.select({ id: schema.importantDates.contactId, n: count() }).from(schema.importantDates)
      .where(inArray(schema.importantDates.contactId, ids)).groupBy(schema.importantDates.contactId),
  );

  return groups
    .map((g) => {
      const contacts = g.ids
        .map((id) => byId.get(id)!)
        .map((r) => ({
          id: r.id,
          displayName: r.displayName,
          givenName: r.givenName,
          familyName: r.familyName,
          nickname: r.nickname,
          organization: r.organization,
          jobTitle: r.jobTitle,
          birthday: r.birthday,
          hasPhoto: !!r.photoKey,
          visibility: r.visibility,
          ownerId: r.ownerId,
          ownerName: userName,
          isMine: true,
          canEdit: true,
          updatedAt: r.updatedAt.toISOString(),
          tags: tags.get(r.id) ?? [],
          geo: geoStatusOf(r.addresses),
          score: completeness(r),
          subtitle: [r.phones[0]?.value, r.emails[0]?.value, r.organization].filter(Boolean).join(" · "),
          phones: r.phones.map((p) => p.value),
          emails: r.emails.map((e) => e.value),
          addresses: r.addresses.map(addressText).filter(Boolean),
          extras: extras.get(r.id) ?? 0,
        }))
        .sort((a, b) => b.score - a.score || a.updatedAt.localeCompare(b.updatedAt));
      // Las dos primeras = la pareja a revisar (siempre una coincidencia directa no descartada)
      const scoreOf = new Map(contacts.map((x) => [x.id, x.score]));
      const [p1, p2] = pickPair(g.edges, (id) => scoreOf.get(id) ?? 0);
      const first = [contacts.find((x) => x.id === p1)!, contacts.find((x) => x.id === p2)!];
      contacts.splice(0, contacts.length, ...first, ...contacts.filter((x) => x.id !== p1 && x.id !== p2));
      const pairEdge = g.edges.find((e) => (e.a === p1 && e.b === p2) || (e.a === p2 && e.b === p1))!;
      return {
        key: contacts.map((x) => x.id).sort().join(","),
        contacts,
        reasons: duplicateReasons.filter((r) => g.reasons.has(r)),
        pairReasons: duplicateReasons.filter((r) => pairEdge.reasons.has(r)),
      };
    })
    .sort((a, b) => a.contacts[0]!.displayName.localeCompare(b.contacts[0]!.displayName, "es"));
}

export const duplicateRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get("/", async (ctx) => {
    const user = ctx.get("user");
    return ctx.json(await computeGroups(user.id, user.name));
  })

  /** «No son duplicados»: esa pareja no vuelve a proponerse. */
  .post("/dismiss", zValidator("json", dismissSchema), async (ctx) => {
    const user = ctx.get("user");
    const [aId, bId] = pair(ctx.req.valid("json").aId, ctx.req.valid("json").bId);
    const owned = await db.select({ id: c.id }).from(c).where(and(eq(c.ownerId, user.id), inArray(c.id, [aId, bId])));
    if (owned.length !== 2) throw new HTTPException(404, { message: "Contacto no encontrado" });
    await db.insert(dd).values({ userId: user.id, aId, bId }).onConflictDoNothing();
    return ctx.body(null, 204);
  })

  .delete("/dismissals", async (ctx) => {
    const user = ctx.get("user");
    const res = await db.delete(dd).where(eq(dd.userId, user.id)).returning();
    return ctx.json({ restored: res.length });
  })

  /** Combinación manual: los valores los elige el usuario en el panel. */
  .post("/merge", zValidator("json", mergeRequestSchema), async (ctx) => {
    const req = ctx.req.valid("json");
    await mergeContacts(ctx.get("user").id, req);
    return ctx.json({ ok: true, keepId: req.keepId });
  })

  /** Vista previa de la combinación automática (no cambia nada). */
  .post("/preview", zValidator("json", autoMergeSchema), async (ctx) => {
    const { keepId, removeId } = ctx.req.valid("json");
    return ctx.json(await autoMergePreview(ctx.get("user").id, keepId, removeId));
  })

  /** Combinación automática de una pareja. */
  .post("/auto-merge", zValidator("json", autoMergeSchema), async (ctx) => {
    const { keepId, removeId } = ctx.req.valid("json");
    await autoMerge(ctx.get("user").id, keepId, removeId);
    return ctx.json({ ok: true, keepId });
  })

  /**
   * «Combinar todos»: combina automáticamente pareja a pareja, por rondas, hasta que no queden
   * duplicados. Respeta las parejas marcadas como «no son duplicados».
   */
  .post("/auto-merge-all", async (ctx) => {
    const user = ctx.get("user");
    let merged = 0;
    let groupsAtStart = 0;
    for (let round = 0; round < 200; round++) {
      const groups = await computeGroups(user.id, user.name);
      if (round === 0) groupsAtStart = groups.length;
      if (!groups.length) break;
      for (const g of groups) {
        const [a, b] = g.contacts;
        const [keep, remove] = a!.score >= b!.score ? [a!, b!] : [b!, a!];
        await autoMerge(user.id, keep.id, remove.id);
        merged++;
      }
    }
    return ctx.json({ merged, groups: groupsAtStart });
  });
