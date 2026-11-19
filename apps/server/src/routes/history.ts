import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  HISTORY_DAYS,
  historyFields,
  historyRestoreSchema,
  nonRestorableFields,
  type HistoryEntry,
  type HistoryField,
  type TrashItem,
} from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { canReadSql, requireEdit } from "../lib/access.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import { rawContact, recordHistory } from "../lib/history.js";
import { syncOrgName } from "../lib/merge.js";
import { deletePhoto } from "../lib/photos.js";

const c = schema.contacts;
const h = schema.contactHistory;
const idParam = zValidator("param", z.object({ id: z.string().uuid() }));

/** Valores a aplicar desde una versión guardada (sin la foto, que no se guarda). */
async function valuesFrom(snapshot: Record<string, unknown>, fields: HistoryField[], contactId: string, userId: string, isMine: boolean) {
  const v: Record<string, unknown> = {};
  for (const f of fields) {
    if (nonRestorableFields.includes(f) || !(f in snapshot)) continue;
    if (f === "visibility" && !isMine) continue;
    v[f] = snapshot[f];
  }
  // La empresa enlazada solo si sigue existiendo y la puedes ver
  if (v.organizationContactId) {
    const org = v.organizationContactId as string;
    const [ok] = await db.select({ id: c.id }).from(c).where(and(eq(c.id, org), isNull(c.deletedAt), canReadSql(userId)));
    if (!ok || org === contactId) v.organizationContactId = null;
  }
  return v;
}

export const historyRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  // Cronología de un contacto
  .get("/contacts/:id/history", idParam, async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    const [row] = await db.select({ id: c.id }).from(c).where(and(eq(c.id, id), canReadSql(user.id)));
    if (!row) throw new HTTPException(404, { message: "Contacto no encontrado" });
    const rows = await db
      .select({ e: h, userName: schema.users.name })
      .from(h)
      .leftJoin(schema.users, eq(schema.users.id, h.userId))
      .where(eq(h.contactId, id))
      .orderBy(desc(h.createdAt))
      .limit(500);
    const out: HistoryEntry[] = rows.map(({ e, userName }) => ({
      id: e.id,
      action: e.action as HistoryEntry["action"],
      userName,
      createdAt: e.createdAt.toISOString(),
      changes: e.changes as HistoryEntry["changes"],
      snapshot: e.snapshot,
      meta: e.meta,
    }));
    return ctx.json(out);
  })

  // Restaurar una versión entera o un campo
  .post(
    "/contacts/:id/history/:entryId/restore",
    zValidator("param", z.object({ id: z.string().uuid(), entryId: z.string().uuid() })),
    zValidator("json", historyRestoreSchema),
    async (ctx) => {
      const user = ctx.get("user");
      const { id, entryId } = ctx.req.valid("param");
      const { field, side } = ctx.req.valid("json");
      const access = await requireEdit(id, user.id);
      const [entry] = await db.select().from(h).where(and(eq(h.id, entryId), eq(h.contactId, id)));
      if (!entry) throw new HTTPException(404, { message: "Esa versión ya no existe" });
      // En un borrado, la versión «de ese momento» es como estaba antes de borrarlo (la guardada)
      const source =
        side === "before"
          ? Object.fromEntries(entry.changes.map((ch) => [ch.field, ch.before ?? (Array.isArray(ch.after) ? [] : ch.field === "birthday" || ch.field === "organizationContactId" ? null : "")]))
          : entry.snapshot;
      const fields = field ? [field] : side === "before" ? (entry.changes.map((ch) => ch.field) as HistoryField[]) : [...historyFields];
      const values = await valuesFrom(source, fields, id, user.id, access.isMine);
      if (!Object.keys(values).length) throw new HTTPException(400, { message: "Ese dato no se puede restaurar" });
      const before = await rawContact(id);
      const [after] = await db
        .update(c)
        .set({ ...values, updatedAt: new Date(), revision: sql`${c.revision} + 1` })
        .where(eq(c.id, id))
        .returning();
      await recordHistory(db, {
        contactId: id, userId: user.id, action: "restore", before, after,
        meta: { force: true, from: entry.createdAt.toISOString(), field: field ?? null, side },
      });
      if ("displayName" in values) await syncOrgName(id);
      return ctx.json({ ok: true });
    },
  )

  // ---------- Papelera ----------
  .get("/trash", async (ctx) => {
    const user = ctx.get("user");
    const rows = await db
      .select()
      .from(c)
      .where(and(eq(c.ownerId, user.id), isNotNull(c.deletedAt)))
      .orderBy(desc(c.deletedAt))
      .limit(5000);
    // ¿Se borró al combinarlo? (lo dice su última entrada de borrado)
    const ids = rows.map((r) => r.id);
    const dels = ids.length
      ? await db
          .select({ contactId: h.contactId, meta: h.meta, at: h.createdAt })
          .from(h)
          .where(and(inArray(h.contactId, ids), eq(h.action, "delete")))
          .orderBy(desc(h.createdAt))
      : [];
    const metaOf = new Map<string, Record<string, unknown>>();
    for (const d of dels) if (!metaOf.has(d.contactId)) metaOf.set(d.contactId, d.meta);
    const out: TrashItem[] = rows.map((r) => {
      const m = metaOf.get(r.id)?.mergedInto as TrashItem["mergedInto"] | undefined;
      return {
        id: r.id,
        displayName: r.displayName,
        organization: r.organization,
        hasPhoto: !!r.photoKey,
        deletedAt: r.deletedAt!.toISOString(),
        mergedInto: m ?? null,
        purgeAt: new Date(r.deletedAt!.getTime() + HISTORY_DAYS * 86400_000).toISOString(),
      };
    });
    return ctx.json(out);
  })

  .post("/trash/:id/restore", idParam, async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    const before = await rawContact(id);
    if (!before || before.ownerId !== user.id || !before.deletedAt) throw new HTTPException(404, { message: "No está en la papelera" });
    const [after] = await db
      .update(c)
      .set({ deletedAt: null, updatedAt: new Date(), revision: sql`${c.revision} + 1` })
      .where(eq(c.id, id))
      .returning();
    // Vuelven a enlazarse como empresa los contactos que lo estaban al borrarlo
    const [del] = await db
      .select({ meta: h.meta })
      .from(h)
      .where(and(eq(h.contactId, id), eq(h.action, "delete")))
      .orderBy(desc(h.createdAt))
      .limit(1);
    const linkedBy = (del?.meta?.linkedBy as string[] | undefined) ?? [];
    if (linkedBy.length)
      await db.update(c).set({ organizationContactId: id }).where(and(inArray(c.id, linkedBy), isNull(c.organizationContactId), isNull(c.deletedAt)));
    await recordHistory(db, { contactId: id, userId: user.id, action: "restore", before, after, meta: { force: true, fromTrash: true } });
    return ctx.json({ ok: true });
  })

  .delete("/trash/:id", idParam, async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    const [gone] = await db
      .delete(c)
      .where(and(eq(c.id, id), eq(c.ownerId, user.id), isNotNull(c.deletedAt)))
      .returning({ photoKey: c.photoKey, coverKey: c.coverKey });
    if (!gone) throw new HTTPException(404, { message: "No está en la papelera" });
    for (const k of [gone.photoKey, gone.coverKey]) if (k) await deletePhoto(k).catch(() => {});
    return ctx.body(null, 204);
  })

  .delete("/trash", async (ctx) => {
    const user = ctx.get("user");
    const gone = await db
      .delete(c)
      .where(and(eq(c.ownerId, user.id), isNotNull(c.deletedAt)))
      .returning({ photoKey: c.photoKey, coverKey: c.coverKey });
    for (const g of gone) for (const k of [g.photoKey, g.coverKey]) if (k) await deletePhoto(k).catch(() => {});
    return ctx.json({ deleted: gone.length });
  });

