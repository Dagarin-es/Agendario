/**
 * Sincronización de contactos con cuentas de Google (Gmail) — solo en un sentido: Agendario → Google.
 *
 * Para qué: ver esos contactos en el nuevo Outlook (que no admite CardDAV) añadiendo allí la cuenta de Gmail.
 *
 * Reglas (acordadas con Daniel):
 * - Cada usuario puede conectar varias cuentas de Google (1.3.1). En Etiquetas elige a qué cuenta o cuentas
 *   va cada etiqueta (una etiqueta puede ir a varias); las subetiquetas entran solas.
 * - De cada contacto van los datos de esas etiquetas y los sin etiqueta (la regla de siempre), con su foto.
 * - Google y Outlook son solo para consultar: lo que se cambie allí se pisa en la siguiente sincronización.
 * - Quitar la etiqueta de la cuenta, quitar la etiqueta al contacto o borrarlo lo borra de esa cuenta.
 *   Solo se tocan los contactos y grupos creados por Agendario, nunca los que ya tenía la cuenta.
 * - Cada etiqueta sincronizada es un grupo («etiqueta») de Google Contactos con el mismo nombre.
 * - Fotos desde Google (1.3.1): a los contactos de Agendario sin foto se les pone la de Google (de un contacto
 *   que ya tuviera la cuenta o de la foto de perfil de la persona), emparejando por email o teléfono. Nunca se
 *   sustituye una foto y, si se quita una que vino de Google, no se vuelve a traer.
 *
 * La app de Google (ID y secreto) la pone el administrador en Ajustes y se guarda en settings («gmail.app»);
 * las cuentas de cada usuario en «gmail.accounts.<id>» (antes de la 1.3.1, una sola en «gmail.user.<id>»,
 * que se convierte sola en la cuenta «main»). Ni el secreto ni los tokens se devuelven nunca a la web.
 * Se autoriza con redirección (la People API no admite el flujo de «código de dispositivo» que usamos con Drive).
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Address, GmailAccountStatus, GmailStatus, LabeledValue, TagLite } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { canEditSql, canReadSql, touchContact } from "./access.js";
import { recordHistory } from "./history.js";
import { itemTagsFor } from "./items.js";
import { deletePhoto, MAX_UPLOAD_BYTES, readPhoto, savePhoto } from "./photos.js";
import { phoneKey } from "./reminders.js";
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
interface GmailAccount {
  id: string;
  refreshToken: string | null;
  email: string | null;
  tagIds: string[];
  /** id de etiqueta → «contactGroups/…» creado por Agendario */
  groups: Record<string, string>;
  lastSyncAt: string | null;
  lastError: string | null;
  lastResult: { created: number; updated: number; deleted: number } | null;
  photosAt: string | null;
  photosAdded: number | null;
  photosError: string | null;
}
/** Una cuenta concreta de un usuario */
export type AccountRef = { userId: string; accId: string };

const APP_KEY = "gmail.app";
const LEGACY_ID = "main";
const accountsKey = (id: string) => `gmail.accounts.${id}`;
const legacyKey = (id: string) => `gmail.user.${id}`;
/** Contactos a los que ya se trajo una foto de Google (no se vuelve a traer aunque se quite): id → foto */
const IMPORTED_KEY = "gmail.photosImported";
const refKey = (r: AccountRef) => `${r.userId}/${r.accId}`;

const fill = (a: Partial<GmailAccount> & { id: string }): GmailAccount => ({
  refreshToken: null,
  email: null,
  tagIds: [],
  groups: {},
  lastSyncAt: null,
  lastError: null,
  lastResult: null,
  photosAt: null,
  photosAdded: null,
  photosError: null,
  ...a,
});

export const loadApp = () => getSetting<GmailApp | null>(APP_KEY, null);
export const saveApp = (a: GmailApp) => setSetting(APP_KEY, a);

/** Cuentas del usuario. La conexión única de la 1.3.0 se convierte aquí en la cuenta «main». */
export async function loadAccounts(userId: string): Promise<GmailAccount[]> {
  const list = await getSetting<GmailAccount[] | null>(accountsKey(userId), null);
  if (list) return list.map(fill);
  const legacy = await getSetting<Partial<GmailAccount> | null>(legacyKey(userId), null);
  if (!legacy) return [];
  const out = legacy.refreshToken || legacy.tagIds?.length ? [fill({ ...legacy, id: LEGACY_ID })] : [];
  await setSetting(accountsKey(userId), out);
  await deleteSetting(legacyKey(userId));
  return out;
}
const saveAccounts = (userId: string, list: GmailAccount[]) => setSetting(accountsKey(userId), list);

async function getAccount(r: AccountRef) {
  const a = (await loadAccounts(r.userId)).find((x) => x.id === r.accId);
  if (!a) throw new GmailError("Esa cuenta de Google ya no está en Agendario", 404);
  return a;
}

/** Cambia una cuenta leyendo antes la lista recién guardada (para no pisar cambios hechos entretanto). */
async function updateAccount(r: AccountRef, fn: (a: GmailAccount) => void) {
  const list = await loadAccounts(r.userId);
  const a = list.find((x) => x.id === r.accId);
  if (!a) return;
  fn(a);
  await saveAccounts(r.userId, list);
}

export class GmailError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

const running = new Set<string>();

export async function statusOf(userId: string): Promise<GmailStatus> {
  const [app, list] = await Promise.all([loadApp(), loadAccounts(userId)]);
  const counts = await db
    .select({ acc: gl.accountId, n: sql<number>`count(*)::int` })
    .from(gl)
    .where(eq(gl.userId, userId))
    .groupBy(gl.accountId);
  const byAcc = new Map(counts.map((x) => [x.acc, Number(x.n ?? 0)]));
  const accounts: GmailAccountStatus[] = list.map((a) => ({
    id: a.id,
    email: a.email,
    connected: !!a.refreshToken,
    tagIds: a.tagIds,
    linked: byAcc.get(a.id) ?? 0,
    lastSyncAt: a.lastSyncAt,
    lastError: a.lastError,
    lastResult: a.lastResult,
    running: running.has(refKey({ userId, accId: a.id })),
    photosAt: a.photosAt,
    photosAdded: a.photosAdded,
    photosError: a.photosError,
  }));
  const first = accounts[0];
  return {
    appConfigured: !!(app?.clientId && app.clientSecret),
    appClientId: app?.clientId ?? "",
    accounts,
    connected: first?.connected ?? false,
    email: first?.email ?? null,
    tagIds: first?.tagIds ?? [],
    linked: first?.linked ?? 0,
    lastSyncAt: first?.lastSyncAt ?? null,
    lastError: first?.lastError ?? null,
    lastResult: first?.lastResult ?? null,
    running: first?.running ?? false,
  };
}

// ---------------------------------------------------------------------------
// Autorización (OAuth con redirección)
// ---------------------------------------------------------------------------

const pending = new Map<string, { userId: string; accId: string | null; redirectUri: string; at: number }>();

/**
 * Dirección de Google a la que se manda al usuario para dar permiso.
 * Sin `accId` se añade una cuenta nueva; con él, se vuelve a conectar esa.
 */
export async function authUrl(userId: string, origin: string, accId: string | null = null): Promise<string> {
  const app = await loadApp();
  if (!app?.clientId || !app.clientSecret) throw new GmailError("Falta configurar la app de Google (ID y secreto) en Ajustes → Sincronización");
  if (!/^https?:\/\/[^\s/]+$/.test(origin)) throw new GmailError("Dirección de Agendario no válida");
  if (accId) await getAccount({ userId, accId });
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60_000) pending.delete(k);
  const state = randomBytes(24).toString("base64url");
  const redirectUri = `${origin}/api/gmail/callback`;
  pending.set(state, { userId, accId, redirectUri, at: Date.now() });
  const q = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // Elegir cuenta (para poder añadir otra distinta) y pedir permiso siempre (para que Google dé el refresh_token)
    prompt: "select_account consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${q}`;
}

/** Vuelta de Google: cambia el código por los tokens y guarda la cuenta. */
export async function finishAuth(state: string, code: string): Promise<AccountRef> {
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
    const r = await fetch(process.env.GMAIL_USERINFO_URL || "https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${t.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    email = ((await r.json()) as { email?: string }).email ?? null;
  } catch {
    /* sin correo: no es imprescindible */
  }

  const list = await loadAccounts(p.userId);
  // 1) Esa dirección ya estaba: se renueva su permiso (no se duplica)
  // 2) Se estaba reconectando una cuenta sin dirección conocida o con la misma: esa
  // 3) Si no: cuenta nueva
  let acc =
    (email ? list.find((a) => a.email?.toLowerCase() === email!.toLowerCase()) : undefined) ??
    (p.accId ? list.find((a) => a.id === p.accId && (!a.email || !email)) : undefined);
  if (!acc) {
    acc = fill({ id: randomBytes(6).toString("hex") });
    list.push(acc);
  }
  acc.refreshToken = t.refresh_token;
  acc.email = email ?? acc.email;
  acc.lastError = null;
  await saveAccounts(p.userId, list);
  const ref = { userId: p.userId, accId: acc.id };
  tokens.set(refKey(ref), { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000 });
  return ref;
}

/** Quitar una cuenta. Con `removeFromGoogle`, antes se borran de Google los contactos y grupos creados por Agendario. */
export async function disconnect(r: AccountRef, removeFromGoogle: boolean) {
  const a = await getAccount(r);
  const mine = and(eq(gl.userId, r.userId), eq(gl.accountId, r.accId));
  if (removeFromGoogle && a.refreshToken) {
    const links = await db.select().from(gl).where(mine);
    for (const l of links) {
      await call(r, "DELETE", `/${l.resourceName}:deleteContact`).catch(ignore404);
      await gap();
    }
    for (const g of Object.values(a.groups)) await call(r, "DELETE", `/${g}?deleteContacts=false`).catch(ignore404);
  }
  // Se intenta retirar el permiso en Google (si falla, se puede quitar a mano en la cuenta)
  if (a.refreshToken) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(a.refreshToken)}`, { method: "POST" }).catch(() => undefined);
  await db.delete(gl).where(mine);
  tokens.delete(refKey(r));
  const list = await loadAccounts(r.userId);
  await saveAccounts(
    r.userId,
    list.filter((x) => x.id !== r.accId),
  );
}

/** Al quitar la app de Google: se desconecta a todos (sus tokens ya no servirían); se conservan sus etiquetas. */
export async function forgetAll() {
  await migrateLegacy();
  const rows = await db.select({ key: schema.settings.key }).from(schema.settings);
  for (const k of rows.map((r) => r.key).filter((k) => k.startsWith("gmail.accounts."))) {
    const id = k.slice("gmail.accounts.".length);
    const list = await loadAccounts(id);
    await saveAccounts(
      id,
      list.map((a) => ({ ...a, refreshToken: null, groups: {} })),
    );
  }
  await db.delete(gl);
  tokens.clear();
  await deleteSetting(APP_KEY);
}

/** Etiquetas de una cuenta. Sin cuenta: la primera (lo que hacía la web de la 1.3.0). */
export async function setTags(userId: string, accId: string | undefined, tagIds: string[]) {
  const list = await loadAccounts(userId);
  const a = accId ? list.find((x) => x.id === accId) : list[0];
  if (!a) throw new GmailError("Primero conecta una cuenta de Google en Ajustes → Sincronización");
  a.tagIds = [...new Set(tagIds)];
  await saveAccounts(userId, list);
  if (a.refreshToken) kick({ userId, accId: a.id }, 3_000);
}

/** A qué cuentas va una etiqueta (desde la página Etiquetas). */
export async function setTagAccounts(userId: string, tagId: string, accIds: string[]) {
  const list = await loadAccounts(userId);
  const want = new Set(accIds);
  for (const a of list) {
    const has = a.tagIds.includes(tagId);
    if (want.has(a.id) === has) continue;
    a.tagIds = want.has(a.id) ? [...a.tagIds, tagId] : a.tagIds.filter((x) => x !== tagId);
    if (a.refreshToken) kick({ userId, accId: a.id }, 3_000);
  }
  await saveAccounts(userId, list);
}

/** Pasa todas las etiquetas de una cuenta a otra (p. ej. al sustituir una cuenta por otra). */
export async function moveTags(userId: string, fromId: string, toId: string) {
  if (fromId === toId) throw new GmailError("Elige otra cuenta");
  const list = await loadAccounts(userId);
  const from = list.find((x) => x.id === fromId);
  const to = list.find((x) => x.id === toId);
  if (!from || !to) throw new GmailError("Esa cuenta de Google ya no está en Agendario", 404);
  const moved = from.tagIds.length;
  to.tagIds = [...new Set([...to.tagIds, ...from.tagIds])];
  from.tagIds = [];
  await saveAccounts(userId, list);
  if (to.refreshToken) kick({ userId, accId: to.id }, 3_000);
  if (from.refreshToken) kick({ userId, accId: from.id }, 3_000);
  return moved;
}

// ---------------------------------------------------------------------------
// Llamadas a la People API
// ---------------------------------------------------------------------------

const tokens = new Map<string, { token: string; exp: number }>();
const gap = () => new Promise((r) => setTimeout(r, WRITE_GAP_MS));
const ignore404 = (e: unknown) => {
  if (!(e instanceof GmailError && e.status === 404)) throw e;
};

async function accessToken(r: AccountRef): Promise<string> {
  const cached = tokens.get(refKey(r));
  if (cached && cached.exp > Date.now()) return cached.token;
  const [app, a] = await Promise.all([loadApp(), getAccount(r)]);
  if (!app || !a.refreshToken) throw new GmailError("Esta cuenta de Google no está conectada");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, refresh_token: a.refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new GmailError("No se puede contactar con Google");
  });
  const t = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !t.access_token) {
    if (t.error === "invalid_grant") throw new GmailError("Google ha retirado el permiso (¿la app sigue «en pruebas» o se quitó el acceso?). Vuelve a conectar la cuenta.", 401);
    throw new GmailError("Google no renueva el permiso de acceso");
  }
  tokens.set(refKey(r), { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000 });
  return t.access_token;
}

async function call<T = unknown>(r: AccountRef, method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
  const token = await accessToken(r);
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
    await new Promise((ok) => setTimeout(ok, wait));
    return call<T>(r, method, path, body, attempt + 1);
  }
  if (res.status === 401) {
    tokens.delete(refKey(r));
    if (attempt === 0) return call<T>(r, method, path, body, 1);
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
async function syncGroups(r: AccountRef, a: GmailAccount, wanted: Map<string, string>) {
  type Group = { resourceName: string; etag: string; name: string; groupType?: string };
  const list = await call<{ contactGroups?: Group[] }>(r, "GET", "/contactGroups?pageSize=1000&groupFields=name,groupType");
  const remote = new Map((list.contactGroups ?? []).map((g) => [g.resourceName, g]));
  const out: Record<string, string> = {};
  for (const [tagId, name] of wanted) {
    const mine = a.groups[tagId] ? remote.get(a.groups[tagId]!) : undefined;
    if (mine) {
      if (mine.name !== name) {
        await call(r, "PUT", `/${mine.resourceName}`, { contactGroup: { name, etag: mine.etag }, updateGroupFields: "name" }).catch(() => undefined);
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
    const g = await call<Group>(r, "POST", "/contactGroups", { contactGroup: { name } });
    out[tagId] = g.resourceName;
    await gap();
  }
  // Etiquetas que ya no se sincronizan: se borra su grupo (sin borrar contactos)
  for (const [tagId, rn] of Object.entries(a.groups)) {
    if (out[tagId] || !remote.has(rn) || Object.values(out).includes(rn)) continue;
    await call(r, "DELETE", `/${rn}?deleteContacts=false`).catch(ignore404);
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

async function doSync(r: AccountRef): Promise<{ created: number; updated: number; deleted: number }> {
  const { userId } = r;
  const a = await getAccount(r);
  if (!a.refreshToken) throw new GmailError("Esta cuenta de Google no está conectada");
  const result = { created: 0, updated: 0, deleted: 0 };
  const mine = and(eq(gl.userId, userId), eq(gl.accountId, r.accId));

  // Qué entra: contactos visibles para el usuario con alguna de las etiquetas de esta cuenta (o subetiquetas)
  const allTags = await db.select({ id: schema.tags.id, name: schema.tags.name, parentId: schema.tags.parentId }).from(schema.tags).where(eq(schema.tags.userId, userId));
  const tagById = new Map(allTags.map((t) => [t.id, t]));
  const selected = a.tagIds.filter((id) => tagById.has(id));
  const tagIds = new Set(await expandTagIds(userId, selected));
  const rows = tagIds.size ? await db.select().from(c).where(and(isNull(c.deletedAt), canReadSql(userId))) : [];
  const tagMap = await tagsForContacts(
    rows.map((x) => x.id),
    userId,
  );
  const inScope = rows.filter((x) => (tagMap.get(x.id) ?? []).some((t) => tagIds.has(t.id)));
  const itemTags = await itemTagsFor(
    inScope.map((x) => x.id),
    userId,
  );

  // Grupos: uno por etiqueta sincronizada y por cada subetiqueta que tengan los contactos
  const usedTagIds = new Set<string>();
  for (const x of inScope) for (const t of tagMap.get(x.id) ?? []) if (tagIds.has(t.id)) usedTagIds.add(t.id);
  const wanted = new Map([...usedTagIds].map((id) => [id, tagPath(id, tagById)]));
  const groups = await syncGroups(r, a, wanted);
  await updateAccount(r, (x) => {
    x.groups = groups;
  });

  const links = new Map((await db.select().from(gl).where(mine)).map((l) => [l.contactId, l]));
  const keep = new Set<string>();

  for (const row of inScope) {
    keep.add(row.id);
    const items = exportedItems(row, itemTags.get(row.id) as Record<string, TagLite> | undefined, tagIds);
    const myTags = (tagMap.get(row.id) ?? []).filter((t) => tagIds.has(t.id));
    const groupRns = myTags.map((t) => groups[t.id]).filter((x): x is string => !!x);
    const { person, hash } = personOf(row, items, groupRns);
    person.memberships = [{ contactGroupMembership: { contactGroupResourceName: "contactGroups/myContacts" } }, ...groupRns.map((rn) => ({ contactGroupMembership: { contactGroupResourceName: rn } }))];
    const link = links.get(row.id);
    const photoKey = row.photoKey ?? "";
    let target: Person | null = null;

    if (link && link.hash === hash && link.photoKey === photoKey) continue; // sin cambios

    if (link && link.hash !== hash) {
      try {
        target = await call<Person>(r, "PATCH", `/${link.resourceName}:updateContact?updatePersonFields=${FIELDS}&personFields=metadata`, { ...person, etag: link.etag });
      } catch (e) {
        if (e instanceof GmailError && e.status === 400) {
          // etag antiguo (lo cambiaron en Google): se lee el actual y se pisa
          const cur = await call<Person>(r, "GET", `/${link.resourceName}?personFields=metadata`).catch(() => null);
          if (cur) target = await call<Person>(r, "PATCH", `/${link.resourceName}:updateContact?updatePersonFields=${FIELDS}&personFields=metadata`, { ...person, etag: cur.etag });
        } else if (!(e instanceof GmailError && e.status === 404)) throw e;
      }
      if (target) result.updated++;
    } else if (link) {
      target = { resourceName: link.resourceName, etag: link.etag };
    }
    if (!target) {
      // Nuevo (o lo borraron en Google): se crea
      target = await call<Person>(r, "POST", `/people:createContact?personFields=metadata`, person);
      result.created++;
      await db.delete(gl).where(and(mine, eq(gl.contactId, row.id)));
      await db.insert(gl).values({ userId, accountId: r.accId, contactId: row.id, resourceName: target.resourceName, etag: target.etag, hash: "", photoKey: "" });
    }
    await gap();

    // Foto
    let etag = target.etag;
    const prevPhoto = link && link.resourceName === target.resourceName ? link.photoKey : "";
    if (photoKey !== prevPhoto) {
      if (photoKey) {
        const bytes = await photoBytes(photoKey);
        if (bytes) {
          const res = await call<{ person?: Person }>(r, "PATCH", `/${target.resourceName}:updateContactPhoto`, { photoBytes: bytes, personFields: "metadata" }).catch(() => null);
          if (res?.person?.etag) etag = res.person.etag;
        }
      } else if (prevPhoto) {
        const res = await call<{ person?: Person }>(r, "DELETE", `/${target.resourceName}:deleteContactPhoto?personFields=metadata`).catch(() => null);
        if (res?.person?.etag) etag = res.person.etag;
      }
      await gap();
    }
    await db
      .update(gl)
      .set({ resourceName: target.resourceName, etag, hash, photoKey, updatedAt: new Date() })
      .where(and(mine, eq(gl.contactId, row.id)));
  }

  // Fuera de la sincronización (sin la etiqueta, borrado o etiqueta quitada de la cuenta): se borra de Google
  for (const l of links.values()) {
    if (keep.has(l.contactId)) continue;
    await call(r, "DELETE", `/${l.resourceName}:deleteContact`).catch(ignore404);
    await db.delete(gl).where(and(mine, eq(gl.contactId, l.contactId)));
    result.deleted++;
    await gap();
  }
  // Grupos de etiquetas que ya no tienen a nadie: syncGroups los quita en la siguiente vuelta
  return result;
}

// ---------------------------------------------------------------------------
// Fotos desde Google → contactos de Agendario sin foto
// ---------------------------------------------------------------------------

type GPhoto = { url?: string; default?: boolean; metadata?: { primary?: boolean; source?: { type?: string } } };
type GPerson = { resourceName: string; photos?: GPhoto[]; emailAddresses?: { value?: string }[]; phoneNumbers?: { value?: string; canonicalForm?: string }[] };

const emailKey = (v: string) => `e:${v.trim().toLowerCase()}`;
const phoneKeyOf = (v: string) => {
  const k = phoneKey(v);
  return k.length >= 6 ? `p:${k}` : null;
};
/** La misma foto en otro tamaño cuenta como la misma */
const photoId = (url: string) => url.replace(/=[swhc0-9-]+$/, "");

/** Solo se descargan fotos de los servidores de Google (o del simulado en pruebas). */
function allowedPhotoUrl(url: string) {
  try {
    const u = new URL(url);
    if (process.env.GMAIL_API_URL && url.startsWith(new URL(process.env.GMAIL_API_URL).origin)) return true;
    return u.protocol === "https:" && /(^|\.)(googleusercontent\.com|ggpht\.com)$/.test(u.hostname);
  } catch {
    return false;
  }
}

async function downloadPhoto(r: AccountRef, url: string): Promise<Buffer | null> {
  if (!allowedPhotoUrl(url)) return null;
  // Las fotos de Google llevan el tamaño al final («=s100»): se pide grande
  const big = /=s\d+(-c)?$/.test(url) ? url.replace(/=s\d+(-c)?$/, "=s1024") : url;
  for (const auth of [false, true]) {
    try {
      const headers: Record<string, string> = auth ? { Authorization: `Bearer ${await accessToken(r)}` } : {};
      const res = await fetch(big, { headers, signal: AbortSignal.timeout(20_000), redirect: "follow" });
      if (res.status === 401 || res.status === 403) continue;
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length > 0 && buf.length <= MAX_UPLOAD_BYTES ? buf : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Busca en una cuenta de Google fotos para los contactos de Agendario que no tienen.
 * Se empareja por email o teléfono; si un contacto de Google encaja con varios de Agendario, o un contacto
 * de Agendario con varias fotos distintas, no se toca.
 */
async function importPhotos(r: AccountRef): Promise<number> {
  const { userId } = r;
  // 1) Personas de Google (con sus fotos, emails y teléfonos)
  const people: GPerson[] = [];
  let pageToken = "";
  for (let i = 0; i < 50; i++) {
    const q = new URLSearchParams({ personFields: "photos,emailAddresses,phoneNumbers", pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
    const page = await call<{ connections?: GPerson[]; nextPageToken?: string }>(r, "GET", `/people/me/connections?${q}`);
    people.push(...(page.connections ?? []));
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  // Contactos que creó Agendario en esta cuenta: su foto de contacto es la nuestra (solo vale la de perfil)
  const ours = new Set((await db.select({ rn: gl.resourceName }).from(gl).where(and(eq(gl.userId, userId), eq(gl.accountId, r.accId)))).map((x) => x.rn));

  // 2) Contactos de Agendario visibles: índice email/teléfono → contactos
  const rows = await db
    .select({ id: c.id, photoKey: c.photoKey, emails: c.emails, phones: c.phones, canEdit: canEditSql(userId) })
    .from(c)
    .where(and(isNull(c.deletedAt), canReadSql(userId)));
  const index = new Map<string, Set<string>>();
  const add = (k: string | null, id: string) => {
    if (!k) return;
    if (!index.has(k)) index.set(k, new Set());
    index.get(k)!.add(id);
  };
  for (const row of rows) {
    for (const e of row.emails ?? []) if (e.value?.trim()) add(emailKey(e.value), row.id);
    for (const p of row.phones ?? []) if (p.value?.trim()) add(phoneKeyOf(p.value), row.id);
  }
  const imported = await getSetting<Record<string, string>>(IMPORTED_KEY, {});
  const candidates = new Set(rows.filter((x) => !x.photoKey && x.canEdit && !imported[x.id]).map((x) => x.id));

  // 3) Emparejar
  const found = new Map<string, Set<string>>(); // contacto → urls de foto
  for (const p of people) {
    const real = (p.photos ?? []).filter((ph) => ph.url && !ph.default);
    const contactPhoto = ours.has(p.resourceName) ? undefined : real.find((ph) => ph.metadata?.source?.type === "CONTACT");
    const photo = contactPhoto ?? real.find((ph) => ph.metadata?.source?.type === "PROFILE");
    if (!photo?.url) continue;
    const matched = new Set<string>();
    for (const e of p.emailAddresses ?? []) if (e.value) for (const id of index.get(emailKey(e.value)) ?? []) matched.add(id);
    for (const ph of p.phoneNumbers ?? []) {
      const k = phoneKeyOf(ph.canonicalForm || ph.value || "");
      if (k) for (const id of index.get(k) ?? []) matched.add(id);
    }
    if (matched.size !== 1) continue; // nadie o varios: mejor no poner una foto equivocada
    const [id] = [...matched];
    if (!candidates.has(id!)) continue;
    if (!found.has(id!)) found.set(id!, new Set());
    found.get(id!)!.add(photo.url);
  }

  // 4) Descargar y guardar
  let added = 0;
  for (const [contactId, urls] of found) {
    const ids = new Set([...urls].map(photoId));
    if (ids.size !== 1) continue;
    const url = [...urls][0]!;
    const buf = await downloadPhoto(r, url);
    if (!buf) continue;
    let key: string;
    try {
      key = await savePhoto(buf);
    } catch {
      continue; // no es una imagen válida
    }
    const [before] = await db.select().from(c).where(eq(c.id, contactId));
    const [after] = await db
      .update(c)
      .set({ photoKey: key })
      .where(and(eq(c.id, contactId), isNull(c.photoKey), isNull(c.deletedAt)))
      .returning();
    if (!after || !before) {
      await deletePhoto(key); // le han puesto foto entretanto
      continue;
    }
    await recordHistory(db, { contactId, userId, action: "update", before, after, meta: { source: "Foto traída de Google" } });
    await touchContact(contactId);
    const map = await getSetting<Record<string, string>>(IMPORTED_KEY, {});
    map[contactId] = photoId(url);
    await setSetting(IMPORTED_KEY, map);
    added++;
  }
  if (added) void kickAll(); // para que la foto llegue también a las cuentas donde esté el contacto
  return added;
}

async function runPhotos(r: AccountRef) {
  try {
    const added = await importPhotos(r);
    await updateAccount(r, (x) => {
      x.photosAt = new Date().toISOString();
      x.photosAdded = added;
      x.photosError = null;
    });
    return added;
  } catch (e) {
    const msg = e instanceof GmailError ? e.message : "Error inesperado al buscar fotos en Google";
    if (!(e instanceof GmailError)) console.error("[gmail] fotos", e);
    await updateAccount(r, (x) => {
      x.photosAt = new Date().toISOString();
      x.photosError = msg;
    });
    throw e;
  }
}

/**
 * Sincroniza una cuenta (si no está ya en marcha). Apunta el resultado o el error en su configuración.
 * Con `withPhotos`, después busca fotos en esa cuenta (no en cada cambio: en el programador, al conectar y a mano).
 */
export async function runSync(r: AccountRef, withPhotos = false) {
  const k = refKey(r);
  if (running.has(k)) return null;
  running.add(k);
  try {
    let result: Awaited<ReturnType<typeof doSync>>;
    try {
      result = await doSync(r);
      await updateAccount(r, (x) => {
        x.lastSyncAt = new Date().toISOString();
        x.lastError = null;
        x.lastResult = result;
      });
    } catch (e) {
      const msg = e instanceof GmailError ? e.message : "Error inesperado al sincronizar con Gmail";
      if (!(e instanceof GmailError)) console.error("[gmail]", e);
      await updateAccount(r, (x) => {
        x.lastSyncAt = new Date().toISOString();
        x.lastError = msg;
      });
      throw e;
    }
    if (withPhotos) await runPhotos(r).catch(() => undefined);
    return result;
  } finally {
    running.delete(k);
  }
}

/** «Buscar fotos en Google ahora» */
export async function runPhotosNow(r: AccountRef) {
  const k = refKey(r);
  if (running.has(k)) throw new GmailError("Esta cuenta se está sincronizando: prueba en un momento");
  const a = await getAccount(r);
  if (!a.refreshToken) throw new GmailError("Esta cuenta de Google no está conectada");
  running.add(k);
  try {
    return await runPhotos(r);
  } finally {
    running.delete(k);
  }
}

// ---------------------------------------------------------------------------
// Programador: cada 15 minutos y, poco después de cada cambio, solo lo cambiado
// ---------------------------------------------------------------------------

const timers = new Map<string, NodeJS.Timeout>();

/** Programa una sincronización en breve (agrupa varios cambios seguidos). */
export function kick(r: AccountRef, delay = 60_000) {
  const k = refKey(r);
  clearTimeout(timers.get(k));
  timers.set(
    k,
    setTimeout(() => {
      timers.delete(k);
      void runSync(r).catch(() => undefined);
    }, delay).unref(),
  );
}

/** Convierte las conexiones de la 1.3.0 («gmail.user.<id>») en cuentas. */
async function migrateLegacy() {
  const rows = await db.select({ key: schema.settings.key }).from(schema.settings);
  for (const k of rows.map((x) => x.key).filter((x) => x.startsWith("gmail.user."))) await loadAccounts(k.slice("gmail.user.".length));
}

async function connectedAccounts(): Promise<AccountRef[]> {
  await migrateLegacy();
  const rows = await db.select({ key: schema.settings.key }).from(schema.settings);
  const out: AccountRef[] = [];
  for (const k of rows.map((x) => x.key).filter((x) => x.startsWith("gmail.accounts."))) {
    const userId = k.slice("gmail.accounts.".length);
    for (const a of await loadAccounts(userId)) if (a.refreshToken) out.push({ userId, accId: a.id });
  }
  return out;
}

/** Tras cambiar un contacto: avisa a todas las cuentas conectadas (la sincronización solo envía lo que cambie). */
export async function kickAll() {
  try {
    for (const r of await connectedAccounts()) kick(r);
  } catch {
    /* sin importancia: lo recoge el programador */
  }
}

export function startGmailScheduler() {
  const tick = async () => {
    try {
      for (const r of await connectedAccounts()) await runSync(r, true).catch(() => undefined);
    } catch (e) {
      console.error("[gmail] programador", e);
    }
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 15 * 60_000).unref();
}
