/**
 * Cliente CardDAV mínimo (RFC 6352) para sincronizar con Fastmail u otro servidor:
 * descubrimiento de libretas, listado con ETags, lectura en bloque (multiget), PUT y DELETE.
 */
import { XMLParser } from "fast-xml-parser";

export interface DavAuth {
  username: string;
  password: string;
}
export interface AddressBook {
  url: string;
  name: string;
}
export interface RemoteCard {
  href: string;
  etag: string;
  data?: string;
}

export class DavError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

const xml = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, isArray: (name) => name === "response" || name === "propstat" || name === "href" });

const TIMEOUT = 60_000;

/** Petición con autenticación básica que sigue redirecciones a mano (sin perder la cabecera Authorization). */
async function dav(method: string, url: string, auth: DavAuth, opts: { body?: string; headers?: Record<string, string>; depth?: "0" | "1" } = {}) {
  let target = url;
  for (let i = 0; i < 6; i++) {
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`,
      "User-Agent": "Agendario",
      ...opts.headers,
    };
    if (opts.depth) headers.Depth = opts.depth;
    if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/xml; charset=utf-8";
    let res: Response;
    try {
      res = await fetch(target, { method, headers, body: opts.body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) });
    } catch (e) {
      const cause = (e as { cause?: { code?: string } }).cause?.code;
      throw new DavError(
        cause === "ENOTFOUND" ? `No se encuentra el servidor ${new URL(target).host}.` :
        cause === "ECONNREFUSED" ? `El servidor ${new URL(target).host} rechaza la conexión.` :
        (e as Error).name === "TimeoutError" ? "El servidor tarda demasiado en responder." :
        `No se puede conectar con ${new URL(target).host}: ${(e as Error).message}`,
      );
    }
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get("location")) {
      const next = new URL(res.headers.get("location")!, target);
      // Solo se siguen redirecciones dentro del mismo servidor o a HTTPS (para no enviar la contraseña a cualquier sitio)
      if (next.origin !== new URL(target).origin && next.protocol !== "https:") throw new DavError("El servidor redirige a una dirección no segura.");
      target = next.toString();
      continue;
    }
    if (res.status === 401) throw new DavError("Usuario o contraseña incorrectos. En Fastmail, usa una contraseña de app con acceso a contactos.", 401);
    if (res.status === 403) throw new DavError("El servidor no permite esta operación con esas credenciales.", 403);
    return { res, url: target };
  }
  throw new DavError("Demasiadas redirecciones.");
}

type Prop = Record<string, unknown>;
interface Resp {
  href: string;
  props: Prop;
}

function parseMultistatus(text: string, base: string): Resp[] {
  const doc = xml.parse(text) as { multistatus?: { response?: unknown[] } };
  const out: Resp[] = [];
  for (const r of (doc.multistatus?.response ?? []) as { href?: string[]; propstat?: { status?: string; prop?: Prop }[] }[]) {
    const href = r.href?.[0];
    if (!href) continue;
    const props: Prop = {};
    for (const ps of r.propstat ?? []) if (!ps.status || / 200 /.test(ps.status)) Object.assign(props, ps.prop ?? {});
    out.push({ href: new URL(String(href).trim(), base).toString(), props });
  }
  return out;
}

const text = (v: unknown): string => (v == null ? "" : typeof v === "object" ? String((v as Record<string, unknown>)["#text"] ?? "") : String(v)).trim();
const firstHref = (v: unknown): string | null => {
  if (!v || typeof v !== "object") return null;
  const h = (v as { href?: unknown[] }).href;
  return h?.length ? text(h[0]) : null;
};
const isAddressBook = (p: Prop) => {
  const rt = p.resourcetype;
  return !!rt && typeof rt === "object" && "addressbook" in (rt as object);
};

async function propfind(url: string, auth: DavAuth, depth: "0" | "1", props: string) {
  const body = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/"><d:prop>${props}</d:prop></d:propfind>`;
  const { res, url: final } = await dav("PROPFIND", url, auth, { body, depth });
  if (res.status === 404) throw new DavError("No existe esa dirección en el servidor.", 404);
  if (res.status !== 207) throw new DavError(`El servidor no parece CardDAV (respuesta ${res.status}).`, res.status);
  return parseMultistatus(await res.text(), final);
}

/** Busca las libretas de direcciones de la cuenta a partir de la dirección del servidor. */
export async function discoverAddressBooks(serverUrl: string, auth: DavAuth): Promise<AddressBook[]> {
  const base = new URL(serverUrl.includes("://") ? serverUrl : `https://${serverUrl}`);
  const starts = [base.toString(), new URL("/.well-known/carddav", base).toString()];
  let principal: string | null = null;
  for (const start of starts) {
    try {
      const [r] = await propfind(start, auth, "0", "<d:current-user-principal/><d:resourcetype/><d:displayname/>");
      if (!r) continue;
      if (isAddressBook(r.props)) return [{ url: r.href, name: text(r.props.displayname) || "Contactos" }];
      principal = firstHref(r.props["current-user-principal"]);
      if (principal) {
        principal = new URL(principal, r.href).toString();
        break;
      }
    } catch (e) {
      if ((e as DavError).status === 401 || (e as DavError).status === 403) throw e;
    }
  }
  if (!principal) throw new DavError("No se ha encontrado la cuenta CardDAV en ese servidor.");
  const [p] = await propfind(principal, auth, "0", "<card:addressbook-home-set/>");
  const homeHref = firstHref(p?.props["addressbook-home-set"]);
  if (!homeHref) throw new DavError("La cuenta no tiene libretas de contactos.");
  const home = new URL(homeHref, principal).toString();
  const list = await propfind(home, auth, "1", "<d:resourcetype/><d:displayname/>");
  const books = list.filter((r) => isAddressBook(r.props)).map((r) => ({ url: r.href, name: text(r.props.displayname) || decodeURIComponent(r.href.replace(/\/$/, "").split("/").pop() ?? "") }));
  if (!books.length) throw new DavError("La cuenta no tiene libretas de contactos.");
  return books;
}

/** Lista las tarjetas de la libreta con su ETag (sin descargarlas). */
export async function listCards(bookUrl: string, auth: DavAuth): Promise<RemoteCard[]> {
  const list = await propfind(bookUrl, auth, "1", "<d:getetag/><d:resourcetype/><d:getcontenttype/>");
  const self = new URL(bookUrl).pathname.replace(/\/?$/, "/");
  return list
    .filter((r) => {
      const rt = r.props.resourcetype;
      return new URL(r.href).pathname.replace(/\/?$/, "/") !== self && !(rt && typeof rt === "object" && "collection" in (rt as object));
    })
    .filter((r) => {
      const ct = text(r.props.getcontenttype);
      return !ct || ct.includes("vcard") || r.href.endsWith(".vcf");
    })
    .map((r) => ({ href: r.href, etag: text(r.props.getetag) }));
}

/** Descarga varias tarjetas de una vez (addressbook-multiget), en bloques. */
export async function fetchCards(bookUrl: string, auth: DavAuth, hrefs: string[]): Promise<RemoteCard[]> {
  const out: RemoteCard[] = [];
  for (let i = 0; i < hrefs.length; i += 80) {
    const chunk = hrefs.slice(i, i + 80);
    const body = `<?xml version="1.0" encoding="utf-8"?><card:addressbook-multiget xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><card:address-data/></d:prop>${chunk
      .map((h) => `<d:href>${escapeXml(new URL(h).pathname)}</d:href>`)
      .join("")}</card:addressbook-multiget>`;
    const { res, url } = await dav("REPORT", bookUrl, auth, { body, depth: "1" });
    if (res.status !== 207) throw new DavError(`No se han podido leer los contactos (respuesta ${res.status}).`, res.status);
    for (const r of parseMultistatus(await res.text(), url)) {
      const data = text(r.props["address-data"]);
      if (data) out.push({ href: r.href, etag: text(r.props.getetag), data });
    }
  }
  return out;
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Crea o actualiza una tarjeta. Devuelve el ETag nuevo si el servidor lo da. */
export async function putCard(href: string, auth: DavAuth, vcard: string, match: { etag?: string; create?: boolean }) {
  const headers: Record<string, string> = { "Content-Type": "text/vcard; charset=utf-8" };
  if (match.create) headers["If-None-Match"] = "*";
  else if (match.etag) headers["If-Match"] = match.etag;
  const { res } = await dav("PUT", href, auth, { body: vcard, headers });
  if (res.status === 412) throw new DavError("El contacto ha cambiado en el servidor mientras se enviaba.", 412);
  if (res.status >= 300) throw new DavError(`El servidor no ha aceptado el contacto (respuesta ${res.status}): ${(await res.text()).slice(0, 200)}`, res.status);
  return res.headers.get("etag") ?? "";
}

export async function deleteCard(href: string, auth: DavAuth, etag?: string) {
  const { res } = await dav("DELETE", href, auth, { headers: etag ? { "If-Match": etag } : {} });
  if (res.status === 404 || res.status === 410) return;
  if (res.status === 412) throw new DavError("El contacto ha cambiado en el servidor.", 412);
  if (res.status >= 300) throw new DavError(`No se ha podido borrar en el servidor (respuesta ${res.status}).`, res.status);
}
