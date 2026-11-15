import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

const s = schema.settings;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select({ value: s.value }).from(s).where(eq(s.key, key));
  return (row?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db
    .insert(s)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: s.key, set: { value, updatedAt: new Date() } });
}
