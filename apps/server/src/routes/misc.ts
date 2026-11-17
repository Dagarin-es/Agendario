import { zValidator } from "@hono/zod-validator";
import { and, count, eq, inArray, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  dateTypeLabels,
  exportSelectionSchema,
  groupInputSchema,
  groupMemberSchema,
  type Group,
  type UpcomingEvent,
} from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { visibleContacts } from "../lib/access.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import { eventsBetween, pendingGifts } from "../lib/events.js";
import { expandTagIds } from "../lib/tags.js";
import { buildVcf, vcfHeaders } from "../lib/export.js";

const g = schema.groups;
const gm = schema.groupMembers;
const idParam = zValidator("param", z.object({ id: z.string().uuid() }));

// ---------- Grupos ----------

async function myGroups(userId: string): Promise<Group[]> {
  const visible = await db
    .selectDistinct({ id: g.id, name: g.name, ownerId: g.ownerId })
    .from(g)
    .leftJoin(gm, eq(gm.groupId, g.id))
    .where(or(eq(g.ownerId, userId), eq(gm.userId, userId)))
    .orderBy(g.name);
  if (!visible.length) return [];
  const members = await db
    .select({ groupId: gm.groupId, id: schema.users.id, name: schema.users.name })
    .from(gm)
    .innerJoin(schema.users, eq(schema.users.id, gm.userId))
    .where(inArray(gm.groupId, visible.map((v) => v.id)));
  return visible.map((v) => ({
    ...v,
    members: members.filter((m) => m.groupId === v.id).map(({ id, name }) => ({ id, name })),
  }));
}

async function requireGroupOwner(groupId: string, userId: string) {
  const [row] = await db.select().from(g).where(and(eq(g.id, groupId), eq(g.ownerId, userId)));
  if (!row) throw new HTTPException(404, { message: "Grupo no encontrado" });
}

export const groupRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", async (c) => c.json(await myGroups(c.get("user").id)))
  .post("/", zValidator("json", groupInputSchema), async (c) => {
    const user = c.get("user");
    const [row] = await db.insert(g).values({ name: c.req.valid("json").name, ownerId: user.id }).returning();
    await db.insert(gm).values({ groupId: row.id, userId: user.id });
    return c.json(row, 201);
  })
  .delete("/:id", idParam, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    await requireGroupOwner(id, user.id);
    await db.delete(g).where(eq(g.id, id));
    return c.body(null, 204);
  })
  .post("/:id/members", idParam, zValidator("json", groupMemberSchema), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    await requireGroupOwner(id, user.id);
    await db.insert(gm).values({ groupId: id, userId: c.req.valid("json").userId }).onConflictDoNothing();
    return c.json(await myGroups(user.id));
  })
  .delete("/:id/members/:userId", zValidator("param", z.object({ id: z.string().uuid(), userId: z.string().uuid() })), async (c) => {
    const user = c.get("user");
    const { id, userId } = c.req.valid("param");
    await requireGroupOwner(id, user.id);
    await db.delete(gm).where(and(eq(gm.groupId, id), eq(gm.userId, userId)));
    return c.body(null, 204);
  });

// ---------- Próximas fechas (cumpleaños + fechas importantes) ----------

export const upcomingRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  // Próximos N días (lista)
  .get("/", zValidator("query", z.object({ days: z.coerce.number().int().min(1).max(366).default(30) })), async (c) => {
    const { days } = c.req.valid("query");
    const now = new Date();
    const from = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const to = new Date(from.getTime() + days * 86_400_000);
    return c.json(await eventsBetween(c.get("user").id, from, to));
  })
  // Un intervalo cualquiera (calendario mensual)
  .get("/range", zValidator("query", z.object({ from: z.string().date(), to: z.string().date() })), async (c) => {
    const { from, to } = c.req.valid("query");
    const f = new Date(`${from}T00:00:00Z`);
    const t = new Date(`${to}T00:00:00Z`);
    if (t < f || t.getTime() - f.getTime() > 400 * 86_400_000) throw new HTTPException(400, { message: "Intervalo no válido" });
    return c.json(await eventsBetween(c.get("user").id, f, t));
  })
  // Comprados sin regalar cuya fecha ya pasó
  .get("/pending-gifts", async (c) => c.json(await pendingGifts(c.get("user").id)));

// ---------- Exportación vCard ----------

export const exportRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  /** Todos los contactos visibles. ?gifts=true añade tus ideas de regalo (X-CONTACTOS-GIFT). */
  .get(
    "/contacts.vcf",
    zValidator("query", z.object({ gifts: z.enum(["true", "false"]).default("false"), tag: z.string().uuid().optional() })),
    async (c) => {
      const user = c.get("user");
      const { gifts, tag } = c.req.valid("query");
      if (!tag) {
        const { vcf } = await buildVcf(user.id, null, gifts === "true");
        return c.body(vcf, 200, vcfHeaders("contactos"));
      }
      // ?tag=… → los contactos con esa etiqueta, cada uno con los datos de esa etiqueta
      const [t] = await db.select().from(schema.tags).where(and(eq(schema.tags.id, tag), eq(schema.tags.userId, user.id)));
      if (!t) throw new HTTPException(404, { message: "Etiqueta no encontrada" });
      const all = await expandTagIds(user.id, [tag]); // con sus subetiquetas
      const ids = [...new Set((await db.select({ id: schema.contactTags.contactId }).from(schema.contactTags).where(inArray(schema.contactTags.tagId, all))).map((r) => r.id))];
      const { vcf } = ids.length ? await buildVcf(user.id, ids, gifts === "true", tag) : { vcf: "" };
      const slug = t.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
      return c.body(vcf, 200, vcfHeaders(`contactos-${slug || "etiqueta"}`));
    },
  )
  /** Solo los contactos seleccionados en la lista. */
  .post("/selection.vcf", zValidator("json", exportSelectionSchema), async (c) => {
    const { ids, gifts, tagId } = c.req.valid("json");
    const { vcf } = await buildVcf(c.get("user").id, ids, gifts, tagId);
    return c.body(vcf, 200, vcfHeaders("contactos-seleccion"));
  });
