import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { APP_VERSION } from "@agendario/shared";
import { config } from "./config.js";
import { closeDb, runMigrations } from "./db/index.js";
import { adminRoutes, authRoutes, userRoutes } from "./routes/auth.js";
import { contactRoutes } from "./routes/contacts.js";
import { duplicateRoutes } from "./routes/duplicates.js";
import { giftRoutes } from "./routes/gifts.js";
import { importRoutes } from "./routes/import.js";
import { tagRoutes } from "./routes/tags.js";
import { geoRoutes } from "./routes/geo.js";
import { historyRoutes } from "./routes/history.js";
import { personalRoutes } from "./routes/personal.js";
import { backupRoutes } from "./routes/backup.js";
import { syncRoutes } from "./routes/sync.js";
import { davRoutes } from "./routes/dav.js";
import { startSyncScheduler } from "./lib/sync.js";
import { runUpgrades } from "./lib/upgrades.js";
import { startPurgeJob } from "./lib/history.js";
import { startBackupScheduler } from "./lib/backup.js";
import { exportRoutes, groupRoutes, upcomingRoutes } from "./routes/misc.js";

const app = new Hono();

app.use(logger());
app.use(secureHeaders({ crossOriginResourcePolicy: false }));

// ---------- API ----------
// La app de Android carga la interfaz desde el propio móvil (https://localhost) y llama a este servidor
app.use(
  "/api/*",
  cors({
    origin: (origin) => (["https://localhost", "http://localhost", "capacitor://localhost"].includes(origin) ? origin : null),
    allowHeaders: ["Content-Type", "Authorization", "X-Agendario-Client"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Disposition"],
    maxAge: 86400,
  }),
);
const api = new Hono()
  .use(bodyLimit({ maxSize: 32 * 1024 * 1024 }))
  .get("/health", (c) => c.json({ ok: true, version: process.env.APP_VERSION ?? APP_VERSION }))
  .route("/auth", authRoutes)
  .route("/users", userRoutes)
  .route("/admin", adminRoutes)
  .route("/contacts", contactRoutes)
  .route("/groups", groupRoutes)
  .route("/upcoming", upcomingRoutes)
  .route("/export", exportRoutes)
  .route("/import", importRoutes)
  .route("/tags", tagRoutes)
  .route("/duplicates", duplicateRoutes)
  .route("/geo", geoRoutes)
  .route("/backup", backupRoutes)
  .route("/sync", syncRoutes)
  .route("/", historyRoutes)
  .route("/", personalRoutes)
  .route("/", giftRoutes);

app.route("/api", api);

// ---------- Servidor CardDAV (móvil) ----------
app.all("/.well-known/carddav", (c) => c.redirect("/dav/", 301));
app.route("/dav", davRoutes);
app.all("/api/*", (c) => c.json({ error: "Ruta no encontrada" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof ZodError) return c.json({ error: "Datos no válidos", issues: err.issues }, 400);
  console.error(err);
  return c.json({ error: "Error interno" }, 500);
});

// ---------- Web (PWA compilada) ----------
if (existsSync(config.webDir)) {
  const root = relative(process.cwd(), config.webDir) || ".";
  app.use("/*", serveStatic({ root }));
  // Cualquier otra ruta devuelve index.html (la PWA gestiona sus propias rutas).
  const indexHtml = await readFile(join(config.webDir, "index.html"), "utf8");
  app.get("*", (c) => c.html(indexHtml));
} else {
  app.get("/", (c) => c.text("API de Agendario funcionando. La web no está compilada en este entorno."));
}

// ---------- Arranque ----------
console.log("Aplicando migraciones de base de datos…");
await runMigrations();
await runUpgrades();

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Agendario escuchando en http://0.0.0.0:${info.port}`);
});
startPurgeJob();
startBackupScheduler();
startSyncScheduler();

const shutdown = async () => {
  console.log("Cerrando…");
  server.close();
  await closeDb();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
