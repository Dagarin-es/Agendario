import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  exportSelectionSchema,
} from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import { eventsBetween, pendingGifts } from "../lib/events.js";
import { expandTagIds } from "../lib/tags.js";
import { buildVcf, vcfHeaders } from "../lib/export.js";

const idParam = zValidator("param", z.object({ id: z.string().uuid() }));

// ---------- Próximas fechas (cumpleaños + fechas importantes) ----------

export const upcomingRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  // Próximos N días (lista)
  .get("/", zValidator("query", z.object({ days: z.coerce.number().int().min(1).max(366).default(30) })), async (c) => {
    const { days } = c.req.valid("query");
    const now = new Date();
    const from = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const to = new Date(from.getTime() + days * 86_400_000);
    return c.json(await eventsBetween(c.get("user").id, from, to));
  })
  // Un intervalo cualquiera (calendario mensual)
  .get("/range", zValidator("query", z.object({ from: z.string().date(), to: z.string().date() })), async (c) => {
    const { from, to } = c.req.valid("query");
    const f = new Date(`${from}T00:00:00Z`);
    const t = new Date(`${to}T00:00:00Z`);
    if (t < f || t.getTime() - f.getTime() > 400 * 86_400_000) throw new HTTPException(400, { message: "Intervalo no válido" });
    return c.json(await eventsBetween(c.get("user").id, f, t));
  })
  // Comprados sin regalar cuya fecha ya pasó
  .get("/pending-gifts", async (c) => c.json(await pendingGifts(c.get("user").id)));

// ---------- Exportación vCard ----------

export const exportRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  /** Todos los contactos visibles. ?gifts=true añade tus ideas de regalo (X-CONTACTOS-GIFT). */
  .get(
    "/contacts.vcf",
    zValidator("query", z.object({ gifts: z.enum(["true", "false"]).default("false"), tag: z.string().uuid().optional() })),
    async (c) => {
      const user = c.get("user");
      const { gifts, tag } = c.req.valid("query");
      if (!tag) {
        const { vcf } = await buildVcf(user.id, null, gifts === "true");
        return c.body(vcf, 200, vcfHeaders("contactos"));
      }
      // ?tag=… → los contactos con esa etiqueta, cada uno con los datos de esa etiqueta
      const [t] = await db.select().from(schema.tags).where(and(eq(schema.tags.id, tag), eq(schema.tags.userId, user.id)));
      if (!t) throw new HTTPException(404, { message: "Etiqueta no encontrada" });
      const all = await expandTagIds(user.id, [tag]); // con sus subetiquetas
      const ids = [...new Set((await db.select({ id: schema.contactTags.contactId }).from(schema.contactTags).where(inArray(schema.contactTags.tagId, all))).map((r) => r.id))];
      const { vcf } = ids.length ? await buildVcf(user.id, ids, gifts === "true", tag) : { vcf: "" };
      const slug = t.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
      return c.body(vcf, 200, vcfHeaders(`contactos-${slug || "etiqueta"}`));
    },
  )
  /** Solo los contactos seleccionados en la lista. */
  .post("/selection.vcf", zValidator("json", exportSelectionSchema), async (c) => {
    const { ids, gifts, tagId } = c.req.valid("json");
    const { vcf } = await buildVcf(c.get("user").id, ids, gifts, tagId);
    return c.body(vcf, 200, vcfHeaders("contactos-seleccion"));
  });
