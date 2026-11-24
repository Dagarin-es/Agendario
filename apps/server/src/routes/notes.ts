/**
 * Adjuntos de las llamadas y apuntes, y «Últimas notas» (todas las anotaciones del usuario).
 * Todo es privado: cada usuario solo ve y toca lo suyo.
 */
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, exists, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { interactionKinds, type RecentNote, type RecentNotesPage } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { canReadSql } from "../lib/access.js";
import { attachmentFile, attachmentsFor, deleteAttachmentRow, storeAttachment, thumbFile } from "../lib/attachments.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import { toInteraction } from "../lib/personal.js";
import { expandTagIds } from "../lib/tags.js";

const i = schema.interactions;
const a = schema.interactionAttachments;
const c = schema.contacts;
const u = schema.unknownCalls;
const idParam = zValidator("param", z.object({ id: z.string().uuid() }));

const ACCENTS_FROM = "ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇáàäâéèëêíìïîóòöôúùüûñç";
const ACCENTS_TO = "AAAAEEEEIIIIOOOOUUUUNCaaaaeeeeiiiioooouuuunc";
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const foldSql = (expr: unknown) => sql`lower(translate(${expr}, ${ACCENTS_FROM}, ${ACCENTS_TO}))`;

async function ownAttachment(id: string, userId: string) {
  const [row] = await db.select().from(a).where(and(eq(a.id, id), eq(a.userId, userId)));
  if (!row) throw new HTTPException(404, { message: "Adjunto no encontrado" });
  return row;
}

/** Nombre para la cabecera Content-Disposition (con tildes y eñes, RFC 5987). */
function disposition(kind: "inline" | "attachment", name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export const noteRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  // ---------- Adjuntos ----------
  .post("/interactions/:id/attachments", idParam, async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    const [row] = await db.select({ id: i.id }).from(i).where(and(eq(i.id, id), eq(i.userId, user.id)));
    if (!row) throw new HTTPException(404, { message: "Llamada no encontrada" });
    return ctx.json(await storeAttachment(ctx, { userId: user.id, interactionId: id }), 201);
  })
  .post("/unknown-calls/:id/attachments", idParam, async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    const [row] = await db.select({ id: u.id }).from(u).where(and(eq(u.id, id), eq(u.userId, user.id)));
    if (!row) throw new HTTPException(404, { message: "Llamada no encontrada" });
    return ctx.json(await storeAttachment(ctx, { userId: user.id, unknownCallId: id }), 201);
  })
  .get("/attachments/:id", idParam, zValidator("query", z.object({ download: z.string().optional(), mt: z.string().optional() })), async (ctx) => {
    const row = await ownAttachment(ctx.req.valid("param").id, ctx.get("user").id);
    const data = await readFile(attachmentFile(row.fileKey)).catch(() => null);
    if (!data) throw new HTTPException(404, { message: "El archivo ya no está en el servidor" });
    // Solo se muestran en el navegador las fotos, los PDF y los audios; lo demás se descarga
    const inline = !ctx.req.valid("query").download && /^(image\/(jpeg|png|webp)|application\/pdf|audio\/)/.test(row.mime);
    return ctx.body(new Uint8Array(data), 200, {
      "Content-Type": row.mime,
      "Content-Length": String(data.length),
      "Content-Disposition": disposition(inline ? "inline" : "attachment", row.name),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    });
  })
  .get("/attachments/:id/thumb", idParam, async (ctx) => {
    const row = await ownAttachment(ctx.req.valid("param").id, ctx.get("user").id);
    const data = row.hasThumb ? await readFile(thumbFile(row.fileKey)).catch(() => null) : null;
    if (!data) throw new HTTPException(404, { message: "Sin miniatura" });
    return ctx.body(new Uint8Array(data), 200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=604800" });
  })
  .delete("/attachments/:id", idParam, async (ctx) => {
    const row = await ownAttachment(ctx.req.valid("param").id, ctx.get("user").id);
    await deleteAttachmentRow(row.id);
    return ctx.body(null, 204);
  })

  // ---------- Últimas notas ----------
  .get(
    "/interactions/recent",
    zValidator("query", z.object({
      limit: z.coerce.number().int().min(1).max(100).default(30),
      before: z.string().max(100).optional(),
      kind: z.enum(["calls", "meeting", "message", "note"]).optional(),
      tag: z.string().uuid().optional(),
      q: z.string().max(200).optional(),
    })),
    async (ctx) => {
      const user = ctx.get("user");
      const { limit, before, kind, tag, q } = ctx.req.valid("query");
      const hasAttachment = exists(db.select({ x: sql`1` }).from(a).where(eq(a.interactionId, i.id)));
      const conds: (SQL | undefined)[] = [
        eq(i.userId, user.id),
        isNull(c.deletedAt),
        canReadSql(user.id),
        or(ne(i.notes, ""), hasAttachment),
      ];
      if (kind === "calls") conds.push(inArray(i.kind, interactionKinds.filter((k) => k.startsWith("call_"))));
      else if (kind) conds.push(eq(i.kind, kind));
      if (tag) {
        const ids = await expandTagIds(user.id, [tag]);
        conds.push(sql`EXISTS (SELECT 1 FROM contact_tags x JOIN tags tg ON tg.id = x.tag_id
          WHERE x.contact_id = ${c.id} AND x.tag_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND tg.user_id = ${user.id})`);
      }
      if (q?.trim()) {
        const term = `%${fold(q.trim())}%`;
        conds.push(or(sql`${foldSql(i.notes)} LIKE ${term}`, sql`${foldSql(c.displayName)} LIKE ${term}`));
      }
      if (before) {
        const [at, id] = before.split("|");
        const d = at ? new Date(at) : null;
        if (d && !Number.isNaN(d.getTime()) && id && /^[0-9a-f-]{36}$/.test(id)) {
          conds.push(sql`(${i.occurredAt}, ${i.id}) < (${d.toISOString()}::timestamptz, ${id}::uuid)`);
        }
      }
      const rows = await db
        .select({ it: i, name: c.displayName, photo: c.photoKey, updatedAt: c.updatedAt })
        .from(i)
        .innerJoin(c, eq(c.id, i.contactId))
        .where(and(...conds))
        .orderBy(desc(i.occurredAt), desc(i.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const atts = await attachmentsFor(page.map((r) => r.it.id));
      const items: RecentNote[] = page.map((r) => ({
        ...toInteraction(r.it, atts.get(r.it.id)),
        contactName: r.name,
        contactHasPhoto: !!r.photo,
        contactUpdatedAt: r.updatedAt.toISOString(),
      }));
      const last = page[page.length - 1];
      const out: RecentNotesPage = { items, next: rows.length > limit && last ? `${last.it.occurredAt.toISOString()}|${last.it.id}` : null };
      return ctx.json(out);
    },
  );
