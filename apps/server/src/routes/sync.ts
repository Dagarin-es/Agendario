import { zValidator } from "@hono/zod-validator";
import { and, count, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { syncAccountInputSchema, syncConnectSchema, type SyncAccount, type SyncLogEntry, type SyncSummary } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import { assertOwnTags } from "../lib/tags.js";
import { DavError } from "../lib/carddav.js";
import { discoverAddressBooks, isRunning, previewSync, providers, runSync, SyncBlocked } from "../lib/sync.js";

const sa = schema.syncAccounts;
const sl = schema.syncLinks;
const idParam = zValidator("param", z.object({ id: z.string().uuid() }));

function toDto(a: typeof sa.$inferSelect, linked: number): SyncAccount {
  return {
    id: a.id,
    provider: a.provider as SyncAccount["provider"],
    name: a.name,
    serverUrl: a.serverUrl,
    username: a.username,
    hasPassword: !!a.password,
    addressBookUrl: a.addressBookUrl,
    addressBookName: a.addressBookName,
    tagIds: a.tagIds,
    newTagId: a.newTagId,
    intervalMin: a.intervalMin,
    enabled: a.enabled,
    initialized: a.initialized,
    running: isRunning(a.id),
    lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
    lastStatus: isRunning(a.id) ? "running" : a.lastStatus === "running" ? "error" : a.lastStatus,
    lastError: a.lastError,
    lastSummary: (a.lastSummary as SyncSummary | null) ?? null,
    linkedCount: linked,
  };
}

async function own(id: string, userId: string) {
  const [a] = await db.select().from(sa).where(and(eq(sa.id, id), eq(sa.userId, userId)));
  if (!a) throw new HTTPException(404, { message: "Sincronización no encontrada" });
  return a;
}

const serverOf = (b: { provider: keyof typeof providers; serverUrl: string }) => (b.provider === "fastmail" ? providers.fastmail.serverUrl : b.serverUrl);

/** Los errores del servidor remoto se devuelven tal cual (son mensajes para el usuario). */
function davFail(e: unknown): never {
  if (e instanceof DavError || e instanceof SyncBlocked) throw new HTTPException(400, { message: e.message });
  throw e;
}

export const syncRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get("/", async (ctx) => {
    const user = ctx.get("user");
    const rows = await db.select().from(sa).where(eq(sa.userId, user.id)).orderBy(sa.createdAt);
    const counts = await db.select({ id: sl.accountId, n: count() }).from(sl).groupBy(sl.accountId);
    const n = new Map(counts.map((r) => [r.id, r.n]));
    return ctx.json(rows.map((r) => toDto(r, n.get(r.id) ?? 0)));
  })

  // Probar credenciales y listar las libretas de la cuenta
  .post("/discover", zValidator("json", syncConnectSchema), async (ctx) => {
    const user = ctx.get("user");
    const b = ctx.req.valid("json");
    let password = b.password;
    if (!password && b.accountId) password = (await own(b.accountId, user.id)).password;
    if (!password) throw new HTTPException(400, { message: "Falta la contraseña" });
    const server = serverOf(b);
    if (!server) throw new HTTPException(400, { message: "Falta la dirección del servidor" });
    try {
      return ctx.json({ addressBooks: await discoverAddressBooks(server, { username: b.username, password }) });
    } catch (e) {
      davFail(e);
    }
  })

  .post("/", zValidator("json", syncAccountInputSchema), async (ctx) => {
    const user = ctx.get("user");
    const { accountId: _ignored, ...b } = ctx.req.valid("json");
    if (!b.password) throw new HTTPException(400, { message: "Falta la contraseña" });
    await assertOwnTags([...b.tagIds, ...(b.newTagId ? [b.newTagId] : [])], user.id);
    const [a] = await db
      .insert(sa)
      .values({ ...b, userId: user.id, serverUrl: serverOf(b), newTagId: b.newTagId ?? b.tagIds[0]! })
      .returning();
    return ctx.json(toDto(a!, 0), 201);
  })

  .put("/:id", idParam, zValidator("json", syncAccountInputSchema), async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    const old = await own(id, user.id);
    const { accountId: _ignored, ...b } = ctx.req.valid("json");
    await assertOwnTags([...b.tagIds, ...(b.newTagId ? [b.newTagId] : [])], user.id);
    const bookChanged = b.addressBookUrl !== old.addressBookUrl || serverOf(b) !== old.serverUrl || b.username !== old.username;
    const [a] = await db
      .update(sa)
      .set({
        ...b,
        serverUrl: serverOf(b),
        password: b.password || old.password,
        newTagId: b.newTagId ?? b.tagIds[0]!,
        updatedAt: new Date(),
        // Otra libreta u otra cuenta: se empieza de cero (nueva vista previa)
        ...(bookChanged ? { initialized: false, lastStatus: "", lastError: "", lastSummary: null } : {}),
        ...(old.lastStatus.startsWith("blocked") ? { lastStatus: "" } : {}),
      })
      .where(eq(sa.id, id))
      .returning();
    if (bookChanged) await db.delete(sl).where(eq(sl.accountId, id));
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(sl).where(eq(sl.accountId, id));
    return ctx.json(toDto(a!, n));
  })

  .delete("/:id", idParam, async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await own(id, user.id);
    await db.delete(sa).where(eq(sa.id, id)); // los enlaces se borran en cascada; los contactos no se tocan
    return ctx.body(null, 204);
  })

  // Historial: lo último primero (60 días)
  .get("/:id/log", idParam, zValidator("query", z.object({ limit: z.coerce.number().int().min(1).max(5000).default(1000) })), async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await own(id, user.id);
    const lg = schema.syncLog;
    const rows = await db.select().from(lg).where(eq(lg.accountId, id)).orderBy(desc(lg.at), lg.action).limit(ctx.req.valid("query").limit);
    return ctx.json(rows.map((r) => ({ id: r.id, runId: r.runId, action: r.action, contactId: r.contactId, contactName: r.contactName, detail: r.detail, at: r.at.toISOString() })) satisfies SyncLogEntry[]);
  })

  .get("/:id/preview", idParam, async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await own(id, user.id);
    try {
      return ctx.json(await previewSync(id));
    } catch (e) {
      davFail(e);
    }
  })

  .post("/:id/run", idParam, zValidator("json", z.object({ force: z.boolean().default(false) }).default({ force: false })), async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await own(id, user.id);
    if (isRunning(id)) throw new HTTPException(409, { message: "Ya se está sincronizando" });
    try {
      return ctx.json(await runSync(id, { force: ctx.req.valid("json").force }));
    } catch (e) {
      davFail(e);
    }
  });
