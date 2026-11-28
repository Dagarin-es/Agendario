import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  remoteWishListSchema,
  wishClaimInputSchema,
  wishClaimPatchSchema,
  wishGuestInputSchema,
  wishGuestPatchSchema,
  wishInputSchema,
  wishListInputSchema,
  wishListPatchSchema,
  wishPatchSchema,
  wishPublicUrlSchema,
  wishSuggestionInputSchema,
} from "@agendario/shared";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAdmin, requireAuth, type AppEnv } from "../lib/auth.js";
import { imageForLink, saveImageFromUrl } from "../lib/linkpreview.js";
import { deletePhoto, photoType, readPhoto, storeUpload } from "../lib/photos.js";
import { clientIp } from "../lib/ratelimit.js";
import {
  addGuest,
  archiveList,
  createList,
  deleteList,
  dismissSuggestion,
  getPublicUrl,
  getRemoteLists,
  guestByToken,
  isBlocked,
  issueLink,
  listDetail,
  listSummaries,
  listWishes,
  overLimit,
  ownWish,
  patchList,
  publicAccept,
  publicClaim,
  publicEditClaim,
  publicImageKey,
  publicJoin,
  publicLeave,
  publicState,
  publicSuggest,
  removeGuest,
  removeRemoteList,
  renameGuest,
  revealOpenList,
  saveRemoteList,
  setPublicUrl,
  type Guest,
} from "../lib/wishes.js";

const w = schema.wishes;
const idParam = zValidator("param", z.object({ id: z.string().uuid() }));
const guestParam = zValidator("param", z.object({ id: z.string().uuid(), gid: z.string().uuid() }));

// ---------- Rutas del dueño (con sesión) ----------

export const wishRoutes = new Hono<AppEnv>()
  .use("/wishes", requireAuth)
  .use("/wishes/*", requireAuth)
  .use("/wish-lists", requireAuth)
  .use("/wish-lists/*", requireAuth)
  .use("/wish-suggestions/*", requireAuth)

  // Mis deseos + mis listas
  .get("/wishes", async (c) => {
    const user = c.get("user");
    const [wishes, lists] = await Promise.all([listWishes(user.id), listSummaries(user.id)]);
    return c.json({ wishes, lists, publicUrl: await getPublicUrl() });
  })

  // Dirección pública de las listas (la pone el administrador)
  .get("/wishes/public-url", async (c) => c.json({ url: await getPublicUrl() }))
  .put("/wishes/public-url", requireAdmin, zValidator("json", wishPublicUrlSchema), async (c) => {
    await setPublicUrl(c.req.valid("json").url);
    return c.json({ url: await getPublicUrl() });
  })
  // Comprobar que la dirección llega a este Agendario (y solo a la parte de las listas)
  .post("/wishes/public-url/check", requireAdmin, async (c) => {
    const base = await getPublicUrl();
    if (!base) return c.json({ ok: false, message: "No hay ninguna dirección configurada." });
    const ask = async (path: string) => {
      const r = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(8000) });
      return { status: r.status, body: await r.text().catch(() => "") };
    };
    try {
      const ping = await ask("/api/l/ping");
      if (ping.status !== 200 || !ping.body.includes("agendario-listas")) {
        return c.json({ ok: false, message: `La dirección responde, pero no es este Agendario (código ${ping.status}). Revisa el proxy.` });
      }
      const other = await ask("/api/health");
      if (other.status !== 404) return c.json({ ok: false, message: "Llega a Agendario, pero también deja pasar el resto de la aplicación. ¿Has puesto bien la dirección en Ajustes?" });
      return c.json({ ok: true, message: "Todo bien: la dirección llega a Agendario y solo enseña las listas." });
    } catch (e) {
      return c.json({ ok: false, message: `No se ha podido conectar con ${base}: ${(e as Error).message}` });
    }
  })

  // Listas de otros guardadas desde la app («Añadir a mi Agendario»)
  .get("/wishes/remote", async (c) => c.json(await getRemoteLists(c.get("user").id)))
  .put("/wishes/remote", zValidator("json", remoteWishListSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    if (body.contactId) {
      const [ct] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(and(eq(schema.contacts.id, body.contactId), eq(schema.contacts.ownerId, user.id)));
      if (!ct) throw new HTTPException(404, { message: "Contacto no encontrado" });
    }
    await saveRemoteList(user.id, body);
    return c.json(await getRemoteLists(user.id));
  })
  .delete("/wishes/remote", zValidator("query", z.object({ url: z.string().max(400) })), async (c) => {
    await removeRemoteList(c.get("user").id, c.req.valid("query").url);
    return c.body(null, 204);
  })

  .post("/wishes", zValidator("json", wishInputSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    const imageKey = body.url ? await imageForLink(body.url) : null;
    const [row] = await db.insert(w).values({ ...body, imageKey, userId: user.id }).returning();
    return c.json(row, 201);
  })
  .patch("/wishes/:id", idParam, zValidator("json", wishPatchSchema), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const old = await ownWish(user.id, id);
    const body = c.req.valid("json");
    const imageKey = body.url && body.url !== old.url && !old.imageKey ? await imageForLink(body.url) : undefined;
    const [row] = await db.update(w).set({ ...body, ...(imageKey ? { imageKey } : {}), updatedAt: new Date() }).where(eq(w.id, id)).returning();
    return c.json(row);
  })
  .delete("/wishes/:id", idParam, async (c) => {
    const user = c.get("user");
    const old = await ownWish(user.id, c.req.valid("param").id);
    await db.delete(w).where(eq(w.id, old.id));
    if (old.imageKey) await deletePhoto(old.imageKey);
    return c.body(null, 204);
  })
  .get("/wishes/:id/image", idParam, zValidator("query", z.object({ size: z.enum(["full", "thumb"]).default("thumb") })), async (c) => {
    const user = c.get("user");
    const row = await ownWish(user.id, c.req.valid("param").id);
    if (!row.imageKey) throw new HTTPException(404, { message: "Sin imagen" });
    const data = await readPhoto(row.imageKey, c.req.valid("query").size);
    return c.body(new Uint8Array(data), 200, { "Content-Type": photoType(row.imageKey), "Cache-Control": "private, max-age=604800", ETag: `"${row.imageKey}"` });
  })
  .put("/wishes/:id/image", idParam, async (c) => {
    const user = c.get("user");
    const old = await ownWish(user.id, c.req.valid("param").id);
    let key: string | null = null;
    if ((c.req.header("content-type") ?? "").includes("multipart")) key = await storeUpload(c);
    else {
      const body = (await c.req.json().catch(() => ({}))) as { url?: string };
      try {
        key = body.url ? await saveImageFromUrl(body.url) : old.url ? await imageForLink(old.url) : null;
      } catch {
        key = null;
      }
      if (!key) throw new HTTPException(422, { message: "No se ha podido sacar la imagen de esa web. Súbela tú." });
    }
    const [row] = await db.update(w).set({ imageKey: key, updatedAt: new Date() }).where(eq(w.id, old.id)).returning();
    if (old.imageKey) await deletePhoto(old.imageKey);
    return c.json(row);
  })
  .delete("/wishes/:id/image", idParam, async (c) => {
    const user = c.get("user");
    const old = await ownWish(user.id, c.req.valid("param").id);
    await db.update(w).set({ imageKey: null, updatedAt: new Date() }).where(eq(w.id, old.id));
    if (old.imageKey) await deletePhoto(old.imageKey);
    return c.body(null, 204);
  })

  // ----- Listas (ocasiones y lista siempre abierta) -----
  .post("/wish-lists", zValidator("json", wishListInputSchema), async (c) => {
    const row = await createList(c.get("user").id, c.req.valid("json"));
    return c.json(await listDetail(c.get("user").id, row.id), 201);
  })
  .get("/wish-lists/:id", idParam, async (c) => c.json(await listDetail(c.get("user").id, c.req.valid("param").id)))
  .patch("/wish-lists/:id", idParam, zValidator("json", wishListPatchSchema), async (c) => {
    const user = c.get("user");
    await patchList(user.id, c.req.valid("param").id, c.req.valid("json"));
    return c.json(await listDetail(user.id, c.req.valid("param").id));
  })
  .delete("/wish-lists/:id", idParam, async (c) => {
    await deleteList(c.get("user").id, c.req.valid("param").id);
    return c.body(null, 204);
  })
  .post("/wish-lists/:id/archive", idParam, async (c) => {
    await archiveList(c.get("user").id, c.req.valid("param").id);
    return c.body(null, 204);
  })
  .post("/wish-lists/:id/reveal", idParam, async (c) => {
    const user = c.get("user");
    await revealOpenList(user.id, c.req.valid("param").id);
    return c.json(await listDetail(user.id, c.req.valid("param").id));
  })
  .post("/wish-lists/:id/guests", idParam, zValidator("json", wishGuestInputSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    await addGuest(user.id, c.req.valid("param").id, body.contactId, body.name);
    return c.json(await listDetail(user.id, c.req.valid("param").id), 201);
  })
  .patch("/wish-lists/:id/guests/:gid", guestParam, zValidator("json", wishGuestPatchSchema), async (c) => {
    const user = c.get("user");
    const { id, gid } = c.req.valid("param");
    await renameGuest(user.id, id, gid, c.req.valid("json").name);
    return c.json(await listDetail(user.id, id));
  })
  .delete("/wish-lists/:id/guests/:gid", guestParam, async (c) => {
    const user = c.get("user");
    const { id, gid } = c.req.valid("param");
    await removeGuest(user.id, id, gid);
    return c.json(await listDetail(user.id, id));
  })
  // Enlace personal (nuevo cada vez: el anterior deja de funcionar)
  .post("/wish-lists/:id/guests/:gid/link", guestParam, async (c) => {
    const { id, gid } = c.req.valid("param");
    return c.json({ link: await issueLink(c.get("user").id, id, gid) });
  })
  .post("/wish-suggestions/:id/dismiss", idParam, async (c) => {
    await dismissSuggestion(c.get("user").id, c.req.valid("param").id);
    return c.body(null, 204);
  });

// ---------- Página pública del invitado (sin sesión: entra con el código de su enlace) ----------

type PublicEnv = { Variables: { guest: Guest } };
const PUBLIC_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
const claimParam = zValidator("param", z.object({ id: z.string().uuid() }));

export const wishPublicRoutes = new Hono<PublicEnv>()
  .use(bodyLimit({ maxSize: 16 * 1024 }))
  .use(async (c, next) => {
    // Límite general por IP: 240 peticiones por minuto
    if (overLimit(`p:${clientIp(c)}`, 240, 60_000)) return c.json({ error: "Demasiadas peticiones. Espera un minuto." }, 429, PUBLIC_HEADERS);
    await next();
    for (const [k, v] of Object.entries(PUBLIC_HEADERS)) c.header(k, v);
  })
  .get("/ping", (c) => c.json({ app: "agendario-listas" }))
  .use(async (c, next) => {
    const ip = clientIp(c);
    // Quien prueba códigos al azar queda bloqueado 15 minutos tras 20 fallos
    if (isBlocked(`t:${ip}`, 20)) return c.json({ error: "Demasiados enlaces no válidos. Vuelve a probar más tarde." }, 429, PUBLIC_HEADERS);
    const guest = await guestByToken(c.req.header("x-lista-token") ?? "");
    if (!guest) {
      overLimit(`t:${ip}`, 20, 15 * 60_000);
      return c.json({ error: "Este enlace ya no funciona. Pídele uno nuevo a quien te lo mandó." }, 404, PUBLIC_HEADERS);
    }
    c.set("guest", guest);
    await next();
  })
  .get("/state", async (c) => c.json(await publicState(c.get("guest"))))
  .post("/claims", zValidator("json", wishClaimInputSchema), async (c) => {
    await publicClaim(c.get("guest"), c.req.valid("json"));
    return c.json(await publicState(c.get("guest")));
  })
  .patch("/claims/:id", claimParam, zValidator("json", wishClaimPatchSchema), async (c) => {
    await publicEditClaim(c.get("guest"), c.req.valid("param").id, c.req.valid("json"));
    return c.json(await publicState(c.get("guest")));
  })
  .post("/claims/:id/accept", claimParam, zValidator("json", z.object({ releaseOthers: z.boolean().default(false) })), async (c) => {
    await publicAccept(c.get("guest"), c.req.valid("param").id, c.req.valid("json").releaseOthers);
    return c.json(await publicState(c.get("guest")));
  })
  .post("/claims/:id/join", claimParam, async (c) => {
    await publicJoin(c.get("guest"), c.req.valid("param").id);
    return c.json(await publicState(c.get("guest")));
  })
  .post("/claims/:id/leave", claimParam, async (c) => {
    await publicLeave(c.get("guest"), c.req.valid("param").id);
    return c.json(await publicState(c.get("guest")));
  })
  .post("/suggestions", zValidator("json", wishSuggestionInputSchema), async (c) => {
    if (overLimit(`s:${clientIp(c)}`, 10, 60 * 60_000)) throw new HTTPException(429, { message: "Ya has mandado varias sugerencias." });
    await publicSuggest(c.get("guest"), c.req.valid("json"));
    return c.json({ ok: true });
  })
  .get("/images/:id", claimParam, async (c) => {
    const key = await publicImageKey(c.get("guest"), c.req.valid("param").id);
    if (!key) throw new HTTPException(404, { message: "Sin imagen" });
    const data = await readPhoto(key, "thumb");
    return c.body(new Uint8Array(data), 200, { "Content-Type": photoType(key) });
  });
