/**
 * Mis deseos y listas para regalarme (1.6.0).
 *
 * - El dueño guarda sus deseos y crea listas (ocasiones con fecha o la lista siempre abierta).
 * - Cada invitado recibe un enlace personal: https://<dirección pública>/#l=<código>.
 *   El código va detrás de «#»: el navegador no lo manda al servidor al abrir la página
 *   (no queda en los registros del proxy ni en las vistas previas); la página lo envía en la
 *   cabecera X-Lista-Token. En la base de datos solo se guarda su huella (SHA-256).
 * - La sorpresa: al dueño NUNCA se le devuelve quién ha elegido qué hasta que se revela.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type {
  PublicWishItem,
  PublicWishState,
  Wish,
  WishGuest,
  WishListDetail,
  WishListInput,
  WishListKind,
  WishListStatus,
  WishListSummary,
  WishRevealed,
  WishSuggestion,
} from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { getSetting, setSetting } from "./settings.js";
import { deletePhoto } from "./photos.js";

const w = schema.wishes;
const wl = schema.wishLists;
const wi = schema.wishListItems;
const wg = schema.wishGuests;
const wc = schema.wishClaims;
const wp = schema.wishClaimPeople;
const ws = schema.wishSuggestions;
const c = schema.contacts;

/** Días que se guardan los regalos revelados (y quién los hizo) antes de archivar la lista. */
const KEEP_REVEALED_DAYS = 30;
/** Sugerencias pendientes como máximo por invitado. */
const MAX_SUGGESTIONS = 5;

// ---------- Dirección pública (subdominio solo para las listas) ----------

const PUBLIC_URL_KEY = "wishes.publicUrl";
let publicUrlCache: string | null = null;

export async function getPublicUrl(): Promise<string> {
  if (publicUrlCache === null) publicUrlCache = (await getSetting<string>(PUBLIC_URL_KEY, "")).replace(/\/+$/, "");
  return publicUrlCache;
}
export async function setPublicUrl(url: string) {
  const clean = url.trim().replace(/\/+$/, "").toLowerCase();
  await setSetting(PUBLIC_URL_KEY, clean);
  publicUrlCache = clean;
}
/** Host de la dirección pública (sin puerto en minúsculas), o "" si no está configurada. */
export async function publicHost(): Promise<string> {
  const url = await getPublicUrl();
  if (!url) return "";
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

// ---------- Códigos de los enlaces ----------

export const newToken = () => randomBytes(32).toString("base64url"); // 256 bits
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

async function linkFor(token: string) {
  const base = await getPublicUrl();
  if (!base) throw new HTTPException(409, { message: "Antes de mandar enlaces, configura la dirección pública de las listas en Ajustes." });
  return `${base}/#l=${token}`;
}

// ---------- Deseos del dueño ----------

async function ownList(userId: string, listId: string) {
  const [row] = await db.select().from(wl).where(and(eq(wl.id, listId), eq(wl.userId, userId)));
  if (!row) throw new HTTPException(404, { message: "Lista no encontrada" });
  return row;
}

/** Ids de los deseos de una lista (todos los del dueño si es «con todos mis deseos»). */
async function wishIdsOf(list: typeof wl.$inferSelect): Promise<string[]> {
  if (list.includeAll) return (await db.select({ id: w.id }).from(w).where(eq(w.userId, list.userId))).map((r) => r.id);
  return (await db.select({ id: wi.wishId }).from(wi).where(eq(wi.listId, list.id))).map((r) => r.id);
}

export async function listWishes(userId: string): Promise<Wish[]> {
  const rows = await db.select().from(w).where(eq(w.userId, userId)).orderBy(desc(w.createdAt));
  const lists = await db.select().from(wl).where(and(eq(wl.userId, userId), eq(wl.status, "active"))).orderBy(asc(wl.createdAt));
  const items = lists.length ? await db.select().from(wi).where(inArray(wi.listId, lists.map((l) => l.id))) : [];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    notes: r.notes,
    priceCents: r.priceCents,
    imageKey: r.imageKey,
    createdAt: r.createdAt.toISOString(),
    lists: lists.filter((l) => l.includeAll || items.some((i) => i.listId === l.id && i.wishId === r.id)).map((l) => ({ id: l.id, title: l.title, emoji: l.emoji })),
  }));
}

export async function ownWish(userId: string, wishId: string) {
  const [row] = await db.select().from(w).where(and(eq(w.id, wishId), eq(w.userId, userId)));
  if (!row) throw new HTTPException(404, { message: "Deseo no encontrado" });
  return row;
}

// ---------- Listas del dueño ----------

export async function listSummaries(userId: string): Promise<WishListSummary[]> {
  const lists = await db.select().from(wl).where(and(eq(wl.userId, userId), ne(wl.status, "archived"))).orderBy(asc(wl.eventDate), asc(wl.createdAt));
  if (!lists.length) return [];
  const ids = lists.map((l) => l.id);
  const [items, guests, sugg, revealed, allWishes] = await Promise.all([
    db.select({ listId: wi.listId, n: sql<number>`count(*)::int` }).from(wi).where(inArray(wi.listId, ids)).groupBy(wi.listId),
    db.select({ listId: wg.listId, n: sql<number>`count(*)::int` }).from(wg).where(inArray(wg.listId, ids)).groupBy(wg.listId),
    db.select({ listId: ws.listId, n: sql<number>`count(*)::int` }).from(ws).where(and(inArray(ws.listId, ids), eq(ws.status, "new"))).groupBy(ws.listId),
    db.select({ listId: wc.listId, n: sql<number>`count(*)::int` }).from(wc).where(and(inArray(wc.listId, ids), isNotNull(wc.revealedAt))).groupBy(wc.listId),
    db.select({ n: sql<number>`count(*)::int` }).from(w).where(eq(w.userId, userId)),
  ]);
  const n = (arr: { listId: string; n: number }[], id: string) => arr.find((x) => x.listId === id)?.n ?? 0;
  return lists.map((l) => ({
    id: l.id,
    kind: l.kind as WishListKind,
    title: l.title,
    emoji: l.emoji,
    eventDate: l.eventDate,
    reveal: l.reveal,
    includeAll: l.includeAll,
    status: l.status as WishListStatus,
    wishCount: l.includeAll ? allWishes[0]!.n : n(items, l.id),
    guestCount: n(guests, l.id),
    suggestionCount: n(sugg, l.id),
    revealedCount: n(revealed, l.id),
  }));
}

async function guestsOf(listId: string): Promise<WishGuest[]> {
  const rows = await db
    .select({ g: wg, cid: c.id, cname: c.displayName, cphoto: c.photoKey, cupd: c.updatedAt, cdel: c.deletedAt })
    .from(wg)
    .leftJoin(c, eq(c.id, wg.contactId))
    .where(eq(wg.listId, listId))
    .orderBy(asc(wg.createdAt));
  return rows.map((r) => ({
    id: r.g.id,
    name: r.g.name,
    contact: r.cid && !r.cdel ? { id: r.cid, displayName: r.cname!, hasPhoto: !!r.cphoto, updatedAt: r.cupd!.toISOString() } : null,
    sentAt: r.g.sentAt?.toISOString() ?? null,
    openedAt: r.g.openedAt?.toISOString() ?? null,
  }));
}

/** Solo lo YA revelado: antes de la revelación, el dueño no puede ver quién ha elegido qué. */
async function revealedOf(userId: string, listId: string): Promise<WishRevealed[]> {
  const claims = await db.select().from(wc).where(and(eq(wc.listId, listId), isNotNull(wc.revealedAt))).orderBy(asc(wc.createdAt));
  if (!claims.length) return [];
  const people = await db
    .select({ claimId: wp.claimId, freeName: wp.freeName, gname: wg.name, contactId: wg.contactId })
    .from(wp)
    .leftJoin(wg, eq(wg.id, wp.guestId))
    .where(inArray(wp.claimId, claims.map((x) => x.id)));
  const giftIds = claims.map((x) => x.receivedGiftId).filter((x): x is string => !!x);
  const gifts = giftIds.length
    ? await db.select({ id: schema.giftsReceived.id, imageKey: schema.giftsReceived.imageKey, fromNames: schema.giftsReceived.fromNames }).from(schema.giftsReceived).where(and(inArray(schema.giftsReceived.id, giftIds), eq(schema.giftsReceived.userId, userId)))
    : [];
  return claims.map((cl) => {
    const gift = gifts.find((g) => g.id === cl.receivedGiftId);
    return {
      claimId: cl.id,
      title: cl.title,
      giftId: gift?.id ?? null,
      imageKey: gift?.imageKey ?? null,
      people: people.filter((p) => p.claimId === cl.id).map((p) => ({ name: p.freeName ?? p.gname ?? "?", contactId: p.freeName ? null : (p.contactId ?? null) })),
      looseNames: gift?.fromNames ?? [],
    };
  });
}

export async function listDetail(userId: string, listId: string): Promise<WishListDetail> {
  await ownList(userId, listId);
  const summary = (await listSummaries(userId)).find((l) => l.id === listId);
  if (!summary) throw new HTTPException(404, { message: "Lista no encontrada" });
  const list = (await db.select().from(wl).where(eq(wl.id, listId)))[0]!;
  const [wishIds, guests, suggestions, revealed] = await Promise.all([
    wishIdsOf(list),
    guestsOf(listId),
    db
      .select()
      .from(ws)
      .where(and(eq(ws.listId, listId), eq(ws.status, "new")))
      .orderBy(asc(ws.createdAt))
      .then((rows): WishSuggestion[] => rows.map((s) => ({ id: s.id, fromName: s.fromName, name: s.name, note: s.note, createdAt: s.createdAt.toISOString() }))),
    revealedOf(userId, listId),
  ]);
  return { ...summary, wishIds, guests, suggestions, revealed, publicUrl: await getPublicUrl() };
}

async function checkWishIds(userId: string, ids: string[]) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return uniq;
  const ok = await db.select({ id: w.id }).from(w).where(and(eq(w.userId, userId), inArray(w.id, uniq)));
  if (ok.length !== uniq.length) throw new HTTPException(404, { message: "Deseo no encontrado" });
  return uniq;
}

export async function createList(userId: string, input: WishListInput) {
  if (input.kind === "occasion" && !input.eventDate) throw new HTTPException(400, { message: "Pon la fecha de la ocasión" });
  if (input.kind === "open") {
    const [dup] = await db.select({ id: wl.id }).from(wl).where(and(eq(wl.userId, userId), eq(wl.kind, "open"), eq(wl.status, "active")));
    if (dup) throw new HTTPException(409, { message: "Ya tienes una lista siempre abierta" });
  }
  const ids = await checkWishIds(userId, input.wishIds);
  const [row] = await db
    .insert(wl)
    .values({
      userId,
      kind: input.kind,
      title: input.title,
      emoji: input.emoji || "🎁",
      eventDate: input.kind === "open" ? null : input.eventDate,
      reveal: input.kind === "open" ? true : input.reveal, // la lista abierta se revela a mano
      includeAll: input.includeAll,
    })
    .returning();
  if (ids.length && !input.includeAll) await db.insert(wi).values(ids.map((wishId) => ({ listId: row!.id, wishId })));
  return row!;
}

export async function patchList(userId: string, listId: string, input: Partial<Omit<WishListInput, "kind">>) {
  const list = await ownList(userId, listId);
  if (list.status !== "active") throw new HTTPException(409, { message: "Esta lista ya está cerrada" });
  const { wishIds, ...rest } = input;
  if (list.kind === "open") rest.eventDate = null;
  else if (rest.eventDate === null) throw new HTTPException(400, { message: "Pon la fecha de la ocasión" });
  if (Object.keys(rest).length) await db.update(wl).set(rest).where(eq(wl.id, listId));
  if (wishIds) {
    const ids = await checkWishIds(userId, wishIds);
    await db.transaction(async (tx) => {
      await tx.delete(wi).where(eq(wi.listId, listId));
      if (ids.length) await tx.insert(wi).values(ids.map((wishId) => ({ listId, wishId })));
    });
  }
}

export async function deleteList(userId: string, listId: string) {
  await ownList(userId, listId);
  await db.delete(wl).where(eq(wl.id, listId));
}

// ---------- Invitados ----------

export async function addGuest(userId: string, listId: string, contactId: string | null, name?: string) {
  const list = await ownList(userId, listId);
  if (list.status !== "active") throw new HTTPException(409, { message: "Esta lista ya está cerrada" });
  let shown = name?.trim() ?? "";
  if (contactId) {
    const [ct] = await db.select({ id: c.id, givenName: c.givenName, nickname: c.nickname, displayName: c.displayName }).from(c).where(and(eq(c.id, contactId), eq(c.ownerId, userId), isNull(c.deletedAt)));
    if (!ct) throw new HTTPException(404, { message: "Contacto no encontrado" });
    const [dup] = await db.select({ id: wg.id }).from(wg).where(and(eq(wg.listId, listId), eq(wg.contactId, contactId)));
    if (dup) throw new HTTPException(409, { message: "Ya está invitado" });
    // Lo que verán los demás: el nombre de pila (no cómo lo tienes guardado en tu agenda)
    if (!shown) shown = (ct.givenName || ct.nickname || ct.displayName).trim().slice(0, 60);
  }
  if (!shown) throw new HTTPException(400, { message: "Pon el nombre que verán los demás" });
  const [row] = await db.insert(wg).values({ listId, contactId, name: shown }).returning();
  return row!;
}

async function ownGuest(userId: string, listId: string, guestId: string) {
  await ownList(userId, listId);
  const [g] = await db.select().from(wg).where(and(eq(wg.id, guestId), eq(wg.listId, listId)));
  if (!g) throw new HTTPException(404, { message: "Invitado no encontrado" });
  return g;
}

/** Genera (o renueva) el enlace personal: el anterior deja de funcionar. */
export async function issueLink(userId: string, listId: string, guestId: string) {
  const list = await ownList(userId, listId);
  if (list.status !== "active") throw new HTTPException(409, { message: "Esta lista ya está cerrada" });
  await ownGuest(userId, listId, guestId);
  const token = newToken();
  const link = await linkFor(token);
  await db.update(wg).set({ tokenHash: hashToken(token), sentAt: new Date() }).where(eq(wg.id, guestId));
  return link;
}

export async function renameGuest(userId: string, listId: string, guestId: string, name: string) {
  await ownGuest(userId, listId, guestId);
  await db.update(wg).set({ name }).where(eq(wg.id, guestId));
}

/** Quita al invitado: su enlace deja de funcionar y lo que eligió vuelve a quedar libre (sin decir qué era). */
export async function removeGuest(userId: string, listId: string, guestId: string) {
  await ownGuest(userId, listId, guestId);
  await db.transaction(async (tx) => {
    await tx.delete(wg).where(eq(wg.id, guestId));
    await dropEmptyClaims(tx, listId);
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Borra las elecciones sin revelar que se han quedado sin ningún invitado. */
async function dropEmptyClaims(tx: Tx | typeof db, listId: string) {
  await tx.execute(sql`DELETE FROM wish_claims cl WHERE cl.list_id = ${listId} AND cl.revealed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM wish_claim_people p WHERE p.claim_id = cl.id AND p.guest_id IS NOT NULL)`);
}

export async function dismissSuggestion(userId: string, id: string) {
  const [s] = await db.select({ id: ws.id, listId: ws.listId }).from(ws).innerJoin(wl, eq(wl.id, ws.listId)).where(and(eq(ws.id, id), eq(wl.userId, userId)));
  if (!s) throw new HTTPException(404, { message: "Sugerencia no encontrada" });
  await db.update(ws).set({ status: "done" }).where(eq(ws.id, id));
}

// ---------- Revelar, cerrar y archivar ----------

const today = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD en la zona horaria del servidor (TZ)

/**
 * Revela lo elegido en una lista: cada regalo pasa a Recibidos (con quién lo hizo) y sale de Mis deseos.
 * Si la ocasión no se revela, lo elegido simplemente sale de Mis deseos, sin guardar quién fue.
 */
export async function revealList(listId: string, opts: { close: boolean }) {
  const [list] = await db.select().from(wl).where(eq(wl.id, listId));
  if (!list || list.status !== "active") return;
  const claims = await db.select().from(wc).where(and(eq(wc.listId, listId), isNull(wc.revealedAt), isNotNull(wc.wishId)));
  const photosToDelete: string[] = [];
  await db.transaction(async (tx) => {
    for (const cl of claims) {
      const [wish] = await tx.select().from(w).where(eq(w.id, cl.wishId!));
      if (!wish) continue;
      if (!list.reveal) {
        if (wish.imageKey) photosToDelete.push(wish.imageKey);
        await tx.delete(w).where(eq(w.id, wish.id));
        continue;
      }
      const people = await tx
        .select({ freeName: wp.freeName, guestName: wg.name, contactId: wg.contactId })
        .from(wp)
        .leftJoin(wg, eq(wg.id, wp.guestId))
        .where(eq(wp.claimId, cl.id));
      // Contactos (que sigan existiendo) y nombres sueltos
      const wanted = [...new Set(people.map((p) => (p.freeName ? null : p.contactId)).filter((x): x is string => !!x))];
      const alive = wanted.length ? (await tx.select({ id: c.id }).from(c).where(and(inArray(c.id, wanted), eq(c.ownerId, list.userId), isNull(c.deletedAt)))).map((r) => r.id) : [];
      const loose = [...new Set(people.filter((p) => p.freeName || !p.contactId || !alive.includes(p.contactId)).map((p) => (p.freeName ?? p.guestName ?? "").trim()).filter(Boolean))];
      const [gift] = await tx
        .insert(schema.giftsReceived)
        .values({
          userId: list.userId,
          contactId: alive[0] ?? null,
          description: wish.title,
          receivedAt: list.eventDate ?? today(),
          notes: [wish.notes, wish.url ?? ""].filter(Boolean).join("\n"),
          imageKey: wish.imageKey, // la foto pasa al regalo recibido
          fromNames: loose.length || alive.length ? loose : ["?"],
        })
        .returning({ id: schema.giftsReceived.id });
      if (alive.length) await tx.insert(schema.giftReceivedContacts).values(alive.map((contactId) => ({ giftId: gift!.id, contactId }))).onConflictDoNothing();
      await tx.update(wc).set({ revealedAt: new Date(), receivedGiftId: gift!.id, wishId: null }).where(eq(wc.id, cl.id));
      await tx.delete(w).where(eq(w.id, wish.id));
    }
    if (!list.reveal) await tx.delete(wc).where(eq(wc.listId, listId));
    if (opts.close) {
      if (list.reveal && claims.length) {
        // Los enlaces dejan de funcionar; lo revelado se queda unos días para verlo
        await tx.update(wg).set({ tokenHash: null }).where(eq(wg.listId, listId));
        await tx.update(wl).set({ status: "revealed", revealedAt: new Date() }).where(eq(wl.id, listId));
      } else {
        await archiveTx(tx, listId);
      }
    }
  });
  for (const k of photosToDelete) await deletePhoto(k).catch(() => {});
}

async function archiveTx(tx: Tx, listId: string) {
  await tx.delete(ws).where(eq(ws.listId, listId));
  await tx.delete(wc).where(eq(wc.listId, listId));
  await tx.delete(wg).where(eq(wg.listId, listId));
  await tx.delete(wi).where(eq(wi.listId, listId));
  await tx.update(wl).set({ status: "archived", archivedAt: new Date() }).where(eq(wl.id, listId));
}

export async function archiveList(userId: string, listId: string) {
  await ownList(userId, listId);
  await db.transaction((tx) => archiveTx(tx, listId));
}

/** Revelar a mano la lista siempre abierta (lo elegido pasa a Recibidos; la lista sigue abierta). */
export async function revealOpenList(userId: string, listId: string) {
  const list = await ownList(userId, listId);
  if (list.kind !== "open" || list.status !== "active") throw new HTTPException(409, { message: "Solo la lista siempre abierta se revela a mano" });
  await revealList(listId, { close: false });
}

/** Cada hora: ocasiones cuya fecha ya pasó → se revelan o se cierran; lo revelado se archiva a los 30 días. */
export async function wishMaintenance() {
  const due = await db.select({ id: wl.id }).from(wl).where(and(eq(wl.kind, "occasion"), eq(wl.status, "active"), lt(wl.eventDate, today())));
  for (const l of due) await revealList(l.id, { close: true }).catch((e) => console.error("Listas de deseos:", e));
  const old = await db
    .select({ id: wl.id })
    .from(wl)
    .where(and(eq(wl.status, "revealed"), lt(wl.revealedAt, new Date(Date.now() - KEEP_REVEALED_DAYS * 86_400_000))));
  for (const l of old) await db.transaction((tx) => archiveTx(tx, l.id));
}

export function startWishScheduler() {
  setTimeout(() => void wishMaintenance().catch(() => {}), 60_000);
  setInterval(() => void wishMaintenance().catch(() => {}), 60 * 60_000);
}

// ---------- Página pública del invitado ----------

export type Guest = typeof wg.$inferSelect & { list: typeof wl.$inferSelect };

/** Invitado a partir del código de su enlace (o null si no existe o la lista ya está cerrada). */
export async function guestByToken(token: string): Promise<Guest | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [row] = await db.select({ g: wg, l: wl }).from(wg).innerJoin(wl, eq(wl.id, wg.listId)).where(eq(wg.tokenHash, hashToken(token)));
  if (!row || row.l.status !== "active") return null;
  return { ...row.g, list: row.l };
}

export async function publicState(guest: Guest): Promise<PublicWishState> {
  const list = guest.list;
  if (!guest.openedAt) await db.update(wg).set({ openedAt: new Date() }).where(eq(wg.id, guest.id));
  const ids = await wishIdsOf(list);
  const [owner] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, list.userId));
  const wishes = ids.length ? await db.select().from(w).where(inArray(w.id, ids)).orderBy(asc(w.createdAt)) : [];
  const claims = ids.length ? await db.select().from(wc).where(and(inArray(wc.wishId, ids), isNull(wc.revealedAt))) : [];
  const mine = claims.filter((x) => x.listId === list.id);
  const people = mine.length
    ? await db.select({ id: wp.id, claimId: wp.claimId, guestId: wp.guestId, freeName: wp.freeName, status: wp.status, gname: wg.name }).from(wp).leftJoin(wg, eq(wg.id, wp.guestId)).where(inArray(wp.claimId, mine.map((x) => x.id)))
    : [];
  const guests = await db.select({ id: wg.id, name: wg.name }).from(wg).where(eq(wg.listId, list.id)).orderBy(asc(wg.name));
  const titleOf = new Map(mine.map((x) => [x.id, x.title]));
  const items: PublicWishItem[] = wishes.map((x) => {
    const cl = claims.find((k) => k.wishId === x.id);
    const here = cl && cl.listId === list.id ? cl : null;
    return {
      id: x.id,
      title: x.title,
      url: x.url,
      notes: x.notes,
      priceCents: x.priceCents,
      hasImage: !!x.imageKey,
      takenElsewhere: !!cl && !here,
      claim: here
        ? {
            id: here.id,
            kind: here.kind as "solo" | "group",
            createdByMe: here.createdBy === guest.id,
            people: people
              .filter((p) => p.claimId === here.id)
              // Primero quien lo eligió, luego los demás invitados y al final los nombres escritos a mano
              .sort((a, b) => rank(a, here.createdBy) - rank(b, here.createdBy) || (a.freeName ?? a.gname ?? "").localeCompare(b.freeName ?? b.gname ?? "", "es"))
              .map((p) => ({ guestId: p.guestId, name: p.freeName ?? p.gname ?? "?", status: p.status as "accepted" | "pending", me: p.guestId === guest.id })),
          }
        : null,
    };
  });
  return {
    list: { title: list.title, emoji: list.emoji, eventDate: list.eventDate, kind: list.kind as WishListKind, ownerName: (owner?.name ?? "").trim().split(/\s+/)[0] ?? "" },
    me: { id: guest.id, name: guest.name },
    guests: guests.map((g) => ({ id: g.id, name: g.name, busy: people.filter((p) => p.guestId === g.id).map((p) => titleOf.get(p.claimId) ?? "") })),
    items,
  };
}

const rank = (p: { guestId: string | null }, creator: string | null) => (p.guestId && p.guestId === creator ? 0 : p.guestId ? 1 : 2);

async function claimOfList(guest: Guest, claimId: string) {
  const [cl] = await db.select().from(wc).where(and(eq(wc.id, claimId), eq(wc.listId, guest.list.id), isNull(wc.revealedAt)));
  if (!cl) throw new HTTPException(404, { message: "Esa elección ya no existe" });
  return cl;
}

async function checkGuests(guest: Guest, ids: string[]) {
  const uniq = [...new Set(ids)].filter((id) => id !== guest.id);
  if (!uniq.length) return uniq;
  const ok = await db.select({ id: wg.id }).from(wg).where(and(eq(wg.listId, guest.list.id), inArray(wg.id, uniq)));
  if (ok.length !== uniq.length) throw new HTTPException(400, { message: "Algún invitado ya no está en la lista" });
  return uniq;
}

const cleanNames = (names: string[]) => [...new Set(names.map((n) => n.trim().replace(/\s+/g, " ")).filter(Boolean))].slice(0, 10);

export async function publicClaim(guest: Guest, input: { wishId: string; kind: "solo" | "group"; guestIds: string[]; freeNames: string[] }) {
  const ids = await wishIdsOf(guest.list);
  if (!ids.includes(input.wishId)) throw new HTTPException(404, { message: "Ese regalo ya no está en la lista" });
  const [wish] = await db.select({ title: w.title }).from(w).where(eq(w.id, input.wishId));
  const others = input.kind === "group" ? await checkGuests(guest, input.guestIds) : [];
  const names = input.kind === "group" ? cleanNames(input.freeNames) : [];
  try {
    await db.transaction(async (tx) => {
      const [cl] = await tx.insert(wc).values({ listId: guest.list.id, wishId: input.wishId, title: wish!.title, createdBy: guest.id, kind: input.kind }).returning({ id: wc.id });
      await tx.insert(wp).values([
        { claimId: cl!.id, guestId: guest.id, status: "accepted" },
        ...others.map((guestId) => ({ claimId: cl!.id, guestId, status: "pending" })),
        ...names.map((freeName) => ({ claimId: cl!.id, freeName, status: "accepted" })),
      ]);
    });
  } catch (e) {
    if (String((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code) === "23505") throw new HTTPException(409, { message: "Alguien acaba de elegir este regalo" });
    throw e;
  }
}

/** Cambiar con quién se regala (solo quien lo eligió). */
export async function publicEditClaim(guest: Guest, claimId: string, input: { guestIds: string[]; freeNames: string[] }) {
  const cl = await claimOfList(guest, claimId);
  if (cl.createdBy !== guest.id) throw new HTTPException(403, { message: "Solo quien lo eligió puede cambiar con quién se regala" });
  const others = await checkGuests(guest, input.guestIds);
  const names = cleanNames(input.freeNames);
  await db.transaction(async (tx) => {
    const current = await tx.select().from(wp).where(eq(wp.claimId, claimId));
    const keep = new Set(others);
    const dropIds = current.filter((p) => (p.guestId && p.guestId !== guest.id && !keep.has(p.guestId)) || p.freeName).map((p) => p.id);
    if (dropIds.length) await tx.delete(wp).where(inArray(wp.id, dropIds));
    const have = new Set(current.map((p) => p.guestId).filter(Boolean));
    const add = others.filter((id) => !have.has(id));
    const rows = [...add.map((guestId) => ({ claimId, guestId, status: "pending" })), ...names.map((freeName) => ({ claimId, freeName, status: "accepted" }))];
    if (rows.length) await tx.insert(wp).values(rows);
    await tx.update(wc).set({ kind: others.length || names.length ? "group" : "solo" }).where(eq(wc.id, claimId));
  });
}

export async function publicAccept(guest: Guest, claimId: string, releaseOthers: boolean) {
  await claimOfList(guest, claimId);
  const [me] = await db.select().from(wp).where(and(eq(wp.claimId, claimId), eq(wp.guestId, guest.id)));
  if (!me) throw new HTTPException(404, { message: "No estás apuntado a este regalo" });
  await db.transaction(async (tx) => {
    await tx.update(wp).set({ status: "accepted" }).where(eq(wp.id, me.id));
    if (releaseOthers) {
      // «Dejo libre lo mío»: sale de los demás regalos de esta lista en los que estaba
      const others = await tx
        .select({ id: wp.id })
        .from(wp)
        .innerJoin(wc, eq(wc.id, wp.claimId))
        .where(and(eq(wp.guestId, guest.id), eq(wc.listId, guest.list.id), isNull(wc.revealedAt), ne(wp.claimId, claimId)));
      if (others.length) await tx.delete(wp).where(inArray(wp.id, others.map((o) => o.id)));
      await dropEmptyClaims(tx, guest.list.id);
    }
  });
}

/** «Me apunto» a un regalo que otro regala entre varios. */
export async function publicJoin(guest: Guest, claimId: string) {
  const cl = await claimOfList(guest, claimId);
  if (cl.kind !== "group") throw new HTTPException(409, { message: "Ese regalo lo hace una sola persona" });
  const [me] = await db.select({ id: wp.id }).from(wp).where(and(eq(wp.claimId, claimId), eq(wp.guestId, guest.id)));
  if (me) await db.update(wp).set({ status: "accepted" }).where(eq(wp.id, me.id));
  else await db.insert(wp).values({ claimId, guestId: guest.id, status: "accepted" });
}

/** «Ya no lo regalo» / «No participo»: el regalo vuelve a quedar libre si no queda ningún invitado. */
export async function publicLeave(guest: Guest, claimId: string) {
  await claimOfList(guest, claimId);
  await db.transaction(async (tx) => {
    await tx.delete(wp).where(and(eq(wp.claimId, claimId), eq(wp.guestId, guest.id)));
    await dropEmptyClaims(tx, guest.list.id);
  });
}

export async function publicSuggest(guest: Guest, input: { name: string; note: string }) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(ws).where(and(eq(ws.guestId, guest.id), eq(ws.status, "new")));
  if (n >= MAX_SUGGESTIONS) throw new HTTPException(429, { message: "Ya has mandado varias sugerencias. Espera a que las revise." });
  await db.insert(ws).values({ listId: guest.list.id, guestId: guest.id, fromName: guest.name, name: input.name, note: input.note });
}

/** Imagen de un deseo de la lista del invitado. */
export async function publicImageKey(guest: Guest, wishId: string) {
  const ids = await wishIdsOf(guest.list);
  if (!ids.includes(wishId)) return null;
  const [row] = await db.select({ imageKey: w.imageKey }).from(w).where(eq(w.id, wishId));
  return row?.imageKey ?? null;
}

// ---------- Límite de peticiones de la parte pública (en memoria) ----------

const hits = new Map<string, { n: number; until: number }>();
/** true si la IP ha superado `max` en la ventana (y cuenta la petición). */
export function overLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.until < now) {
    hits.set(key, { n: 1, until: now + windowMs });
    return false;
  }
  h.n++;
  return h.n > max;
}
export function isBlocked(key: string, max: number) {
  const h = hits.get(key);
  return !!h && h.until >= Date.now() && h.n >= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.until < now) hits.delete(k);
}, 5 * 60_000).unref();

// ---------- «Añadir a mi Agendario»: listas de otros abiertas desde la app ----------

const REMOTE_KEY = (userId: string) => `wishes.remote.${userId}`;
export type RemoteList = { url: string; contactId: string | null; title: string };
export const getRemoteLists = (userId: string) => getSetting<RemoteList[]>(REMOTE_KEY(userId), []);
export async function saveRemoteList(userId: string, item: RemoteList) {
  const list = (await getRemoteLists(userId)).filter((x) => x.url !== item.url);
  list.unshift(item);
  await setSetting(REMOTE_KEY(userId), list.slice(0, 30));
}
export async function removeRemoteList(userId: string, url: string) {
  await setSetting(REMOTE_KEY(userId), (await getRemoteLists(userId)).filter((x) => x.url !== url));
}

