import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { visibleContacts } from "./access.js";
import { readPhoto } from "./photos.js";
import { expandTagIds, tagsForContacts } from "./tags.js";
import { itemTagsFor, pickForTag } from "./items.js";
import { toVCard } from "./vcard.js";

/**
 * Genera un .vcf con los contactos visibles para el usuario (todos, o solo los `ids` indicados),
 * con foto, etiquetas (CATEGORIES) y, opcionalmente, sus ideas de regalo.
 */
export async function buildVcf(userId: string, ids: string[] | null, withGifts: boolean, tagId?: string) {
  const ct = schema.contacts;
  const rows: (typeof ct.$inferSelect)[] = [];
  const chunks = ids ? Array.from({ length: Math.ceil(ids.length / 1000) }, (_, i) => ids.slice(i * 1000, i * 1000 + 1000)) : [null];
  for (const chunk of chunks) {
    rows.push(
      ...(await db
        .select()
        .from(ct)
        .where(and(isNull(ct.deletedAt), visibleContacts(userId), chunk ? inArray(ct.id, chunk) : undefined))),
    );
  }
  rows.sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));

  const gifts = withGifts ? await db.select().from(schema.giftIdeas).where(eq(schema.giftIdeas.userId, userId)) : [];
  const tagMap = await tagsForContacts(rows.map((r) => r.id), userId);
  const itemTags = tagId ? await itemTagsFor(rows.map((r) => r.id), userId) : null;
  const tagSet = new Set(tagId ? await expandTagIds(userId, [tagId]) : []); // con sus subetiquetas
  let out = "";
  for (const raw of rows) {
    // Exportar «por etiqueta»: de cada contacto, solo los datos de esa etiqueta (o los generales si no tiene)
    const r = itemTags
      ? {
          ...raw,
          phones: pickForTag(raw.phones, itemTags.get(raw.id), tagSet),
          emails: pickForTag(raw.emails, itemTags.get(raw.id), tagSet),
          addresses: pickForTag(raw.addresses, itemTags.get(raw.id), tagSet),
        }
      : raw;
    const photo = r.photoKey ? await readPhoto(r.photoKey, "full").catch(() => null) : null;
    const extra = gifts
      .filter((x) => x.contactId === r.id)
      .map((x) => ({
        name: "X-CONTACTOS-GIFT",
        value: JSON.stringify({ title: x.title, url: x.url, given: x.given, givenAt: x.givenAt, occasion: x.occasion, notes: x.notes }),
      }));
    out += toVCard({ ...r, photoJpeg: photo, extra, categories: tagMap.get(r.id)?.map((t) => t.name) });
  }
  return { vcf: out, count: rows.length };
}

export const vcfHeaders = (name: string) => ({
  "Content-Type": "text/vcard; charset=utf-8",
  "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.vcf"`,
});
