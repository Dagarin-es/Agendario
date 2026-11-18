import { zValidator } from "@hono/zod-validator";
import { and, eq, gte, isNull, like, lte } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { callImportSchema, contactPrefsSchema, interactionInputSchema, userPrefsSchema, type CallImportResult } from "@agendario/shared";
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

/** Últimas cifras del número (sin prefijo de país ni espacios) para emparejar llamadas con contactos. */
const phoneKey = (n: string) => {
  const d = n.replace(/\D/g, "");
  return d.length > 9 ? d.slice(-9) : d;
};

export const personalRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  // ---------- Registro de llamadas del móvil (app Android) ----------
  .post("/calls/import", zValidator("json", callImportSchema), async (ctx) => {
    const user = ctx.get("user");
    const { calls } = ctx.req.valid("json");
    const result: CallImportResult = { added: 0, skipped: 0, unmatched: 0 };
    if (!calls.length) return ctx.json(result);
    const contacts = await db.select({ id: c.id, phones: c.phones, name: c.displayName }).from(c).where(and(canReadSql(user.id), isNull(c.deletedAt)));
    const names = new Map(contacts.map((x) => [x.id, x.name]));
    result.items = [];
    const byPhone = new Map<string, string>();
    for (const ct of contacts) for (const p of ct.phones) { const k = phoneKey(p.value); if (k.length >= 6 && !byPhone.has(k)) byPhone.set(k, ct.id); }
    const kinds = { in: "call_in", out: "call_out", missed: "call_missed" } as const;
    for (const call of calls) {
      const contactId = byPhone.get(phoneKey(call.number));
      if (!contactId) { result.unmatched++; continue; }
      const at = new Date(call.at);
      // Ya registrada a mano (mismo contacto, llamada, ±3 minutos)
      const near = await db.select({ id: i.id }).from(i).where(and(
        eq(i.userId, user.id), eq(i.contactId, contactId), like(i.kind, "call_%"),
        gte(i.occurredAt, new Date(at.getTime() - 180_000)), lte(i.occurredAt, new Date(at.getTime() + 180_000)),
      )).limit(1);
      if (near.length) { result.skipped++; continue; }
      const ins = await db.insert(i).values({
        userId: user.id, contactId, kind: kinds[call.type], occurredAt: at,
        durationMin: call.durationSec > 0 ? Math.max(1, Math.round(call.durationSec / 60)) : null,
        channel: call.number, notes: "", externalId: `call:${call.id}`,
      }).onConflictDoNothing().returning({ id: i.id });
      if (ins.length) {
        result.added++;
        result.items!.push({ interactionId: ins[0]!.id, contactId, contactName: names.get(contactId) ?? "", type: call.type, durationSec: call.durationSec, at: call.at });
      } else result.skipped++;
    }
    return ctx.json(result);
  })

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
