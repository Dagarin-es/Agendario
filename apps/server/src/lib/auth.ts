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
}

export async function destroySession(c: Context) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/**
 * Acepta la cookie de sesión (web/PWA) o una cabecera "Authorization: Bearer <token>"
 * (pensado para las apps nativas en el futuro).
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const bearer = c.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const token = bearer ?? getCookie(c, SESSION_COOKIE);
  if (!token) throw new HTTPException(401, { message: "No autenticado" });

  const [row] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      isAdmin: schema.users.isAdmin,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);

  if (!row) throw new HTTPException(401, { message: "Sesión caducada" });
  c.set("user", row);
  await next();
};
