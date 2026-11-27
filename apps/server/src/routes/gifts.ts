import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { giftIdeaInputSchema, giftIdeaPatchSchema, giftReceivedInputSchema, giftReceivedPatchSchema } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { getAccess } from "../lib/access.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import { giftOverview, givenGifts, occasionsFor } from "../lib/events.js";
import { imageForLink, linkPreview, saveImageFromUrl } from "../lib/linkpreview.js";
import { checkContacts, getReceived, listReceived, setGiftContacts } from "../lib/giftsReceived.js";
import { deletePhoto, photoType, readPhoto, storeUpload } from "../lib/photos.js";

const gi = schema.giftIdeas;
const gr = schema.giftsReceived;
const idParam = zValidator("param", z.object({ id: z.string().uuid() }));

/**
 * Regalos: datos personales de cada usuario. Basta con poder VER el contacto
 * para guardar tus ideas; nadie más (ni el propietario del contacto) las ve.
 */
/** Mantiene coherentes estado, «regalado» y evento. */
function normalizeGift<T extends { status?: string; given?: boolean; givenAt?: string | null; occasion?: unknown; eventKey?: string | null; eventLabel?: string; eventDate?: string | null; rating?: number | null; givenNote?: string }>(b: T): T {
  const out = { ...b };
  if (out.status === undefined && out.given !== undefined) out.status = out.given ? "given" : "idea"; // clientes antiguos
  if (out.status !== undefined) out.given = out.status === "given";
  if (out.status === "idea") Object.assign(out, { givenAt: null, occasion: null, eventKey: null, eventLabel: "", eventDate: null, rating: null, givenNote: "" });
  // Comprado (o cliente antiguo sin eventDate): el evento es el de la fecha elegida
  else if (out.status !== undefined && out.eventDate === undefined && out.givenAt !== undefined) out.eventDate = out.givenAt;
  return out;
}

export const giftRoutes = new Hono<AppEnv>()
  .use("/contacts/*", requireAuth)
  .use("/gifts/*", requireAuth)
  .use("/link-preview", requireAuth)

  // Título e imagen de una web (para compartir desde el móvil)
  .get("/link-preview", zValidator("query", z.object({ url: z.string().url().max(2000) })), async (c) => {
    try {
      return c.json(await linkPreview(c.req.valid("query").url));
    } catch {
      return c.json({ url: c.req.valid("query").url, title: null, image: null });
    }
  })

  // Pestaña Regalos: contactos con fechas de regalo
  .get("/gifts/overview", async (c) => c.json(await giftOverview(c.get("user").id)))
  // Pestaña Regalos → Regalados: todo lo ya regalado, de lo más reciente a lo más antiguo
  .get("/gifts/given", async (c) => c.json(await givenGifts(c.get("user").id)))
  .use("/gift-ideas/*", requireAuth)
  .use("/gifts-received", requireAuth)
  .use("/gifts-received/*", requireAuth)

  // ----- Ideas para regalos -----
  .post("/contacts/:id/gift-ideas", idParam, zValidator("json", giftIdeaInputSchema), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    await getAccess(id, user.id);
    const body = normalizeGift(c.req.valid("json"));
    const imageKey = body.url ? await imageForLink(body.url) : null;
    const [row] = await db
      .insert(gi)
      .values({ ...body, imageKey, contactId: id, userId: user.id })
      .returning();
    return c.json(row, 201);
  })

  .patch("/gift-ideas/:id", idParam, zValidator("json", giftIdeaPatchSchema), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const body = normalizeGift(c.req.valid("json"));
    const [old] = await db.select().from(gi).where(and(eq(gi.id, id), eq(gi.userId, user.id)));
    if (!old) throw new HTTPException(404, { message: "Idea no encontrada" });
    // Enlace nuevo y sin imagen: se intenta sacar de la web
    const imageKey = body.url && body.url !== old.url && !old.imageKey ? await imageForLink(body.url) : undefined;
    const [row] = await db
      .update(gi)
      .set({ ...body, ...(imageKey ? { imageKey } : {}), updatedAt: new Date() })
      .where(and(eq(gi.id, id), eq(gi.userId, user.id)))
      .returning();
    return c.json(row);
  })

  // Ocasiones para asignar un regalo comprado
  .get("/contacts/:id/gift-occasions", idParam, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    await getAccess(id, user.id);
    return c.json(await occasionsFor(user.id, id));
  })

  .delete("/gift-ideas/:id", idParam, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const [row] = await db.delete(gi).where(and(eq(gi.id, id), eq(gi.userId, user.id))).returning({ imageKey: gi.imageKey });
    if (row?.imageKey) await deletePhoto(row.imageKey);
    return c.body(null, 204);
  })

  // ----- Miniatura de la idea -----
  .get("/gift-ideas/:id/image", idParam, zValidator("query", z.object({ size: z.enum(["full", "thumb"]).default("thumb") })), async (c) => {
    const user = c.get("user");
    const [row] = await db.select({ imageKey: gi.imageKey }).from(gi).where(and(eq(gi.id, c.req.valid("param").id), eq(gi.userId, user.id)));
    if (!row?.imageKey) throw new HTTPException(404, { message: "Sin imagen" });
    const data = await readPhoto(row.imageKey, c.req.valid("query").size);
    return c.body(new Uint8Array(data), 200, { "Content-Type": photoType(row.imageKey), "Cache-Control": "private, max-age=604800", ETag: `"${row.imageKey}"` });
  })
  // Subir una imagen (multipart «photo») o sacarla de nuevo de la web del enlace (JSON {fromLink:true} o {url})
  .put("/gift-ideas/:id/image", idParam, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const [old] = await db.select().from(gi).where(and(eq(gi.id, id), eq(gi.userId, user.id)));
    if (!old) throw new HTTPException(404, { message: "Idea no encontrada" });
    let key: string | null = null;
    if ((c.req.header("content-type") ?? "").includes("multipart")) {
      key = await storeUpload(c);
    } else {
      const body = (await c.req.json().catch(() => ({}))) as { url?: string };
      try {
        key = body.url ? await saveImageFromUrl(body.url) : old.url ? await imageForLink(old.url) : null;
      } catch {
        key = null;
      }
      if (!key) throw new HTTPException(422, { message: "No se ha podido sacar la imagen de esa web. Súbela tú." });
    }
    const [row] = await db.update(gi).set({ imageKey: key, updatedAt: new Date() }).where(eq(gi.id, id)).returning();
    if (old.imageKey) await deletePhoto(old.imageKey);
    return c.json(row);
  })
  .delete("/gift-ideas/:id/image", idParam, async (c) => {
    const user = c.get("user");
    const [old] = await db.select({ imageKey: gi.imageKey }).from(gi).where(and(eq(gi.id, c.req.valid("param").id), eq(gi.userId, user.id)));
    if (!old) throw new HTTPException(404, { message: "Idea no encontrada" });
    await db.update(gi).set({ imageKey: null, updatedAt: new Date() }).where(eq(gi.id, c.req.valid("param").id));
    if (old.imageKey) await deletePhoto(old.imageKey);
    return c.body(null, 204);
  })

  // ----- Regalos recibidos (de uno o varios contactos) -----
  .get("/gifts-received", zValidator("query", z.object({ contact: z.string().uuid().optional() })), async (c) => {
    return c.json(await listReceived(c.get("user").id, { contactId: c.req.valid("query").contact }));
  })
  .post("/gifts-received", zValidator("json", giftReceivedInputSchema), async (c) => {
    const user = c.get("user");
    const { contactIds = [], ...body } = c.req.valid("json");
    const ids = await checkContacts(user.id, contactIds);
    const [row] = await db.insert(gr).values({ ...body, contactId: ids[0]!, userId: user.id }).returning({ id: gr.id });
    await setGiftContacts(row!.id, ids);
    return c.json(await getReceived(user.id, row!.id), 201);
  })
  // Desde la ficha: ese contacto y los demás que se elijan
  .post("/contacts/:id/gifts-received", idParam, zValidator("json", giftReceivedInputSchema), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    await getAccess(id, user.id);
    const { contactIds = [], ...body } = c.req.valid("json");
    const ids = await checkContacts(user.id, [id, ...contactIds]);
    const [row] = await db.insert(gr).values({ ...body, contactId: ids[0]!, userId: user.id }).returning({ id: gr.id });
    await setGiftContacts(row!.id, ids);
    return c.json(await getReceived(user.id, row!.id), 201);
  })
  .patch("/gifts-received/:id", idParam, zValidator("json", giftReceivedPatchSchema), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const { contactIds, ...body } = c.req.valid("json");
    const [old] = await db.select({ id: gr.id }).from(gr).where(and(eq(gr.id, id), eq(gr.userId, user.id)));
    if (!old) throw new HTTPException(404, { message: "Regalo no encontrado" });
    if (Object.keys(body).length) await db.update(gr).set(body).where(eq(gr.id, id));
    if (contactIds) await setGiftContacts(id, await checkContacts(user.id, contactIds));
    return c.json(await getReceived(user.id, id));
  })

  .delete("/gifts-received/:id", idParam, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const [row] = await db.delete(gr).where(and(eq(gr.id, id), eq(gr.userId, user.id))).returning({ imageKey: gr.imageKey });
    if (row?.imageKey) await deletePhoto(row.imageKey);
    return c.body(null, 204);
  })

  // ----- Foto del regalo recibido -----
  .get("/gifts-received/:id/image", idParam, zValidator("query", z.object({ size: z.enum(["full", "thumb"]).default("thumb") })), async (c) => {
    const user = c.get("user");
    const [row] = await db.select({ imageKey: gr.imageKey }).from(gr).where(and(eq(gr.id, c.req.valid("param").id), eq(gr.userId, user.id)));
    if (!row?.imageKey) throw new HTTPException(404, { message: "Sin foto" });
    const data = await readPhoto(row.imageKey, c.req.valid("query").size);
    return c.body(new Uint8Array(data), 200, { "Content-Type": photoType(row.imageKey), "Cache-Control": "private, max-age=604800", ETag: `"${row.imageKey}"` });
  })
  // Subir la foto (multipart «photo»)
  .put("/gifts-received/:id/image", idParam, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const [old] = await db.select({ imageKey: gr.imageKey }).from(gr).where(and(eq(gr.id, id), eq(gr.userId, user.id)));
    if (!old) throw new HTTPException(404, { message: "Regalo no encontrado" });
    if (!(c.req.header("content-type") ?? "").includes("multipart")) throw new HTTPException(400, { message: "Falta la foto" });
    const key = await storeUpload(c);
    await db.update(gr).set({ imageKey: key }).where(eq(gr.id, id));
    if (old.imageKey) await deletePhoto(old.imageKey);
    return c.json(await getReceived(user.id, id));
  })
  .delete("/gifts-received/:id/image", idParam, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const [old] = await db.select({ imageKey: gr.imageKey }).from(gr).where(and(eq(gr.id, id), eq(gr.userId, user.id)));
    if (!old) throw new HTTPException(404, { message: "Regalo no encontrado" });
    await db.update(gr).set({ imageKey: null }).where(eq(gr.id, id));
    if (old.imageKey) await deletePhoto(old.imageKey);
    return c.body(null, 204);
  });
