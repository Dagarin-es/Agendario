/**
 * Agendario como servidor CardDAV (RFC 6352) para el móvil (DAVx⁵ en Android, Contactos de iPhone…).
 *
 *  /.well-known/carddav             → /dav/
 *  /dav/                            raíz (current-user-principal)
 *  /dav/principals/<user>/          principal (addressbook-home-set)
 *  /dav/addressbooks/<user>/        libretas: «all» (todos) y una por etiqueta publicada
 *  /dav/addressbooks/<user>/<book>/<nombre>.vcf   contacto
 *
 * Autenticación básica con el email y la contraseña de Agendario. Solo los contactos propios.
 * En una libreta de etiqueta van los contactos con esa etiqueta (o sus subetiquetas) y, de cada
 * uno, los datos de esa etiqueta y los que no tienen etiqueta. Lo creado en el móvil recibe la
 * etiqueta de la libreta; lo borrado en el móvil va a la papelera de Agendario.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { userPrefsSchema } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { verifyPassword } from "../lib/auth.js";
import { recordHistory } from "../lib/history.js";
import { cleanupItemTags, ensureItemIds, itemIdsOf, itemTagsFor } from "../lib/items.js";
import { deleteContacts } from "../lib/merge.js";
import { savePhoto } from "../lib/photos.js";
import { addTags, expandTagIds, tagsForContacts } from "../lib/tags.js";
import { buildVCard, exportedItems, mergeFromRemote, readRemote, type Items } from "../lib/sync.js";

const c = schema.contacts;
const u = schema.users;
const dr = schema.davResources;
type ContactRow = typeof c.$inferSelect;
type DavUser = { id: string; name: string };

// ---------------------------------------------------------------- autenticación

const authCache = new Map<string, { user: DavUser; until: number }>();

async function authenticate(ctx: Context): Promise<DavUser | null> {
  const h = ctx.req.header("authorization");
  const m = h?.match(/^Basic (.+)$/i);
  if (!m) return null;
  const key = createHash("sha256").update(m[1]!).digest("hex");
  const hit = authCache.get(key);
  if (hit && hit.until > Date.now()) return hit.user;
  const raw = Buffer.from(m[1]!, "base64").toString("utf8");
  const i = raw.indexOf(":");
  if (i < 0) return null;
  const email = raw.slice(0, i);
  const password = raw.slice(i + 1);
  const [row] = await db.select().from(u).where(sql`lower(${u.email}) = lower(${email})`);
  if (!row || row.disabled || !(await verifyPassword(row.passwordHash, password))) return null;
  const user = { id: row.id, name: row.name };
  authCache.set(key, { user, until: Date.now() + 5 * 60_000 });
  return user;
}

const unauthorized = () =>
  new Response("Se necesita usuario y contraseña de Agendario", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Agendario", charset="UTF-8"' } });

// ---------------------------------------------------------------- libretas

interface Book {
  id: string; // "all" o id de etiqueta
  name: string;
  tagIds: Set<string> | null; // null = todos
  newTag: string | null;
}

async function booksOf(userId: string): Promise<Book[]> {
  const [p] = await db.select({ prefs: schema.userPrefs.prefs }).from(schema.userPrefs).where(eq(schema.userPrefs.userId, userId));
  const prefs = userPrefsSchema.safeParse(p?.prefs ?? {});
  const cfg = prefs.success ? prefs.data.carddav : { all: true, tagIds: [] as string[] };
  const out: Book[] = [];
  if (cfg.all) out.push({ id: "all", name: "Agendario", tagIds: null, newTag: null });
  if (cfg.tagIds.length) {
    // Nombre con la ruta completa de la etiqueta (Familia › Primos), como en la web
    const all = await db.select().from(schema.tags).where(eq(schema.tags.userId, userId));
    const byId = new Map(all.map((t) => [t.id, t]));
    const path = (id: string) => {
      const parts: string[] = [];
      for (let t = byId.get(id), n = 0; t && n < 10; t = t.parentId ? byId.get(t.parentId) : undefined, n++) parts.unshift(t.name);
      return parts.join(" › ");
    };
    for (const t of all.filter((t) => cfg.tagIds.includes(t.id))) out.push({ id: t.id, name: `Agendario · ${path(t.id)}`, tagIds: new Set(await expandTagIds(userId, [t.id])), newTag: t.id });
  }
  return out;
}

/** Contactos de una libreta con lo que se publica de cada uno. */
async function bookContents(userId: string, book: Book) {
  const rows = await db.select().from(c).where(and(eq(c.ownerId, userId), isNull(c.deletedAt)));
  const ids = rows.map((r) => r.id);
  const tagMap = book.tagIds ? await tagsForContacts(ids, userId) : null;
  const inBook = book.tagIds ? rows.filter((r) => (tagMap!.get(r.id) ?? []).some((t) => book.tagIds!.has(t.id))) : rows;
  const itemTags = await itemTagsFor(inBook.map((r) => r.id), userId);
  const names = new Map((await db.select().from(dr).where(inArray(dr.contactId, inBook.length ? inBook.map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"]))).map((r) => [r.contactId, r.name]));
  return inBook.map((row) => {
    const items: Items = book.tagIds ? exportedItems(row, itemTags.get(row.id), book.tagIds) : { phones: row.phones, emails: row.emails, urls: row.urls, addresses: row.addresses };
    const etag = `"${createHash("sha256").update(`${row.id}|${row.revision}|${row.updatedAt.toISOString()}|${row.photoKey ?? ""}|${JSON.stringify(items)}`).digest("hex").slice(0, 24)}"`;
    return { row, items, etag, name: names.get(row.id) ?? `${row.id}.vcf` };
  });
}

// ---------------------------------------------------------------- XML

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const multistatus = (responses: string[]) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/">${responses.join("")}</d:multistatus>`;
const response = (href: string, props: string) => `<d:response><d:href>${esc(href)}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const xmlResponse = (body: string, status = 207) => new Response(body, { status, headers: { "Content-Type": "application/xml; charset=utf-8", DAV: "1, 3, addressbook" } });

const base = "/dav";
const principalHref = (uid: string) => `${base}/principals/${uid}/`;
const homeHref = (uid: string) => `${base}/addressbooks/${uid}/`;
const bookHref = (uid: string, b: string) => `${base}/addressbooks/${uid}/${b}/`;

const commonPrincipalProps = (user: DavUser) =>
  `<d:current-user-principal><d:href>${principalHref(user.id)}</d:href></d:current-user-principal>` +
  `<d:principal-URL><d:href>${principalHref(user.id)}</d:href></d:principal-URL>` +
  `<card:addressbook-home-set><d:href>${homeHref(user.id)}</d:href></card:addressbook-home-set>` +
  `<d:displayname>${esc(user.name)}</d:displayname>`;

function bookProps(user: DavUser, book: Book, ctag: string) {
  return (
    `<d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>` +
    `<d:displayname>${esc(book.name)}</d:displayname>` +
    `<cs:getctag>${ctag}</cs:getctag><d:sync-token>urn:agendario:${ctag}</d:sync-token>` +
    `<d:current-user-principal><d:href>${principalHref(user.id)}</d:href></d:current-user-principal>` +
    `<d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege><d:privilege><d:write-content/></d:privilege><d:privilege><d:bind/></d:privilege><d:privilege><d:unbind/></d:privilege></d:current-user-privilege-set>` +
    `<d:supported-report-set><d:supported-report><d:report><card:addressbook-multiget/></d:report></d:supported-report><d:supported-report><d:report><card:addressbook-query/></d:report></d:supported-report></d:supported-report-set>` +
    `<card:supported-address-data><card:address-data-type content-type="text/vcard" version="3.0"/></card:supported-address-data>` +
    `<card:max-resource-size>10000000</card:max-resource-size>`
  );
}

const ctagOf = (list: { etag: string }[]) => createHash("sha256").update(list.map((x) => x.etag).join(",")).digest("hex").slice(0, 24);

// ---------------------------------------------------------------- escritura

async function applyCard(user: DavUser, book: Book, name: string, text: string, existing: ContactRow | null) {
  const remote = readRemote({ href: name, etag: "", data: text });
  const p = remote.parsed;
  const source = "Servidor CardDAV (móvil)";
  let photoKey = existing?.photoKey ?? null;
  if (p.photo) {
    try {
      photoKey = await savePhoto(p.photo);
    } catch {
      /* foto no válida: se mantiene la anterior */
    }
  } else if (existing) photoKey = null;

  if (!existing) {
    const [created] = await db
      .insert(c)
      .values({
        ...ensureItemIds({ phones: p.phones, emails: p.emails, urls: p.urls, addresses: p.addresses }),
        ownerId: user.id, givenName: p.givenName, familyName: p.familyName, displayName: p.displayName, nickname: p.nickname,
        organization: p.organization, jobTitle: p.jobTitle, birthday: p.birthday, notes: p.notes, photoKey, vcardUid: remote.uid,
      })
      .returning();
    if (book.newTag) await addTags(created!.id, [book.newTag]);
    await db.insert(dr).values({ contactId: created!.id, name }).onConflictDoUpdate({ target: dr.contactId, set: { name } });
    await recordHistory(db, { contactId: created!.id, userId: user.id, action: "create", after: created!, meta: { source } });
    return created!;
  }
  const itemTags = (await itemTagsFor([existing.id], user.id)).get(existing.id);
  const exported: Items = book.tagIds ? exportedItems(existing, itemTags, book.tagIds) : { phones: existing.phones, emails: existing.emails, urls: existing.urls, addresses: existing.addresses };
  const items = mergeFromRemote(existing, exported, p);
  const [after] = await db
    .update(c)
    .set({
      ...ensureItemIds(items),
      givenName: p.givenName, familyName: p.familyName, displayName: p.displayName, nickname: p.nickname,
      organization: p.organization, organizationContactId: p.organization === existing.organization ? existing.organizationContactId : null,
      jobTitle: p.jobTitle, birthday: p.birthday, notes: p.notes, photoKey, updatedAt: new Date(), revision: sql`${c.revision} + 1`,
    })
    .where(eq(c.id, existing.id))
    .returning();
  await recordHistory(db, { contactId: existing.id, userId: user.id, action: "update", before: existing, after: after!, meta: { source } });
  await cleanupItemTags(existing.id, itemIdsOf(after!));
  return after!;
}

// ---------------------------------------------------------------- rutas

export const davRoutes = new Hono();

davRoutes.all("*", async (ctx) => {
  const method = ctx.req.method.toUpperCase();
  const path = new URL(ctx.req.url).pathname;
  if (method === "OPTIONS")
    return new Response(null, { status: 200, headers: { DAV: "1, 3, addressbook", Allow: "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT" } });

  const user = await authenticate(ctx);
  if (!user) return unauthorized();

  const parts = path.replace(/^\/dav\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const depth = ctx.req.header("depth") ?? "0";

  // /dav/  o  /dav/principals/<uid>/
  if (parts.length === 0 || (parts[0] === "principals" && parts.length <= 2)) {
    if (method !== "PROPFIND") return new Response(null, { status: 405 });
    const href = parts.length === 0 ? `${base}/` : principalHref(user.id);
    return xmlResponse(multistatus([response(href, `<d:resourcetype><d:collection/>${parts.length ? "<d:principal/>" : ""}</d:resourcetype>${commonPrincipalProps(user)}`)]));
  }

  if (parts[0] !== "addressbooks" || parts[1] !== user.id) return new Response("No encontrado", { status: 404 });
  const books = await booksOf(user.id);

  // Hogar de libretas
  if (parts.length === 2) {
    if (method !== "PROPFIND") return new Response(null, { status: 405 });
    const res = [response(homeHref(user.id), `<d:resourcetype><d:collection/></d:resourcetype>${commonPrincipalProps(user)}`)];
    if (depth !== "0") for (const b of books) res.push(response(bookHref(user.id, b.id), bookProps(user, b, ctagOf(await bookContents(user.id, b)))));
    return xmlResponse(multistatus(res));
  }

  const book = books.find((b) => b.id === parts[2]);
  if (!book) return new Response("Libreta no encontrada", { status: 404 });

  // Libreta
  if (parts.length === 3) {
    const contents = await bookContents(user.id, book);
    if (method === "PROPFIND") {
      const res = [response(bookHref(user.id, book.id), bookProps(user, book, ctagOf(contents)))];
      if (depth !== "0") for (const x of contents) res.push(response(bookHref(user.id, book.id) + encodeURIComponent(x.name), `<d:getetag>${x.etag}</d:getetag><d:getcontenttype>text/vcard; charset=utf-8</d:getcontenttype><d:resourcetype/>`));
      return xmlResponse(multistatus(res));
    }
    if (method === "REPORT") {
      const body = await ctx.req.text();
      const wanted = body.includes("addressbook-multiget")
        ? new Set([...body.matchAll(/<(?:[a-zA-Z0-9]+:)?href>([^<]+)<\/(?:[a-zA-Z0-9]+:)?href>/g)].map((m) => decodeURIComponent(m[1]!.trim().split("/").pop() ?? "")))
        : null;
      const list = wanted ? contents.filter((x) => wanted.has(x.name)) : contents;
      const res: string[] = [];
      for (const x of list) {
        const card = await buildVCard(x.row, x.items, x.row.id, "");
        res.push(response(bookHref(user.id, book.id) + encodeURIComponent(x.name), `<d:getetag>${x.etag}</d:getetag><card:address-data>${esc(card)}</card:address-data>`));
      }
      return xmlResponse(multistatus(res));
    }
    return new Response(null, { status: 405 });
  }

  // Contacto
  const name = parts.slice(3).join("/");
  const contents = await bookContents(user.id, book);
  const item = contents.find((x) => x.name === name);

  if (method === "GET" || method === "HEAD") {
    if (!item) return new Response("No encontrado", { status: 404 });
    const card = await buildVCard(item.row, item.items, item.row.id, "");
    return new Response(method === "HEAD" ? null : card, { status: 200, headers: { "Content-Type": "text/vcard; charset=utf-8", ETag: item.etag } });
  }
  if (method === "PROPFIND") {
    if (!item) return new Response("No encontrado", { status: 404 });
    return xmlResponse(multistatus([response(path, `<d:getetag>${item.etag}</d:getetag><d:getcontenttype>text/vcard; charset=utf-8</d:getcontenttype><d:resourcetype/>`)]));
  }
  if (method === "PUT") {
    const ifMatch = ctx.req.header("if-match");
    const ifNone = ctx.req.header("if-none-match");
    if (ifNone === "*" && item) return new Response(null, { status: 412 });
    if (ifMatch && ifMatch !== "*" && (!item || item.etag !== ifMatch)) return new Response(null, { status: 412 });
    const text = await ctx.req.text();
    if (!/BEGIN:VCARD/i.test(text)) return new Response("No es un vCard", { status: 415 });
    if (/^(KIND|X-ADDRESSBOOKSERVER-KIND):\s*group/im.test(text.replace(/\r/g, ""))) return new Response(null, { status: 403 }); // grupos: no
    // Un contacto propio que no está en esta libreta (p. ej. le quitaron la etiqueta) se vuelve a crear
    const existing = item?.row ?? null;
    const saved = await applyCard(user, book, name, text, existing);
    const fresh = (await bookContents(user.id, book)).find((x) => x.row.id === saved.id);
    return new Response(null, { status: existing ? 204 : 201, headers: fresh ? { ETag: fresh.etag } : {} });
  }
  if (method === "DELETE") {
    if (!item) return new Response(null, { status: 404 });
    const ifMatch = ctx.req.header("if-match");
    if (ifMatch && ifMatch !== "*" && item.etag !== ifMatch) return new Response(null, { status: 412 });
    await deleteContacts(user.id, [item.row.id], { [item.row.id]: { source: "Borrado desde el móvil (CardDAV)" } });
    return new Response(null, { status: 204 });
  }
  return new Response(null, { status: 405 });
});
