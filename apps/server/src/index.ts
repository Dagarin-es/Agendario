import { calendarRoutes, icsPublicRoutes, personalEventRoutes } from "./routes/calendar.js";
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
import { reminderRoutes } from "./routes/reminders.js";
import { noteRoutes } from "./routes/notes.js";
import { todoistRoutes } from "./routes/todoist.js";
import { gmailPublicRoutes, gmailRoutes } from "./routes/gmail.js";
import { startAttachmentSweep } from "./lib/attachments.js";
import { startTodoistScheduler } from "./lib/todoist.js";
import { kickAll as kickGmail, startGmailScheduler } from "./lib/gmail.js";
import { backupRoutes } from "./routes/backup.js";
import { syncRoutes } from "./routes/sync.js";
import { davRoutes } from "./routes/dav.js";
import { startSyncScheduler } from "./lib/sync.js";
import { runUpgrades } from "./lib/upgrades.js";
import { startPurgeJob } from "./lib/history.js";
import { startSessionCleanup } from "./lib/auth.js";
import { startBackupScheduler } from "./lib/backup.js";
import { exportRoutes, upcomingRoutes } from "./routes/misc.js";
import { wishPublicRoutes, wishRoutes } from "./routes/wishes.js";
import { publicHost, startWishScheduler } from "./lib/wishes.js";
import { WISH_FAVICON, wishPageHeaders, wishPageHtml } from "./lib/wishPage.js";
import { randomBytes } from "node:crypto";

const app = new Hono();

app.use(logger());

// ---------- Subdominio de las listas de deseos ----------
// Por la dirección pública de las listas SOLO se sirve la página del invitado y su API (/api/l/*).
// Ni la web, ni el inicio de sesión, ni el resto de la API: quien recibe un enlace no ve nada más.
app.use(async (c, next) => {
  const ph = await publicHost();
  const host = (c.req.header("host") ?? "").toLowerCase();
  if (!ph || host !== ph) return next();
  const path = c.req.path;
  if (path.startsWith("/api/l/")) return next();
  const noindex = { "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
  if (c.req.method === "GET" && (path === "/" || path === "/index.html")) {
    const nonce = randomBytes(16).toString("base64");
    return c.html(wishPageHtml(nonce), 200, wishPageHeaders(nonce));
  }
  if (path === "/robots.txt") return c.text("User-agent: *\nDisallow: /\n", 200, noindex);
  if (path === "/favicon.svg" || path === "/favicon.ico") return c.body(WISH_FAVICON, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400", ...noindex });
  return c.text("No encontrado", 404, noindex);
});
const strictHeaders = secureHeaders({
  crossOriginResourcePolicy: false,
  // Solo código propio; imágenes propias y de los mapas (OpenStreetMap, Esri); sin incrustar en otras webs
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "blob:", "https://tile.openstreetmap.org", "https://server.arcgisonline.com"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'", "data:"],
    workerSrc: ["'self'"],
    manifestSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
  xFrameOptions: "DENY",
  referrerPolicy: "same-origin",
  permissionsPolicy: { camera: false, microphone: false, payment: false, usb: false, geolocation: ["self"] },
});
// Los adjuntos (PDF, fotos, audios) se abren con el visor del navegador: su CSP no puede bloquear el visor de PDF
const fileHeaders = secureHeaders({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: { defaultSrc: ["'none'"], imgSrc: ["'self'"], mediaSrc: ["'self'"], styleSrc: ["'unsafe-inline'"], frameAncestors: ["'none'"] },
  xFrameOptions: "DENY",
  referrerPolicy: "same-origin",
});
app.use((c, next) => (/^\/api\/attachments\/[\w-]+$/.test(c.req.path) ? fileHeaders(c, next) : strictHeaders(c, next)));
// La página de los invitados lleva sus propias cabeceras (se sirve arriba, antes de llegar aquí)

// ---------- API ----------
// La app de Android carga la interfaz desde el propio móvil (https://localhost) y llama a este servidor
app.use(
  "/api/*",
  cors({
    // La API de las listas (/api/l, sin cookies: entra con el código del enlace) se puede llamar desde cualquier
    // origen, p. ej. desde el Agendario del invitado («Añadir a mi Agendario»)
    origin: (origin, c) => (c.req.path.startsWith("/api/l/") ? "*" : ["https://localhost", "http://localhost", "capacitor://localhost"].includes(origin) ? origin : null),
    allowHeaders: ["Content-Type", "Authorization", "X-Agendario-Client", "X-Lista-Token"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Disposition"],
    maxAge: 86400,
  }),
);
const api = new Hono()
  .use(bodyLimit({ maxSize: 32 * 1024 * 1024 }))
  // Cualquier cambio en contactos o etiquetas: Gmail se pone al día al poco (solo envía lo que haya cambiado)
  .use(async (c, next) => {
    await next();
    if (c.req.method !== "GET" && c.res.status < 400 && /^\/api\/(contacts|tags|import|duplicates|trash)/.test(c.req.path)) void kickGmail();
  })
  // Listas de deseos: la página del invitado (sin sesión)
  .route("/l", wishPublicRoutes)
  .get("/health", (c) => c.json({ ok: true, version: process.env.APP_VERSION ?? APP_VERSION }))
  .route("/auth", authRoutes)
  .route("/users", userRoutes)
  .route("/admin", adminRoutes)
  .route("/contacts", contactRoutes)
  .route("/upcoming", upcomingRoutes)
  .route("/export", exportRoutes)
  .route("/import", importRoutes)
  .route("/tags", tagRoutes)
  .route("/duplicates", duplicateRoutes)
  .route("/geo", geoRoutes)
  .route("/backup", backupRoutes)
  .route("/sync", syncRoutes)
  // Vuelta de Google al conectar Gmail (sin sesión; antes que las rutas con sesión)
  .route("/gmail", gmailPublicRoutes)
  .route("/gmail", gmailRoutes)
  // Antes que las rutas montadas en «/» (que exigen sesión): el calendario suscrito entra con su token
  .route("/ics", icsPublicRoutes)
  .route("/personal-events", personalEventRoutes)
  .route("/calendar", calendarRoutes)
  .route("/", historyRoutes)
  .route("/", noteRoutes)
  .route("/todoist", todoistRoutes)
  .route("/", reminderRoutes)
  .route("/", personalRoutes)
  .route("/", giftRoutes)
  .route("/", wishRoutes);

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
startAttachmentSweep();
startTodoistScheduler();
startGmailScheduler();
startSessionCleanup();
startBackupScheduler();
startSyncScheduler();
startWishScheduler();

const shutdown = async () => {
  console.log("Cerrando…");
  server.close();
  await closeDb();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
