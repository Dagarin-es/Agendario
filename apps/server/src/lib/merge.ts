import { and, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Address, LabeledValue, MergeRequest } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { normalizeEmail, normalizePhone } from "./duplicates.js";
import { deletePhoto } from "./photos.js";
import { rawContact, recordHistory } from "./history.js";
import { ensureItemIds, itemIdsOf } from "./items.js";

const c = schema.contacts;
const dd = schema.duplicateDismissals;
type Row = typeof c.$inferSelect;

async function loadPair(userId: string, keepId: string, removeId: string) {
  if (keepId === removeId) throw new HTTPException(400, { message: "Son el mismo contacto" });
  const rows = await db
    .select()
    .from(c)
    .where(and(eq(c.ownerId, userId), isNull(c.deletedAt), inArray(c.id, [keepId, removeId])));
  const keep = rows.find((r) => r.id === keepId);
  const remove = rows.find((r) => r.id === removeId);
  if (!keep || !remove) throw new HTTPException(404, { message: "Contacto no encontrado" });
  return { keep, remove };
}

// ---------- Combinación automática ----------

const keyOf = {
  phones: (x: LabeledValue) => normalizePhone(x.value) ?? x.value.trim(),
  emails: (x: LabeledValue) => normalizeEmail(x.value),
  urls: (x: LabeledValue) => x.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, ""),
  addresses: (a: Address) =>
    [a.street, a.city, a.postalCode].join("|").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9|]/g, ""),
};

function union<T>(a: T[], b: T[], key: (x: T) => string, max: number): T[] {
  const seen = new Set(a.map(key));
  const out = [...a];
  for (const x of b) {
    const k = key(x);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out.slice(0, max);
}

/** Si una dirección repetida solo estaba geolocalizada en el otro contacto, conserva esas coordenadas. */
function withCoords(list: Address[], others: Address[]): Address[] {
  return list.map((a) => {
    if (typeof a.lat === "number") return a;
    const o = others.find((x) => typeof x.lat === "number" && keyOf.addresses(x) === keyOf.addresses(a));
    return o ? { ...a, lat: o.lat, lon: o.lon } : a;
  });
}

const pick = (a: string, b: string) => (a.trim() ? a : b);

/** Lo que haría «Combinar automáticamente»: lo del principal y, donde esté vacío, lo del otro; las listas se suman sin repetidos. */
export function autoMergeValues(keep: Row, remove: Row): Omit<MergeRequest, "keepId" | "removeId"> {
  const notesA = keep.notes.trim();
  const notesB = remove.notes.trim();
  return {
    values: {
      displayName: pick(keep.displayName, remove.displayName),
      givenName: pick(keep.givenName, remove.givenName),
      familyName: pick(keep.familyName, remove.familyName),
      nickname: pick(keep.nickname, remove.nickname),
      mobileName: ((keep.mobileName && keep.mobileName !== "full" ? keep.mobileName : remove.mobileName) ?? "full") as "full" | "nickname" | "display",
      organization: pick(keep.organization, remove.organization),
      organizationContactId: keep.organization.trim() ? keep.organizationContactId : remove.organizationContactId,
      jobTitle: pick(keep.jobTitle, remove.jobTitle),
      birthday: keep.birthday ?? remove.birthday,
      notes: (notesA && notesB && notesA !== notesB ? `${notesA}\n\n${notesB}` : notesA || notesB).slice(0, 10000),
      phones: union(keep.phones, remove.phones, keyOf.phones, 20),
      emails: union(keep.emails, remove.emails, keyOf.emails, 20),
      urls: union(keep.urls, remove.urls, keyOf.urls, 20),
      addresses: withCoords(union(keep.addresses, remove.addresses, keyOf.addresses, 10), remove.addresses),
    },
    photoFrom: keep.photoKey ? "keep" : remove.photoKey ? "remove" : "none",
  };
}

// ---------- Fusión ----------

/**
 * Fusiona `removeId` en `keepId`:
 * - el que se conserva recibe `values` (elegidos en el panel o calculados automáticamente);
 * - se trasladan etiquetas, regalos, fechas, relaciones y compartidos;
 * - el duplicado se borra y su UID se recuerda para no recrearlo al reimportar.
 */
export async function mergeContacts(userId: string, req: MergeRequest) {
  const { keepId, removeId, photoFrom } = req;
  const values = ensureItemIds(req.values);
  const { keep, remove } = await loadPair(userId, keepId, removeId);

  let photoKey = keep.photoKey;
  const photosToDelete: string[] = [];
  if (photoFrom === "remove" && remove.photoKey) {
    photoKey = remove.photoKey;
    if (keep.photoKey) photosToDelete.push(keep.photoKey);
  } else if (photoFrom === "none") {
    photoKey = null;
    if (keep.photoKey) photosToDelete.push(keep.photoKey);
    if (remove.photoKey) photosToDelete.push(remove.photoKey);
  } else if (remove.photoKey) {
    photosToDelete.push(remove.photoKey);
  }
  // Portada: se queda la del principal; si no tiene, la del otro
  const coverKey = keep.coverKey ?? remove.coverKey ?? null;
  if (keep.coverKey && remove.coverKey) photosToDelete.push(remove.coverKey);

  const mergedUids = [
    ...new Set([...keep.mergedUids, ...remove.mergedUids, `urn:uuid:${remove.id}`, ...(remove.vcardUid ? [remove.vcardUid] : [])]),
  ];

  await db.transaction(async (tx) => {
    await tx
      .update(c)
      .set({
        ...values,
        photoKey,
        coverKey,
        vcardUid: keep.vcardUid ?? remove.vcardUid,
        mergedUids,
        updatedAt: new Date(),
        revision: sql`${c.revision} + 1`,
      })
      .where(eq(c.id, keepId));

    await tx.update(schema.giftIdeas).set({ contactId: keepId }).where(eq(schema.giftIdeas.contactId, removeId));
    // Regalos recibidos: los del eliminado pasan al que se queda (sin repetir si ya estaba en los dos)
    await tx.execute(sql`INSERT INTO gift_received_contacts (gift_id, contact_id)
      SELECT gift_id, ${keepId}::uuid FROM gift_received_contacts WHERE contact_id = ${removeId}::uuid ON CONFLICT DO NOTHING`);
    await tx.delete(schema.giftReceivedContacts).where(eq(schema.giftReceivedContacts.contactId, removeId));
    await tx.update(schema.giftsReceived).set({ contactId: keepId }).where(eq(schema.giftsReceived.contactId, removeId));
    await tx.update(schema.interactions).set({ contactId: keepId }).where(eq(schema.interactions.contactId, removeId));
    await tx.delete(schema.contactPrefs).where(eq(schema.contactPrefs.contactId, removeId));

    await tx.execute(sql`
      INSERT INTO contact_tags (contact_id, tag_id)
      SELECT ${keepId}, tag_id FROM contact_tags WHERE contact_id = ${removeId}
      ON CONFLICT DO NOTHING`);
    await tx.delete(schema.contactTags).where(eq(schema.contactTags.contactId, removeId));

    await tx.execute(sql`
      DELETE FROM important_dates r
      WHERE r.contact_id = ${removeId}
        AND EXISTS (SELECT 1 FROM important_dates k WHERE k.contact_id = ${keepId} AND k.type = r.type AND k.date = r.date)`);
    await tx.update(schema.importantDates).set({ contactId: keepId }).where(eq(schema.importantDates.contactId, removeId));

    await tx.update(schema.relationships).set({ contactId: keepId }).where(eq(schema.relationships.contactId, removeId));
    await tx.update(schema.relationships).set({ relatedContactId: keepId }).where(eq(schema.relationships.relatedContactId, removeId));
    await tx.execute(sql`DELETE FROM relationships WHERE contact_id = related_contact_id`);
    await tx.execute(sql`
      DELETE FROM relationships a USING relationships b
      WHERE a.ctid > b.ctid AND a.contact_id = b.contact_id
        AND a.related_contact_id = b.related_contact_id AND a.type = b.type
        AND a.contact_id = ${keepId}`);

    await tx.execute(sql`
      INSERT INTO contact_shares (contact_id, user_id, group_id, permission)
      SELECT ${keepId}, s.user_id, s.group_id, s.permission FROM contact_shares s
      WHERE s.contact_id = ${removeId}
        AND NOT EXISTS (
          SELECT 1 FROM contact_shares k WHERE k.contact_id = ${keepId}
            AND k.user_id IS NOT DISTINCT FROM s.user_id AND k.group_id IS NOT DISTINCT FROM s.group_id)`);
    await tx.delete(schema.contactShares).where(eq(schema.contactShares.contactId, removeId));

    await tx.delete(dd).where(or(eq(dd.aId, removeId), eq(dd.bId, removeId)));
    // Los contactos que tenían como empresa al duplicado pasan a apuntar al principal
    await tx.update(c).set({ organizationContactId: keepId }).where(eq(c.organizationContactId, removeId));
    await tx.update(c).set({ organizationContactId: null }).where(and(eq(c.id, keepId), eq(c.organizationContactId, keepId)));

    // Etiquetas de cada dato: pasan con el dato al principal; las de datos descartados se borran
    const it = schema.contactItemTags;
    await tx.update(it).set({ contactId: keepId }).where(eq(it.contactId, removeId));
    const finalIds = itemIdsOf(values);
    await tx.delete(it).where(and(eq(it.contactId, keepId), finalIds.length ? notInArray(it.itemId, finalIds) : undefined));

    await tx
      .update(c)
      .set({ deletedAt: new Date(), photoKey: null, updatedAt: new Date(), revision: sql`${c.revision} + 1` })
      .where(eq(c.id, removeId));
  });

  for (const key of photosToDelete) await deletePhoto(key);
  const [keptNow, removedNow] = await Promise.all([rawContact(keepId), rawContact(removeId)]);
  await recordHistory(db, {
    contactId: keepId, userId, action: "merge", before: keep, after: keptNow,
    meta: { force: true, mergedFrom: { id: removeId, displayName: remove.displayName } },
  });
  await recordHistory(db, {
    contactId: removeId, userId, action: "delete", after: removedNow,
    meta: { mergedInto: { id: keepId, displayName: keptNow.displayName } },
  });
  await syncOrgName(keepId);
}

/**
 * Los contactos enlazados a esta empresa toman su nombre actual en el campo «Empresa»
 * (así la búsqueda, los filtros y la exportación también usan el nombre nuevo).
 */
export async function syncOrgName(companyId: string) {
  const [co] = await db.select({ name: c.displayName }).from(c).where(eq(c.id, companyId));
  if (!co) return 0;
  const stale = await db
    .select()
    .from(c)
    .where(and(eq(c.organizationContactId, companyId), sql`${c.organization} IS DISTINCT FROM ${co.name}`));
  for (const before of stale) {
    const [after] = await db
      .update(c)
      .set({ organization: co.name, updatedAt: new Date(), revision: sql`${c.revision} + 1` })
      .where(eq(c.id, before.id))
      .returning();
    await recordHistory(db, {
      contactId: before.id, userId: null, action: "update", before, after,
      meta: { auto: "Nombre de la empresa enlazada actualizado" },
    });
  }
  return stale.length;
}

/** Lo que haría la combinación automática, sin aplicarla (para la vista previa). */
export async function autoMergePreview(userId: string, keepId: string, removeId: string) {
  const { keep, remove } = await loadPair(userId, keepId, removeId);
  return autoMergeValues(keep, remove);
}

export async function autoMerge(userId: string, keepId: string, removeId: string) {
  const { keep, remove } = await loadPair(userId, keepId, removeId);
  await mergeContacts(userId, { keepId, removeId, ...autoMergeValues(keep, remove) });
}

// ---------- Borrado ----------

/**
 * Borra contactos PROPIOS (los compartidos por otros se saltan). Las fotos se eliminan del disco;
 * la fila se marca como borrada para que la futura sincronización pueda propagar el borrado.
 */
export async function deleteContacts(userId: string, ids: string[], extraMeta?: Record<string, Record<string, unknown>>) {
  const unique = [...new Set(ids)];
  let affected = 0;
  for (let i = 0; i < unique.length; i += 1000) {
    const chunk = unique.slice(i, i + 1000);
    const own = and(eq(c.ownerId, userId), isNull(c.deletedAt), inArray(c.id, chunk));
    // Van a la papelera (se conservan 60 días, foto incluida)
    const rows = await db
      .update(c)
      .set({ deletedAt: new Date(), updatedAt: new Date(), revision: sql`${c.revision} + 1` })
      .where(own)
      .returning();
    affected += rows.length;
    if (rows.length) {
      const gone = rows.map((r) => r.id);
      // Quien los tuviera enlazados como empresa conserva el texto, pero pierde el enlace (se recupera al restaurar)
      const linked = await db
        .select({ id: c.id, org: c.organizationContactId })
        .from(c)
        .where(inArray(c.organizationContactId, gone));
      if (linked.length) await db.update(c).set({ organizationContactId: null }).where(inArray(c.organizationContactId, gone));
      const linkedBy = (id: string) => linked.filter((l) => l.org === id).map((l) => l.id);
      await db.delete(dd).where(or(inArray(dd.aId, gone), inArray(dd.bId, gone)));
      for (const r of rows) await recordHistory(db, { contactId: r.id, userId, action: "delete", after: r, meta: { ...(extraMeta?.[r.id] ?? {}), linkedBy: linkedBy(r.id) } });
    }
  }
  return { affected, skipped: unique.length - affected };
}
