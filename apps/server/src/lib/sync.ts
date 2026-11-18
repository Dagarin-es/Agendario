/**
 * Sincronización bidireccional con un servicio CardDAV (Fastmail u otro), por etiquetas.
 *
 * Reglas (acordadas):
 * - Se sincronizan tus contactos que tengan alguna de las etiquetas elegidas para ese servicio.
 * - De cada contacto se envían los datos de esas etiquetas y los que no tienen etiqueta (nunca los de otras).
 * - Quitar la etiqueta (o borrar el contacto) lo borra del servicio, no de Agendario.
 * - Lo creado en el servicio llega con la etiqueta de esa sincronización.
 * - Lo borrado en el servicio va a la papelera de Agendario (recuperable 60 días).
 * - Si cambia en los dos lados, gana el cambio más reciente (el otro queda en el historial).
 * - La primera vez: vista previa y emparejado de los que ya existen en los dos lados, que se
 *   combinan sin perder datos.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Address, LabeledValue, SyncPreview, SyncSummary, TagLite } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { DavError, deleteCard, discoverAddressBooks, fetchCards, listCards, putCard, type DavAuth, type RemoteCard } from "./carddav.js";
import { recordHistory } from "./history.js";
import { cleanupItemTags, ensureItemIds, itemIdsOf, itemTagsFor } from "./items.js";
import { deleteContacts } from "./merge.js";
import { deletePhoto, readPhoto, savePhoto } from "./photos.js";
import { addTags, expandTagIds, tagsForContacts } from "./tags.js";
import { logicalLines, parseProp, parseVCard, type ParsedContact } from "./vcard-parse.js";
import { nameTokens, normalizeEmail, normalizePhone } from "./duplicates.js";

const c = schema.contacts;
const sa = schema.syncAccounts;
const sl = schema.syncLinks;
type ContactRow = typeof c.$inferSelect;
type Account = typeof sa.$inferSelect;
type Link = typeof sl.$inferSelect;

export const providers = {
  fastmail: { name: "Fastmail", serverUrl: "https://carddav.fastmail.com" },
  carddav: { name: "CardDAV", serverUrl: "" },
} as const;

const authOf = (a: Pick<Account, "username" | "password">): DavAuth => ({ username: a.username, password: a.password });

// ---------------------------------------------------------------------------
// vCard 3.0 para el servicio (es la versión que mejor entienden todos)
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

function fold(line: string): string {
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

/** Etiquetas de Agendario que tienen tipo estándar en vCard; las demás van como etiqueta propia (X-ABLabel). */
const stdTypes: Record<string, string> = { móvil: "CELL", movil: "CELL", casa: "HOME", trabajo: "WORK", fax: "FAX", otro: "OTHER", principal: "MAIN" };

export type Items = { phones: LabeledValue[]; emails: LabeledValue[]; urls: LabeledValue[]; addresses: Address[] };

/** Cuerpo del vCard (sin foto, REV ni extras): sirve también de huella del estado local. */
function vcardCore(row: ContactRow, items: Items, uid: string): string[] {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `UID:${uid}`, `FN:${esc(row.displayName)}`, `N:${esc(row.familyName)};${esc(row.givenName)};;;`];
  if (row.nickname) lines.push(`NICKNAME:${esc(row.nickname)}`);
  if (row.organization) lines.push(`ORG:${esc(row.organization)}`);
  if (row.jobTitle) lines.push(`TITLE:${esc(row.jobTitle)}`);
  if (row.birthday) {
    lines.push(row.birthday.startsWith("--") ? `BDAY;X-APPLE-OMIT-YEAR=1604:1604-${row.birthday.slice(2)}` : `BDAY:${row.birthday}`);
  }
  let g = 0;
  const prop = (name: string, label: string, value: string, extraType = "") => {
    const std = stdTypes[label.trim().toLowerCase()];
    if (std || !label.trim()) {
      lines.push(`${name}${std || extraType ? `;TYPE=${[extraType, std].filter(Boolean).join(",")}` : ""}:${value}`);
    } else {
      g++;
      lines.push(`item${g}.${name}${extraType ? `;TYPE=${extraType}` : ""}:${value}`, `item${g}.X-ABLabel:${esc(label.trim())}`);
    }
  };
  for (const e of items.emails) prop("EMAIL", e.label, esc(e.value), "INTERNET");
  for (const p of items.phones) prop("TEL", p.label, esc(p.value));
  for (const u of items.urls) prop("URL", u.label, esc(u.value));
  for (const a of items.addresses) prop("ADR", a.label, `;;${esc(a.street)};${esc(a.city)};${esc(a.region)};${esc(a.postalCode)};${esc(a.country)}`);
  if (row.notes) lines.push(`NOTE:${esc(row.notes)}`);
  return lines;
}

function localHash(row: ContactRow, items: Items, uid: string) {
  return createHash("sha256").update(vcardCore(row, items, uid).join("\n")).update(`|photo:${row.photoKey ?? ""}`).digest("hex").slice(0, 32);
}

export async function buildVCard(row: ContactRow, items: Items, uid: string, extra: string): Promise<string> {
  const lines = vcardCore(row, items, uid);
  if (row.photoKey) {
    try {
      const jpeg = await readPhoto(row.photoKey, "full");
      lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${Buffer.from(jpeg).toString("base64")}`);
    } catch {
      /* sin foto si no se puede leer */
    }
  }
  for (const x of extra.split("\n").filter(Boolean)) lines.push(x);
  lines.push(`REV:${row.updatedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`, "PRODID:-//Agendario//ES", "END:VCARD");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Lectura de lo que llega del servicio
// ---------------------------------------------------------------------------

const handled = new Set(["BEGIN", "END", "VERSION", "UID", "FN", "N", "NICKNAME", "ORG", "TITLE", "BDAY", "EMAIL", "TEL", "URL", "ADR", "NOTE", "PHOTO", "REV", "PRODID", "X-CONTACTOS-GIFT"]);

export interface Remote {
  card: RemoteCard;
  parsed: ParsedContact;
  uid: string;
  rev: Date | null;
  extra: string;
  photoHash: string;
  isGroup: boolean;
}

export function readRemote(card: RemoteCard): Remote {
  const data = card.data ?? "";
  const parsed = parseVCard(data);
  const lines = logicalLines(data);
  const props = lines.map((l) => ({ line: l, p: parseProp(l) }));
  // Grupos (item1.EMAIL + item1.X-ABLabel…) que pertenecen a datos que maneja Agendario
  const usedGroups = new Set(props.filter((x) => x.p && x.p.group && handled.has(x.p.name)).map((x) => x.p!.group!.toUpperCase()));
  const extra = props
    .filter((x) => x.p && !handled.has(x.p.name) && !(x.p.group && usedGroups.has(x.p.group.toUpperCase())))
    .map((x) => x.line)
    .join("\n");
  const revRaw = props.find((x) => x.p?.name === "REV")?.p?.value.trim() ?? "";
  const m = revRaw.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2}):?(\d{2}))?/);
  const rev = m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))) : null;
  return {
    card,
    parsed,
    uid: parsed.uid || card.href,
    rev: rev && !Number.isNaN(rev.getTime()) ? rev : null,
    extra,
    photoHash: parsed.photo ? createHash("sha256").update(parsed.photo).digest("hex").slice(0, 32) : "",
    isGroup: /^(KIND|X-ADDRESSBOOKSERVER-KIND):\s*group/im.test(data.replace(/\r/g, "")),
  };
}

// ---------------------------------------------------------------------------
// Datos de cada contacto que se envían (regla de etiquetas de datos)
// ---------------------------------------------------------------------------

export function exportedItems(row: ContactRow, itemTags: Record<string, TagLite> | undefined, tagIds: Set<string>): Items {
  const keep = <T extends { id?: string }>(list: T[]) => list.filter((x) => !x.id || !itemTags?.[x.id] || tagIds.has(itemTags[x.id]!.id));
  return { phones: keep(row.phones), emails: keep(row.emails), urls: keep(row.urls), addresses: keep(row.addresses) };
}

const norm = {
  phones: (v: LabeledValue) => normalizePhone(v.value) ?? v.value.replace(/\s/g, ""),
  emails: (v: LabeledValue) => normalizeEmail(v.value),
  urls: (v: LabeledValue) => v.value.trim().toLowerCase().replace(/\/$/, ""),
  addresses: (a: Address) => [a.street, a.postalCode, a.city].map((x) => nameTokens(x).join(" ")).join("|"),
};
const kinds = ["phones", "emails", "urls", "addresses"] as const;

/**
 * Lo que llega del servicio sustituye a los datos que se le enviaron; los de otras etiquetas se
 * conservan. Si un dato ya existía se mantiene su id (y su etiqueta) y, en direcciones, sus coordenadas.
 */
export function mergeFromRemote(row: ContactRow, exported: Items, parsed: ParsedContact) {
  const out: Partial<Items> = {};
  for (const k of kinds) {
    const sent = new Set((exported[k] as { id?: string }[]).map((x) => x.id));
    const kept = (row[k] as (LabeledValue | Address)[]).filter((x) => !sent.has(x.id));
    const pool = [...(exported[k] as (LabeledValue | Address)[])];
    const incoming = (parsed[k] as (LabeledValue | Address)[]).map((r) => {
      const key = (norm[k] as (v: unknown) => string)(r);
      const i = pool.findIndex((x) => (norm[k] as (v: unknown) => string)(x) === key);
      if (i < 0) return r;
      const [old] = pool.splice(i, 1);
      if (k === "addresses") {
        const o = old as Address;
        return { ...(r as Address), id: o.id, lat: o.lat ?? null, lon: o.lon ?? null };
      }
      return { ...r, id: old!.id };
    });
    (out as Record<string, unknown>)[k] = [...kept, ...incoming];
  }
  return out as Items;
}

/** Primera vez: se combinan los dos sin perder nada (base: Agendario; se añade lo que solo tiene el servicio). */
function unionWithRemote(row: ContactRow, parsed: ParsedContact) {
  const out: Partial<ContactRow> = {};
  for (const k of kinds) {
    const have = new Set((row[k] as unknown[]).map((x) => (norm[k] as (v: unknown) => string)(x)));
    const add = (parsed[k] as unknown[]).filter((x) => !have.has((norm[k] as (v: unknown) => string)(x)));
    if (add.length) (out as Record<string, unknown>)[k] = [...(row[k] as unknown[]), ...add];
  }
  for (const f of ["givenName", "familyName", "nickname", "organization", "jobTitle", "notes"] as const) {
    if (!row[f].trim() && parsed[f].trim()) out[f] = parsed[f];
  }
  if (!row.birthday && parsed.birthday) out.birthday = parsed.birthday;
  return out;
}

// ---------------------------------------------------------------------------
// Emparejado
// ---------------------------------------------------------------------------

function buildMatcher(rows: ContactRow[]) {
  const byUid = new Map<string, ContactRow>();
  const byEmail = new Map<string, ContactRow>();
  const byPhone = new Map<string, ContactRow>();
  const byName = new Map<string, ContactRow>();
  const nameKey = (s: string) => nameTokens(s).sort().join(" ");
  for (const r of rows) {
    for (const u of [r.id, `urn:uuid:${r.id}`, r.vcardUid, ...r.mergedUids]) if (u) byUid.set(u, r);
    for (const e of r.emails) if (!byEmail.has(normalizeEmail(e.value))) byEmail.set(normalizeEmail(e.value), r);
    for (const p of r.phones) {
      const n = normalizePhone(p.value);
      if (n && !byPhone.has(n)) byPhone.set(n, r);
    }
    const nk = nameKey(r.displayName);
    if (nk && !byName.has(nk)) byName.set(nk, r);
  }
  return (p: ParsedContact, uid: string, strong: boolean, taken: Set<string>): ContactRow | null => {
    const free = (r: ContactRow | undefined) => (r && !taken.has(r.id) ? r : null);
    const hit = free(byUid.get(uid));
    if (hit || !strong) return hit;
    for (const e of p.emails) {
      const r = free(byEmail.get(normalizeEmail(e.value)));
      if (r) return r;
    }
    for (const ph of p.phones) {
      const n = normalizePhone(ph.value);
      const r = n ? free(byPhone.get(n)) : null;
      if (r) return r;
    }
    return free(byName.get(nameKey(p.displayName)));
  };
}

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

const running = new Set<string>();

type LogEntry = { action: string; contactId?: string | null; contactName?: string; detail?: string };
const sl_log = schema.syncLog;

/** Guarda las entradas de una pasada (y borra las de más de 60 días). */
async function saveLog(accountId: string, runId: string, entries: LogEntry[]) {
  const at = new Date();
  for (let i = 0; i < entries.length; i += 500) {
    await db.insert(sl_log).values(entries.slice(i, i + 500).map((e) => ({ accountId, runId, at, action: e.action, contactId: e.contactId ?? null, contactName: e.contactName ?? "", detail: (e.detail ?? "").slice(0, 500) })));
  }
  await db.delete(sl_log).where(and(eq(sl_log.accountId, accountId), sql`${sl_log.at} < now() - interval '60 days'`));
}

export class SyncBlocked extends Error {
  constructor(message: string, public code: "mass_remote" | "mass_local") {
    super(message);
  }
}

async function loadState(account: Account) {
  const rows = await db.select().from(c).where(and(eq(c.ownerId, account.userId), isNull(c.deletedAt)));
  const ids = rows.map((r) => r.id);
  const tagMap = await tagsForContacts(ids, account.userId);
  const itemTags = await itemTagsFor(ids, account.userId);
  const tagIds = new Set(await expandTagIds(account.userId, account.tagIds)); // con sus subetiquetas
  const inScope = new Set(rows.filter((r) => (tagMap.get(r.id) ?? []).some((t) => tagIds.has(t.id))).map((r) => r.id));
  const links = await db.select().from(sl).where(eq(sl.accountId, account.id));
  return { rows, byId: new Map(rows.map((r) => [r.id, r])), itemTags, tagIds, inScope, links };
}

/** Vista previa de la primera sincronización (no cambia nada). */
export async function previewSync(accountId: string): Promise<SyncPreview> {
  const [account] = await db.select().from(sa).where(eq(sa.id, accountId));
  if (!account) throw new Error("No existe esa sincronización");
  const auth = authOf(account);
  const st = await loadState(account);
  const list = await listCards(account.addressBookUrl, auth);
  const remotes = (await fetchCards(account.addressBookUrl, auth, list.map((x) => x.href))).map(readRemote).filter((r) => !r.isGroup);
  const match = buildMatcher(st.rows);
  const taken = new Set<string>();
  const pairs: SyncPreview["pairs"] = [];
  const toDownload: string[] = [];
  for (const r of remotes) {
    const local = match(r.parsed, r.uid, true, taken);
    if (local) {
      taken.add(local.id);
      pairs.push({ localId: local.id, localName: local.displayName, remoteName: r.parsed.displayName, addsTag: !st.inScope.has(local.id) });
    } else toDownload.push(r.parsed.displayName);
  }
  const toUpload = st.rows.filter((r) => st.inScope.has(r.id) && !taken.has(r.id)).map((r) => r.displayName);
  const sortEs = (a: string, b: string) => a.localeCompare(b, "es");
  return {
    remoteCount: remotes.length,
    localCount: st.inScope.size,
    pairs: pairs.sort((a, b) => sortEs(a.localName, b.localName)),
    toUpload: toUpload.sort(sortEs),
    toDownload: toDownload.sort(sortEs),
  };
}

/** Sincroniza una cuenta. `force` aplica aunque salte el freno de borrados masivos. */
export async function runSync(accountId: string, opts: { force?: boolean } = {}): Promise<SyncSummary> {
  if (running.has(accountId)) throw new Error("Ya se está sincronizando");
  running.add(accountId);
  const [account] = await db.select().from(sa).where(eq(sa.id, accountId));
  if (!account) {
    running.delete(accountId);
    throw new Error("No existe esa sincronización");
  }
  await db.update(sa).set({ lastStatus: "running" }).where(eq(sa.id, accountId));
  const runId = crypto.randomUUID();
  const log: LogEntry[] = [];
  try {
    const summary = await doSync(account, !!opts.force, log);
    const changed = log.length > 0;
    // Las pasadas sin cambios no se apuntan una a una (serían cientos al día)
    if (changed || !account.initialized) await saveLog(accountId, runId, [{ action: "run", detail: JSON.stringify({ ...summary, first: !account.initialized, forced: !!opts.force }) }, ...log]);
    await db.update(sa).set({ lastStatus: "ok", lastError: "", lastSyncAt: new Date(), lastSummary: summary as unknown as Record<string, number>, initialized: true }).where(eq(sa.id, accountId));
    return summary;
  } catch (e) {
    const msg = e instanceof DavError || e instanceof SyncBlocked ? e.message : `Error: ${(e as Error).message}`;
    if (!(e instanceof DavError || e instanceof SyncBlocked)) console.error("[sync]", e);
    await saveLog(accountId, runId, [...log, { action: "error", detail: msg }]).catch(() => undefined);
    await db.update(sa).set({ lastStatus: e instanceof SyncBlocked ? `blocked:${e.code}` : "error", lastError: msg, lastSyncAt: new Date() }).where(eq(sa.id, accountId));
    throw e;
  } finally {
    running.delete(accountId);
  }
}

async function doSync(account: Account, force: boolean, log: LogEntry[]): Promise<SyncSummary> {
  const auth = authOf(account);
  const source = `Sincronización con ${account.name}`;
  const sum: SyncSummary = { uploaded: 0, downloaded: 0, created: 0, updatedLocal: 0, deletedRemote: 0, deletedLocal: 0, paired: 0, conflicts: 0, errors: 0 };
  const st = await loadState(account);
  const remoteList = await listCards(account.addressBookUrl, auth);
  const remoteByHref = new Map(remoteList.map((r) => [r.href, r]));
  const linkByContact = new Map(st.links.map((l) => [l.contactId, l]));
  const linkedHrefs = new Set(st.links.map((l) => l.href));
  const linkByHref = new Map(st.links.map((l) => [l.href, l]));

  // --- Frenos de seguridad ante borrados masivos ---
  const goneRemote = st.links.filter((l) => !remoteByHref.has(l.href));
  const goneLocal = st.links.filter((l) => !st.inScope.has(l.contactId) && remoteByHref.has(l.href));
  const many = (n: number) => n >= 10 && n > st.links.length * 0.5;
  if (!force && many(goneRemote.length))
    throw new SyncBlocked(`En ${account.name} faltan ${goneRemote.length} de ${st.links.length} contactos sincronizados. Por seguridad no se ha borrado nada en Agendario.`, "mass_remote");
  if (!force && many(goneLocal.length))
    throw new SyncBlocked(`Se borrarían ${goneLocal.length} de ${st.links.length} contactos en ${account.name} (sin la etiqueta o borrados en Agendario). Por seguridad no se ha hecho.`, "mass_local");

  // --- Descargar lo nuevo o cambiado en el servicio ---
  const toFetch = remoteList.filter((r) => !linkByHref.has(r.href) || linkByHref.get(r.href)!.etag !== r.etag).map((r) => r.href);
  const fetched = new Map((await fetchCards(account.addressBookUrl, auth, toFetch)).map((card) => [card.href, readRemote(card)]));

  const uploads: { row: ContactRow; link: Link | null; href: string; uid: string; extra: string; etag?: string }[] = [];
  const linkUpdates: Link[] = [];
  const now = new Date();

  // 1) Enlaces existentes
  for (const link of st.links) {
    const row = st.byId.get(link.contactId);
    const remoteMeta = remoteByHref.get(link.href);
    // Borrado en el servicio → a la papelera de Agendario
    if (!remoteMeta) {
      if (row) {
        await deleteContacts(account.userId, [row.id], { [row.id]: { source } });
        sum.deletedLocal++;
        log.push({ action: "deleted_local", contactId: row.id, contactName: row.displayName, detail: `Borrado en ${account.name}: enviado a la papelera` });
      }
      await db.delete(sl).where(and(eq(sl.accountId, account.id), eq(sl.contactId, link.contactId)));
      continue;
    }
    // Sin la etiqueta o borrado en Agendario → se borra del servicio
    if (!row || !st.inScope.has(row.id)) {
      try {
        await deleteCard(link.href, auth, link.etag || undefined);
        sum.deletedRemote++;
        const gone = row ?? (await db.select().from(c).where(eq(c.id, link.contactId)))[0];
        log.push({ action: "deleted_remote", contactId: link.contactId, contactName: gone?.displayName ?? "", detail: row ? "Ya no tiene la etiqueta" : "Borrado en Agendario" });
        await db.delete(sl).where(and(eq(sl.accountId, account.id), eq(sl.contactId, link.contactId)));
      } catch (e) {
        if ((e as DavError).status === 412) sum.conflicts++;
        else throw e;
      }
      continue;
    }
    const exported = exportedItems(row, st.itemTags.get(row.id), st.tagIds);
    const localChanged = localHash(row, exported, link.uid) !== link.localHash;
    const remote = fetched.get(link.href);
    const remoteChanged = !!remote && remoteMeta.etag !== link.etag;
    if (remoteChanged && remote && remote.isGroup) continue;
    let useRemote = remoteChanged;
    if (remoteChanged && localChanged) {
      sum.conflicts++;
      useRemote = !!remote!.rev && remote!.rev > row.updatedAt; // gana lo más reciente
      log.push({ action: "conflict", contactId: row.id, contactName: row.displayName, detail: useRemote ? `Cambió en los dos sitios: gana ${account.name} (más reciente)` : "Cambió en los dos sitios: gana Agendario (más reciente)" });
    }
    if (useRemote && remote) {
      const updated = await applyRemote(account, row, exported, remote, link, source);
      if (updated) {
        sum.updatedLocal++;
        log.push({ action: "updated", contactId: row.id, contactName: updated.displayName, detail: `Cambios desde ${account.name}: ${changedFields(row, updated)}` });
      }
      const fresh = updated ?? row;
      const freshExported = exportedItems(fresh, st.itemTags.get(row.id), st.tagIds);
      // Si Agendario tiene foto y el servicio nunca la tuvo, se envía
      const needsPhoto = !!fresh.photoKey && !remote.photoHash && !link.remotePhotoHash;
      linkUpdates.push({ ...link, etag: remoteMeta.etag, uid: remote.uid, extra: remote.extra, remotePhotoHash: remote.photoHash, localHash: needsPhoto ? "" : localHash(fresh, freshExported, remote.uid), syncedAt: now });
      if (needsPhoto) uploads.push({ row: fresh, link, href: link.href, uid: remote.uid, extra: remote.extra, etag: remoteMeta.etag });
      sum.downloaded++;
    } else if (localChanged) {
      uploads.push({ row, link, href: link.href, uid: link.uid, extra: link.extra, etag: link.etag });
    }
  }

  // 2) Tarjetas nuevas en el servicio
  const match = buildMatcher(st.rows);
  const taken = new Set(st.links.map((l) => l.contactId));
  const firstTime = !account.initialized;
  for (const remote of fetched.values()) {
    if (linkedHrefs.has(remote.card.href) || remote.isGroup) continue;
    const local = match(remote.parsed, remote.uid, firstTime, taken);
    if (local) {
      // Emparejar: se combinan sin perder datos y se envía el resultado
      taken.add(local.id);
      const merged = await applyUnion(account, local, remote, source);
      if (!st.inScope.has(local.id)) {
        await addTags(local.id, [account.newTagId ?? account.tagIds[0]!].filter(Boolean));
        st.inScope.add(local.id);
      }
      const link: Link = { accountId: account.id, contactId: local.id, href: remote.card.href, etag: remote.card.etag, uid: remote.uid, localHash: "", remotePhotoHash: remote.photoHash, extra: remote.extra, syncedAt: now };
      await db.insert(sl).values(link).onConflictDoNothing();
      uploads.push({ row: merged, link, href: link.href, uid: link.uid, extra: link.extra, etag: link.etag });
      sum.paired++;
      log.push({ action: "paired", contactId: local.id, contactName: local.displayName, detail: `Emparejado con «${remote.parsed.displayName}» de ${account.name}` });
    } else {
      const created = await createFromRemote(account, remote, source);
      const exported = exportedItems(created, undefined, st.tagIds);
      await db.insert(sl).values({ accountId: account.id, contactId: created.id, href: remote.card.href, etag: remote.card.etag, uid: remote.uid, localHash: localHash(created, exported, remote.uid), remotePhotoHash: remote.photoHash, extra: remote.extra, syncedAt: now }).onConflictDoNothing();
      st.inScope.add(created.id);
      taken.add(created.id);
      sum.created++;
      log.push({ action: "created", contactId: created.id, contactName: created.displayName, detail: `Nuevo desde ${account.name}` });
    }
  }

  // 3) Contactos de Agendario con la etiqueta que aún no están en el servicio
  for (const row of st.rows) {
    if (!st.inScope.has(row.id) || taken.has(row.id) || linkByContact.has(row.id)) continue;
    const uid = row.id;
    const href = new URL(`${encodeURIComponent(uid)}.vcf`, account.addressBookUrl.replace(/\/?$/, "/")).toString();
    uploads.push({ row, link: null, href, uid, extra: "" });
  }

  // --- Enviar ---
  const sent: string[] = [];
  for (const u of uploads) {
    const fresh = (await db.select().from(c).where(eq(c.id, u.row.id)))[0] ?? u.row;
    const exported = exportedItems(fresh, st.itemTags.get(fresh.id), st.tagIds);
    try {
      await putCard(u.href, auth, await buildVCard(fresh, exported, u.uid, u.extra), u.link ? { etag: u.etag } : { create: true });
      const values = { accountId: account.id, contactId: fresh.id, href: u.href, uid: u.uid, extra: u.extra, localHash: localHash(fresh, exported, u.uid), syncedAt: now };
      await db.insert(sl).values({ ...values, etag: "" }).onConflictDoUpdate({ target: [sl.accountId, sl.contactId], set: values });
      sent.push(u.href);
      sum.uploaded++;
      if (!u.link) log.push({ action: "uploaded_new", contactId: fresh.id, contactName: fresh.displayName, detail: `Enviado a ${account.name}` });
      else if (!log.some((e) => e.contactId === fresh.id)) log.push({ action: "uploaded", contactId: fresh.id, contactName: fresh.displayName, detail: `Cambios enviados a ${account.name}` });
    } catch (e) {
      if ((e as DavError).status === 412) sum.conflicts++; // cambió a la vez: se resuelve en la próxima pasada
      else {
        sum.errors++;
        console.error("[sync] envío", fresh.displayName, (e as Error).message);
        log.push({ action: "error", contactId: fresh.id, contactName: fresh.displayName, detail: (e as Error).message });
      }
    }
  }
  for (const l of linkUpdates) {
    if (sent.includes(l.href)) {
      await db.update(sl).set({ uid: l.uid, extra: l.extra, remotePhotoHash: l.remotePhotoHash }).where(and(eq(sl.accountId, l.accountId), eq(sl.contactId, l.contactId)));
    } else {
      await db.update(sl).set({ etag: l.etag, uid: l.uid, extra: l.extra, remotePhotoHash: l.remotePhotoHash, localHash: l.localHash, syncedAt: l.syncedAt }).where(and(eq(sl.accountId, l.accountId), eq(sl.contactId, l.contactId)));
    }
  }

  // --- Releer lo enviado: ETag definitivo y foto tal como la guarda el servicio ---
  if (sent.length) {
    for (const card of await fetchCards(account.addressBookUrl, auth, sent)) {
      const r = readRemote(card);
      await db.update(sl).set({ etag: card.etag, remotePhotoHash: r.photoHash, extra: r.extra }).where(and(eq(sl.accountId, account.id), eq(sl.href, card.href)));
    }
  }
  await syncGroups(account, auth, st.tagIds, remoteByHref, fetched, log, sum).catch((e) => {
    sum.errors++;
    log.push({ action: "error", detail: `Grupos: ${(e as Error).message}` });
  });
  return sum;
}

// ---------------------------------------------------------------------------
// Grupos del servicio ↔ subetiquetas
// ---------------------------------------------------------------------------

const sg = schema.syncGroupLinks;
const tg = schema.tags;
const ctg = schema.contactTags;
const SEP = " › ";

function groupMembers(data: string): { name: string; uid: string; members: string[] } {
  const lines = logicalLines(data);
  let name = "";
  let uid = "";
  const members: string[] = [];
  for (const l of lines) {
    const p = parseProp(l);
    if (!p) continue;
    if (p.name === "FN") name = p.value.replace(/\\,/g, ",").trim();
    else if (p.name === "UID") uid = p.value.trim();
    else if (p.name === "MEMBER" || p.name === "X-ADDRESSBOOKSERVER-MEMBER") members.push(p.value.trim().replace(/^urn:uuid:/i, ""));
  }
  return { name, uid, members };
}

function groupVCard(uid: string, name: string, memberUids: string[]) {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `UID:${uid}`, `N:${esc(name)};;;;`, `FN:${esc(name)}`, "X-ADDRESSBOOKSERVER-KIND:group"];
  for (const m of memberUids) lines.push(`X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:${m}`);
  lines.push("PRODID:-//Agendario//ES", "END:VCARD");
  return lines.map(fold).join("\r\n") + "\r\n";
}

async function syncGroups(
  account: Account,
  auth: DavAuth,
  scopeTags: Set<string>,
  remoteByHref: Map<string, RemoteCard>,
  fetched: Map<string, Remote>,
  log: LogEntry[],
  sum: SyncSummary,
) {
  const roots = new Set(account.tagIds);
  const allTags = await db.select().from(tg).where(eq(tg.userId, account.userId));
  const byId = new Map(allTags.map((t) => [t.id, t]));
  // Ruta de cada subetiqueta relativa a su etiqueta sincronizada: «Familia › Primos»
  const pathOf = (id: string): string | null => {
    const parts: string[] = [];
    for (let cur = byId.get(id); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      if (roots.has(cur.id)) return parts.length ? parts.reverse().join(SEP) : null;
      parts.push(cur.name);
    }
    return null;
  };
  const subtags = [...scopeTags].filter((id) => !roots.has(id) && pathOf(id));
  // Contactos sincronizados: id ↔ UID en el servicio
  const links = await db.select({ contactId: sl.contactId, uid: sl.uid }).from(sl).where(eq(sl.accountId, account.id));
  const uidOf = new Map(links.map((l) => [l.contactId, l.uid]));
  const idOf = new Map(links.map((l) => [l.uid.replace(/^urn:uuid:/i, ""), l.contactId]));
  const linkedIds = links.map((l) => l.contactId);
  // Quién tiene cada subetiqueta (asignada directamente)
  const assigned = linkedIds.length && subtags.length
    ? await db.select({ contactId: ctg.contactId, tagId: ctg.tagId }).from(ctg).where(and(inArray(ctg.tagId, subtags), inArray(ctg.contactId, linkedIds)))
    : [];
  const localMembers = (tagId: string) => new Set(assigned.filter((a) => a.tagId === tagId).map((a) => a.contactId));

  // Grupos del servicio (siempre se descargan porque no son contactos enlazados)
  const remoteGroups = new Map<string, { href: string; etag: string; name: string; uid: string; members: string[] }>();
  for (const r of fetched.values()) if (r.isGroup) remoteGroups.set(r.card.href, { href: r.card.href, etag: r.card.etag, ...groupMembers(r.card.data ?? "") });

  const groupLinks = await db.select().from(sg).where(eq(sg.accountId, account.id));
  const linkedHref = new Set(groupLinks.map((g) => g.href));
  const linkedTag = new Set(groupLinks.map((g) => g.tagId).filter(Boolean) as string[]);
  const bookUrl = account.addressBookUrl.replace(/\/?$/, "/");

  const writeGroup = async (href: string, uid: string, name: string, members: Set<string>, etag?: string) => {
    const uids = [...members].map((id) => uidOf.get(id)).filter(Boolean) as string[];
    await putCard(href, auth, groupVCard(uid, name, uids), etag ? { etag } : { create: true });
    const [fresh] = await fetchCards(account.addressBookUrl, auth, [href]);
    return fresh?.etag ?? "";
  };
  const setTag = async (tagId: string, add: Set<string>, remove: Set<string>) => {
    if (add.size) await db.insert(ctg).values([...add].map((contactId) => ({ contactId, tagId }))).onConflictDoNothing();
    if (remove.size) await db.delete(ctg).where(and(eq(ctg.tagId, tagId), inArray(ctg.contactId, [...remove])));
  };

  // 1) Enlaces existentes
  for (const g of groupLinks) {
    const remote = remoteGroups.get(g.href);
    const stillThere = remoteByHref.has(g.href);
    if (!g.tagId || !scopeTags.has(g.tagId) || !pathOf(g.tagId)) {
      // Subetiqueta borrada o sacada de la etiqueta sincronizada → se borra el grupo del servicio
      if (stillThere) await deleteCard(g.href, auth).catch(() => undefined);
      await db.delete(sg).where(eq(sg.id, g.id));
      log.push({ action: "deleted_remote", contactName: g.name, detail: `Grupo «${g.name}» borrado en ${account.name}` });
      continue;
    }
    const name = pathOf(g.tagId)!;
    const local = localMembers(g.tagId);
    const base = new Set(g.members);
    if (!stillThere || !remote) {
      // Borrado en el servicio: se vuelve a crear con lo que hay en Agendario
      const href = bookUrl + encodeURIComponent(g.uid) + ".vcf";
      const etag = await writeGroup(href, g.uid, name, local);
      await db.update(sg).set({ href, etag, name, members: [...local] }).where(eq(sg.id, g.id));
      continue;
    }
    const remoteSet = new Set(remote.members.map((u) => idOf.get(u)).filter(Boolean) as string[]);
    const finalSet = new Set(base);
    for (const x of local) if (!base.has(x)) finalSet.add(x);
    for (const x of remoteSet) if (!base.has(x)) finalSet.add(x);
    for (const x of base) if (!local.has(x) || !remoteSet.has(x)) finalSet.delete(x);
    // Nombre: si cambió en Agendario manda Agendario; si solo cambió en el servicio, se renombra la etiqueta (último nivel)
    let finalName = name;
    if (name === g.name && remote.name && remote.name !== g.name) {
      const leaf = remote.name.split(SEP).pop()!.trim();
      if (leaf) {
        await db.update(tg).set({ name: leaf }).where(eq(tg.id, g.tagId)).catch(() => undefined);
        finalName = pathOf(g.tagId) ?? remote.name;
      }
    }
    const addLocal = new Set([...finalSet].filter((x) => !local.has(x)));
    const removeLocal = new Set([...local].filter((x) => !finalSet.has(x)));
    await setTag(g.tagId, addLocal, removeLocal);
    const same = finalSet.size === remoteSet.size && [...finalSet].every((x) => remoteSet.has(x)) && finalName === remote.name;
    let etag = remote.etag;
    if (!same) etag = await writeGroup(g.href, g.uid, finalName, finalSet, remote.etag);
    if (!same || addLocal.size || removeLocal.size) log.push({ action: "updated", contactName: finalName, detail: `Grupo «${finalName}»: ${finalSet.size} contactos` });
    await db.update(sg).set({ etag, name: finalName, members: [...finalSet] }).where(eq(sg.id, g.id));
  }

  // 2) Subetiquetas nuevas: se emparejan con un grupo del mismo nombre o se crea el grupo
  for (const tagId of subtags) {
    if (linkedTag.has(tagId)) continue;
    const name = pathOf(tagId)!;
    const local = localMembers(tagId);
    const match = [...remoteGroups.values()].find((r) => !linkedHref.has(r.href) && r.name.trim().toLowerCase() === name.toLowerCase());
    if (match) {
      linkedHref.add(match.href);
      const remoteSet = new Set(match.members.map((u) => idOf.get(u)).filter(Boolean) as string[]);
      const union = new Set([...local, ...remoteSet]);
      await setTag(tagId, new Set([...union].filter((x) => !local.has(x))), new Set());
      const etag = union.size !== remoteSet.size ? await writeGroup(match.href, match.uid || randomUid(), name, union, match.etag) : match.etag;
      await db.insert(sg).values({ accountId: account.id, tagId, href: match.href, uid: match.uid || randomUid(), etag, name, members: [...union] });
      log.push({ action: "paired", contactName: name, detail: `Grupo «${name}» emparejado con la subetiqueta` });
    } else {
      const uid = randomUid();
      const href = bookUrl + uid + ".vcf";
      const etag = await writeGroup(href, uid, name, local);
      await db.insert(sg).values({ accountId: account.id, tagId, href, uid, etag, name, members: [...local] });
      log.push({ action: "uploaded_new", contactName: name, detail: `Grupo «${name}» creado en ${account.name}` });
    }
    sum.uploaded++;
  }

  // 3) Grupos nuevos en el servicio: se crea la subetiqueta (dentro de la primera etiqueta sincronizada)
  const root = account.newTagId && roots.has(account.newTagId) ? account.newTagId : account.tagIds[0];
  for (const r of remoteGroups.values()) {
    if (linkedHref.has(r.href) || !root || !r.name.trim()) continue;
    let parent = root;
    for (const part of r.name.split(SEP).map((x) => x.trim()).filter(Boolean)) {
      const existing = allTags.find((t) => t.parentId === parent && t.name.toLowerCase() === part.toLowerCase());
      if (existing) parent = existing.id;
      else {
        const [created] = await db.insert(tg).values({ userId: account.userId, name: part, color: byId.get(root)?.color ?? "teal", parentId: parent }).onConflictDoNothing().returning();
        if (!created) break; // ya existe una etiqueta con ese nombre en otro sitio
        allTags.push(created);
        byId.set(created.id, created);
        parent = created.id;
      }
    }
    if (parent === root) continue;
    const members = new Set(r.members.map((u) => idOf.get(u)).filter(Boolean) as string[]);
    await setTag(parent, members, new Set());
    await db.insert(sg).values({ accountId: account.id, tagId: parent, href: r.href, uid: r.uid || randomUid(), etag: r.etag, name: r.name, members: [...members] }).onConflictDoNothing();
    log.push({ action: "created", contactName: r.name, detail: `Subetiqueta creada desde el grupo «${r.name}» de ${account.name}` });
    sum.created++;
  }
}

const randomUid = () => crypto.randomUUID();

const fieldNames: Record<string, string> = {
  givenName: "nombre", familyName: "apellidos", displayName: "nombre a mostrar", nickname: "apodo", organization: "empresa",
  jobTitle: "cargo", birthday: "cumpleaños", notes: "notas", phones: "teléfonos", emails: "emails", urls: "webs", addresses: "direcciones", photoKey: "foto",
};
function changedFields(a: ContactRow, b: ContactRow) {
  const strip = (v: unknown) => JSON.stringify(Array.isArray(v) ? v.map((x) => ({ ...(x as object), id: undefined })) : v ?? null);
  const list = Object.keys(fieldNames).filter((k) => strip((a as Record<string, unknown>)[k]) !== strip((b as Record<string, unknown>)[k]));
  return list.map((k) => fieldNames[k]).join(", ") || "sin cambios visibles";
}

async function replacePhoto(row: ContactRow, photo: Buffer | null): Promise<string | null> {
  if (!photo) return row.photoKey;
  try {
    return await savePhoto(photo);
  } catch {
    return row.photoKey; // imagen no válida: se mantiene la que hubiera
  }
}

/** Aplica los cambios del servicio a un contacto ya enlazado. Devuelve la fila nueva (o null si nada cambió). */
async function applyRemote(account: Account, row: ContactRow, exported: Items, remote: Remote, link: Link, source: string) {
  const p = remote.parsed;
  const items = mergeFromRemote(row, exported, p);
  let photoKey = row.photoKey;
  if (remote.photoHash && remote.photoHash !== link.remotePhotoHash) photoKey = await replacePhoto(row, p.photo);
  else if (!remote.photoHash && link.remotePhotoHash) photoKey = null; // la quitaron en el servicio
  const patch = {
    givenName: p.givenName,
    familyName: p.familyName,
    displayName: p.displayName,
    nickname: p.nickname,
    organization: p.organization,
    organizationContactId: p.organization === row.organization ? row.organizationContactId : null,
    jobTitle: p.jobTitle,
    birthday: p.birthday,
    notes: p.notes,
    ...ensureItemIds(items),
    photoKey,
  };
  const changed = Object.entries(patch).some(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify((row as Record<string, unknown>)[k] ?? null));
  if (!changed) return null;
  const [after] = await db.update(c).set({ ...patch, updatedAt: new Date(), revision: sql`${c.revision} + 1` }).where(eq(c.id, row.id)).returning();
  await recordHistory(db, { contactId: row.id, userId: account.userId, action: "update", before: row, after: after!, meta: { source } });
  await cleanupItemTags(row.id, itemIdsOf(after!));
  if (row.photoKey && row.photoKey !== photoKey) await deletePhotoSafe(row.photoKey);
  return after!;
}

async function deletePhotoSafe(key: string) {
  // La foto anterior puede estar en el historial: solo se borra si ya no la usa nadie
  const [inUse] = await db.select({ id: c.id }).from(c).where(eq(c.photoKey, key)).limit(1);
  if (!inUse) await deletePhoto(key).catch(() => undefined);
}

async function applyUnion(account: Account, row: ContactRow, remote: Remote, source: string) {
  const patch: Partial<ContactRow> = unionWithRemote(row, remote.parsed);
  if (!row.photoKey && remote.parsed.photo) patch.photoKey = await replacePhoto(row, remote.parsed.photo);
  if (!Object.keys(patch).length) return row;
  const [after] = await db.update(c).set({ ...ensureItemIds(patch as Partial<Items>), updatedAt: new Date(), revision: sql`${c.revision} + 1` }).where(eq(c.id, row.id)).returning();
  await recordHistory(db, { contactId: row.id, userId: account.userId, action: "update", before: row, after: after!, meta: { source: `${source} (emparejado)` } });
  return after!;
}

async function createFromRemote(account: Account, remote: Remote, source: string) {
  const p = remote.parsed;
  let photoKey: string | null = null;
  if (p.photo) {
    try {
      photoKey = await savePhoto(p.photo);
    } catch {
      photoKey = null;
    }
  }
  const [created] = await db
    .insert(c)
    .values({
      ...ensureItemIds({ phones: p.phones, emails: p.emails, urls: p.urls, addresses: p.addresses }),
      ownerId: account.userId,
      givenName: p.givenName,
      familyName: p.familyName,
      displayName: p.displayName,
      nickname: p.nickname,
      organization: p.organization,
      jobTitle: p.jobTitle,
      birthday: p.birthday,
      notes: p.notes,
      photoKey,
      vcardUid: remote.uid,
    })
    .returning();
  const tag = account.newTagId ?? account.tagIds[0];
  if (tag) await addTags(created!.id, [tag]);
  await recordHistory(db, { contactId: created!.id, userId: account.userId, action: "create", after: created!, meta: { source } });
  return created!;
}

// ---------------------------------------------------------------------------
// Programador
// ---------------------------------------------------------------------------

export function startSyncScheduler() {
  const tick = async () => {
    try {
      const due = await db
        .select()
        .from(sa)
        .where(and(eq(sa.enabled, true), eq(sa.initialized, true), sql`${sa.intervalMin} > 0`, sql`(${sa.lastSyncAt} IS NULL OR ${sa.lastSyncAt} < now() - (${sa.intervalMin} * interval '1 minute'))`));
      for (const a of due) {
        if (running.has(a.id) || a.lastStatus.startsWith("blocked")) continue;
        await runSync(a.id).catch(() => undefined); // el error queda apuntado en la cuenta
      }
    } catch (e) {
      console.error("[sync] programador", e);
    }
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 60_000);
}

export const isRunning = (id: string) => running.has(id);
export { discoverAddressBooks };
