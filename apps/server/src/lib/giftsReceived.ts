import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { GiftReceived, Occasion } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { visibleContacts } from "./access.js";

const gr = schema.giftsReceived;
const link = schema.giftReceivedContacts;
const c = schema.contacts;

/**
 * Regalos recibidos (privados de cada usuario). Cada uno puede venir de varios contactos
 * (tabla gift_received_contacts); `contact_id` guarda el primero por compatibilidad.
 */
export async function listReceived(userId: string, opts: { contactId?: string; id?: string } = {}): Promise<GiftReceived[]> {
  const where = and(
    eq(gr.userId, userId),
    opts.id ? eq(gr.id, opts.id) : undefined,
    opts.contactId ? sql`EXISTS (SELECT 1 FROM ${link} WHERE ${link.giftId} = ${gr.id} AND ${link.contactId} = ${opts.contactId})` : undefined,
  );
  const rows = await db.select().from(gr).where(where).orderBy(sql`${gr.receivedAt} DESC NULLS LAST`, desc(gr.createdAt));
  if (!rows.length) return [];
  const people = await db
    .select({ giftId: link.giftId, id: c.id, displayName: c.displayName, photoKey: c.photoKey, updatedAt: c.updatedAt })
    .from(link)
    .innerJoin(c, eq(c.id, link.contactId))
    .where(and(inArray(link.giftId, rows.map((r) => r.id)), visibleContacts(userId)))
    .orderBy(asc(sql`lower(${c.displayName})`));
  const byGift = new Map<string, GiftReceived["contacts"]>();
  for (const p of people) {
    const list = byGift.get(p.giftId) ?? [];
    list.push({ id: p.id, displayName: p.displayName, hasPhoto: !!p.photoKey, updatedAt: p.updatedAt.toISOString() });
    byGift.set(p.giftId, list);
  }
  return rows.map((g) => ({
    id: g.id,
    contactId: g.contactId,
    description: g.description,
    receivedAt: g.receivedAt,
    occasion: g.occasion as Occasion | null,
    notes: g.notes,
    contacts: byGift.get(g.id) ?? [],
    createdAt: g.createdAt.toISOString(),
  }));
}

/** Comprueba que el usuario ve todos esos contactos (y quita repetidos). */
export async function checkContacts(userId: string, ids: string[]) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) throw new HTTPException(400, { message: "Elige quién te lo regaló" });
  const ok = await db.select({ id: c.id }).from(c).where(and(inArray(c.id, uniq), visibleContacts(userId)));
  if (ok.length !== uniq.length) throw new HTTPException(404, { message: "Contacto no encontrado" });
  return uniq;
}

/** Sustituye la lista de contactos de un regalo (primero añade y luego quita: nunca se queda vacío). */
export async function setGiftContacts(giftId: string, contactIds: string[]) {
  await db.transaction(async (tx) => {
    await tx.insert(link).values(contactIds.map((contactId) => ({ giftId, contactId }))).onConflictDoNothing();
    const keep = new Set(contactIds);
    const current = await tx.select({ contactId: link.contactId }).from(link).where(eq(link.giftId, giftId));
    const drop = current.map((r) => r.contactId).filter((id) => !keep.has(id));
    if (drop.length) await tx.delete(link).where(and(eq(link.giftId, giftId), inArray(link.contactId, drop)));
    await tx.update(gr).set({ contactId: contactIds[0]! }).where(eq(gr.id, giftId));
  });
}

/** Un regalo concreto, ya con sus contactos. */
export async function getReceived(userId: string, id: string) {
  const [g] = await listReceived(userId, { id });
  if (!g) throw new HTTPException(404, { message: "Regalo no encontrado" });
  return g;
}
