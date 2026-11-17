import { zValidator } from "@hono/zod-validator";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { tagInputSchema, tagOrderSchema, tagPatchSchema, type Tag } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { deleteContacts } from "../lib/merge.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";

const t = schema.tags;
const ct = schema.contactTags;
const c = schema.contacts;
const idParam = zValidator("param", z.object({ id: z.string().uuid() }));

async function ownTag(id: string, userId: string) {
  const [row] = await db.select().from(t).where(and(eq(t.id, id), eq(t.userId, userId)));
  if (!row) throw new HTTPException(404, { message: "Etiqueta no encontrada" });
  return row;
}

function nameTaken(e: unknown) {
  return (e as { code?: string })?.code === "23505";
}

export const tagRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get("/", async (ctx) => {
    const user = ctx.get("user");
    const rows = await db
      .select({ id: t.id, name: t.name, color: t.color, parentId: t.parentId, position: t.position, contactCount: count(c.id) })
      .from(t)
      .leftJoin(ct, eq(ct.tagId, t.id))
      .leftJoin(c, and(eq(c.id, ct.contactId), sql`${c.deletedAt} IS NULL`))
      .where(eq(t.userId, user.id))
      .groupBy(t.id)
      .orderBy(t.position, sql`lower(${t.name})`);
    // Total con subetiquetas (contactos distintos)
    const links = await db
      .select({ tagId: ct.tagId, contactId: ct.contactId })
      .from(ct)
      .innerJoin(t, eq(t.id, ct.tagId))
      .innerJoin(c, eq(c.id, ct.contactId))
      .where(and(eq(t.userId, user.id), sql`${c.deletedAt} IS NULL`));
    const byTag = new Map<string, string[]>();
    for (const l of links) byTag.set(l.tagId, [...(byTag.get(l.tagId) ?? []), l.contactId]);
    const kids = new Map<string, string[]>();
    for (const r of rows) if (r.parentId) kids.set(r.parentId, [...(kids.get(r.parentId) ?? []), r.id]);
    const collect = (id: string, acc: Set<string>, seen: Set<string>) => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const x of byTag.get(id) ?? []) acc.add(x);
      for (const k of kids.get(id) ?? []) collect(k, acc, seen);
    };
    return ctx.json(
      rows.map((r) => {
        const acc = new Set<string>();
        collect(r.id, acc, new Set());
        return { ...r, totalCount: acc.size };
      }) satisfies Tag[],
    );
  })

  .post("/", zValidator("json", tagInputSchema), async (ctx) => {
    const user = ctx.get("user");
    try {
      const b = ctx.req.valid("json");
      if (b.parentId) await ownTag(b.parentId, user.id);
      const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(t).where(and(eq(t.userId, user.id), b.parentId ? eq(t.parentId, b.parentId) : sql`${t.parentId} IS NULL`));
      const [row] = await db
        .insert(t)
        .values({ ...b, parentId: b.parentId ?? null, position: n, userId: user.id })
        .returning({ id: t.id, name: t.name, color: t.color, parentId: t.parentId, position: t.position });
      return ctx.json({ ...row!, contactCount: 0, totalCount: 0 }, 201);
    } catch (e) {
      if (nameTaken(e)) throw new HTTPException(409, { message: "Ya tienes una etiqueta con ese nombre" });
      throw e;
    }
  })

  // Reordenar y anidar (se envía el árbol completo)
  .put("/order", zValidator("json", tagOrderSchema), async (ctx) => {
    const user = ctx.get("user");
    const { items } = ctx.req.valid("json");
    const current = await db.select({ id: t.id, parentId: t.parentId }).from(t).where(eq(t.userId, user.id));
    const mine = new Map(current.map((r) => [r.id, true]));
    // Árbol resultante: el actual con los cambios enviados encima
    const parentOf = new Map<string, string | null>(current.map((r) => [r.id, r.parentId]));
    for (const i of items) parentOf.set(i.id, i.parentId);
    for (const i of items) {
      if (!mine.has(i.id) || (i.parentId && !mine.has(i.parentId))) throw new HTTPException(400, { message: "Etiqueta no válida" });
      // Sin bucles (una etiqueta no puede estar dentro de sí misma)
      let p = i.parentId;
      for (let n = 0; p && n < 50; n++) {
        if (p === i.id) throw new HTTPException(400, { message: "Una etiqueta no puede ir dentro de sí misma" });
        p = parentOf.get(p) ?? null;
      }
    }
    await db.transaction(async (tx) => {
      for (const i of items) await tx.update(t).set({ parentId: i.parentId, position: i.position }).where(and(eq(t.id, i.id), eq(t.userId, user.id)));
    });
    return ctx.json({ ok: true });
  })

  .patch("/:id", idParam, zValidator("json", tagPatchSchema), async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await ownTag(id, user.id);
    try {
      const { parentId: _p, ...patch } = ctx.req.valid("json"); // el anidado se cambia con /order (comprueba bucles)
      const [row] = await db.update(t).set(patch).where(eq(t.id, id)).returning();
      return ctx.json(row);
    } catch (e) {
      if (nameTaken(e)) throw new HTTPException(409, { message: "Ya tienes una etiqueta con ese nombre" });
      throw e;
    }
  })

  /**
   * Borra la etiqueta. Con ?withContacts=true borra también los contactos PROPIOS que la tengan
   * (muy útil para deshacer una importación de prueba). Los contactos compartidos por otros nunca se borran.
   */
  .delete("/:id", idParam, zValidator("query", z.object({ withContacts: z.enum(["true", "false"]).default("false") })), async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await ownTag(id, user.id);
    let deletedContacts = 0;
    if (ctx.req.valid("query").withContacts === "true") {
      const mine = db
        .select({ id: ct.contactId })
        .from(ct)
        .where(eq(ct.tagId, id));
      const ids = (await db.select({ id: c.id }).from(c).where(and(eq(c.ownerId, user.id), sql`${c.deletedAt} IS NULL`, inArray(c.id, mine)))).map((r) => r.id);
      const res = { length: (await deleteContacts(user.id, ids)).affected };
      deletedContacts = res.length;
    }
    await db.delete(t).where(eq(t.id, id));
    return ctx.json({ deletedContacts });
  });
