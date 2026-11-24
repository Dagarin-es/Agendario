import { createHash, createHmac, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { User } from "@agendario/shared";
import { config } from "../config.js";
import { db, schema } from "../db/index.js";
import { getSetting, setSetting } from "./settings.js";

export const SESSION_COOKIE = "agendario_session";

export type AppEnv = { Variables: { user: User; sessionId: string } };

export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (hashed: string, password: string) => verify(hashed, password).catch(() => false);

// Hash de una contraseña inventada: si el email no existe se verifica contra él igualmente,
// para que el tiempo de respuesta no delate qué emails están registrados.
let dummyHash: Promise<string> | null = null;
export async function verifyOrDummy(hashed: string | undefined, password: string) {
  if (hashed) return verifyPassword(hashed, password);
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(await dummyHash, password);
  return false;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------- Token de imágenes (solo para la app de Android) ----------
// Las <img> y descargas de la app no pueden llevar cabeceras, así que van con ?mt=…
// Ese token NO es el de la sesión: solo sirve para LEER fotos y descargas (ver MEDIA_PATHS),
// así que aunque quede en un registro de un proxy no permite usar la cuenta.
let mediaSecret: string | null = null;
async function getMediaSecret() {
  if (mediaSecret) return mediaSecret;
  let s = await getSetting<string | null>("auth.mediaSecret", null);
  if (!s) {
    s = randomBytes(32).toString("base64url");
    await setSetting("auth.mediaSecret", s);
  }
  return (mediaSecret = s);
}
export async function mediaTokenFor(sessionId: string) {
  return createHmac("sha256", await getMediaSecret()).update(sessionId).digest("base64url");
}
const MEDIA_PATHS = [
  /^\/api\/contacts\/[\w-]+\/(photo|cover)$/,
  /^\/api\/auth\/avatar$/,
  /^\/api\/personal-events\/[\w-]+\/photo$/,
  /^\/api\/gift-ideas\/[\w-]+\/image$/,
  /^\/api\/attachments\/[\w-]+(\/thumb)?$/,
  /^\/api\/export\/contacts\.vcf$/,
  /^\/api\/calendar\/export\.ics$/,
  /^\/api\/backup\/files\/[^/]+$/,
];

export async function createSession(c: Context, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const id = sha256(token);
  const mediaToken = await mediaTokenFor(id);
  const expiresAt = new Date(Date.now() + config.sessionDays * 86_400_000);
  await db.insert(schema.sessions).values({ id, userId, expiresAt, mediaId: sha256(mediaToken) });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
  return { token, mediaToken };
}

const tokenOf = (c: Context) => c.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? getCookie(c, SESSION_COOKIE);

export async function destroySession(c: Context) {
  // Cookie (web) o Bearer (app de Android): en los dos casos se borra la sesión del servidor
  const token = tokenOf(c);
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Cierra todas las sesiones del usuario salvo, si se indica, la actual. */
export async function closeOtherSessions(userId: string, keepSessionId?: string) {
  const all = await db.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.userId, userId));
  for (const s of all) if (s.id !== keepSessionId) await db.delete(schema.sessions).where(eq(schema.sessions.id, s.id));
}

/** Solo administradores. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")?.isAdmin) throw new HTTPException(403, { message: "Solo para administradores" });
  await next();
};

/**
 * Acepta la cookie de sesión (web/PWA) o la cabecera "Authorization: Bearer <token>" (app de Android).
 * Para fotos y descargas de la app, además, el token de imágenes en ?mt= (solo lectura de esas rutas).
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = tokenOf(c);
  const mt = !token && c.req.method === "GET" && MEDIA_PATHS.some((re) => re.test(c.req.path)) ? c.req.query("mt") : undefined;
  if (!token && !mt) throw new HTTPException(401, { message: "No autenticado" });

  const [row] = await db
    .select({
      sessionId: schema.sessions.id,
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      isAdmin: schema.users.isAdmin,
      mustChangePassword: schema.users.mustChangePassword,
      disabled: schema.users.disabled,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(token ? eq(schema.sessions.id, sha256(token)) : eq(schema.sessions.mediaId, sha256(mt!)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);

  if (!row || row.disabled) throw new HTTPException(401, { message: row?.disabled ? "Usuario desactivado" : "Sesión caducada" });
  const { disabled: _d, sessionId, ...user } = row;
  // Con contraseña provisional solo se puede cambiarla (o salir): el resto de la API espera
  if (user.mustChangePassword && !/^\/api\/auth\/(me|password|logout|avatar)$/.test(c.req.path))
    throw new HTTPException(403, { message: "Antes tienes que cambiar la contraseña provisional" });
  c.set("user", user);
  c.set("sessionId", sessionId);
  await next();
};

/** Borra las sesiones caducadas (una vez al día). */
export function startSessionCleanup() {
  const run = () => db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date())).catch(() => undefined);
  void run();
  setInterval(run, 24 * 3_600_000).unref();
}
