import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { contactPrefsSchema, interactionInputSchema, userPrefsSchema } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { canReadSql } from "../lib/access.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import { toInteraction, userPrefsOf } from "../lib/personal.js";

const c = schema.contacts;
const i = schema.interactions;
const idParam = zValidator("param", z.object({ id: z.string().uuid() }));

/** Basta con poder ver el contacto: las llamadas, apuntes y preferencias son de cada usuario. */
async function requireView(contactId: string, userId: string) {
  const [row] = await db.select({ id: c.id }).from(c).where(and(eq(c.id, contactId), canReadSql(userId)));
  if (!row) throw new HTTPException(404, { message: "Contacto no encontrado" });
}

export const personalRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  // ---------- Llamadas y apuntes ----------
  .post("/contacts/:id/interactions", idParam, zValidator("json", interactionInputSchema), async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await requireView(id, user.id);
    const b = ctx.req.valid("json");
    const [row] = await db
      .insert(i)
      .values({ ...b, occurredAt: new Date(b.occurredAt), userId: user.id, contactId: id })
      .returning();
    return ctx.json(toInteraction(row), 201);
  })
  .patch("/interactions/:id", idParam, zValidator("json", interactionInputSchema.partial()), async (ctx) => {
    const user = ctx.get("user");
    const b = ctx.req.valid("json");
    const [row] = await db
      .update(i)
      .set({ ...b, ...(b.occurredAt ? { occurredAt: new Date(b.occurredAt) } : {}), updatedAt: new Date() } as Partial<typeof i.$inferInsert>)
      .where(and(eq(i.id, ctx.req.valid("param").id), eq(i.userId, user.id)))
      .returning();
    if (!row) throw new HTTPException(404, { message: "No encontrado" });
    return ctx.json(toInteraction(row));
  })
  .delete("/interactions/:id", idParam, async (ctx) => {
    const user = ctx.get("user");
    await db.delete(i).where(and(eq(i.id, ctx.req.valid("param").id), eq(i.userId, user.id)));
    return ctx.body(null, 204);
  })

  // ---------- Preferencias por contacto ----------
  .put("/contacts/:id/prefs", idParam, zValidator("json", contactPrefsSchema), async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await requireView(id, user.id);
    const prefs = ctx.req.valid("json");
    await db
      .insert(schema.contactPrefs)
      .values({ userId: user.id, contactId: id, prefs })
      .onConflictDoUpdate({ target: [schema.contactPrefs.userId, schema.contactPrefs.contactId], set: { prefs } });
    return ctx.json(prefs);
  })

  // ---------- Preferencias generales ----------
  .get("/prefs", async (ctx) => ctx.json(await userPrefsOf(ctx.get("user").id)))
  .put("/prefs", zValidator("json", userPrefsSchema), async (ctx) => {
    const user = ctx.get("user");
    const prefs = ctx.req.valid("json");
    await db
      .insert(schema.userPrefs)
      .values({ userId: user.id, prefs })
      .onConflictDoUpdate({ target: schema.userPrefs.userId, set: { prefs } });
    return ctx.json(prefs);
  });
