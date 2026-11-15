import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

const client = postgres(config.databaseUrl, { max: 10 });
export const db = drizzle(client, { schema });
export type DB = typeof db;
export { schema };

export async function runMigrations() {
  await migrate(db, { migrationsFolder: config.migrationsDir });
}

export async function closeDb() {
  await client.end({ timeout: 5 });
}
