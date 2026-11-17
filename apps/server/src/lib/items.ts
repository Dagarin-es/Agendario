import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { TagLite } from "@agendario/shared";
import { db, schema } from "../db/index.js";

/**
 * Datos «multivalor» de un contacto (teléfonos, emails, webs, direcciones). Cada elemento lleva un
 * `id` estable para poder asociarle una etiqueta personal.
 */
type WithId = { id?: string };
export type ItemLists = { phones?: WithId[]; emails?: WithId[]; urls?: WithId[]; addresses?: WithId[] };

/** Asigna id a los elementos que no lo tengan (nuevos o importados). Devuelve una copia. */
export function ensureItemIds<T extends ItemLists>(v: T): T {
  const out = { ...v };
  for (const k of ["phones", "emails", "urls", "addresses"] as const) {
    const list = v[k];
    if (list) (out as ItemLists)[k] = list.map((x) => (x.id ? x : { ...x, id: randomUUID() }));
  }
  return out;
}

export function itemIdsOf(v: ItemLists): string[] {
  return (["phones", "emails", "urls", "addresses"] as const).flatMap((k) => (v[k] ?? []).map((x) => x.id!).filter(Boolean));
}

/** Borra las etiquetas de datos que ya no existen en el contacto (de cualquier usuario). */
export async function cleanupItemTags(contactId: string, currentIds: string[]) {
  const t = schema.contactItemTags;
  await db
    .delete(t)
    .where(and(eq(t.contactId, contactId), currentIds.length ? notInArray(t.itemId, currentIds) : undefined));
}

/** Etiquetas de cada dato, para el usuario: contactId → (itemId → etiqueta). */
export async function itemTagsFor(contactIds: string[], userId: string) {
  const map = new Map<string, Record<string, TagLite>>();
  if (!contactIds.length) return map;
  const it = schema.contactItemTags;
  const tg = schema.tags;
  for (let i = 0; i < contactIds.length; i += 1000) {
    const rows = await db
      .select({ contactId: it.contactId, itemId: it.itemId, id: tg.id, name: tg.name, color: tg.color })
      .from(it)
      .innerJoin(tg, eq(tg.id, it.tagId))
      .where(and(eq(it.userId, userId), inArray(it.contactId, contactIds.slice(i, i + 1000))));
    for (const r of rows) {
      const m = map.get(r.contactId) ?? {};
      m[r.itemId] = { id: r.id, name: r.name, color: r.color };
      map.set(r.contactId, m);
    }
  }
  return map;
}

/**
 * Regla para filtrar/exportar por una etiqueta: de cada tipo de dato se usan los que tienen esa
 * etiqueta; si no hay ninguno, los que no tienen etiqueta. Los de otras etiquetas nunca.
 */
export function pickForTag<T extends WithId>(items: T[], tags: Record<string, TagLite> | undefined, tagId: string | Set<string>): T[] {
  const match = (id: string | undefined) => !!id && (typeof tagId === "string" ? id === tagId : tagId.has(id));
  const withTag = items.filter((x) => x.id && match(tags?.[x.id]?.id));
  if (withTag.length) return withTag;
  return items.filter((x) => !x.id || !tags?.[x.id]);
}
