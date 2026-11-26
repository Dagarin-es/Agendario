import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";

const f = schema.contactFavorites;

/** Ids de los contactos favoritos del usuario (opcionalmente, solo entre los indicados). */
export async function favoritesOf(userId: string, ids?: string[]): Promise<Set<string>> {
  if (ids && !ids.length) return new Set();
  const rows = await db
    .select({ id: f.contactId })
    .from(f)
    .where(ids ? and(eq(f.userId, userId), inArray(f.contactId, ids)) : eq(f.userId, userId));
  return new Set(rows.map((r) => r.id));
}

export async function setFavorite(userId: string, contactId: string, on: boolean) {
  if (on) await db.insert(f).values({ userId, contactId }).onConflictDoNothing();
  else await db.delete(f).where(and(eq(f.userId, userId), eq(f.contactId, contactId)));
}

/** Nombre de la categoría con la que viajan los favoritos en los vCard (CardDAV, Fastmail, .vcf). */
export const FAVORITES_CATEGORY = "Favoritos";

/** Añade o quita «Favoritos» de las líneas CATEGORIES de un bloque de propiedades extra de un vCard. */
export function withFavoriteCategory(extra: string, fav: boolean): string {
  const lines = extra.split("\n").filter(Boolean);
  const cats: string[] = [];
  const rest: string[] = [];
  for (const l of lines) {
    const m = l.match(/^CATEGORIES(;[^:]*)?:(.*)$/i);
    if (m) cats.push(...m[2]!.split(/(?<!\\),/).map((x) => x.trim()).filter(Boolean));
    else rest.push(l);
  }
  const keep = cats.filter((x) => x.toLowerCase() !== FAVORITES_CATEGORY.toLowerCase());
  if (fav) keep.push(FAVORITES_CATEGORY);
  if (keep.length) rest.push(`CATEGORIES:${keep.join(",")}`);
  return rest.join("\n");
}
