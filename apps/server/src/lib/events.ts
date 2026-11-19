/**
 * Eventos del calendario (cumpleaños, santos, fechas importantes) con el estado de los regalos.
 */
import { and, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import {
  dateTypeLabels,
  giftEventKinds,
  saintDateFor,
  type GiftOccasion,
  type GiftOverviewItem,
  type GiftStatus,
  type Occasion,
  type PendingGift,
  type UpcomingEvent,
} from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { visibleContacts } from "./access.js";
import { parsePartial } from "./dates.js";
import { userPrefsOf } from "./personal.js";

const ct = schema.contacts;
const gi = schema.giftIdeas;

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utcDay = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

/** Ocurrencia de una fecha parcial en un año (29-feb → 28-feb en años no bisiestos). */
function occurrence(partial: string, year: number) {
  const { year: born, month, day } = parsePartial(partial);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const dd = month === 2 && day === 29 && !leap ? 28 : day;
  return { date: new Date(Date.UTC(year, month - 1, dd)), turning: born && year >= born ? year - born : null };
}

export interface Source {
  gift?: boolean;
  emoji?: string;
  contactId: string;
  contactName: string;
  hasPhoto: boolean;
  key: string;
  kind: UpcomingEvent["kind"];
  label: string;
  partial: string;
  auto?: boolean;
  useAge: boolean;
}

/** Todas las fechas recurrentes que ve el usuario. */
export async function sources(userId: string, onlyContact?: string): Promise<Source[]> {
  const prefs = await userPrefsOf(userId);
  const visible = visibleContacts(userId);
  const where = onlyContact ? and(visible, eq(ct.id, onlyContact)) : visible;
  const [people, dates, cprefs] = await Promise.all([
    db.select({ id: ct.id, name: ct.displayName, given: ct.givenName, birthday: ct.birthday, photoKey: ct.photoKey, org: ct.organization, family: ct.familyName }).from(ct).where(where),
    db
      .select({ id: schema.importantDates.id, contactId: schema.importantDates.contactId, label: schema.importantDates.label, type: schema.importantDates.type, date: schema.importantDates.date })
      .from(schema.importantDates)
      .innerJoin(ct, eq(ct.id, schema.importantDates.contactId))
      .where(where),
    db.select({ contactId: schema.contactPrefs.contactId, prefs: schema.contactPrefs.prefs }).from(schema.contactPrefs).where(eq(schema.contactPrefs.userId, userId)),
  ]);
  const noAuto = new Set(cprefs.filter((p) => (p.prefs as { autoSaint?: boolean }).autoSaint === false).map((p) => p.contactId));
  const evPrefs = new Map(cprefs.map((p) => [p.contactId, ((p.prefs as { events?: Record<string, { gift?: boolean; emoji?: string }> }).events ?? {})]));
  const manualSaint = new Set(dates.filter((d) => d.type === "saint_day").map((d) => d.contactId));
  const out: Source[] = [];
  const byId = new Map(people.map((p) => [p.id, p]));
  for (const p of people) {
    const base = { contactId: p.id, contactName: p.name, hasPhoto: !!p.photoKey };
    if (p.birthday) out.push({ ...base, key: "birthday", kind: "birthday", label: "Cumpleaños", partial: p.birthday, useAge: true });
    // Santo automático: solo personas (con nombre de pila), si no tiene uno a mano ni lo ha desactivado
    if (prefs.autoSaints && p.given && !noAuto.has(p.id) && !manualSaint.has(p.id)) {
      const s = saintDateFor(p.given);
      if (s) out.push({ ...base, key: "saint", kind: "saint_day", label: "Santo", partial: s, auto: true, useAge: false });
    }
  }
  for (const d of dates) {
    const p = byId.get(d.contactId);
    if (!p) continue;
    out.push({
      contactId: p.id, contactName: p.name, hasPhoto: !!p.photoKey,
      key: `date:${d.id}`, kind: d.type, label: d.label || dateTypeLabels[d.type], partial: d.date, useAge: d.type === "anniversary",
    });
  }
  for (const s of out) {
    const p = evPrefs.get(s.contactId)?.[s.key];
    if (p) Object.assign(s, { gift: p.gift, emoji: p.emoji || undefined });
  }
  return out;
}

/** Eventos entre dos fechas (incluidas), con el color del regalo. */
export async function eventsBetween(userId: string, from: Date, to: Date, onlyContact?: string): Promise<UpcomingEvent[]> {
  const today = utcDay(new Date());
  const [src, ideas] = await Promise.all([
    sources(userId, onlyContact),
    db.select({ id: gi.id, contactId: gi.contactId, title: gi.title, status: gi.status, eventKey: gi.eventKey, givenAt: gi.givenAt }).from(gi).where(eq(gi.userId, userId)),
  ]);
  const open = new Map<string, number>();
  const linked = new Map<string, { id: string; title: string; status: GiftStatus }[]>();
  for (const i of ideas) {
    if (i.status === "idea") open.set(i.contactId, (open.get(i.contactId) ?? 0) + 1);
    else if (i.eventKey && i.givenAt) {
      const k = `${i.contactId}|${i.eventKey}|${i.givenAt}`;
      linked.set(k, [...(linked.get(k) ?? []), { id: i.id, title: i.title, status: i.status as GiftStatus }]);
    }
  }
  const out: UpcomingEvent[] = [];
  for (const s of src) {
    for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
      const { date, turning } = occurrence(s.partial, y);
      if (date < from || date > to) continue;
      const iso = isoOf(date);
      const gifts = linked.get(`${s.contactId}|${s.key}|${iso}`) ?? [];
      const daysLeft = Math.round((date.getTime() - today.getTime()) / 86_400_000);
      let gift: UpcomingEvent["gift"] = null;
      if (s.gift ?? (giftEventKinds as readonly string[]).includes(s.kind)) {
        if (gifts.length) gift = gifts.every((g) => g.status === "given") ? "given" : "bought";
        else if (daysLeft >= 0) gift = (open.get(s.contactId) ?? 0) > 0 ? "ideas" : "none";
      }
      out.push({
        contactId: s.contactId, contactName: s.contactName, hasPhoto: s.hasPhoto, label: s.label, kind: s.kind, key: s.key,
        date: iso, daysLeft, turning: s.useAge ? turning : null, openGiftIdeas: open.get(s.contactId) ?? 0, gift, auto: s.auto, gifts, emoji: s.emoji,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.contactName.localeCompare(b.contactName, "es"));
}

/** Próximas ocasiones de un contacto para asignar un regalo comprado (este año y el siguiente). */
export async function occasionsFor(userId: string, contactId: string): Promise<GiftOccasion[]> {
  const today = utcDay(new Date());
  const to = new Date(Date.UTC(today.getUTCFullYear() + 1, 11, 31));
  const from = new Date(today.getTime() - 60 * 86_400_000); // también las recientes (regalo atrasado)
  const evs = await eventsBetween(userId, from, to, contactId);
  const occ: Record<string, Occasion> = { birthday: "birthday", saint_day: "saint_day", anniversary: "anniversary" };
  const list: GiftOccasion[] = evs.map((e) => ({ key: e.key, label: `${e.label} ${e.date.slice(0, 4)}`, date: e.date, occasion: occ[e.kind] ?? "other" }));
  // Fiestas comunes
  for (let y = today.getUTCFullYear(); y <= today.getUTCFullYear() + 1; y++) {
    for (const [key, label, md, o] of [["christmas", "Navidad", "12-25", "christmas"], ["reyes", "Reyes", "01-06", "reyes"]] as const) {
      const d = new Date(Date.UTC(y, Number(md.slice(0, 2)) - 1, Number(md.slice(3))));
      if (d >= from) list.push({ key, label: `${label} ${y}`, date: isoOf(d), occasion: o });
    }
  }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/** Comprados y no regalados cuya fecha ya pasó (aviso en el menú). */
export async function pendingGifts(userId: string): Promise<PendingGift[]> {
  const today = isoOf(utcDay(new Date()));
  const rows = await db
    .select({ id: gi.id, title: gi.title, contactId: gi.contactId, contactName: ct.displayName, eventLabel: gi.eventLabel, givenAt: gi.givenAt })
    .from(gi)
    .innerJoin(ct, eq(ct.id, gi.contactId))
    .where(and(eq(gi.userId, userId), eq(gi.status, "bought"), lt(gi.givenAt, today), isNull(ct.deletedAt)));
  return rows;
}

/** Pestaña Regalos: contactos con alguna fecha de regalo, su próxima ocurrencia y sus ideas sin regalar. */
export async function giftOverview(userId: string): Promise<GiftOverviewItem[]> {
  const today = utcDay(new Date());
  const to = new Date(today.getTime() + 366 * 86_400_000);
  const evs = (await eventsBetween(userId, today, to)).filter((e) => e.gift !== null);
  const next = new Map<string, UpcomingEvent>();
  for (const e of evs) if (!next.has(e.contactId)) next.set(e.contactId, e);
  const ids = [...next.keys()];
  if (!ids.length) return [];
  const [ideas, contacts] = await Promise.all([
    db.select().from(gi).where(and(eq(gi.userId, userId), inArray(gi.contactId, ids), ne(gi.status, "given"))).orderBy(gi.createdAt),
    db.select({ id: ct.id, updatedAt: ct.updatedAt }).from(ct).where(inArray(ct.id, ids)),
  ]);
  const ver = new Map(contacts.map((c) => [c.id, c.updatedAt.toISOString()]));
  return ids.map((id) => {
    const e = next.get(id)!;
    return {
      contactId: id,
      contactName: e.contactName,
      hasPhoto: e.hasPhoto,
      photoVersion: ver.get(id) ?? "",
      next: e,
      ideas: ideas
        .filter((g) => g.contactId === id)
        .map((g) => ({
          id: g.id, contactId: g.contactId, title: g.title, url: g.url, notes: g.notes, priceCents: g.priceCents, given: g.given, givenAt: g.givenAt,
          occasion: g.occasion, status: g.status as GiftStatus, eventKey: g.eventKey, eventLabel: g.eventLabel, imageKey: g.imageKey, createdAt: g.createdAt.toISOString(),
        })),
    };
  });
}
