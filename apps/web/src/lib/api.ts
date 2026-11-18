/** Cliente mínimo de la API. En la web usa la cookie de sesión; en la app de Android, un token. */
import { apiBase, apiUrl, getToken, isApp } from "./platform";

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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    credentials: isApp ? "omit" : "same-origin",
    headers: headers(!!body && !isForm),
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
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
