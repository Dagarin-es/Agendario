/**
 * ¿Web (PWA) o app de Android? La app se compila con VITE_APP=1: habla con el servidor que elija
 * el usuario (guardado en el móvil) y se identifica con un token en lugar de la cookie.
 */
export const isApp = import.meta.env.VITE_APP === "1";

const KEY_SERVER = "agendario.server";
const KEY_TOKEN = "agendario.token";

const read = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* sin almacenamiento */
  }
};

export const getServer = () => read(KEY_SERVER);
export const setServer = (url: string | null) => write(KEY_SERVER, url ? url.replace(/\/+$/, "") : null);
export const getToken = () => read(KEY_TOKEN);
export const setToken = (t: string | null) => write(KEY_TOKEN, t);

/** Prefijo de la API: «/api» en la web; «https://servidor/api» en la app. */
export const apiBase = () => (isApp ? `${getServer()}/api` : "/api");

/** Dirección de un recurso de la API usable en <img> o enlaces (en la app lleva el token). */
export function apiUrl(path: string) {
  if (!isApp) return `/api${path}`;
  const t = getToken();
  return `${apiBase()}${path}${t ? `${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(t)}` : ""}`;
}

/** Normaliza lo que escribe el usuario: «agendario.midominio.es» → «https://agendario.midominio.es». */
export function normalizeServer(input: string) {
  let v = input.trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  return v.replace(/\/+$/, "").replace(/\/api$/, "");
}
