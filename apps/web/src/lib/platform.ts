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
export const setToken = (t: string | null) => {
  write(KEY_TOKEN, t);
  if (!t) write(KEY_MEDIA, null);
};
/** Token de imágenes: solo sirve para cargar fotos y descargas (no da acceso a la cuenta). */
const KEY_MEDIA = "agendario.media";
export const getMediaToken = () => read(KEY_MEDIA);
export const setMediaToken = (t: string | null | undefined) => write(KEY_MEDIA, t ?? null);

/** Prefijo de la API: «/api» en la web; «https://servidor/api» en la app. */
export const apiBase = () => (isApp ? `${getServer()}/api` : "/api");

/**
 * Dirección de un recurso de la API usable en <img> o enlaces. En la app lleva el token de imágenes
 * (nunca el de la sesión, que no debe ir en direcciones porque queda en registros de proxies).
 */
export function apiUrl(path: string) {
  if (!isApp) return `/api${path}`;
  const t = getMediaToken();
  return `${apiBase()}${path}${t ? `${path.includes("?") ? "&" : "?"}mt=${encodeURIComponent(t)}` : ""}`;
}

/** Normaliza lo que escribe el usuario: «agendario.midominio.es» → «https://agendario.midominio.es». */
export function normalizeServer(input: string) {
  let v = input.trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  return v.replace(/\/+$/, "").replace(/\/api$/, "");
}

/** Manual en PDF: lo sirve el propio servidor (en la app se abre en el navegador del móvil). */
export const manualUrl = () => `${isApp ? getServer() : ""}/manual/Agendario-Manual.pdf`;
