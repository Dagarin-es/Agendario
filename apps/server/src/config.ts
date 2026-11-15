import { resolve } from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3002),
  databaseUrl: required("DATABASE_URL"),
  dataDir: resolve(process.env.DATA_DIR ?? "./data"),
  /** "open" = cualquiera puede registrarse; "first" = solo el primer usuario (admin); "closed" = nadie. */
  registration: (process.env.REGISTRATION ?? "first") as "open" | "first" | "closed",
  /** Pon "true" si accedes por HTTPS (p. ej. detrás de Nginx Proxy Manager). */
  secureCookies: process.env.SECURE_COOKIES === "true",
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  /** Buscador de direcciones: servidor Photon (OpenStreetMap). Puede ser el público o uno propio. */
  geocoderUrl: (process.env.GEOCODER_URL ?? "https://photon.komoot.io").replace(/\/+$/, ""),
  /** "off" desactiva el buscador de direcciones. */
  geocoderEnabled: process.env.GEOCODER !== "off",
  /** Punto (lat,lon) hacia el que se priorizan los resultados. Por defecto, el centro de España. */
  geocoderBias: process.env.GEOCODER_BIAS ?? "40.2,-3.7",
  webDir: resolve(process.env.WEB_DIR ?? resolve(import.meta.dirname, "../public")),
  migrationsDir: resolve(process.env.MIGRATIONS_DIR ?? resolve(import.meta.dirname, "../drizzle")),
};
