import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Reminder } from "@agendario/shared";
import { db, schema } from "../db/index.js";

const r = schema.reminders;
const c = schema.contacts;
const u = schema.unknownCalls;

/** Últimas cifras del número (sin prefijo de país ni espacios) para emparejar llamadas con contactos. */
export const phoneKey = (n: string) => {
  const d = n.replace(/\D/g, "");
  return d.length > 9 ? d.slice(-9) : d;
};

type Row = typeof r.$inferSelect;
type ContactLite = { id: string; displayName: string; photoKey: string | null; updatedAt: Date };

export function toReminder(x: Row, ct?: ContactLite | null): Reminder {
  return {
    id: x.id,
    contactId: x.contactId,
    kind: x.kind as Reminder["kind"],
    text: x.text,
    dueAt: x.dueAt.toISOString(),
    doneAt: x.doneAt?.toISOString() ?? null,
    createdAt: x.createdAt.toISOString(),
    contact: ct ? { id: ct.id, displayName: ct.displayName, hasPhoto: !!ct.photoKey, updatedAt: ct.updatedAt.toISOString() } : null,
  };
}

/** Recordatorios de un usuario (pendientes, o todos), con el contacto. */
export async function remindersOf(userId: string, opts: { contactId?: string; pendingOnly?: boolean } = {}) {
  const conds = [eq(r.userId, userId)];
  if (opts.contactId) conds.push(eq(r.contactId, opts.contactId));
  if (opts.pendingOnly) conds.push(isNull(r.doneAt));
  const rows = await db.select().from(r).where(and(...conds)).orderBy(asc(r.dueAt)).limit(1000);
  const ids = [...new Set(rows.map((x) => x.contactId).filter((x): x is string => !!x))];
  const contacts = ids.length
    ? await db.select({ id: c.id, displayName: c.displayName, photoKey: c.photoKey, updatedAt: c.updatedAt }).from(c).where(inArray(c.id, ids))
    : [];
  const byId = new Map(contacts.map((x) => [x.id, x]));
  return rows.map((x) => toReminder(x, x.contactId ? byId.get(x.contactId) : null));
}

/**
 * Al guardar un contacto con teléfonos: las llamadas de esos números que se apuntaron
 * cuando aún no eran contactos pasan a su ficha (con su nota).
 */
export async function adoptUnknownCalls(userId: string, contactId: string, phones: { value: string }[]) {
  const keys = new Set(phones.map((p) => phoneKey(p.value)).filter((k) => k.length >= 6));
  if (!keys.size) return 0;
  const rows = await db.select().from(u).where(eq(u.userId, userId));
  const mine = rows.filter((x) => keys.has(phoneKey(x.number)));
  for (const x of mine) {
    await db
      .insert(schema.interactions)
      .values({
        userId, contactId, kind: x.type === "out" ? "call_out" : "call_in", occurredAt: x.occurredAt,
        durationMin: x.durationSec > 0 ? Math.max(1, Math.round(x.durationSec / 60)) : null,
        channel: x.number, notes: x.notes, externalId: x.externalId,
      })
      .onConflictDoUpdate({ target: [schema.interactions.userId, schema.interactions.externalId], set: { notes: x.notes } });
    await db.delete(u).where(eq(u.id, x.id));
  }
  return mine.length;
}
