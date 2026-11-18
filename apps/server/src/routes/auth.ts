import { zValidator } from "@hono/zod-validator";
import { and, count, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { adminUserCreateSchema, adminUserPatchSchema, changePasswordSchema, loginSchema, registerSchema, registrationModes, type AdminUser, type RegistrationMode } from "@agendario/shared";
import { getSetting, setSetting } from "../lib/settings.js";
import { config } from "../config.js";
import { db, schema } from "../db/index.js";
import {
  createSession,
  destroySession,
  hashPassword,
  requireAdmin,
  requireAuth,
  verifyPassword,
  type AppEnv,
} from "../lib/auth.js";

const u = schema.users;

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

    const token = await createSession(c, user!.id);
    return c.json({ ...user, ...(wantsToken(c.req.header("x-agendario-client")) ? { token } : {}) }, 201);
  })

  .post("/login", zValidator("json", loginSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const [user] = await db.select().from(u).where(sql`lower(${u.email}) = lower(${email})`);
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw new HTTPException(401, { message: "Email o contraseña incorrectos" });
    }
    if (user.disabled) throw new HTTPException(403, { message: "Tu usuario está desactivado. Habla con el administrador." });
    const token = await createSession(c, user.id);
    return c.json({
      id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin, mustChangePassword: user.mustChangePassword,
      ...(wantsToken(c.req.header("x-agendario-client")) ? { token } : {}),
    });
  })

  .post("/logout", async (c) => {
    await destroySession(c);
    return c.body(null, 204);
  })

  .get("/me", requireAuth, (c) => c.json(c.get("user")))

  // Cambiar mi contraseña
  .post("/password", requireAuth, zValidator("json", changePasswordSchema), async (c) => {
    const me = c.get("user");
    const { current, password } = c.req.valid("json");
    const [row] = await db.select().from(u).where(eq(u.id, me.id));
    if (!row || !(await verifyPassword(row.passwordHash, current))) throw new HTTPException(400, { message: "La contraseña actual no es correcta" });
    await db.update(u).set({ passwordHash: await hashPassword(password), mustChangePassword: false, updatedAt: new Date() }).where(eq(u.id, me.id));
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
    if (b.disabled === true || (b.password && id !== me.id)) await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
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
