import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray, notInArray, or, sql, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  bulkIdsSchema,
  bulkTagSchema,
  contactInputSchema,
  contactTagsSchema,
  geoStatusOf,
  itemTagSchema,
  contactPatchSchema,
  importantDateInputSchema,
  relationshipInputSchema,
  sharesInputSchema,
  type BulkResult,
  type Contact,
  type ContactDetail,
  type ContactSummary,
  type GiftStatus,
  relationshipInverse,
  type Share,
  type TagLite,
} from "@agendario/shared";
import { db, schema } from "../db/index.js";
import {
  canEditSql,
  getAccess,
  requireEdit,
  requireOwner,
  touchContact,
  visibleContacts,
} from "../lib/access.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import { cleanupItemTags, ensureItemIds, itemIdsOf, itemTagsFor, pickForTag } from "../lib/items.js";
import { addTags, assertOwnTags, expandTagIds, tagsForContacts } from "../lib/tags.js";
import { deleteContacts, syncOrgName } from "../lib/merge.js";
import { idsWithHistory, rawContact, recordHistory } from "../lib/history.js";
import { contactPrefsOf, interactionsOf } from "../lib/personal.js";
import { deletePhoto, MAX_UPLOAD_BYTES, photoType, readPhoto, savePhoto } from "../lib/photos.js";

const c = schema.contacts;

const ACCENTS_FROM = "ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇáàäâéèëêíìïîóòöôúùüûñç";
const ACCENTS_TO = "AAAAEEEEIIIIOOOOUUUUNCaaaaeeeeiiiioooouuuunc";
/** Quita acentos y pasa a minúsculas (igual en JS y en SQL). */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const foldSql = (expr: unknown) => sql`lower(translate(${expr}, ${ACCENTS_FROM}, ${ACCENTS_TO}))`;
const idParam = zValidator("param", z.object({ id: z.string().uuid() }));
const subParam = zValidator("param", z.object({ id: z.string().uuid(), subId: z.string().uuid() }));

function baseSelect(userId: string) {
  return {
    contact: c,
    ownerName: schema.users.name,
    canEdit: canEditSql(userId),
  };
}

type Row = { contact: typeof c.$inferSelect; ownerName: string; canEdit: boolean };

function toSummary(r: Row, userId: string, tags: TagLite[] = [], shown?: { phone?: string; email?: string }): ContactSummary {
  return {
    id: r.contact.id,
    displayName: r.contact.displayName,
    givenName: r.contact.givenName,
    familyName: r.contact.familyName,
    nickname: r.contact.nickname,
    organization: r.contact.organization,
    hasPhoto: !!r.contact.photoKey,
    visibility: r.contact.visibility,
    ownerId: r.contact.ownerId,
    ownerName: r.ownerName,
    isMine: r.contact.ownerId === userId,
    canEdit: r.canEdit,
    updatedAt: r.contact.updatedAt.toISOString(),
    tags,
    phone: shown ? shown.phone : r.contact.phones[0]?.value,
    email: shown ? shown.email : r.contact.emails[0]?.value,
    geo: geoStatusOf(r.contact.addresses),
  };
}

type OrgContact = Contact["organizationContact"];

/** El contacto enlazado como empresa, si existe y el usuario puede verlo. */
async function orgContactOf(r: Row, userId: string): Promise<OrgContact> {
  const linked = r.contact.organizationContactId;
  if (!linked) return null;
  const [o] = await db
    .select({ id: c.id, displayName: c.displayName, photoKey: c.photoKey })
    .from(c)
    .where(and(eq(c.id, linked), visibleContacts(userId)));
  return o ? { id: o.id, displayName: o.displayName, hasPhoto: !!o.photoKey } : null;
}

/** Comprueba que la empresa enlazada es un contacto que el usuario puede ver (y no el mismo). */
async function checkOrgLink(orgId: string | null | undefined, selfId: string | null, userId: string) {
  if (!orgId) return;
  if (orgId === selfId) throw new HTTPException(400, { message: "Un contacto no puede ser su propia empresa" });
  await getAccess(orgId, userId);
}

function toContact(r: Row, userId: string, tags: TagLite[] = [], org: OrgContact = null): Contact {
  const x = r.contact;
  return {
    ...toSummary(r, userId, tags),
    organizationContactId: org ? x.organizationContactId : null,
    organizationContact: org,
    givenName: x.givenName,
    familyName: x.familyName,
    nickname: x.nickname,
    jobTitle: x.jobTitle,
    birthday: x.birthday,
    emails: x.emails,
    phones: x.phones,
    urls: x.urls,
    addresses: x.addresses,
    notes: x.notes,
    createdAt: x.createdAt.toISOString(),
  };
}

async function loadContact(id: string, userId: string) {
  const [row] = await db
    .select(baseSelect(userId))
    .from(c)
    .innerJoin(schema.users, eq(schema.users.id, c.ownerId))
    .where(and(eq(c.id, id), visibleContacts(userId)));
  if (!row) throw new HTTPException(404, { message: "Contacto no encontrado" });
  return row;
}

async function loadShares(contactId: string): Promise<Share[]> {
  const s = schema.contactShares;
  const rows = await db
    .select({
      userId: s.userId,
      groupId: s.groupId,
      permission: s.permission,
      userName: schema.users.name,
      groupName: schema.groups.name,
    })
    .from(s)
    .leftJoin(schema.users, eq(schema.users.id, s.userId))
    .leftJoin(schema.groups, eq(schema.groups.id, s.groupId))
    .where(eq(s.contactId, contactId));
  return rows.map((r) => ({
    userId: r.userId,
    groupId: r.groupId,
    permission: r.permission,
    name: r.userName ?? r.groupName ?? "?",
  }));
}

/** Ficha completa de un contacto (con lo personal del usuario: ideas, llamadas, preferencias…). */
async function buildDetail(id: string, userId: string): Promise<ContactDetail> {
    const row = await loadContact(id, userId);
    const isMine = row.contact.ownerId === userId;

    const related = schema.contacts;
    const [dates, rels, ideas, received, shares, tagMap] = await Promise.all([
      db.select().from(schema.importantDates).where(eq(schema.importantDates.contactId, id)),
      db
        .select({
          id: schema.relationships.id,
          type: schema.relationships.type,
          relatedContactId: schema.relationships.relatedContactId,
          relatedName: related.displayName,
        })
        .from(schema.relationships)
        .innerJoin(related, eq(related.id, schema.relationships.relatedContactId))
        // Solo se muestran relaciones con contactos que el usuario también puede ver.
        .where(and(eq(schema.relationships.contactId, id), visibleContacts(userId))),
      db
        .select()
        .from(schema.giftIdeas)
        .where(and(eq(schema.giftIdeas.contactId, id), eq(schema.giftIdeas.userId, userId)))
        .orderBy(schema.giftIdeas.given, schema.giftIdeas.createdAt),
      db
        .select()
        .from(schema.giftsReceived)
        .where(and(eq(schema.giftsReceived.contactId, id), eq(schema.giftsReceived.userId, userId)))
        .orderBy(sql`${schema.giftsReceived.receivedAt} DESC NULLS LAST`),
      isMine ? loadShares(id) : Promise.resolve(null),
      tagsForContacts([id], userId),
    ]);
    const itemTags = (await itemTagsFor([id], userId)).get(id) ?? {};
    const [interactions, prefs, [{ n: historyCount }], staff] = await Promise.all([
      interactionsOf(userId, id),
      contactPrefsOf(userId, id),
      db.select({ n: sql<number>`count(*)::int` }).from(schema.contactHistory).where(eq(schema.contactHistory.contactId, id)),
      // Trabajadores: contactos visibles que tienen esta ficha enlazada como empresa
      db
        .select({ id: c.id, displayName: c.displayName, jobTitle: c.jobTitle, photoKey: c.photoKey, updatedAt: c.updatedAt, phones: c.phones, emails: c.emails })
        .from(c)
        .where(and(eq(c.organizationContactId, id), visibleContacts(userId)))
        .orderBy(asc(sql`lower(${c.displayName})`)),
    ]);

    const detail: ContactDetail = {
      interactions,
      prefs,
      historyCount,
      employees: staff.map((e) => ({
        id: e.id, displayName: e.displayName, jobTitle: e.jobTitle, hasPhoto: !!e.photoKey, updatedAt: e.updatedAt.toISOString(),
        phone: e.phones[0]?.value, email: e.emails[0]?.value,
      })),
      ...toContact(row, userId, tagMap.get(id), await orgContactOf(row, userId)),
      importantDates: dates.map(({ id, contactId, label, type, date, remindDaysBefore }) => ({
        id, contactId, label, type, date, remindDaysBefore,
      })),
      relationships: rels,
      giftIdeas: ideas.map((g) => ({
        id: g.id,
        contactId: g.contactId,
        title: g.title,
        url: g.url,
        notes: g.notes,
        priceCents: g.priceCents,
        given: g.given,
        givenAt: g.givenAt,
        occasion: g.occasion,
        status: g.status as GiftStatus,
        eventKey: g.eventKey,
        eventLabel: g.eventLabel,
        imageKey: g.imageKey,
        createdAt: g.createdAt.toISOString(),
      })),
      giftsReceived: received.map((g) => ({
        id: g.id,
        contactId: g.contactId,
        description: g.description,
        receivedAt: g.receivedAt,
        occasion: g.occasion,
        notes: g.notes,
        createdAt: g.createdAt.toISOString(),
      })),
      shares,
      itemTags,
    };
    return detail;
}

export const contactRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  // ---------- Acciones en bloque (contactos seleccionados en la lista) ----------
  /** Añadir o quitar una de tus etiquetas a muchos contactos (los que puedas ver). */
  .post("/bulk/tags", zValidator("json", bulkTagSchema), async (ctx) => {
    const user = ctx.get("user");
    const { ids, tagId, op } = ctx.req.valid("json");
    await assertOwnTags([tagId], user.id);
    const ct = schema.contactTags;
    let affected = 0;
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = [...new Set(ids.slice(i, i + 1000))];
      const visible = (await db.select({ id: c.id }).from(c).where(and(inArray(c.id, chunk), visibleContacts(user.id)))).map((r) => r.id);
      if (!visible.length) continue;
      if (op === "add") {
        const res = await db.insert(ct).values(visible.map((contactId) => ({ contactId, tagId }))).onConflictDoNothing().returning();
        affected += res.length;
      } else {
        const res = await db.delete(ct).where(and(eq(ct.tagId, tagId), inArray(ct.contactId, visible))).returning();
        affected += res.length;
        const it = schema.contactItemTags;
        await db.delete(it).where(and(eq(it.userId, user.id), eq(it.tagId, tagId), inArray(it.contactId, visible)));
      }
    }
    return ctx.json({ affected, skipped: ids.length - affected } satisfies BulkResult);
  })

  /** Borrar muchos contactos. Solo se borran los tuyos; los compartidos por otros se saltan. */
  .post("/bulk/delete", zValidator("json", bulkIdsSchema), async (ctx) => {
    const res = await deleteContacts(ctx.get("user").id, ctx.req.valid("json").ids);
    return ctx.json(res satisfies BulkResult);
  })

  // ---------- Lista y búsqueda ----------
  .get("/", zValidator("query", z.object({ q: z.string().optional(), tag: z.string().uuid().optional() })), async (ctx) => {
    const user = ctx.get("user");
    const { q, tag } = ctx.req.valid("query");
    // La etiqueta incluye sus subetiquetas (como carpetas)
    const tagSet = tag ? await expandTagIds(user.id, [tag]) : [];
    const byTag = tag
      ? sql`EXISTS (SELECT 1 FROM contact_tags x JOIN tags tg ON tg.id = x.tag_id
               WHERE x.contact_id = ${c.id} AND x.tag_id IN (${sql.join(tagSet.map((id) => sql`${id}::uuid`), sql`, `)}) AND tg.user_id = ${user.id})`
      : undefined;
    // Búsqueda sin distinguir acentos ni mayúsculas; en teléfonos se ignoran espacios y guiones.
    const term = q?.trim() ? `%${fold(q.trim())}%` : "";
    const digits = q?.replace(/\D/g, "") ?? "";
    const search = term
      ? or(
          sql`${foldSql(c.displayName)} LIKE ${term}`,
          sql`${foldSql(c.organization)} LIKE ${term}`,
          sql`${foldSql(c.nickname)} LIKE ${term}`,
          sql`${foldSql(sql`${c.emails}::text`)} LIKE ${term}`,
          ...(digits.length >= 3 ? [sql`regexp_replace(${c.phones}::text, '[^0-9]', '', 'g') LIKE ${"%" + digits + "%"}`] : []),
        )
      : undefined;
    const rows = await db
      .select(baseSelect(user.id))
      .from(c)
      .innerJoin(schema.users, eq(schema.users.id, c.ownerId))
      .where(and(visibleContacts(user.id), search, byTag))
      .orderBy(asc(sql`lower(${c.displayName})`))
      .limit(20000);
    const tags = await tagsForContacts(rows.map((r) => r.contact.id), user.id);
    const withHistory = await idsWithHistory(rows.map((r) => r.contact.id));
    // Con filtro por etiqueta, el teléfono/email que se muestran son los de esa etiqueta
    const itemTags = tag ? await itemTagsFor(rows.map((r) => r.contact.id), user.id) : null;
    return ctx.json(
      rows.map((r) => {
        const shown = itemTags
          ? {
              phone: pickForTag(r.contact.phones, itemTags.get(r.contact.id), new Set(tagSet))[0]?.value,
              email: pickForTag(r.contact.emails, itemTags.get(r.contact.id), new Set(tagSet))[0]?.value,
            }
          : undefined;
        return { ...toSummary(r, user.id, tags.get(r.contact.id), shown), hasHistory: withHistory.has(r.contact.id) };
      }),
    );
  })

  // Total de contactos visibles (para «Todos · N»)
  .get("/count", async (ctx) => {
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(c).where(visibleContacts(ctx.get("user").id));
    return ctx.json({ total: n });
  })

  // ---------- CRUD ----------
  .post("/", zValidator("json", contactInputSchema), async (ctx) => {
    const user = ctx.get("user");
    await checkOrgLink(ctx.req.valid("json").organizationContactId, null, user.id);
    const [created] = await db
      .insert(c)
      .values({ ...ensureItemIds(ctx.req.valid("json")), ownerId: user.id })
      .returning();
    await recordHistory(db, { contactId: created.id, userId: user.id, action: "create", after: created });
    const row = await loadContact(created.id, user.id);
    return ctx.json(toContact(row, user.id, [], await orgContactOf(row, user.id)), 201);
  })

  // Todo para el modo sin conexión de la app: las fichas completas de todos los contactos visibles
  .get("/offline-snapshot", async (ctx) => {
    const user = ctx.get("user");
    const ids = (await db.select({ id: c.id }).from(c).where(and(visibleContacts(user.id), isNull(c.deletedAt)))).map((r) => r.id);
    const details: ContactDetail[] = [];
    for (let k = 0; k < ids.length; k += 8) {
      details.push(...(await Promise.all(ids.slice(k, k + 8).map((id) => buildDetail(id, user.id).catch(() => null)))).filter((d): d is ContactDetail => !!d));
    }
    return ctx.json({ at: new Date().toISOString(), details });
  })
  .get("/:id", idParam, async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    return ctx.json(await buildDetail(id, user.id));
  })

  .patch("/:id", idParam, zValidator("json", contactPatchSchema), async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    const access = await requireEdit(id, user.id);
    const body = ctx.req.valid("json");
    // Solo el propietario decide quién ve el contacto.
    if (body.visibility && !access.isMine) delete body.visibility;
    await checkOrgLink(body.organizationContactId, id, user.id);
    const before = await rawContact(id);
    const [after] = await db
      .update(c)
      .set({ ...ensureItemIds(body), updatedAt: new Date(), revision: sql`${c.revision} + 1` })
      .where(eq(c.id, id))
      .returning();
    await recordHistory(db, { contactId: id, userId: user.id, action: "update", before, after });
    const updated = await loadContact(id, user.id);
    await cleanupItemTags(id, itemIdsOf(updated.contact)); // etiquetas de datos que se han quitado
    if (body.displayName !== undefined) await syncOrgName(id); // si es la empresa de otros contactos, se les actualiza el nombre
    return ctx.json(toContact(updated, user.id, [], await orgContactOf(updated, user.id)));
  })

  .delete("/:id", idParam, async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await requireOwner(id, user.id);
    await deleteContacts(user.id, [id]);
    return ctx.body(null, 204);
  })

  // ---------- Foto ----------
  .get("/:id/photo", idParam, zValidator("query", z.object({ size: z.enum(["full", "thumb"]).default("thumb") })), async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    const row = await loadContact(id, user.id);
    if (!row.contact.photoKey) throw new HTTPException(404, { message: "Sin foto" });
    const data = await readPhoto(row.contact.photoKey, ctx.req.valid("query").size);
    return ctx.body(new Uint8Array(data), 200, {
      "Content-Type": photoType(row.contact.photoKey),
      "Cache-Control": "private, max-age=86400",
      ETag: `"${row.contact.photoKey}"`,
    });
  })

  .put("/:id/photo", idParam, async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await requireEdit(id, user.id);
    const form = await ctx.req.parseBody();
    const file = form["photo"];
    if (!(file instanceof File)) throw new HTTPException(400, { message: "Falta el campo 'photo'" });
    if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "La imagen es demasiado grande" });

    let key: string;
    try {
      key = await savePhoto(Buffer.from(await file.arrayBuffer()));
    } catch {
      throw new HTTPException(400, { message: "No es una imagen válida" });
    }
    const old = await rawContact(id);
    const [after] = await db.update(c).set({ photoKey: key }).where(eq(c.id, id)).returning();
    await recordHistory(db, { contactId: id, userId: user.id, action: "update", before: old, after });
    await touchContact(id);
    if (old?.photoKey) await deletePhoto(old.photoKey);
    return ctx.json({ ok: true });
  })

  .delete("/:id/photo", idParam, async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await requireEdit(id, user.id);
    const old = await rawContact(id);
    const [after] = await db.update(c).set({ photoKey: null }).where(eq(c.id, id)).returning();
    await recordHistory(db, { contactId: id, userId: user.id, action: "update", before: old, after });
    await touchContact(id);
    if (old?.photoKey) await deletePhoto(old.photoKey);
    return ctx.body(null, 204);
  })

  // ---------- Etiquetas (personales: basta con poder ver el contacto) ----------
  .put("/:id/tags", idParam, zValidator("json", contactTagsSchema), async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await getAccess(id, user.id);
    const tagIds = await assertOwnTags(ctx.req.valid("json").tagIds, user.id);
    const ct = schema.contactTags;
    await db.transaction(async (tx) => {
      // Solo se tocan las etiquetas de este usuario.
      await tx.delete(ct).where(
        and(
          eq(ct.contactId, id),
          inArray(ct.tagId, tx.select({ id: schema.tags.id }).from(schema.tags).where(eq(schema.tags.userId, user.id))),
        ),
      );
      if (tagIds.length) await tx.insert(ct).values(tagIds.map((tagId) => ({ contactId: id, tagId })));
      // Si se quita una etiqueta del contacto, sus datos dejan de tenerla
      const it = schema.contactItemTags;
      await tx
        .delete(it)
        .where(and(eq(it.contactId, id), eq(it.userId, user.id), tagIds.length ? notInArray(it.tagId, tagIds) : undefined));
    });
    const tags = await tagsForContacts([id], user.id);
    return ctx.json(tags.get(id) ?? []);
  })

  /**
   * Etiqueta de un dato concreto (teléfono, email, dirección). tagId null = sin etiqueta.
   * Solo se pueden usar etiquetas tuyas; si el contacto no la tiene, se le añade también.
   */
  .put("/:id/items/:itemId/tag", zValidator("param", z.object({ id: z.string().uuid(), itemId: z.string().min(1).max(64) })), zValidator("json", itemTagSchema), async (ctx) => {
    const user = ctx.get("user");
    const { id, itemId } = ctx.req.valid("param");
    const { tagId } = ctx.req.valid("json");
    await getAccess(id, user.id);
    const row = await loadContact(id, user.id);
    if (!itemIdsOf(row.contact).includes(itemId)) throw new HTTPException(404, { message: "Ese dato no existe en el contacto" });
    const it = schema.contactItemTags;
    if (tagId === null) {
      await db.delete(it).where(and(eq(it.userId, user.id), eq(it.contactId, id), eq(it.itemId, itemId)));
    } else {
      await assertOwnTags([tagId], user.id);
      await addTags(id, [tagId]);
      await db
        .insert(it)
        .values({ userId: user.id, contactId: id, itemId, tagId })
        .onConflictDoUpdate({ target: [it.userId, it.contactId, it.itemId], set: { tagId } });
    }
    return ctx.json((await itemTagsFor([id], user.id)).get(id) ?? {});
  })

  // ---------- Compartir (solo propietario) ----------
  .put("/:id/shares", idParam, zValidator("json", sharesInputSchema), async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await requireOwner(id, user.id);
    const { shares } = ctx.req.valid("json");
    const clean = shares.filter((s) => s.userId !== user.id);

    // Solo se puede compartir con grupos propios o de los que eres miembro.
    const groupIds = clean.map((s) => s.groupId).filter((g): g is string => !!g);
    if (groupIds.length) {
      const allowed = await db
        .select({ id: schema.groups.id })
        .from(schema.groups)
        .leftJoin(schema.groupMembers, eq(schema.groupMembers.groupId, schema.groups.id))
        .where(
          and(
            inArray(schema.groups.id, groupIds),
            or(eq(schema.groups.ownerId, user.id), eq(schema.groupMembers.userId, user.id)),
          ),
        );
      const ok = new Set(allowed.map((g) => g.id));
      if (groupIds.some((g) => !ok.has(g))) throw new HTTPException(403, { message: "Grupo no permitido" });
    }

    await db.transaction(async (tx) => {
      await tx.delete(schema.contactShares).where(eq(schema.contactShares.contactId, id));
      if (clean.length) {
        await tx.insert(schema.contactShares).values(
          clean.map((s) => ({
            contactId: id,
            userId: s.userId ?? null,
            groupId: s.groupId ?? null,
            permission: s.permission,
          })),
        );
      }
    });
    return ctx.json(await loadShares(id));
  })

  // ---------- Fechas importantes ----------
  .post("/:id/dates", idParam, zValidator("json", importantDateInputSchema), async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    await requireEdit(id, user.id);
    const [row] = await db
      .insert(schema.importantDates)
      .values({ ...ctx.req.valid("json"), contactId: id })
      .returning();
    await touchContact(id);
    return ctx.json(row, 201);
  })

  .delete("/:id/dates/:subId", subParam, async (ctx) => {
    const user = ctx.get("user");
    const { id, subId } = ctx.req.valid("param");
    await requireEdit(id, user.id);
    await db
      .delete(schema.importantDates)
      .where(and(eq(schema.importantDates.id, subId), eq(schema.importantDates.contactId, id)));
    await touchContact(id);
    return ctx.body(null, 204);
  })

  // ---------- Relaciones ----------
  .post("/:id/relationships", idParam, zValidator("json", relationshipInputSchema), async (ctx) => {
    const user = ctx.get("user");
    const { id } = ctx.req.valid("param");
    const body = ctx.req.valid("json");
    if (body.relatedContactId === id) throw new HTTPException(400, { message: "Un contacto no puede relacionarse consigo mismo" });
    await requireEdit(id, user.id);
    await getAccess(body.relatedContactId, user.id); // debe poder ver el otro contacto
    const rel = schema.relationships;
    const [row] = await db.insert(rel).values({ contactId: id, relatedContactId: body.relatedContactId, type: body.type }).returning();
    // Recíproca en el otro contacto (si puedes editarlo y no la tiene ya)
    const other = await getAccess(body.relatedContactId, user.id).catch(() => null);
    if (other?.canEdit) {
      const inverse = relationshipInverse[body.type];
      const [exists] = await db.select({ id: rel.id }).from(rel).where(and(eq(rel.contactId, body.relatedContactId), eq(rel.relatedContactId, id), eq(rel.type, inverse)));
      if (!exists) await db.insert(rel).values({ contactId: body.relatedContactId, relatedContactId: id, type: inverse });
      await touchContact(body.relatedContactId);
    }
    await touchContact(id);
    return ctx.json(row, 201);
  })

  .delete("/:id/relationships/:subId", subParam, async (ctx) => {
    const user = ctx.get("user");
    const { id, subId } = ctx.req.valid("param");
    await requireEdit(id, user.id);
    const rel = schema.relationships;
    const [gone] = await db.delete(rel).where(and(eq(rel.id, subId), eq(rel.contactId, id))).returning();
    // Y la recíproca en el otro contacto
    if (gone) {
      const other = await getAccess(gone.relatedContactId, user.id).catch(() => null);
      if (other?.canEdit) {
        await db.delete(rel).where(and(eq(rel.contactId, gone.relatedContactId), eq(rel.relatedContactId, id), eq(rel.type, relationshipInverse[gone.type])));
        await touchContact(gone.relatedContactId);
      }
    }
    await touchContact(id);
    return ctx.body(null, 204);
  });
