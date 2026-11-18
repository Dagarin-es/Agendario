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
import { listExports } from "../lib/nfs.js";
import { config } from "../config.js";
import { db, schema } from "../db/index.js";
import { and, eq, ne } from "drizzle-orm";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import {
  connectedTo,
  createJob,
  deleteJob,
  disconnectOAuth,
  jobExists,
  listJobs,
  renameJob,
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

/** Copia sobre la que se trabaja: ?job=… (sin él, la principal). */
async function jobOf(ctx: { req: { query: (k: string) => string | undefined } }) {
  const job = ctx.req.query("job") || "main";
  if (!(await jobExists(job))) throw new HTTPException(404, { message: "No existe esa copia" });
  return job;
}

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

  // Lista de copias (cada una es una pestaña)
  .get("/jobs", async (ctx) => {
    const jobs = await listJobs();
    return ctx.json(await Promise.all(jobs.map(async (j) => {
      const cfg = await loadConfig(j.id);
      const [last] = await recentRuns(j.id);
      return { ...j, enabled: cfg.enabled, lastStatus: last?.status ?? null };
    })));
  })
  .post("/jobs", zValidator("json", z.object({ name: z.string().trim().min(1).max(60) })), async (ctx) => ctx.json(await createJob(ctx.req.valid("json").name), 201))
  .patch("/jobs/:id", zValidator("json", z.object({ name: z.string().trim().min(1).max(60) })), async (ctx) => {
    await renameJob(ctx.req.param("id"), ctx.req.valid("json").name).catch((e) => fail(e));
    return ctx.json({ ok: true });
  })
  .delete("/jobs/:id", async (ctx) => {
    await deleteJob(ctx.req.param("id")).catch((e) => fail(e));
    return ctx.json({ ok: true });
  })

  .get("/", async (ctx) => {
    const job = await jobOf(ctx);
    const cfg = await loadConfig(job);
    const status: BackupStatus & { running: boolean } = {
      config: cfg,
      nextRun: (await nextRun(cfg, job))?.toISOString() ?? null,
      runs: await recentRuns(job),
      rclone: await hasRclone(),
      oauth: { drive: oauthAvailable("drive") },
      connected: await connectedTo(job),
      running: isRunning(job),
    };
    return ctx.json(status);
  })

  .put("/config", zValidator("json", backupConfigSchema), async (ctx) => {
    const job = await jobOf(ctx);
    const body = ctx.req.valid("json");
    const sec = await loadSecrets(job);
    if (body.enabled && !body.encryptionPassword && !sec.encryptionPassword)
      throw new HTTPException(400, { message: "Pon una contraseña de cifrado para activar las copias" });
    await saveConfig(body, job).catch((e) => fail(e));
    return ctx.json({ ok: true });
  })

  // Prueba con los datos del formulario (sin guardar); sin cuerpo, prueba lo guardado
  .post("/test", async (ctx) => {
    const raw = await ctx.req.json().catch(() => null);
    const draft = raw ? backupDestSchema.safeParse(raw.dest ?? raw) : null;
    if (draft && !draft.success) throw new HTTPException(400, { message: "Datos del destino no válidos" });
    await testDestination(draft?.data, await jobOf(ctx)).catch((e) => fail(e, 502));
    return ctx.json({ ok: true });
  })

  // Carpetas que exporta un servidor NFS (para elegir de una lista)
  .get("/nfs/exports", zValidator("query", z.object({ host: z.string().trim().min(1).max(255) })), async (ctx) => {
    const list = await listExports(ctx.req.valid("query").host).catch((e) => fail(e, 502));
    return ctx.json(list);
  })

  .post("/run", async (ctx) => {
    const job = await jobOf(ctx);
    if (isRunning(job)) throw new HTTPException(409, { message: "Ya hay una copia en marcha" });
    const r = await runBackup("manual", job).catch((e) => fail(e, 502));
    return ctx.json(r);
  })

  .get("/files", async (ctx) => {
    const job = await jobOf(ctx);
    const cfg = await loadConfig(job);
    return ctx.json(await listFiles(cfg.dest, await loadSecrets(job)).catch((e) => fail(e, 502)));
  })

  .get("/files/:name", zValidator("param", z.object({ name: z.string().max(200) })), async (ctx) => {
    const { name } = ctx.req.valid("param");
    const job = await jobOf(ctx);
    const cfg = await loadConfig(job);
    const dir = await mkdtemp(join(config.dataDir, "tmp", "dl-")).catch(() => fail(new Error("No hay carpeta temporal")));
    const local = join(dir, name);
    await getFile(cfg.dest, await loadSecrets(job), name, local).catch((e) => fail(e, 502));
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
      const job = await jobOf(ctx);
      const cfg = await loadConfig(job);
      const dir = await mkdtemp(join(config.dataDir, "tmp", "rs-"));
      try {
        await getFile(cfg.dest, await loadSecrets(job), form["name"], join(dir, "f")).catch((e) => fail(e, 502));
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

  .post("/oauth/start", zValidator("json", z.object({ type: z.enum(["drive"]) })), async (ctx) => {
    const r = await startOAuth(ctx.req.valid("json").type, await jobOf(ctx)).catch((e) => fail(e, 502));
    return ctx.json(r);
  })
  .get("/oauth/status", (ctx) => ctx.json(oauthStatus()))
  // Vaciar el registro de copias (las copias guardadas no se tocan; deja la que esté en marcha)
  .delete("/runs", async (ctx) => {
    await db.delete(schema.backupRuns).where(and(ne(schema.backupRuns.status, "running"), eq(schema.backupRuns.jobId, await jobOf(ctx))));
    return ctx.json({ ok: true });
  })
  .delete("/oauth", async (ctx) => {
    await disconnectOAuth(await jobOf(ctx));
    return ctx.json({ ok: true });
  });
