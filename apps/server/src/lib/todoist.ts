/**
 * Sincronización de los recordatorios con Todoist, en los dos sentidos (API v1, https://api.todoist.com/api/v1).
 *
 * - Agendario → Todoist: al crear, editar, completar o borrar un recordatorio se cambia su tarea al momento.
 * - Todoist → Agendario: cada 5 minutos se revisan las tareas enlazadas (por sondeo, sin webhooks: el servidor
 *   no necesita estar publicado en internet). Completada → recordatorio hecho; cambio de texto o fecha → se copia;
 *   borrada → el recordatorio se queda en Agendario, marcado como «desvinculado».
 *
 * La clave personal de Todoist de cada usuario se guarda en settings («todoist.user.<id>») y nunca se devuelve a la web.
 */
import { reminderKindLabels, type Reminder, type TodoistStatus } from "@agendario/shared";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { deleteSetting, getSetting, setSetting } from "./settings.js";

// Se puede cambiar solo para pruebas (servidor simulado)
const API = (process.env.TODOIST_API_URL || "https://api.todoist.com/api/v1").replace(/\/+$/, "");
const r = schema.reminders;
const c = schema.contacts;

export interface TodoistConfig {
  token: string;
  projectId: string | null;
  projectName: string | null;
  label: string;
  phoneAlerts: boolean;
  publicUrl: string;
  lastSyncAt: string | null;
  lastError: string | null;
}

const key = (userId: string) => `todoist.user.${userId}`;
export const loadTodoist = (userId: string) => getSetting<TodoistConfig | null>(key(userId), null);
export const saveTodoist = (userId: string, cfg: TodoistConfig) => setSetting(key(userId), cfg);
export const forgetTodoist = (userId: string) => deleteSetting(key(userId));

export function statusOf(cfg: TodoistConfig | null): TodoistStatus {
  return {
    connected: !!cfg?.token,
    projectId: cfg?.projectId ?? null,
    projectName: cfg?.projectName ?? null,
    label: cfg?.label ?? "",
    phoneAlerts: cfg?.phoneAlerts ?? true,
    publicUrl: cfg?.publicUrl ?? "",
    lastSyncAt: cfg?.lastSyncAt ?? null,
    lastError: cfg?.lastError ?? null,
  };
}

export class TodoistError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

/** Llamada a la API de Todoist con la clave del usuario. */
async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TodoistError("No se puede conectar con Todoist");
  }
  if (res.status === 401 || res.status === 403) throw new TodoistError("Todoist no acepta la clave (¿caducada o borrada?)", res.status);
  if (res.status === 404) throw new TodoistError("No existe en Todoist", 404);
  if (res.status === 429) throw new TodoistError("Todoist pide esperar un poco (demasiadas peticiones)", 429);
  if (!res.ok) throw new TodoistError(`Todoist ha respondido con un error (${res.status})`, res.status);
  if (res.status === 204) return null as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

interface Task {
  id: string;
  content: string;
  description?: string;
  checked?: boolean;
  is_deleted?: boolean;
  updated_at?: string | null;
  due?: { date: string; timezone?: string | null } | null;
}
type Paged<T> = { results?: T[]; items?: T[]; next_cursor?: string | null };

/** Recorre todas las páginas de un listado. */
async function all<T>(token: string, path: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null | undefined = null;
  for (let n = 0; n < 50; n++) {
    const sep = path.includes("?") ? "&" : "?";
    const page: Paged<T> = await call<Paged<T>>(token, "GET", `${path}${sep}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...(page.results ?? page.items ?? []));
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return out;
}

export async function listProjects(token: string) {
  const rows = await all<{ id: string; name: string; inbox_project?: boolean; is_inbox_project?: boolean }>(token, "/projects");
  return rows.map((p) => ({ id: p.id, name: p.name, inbox: !!(p.inbox_project ?? p.is_inbox_project) }));
}

// ---------- Contenido de la tarea ----------

type ReminderRow = typeof r.$inferSelect;

async function contactName(contactId: string | null) {
  if (!contactId) return null;
  const [row] = await db.select({ name: c.displayName }).from(c).where(eq(c.id, contactId));
  return row?.name ?? null;
}

/** Título de la tarea: el texto del recordatorio o, si no hay, «Llamar · Nombre». */
function contentFor(x: ReminderRow, name: string | null) {
  const label = reminderKindLabels[x.kind as Reminder["kind"]] ?? "Recordatorio";
  return x.text.trim() || [label, name].filter(Boolean).join(" · ");
}

function descriptionFor(x: ReminderRow, name: string | null, cfg: TodoistConfig) {
  const base = cfg.publicUrl.replace(/\/+$/, "");
  const lines = [];
  if (name) lines.push(`👤 ${name}`);
  const path = x.contactId ? `contacts/${x.contactId}` : "reminders";
  if (base) lines.push(`[Abrir en Agendario](${base}/${path})`);
  // En el móvil con la app instalada: abre la ficha directamente en la APK
  lines.push(`[Abrir en la app del móvil](agendario://${path})`);
  return lines.join("\n");
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

function taskBody(x: ReminderRow, name: string | null, cfg: TodoistConfig, create: boolean) {
  return {
    content: contentFor(x, name),
    description: descriptionFor(x, name, cfg),
    due_datetime: iso(x.dueAt),
    ...(cfg.label ? { labels: [cfg.label] } : {}),
    ...(create && cfg.projectId ? { project_id: cfg.projectId } : {}),
  };
}

async function noteError(userId: string, cfg: TodoistConfig, e: unknown) {
  cfg.lastError = e instanceof Error ? e.message : String(e);
  await saveTodoist(userId, cfg);
}

// ---------- Agendario → Todoist ----------

/** Crea o actualiza la tarea de un recordatorio (y la cierra si está hecho). No lanza: apunta el error. */
export async function pushReminder(userId: string, reminderId: string) {
  const cfg = await loadTodoist(userId);
  if (!cfg?.token) return;
  const [x] = await db.select().from(r).where(and(eq(r.id, reminderId), eq(r.userId, userId)));
  if (!x || x.todoistUnlinked) return;
  try {
    const name = await contactName(x.contactId);
    let id = x.todoistId;
    if (!id) {
      if (x.doneAt) return; // un recordatorio ya hecho no se manda
      const t = await call<Task>(cfg.token, "POST", "/tasks", taskBody(x, name, cfg, true));
      id = t.id;
    } else {
      try {
        await call<Task>(cfg.token, "POST", `/tasks/${id}`, taskBody(x, name, cfg, false));
        if (x.doneAt) await call(cfg.token, "POST", `/tasks/${id}/close`);
        // Reabrir por si estaba completada (si ya estaba activa, Todoist puede quejarse: da igual)
        else await call(cfg.token, "POST", `/tasks/${id}/reopen`).catch((e) => { if (e instanceof TodoistError && e.status === 404) throw e; });
      } catch (e) {
        // Borrada en Todoist: se desvincula
        if (e instanceof TodoistError && e.status === 404) {
          await db.update(r).set({ todoistId: null, todoistUnlinked: true }).where(eq(r.id, x.id));
          return;
        }
        throw e;
      }
    }
    await db.update(r).set({ todoistId: id, todoistSyncedAt: new Date() }).where(eq(r.id, x.id));
    if (cfg.lastError) { cfg.lastError = null; await saveTodoist(userId, cfg); }
  } catch (e) {
    await noteError(userId, cfg, e);
  }
}

/** Al borrar un recordatorio en Agendario, se borra su tarea. */
export async function deleteTask(userId: string, todoistId: string | null) {
  if (!todoistId) return;
  const cfg = await loadTodoist(userId);
  if (!cfg?.token) return;
  try {
    await call(cfg.token, "DELETE", `/tasks/${todoistId}`);
  } catch (e) {
    if (!(e instanceof TodoistError && e.status === 404)) await noteError(userId, cfg, e);
  }
}

/** Envía en segundo plano (la respuesta a la web no espera a Todoist). */
export function pushLater(userId: string, reminderId: string) {
  void pushReminder(userId, reminderId).catch(() => undefined);
}

/** Al conectar: manda los recordatorios pendientes que aún no tienen tarea. */
export async function pushExisting(userId: string) {
  const rows = await db.select({ id: r.id }).from(r)
    .where(and(eq(r.userId, userId), isNull(r.doneAt), isNull(r.todoistId)));
  for (const x of rows) await pushReminder(userId, x.id);
  return rows.length;
}

// ---------- Todoist → Agendario ----------

/** Fecha de la tarea → instante. Si solo tiene día, se conserva la hora que ya tenía el recordatorio. */
function dueFromTask(t: Task, current: Date): Date | null {
  const d = t.due?.date;
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const out = new Date(current);
    const [y, m, day] = d.split("-").map(Number);
    out.setUTCFullYear(y!, m! - 1, day!);
    return out;
  }
  // Con zona fija viene en UTC («Z»); sin zona («flotante») se interpreta en hora de Madrid
  if (d.endsWith("Z")) return new Date(d);
  const guess = new Date(`${d.replace(/\.\d+$/, "")}Z`);
  const offset = madridOffsetMin(guess);
  return new Date(guess.getTime() - offset * 60_000);
}

/** Diferencia en minutos de la hora de Madrid respecto a UTC en esa fecha (60 o 120). */
function madridOffsetMin(d: Date) {
  const tz = process.env.TZ && !/^(UTC|Etc\/UTC|GMT)$/i.test(process.env.TZ) ? process.env.TZ : "Europe/Madrid";
  const s = d.toLocaleString("en-US", { timeZone: tz, hour12: false, timeZoneName: "shortOffset" });
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(s);
  return m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0) : 60;
}

/** Revisa las tareas enlazadas de un usuario. Devuelve cuántos recordatorios han cambiado. */
export async function pullUser(userId: string): Promise<number> {
  const cfg = await loadTodoist(userId);
  if (!cfg?.token) return 0;
  const linked = await db.select().from(r).where(and(eq(r.userId, userId), isNull(r.doneAt), isNotNull(r.todoistId)));
  let changed = 0;
  try {
    // Activas, de 100 en 100
    const active = new Map<string, Task>();
    for (let k = 0; k < linked.length; k += 100) {
      const ids = linked.slice(k, k + 100).map((x) => x.todoistId!).join(",");
      for (const t of await all<Task>(cfg.token, `/tasks?ids=${encodeURIComponent(ids)}`)) active.set(String(t.id), t);
    }
    // Las que no están activas: ¿completadas o borradas?
    const missing = linked.filter((x) => !active.has(x.todoistId!));
    let completed = new Set<string>();
    if (missing.length) {
      const until = new Date();
      const since = new Date(Math.max(until.getTime() - 89 * 86_400_000, Math.min(...missing.map((x) => (x.todoistSyncedAt ?? x.createdAt).getTime())) - 86_400_000));
      const done = await all<Task>(cfg.token, `/tasks/completed/by_completion_date?since=${encodeURIComponent(iso(since))}&until=${encodeURIComponent(iso(until))}`);
      completed = new Set(done.map((t) => String(t.id)));
    }
    const now = new Date();
    for (const x of missing) {
      if (completed.has(x.todoistId!)) {
        await db.update(r).set({ doneAt: now, todoistSyncedAt: now, updatedAt: now }).where(eq(r.id, x.id));
      } else {
        // Comprobación final (por si la búsqueda de completadas no la ha traído)
        const t = await call<Task>(cfg.token, "GET", `/tasks/${x.todoistId}`).catch((e) => (e instanceof TodoistError && e.status === 404 ? null : Promise.reject(e)));
        if (t && t.checked && !t.is_deleted) await db.update(r).set({ doneAt: now, todoistSyncedAt: now, updatedAt: now }).where(eq(r.id, x.id));
        else if (!t || t.is_deleted) await db.update(r).set({ todoistId: null, todoistUnlinked: true, updatedAt: now }).where(eq(r.id, x.id));
        else continue;
      }
      changed++;
    }
    // Cambios hechos en Todoist después de nuestra última sincronización
    for (const x of linked) {
      const t = active.get(x.todoistId!);
      if (!t) continue;
      const updated = t.updated_at ? new Date(t.updated_at) : null;
      if (updated && x.todoistSyncedAt && updated.getTime() <= x.todoistSyncedAt.getTime() + 2000) continue;
      const set: Partial<typeof r.$inferInsert> = {};
      const name = await contactName(x.contactId);
      if (t.content.trim() && t.content.trim() !== contentFor(x, name)) set.text = t.content.trim().slice(0, 2000);
      const due = dueFromTask(t, x.dueAt);
      if (due && Math.abs(due.getTime() - x.dueAt.getTime()) > 60_000) set.dueAt = due;
      if (Object.keys(set).length) {
        await db.update(r).set({ ...set, todoistSyncedAt: now, updatedAt: now }).where(eq(r.id, x.id));
        changed++;
      } else {
        await db.update(r).set({ todoistSyncedAt: now }).where(eq(r.id, x.id));
      }
    }
    cfg.lastSyncAt = now.toISOString();
    cfg.lastError = null;
    await saveTodoist(userId, cfg);
  } catch (e) {
    await noteError(userId, cfg, e);
  }
  return changed;
}

const running = new Set<string>();

export function startTodoistScheduler() {
  const tick = async () => {
    try {
      const rows = await db.select({ key: schema.settings.key }).from(schema.settings);
      const users = rows.map((x) => x.key).filter((k) => k.startsWith("todoist.user.")).map((k) => k.slice("todoist.user.".length));
      for (const id of users) {
        if (running.has(id)) continue;
        running.add(id);
        try {
          await pullUser(id);
        } finally {
          running.delete(id);
        }
      }
    } catch (e) {
      console.error("[todoist] programador", e);
    }
  };
  setTimeout(tick, 45_000).unref();
  setInterval(tick, 5 * 60_000).unref();
}

/** Ids de los recordatorios de un usuario enlazados con Todoist (para no programar avisos en el móvil si no quiere). */
export async function linkedIds(userId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db.select({ id: r.id }).from(r).where(and(eq(r.userId, userId), inArray(r.id, ids), isNotNull(r.todoistId)));
  return new Set(rows.map((x) => x.id));
}
