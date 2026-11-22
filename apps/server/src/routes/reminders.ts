import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { reminderInputSchema, reminderPatchSchema, type CallLookup, type UnknownCall } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { canReadSql } from "../lib/access.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import { phoneKey, remindersOf, toReminder } from "../lib/reminders.js";

const r = schema.reminders;
const c = schema.contacts;
const u = schema.unknownCalls;
const i = schema.interactions;
const idParam = zValidator("param", z.object({ id: z.string().uuid() }));

async function checkContact(contactId: string | null | undefined, userId: string) {
  if (!contactId) return;
  const [row] = await db.select({ id: c.id }).from(c).where(and(eq(c.id, contactId), canReadSql(userId)));
  if (!row) throw new HTTPException(404, { message: "Contacto no encontrado" });
}

const toUnknown = (x: typeof u.$inferSelect): UnknownCall => ({
  id: x.id, number: x.number, type: x.type as UnknownCall["type"], occurredAt: x.occurredAt.toISOString(), durationSec: x.durationSec, notes: x.notes,
});

export const reminderRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  // ---------- Recordatorios ----------
  .get("/reminders", zValidator("query", z.object({ status: z.enum(["pending", "all"]).default("pending") })), async (ctx) => {
    const user = ctx.get("user");
    return ctx.json(await remindersOf(user.id, { pendingOnly: ctx.req.valid("query").status === "pending" }));
  })
  .post("/reminders", zValidator("json", reminderInputSchema), async (ctx) => {
    const user = ctx.get("user");
    const b = ctx.req.valid("json");
    await checkContact(b.contactId, user.id);
    const [row] = await db.insert(r).values({ ...b, dueAt: new Date(b.dueAt), userId: user.id }).returning();
    const [out] = (await remindersOf(user.id, { contactId: row!.contactId ?? undefined })).filter((x) => x.id === row!.id);
    return ctx.json(out ?? toReminder(row!), 201);
  })
  .patch("/reminders/:id", idParam, zValidator("json", reminderPatchSchema), async (ctx) => {
    const user = ctx.get("user");
    const { done, ...b } = ctx.req.valid("json");
    if (b.contactId) await checkContact(b.contactId, user.id);
    const set: Partial<typeof r.$inferInsert> = { updatedAt: new Date() };
    if (b.kind) set.kind = b.kind;
    if (b.text !== undefined) set.text = b.text;
    if (b.contactId !== undefined) set.contactId = b.contactId;
    if (b.dueAt) { set.dueAt = new Date(b.dueAt); set.doneAt = null; }
    if (done !== undefined) set.doneAt = done ? new Date() : null;
    const [row] = await db.update(r).set(set).where(and(eq(r.id, ctx.req.valid("param").id), eq(r.userId, user.id))).returning();
    if (!row) throw new HTTPException(404, { message: "Recordatorio no encontrado" });
    return ctx.json(toReminder(row));
  })
  .delete("/reminders/:id", idParam, async (ctx) => {
    const user = ctx.get("user");
    await db.delete(r).where(and(eq(r.id, ctx.req.valid("param").id), eq(r.userId, user.id)));
    return ctx.body(null, 204);
  })

  // ---------- Llamadas de números que no son contactos ----------
  .get("/unknown-calls", async (ctx) => {
    const user = ctx.get("user");
    const rows = await db.select().from(u).where(eq(u.userId, user.id)).orderBy(desc(u.occurredAt)).limit(200);
    return ctx.json(rows.map(toUnknown));
  })
  .get("/unknown-calls/:id", idParam, async (ctx) => {
    const user = ctx.get("user");
    const [row] = await db.select().from(u).where(and(eq(u.id, ctx.req.valid("param").id), eq(u.userId, user.id)));
    if (!row) throw new HTTPException(404, { message: "Llamada no encontrada" });
    return ctx.json(toUnknown(row));
  })
  .patch("/unknown-calls/:id", idParam, zValidator("json", z.object({ notes: z.string().max(20000) })), async (ctx) => {
    const user = ctx.get("user");
    const [row] = await db.update(u).set({ notes: ctx.req.valid("json").notes }).where(and(eq(u.id, ctx.req.valid("param").id), eq(u.userId, user.id))).returning();
    if (!row) throw new HTTPException(404, { message: "Llamada no encontrada" });
    return ctx.json(toUnknown(row));
  })
  .delete("/unknown-calls/:id", idParam, async (ctx) => {
    const user = ctx.get("user");
    await db.delete(u).where(and(eq(u.id, ctx.req.valid("param").id), eq(u.userId, user.id)));
    return ctx.body(null, 204);
  })

  // ---------- Tarjeta de la app al sonar o marcar una llamada ----------
  .get("/calls/lookup", zValidator("query", z.object({ number: z.string().min(3).max(60) })), async (ctx) => {
    const user = ctx.get("user");
    const key = phoneKey(ctx.req.valid("query").number);
    const empty: CallLookup = { contactId: null, name: "", subtitle: "", notes: [], reminders: [] };
    if (key.length < 6) return ctx.json(empty);
    const contacts = await db
      .select({ id: c.id, name: c.displayName, phones: c.phones, org: c.organization, job: c.jobTitle })
      .from(c)
      .where(and(canReadSql(user.id), isNull(c.deletedAt)));
    const ct = contacts.find((x) => x.phones.some((p) => phoneKey(p.value) === key));
    if (!ct) return ctx.json(empty);
    const notes = await db
      .select({ at: i.occurredAt, kind: i.kind, text: i.notes })
      .from(i)
      .where(and(eq(i.userId, user.id), eq(i.contactId, ct.id)))
      .orderBy(desc(i.occurredAt))
      .limit(30);
    const pending = await remindersOf(user.id, { contactId: ct.id, pendingOnly: true });
    const out: CallLookup = {
      contactId: ct.id,
      name: ct.name,
      subtitle: [ct.job, ct.org].filter(Boolean).join(" · "),
      notes: notes.filter((n) => n.text.trim()).slice(0, 3).map((n) => ({ at: n.at.toISOString(), kind: n.kind, text: n.text })),
      reminders: pending.slice(0, 3).map((x) => ({ id: x.id, kind: x.kind, text: x.text, dueAt: x.dueAt })),
    };
    return ctx.json(out);
  });
