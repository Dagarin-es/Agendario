import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { giftIdeaInputSchema, giftIdeaPatchSchema, giftReceivedInputSchema } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { getAccess } from "../lib/access.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";

const gi = schema.giftIdeas;
const gr = schema.giftsReceived;
const idParam = zValidator("param", z.object({ id: z.string().uuid() }));

/**
 * Regalos: datos personales de cada usuario. Basta con poder VER el contacto
 * para guardar tus ideas; nadie más (ni el propietario del contacto) las ve.
 */
export const giftRoutes = new Hono<AppEnv>()
  .use("/contacts/*", requireAuth)
  .use("/gift-ideas/*", requireAuth)
  .use("/gifts-received/*", requireAuth)

  // ----- Ideas para regalos -----
  .post("/contacts/:id/gift-ideas", idParam, zValidator("json", giftIdeaInputSchema), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    await getAccess(id, user.id);
    const body = c.req.valid("json");
    const [row] = await db
      .insert(gi)
      .values({ ...body, givenAt: body.given ? body.givenAt : null, contactId: id, userId: user.id })
      .returning();
    return c.json(row, 201);
  })

  .patch("/gift-ideas/:id", idParam, zValidator("json", giftIdeaPatchSchema), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    if (body.given === false) {
      body.givenAt = null;
      body.occasion = null;
    }
    const [row] = await db
      .update(gi)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(gi.id, id), eq(gi.userId, user.id)))
      .returning();
    if (!row) throw new HTTPException(404, { message: "Idea no encontrada" });
    return c.json(row);
  })

  .delete("/gift-ideas/:id", idParam, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    await db.delete(gi).where(and(eq(gi.id, id), eq(gi.userId, user.id)));
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
