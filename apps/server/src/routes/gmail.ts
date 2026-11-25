/** Sincronización de contactos con Gmail (Agendario → Google Contactos). */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { gmailAppSchema, gmailTagsSchema } from "@agendario/shared";
import { requireAdmin, requireAuth, type AppEnv } from "../lib/auth.js";
import { assertOwnTags } from "../lib/tags.js";
import { authUrl, disconnect, finishAuth, forgetAll, GmailError, loadApp, runSync, saveApp, setTags, statusOf } from "../lib/gmail.js";

const fail = (e: unknown): never => {
  throw new HTTPException(400, { message: e instanceof GmailError ? e.message : "No se ha podido hablar con Google" });
};

/** Vuelta desde Google tras dar permiso. Va sin sesión: el «state» identifica al usuario y caduca en 15 minutos. */
export const gmailPublicRoutes = new Hono().get("/callback", async (ctx) => {
  const { state = "", code = "", error = "" } = ctx.req.query();
  const back = (q: string) => ctx.redirect(`/settings?tab=sync&${q}`);
  if (error) return back(`gmail=error&msg=${encodeURIComponent(error === "access_denied" ? "Has cancelado el permiso en Google" : `Google: ${error}`)}`);
  try {
    const userId = await finishAuth(state, code);
    void runSync(userId).catch(() => undefined);
    return back("gmail=ok");
  } catch (e) {
    return back(`gmail=error&msg=${encodeURIComponent(e instanceof GmailError ? e.message : "No se ha podido conectar")}`);
  }
});

export const gmailRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", async (ctx) => ctx.json(await statusOf(ctx.get("user").id)))
  /** App de Google de esta instalación (solo administración). El secreto, si no llega, se conserva. */
  .put("/app", requireAdmin, zValidator("json", gmailAppSchema), async (ctx) => {
    const b = ctx.req.valid("json");
    const prev = await loadApp();
    const clientSecret = b.clientSecret?.trim() || (prev?.clientId === b.clientId ? prev.clientSecret : "");
    if (!clientSecret) throw new HTTPException(400, { message: "Falta el secreto de cliente" });
    if (!/\.apps\.googleusercontent\.com$/.test(b.clientId)) throw new HTTPException(400, { message: "El ID de cliente de Google termina en .apps.googleusercontent.com" });
    await saveApp({ clientId: b.clientId, clientSecret });
    return ctx.json(await statusOf(ctx.get("user").id));
  })
  .delete("/app", requireAdmin, async (ctx) => {
    await forgetAll();
    return ctx.body(null, 204);
  })
  /** Empieza la conexión: devuelve la dirección de Google a la que ir. `origin` = dirección de Agendario en el navegador. */
  .post("/connect", zValidator("json", z.object({ origin: z.string().max(300) })), async (ctx) => {
    const url = await authUrl(ctx.get("user").id, ctx.req.valid("json").origin.replace(/\/+$/, "")).catch(fail);
    return ctx.json({ url });
  })
  .put("/tags", zValidator("json", gmailTagsSchema), async (ctx) => {
    const user = ctx.get("user");
    const { tagIds } = ctx.req.valid("json");
    await assertOwnTags(tagIds, user.id);
    await setTags(user.id, tagIds);
    return ctx.json(await statusOf(user.id));
  })
  .post("/sync", async (ctx) => {
    const user = ctx.get("user");
    const result = await runSync(user.id).catch(fail);
    return ctx.json({ result, status: await statusOf(user.id) });
  })
  /** Desconectar; con ?remove=1 antes borra de Google lo creado por Agendario. */
  .delete("/", async (ctx) => {
    await disconnect(ctx.get("user").id, ctx.req.query("remove") === "1").catch(fail);
    return ctx.body(null, 204);
  });
