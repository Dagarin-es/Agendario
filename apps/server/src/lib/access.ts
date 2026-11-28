import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "../db/index.js";

const c = schema.contacts;

/**
 * Cada contacto es solo de su dueño (desde la 1.6.0 no se comparte entre usuarios).
 * Se conservan canRead/canEdit para no tocar el resto del código: los dos equivalen a «es mío».
 */
export function canReadSql(userId: string): SQL {
  return sql`(${c.ownerId} = ${userId})`;
}

export function canEditSql(userId: string): SQL<boolean> {
  return sql<boolean>`(${c.ownerId} = ${userId})`;
}

export function visibleContacts(userId: string) {
  return and(isNull(c.deletedAt), canReadSql(userId))!;
}

export type Access = { canEdit: boolean; isMine: boolean };

/** Devuelve los permisos del usuario sobre un contacto o lanza 404 si no puede verlo. */
export async function getAccess(contactId: string, userId: string): Promise<Access> {
  const [row] = await db
    .select({ ownerId: c.ownerId, canEdit: canEditSql(userId) })
    .from(c)
    .where(and(eq(c.id, contactId), visibleContacts(userId)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Contacto no encontrado" });
  return { canEdit: row.canEdit, isMine: row.ownerId === userId };
}

export async function requireEdit(contactId: string, userId: string) {
  const access = await getAccess(contactId, userId);
  if (!access.canEdit) throw new HTTPException(403, { message: "Solo lectura" });
  return access;
}

export async function requireOwner(contactId: string, userId: string) {
  const access = await getAccess(contactId, userId);
  if (!access.isMine) throw new HTTPException(403, { message: "Solo el propietario puede hacer esto" });
  return access;
}

/** Marca el contacto como modificado (para ETags/sincronización futura). */
export async function touchContact(contactId: string) {
  await db
    .update(c)
    .set({ updatedAt: new Date(), revision: sql`${c.revision} + 1` })
    .where(eq(c.id, contactId));
}
