import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { giftIdeaInputSchema, giftIdeaPatchSchema, giftReceivedInputSchema } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { getAccess } from "../lib/access.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import { giftOverview, occasionsFor } from "../lib/events.js";
import { imageForLink, linkPreview, saveImageFromUrl } from "../lib/linkpreview.js";
import { deletePhoto, MAX_UPLOAD_BYTES, readPhoto, savePhoto } from "../lib/photos.js";

const gi = schema.giftIdeas;
const gr = schema.giftsReceived;
const idParam = zValidator("param", z.object({ id: z.string().uuid() }));

/**
 * Regalos: datos personales de cada usuario. Basta con poder VER el contacto
 * para guardar tus ideas; nadie más (ni el propietario del contacto) las ve.
 */
/** Mantiene coherentes estado, «regalado» y evento. */
function normalizeGift<T extends { status?: string; given?: boolean; givenAt?: string | null; occasion?: unknown; eventKey?: string | null; eventLabel?: string }>(b: T): T {
  const out = { ...b };
  if (out.status === undefined && out.given !== undefined) out.status = out.given ? "given" : "idea"; // clientes antiguos
  if (out.status !== undefined) out.given = out.status === "given";
  if (out.status === "idea") Object.assign(out, { givenAt: null, occasion: null, eventKey: null, eventLabel: "" });
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
  .use("/gift-ideas/*", requireAuth)
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
    return c.body(new Uint8Array(data), 200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=604800", ETag: `"${row.imageKey}"` });
  })
  // Subir una imagen (multipart «photo») o sacarla de nuevo de la web del enlace (JSON {fromLink:true} o {url})
  .put("/gift-ideas/:id/image", idParam, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const [old] = await db.select().from(gi).where(and(eq(gi.id, id), eq(gi.userId, user.id)));
    if (!old) throw new HTTPException(404, { message: "Idea no encontrada" });
    let key: string | null = null;
    if ((c.req.header("content-type") ?? "").includes("multipart")) {
      const file = (await c.req.parseBody())["photo"];
      if (!(file instanceof File)) throw new HTTPException(400, { message: "Falta el campo 'photo'" });
      if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "La imagen es demasiado grande" });
      try {
        key = await savePhoto(Buffer.from(await file.arrayBuffer()));
      } catch {
        throw new HTTPException(400, { message: "No es una imagen válida" });
      }
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

  // ----- Regalos recibidos -----
  .post("/contacts/:id/gifts-received", idParam, zValidator("json", giftReceivedInputSchema), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    await getAccess(id, user.id);
    const [row] = await db
      .insert(gr)
      .values({ ...c.req.valid("json"), contactId: id, userId: user.id })
      .returning();
    return c.json(row, 201);
  })

  .delete("/gifts-received/:id", idParam, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    await db.delete(gr).where(and(eq(gr.id, id), eq(gr.userId, user.id)));
    return c.body(null, 204);
  });
