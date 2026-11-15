import { and, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { HISTORY_DAYS, historyFields, type HistoryField } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { deletePhoto } from "./photos.js";

const c = schema.contacts;
const h = schema.contactHistory;
type ContactRow = typeof c.$inferSelect;
export type Snapshot = Pick<ContactRow, HistoryField>;
type Executor = Pick<typeof db, "insert" | "select" | "update" | "delete">;

/** Los campos del contacto que se guardan en el historial. */
export function snapshotOf(row: ContactRow): Snapshot {
  const s = {} as Record<string, unknown>;
  for (const f of historyFields) s[f] = row[f];
  return s as Snapshot;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Campos que han cambiado entre dos estados. */
export function diffSnapshots(before: Snapshot | null, after: Snapshot) {
  const out: { field: string; before: unknown; after: unknown }[] = [];
  for (const f of historyFields) {
    const a = before ? before[f] : null;
    const b = after[f];
    if (!same(a, b)) out.push({ field: f, before: a ?? null, after: b ?? null });
  }
  return out;
}

/**
 * Apunta un cambio en el historial. En «update» y «merge» no se apunta nada si no ha
 * cambiado ningún campo.
 */
export async function recordHistory(
  ex: Executor,
  e: {
    contactId: string;
    userId: string | null;
    action: "create" | "update" | "delete" | "restore" | "merge";
    before?: ContactRow | null;
    after: ContactRow;
    meta?: Record<string, unknown>;
  },
) {
  const after = snapshotOf(e.after);
  const changes = e.action === "delete" ? [] : diffSnapshots(e.before ? snapshotOf(e.before) : null, after);
  if ((e.action === "update" || e.action === "merge") && !changes.length && !e.meta?.force) return;
  await ex.insert(h).values({
    contactId: e.contactId,
    userId: e.userId,
    action: e.action,
    changes: e.action === "create" ? changes.filter((x) => x.after !== "" && !same(x.after, [])) : changes,
    snapshot: after as Record<string, unknown>,
    meta: e.meta ?? {},
  });
}

/** Lee una fila de contacto (incluidos los borrados). */
export async function rawContact(id: string, ex: Executor = db) {
  const [row] = await ex.select().from(c).where(eq(c.id, id));
  return row;
}

/** Ids (de entre los dados) que tienen cambios posteriores a su creación en el historial. */
export async function idsWithHistory(ids: string[]) {
  if (!ids.length) return new Set<string>();
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 5000) {
    const rows = await db
      .selectDistinct({ id: h.contactId })
      .from(h)
      .where(and(inArray(h.contactId, ids.slice(i, i + 5000)), ne(h.action, "create")));
    rows.forEach((r) => out.add(r.id));
  }
  return out;
}

/**
 * Limpieza: borra el historial de más de 60 días y elimina del todo los contactos
 * que llevan más de 60 días en la papelera (con su foto).
 */
export async function purgeOld() {
  const limit = new Date(Date.now() - HISTORY_DAYS * 86400_000);
  const hist = await db.delete(h).where(lt(h.createdAt, limit)).returning({ id: h.id });
  const gone = await db
    .delete(c)
    .where(and(isNotNull(c.deletedAt), lt(c.deletedAt, limit)))
    .returning({ id: c.id, photoKey: c.photoKey });
  for (const g of gone) if (g.photoKey) await deletePhoto(g.photoKey).catch(() => {});
  if (hist.length || gone.length) console.log(`Limpieza: ${hist.length} cambios del historial y ${gone.length} contactos de la papelera eliminados`);
  return { history: hist.length, contacts: gone.length };
}

export function startPurgeJob() {
  const run = () => purgeOld().catch((e) => console.warn("Limpieza del historial:", (e as Error).message));
  setTimeout(run, 30_000);
  setInterval(run, 6 * 3600_000).unref();
}

