import { zValidator } from "@hono/zod-validator";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { tagInputSchema, tagPatchSchema, type Tag } from "@agendario/shared";
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
      .select({ id: t.id, name: t.name, color: t.color, contactCount: count(c.id) })
      .from(t)
      .leftJoin(ct, eq(ct.tagId, t.id))
      .leftJoin(c, and(eq(c.id, ct.contactId), sql`${c.deletedAt} IS NULL`))
      .where(eq(t.userId, user.id))
      .groupBy(t.id)
      .orderBy(sql`lower(${t.name})`);
    return ctx.json(rows satisfies Tag[]);
  })

  .post("/", zValidator("json", tagInputSchema), async (ctx) => {
    const user = ctx.get("user");
    try {
      const [row] = await db
        .insert(t)
        .values({ ...ctx.req.valid("json"), userId: user.id })
        .returning({ id: t.id, name: t.name, color: t.color });
      return ctx.json({ ...row, contactCount: 0 }, 201);
    } catch (e) {
      if (nameTaken(e)) throw new HTTPException(409, { message: "Ya tienes una etiqueta con ese nombre" });
      throw e;
    }
  })

  .patch("/:id", idParam, zValidator("json", tagPatchSchema), async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await ownTag(id, user.id);
    try {
      const [row] = await db.update(t).set(ctx.req.valid("json")).where(eq(t.id, id)).returning();
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
