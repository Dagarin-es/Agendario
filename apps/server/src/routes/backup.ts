import { zValidator } from "@hono/zod-validator";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { backupConfigSchema, backupDestSchema, type BackupStatus } from "@agendario/shared";
import { oauthAvailable, oauthStatus } from "../lib/oauth.js";
import { config } from "../config.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import {
  connectedTo,
  disconnectOAuth,
  getFile,
  hasRclone,
  isRunning,
  listFiles,
  loadConfig,
  loadSecrets,
  nextRun,
  openArchive,
  recentRuns,
  restoreArchive,
  runBackup,
  saveConfig,
  startOAuth,
  testDestination,
} from "../lib/backup.js";

const fail = (e: unknown, status: 400 | 502 = 400): never => {
  throw new HTTPException(status, { message: (e as Error).message });
};

/** Copias de seguridad: solo para el administrador (copian los datos de todos). */
export const backupRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .use(async (ctx, next) => {
    if (!ctx.get("user").isAdmin) throw new HTTPException(403, { message: "Solo el administrador gestiona las copias de seguridad" });
    await next();
  })

  .get("/", async (ctx) => {
    const cfg = await loadConfig();
    const status: BackupStatus & { running: boolean } = {
      config: cfg,
      nextRun: (await nextRun(cfg))?.toISOString() ?? null,
      runs: await recentRuns(),
      rclone: await hasRclone(),
      oauth: { drive: oauthAvailable("drive"), onedrive: oauthAvailable("onedrive") },
      connected: await connectedTo(),
      running: isRunning(),
    };
    return ctx.json(status);
  })

  .put("/config", zValidator("json", backupConfigSchema), async (ctx) => {
    const body = ctx.req.valid("json");
    const sec = await loadSecrets();
    if (body.enabled && !body.encryptionPassword && !sec.encryptionPassword)
      throw new HTTPException(400, { message: "Pon una contraseña de cifrado para activar las copias" });
    await saveConfig(body).catch((e) => fail(e));
    return ctx.json({ ok: true });
  })

  // Prueba con los datos del formulario (sin guardar); sin cuerpo, prueba lo guardado
  .post("/test", async (ctx) => {
    const raw = await ctx.req.json().catch(() => null);
    const draft = raw ? backupDestSchema.safeParse(raw.dest ?? raw) : null;
    if (draft && !draft.success) throw new HTTPException(400, { message: "Datos del destino no válidos" });
    await testDestination(draft?.data).catch((e) => fail(e, 502));
    return ctx.json({ ok: true });
  })

  .post("/run", async (ctx) => {
    if (isRunning()) throw new HTTPException(409, { message: "Ya hay una copia en marcha" });
    const r = await runBackup("manual").catch((e) => fail(e, 502));
    return ctx.json(r);
  })

  .get("/files", async (ctx) => {
    const cfg = await loadConfig();
    return ctx.json(await listFiles(cfg.dest, await loadSecrets()).catch((e) => fail(e, 502)));
  })

  .get("/files/:name", zValidator("param", z.object({ name: z.string().max(200) })), async (ctx) => {
    const { name } = ctx.req.valid("param");
    const cfg = await loadConfig();
    const dir = await mkdtemp(join(config.dataDir, "tmp", "dl-")).catch(() => fail(new Error("No hay carpeta temporal")));
    const local = join(dir, name);
    await getFile(cfg.dest, await loadSecrets(), name, local).catch((e) => fail(e, 502));
    const size = (await stat(local)).size;
    const stream = createReadStream(local);
    stream.on("close", () => void rm(dir, { recursive: true, force: true }));
    return ctx.body(Readable.toWeb(stream) as ReadableStream, 200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${name}"`,
    });
  })

  // Restaurar: desde una copia del destino (name) o subiendo el fichero (file)
  .post("/restore", async (ctx) => {
    const form = await ctx.req.parseBody();
    const password = String(form["password"] ?? "");
    const confirm = String(form["confirm"] ?? "") === "true";
    if (!password) throw new HTTPException(400, { message: "Falta la contraseña de la copia" });
    let data: Buffer;
    if (form["file"] instanceof File) data = Buffer.from(await (form["file"] as File).arrayBuffer());
    else if (typeof form["name"] === "string") {
      const cfg = await loadConfig();
      const dir = await mkdtemp(join(config.dataDir, "tmp", "rs-"));
      try {
        await getFile(cfg.dest, await loadSecrets(), form["name"], join(dir, "f")).catch((e) => fail(e, 502));
        data = await readFile(join(dir, "f"));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    } else throw new HTTPException(400, { message: "Elige una copia o sube el fichero" });

    const { work, manifest } = await openArchive(data, password).catch((e) => fail(e));
    try {
      // Primero se muestra qué contiene; solo con confirm=true se restaura
      if (!confirm) return ctx.json({ manifest, restored: false });
      await restoreArchive(work);
      return ctx.json({ manifest, restored: true });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  })

  .post("/oauth/start", zValidator("json", z.object({ type: z.enum(["drive", "onedrive"]) })), async (ctx) => {
    const r = await startOAuth(ctx.req.valid("json").type).catch((e) => fail(e, 502));
    return ctx.json(r);
  })
  .get("/oauth/status", (ctx) => ctx.json(oauthStatus()))
  .delete("/oauth", async (ctx) => {
    await disconnectOAuth();
    return ctx.json({ ok: true });
  });
