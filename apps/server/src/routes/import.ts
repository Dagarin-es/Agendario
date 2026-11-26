import { FAVORITES_CATEGORY, setFavorite } from "../lib/favorites.js";
import { zValidator } from "@hono/zod-validator";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { importRequestSchema, occasions, type ImportResult, type Occasion } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { rawContact, recordHistory } from "../lib/history.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import { deletePhoto, saveCover, savePhoto } from "../lib/photos.js";
import { addTags, assertOwnTags, ensureTagsByName } from "../lib/tags.js";
import { parseVCard, type ParsedContact } from "../lib/vcard-parse.js";
import { cleanupItemTags, ensureItemIds, itemIdsOf } from "../lib/items.js";

const c = schema.contacts;
const UUID_RE = /^(?:urn:uuid:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Busca un contacto PROPIO que ya exista:
 * 1. Mismo UID de vCard (o el id, si el fichero es una exportación de esta app).
 * 2. Si el vCard no trae UID (Google, Android…): mismo nombre y algún email o teléfono en común
 *    (o ninguno de los dos tiene email ni teléfono).
 */
async function findExisting(p: ParsedContact, userId: string) {
  if (p.uid) {
    const byUid = await findByUid(p.uid, userId);
    if (byUid) return byUid;
  }
  const sameName = and(eq(c.ownerId, userId), isNull(c.deletedAt), sql`lower(${c.displayName}) = lower(${p.displayName})`);
  const email = p.emails[0]?.value;
  const phone = p.phones[0]?.value;
  const contact = email
    ? sql`${c.emails} @> ${JSON.stringify([{ value: email }])}::jsonb`
    : phone
      ? sql`${c.phones} @> ${JSON.stringify([{ value: phone }])}::jsonb`
      : sql`jsonb_array_length(${c.emails}) = 0 AND jsonb_array_length(${c.phones}) = 0`;
  const [row] = await db.select({ id: c.id, photoKey: c.photoKey }).from(c).where(and(sameName, contact)).limit(1);
  return row ?? null;
}

async function findByUid(uid: string, userId: string) {
  const asId = uid.match(UUID_RE)?.[1];
  const [row] = await db
    .select({ id: c.id, photoKey: c.photoKey })
    .from(c)
    .where(
      and(
        eq(c.ownerId, userId),
        isNull(c.deletedAt),
        or(
          eq(c.vcardUid, uid),
          sql`${c.mergedUids} @> ${JSON.stringify([uid])}::jsonb`,
          ...(asId ? [eq(c.id, asId), sql`${c.mergedUids} @> ${JSON.stringify([`urn:uuid:${asId}`])}::jsonb`] : []),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

function contactValues(p: ParsedContact) {
  return ensureItemIds({
    givenName: p.givenName,
    familyName: p.familyName,
    displayName: p.displayName,
    nickname: p.nickname,
    organization: p.organization,
    jobTitle: p.jobTitle,
    birthday: p.birthday,
    emails: p.emails,
    phones: p.phones,
    urls: p.urls,
    addresses: p.addresses,
    notes: p.notes,
  });
}

/**
 * Importa un lote de vCards (máx. 500 por petición). La web divide los ficheros grandes
 * en varios lotes y muestra el progreso, así ninguna petición se eterniza.
 */
export const importRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .post("/vcard", zValidator("json", importRequestSchema), async (ctx) => {
    const user = ctx.get("user");
    const req = ctx.req.valid("json");
    const baseTags = await assertOwnTags(req.tagIds, user.id);
    const tagCache = new Map<string, string>();
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, failed: [] };

    for (const card of req.cards) {
      let name = "?";
      try {
        const p = parseVCard(card);
        name = p.displayName;
        const existing = req.onDuplicate === "duplicate" ? null : await findExisting(p, user.id);
        if (existing && req.onDuplicate === "skip") {
          result.skipped++;
          continue;
        }

        let photoKey: string | null = null;
        if (p.photo) photoKey = await savePhoto(p.photo).catch(() => null);
        const coverKey = p.cover ? await saveCover(p.cover).catch(() => null) : null;

        let contactId: string;
        if (existing) {
          const vals = contactValues(p);
          const before = await rawContact(existing.id);
          const [after] = await db
            .update(c)
            .set({
              ...vals,
              ...(photoKey ? { photoKey } : {}),
              ...(coverKey ? { coverKey } : {}),
              updatedAt: new Date(),
              revision: sql`${c.revision} + 1`,
            })
            .where(eq(c.id, existing.id))
            .returning();
          await recordHistory(db, { contactId: existing.id, userId: user.id, action: "update", before, after, meta: { source: "Importación de vCard" } });
          if (photoKey && existing.photoKey) await deletePhoto(existing.photoKey);
          if (coverKey && before?.coverKey) await deletePhoto(before.coverKey);
          await cleanupItemTags(existing.id, itemIdsOf(vals)); // los datos se sustituyen: fuera las etiquetas antiguas
          contactId = existing.id;
          result.updated++;
        } else {
          const [row] = await db
            .insert(c)
            .values({
              ...contactValues(p),
              ownerId: user.id,
              visibility: req.visibility,
              photoKey,
              coverKey,
              vcardUid: p.uid,
            })
            .returning();
          await recordHistory(db, { contactId: row!.id, userId: user.id, action: "create", after: row!, meta: { source: "Importación de vCard" } });
          contactId = row!.id;
          result.created++;
        }

        const tagIds = [...baseTags];
        // «Favoritos» (como lo exporta Agendario) marca el favorito en vez de crear una etiqueta
        const isFav = (x: string) => x.trim().toLowerCase() === FAVORITES_CATEGORY.toLowerCase();
        if (p.categories.some(isFav)) await setFavorite(user.id, contactId, true);
        const cats = p.categories.filter((x) => !isFav(x));
        if (req.categoriesAsTags && cats.length) {
          tagIds.push(...(await ensureTagsByName(cats, user.id, tagCache)));
        }
        await addTags(contactId, [...new Set(tagIds)]);

        if (p.anniversary && !existing) {
          await db.insert(schema.importantDates).values({
            contactId,
            label: "Aniversario",
            type: "anniversary",
            date: p.anniversary,
          });
        }

        if (p.gifts.length && !existing) {
          await db.insert(schema.giftIdeas).values(
            p.gifts.map((g) => ({
              contactId,
              userId: user.id,
              title: g.title,
              url: g.url,
              notes: g.notes,
              given: g.given,
              givenAt: g.given ? g.givenAt : null,
              occasion: (occasions as readonly string[]).includes(g.occasion ?? "") ? (g.occasion as Occasion) : null,
            })),
          );
        }
      } catch (e) {
        result.failed.push({ name, error: (e as Error).message.slice(0, 200) });
      }
    }
    return ctx.json(result);
  });
