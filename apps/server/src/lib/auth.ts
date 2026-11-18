import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { User } from "@agendario/shared";
import { config } from "../config.js";
import { db, schema } from "../db/index.js";

export const SESSION_COOKIE = "agendario_session";

export type AppEnv = { Variables: { user: User } };

export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (hashed: string, password: string) => verify(hashed, password);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createSession(c: Context, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.sessionDays * 86_400_000);
  await db.insert(schema.sessions).values({ id: sha256(token), userId, expiresAt });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function destroySession(c: Context) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Solo administradores. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")?.isAdmin) throw new HTTPException(403, { message: "Solo para administradores" });
  await next();
};

/**
 * Acepta la cookie de sesión (web/PWA) o una cabecera "Authorization: Bearer <token>"
 * (pensado para las apps nativas en el futuro).
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const bearer = c.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1];
  // ?access_token= solo para lo que se abre como enlace o imagen desde la app (fotos, descargas)
  const query = c.req.method === "GET" ? c.req.query("access_token") : undefined;
  const token = bearer ?? query ?? getCookie(c, SESSION_COOKIE);
  if (!token) throw new HTTPException(401, { message: "No autenticado" });

  const [row] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      isAdmin: schema.users.isAdmin,
      mustChangePassword: schema.users.mustChangePassword,
      disabled: schema.users.disabled,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);

  if (!row || row.disabled) throw new HTTPException(401, { message: row?.disabled ? "Usuario desactivado" : "Sesión caducada" });
  const { disabled: _d, ...user } = row;
  c.set("user", user);
  await next();
};
