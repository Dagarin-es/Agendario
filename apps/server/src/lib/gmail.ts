/**
 * Sincronización de contactos con una cuenta de Google (Gmail) — solo en un sentido: Agendario → Google.
 *
 * Para qué: ver esos contactos en el nuevo Outlook (que no admite CardDAV) añadiendo allí la cuenta de Gmail.
 *
 * Reglas (acordadas con Daniel):
 * - Cada usuario conecta su cuenta y marca en Etiquetas cuáles se sincronizan («Sincronizar con Gmail»);
 *   las subetiquetas entran solas.
 * - De cada contacto van los datos de esas etiquetas y los sin etiqueta (la regla de siempre), con su foto.
 * - Google y Outlook son solo para consultar: lo que se cambie allí se pisa en la siguiente sincronización.
 * - Quitar la marca de la etiqueta, quitar la etiqueta al contacto o borrarlo lo borra de Google.
 *   Solo se tocan los contactos y grupos creados por Agendario, nunca los que ya tenía la cuenta.
 * - Cada etiqueta sincronizada es un grupo («etiqueta») de Google Contactos con el mismo nombre.
 *
 * La app de Google (ID y secreto) la pone el administrador en Ajustes y se guarda en settings («gmail.app»);
 * la autorización de cada usuario en «gmail.user.<id>». Ni el secreto ni los tokens se devuelven nunca a la web.
 * Se autoriza con redirección (la People API no admite el flujo de «código de dispositivo» que usamos con Drive).
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Address, GmailStatus, LabeledValue, TagLite } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { canReadSql } from "./access.js";
import { itemTagsFor } from "./items.js";
import { readPhoto } from "./photos.js";
import { deleteSetting, getSetting, setSetting } from "./settings.js";
import { expandTagIds, tagsForContacts } from "./tags.js";
import { exportedItems } from "./sync.js";

// Se pueden cambiar solo para pruebas (servidor simulado)
const API = (process.env.GMAIL_API_URL || "https://people.googleapis.com/v1").replace(/\/+$/, "");
const TOKEN_URL = process.env.GMAIL_TOKEN_URL || "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = "https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/userinfo.email";
/** Pausa entre escrituras: la People API limita las escrituras por minuto y usuario */
const WRITE_GAP_MS = Number(process.env.GMAIL_WRITE_GAP_MS ?? 700);

const c = schema.contacts;
const gl = schema.gmailLinks;
type ContactRow = typeof c.$inferSelect;

// ---------------------------------------------------------------------------
// Configuración guardada
// ---------------------------------------------------------------------------

interface GmailApp {
  clientId: string;
  clientSecret: string;
}
interface GmailUser {
  refreshToken: string | null;
  email: string | null;
  tagIds: string[];
  /** id de etiqueta → «contactGroups/…» creado por Agendario */
  groups: Record<string, string>;
  lastSyncAt: string | null;
  lastError: string | null;
  lastResult: { created: number; updated: number; deleted: number } | null;
}

const APP_KEY = "gmail.app";
const userKey = (id: string) => `gmail.user.${id}`;
const emptyUser = (): GmailUser => ({ refreshToken: null, email: null, tagIds: [], groups: {}, lastSyncAt: null, lastError: null, lastResult: null });

export const loadApp = () => getSetting<GmailApp | null>(APP_KEY, null);
export const saveApp = (a: GmailApp) => setSetting(APP_KEY, a);
export const loadUser = async (id: string) => ({ ...emptyUser(), ...(await getSetting<Partial<GmailUser> | null>(userKey(id), null)) });
const saveUser = (id: string, u: GmailUser) => setSetting(userKey(id), u);

export class GmailError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

const running = new Set<string>();

export async function statusOf(userId: string): Promise<GmailStatus> {
  const [app, u] = await Promise.all([loadApp(), loadUser(userId)]);
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(gl).where(eq(gl.userId, userId));
  return {
    appConfigured: !!(app?.clientId && app.clientSecret),
    appClientId: app?.clientId ?? "",
    connected: !!u.refreshToken,
    email: u.email,
    tagIds: u.tagIds,
    linked: Number(n ?? 0),
    lastSyncAt: u.lastSyncAt,
    lastError: u.lastError,
    lastResult: u.lastResult,
    running: running.has(userId),
  };
}

// ---------------------------------------------------------------------------
// Autorización (OAuth con redirección)
// ---------------------------------------------------------------------------

const pending = new Map<string, { userId: string; redirectUri: string; at: number }>();

/** Dirección de Google a la que se manda al usuario para dar permiso. */
export async function authUrl(userId: string, origin: string): Promise<string> {
  const app = await loadApp();
  if (!app?.clientId || !app.clientSecret) throw new GmailError("Falta configurar la app de Google (ID y secreto) en Ajustes → Sincronización");
  if (!/^https?:\/\/[^\s/]+$/.test(origin)) throw new GmailError("Dirección de Agendario no válida");
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60_000) pending.delete(k);
  const state = randomBytes(24).toString("base64url");
  const redirectUri = `${origin}/api/gmail/callback`;
  pending.set(state, { userId, redirectUri, at: Date.now() });
  const q = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent", // para que Google entregue siempre el refresh_token
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${q}`;
}

/** Vuelta de Google: cambia el código por los tokens y guarda la conexión. Devuelve el usuario. */
export async function finishAuth(state: string, code: string): Promise<string> {
  const p = pending.get(state);
  pending.delete(state);
  if (!p || Date.now() - p.at > 15 * 60_000) throw new GmailError("La autorización ha caducado: vuelve a pulsar «Conectar»");
  const app = await loadApp();
  if (!app) throw new GmailError("Falta configurar la app de Google");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: p.redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new GmailError("No se puede contactar con Google. ¿El servidor tiene salida a internet?");
  });
  const t = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !t.access_token) throw new GmailError(`Google no ha aceptado la autorización${t.error_description ? `: ${t.error_description}` : ""}`);
  if (!t.refresh_token) throw new GmailError("Google no ha dado permiso permanente. Quita el acceso de Agendario en tu cuenta de Google (Seguridad → Apps de terceros) y vuelve a conectar.");
  let email: string | null = null;
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(10_000) });
    email = ((await r.json()) as { email?: string }).email ?? null;
  } catch {
    /* sin correo: no es imprescindible */
  }
  const u = await loadUser(p.userId);
  // Otra cuenta distinta: lo enlazado era de la anterior
  if (u.email && email && u.email !== email) {
    await db.delete(gl).where(eq(gl.userId, p.userId));
    u.groups = {};
  }
  tokens.set(p.userId, { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000 });
  await saveUser(p.userId, { ...u, refreshToken: t.refresh_token, email, lastError: null });
  return p.userId;
}

/** Desconectar. Con `removeFromGoogle`, antes se borran de Google los contactos y grupos creados por Agendario. */
export async function disconnect(userId: string, removeFromGoogle: boolean) {
  const u = await loadUser(userId);
  if (removeFromGoogle && u.refreshToken) {
    const links = await db.select().from(gl).where(eq(gl.userId, userId));
    for (const l of links) {
      await call(userId, "DELETE", `/${l.resourceName}:deleteContact`).catch(ignore404);
      await gap();
    }
    for (const g of Object.values(u.groups)) await call(userId, "DELETE", `/${g}?deleteContacts=false`).catch(ignore404);
  }
  // Se intenta retirar el permiso en Google (si falla, se puede quitar a mano en la cuenta)
  if (u.refreshToken) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(u.refreshToken)}`, { method: "POST" }).catch(() => undefined);
  await db.delete(gl).where(eq(gl.userId, userId));
  tokens.delete(userId);
  await saveUser(userId, { ...emptyUser(), tagIds: u.tagIds });
}

/** Al quitar la app de Google: se desconecta a todos (sus tokens ya no servirían). */
export async function forgetAll() {
  const rows = await db.select({ key: schema.settings.key }).from(schema.settings);
  for (const k of rows.map((r) => r.key).filter((k) => k.startsWith("gmail.user."))) {
    const id = k.slice("gmail.user.".length);
    const u = await loadUser(id);
    await saveUser(id, { ...emptyUser(), tagIds: u.tagIds });
  }
  await db.delete(gl);
  tokens.clear();
  await deleteSetting(APP_KEY);
}

export async function setTags(userId: string, tagIds: string[]) {
  const u = await loadUser(userId);
  await saveUser(userId, { ...u, tagIds: [...new Set(tagIds)] });
  if (u.refreshToken) kick(userId, 3_000);
}

// ---------------------------------------------------------------------------
// Llamadas a la People API
// ---------------------------------------------------------------------------

const tokens = new Map<string, { token: string; exp: number }>();
const gap = () => new Promise((r) => setTimeout(r, WRITE_GAP_MS));
const ignore404 = (e: unknown) => {
  if (!(e instanceof GmailError && e.status === 404)) throw e;
};

async function accessToken(userId: string): Promise<string> {
  const cached = tokens.get(userId);
  if (cached && cached.exp > Date.now()) return cached.token;
  const [app, u] = await Promise.all([loadApp(), loadUser(userId)]);
  if (!app || !u.refreshToken) throw new GmailError("Gmail no está conectado");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, refresh_token: u.refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new GmailError("No se puede contactar con Google");
  });
  const t = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !t.access_token) {
    if (t.error === "invalid_grant") throw new GmailError("Google ha retirado el permiso (¿la app sigue «en pruebas» o se quitó el acceso?). Vuelve a conectar la cuenta.", 401);
    throw new GmailError("Google no renueva el permiso de acceso");
  }
  tokens.set(userId, { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000 });
  return t.access_token;
}

async function call<T = unknown>(userId: string, method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
  const token = await accessToken(userId);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new GmailError("No se puede conectar con Google");
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const wait = Number(res.headers.get("retry-after")) * 1000 || 2 ** attempt * 4000;
    await new Promise((r) => setTimeout(r, wait));
    return call<T>(userId, method, path, body, attempt + 1);
  }
  if (res.status === 401) {
    tokens.delete(userId);
    if (attempt === 0) return call<T>(userId, method, path, body, 1);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = "";
    try {
      msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      /* sin detalle */
    }
    if (res.status === 403 && /People API has not been used|is disabled/i.test(msg)) throw new GmailError("La People API no está activada en tu proyecto de Google Cloud (APIs y servicios → Biblioteca → People API → Habilitar)", 403);
    throw new GmailError(res.status === 404 ? "No existe en Google" : `Google ha respondido con un error (${res.status})${msg ? `: ${msg}` : ""}`, res.status);
  }
  return (text ? JSON.parse(text) : null) as T;
}

// ---------------------------------------------------------------------------
// Contacto de Agendario → persona de la People API
// ---------------------------------------------------------------------------

/** Etiquetas de Agendario con tipo estándar en Google; las demás van con su texto. */
const stdType: Record<string, string> = { móvil: "mobile", movil: "mobile", casa: "home", trabajo: "work", otro: "other", principal: "main", fax: "workFax", personal: "home" };
const typeOf = (label: string) => stdType[label.trim().toLowerCase()] ?? (label.trim() || "other");

type Items = { phones: LabeledValue[]; emails: LabeledValue[]; urls: LabeledValue[]; addresses: Address[] };

function personOf(row: ContactRow, items: Items, groupNames: string[]) {
  const given = row.givenName.trim();
  const family = row.familyName.trim();
  const person: Record<string, unknown> = {
    names: [given || family ? { givenName: given, familyName: family } : { givenName: row.displayName.trim() || row.organization.trim() || "Sin nombre" }],
    nicknames: row.nickname.trim() ? [{ value: row.nickname.trim() }] : [],
    organizations: row.organization.trim() || row.jobTitle.trim() ? [{ name: row.organization.trim(), title: row.jobTitle.trim() }] : [],
    phoneNumbers: items.phones.filter((p) => p.value.trim()).map((p) => ({ value: p.value.trim(), type: typeOf(p.label) })),
    emailAddresses: items.emails.filter((e) => e.value.trim()).map((e) => ({ value: e.value.trim(), type: typeOf(e.label) })),
    urls: items.urls.filter((u) => u.value.trim()).map((u) => ({ value: u.value.trim(), type: typeOf(u.label) })),
    addresses: items.addresses.map((a) => ({
      streetAddress: a.street,
      city: a.city,
      region: a.region,
      postalCode: a.postalCode,
      country: a.country,
      type: typeOf(a.label),
    })),
    biographies: row.notes.trim() ? [{ value: row.notes.trim(), contentType: "TEXT_PLAIN" }] : [],
    birthdays: [],
  };
  const b = row.birthday?.match(/^(\d{4}|--)-?(\d{2})-(\d{2})$/);
  if (b) person.birthdays = [{ date: { ...(b[1] !== "--" ? { year: Number(b[1]) } : {}), month: Number(b[2]), day: Number(b[3]) } }];
  return { person, hash: createHash("sha256").update(JSON.stringify(person)).update(`|groups:${groupNames.sort().join(",")}`).digest("hex").slice(0, 32) };
}
const FIELDS = "names,nicknames,organizations,phoneNumbers,emailAddresses,urls,addresses,biographies,birthdays,memberships";

// ---------------------------------------------------------------------------
// Sincronizar
// ---------------------------------------------------------------------------

type Person = { resourceName: string; etag: string };

/** Nombre del grupo en Google: la ruta de la etiqueta («Familia › Primos»). */
function tagPath(id: string, byId: Map<string, { name: string; parentId: string | null }>) {
  const parts: string[] = [];
  let cur = byId.get(id);
  for (let i = 0; cur && i < 10; i++) {
    parts.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(" › ");
}

/** Crea, renombra o borra los grupos de Google de las etiquetas sincronizadas. */
async function syncGroups(userId: string, u: GmailUser, wanted: Map<string, string>) {
  type Group = { resourceName: string; etag: string; name: string; groupType?: string };
  const list = await call<{ contactGroups?: Group[] }>(userId, "GET", "/contactGroups?pageSize=1000&groupFields=name,groupType");
  const remote = new Map((list.contactGroups ?? []).map((g) => [g.resourceName, g]));
  const out: Record<string, string> = {};
  for (const [tagId, name] of wanted) {
    const mine = u.groups[tagId] ? remote.get(u.groups[tagId]!) : undefined;
    if (mine) {
      if (mine.name !== name) {
        await call(userId, "PUT", `/${mine.resourceName}`, { contactGroup: { name, etag: mine.etag }, updateGroupFields: "name" }).catch(() => undefined);
        await gap();
      }
      out[tagId] = mine.resourceName;
      continue;
    }
    // ¿Ya hay un grupo con ese nombre (p. ej. de una conexión anterior)? Se reutiliza
    const same = [...remote.values()].find((g) => g.groupType === "USER_CONTACT_GROUP" && g.name === name);
    if (same) {
      out[tagId] = same.resourceName;
      continue;
    }
    const g = await call<Group>(userId, "POST", "/contactGroups", { contactGroup: { name } });
    out[tagId] = g.resourceName;
    await gap();
  }
  // Etiquetas que ya no se sincronizan: se borra su grupo (sin borrar contactos)
  for (const [tagId, rn] of Object.entries(u.groups)) {
    if (out[tagId] || !remote.has(rn) || Object.values(out).includes(rn)) continue;
    await call(userId, "DELETE", `/${rn}?deleteContacts=false`).catch(ignore404);
    await gap();
  }
  return out;
}

async function photoBytes(key: string): Promise<string | null> {
  try {
    return Buffer.from(await readPhoto(key, "full")).toString("base64");
  } catch {
    return null;
  }
}

async function doSync(userId: string): Promise<{ created: number; updated: number; deleted: number }> {
  const u = await loadUser(userId);
  if (!u.refreshToken) throw new GmailError("Gmail no está conectado");
  const result = { created: 0, updated: 0, deleted: 0 };

  // Qué entra: contactos visibles para el usuario con alguna de sus etiquetas marcadas (o subetiquetas)
  const allTags = await db.select({ id: schema.tags.id, name: schema.tags.name, parentId: schema.tags.parentId }).from(schema.tags).where(eq(schema.tags.userId, userId));
  const tagById = new Map(allTags.map((t) => [t.id, t]));
  const selected = u.tagIds.filter((id) => tagById.has(id));
  const tagIds = new Set(await expandTagIds(userId, selected));
  const rows = tagIds.size ? await db.select().from(c).where(and(isNull(c.deletedAt), canReadSql(userId))) : [];
  const tagMap = await tagsForContacts(rows.map((r) => r.id), userId);
  const inScope = rows.filter((r) => (tagMap.get(r.id) ?? []).some((t) => tagIds.has(t.id)));
  const itemTags = await itemTagsFor(inScope.map((r) => r.id), userId);

  // Grupos: uno por etiqueta sincronizada y por cada subetiqueta que tengan los contactos
  const usedTagIds = new Set<string>();
  for (const r of inScope) for (const t of tagMap.get(r.id) ?? []) if (tagIds.has(t.id)) usedTagIds.add(t.id);
  const wanted = new Map([...usedTagIds].map((id) => [id, tagPath(id, tagById)]));
  u.groups = await syncGroups(userId, u, wanted);
  await saveUser(userId, u);

  const links = new Map((await db.select().from(gl).where(eq(gl.userId, userId))).map((l) => [l.contactId, l]));
  const keep = new Set<string>();

  for (const row of inScope) {
    keep.add(row.id);
    const items = exportedItems(row, itemTags.get(row.id) as Record<string, TagLite> | undefined, tagIds);
    const myTags = (tagMap.get(row.id) ?? []).filter((t) => tagIds.has(t.id));
    const groupRns = myTags.map((t) => u.groups[t.id]).filter((x): x is string => !!x);
    const { person, hash } = personOf(row, items, groupRns);
    person.memberships = [{ contactGroupMembership: { contactGroupResourceName: "contactGroups/myContacts" } }, ...groupRns.map((rn) => ({ contactGroupMembership: { contactGroupResourceName: rn } }))];
    const link = links.get(row.id);
    const photoKey = row.photoKey ?? "";
    let target: Person | null = null;

    if (link && link.hash === hash && link.photoKey === photoKey) continue; // sin cambios

    if (link && link.hash !== hash) {
      try {
        target = await call<Person>(userId, "PATCH", `/${link.resourceName}:updateContact?updatePersonFields=${FIELDS}&personFields=metadata`, { ...person, etag: link.etag });
      } catch (e) {
        if (e instanceof GmailError && e.status === 400) {
          // etag antiguo (lo cambiaron en Google): se lee el actual y se pisa
          const cur = await call<Person>(userId, "GET", `/${link.resourceName}?personFields=metadata`).catch(() => null);
          if (cur) target = await call<Person>(userId, "PATCH", `/${link.resourceName}:updateContact?updatePersonFields=${FIELDS}&personFields=metadata`, { ...person, etag: cur.etag });
        } else if (!(e instanceof GmailError && e.status === 404)) throw e;
      }
      if (target) result.updated++;
    } else if (link) {
      target = { resourceName: link.resourceName, etag: link.etag };
    }
    if (!target) {
      // Nuevo (o lo borraron en Google): se crea
      target = await call<Person>(userId, "POST", `/people:createContact?personFields=metadata`, person);
      result.created++;
      await db.delete(gl).where(and(eq(gl.userId, userId), eq(gl.contactId, row.id)));
      await db.insert(gl).values({ userId, contactId: row.id, resourceName: target.resourceName, etag: target.etag, hash: "", photoKey: "" });
    }
    await gap();

    // Foto
    let etag = target.etag;
    const prevPhoto = link && link.resourceName === target.resourceName ? link.photoKey : "";
    if (photoKey !== prevPhoto) {
      if (photoKey) {
        const bytes = await photoBytes(photoKey);
        if (bytes) {
          const r = await call<{ person?: Person }>(userId, "PATCH", `/${target.resourceName}:updateContactPhoto`, { photoBytes: bytes, personFields: "metadata" }).catch(() => null);
          if (r?.person?.etag) etag = r.person.etag;
        }
      } else if (prevPhoto) {
        const r = await call<{ person?: Person }>(userId, "DELETE", `/${target.resourceName}:deleteContactPhoto?personFields=metadata`).catch(() => null);
        if (r?.person?.etag) etag = r.person.etag;
      }
      await gap();
    }
    await db
      .update(gl)
      .set({ resourceName: target.resourceName, etag, hash, photoKey, updatedAt: new Date() })
      .where(and(eq(gl.userId, userId), eq(gl.contactId, row.id)));
  }

  // Fuera de la sincronización (sin la etiqueta, borrado o etiqueta desmarcada): se borra de Google
  for (const l of links.values()) {
    if (keep.has(l.contactId)) continue;
    await call(userId, "DELETE", `/${l.resourceName}:deleteContact`).catch(ignore404);
    await db.delete(gl).where(and(eq(gl.userId, userId), eq(gl.contactId, l.contactId)));
    result.deleted++;
    await gap();
  }
  // Grupos de etiquetas que ya no tienen a nadie: syncGroups los quita en la siguiente vuelta
  return result;
}

/** Sincroniza un usuario (si no está ya en marcha). Apunta el resultado o el error en su configuración. */
export async function runSync(userId: string) {
  if (running.has(userId)) return null;
  running.add(userId);
  try {
    const result = await doSync(userId);
    const u = await loadUser(userId);
    await saveUser(userId, { ...u, lastSyncAt: new Date().toISOString(), lastError: null, lastResult: result });
    return result;
  } catch (e) {
    const u = await loadUser(userId);
    const msg = e instanceof GmailError ? e.message : "Error inesperado al sincronizar con Gmail";
    if (!(e instanceof GmailError)) console.error("[gmail]", e);
    await saveUser(userId, { ...u, lastSyncAt: new Date().toISOString(), lastError: msg });
    throw e;
  } finally {
    running.delete(userId);
  }
}

// ---------------------------------------------------------------------------
// Programador: cada 15 minutos y, poco después de cada cambio, solo lo cambiado
// ---------------------------------------------------------------------------

const timers = new Map<string, NodeJS.Timeout>();

/** Programa una sincronización en breve (agrupa varios cambios seguidos). */
export function kick(userId: string, delay = 60_000) {
  clearTimeout(timers.get(userId));
  timers.set(
    userId,
    setTimeout(() => {
      timers.delete(userId);
      void runSync(userId).catch(() => undefined);
    }, delay).unref(),
  );
}

async function connectedUsers() {
  const rows = await db.select({ key: schema.settings.key }).from(schema.settings);
  const out: string[] = [];
  for (const k of rows.map((r) => r.key).filter((k) => k.startsWith("gmail.user."))) {
    const id = k.slice("gmail.user.".length);
    if ((await loadUser(id)).refreshToken) out.push(id);
  }
  return out;
}

/** Tras cambiar un contacto: avisa a los usuarios conectados (la sincronización solo envía lo que cambie). */
export async function kickAll() {
  try {
    for (const id of await connectedUsers()) kick(id);
  } catch {
    /* sin importancia: lo recoge el programador */
  }
}

export function startGmailScheduler() {
  const tick = async () => {
    try {
      for (const id of await connectedUsers()) await runSync(id).catch(() => undefined);
    } catch (e) {
      console.error("[gmail] programador", e);
    }
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 15 * 60_000).unref();
}
