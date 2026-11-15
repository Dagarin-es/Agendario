import { zValidator } from "@hono/zod-validator";
import { count, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { loginSchema, registerSchema } from "@agendario/shared";
import { config } from "../config.js";
import { db, schema } from "../db/index.js";
import {
  createSession,
  destroySession,
  hashPassword,
  requireAuth,
  verifyPassword,
  type AppEnv,
} from "../lib/auth.js";

const u = schema.users;

async function userCount() {
  const [{ n }] = await db.select({ n: count() }).from(u);
  return n;
}

export const authRoutes = new Hono<AppEnv>()
  /** Indica a la web si debe mostrar el formulario de registro. */
  .get("/status", async (c) => {
    const n = await userCount();
    const canRegister = config.registration === "open" || (config.registration === "first" && n === 0);
    return c.json({ canRegister, firstUser: n === 0 });
  })

  .post("/register", zValidator("json", registerSchema), async (c) => {
    const body = c.req.valid("json");
    const n = await userCount();
    const allowed = config.registration === "open" || (config.registration === "first" && n === 0);
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

    await createSession(c, user.id);
    return c.json(user, 201);
  })

  .post("/login", zValidator("json", loginSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const [user] = await db.select().from(u).where(sql`lower(${u.email}) = lower(${email})`);
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw new HTTPException(401, { message: "Email o contraseña incorrectos" });
    }
    await createSession(c, user.id);
    return c.json({ id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin });
  })

  .post("/logout", async (c) => {
    await destroySession(c);
    return c.body(null, 204);
  })

  .get("/me", requireAuth, (c) => c.json(c.get("user")));

/** Lista mínima de usuarios, para elegir con quién compartir. */
export const userRoutes = new Hono<AppEnv>().use(requireAuth).get("/", async (c) => {
  const me = c.get("user");
  const rows = await db.select({ id: u.id, name: u.name, email: u.email }).from(u).orderBy(u.name);
  return c.json(rows.filter((r) => r.id !== me.id));
});
