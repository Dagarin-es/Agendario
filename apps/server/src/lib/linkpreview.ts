/**
 * Título e imagen de una página web (para las ideas de regalo): og:image, twitter:image,
 * JSON-LD de producto o <link rel="image_src">. Algunas tiendas bloquean estas lecturas;
 * entonces no hay imagen y el usuario puede subirla a mano.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { LinkPreview } from "@agendario/shared";
import { savePhoto } from "./photos.js";

const UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const MAX_HTML = 2 * 1024 * 1024;
const MAX_IMG = 8 * 1024 * 1024;

/** No se leen direcciones de la red local (evita usar el servidor para curiosear la LAN). */
function privateAddr(ip: string): boolean {
  const v4mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4mapped) return privateAddr(v4mapped[1]!);
  if (ip.includes(":")) {
    const x = ip.toLowerCase();
    return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x) || x.startsWith("64:ff9b:") || x.startsWith("2001:db8");
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
  );
}

async function safeUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Solo enlaces http(s)");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(privateAddr)) throw new Error("Dirección no permitida");
  return u;
}

async function fetchLimited(raw: string, max: number, accept: string) {
  let url = await safeUrl(raw);
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "es-ES,es;q=0.9,en;q=0.6" },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await safeUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > max) break;
      chunks.push(chunk);
    }
    return { url, type: res.headers.get("content-type") ?? "", body: Buffer.concat(chunks) };
  }
  throw new Error("Demasiadas redirecciones");
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).trim();

function meta(html: string, names: string[]) {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']+)["']/i)?.[1];
    if (content) return decode(content);
  }
  return null;
}

function jsonLdImage(html: string): string | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const stack: unknown[] = [JSON.parse(m[1]!)];
      while (stack.length) {
        const v = stack.pop();
        if (Array.isArray(v)) stack.push(...v);
        else if (v && typeof v === "object") {
          const o = v as Record<string, unknown>;
          const t = String(o["@type"] ?? "");
          if (/Product/i.test(t) && o.image) {
            const img = Array.isArray(o.image) ? o.image[0] : o.image;
            const s = typeof img === "string" ? img : (img as { url?: string })?.url;
            if (s) return s;
          }
          stack.push(...Object.values(o));
        }
      }
    } catch {
      /* JSON-LD roto: se ignora */
    }
  }
  return null;
}

export async function linkPreview(raw: string): Promise<LinkPreview> {
  const out: LinkPreview = { url: raw, title: null, image: null };
  const { url, body } = await fetchLimited(raw, MAX_HTML, "text/html,application/xhtml+xml");
  const html = body.toString("utf8");
  out.title = meta(html, ["og:title", "twitter:title"]) ?? (html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1] ? decode(html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)![1]!) : null);
  const img =
    meta(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) ??
    jsonLdImage(html) ??
    html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i)?.[1] ??
    null;
  if (img) out.image = new URL(decode(img), url).toString();
  return out;
}

/** Descarga la imagen y la guarda como foto (miniatura y grande). */
export async function saveImageFromUrl(raw: string): Promise<string> {
  const { type, body } = await fetchLimited(raw, MAX_IMG, "image/avif,image/webp,image/png,image/jpeg,image/*");
  if (type && !type.startsWith("image/")) throw new Error("No es una imagen");
  return savePhoto(body);
}

/** Imagen de la página del enlace, o null si no se puede (sin errores: es un extra). */
export async function imageForLink(url: string): Promise<string | null> {
  try {
    const p = await linkPreview(url);
    return p.image ? await saveImageFromUrl(p.image) : null;
  } catch {
    return null;
  }
}
