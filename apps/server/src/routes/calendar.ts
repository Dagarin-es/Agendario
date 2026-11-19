/**
 * Efemérides (fechas personales del usuario, sin contacto) y calendario suscribible (.ics).
 */
import { randomBytes } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { calendarFeedSchema, personalEventInputSchema, type CalendarFeed, type PersonalEvent } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import { parsePartial } from "../lib/dates.js";
import { sources } from "../lib/events.js";
import { deletePhoto, MAX_UPLOAD_BYTES, photoType, readPhoto, savePhoto } from "../lib/photos.js";
import { deleteSetting, getSetting, setSetting } from "../lib/settings.js";

const pe = schema.personalEvents;
const idParam = zValidator("param", z.object({ id: z.string().uuid() }));

function toEvent(r: typeof pe.$inferSelect): PersonalEvent {
  return {
    id: r.id,
    title: r.title,
    date: r.date,
    emoji: r.emoji,
    yearly: r.yearly,
    description: r.description,
    comment: r.comment,
    hasPhoto: !!r.photoKey,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function own(id: string, userId: string) {
  const [row] = await db.select().from(pe).where(and(eq(pe.id, id), eq(pe.userId, userId)));
  if (!row) throw new HTTPException(404, { message: "Efeméride no encontrada" });
  return row;
}

export const personalEventRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", async (c) => {
    const rows = await db.select().from(pe).where(eq(pe.userId, c.get("user").id)).orderBy(desc(pe.date));
    return c.json(rows.map(toEvent));
  })
  .post("/", zValidator("json", personalEventInputSchema), async (c) => {
    const [row] = await db.insert(pe).values({ ...c.req.valid("json"), userId: c.get("user").id }).returning();
    return c.json(toEvent(row!), 201);
  })
  .patch("/:id", idParam, zValidator("json", personalEventInputSchema.partial()), async (c) => {
    const { id } = c.req.valid("param");
    await own(id, c.get("user").id);
    const [row] = await db.update(pe).set({ ...c.req.valid("json"), updatedAt: new Date() }).where(eq(pe.id, id)).returning();
    return c.json(toEvent(row!));
  })
  .delete("/:id", idParam, async (c) => {
    const { id } = c.req.valid("param");
    const row = await own(id, c.get("user").id);
    await db.delete(pe).where(eq(pe.id, id));
    if (row.photoKey) await deletePhoto(row.photoKey).catch(() => {});
    return c.body(null, 204);
  })
  .get("/:id/photo", idParam, zValidator("query", z.object({ size: z.enum(["full", "thumb"]).default("thumb") })), async (c) => {
    const row = await own(c.req.valid("param").id, c.get("user").id);
    if (!row.photoKey) throw new HTTPException(404, { message: "Sin foto" });
    const data = await readPhoto(row.photoKey, c.req.valid("query").size);
    return c.body(new Uint8Array(data), 200, { "Content-Type": photoType(row.photoKey), "Cache-Control": "private, max-age=86400", ETag: `"${row.photoKey}"` });
  })
  .put("/:id/photo", idParam, async (c) => {
    const { id } = c.req.valid("param");
    const row = await own(id, c.get("user").id);
    const form = await c.req.parseBody();
    const file = form["photo"];
    if (!(file instanceof File)) throw new HTTPException(400, { message: "Falta el campo 'photo'" });
    if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "La imagen es demasiado grande" });
    let key: string;
    try {
      key = await savePhoto(Buffer.from(await file.arrayBuffer()));
    } catch {
      throw new HTTPException(400, { message: "No es una imagen válida" });
    }
    await db.update(pe).set({ photoKey: key, updatedAt: new Date() }).where(eq(pe.id, id));
    if (row.photoKey) await deletePhoto(row.photoKey).catch(() => {});
    return c.json({ ok: true });
  })
  .delete("/:id/photo", idParam, async (c) => {
    const { id } = c.req.valid("param");
    const row = await own(id, c.get("user").id);
    await db.update(pe).set({ photoKey: null, updatedAt: new Date() }).where(eq(pe.id, id));
    if (row.photoKey) await deletePhoto(row.photoKey).catch(() => {});
    return c.body(null, 204);
  });

// ---------- Calendario .ics ----------

interface FeedConf {
  token: string | null;
  events: boolean;
  personal: boolean;
}
const confKey = (userId: string) => `ics.user.${userId}`;
const tokenKey = (token: string) => `ics.token.${token}`;
const loadConf = (userId: string) => getSetting<FeedConf>(confKey(userId), { token: null, events: true, personal: true });
const feedOut = (f: FeedConf): CalendarFeed => ({ events: f.events, personal: f.personal, path: f.token ? `/api/ics/${f.token}.ics` : null });

/** Texto de iCalendar (RFC 5545): escapar y plegar a 75 octetos. */
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
function fold(line: string) {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}${pad(m)}${pad(d)}`;
const nextDay = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};

/** Evento de día completo; si es anual, con repetición (el 29-feb pasa al último día de febrero). */
function vevent(uid: string, partial: string, summary: string, yearly: boolean, description?: string | null) {
  const { year, month, day } = parsePartial(partial);
  if (!yearly && !year) return [];
  const y = year ?? 2000;
  const leapDay = month === 2 && day === 29;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}@agendario`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
    `DTSTART;VALUE=DATE:${ymd(y, month, day)}`,
    `DTEND;VALUE=DATE:${nextDay(y, month, day)}`,
    ...(yearly ? [leapDay ? "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1" : "RRULE:FREQ=YEARLY"] : []),
    `SUMMARY:${icsText(summary)}`,
    ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ];
  return lines;
}

const kindEmoji: Record<string, string> = { birthday: "🎂", anniversary: "💍", saint_day: "😇" };

/** Calendario con las fechas del usuario: Eventos (cumpleaños y fechas de contactos) y/o Efemérides. */
export async function buildIcs(userId: string, opts: { events: boolean; personal: boolean }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Agendario//Agendario//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Agendario",
    "X-WR-CALDESC:Fechas de Agendario",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  if (opts.events) {
    for (const s of await sources(userId)) {
      const emoji = s.emoji || kindEmoji[s.kind] || "📅";
      const summary = s.kind === "birthday" ? `${emoji} Cumpleaños de ${s.contactName}` : `${emoji} ${s.label} · ${s.contactName}`;
      lines.push(...vevent(`${s.key.replace(":", "-")}-${s.contactId}`, s.partial, summary, true));
    }
  }
  if (opts.personal) {
    // Solo título y descripción: el comentario personal y la foto no salen de Agendario
    for (const e of await db.select().from(pe).where(eq(pe.userId, userId))) {
      lines.push(...vevent(`efemeride-${e.id}`, e.date, `${e.emoji || "⭐"} ${e.title}`, e.yearly, e.description));
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

const icsHeaders = (download: boolean) => ({
  "Content-Type": "text/calendar; charset=utf-8",
  "Cache-Control": "private, max-age=900",
  ...(download ? { "Content-Disposition": `attachment; filename="agendario-${new Date().toISOString().slice(0, 10)}.ics"` } : {}),
});

export const calendarRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/feed", async (c) => c.json(feedOut(await loadConf(c.get("user").id))))
  .put("/feed", zValidator("json", calendarFeedSchema), async (c) => {
    const userId = c.get("user").id;
    const conf = { ...(await loadConf(userId)), ...c.req.valid("json") };
    await setSetting(confKey(userId), conf);
    return c.json(feedOut(conf));
  })
  /** Crea (o cambia) el enlace privado; el anterior deja de funcionar. */
  .post("/feed/token", async (c) => {
    const userId = c.get("user").id;
    const conf = await loadConf(userId);
    if (conf.token) await deleteSetting(tokenKey(conf.token));
    conf.token = randomBytes(24).toString("base64url");
    await setSetting(tokenKey(conf.token), userId);
    await setSetting(confKey(userId), conf);
    return c.json(feedOut(conf));
  })
  .delete("/feed/token", async (c) => {
    const userId = c.get("user").id;
    const conf = await loadConf(userId);
    if (conf.token) await deleteSetting(tokenKey(conf.token));
    conf.token = null;
    await setSetting(confKey(userId), conf);
    return c.json(feedOut(conf));
  })
  .get("/export.ics", zValidator("query", calendarFeedSchema.partial()), async (c) => {
    const q = c.req.valid("query");
    const opts = { events: q.events !== false, personal: q.personal !== false };
    return c.body(await buildIcs(c.get("user").id, opts), 200, icsHeaders(true));
  });

/** Enlace de suscripción: sin sesión, el token (largo y aleatorio) hace de llave. */
export const icsPublicRoutes = new Hono<AppEnv>().get("/:file", async (c) => {
  const token = c.req.param("file").replace(/\.ics$/, "");
  if (!/^[\w-]{20,}$/.test(token)) throw new HTTPException(404, { message: "No encontrado" });
  const userId = await getSetting<string | null>(tokenKey(token), null);
  if (!userId) throw new HTTPException(404, { message: "No encontrado" });
  const [u] = await db.select({ id: schema.users.id, disabled: schema.users.disabled }).from(schema.users).where(eq(schema.users.id, userId));
  if (!u || u.disabled) throw new HTTPException(404, { message: "No encontrado" });
  const conf = await loadConf(userId);
  if (conf.token !== token) throw new HTTPException(404, { message: "No encontrado" });
  return c.body(await buildIcs(userId, conf), 200, icsHeaders(false));
});
