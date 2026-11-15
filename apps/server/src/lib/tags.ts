import { and, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { TagColor, TagLite } from "@agendario/shared";
import { db, schema } from "../db/index.js";

const t = schema.tags;
const ct = schema.contactTags;

/** Etiquetas del usuario en cada contacto indicado. */
export async function tagsForContacts(contactIds: string[], userId: string): Promise<Map<string, TagLite[]>> {
  const map = new Map<string, TagLite[]>();
  if (!contactIds.length) return map;
  const rows = await db
    .select({ contactId: ct.contactId, id: t.id, name: t.name, color: t.color })
    .from(ct)
    .innerJoin(t, eq(t.id, ct.tagId))
    .where(and(eq(t.userId, userId), inArray(ct.contactId, contactIds)))
    .orderBy(sql`lower(${t.name})`);
  for (const { contactId, ...tag } of rows) {
    const list = map.get(contactId) ?? [];
    list.push(tag);
    map.set(contactId, list);
  }
  return map;
}

/** Comprueba que todas las etiquetas son del usuario. */
export async function assertOwnTags(tagIds: string[], userId: string) {
  const unique = [...new Set(tagIds)];
  if (!unique.length) return unique;
  const rows = await db.select({ id: t.id }).from(t).where(and(eq(t.userId, userId), inArray(t.id, unique)));
  if (rows.length !== unique.length) throw new HTTPException(400, { message: "Etiqueta no válida" });
  return unique;
}

const autoColors: TagColor[] = ["teal", "sky", "violet", "amber", "pink", "green", "orange", "blue", "red", "slate"];

/** Devuelve los ids de las etiquetas con esos nombres, creando las que falten. */
export async function ensureTagsByName(names: string[], userId: string, cache = new Map<string, string>()) {
  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim().slice(0, 50);
    if (!name) continue;
    const key = name.toLowerCase();
    let id = cache.get(key);
    if (!id) {
      const [found] = await db
        .select({ id: t.id })
        .from(t)
        .where(and(eq(t.userId, userId), sql`lower(${t.name}) = ${key}`));
      id = found?.id;
      if (!id) {
        const color = autoColors[[...key].reduce((a, ch) => a + ch.charCodeAt(0), 0) % autoColors.length];
        const [created] = await db
          .insert(t)
          .values({ userId, name, color })
          .onConflictDoNothing()
          .returning({ id: t.id });
        id =
          created?.id ??
          (await db.select({ id: t.id }).from(t).where(and(eq(t.userId, userId), sql`lower(${t.name}) = ${key}`)))[0]!.id;
      }
      cache.set(key, id);
    }
    ids.push(id);
  }
  return [...new Set(ids)];
}

export async function addTags(contactId: string, tagIds: string[]) {
  if (!tagIds.length) return;
  await db
    .insert(ct)
    .values(tagIds.map((tagId) => ({ contactId, tagId })))
    .onConflictDoNothing();
}
