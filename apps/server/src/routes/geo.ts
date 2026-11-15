import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { APP_VERSION, type GeoSuggestion } from "@agendario/shared";
import { config } from "../config.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";

/**
 * Buscador de direcciones. El navegador pregunta a nuestro servidor y este a Photon
 * (geocodificador de OpenStreetMap): así se respeta su uso razonable (caché y un ritmo
 * máximo) y, si algún día se usa un servicio con clave, la clave no sale del servidor.
 */

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
};

const cache = new Map<string, { at: number; data: GeoSuggestion[] }>();
const CACHE_MS = 24 * 3600_000;
const CACHE_MAX = 500;
let lastCall = 0;

/** Reparte un resultado de Photon en los campos de una dirección. */
export function toSuggestion(f: PhotonFeature): GeoSuggestion | null {
  const p = f.properties;
  const [lon, lat] = f.geometry?.coordinates ?? [];
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  const isStreetLike = ["house", "street"].includes(p.type ?? "") || !!p.housenumber;
  const streetName = p.street ?? (isStreetLike ? p.name : undefined) ?? "";
  const street = [streetName, p.housenumber].filter(Boolean).join(", ");
  // Un lugar con nombre (empresa, edificio…) que no es la calle: se antepone
  const place = p.name && p.name !== streetName && p.name !== p.city && p.type !== "street" ? p.name : "";
  const city = p.city ?? p.town ?? p.village ?? p.locality ?? p.district ?? (["city", "town", "village"].includes(p.type ?? "") ? p.name : "") ?? "";
  // En España la provincia viene en «county» y la comunidad en «state»
  const region = (p.countrycode === "ES" ? p.county ?? p.state : p.state ?? p.county) ?? "";
  const s: GeoSuggestion = {
    label: "",
    street: street || place,
    city,
    region,
    postalCode: p.postcode ?? "",
    country: p.country ?? "",
    lat,
    lon,
  };
  s.label = [place && street ? place : "", s.street, [s.postalCode, s.city].filter(Boolean).join(" "), s.region !== s.city ? s.region : "", s.country]
    .filter(Boolean)
    .join(", ");
  return s;
}

export const geoRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/config", (ctx) => ctx.json({ enabled: config.geocoderEnabled }))
  .get("/search", zValidator("query", z.object({ q: z.string().trim().min(3).max(200) })), async (ctx) => {
    if (!config.geocoderEnabled) throw new HTTPException(404, { message: "El buscador de direcciones está desactivado" });
    const q = ctx.req.valid("query").q;
    const key = q.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return ctx.json(hit.data);

    // Como mucho una consulta por segundo al servicio externo
    const wait = lastCall + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();

    const url = new URL(`${config.geocoderUrl}/api`);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", "8");
    const [lat, lon] = config.geocoderBias.split(",").map((x) => Number(x.trim()));
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lon));
      url.searchParams.set("zoom", "6");
      url.searchParams.set("location_bias_scale", "0.3");
    }
    let features: PhotonFeature[];
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": `Contactos/${APP_VERSION} (autoalojado)`, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      features = ((await res.json()) as { features?: PhotonFeature[] }).features ?? [];
    } catch (e) {
      console.warn("Buscador de direcciones:", (e as Error).message);
      throw new HTTPException(502, { message: "No se ha podido consultar el buscador de direcciones. Inténtalo de nuevo en un momento." });
    }
    const seen = new Set<string>();
    const data = features
      .map(toSuggestion)
      .filter((s): s is GeoSuggestion => !!s && !!(s.street || s.city))
      .filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true)))
      .slice(0, 6);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), data });
    return ctx.json(data);
  });
