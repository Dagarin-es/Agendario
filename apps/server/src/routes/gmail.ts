/** Sincronización de contactos con Gmail (Agendario → Google Contactos). */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { gmailAppSchema, gmailTagAccountsSchema, gmailTagsSchema } from "@agendario/shared";
import { requireAdmin, requireAuth, type AppEnv } from "../lib/auth.js";
import { assertOwnTags } from "../lib/tags.js";
import { authUrl, disconnect, finishAuth, forgetAll, GmailError, loadAccounts, loadApp, moveTags, runPhotosNow, runSync, saveApp, setTagAccounts, setTags, statusOf } from "../lib/gmail.js";

const fail = (e: unknown): never => {
  throw new HTTPException(400, { message: e instanceof GmailError ? e.message : "No se ha podido hablar con Google" });
};

/** Vuelta desde Google tras dar permiso. Va sin sesión: el «state» identifica al usuario y caduca en 15 minutos. */
export const gmailPublicRoutes = new Hono().get("/callback", async (ctx) => {
  const { state = "", code = "", error = "" } = ctx.req.query();
  const back = (q: string) => ctx.redirect(`/settings?tab=sync&${q}`);
  if (error) return back(`gmail=error&msg=${encodeURIComponent(error === "access_denied" ? "Has cancelado el permiso en Google" : `Google: ${error}`)}`);
  try {
    const ref = await finishAuth(state, code);
    void runSync(ref, true).catch(() => undefined);
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
  /**
   * Empieza la conexión: devuelve la dirección de Google a la que ir. `origin` = dirección de Agendario en el navegador.
   * Sin `accountId` se añade una cuenta nueva; con él, se vuelve a conectar esa.
   */
  .post("/connect", zValidator("json", z.object({ origin: z.string().max(300), accountId: z.string().max(40).optional() })), async (ctx) => {
    const b = ctx.req.valid("json");
    const url = await authUrl(ctx.get("user").id, b.origin.replace(/\/+$/, ""), b.accountId ?? null).catch(fail);
    return ctx.json({ url });
  })
  /** Etiquetas de una cuenta (sin `accountId`, la primera: así lo hacía la 1.3.0) */
  .put("/tags", zValidator("json", gmailTagsSchema), async (ctx) => {
    const user = ctx.get("user");
    const { tagIds, accountId } = ctx.req.valid("json");
    await assertOwnTags(tagIds, user.id);
    await setTags(user.id, accountId, tagIds).catch(fail);
    return ctx.json(await statusOf(user.id));
  })
  /** A qué cuentas va una etiqueta */
  .put("/tag/:tagId", zValidator("param", z.object({ tagId: z.string().uuid() })), zValidator("json", gmailTagAccountsSchema), async (ctx) => {
    const user = ctx.get("user");
    const { tagId } = ctx.req.valid("param");
    await assertOwnTags([tagId], user.id);
    await setTagAccounts(user.id, tagId, ctx.req.valid("json").accountIds);
    return ctx.json(await statusOf(user.id));
  })
  /** Sincronizar ahora: una cuenta (`?account=`) o todas las conectadas */
  .post("/sync", async (ctx) => {
    const user = ctx.get("user");
    const only = ctx.req.query("account");
    const list = (await loadAccounts(user.id)).filter((a) => a.refreshToken && (!only || a.id === only));
    if (!list.length) fail(new GmailError("No hay ninguna cuenta de Google conectada"));
    let result = null;
    for (const a of list) result = (await runSync({ userId: user.id, accId: a.id }).catch(fail)) ?? result;
    return ctx.json({ result, status: await statusOf(user.id) });
  })
  /** Buscar fotos en Google ahora (para los contactos sin foto) */
  .post("/accounts/:id/photos", async (ctx) => {
    const user = ctx.get("user");
    const added = await runPhotosNow({ userId: user.id, accId: ctx.req.param("id") }).catch(fail);
    return ctx.json({ added, status: await statusOf(user.id) });
  })
  /** Pasar todas las etiquetas de una cuenta a otra */
  .post("/accounts/:id/move", zValidator("json", z.object({ to: z.string().max(40) })), async (ctx) => {
    const user = ctx.get("user");
    const moved = await moveTags(user.id, ctx.req.param("id"), ctx.req.valid("json").to).catch(fail);
    return ctx.json({ moved, status: await statusOf(user.id) });
  })
  /** Quitar una cuenta; con ?remove=1 antes borra de Google lo creado por Agendario. */
  .delete("/accounts/:id", async (ctx) => {
    await disconnect({ userId: ctx.get("user").id, accId: ctx.req.param("id") }, ctx.req.query("remove") === "1").catch(fail);
    return ctx.body(null, 204);
  })
  /** (1.3.0) Desconectar la primera cuenta */
  .delete("/", async (ctx) => {
    const user = ctx.get("user");
    const [first] = await loadAccounts(user.id);
    if (first) await disconnect({ userId: user.id, accId: first.id }, ctx.req.query("remove") === "1").catch(fail);
    return ctx.body(null, 204);
  });
