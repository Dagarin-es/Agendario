import { zValidator } from "@hono/zod-validator";
import { and, count, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHash } from "node:crypto";
import { adminUserCreateSchema, adminUserPatchSchema, changePasswordSchema, loginSchema, registerSchema, registrationModes, type AdminUser, type AppPassword, type RegistrationMode, type User } from "@agendario/shared";
import { getSetting, setSetting } from "../lib/settings.js";
import { deletePhoto, photoType, readPhoto, storeUpload } from "../lib/photos.js";
import { config } from "../config.js";
import { db, schema } from "../db/index.js";
import { randomBytes } from "node:crypto";
import {
  closeOtherSessions,
  createSession,
  destroySession,
  hashPassword,
  mediaTokenFor,
  requireAdmin,
  requireAuth,
  verifyOrDummy,
  verifyPassword,
  type AppEnv,
} from "../lib/auth.js";
import { assertNotLimited, clientIp, registerFail, registerSuccess } from "../lib/ratelimit.js";
import { forgetDavCredentials } from "./dav.js";

const u = schema.users;
const ap = schema.appPasswords;

/** Clave de la foto de perfil: la propia o la de «mi ficha» (si sigue siendo mía y no está en la papelera). */
async function avatarKey(userId: string): Promise<string | null> {
  const [row] = await db.select({ photoKey: u.photoKey, meContactId: u.meContactId }).from(u).where(eq(u.id, userId));
  if (!row) return null;
  if (row.photoKey) return row.photoKey;
  if (!row.meContactId) return null;
  const [ct] = await db.select({ photoKey: schema.contacts.photoKey }).from(schema.contacts)
    .where(and(eq(schema.contacts.id, row.meContactId), eq(schema.contacts.ownerId, userId), isNull(schema.contacts.deletedAt)));
  return ct?.photoKey ?? null;
}

async function profileOf(user: User): Promise<User> {
  const [row] = await db.select({ meContactId: u.meContactId, photoKey: u.photoKey }).from(u).where(eq(u.id, user.id));
  return { ...user, avatar: await avatarKey(user.id), avatarOwn: !!row?.photoKey, meContactId: row?.meContactId ?? null };
}

async function userCount() {
  const [{ n }] = await db.select({ n: count() }).from(u);
  return n;
}

/** Modo de registro: el que elija el administrador en Ajustes o, si no, el del .env. */
const registrationMode = () => getSetting<RegistrationMode>("auth.registration", config.registration);
const wantsToken = (h: string | undefined) => h === "app"; // la app de Android pide el token en la respuesta

export const authRoutes = new Hono<AppEnv>()
  /** Indica a la web si debe mostrar el formulario de registro. */
  .get("/status", async (c) => {
    const n = await userCount();
    const mode = await registrationMode();
    const canRegister = mode === "open" || (mode === "first" && n === 0);
    return c.json({ canRegister, firstUser: n === 0 });
  })

  .post("/register", zValidator("json", registerSchema), async (c) => {
    const body = c.req.valid("json");
    const n = await userCount();
    const mode = await registrationMode();
    const allowed = mode === "open" || (mode === "first" && n === 0);
    if (!allowed) throw new HTTPException(403, { message: "El registro está cerrado" });

    const [exists] = await db.select({ id: u.id }).from(u).where(sql`lower(${u.email}) = lower(${body.email})`);
    if (exists) throw new HTTPException(409, { message: "Ese email ya está registrado" });

    const [user] = await db
      .insert(u)
      .values({
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        isAdmin: n === 0, // el primer usuario es administrador
      })
      .returning({ id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin });

    const s = await createSession(c, user!.id);
    return c.json({ ...user, ...(wantsToken(c.req.header("x-agendario-client")) ? s : {}) }, 201);
  })

  .post("/login", zValidator("json", loginSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const ip = clientIp(c);
    assertNotLimited(email, ip); // freno a la fuerza bruta: 10 fallos por cuenta / 30 por IP en 15 min
    const [user] = await db.select().from(u).where(sql`lower(${u.email}) = lower(${email})`);
    if (!(await verifyOrDummy(user?.passwordHash, password)) || !user) {
      registerFail(email, ip);
      throw new HTTPException(401, { message: "Email o contraseña incorrectos" });
    }
    registerSuccess(email);
    if (user.disabled) throw new HTTPException(403, { message: "Tu usuario está desactivado. Habla con el administrador." });
    const s = await createSession(c, user.id);
    return c.json({
      ...(await profileOf({ id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin, mustChangePassword: user.mustChangePassword })),
      ...(wantsToken(c.req.header("x-agendario-client")) ? s : {}),
    });
  })

  .post("/logout", async (c) => {
    await destroySession(c);
    return c.body(null, 204);
  })

  .get("/me", requireAuth, async (c) => {
    const me = await profileOf(c.get("user"));
    // La app recibe aquí su token de imágenes (también las sesiones abiertas antes de existir)
    if (!wantsToken(c.req.header("x-agendario-client"))) return c.json(me);
    const sid = c.get("sessionId");
    const mediaToken = await mediaTokenFor(sid);
    await db.update(schema.sessions).set({ mediaId: createHash("sha256").update(mediaToken).digest("hex") }).where(eq(schema.sessions.id, sid));
    return c.json({ ...me, mediaToken });
  })

  /** Cierra la sesión en todos los demás dispositivos y navegadores. */
  .post("/sessions/close-others", requireAuth, async (c) => {
    await closeOtherSessions(c.get("user").id, c.get("sessionId"));
    return c.json({ ok: true });
  })

  // ---------- Contraseñas de aplicación (para DAVx⁵, Outlook… por CardDAV) ----------
  .get("/app-passwords", requireAuth, async (c) => {
    const rows = await db.select({ id: ap.id, name: ap.name, hint: ap.hint, lastUsedAt: ap.lastUsedAt, createdAt: ap.createdAt })
      .from(ap).where(eq(ap.userId, c.get("user").id)).orderBy(ap.createdAt);
    return c.json(rows.map((r) => ({ ...r, lastUsedAt: r.lastUsedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() })) satisfies AppPassword[]);
  })
  .post("/app-passwords", requireAuth, zValidator("json", z.object({ name: z.string().trim().min(1).max(60) })), async (c) => {
    const me = c.get("user");
    const [{ n }] = await db.select({ n: count() }).from(ap).where(eq(ap.userId, me.id));
    if (n >= 20) throw new HTTPException(400, { message: "Como mucho 20 contraseñas de aplicación" });
    // 4 grupos de 4 letras/números fáciles de teclear (sin 0/O/1/l/I): ~80 bits de entropía
    const abc = "abcdefghjkmnpqrstuvwxyz23456789";
    const raw = randomBytes(16);
    const pass = Array.from(raw, (b) => abc[b % abc.length]).join("").replace(/(.{4})(?=.)/g, "$1-");
    const [row] = await db.insert(ap).values({ userId: me.id, name: c.req.valid("json").name, hash: await hashPassword(pass), hint: pass.slice(0, 4) }).returning({ id: ap.id });
    forgetDavCredentials(me.id);
    // Se muestra UNA vez: después solo queda su hash
    return c.json({ id: row!.id, password: pass }, 201);
  })
  .delete("/app-passwords/:id", requireAuth, zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
    const me = c.get("user");
    await db.delete(ap).where(and(eq(ap.id, c.req.valid("param").id), eq(ap.userId, me.id)));
    forgetDavCredentials(me.id);
    return c.body(null, 204);
  })

  // Foto de perfil: la propia o, si no hay, la de «mi ficha»
  .get("/avatar", requireAuth, zValidator("query", z.object({ size: z.enum(["full", "thumb"]).default("thumb") })), async (c) => {
    const key = await avatarKey(c.get("user").id);
    if (!key) throw new HTTPException(404, { message: "Sin foto" });
    const data = await readPhoto(key, c.req.valid("query").size);
    return c.body(new Uint8Array(data), 200, { "Content-Type": photoType(key), "Cache-Control": "private, max-age=86400", ETag: `"${key}"` });
  })
  .put("/avatar", requireAuth, async (c) => {
    const me = c.get("user");
    const key = await storeUpload(c);
    const [old] = await db.select({ photoKey: u.photoKey }).from(u).where(eq(u.id, me.id));
    await db.update(u).set({ photoKey: key, updatedAt: new Date() }).where(eq(u.id, me.id));
    if (old?.photoKey) await deletePhoto(old.photoKey);
    return c.json(await profileOf(me));
  })
  .delete("/avatar", requireAuth, async (c) => {
    const me = c.get("user");
    const [old] = await db.select({ photoKey: u.photoKey }).from(u).where(eq(u.id, me.id));
    await db.update(u).set({ photoKey: null, updatedAt: new Date() }).where(eq(u.id, me.id));
    if (old?.photoKey) await deletePhoto(old.photoKey);
    return c.json(await profileOf(me));
  })
  // «Mi ficha»: uno de mis contactos
  .put("/me-contact", requireAuth, zValidator("json", z.object({ contactId: z.string().uuid().nullable() })), async (c) => {
    const me = c.get("user");
    const { contactId } = c.req.valid("json");
    if (contactId) {
      const [ct] = await db.select({ id: schema.contacts.id }).from(schema.contacts)
        .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.ownerId, me.id), isNull(schema.contacts.deletedAt)));
      if (!ct) throw new HTTPException(404, { message: "Ese contacto no es tuyo" });
    }
    await db.update(u).set({ meContactId: contactId, updatedAt: new Date() }).where(eq(u.id, me.id));
    return c.json(await profileOf(me));
  })

  // Cambiar mi contraseña
  .post("/password", requireAuth, zValidator("json", changePasswordSchema), async (c) => {
    const me = c.get("user");
    const { current, password } = c.req.valid("json");
    const [row] = await db.select().from(u).where(eq(u.id, me.id));
    if (!row || !(await verifyPassword(row.passwordHash, current))) throw new HTTPException(400, { message: "La contraseña actual no es correcta" });
    await db.update(u).set({ passwordHash: await hashPassword(password), mustChangePassword: false, updatedAt: new Date() }).where(eq(u.id, me.id));
    // Cambiar la contraseña cierra las demás sesiones (otros navegadores, móviles) y el acceso CardDAV en caché
    await closeOtherSessions(me.id, c.get("sessionId"));
    forgetDavCredentials(me.id);
    return c.json({ ok: true });
  });

// ---------- Administración de usuarios (solo administradores) ----------

const idParam = zValidator("param", z.object({ id: z.string().uuid() }));

async function adminCount(exceptId?: string) {
  const [{ n }] = await db.select({ n: count() }).from(u).where(and(eq(u.isAdmin, true), eq(u.disabled, false), exceptId ? ne(u.id, exceptId) : undefined));
  return n;
}

export const adminRoutes = new Hono<AppEnv>()
  .use(requireAuth, requireAdmin)
  .get("/users", async (c) => {
    const ct = schema.contacts;
    const users = await db
      .select({ id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin, disabled: u.disabled, mustChangePassword: u.mustChangePassword, createdAt: u.createdAt })
      .from(u)
      .orderBy(u.name);
    const counts = await db
      .select({ ownerId: ct.ownerId, n: sql<number>`count(*)::int` })
      .from(ct)
      .where(isNull(ct.deletedAt))
      .groupBy(ct.ownerId);
    const byOwner = new Map(counts.map((r) => [r.ownerId, r.n]));
    const rows = users.map((r) => ({ ...r, contactCount: byOwner.get(r.id) ?? 0 }));
    return c.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) satisfies AdminUser[]);
  })
  .post("/users", zValidator("json", adminUserCreateSchema), async (c) => {
    const b = c.req.valid("json");
    const [exists] = await db.select({ id: u.id }).from(u).where(sql`lower(${u.email}) = lower(${b.email})`);
    if (exists) throw new HTTPException(409, { message: "Ese email ya está registrado" });
    const [row] = await db
      .insert(u)
      .values({ email: b.email, name: b.name, passwordHash: await hashPassword(b.password), isAdmin: b.isAdmin, mustChangePassword: true })
      .returning({ id: u.id });
    return c.json({ id: row!.id }, 201);
  })
  .patch("/users/:id", idParam, zValidator("json", adminUserPatchSchema), async (c) => {
    const me = c.get("user");
    const { id } = c.req.valid("param");
    const b = c.req.valid("json");
    if (id === me.id && (b.disabled === true || b.isAdmin === false)) throw new HTTPException(400, { message: "No puedes desactivarte ni quitarte el permiso de administrador a ti mismo" });
    if ((b.disabled === true || b.isAdmin === false) && (await adminCount(id)) === 0) {
      const [target] = await db.select({ isAdmin: u.isAdmin }).from(u).where(eq(u.id, id));
      if (target?.isAdmin) throw new HTTPException(400, { message: "Tiene que quedar al menos un administrador" });
    }
    const set: Partial<typeof u.$inferInsert> = { updatedAt: new Date() };
    if (b.name !== undefined) set.name = b.name;
    if (b.isAdmin !== undefined) set.isAdmin = b.isAdmin;
    if (b.disabled !== undefined) set.disabled = b.disabled;
    if (b.password) Object.assign(set, { passwordHash: await hashPassword(b.password), mustChangePassword: id !== me.id });
    const [row] = await db.update(u).set(set).where(eq(u.id, id)).returning({ id: u.id });
    if (!row) throw new HTTPException(404, { message: "Usuario no encontrado" });
    // Desactivar o cambiar la contraseña cierra sus sesiones abiertas
    if (b.disabled === true || (b.password && id !== me.id)) {
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
      forgetDavCredentials(id);
    }
    return c.json({ ok: true });
  })
  .get("/registration", async (c) => c.json({ mode: await registrationMode() }))
  .put("/registration", zValidator("json", z.object({ mode: z.enum(registrationModes) })), async (c) => {
    await setSetting("auth.registration", c.req.valid("json").mode);
    return c.json({ ok: true });
  });

/** Lista mínima de usuarios, para elegir con quién compartir. */
export const userRoutes = new Hono<AppEnv>().use(requireAuth).get("/", async (c) => {
  const me = c.get("user");
  const rows = await db.select({ id: u.id, name: u.name, email: u.email }).from(u).orderBy(u.name);
  return c.json(rows.filter((r) => r.id !== me.id));
});
