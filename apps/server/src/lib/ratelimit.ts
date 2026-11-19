/**
 * Límite de intentos fallidos (inicio de sesión, CardDAV) para frenar ataques de fuerza bruta.
 * En memoria: se reinicia al reiniciar el servidor, suficiente para una instancia autoalojada.
 */
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

interface Bucket {
  fails: number;
  until: number;
}
const buckets = new Map<string, Bucket>();
const WINDOW = 15 * 60_000;

/** IP del cliente: la que añade el proxy inverso (Nginx Proxy Manager) o la de la conexión. */
export function clientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip");
  if (fwd) return fwd;
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? "?";
}

function blocked(key: string, max: number) {
  const b = buckets.get(key);
  if (!b) return 0;
  if (b.until < Date.now()) {
    buckets.delete(key);
    return 0;
  }
  return b.fails >= max ? Math.ceil((b.until - Date.now()) / 60_000) : 0;
}

/**
 * Comprueba antes de intentar: por cuenta (10 fallos en 15 min) y por IP (30 fallos en 15 min).
 * Devuelve los minutos que faltan si está bloqueado, o 0.
 */
export function checkLimit(account: string, ip: string): number {
  return Math.max(blocked(`a:${account.toLowerCase()}`, 10), blocked(`i:${ip}`, 30));
}

export function assertNotLimited(account: string, ip: string) {
  const min = checkLimit(account, ip);
  if (min) throw new HTTPException(429, { message: `Demasiados intentos fallidos. Vuelve a probar dentro de ${min} min.` });
}

export function registerFail(account: string, ip: string) {
  for (const key of [`a:${account.toLowerCase()}`, `i:${ip}`]) {
    const b = buckets.get(key);
    if (!b || b.until < Date.now()) buckets.set(key, { fails: 1, until: Date.now() + WINDOW });
    else b.fails++;
  }
}

export function registerSuccess(account: string) {
  buckets.delete(`a:${account.toLowerCase()}`);
}

// Limpieza periódica de entradas caducadas
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.until < now) buckets.delete(k);
}, 10 * 60_000).unref();
