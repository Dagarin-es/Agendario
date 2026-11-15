import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "../db/index.js";

const c = schema.contacts;

/** El usuario está en la lista de compartidos del contacto (directamente o por grupo). */
function sharedWith(userId: string, onlyWrite = false): SQL {
  const perm = onlyWrite ? sql`AND s.permission = 'write'` : sql``;
  return sql`EXISTS (
    SELECT 1 FROM contact_shares s
    WHERE s.contact_id = ${c.id} ${perm}
      AND (s.user_id = ${userId}
           OR s.group_id IN (SELECT gm.group_id FROM group_members gm WHERE gm.user_id = ${userId}))
  )`;
}

/**
 * Reglas de visibilidad:
 * - private: solo el propietario (aunque haya compartidos guardados).
 * - shared:  propietario + usuarios/grupos de la lista.
 * - public:  cualquier usuario del servidor (solo lectura, salvo que esté compartido con escritura).
 */
export function canReadSql(userId: string): SQL {
  return sql`(${c.ownerId} = ${userId}
    OR ${c.visibility} = 'public'
    OR (${c.visibility} = 'shared' AND ${sharedWith(userId)}))`;
}

export function canEditSql(userId: string): SQL<boolean> {
  return sql<boolean>`(${c.ownerId} = ${userId}
    OR (${c.visibility} <> 'private' AND ${sharedWith(userId, true)}))`;
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
