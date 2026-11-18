/** Cliente mínimo de la API. En la web usa la cookie de sesión; en la app de Android, un token. */
import { apiBase, apiUrl, getToken, isApp } from "./platform";
import { enqueue, flushQueue, getOfflineState, offlineGet, queueLabel, saveSnapshot, setOffline, snapshotAge, type QueuedChange } from "./offline";

function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (isApp) {
    h["X-Agendario-Client"] = "app";
    const t = getToken();
    if (t) h.Authorization = `Bearer ${t}`;
  }
  return h;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Sin conexión (o el servidor no responde): no es un error del servidor. */
export class OfflineError extends Error {}

async function send(method: string, path: string, body?: unknown) {
  const isForm = body instanceof FormData;
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method,
      credentials: isApp ? "omit" : "same-origin",
      headers: headers(!!body && !isForm),
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(method === "GET" && path.includes("offline-snapshot") ? 120_000 : 20_000),
    });
    // Un proxy delante (Nginx Proxy Manager) responde 502/503/504 si Agendario no está: es como no tener conexión
    if (res.status >= 502 && res.status <= 504) throw new OfflineError("El servidor no responde");
    setOffline(false);
    return res;
  } catch (e) {
    if (e instanceof OfflineError || e instanceof TypeError || (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") {
      setOffline(true);
      throw new OfflineError("Sin conexión con el servidor");
    }
    throw e;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await send(method, path, body);
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    if (method === "GET") {
      const saved = await offlineGet(path);
      if (saved !== undefined) return saved as T;
      throw new OfflineError("Sin conexión: esto no está guardado en el dispositivo");
    }
    const label = !(body instanceof FormData) ? queueLabel(method, path) : null;
    if (label) {
      await enqueue(method, path, body, label);
      return {} as T;
    }
    throw new OfflineError("Sin conexión: esto necesita conexión con el servidor");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error ?? data?.issues?.[0]?.message ?? `Error ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>("PUT", p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>("PATCH", p, b ?? {}),
  del: <T = void>(p: string) => request<T>("DELETE", p),
};

export const photoUrl = (id: string, size: "thumb" | "full" = "thumb", v?: string) =>
  apiUrl(`/contacts/${id}/photo?size=${size}${v ? `&v=${encodeURIComponent(v)}` : ""}`);

export { apiUrl };

/** Descarga un fichero generado por una petición POST (p. ej. exportar una selección). */
export async function downloadPost(path: string, body: unknown, fallbackName: string) {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    credentials: isApp ? "omit" : "same-origin",
    headers: headers(true),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data?.error ?? `Error ${res.status}`);
  }
  const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- Modo sin conexión ----------

/** Descarga la copia de todas las fichas si tiene más de 6 horas (o si se pide). */
export async function refreshOfflineSnapshot(force = false) {
  if (!force && (await snapshotAge()) < 6 * 3600_000) return;
  const snap = await request<{ at: string; details: import("@agendario/shared").ContactDetail[] }>("GET", "/contacts/offline-snapshot");
  if (snap?.details) await saveSnapshot(snap);
}

/** Envía los cambios hechos sin conexión. Devuelve cuántos se han enviado. */
export async function flushOfflineQueue() {
  return flushQueue(async (c: QueuedChange) => {
    try {
      const res = await send(c.method, c.path, c.body);
      return res.ok || res.status === 404 ? "ok" : "rejected";
    } catch (e) {
      return e instanceof OfflineError ? "network" : "rejected";
    }
  });
}

export const isOfflineNow = () => getOfflineState().offline;
