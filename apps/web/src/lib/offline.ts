/**
 * Modo sin conexión: copia de las fichas en el dispositivo (IndexedDB) y cola de cambios.
 * Si el servidor no responde, la app enseña lo guardado y los cambios permitidos se envían al volver.
 */
import { createStore, get, set } from "idb-keyval";
import type { ContactDetail } from "@agendario/shared";

const store = createStore("agendario-offline", "data");

export interface QueuedChange {
  id: string;
  method: string;
  path: string;
  body?: unknown;
  at: string;
  label: string;
}

interface State {
  offline: boolean;
  pending: number;
  snapshotAt: string | null;
}

let state: State = { offline: typeof navigator !== "undefined" && !navigator.onLine, pending: 0, snapshotAt: null };
const listeners = new Set<(s: State) => void>();
const emit = () => listeners.forEach((l) => l(state));
export const getOfflineState = () => state;
export function onOfflineState(fn: (s: State) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
export function setOffline(v: boolean) {
  if (state.offline !== v) {
    state = { ...state, offline: v };
    emit();
  }
}

// ---------- Copia de las fichas ----------

let details: Map<string, ContactDetail> | null = null;
let loading: Promise<Map<string, ContactDetail>> | null = null;

async function loadDetails() {
  if (details) return details;
  loading ??= (async () => {
    const snap = await get<{ at: string; details: ContactDetail[] }>("snapshot", store).catch(() => undefined);
    details = new Map((snap?.details ?? []).map((d) => [d.id, d]));
    state = { ...state, snapshotAt: snap?.at ?? null };
    emit();
    return details;
  })();
  return loading;
}

export async function saveSnapshot(snap: { at: string; details: ContactDetail[] }) {
  await set("snapshot", snap, store);
  details = new Map(snap.details.map((d) => [d.id, d]));
  state = { ...state, snapshotAt: snap.at };
  emit();
}

export async function snapshotAge(): Promise<number> {
  await loadDetails();
  return state.snapshotAt ? Date.now() - new Date(state.snapshotAt).getTime() : Infinity;
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Respuesta guardada para una petición GET, si la hay. */
export async function offlineGet(path: string): Promise<unknown> {
  const [p, qs] = path.split("?");
  const m = p!.match(/^\/contacts\/([0-9a-f-]{36})$/);
  const d = await loadDetails();
  if (m) return d.get(m[1]!);
  if (p === "/contacts" && d.size) {
    const params = new URLSearchParams(qs ?? "");
    const q = norm(params.get("q") ?? "");
    const tag = params.get("tag");
    return [...d.values()].filter((c) => {
      if (tag && !c.tags.some((t) => t.id === tag)) return false;
      if (!q) return true;
      const hay = norm([c.displayName, c.organization, c.nickname, ...c.phones.map((x) => x.value), ...c.emails.map((x) => x.value)].filter(Boolean).join(" "));
      if (q.split(/\s+/).every((w) => hay.includes(w))) return true;
      // Teléfono sin espacios/guiones (como en el servidor)
      const digits = q.replace(/\D/g, "").replace(/^00/, "");
      return digits.length >= 3 && c.phones.some((x) => x.value.replace(/\D/g, "").includes(digits));
    });
  }
  return undefined;
}

/** Aplica un cambio en cola a la copia local (para verlo sin conexión). */
async function applyLocally(c: QueuedChange) {
  const d = await loadDetails();
  const m = c.path.match(/^\/contacts\/([0-9a-f-]{36})$/);
  if (m && c.method === "PATCH" && d.has(m[1]!)) d.set(m[1]!, { ...d.get(m[1]!)!, ...(c.body as object) });
}

// ---------- Cola de cambios ----------

/** Cambios que se pueden guardar sin conexión (los demás piden conexión). */
const QUEUEABLE: [string, RegExp, string][] = [
  ["PATCH", /^\/contacts\/[0-9a-f-]{36}$/, "Cambios en un contacto"],
  ["PUT", /^\/contacts\/[0-9a-f-]{36}\/prefs$/, "Preferencias de un contacto"],
  ["PUT", /^\/contacts\/[0-9a-f-]{36}\/favorite$/, "Favorito"],
  ["POST", /^\/contacts\/[0-9a-f-]{36}\/interactions$/, "Llamada o apunte"],
  ["PATCH", /^\/interactions\/[0-9a-f-]{36}$/, "Llamada o apunte"],
  ["DELETE", /^\/interactions\/[0-9a-f-]{36}$/, "Borrar una llamada o apunte"],
  ["POST", /^\/contacts\/[0-9a-f-]{36}\/gift-ideas$/, "Idea de regalo"],
  ["PATCH", /^\/gift-ideas\/[0-9a-f-]{36}$/, "Idea de regalo"],
  ["DELETE", /^\/gift-ideas\/[0-9a-f-]{36}$/, "Borrar una idea de regalo"],
  ["POST", /^\/contacts\/[0-9a-f-]{36}\/gifts-received$/, "Regalo recibido"],
];

export function queueLabel(method: string, path: string): string | null {
  const hit = QUEUEABLE.find(([m, re]) => m === method && re.test(path));
  return hit ? hit[2] : null;
}

export async function getQueue(): Promise<QueuedChange[]> {
  return (await get<QueuedChange[]>("queue", store).catch(() => undefined)) ?? [];
}
async function saveQueue(q: QueuedChange[]) {
  await set("queue", q, store);
  state = { ...state, pending: q.length };
  emit();
}

export async function enqueue(method: string, path: string, body: unknown, label: string) {
  const c: QueuedChange = { id: crypto.randomUUID(), method, path, body, at: new Date().toISOString(), label };
  await saveQueue([...(await getQueue()), c]);
  await applyLocally(c);
}

/** Envía la cola en orden; se para en el primer fallo de red. Devuelve cuántos se enviaron. */
export async function flushQueue(send: (c: QueuedChange) => Promise<"ok" | "network" | "rejected">): Promise<number> {
  let q = await getQueue();
  let sent = 0;
  while (q.length) {
    const r = await send(q[0]!);
    if (r === "network") break;
    q = q.slice(1); // enviado, o rechazado por el servidor (no se reintenta para no bloquear la cola)
    sent++;
    await saveQueue(q);
  }
  return sent;
}

export async function initOfflineState() {
  const q = await getQueue();
  state = { ...state, pending: q.length };
  await loadDetails();
}
