import type { OAuthStart, OAuthStatus } from "@agendario/shared";

/**
 * Conexión con Google Drive por «código de dispositivo»: la app muestra un código,
 * el usuario lo escribe en google.com/device con su cuenta y
 * Agendario lo detecta solo. No hay páginas de vuelta ni direcciones que copiar.
 *
 * Usa la app «Agendario» registrada por el autor del proyecto (ver docs/registrar-apps.md).
 */
export const OAUTH_APPS = {
  drive: {
    // App de Google tipo «TV y dispositivos de entrada limitada». Los valores NO están en el código
    // (GitHub bloquea subirlos): vienen de las variables GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET,
    // que la imagen de Docker Hub ya trae de serie (secretos de GitHub Actions) y que en una
    // instalación propia se ponen en el .env.
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    deviceUrl: "https://oauth2.googleapis.com/device/code",
    tokenUrl: "https://oauth2.googleapis.com/token",
    // Solo los ficheros que crea Agendario: no ve el resto de tu Drive
    scope: "https://www.googleapis.com/auth/drive.file",
  },
} as const;

export type OAuthType = keyof typeof OAUTH_APPS;
export const oauthAvailable = (t: OAuthType) => !!OAUTH_APPS[t].clientId;

/** Token en el formato que entiende rclone */
export type RcloneToken = { access_token: string; token_type: string; refresh_token: string; expiry: string };

let current: { type: OAuthType; status: OAuthStatus; cancel: () => void } | null = null;

export function oauthStatus(): OAuthStatus {
  return current?.status ?? { state: "idle" };
}

export function cancelOAuth() {
  current?.cancel();
  current = null;
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

/**
 * Pide un código y empieza a esperar en segundo plano a que el usuario lo autorice.
 * `onToken` recibe el token cuando el usuario acepta.
 */
export async function startDeviceFlow(type: OAuthType, onToken: (t: RcloneToken) => Promise<void>): Promise<OAuthStart> {
  const app = OAUTH_APPS[type];
  if (!app.clientId) throw new Error("Esta instalación no tiene registrada la app de Google");
  cancelOAuth();
  const res = await fetch(app.deviceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ client_id: app.clientId, scope: app.scope }),
  }).catch(() => {
    throw new Error("No se puede contactar con Google. ¿El servidor de Agendario tiene salida a internet?");
  });
  const d = (await res.json().catch(() => ({}))) as {
    device_code?: string;
    user_code?: string;
    verification_url?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !d.device_code) throw new Error(`No se ha podido pedir el código: ${d.error_description ?? d.error ?? res.status}`);

  let stopped = false;
  const entry = { type, status: { state: "pending" } as OAuthStatus, cancel: () => (stopped = true) };
  current = entry;
  let interval = Math.max(5, d.interval ?? 5) * 1000;
  const deadline = Date.now() + (d.expires_in ?? 900) * 1000;

  const poll = async () => {
    while (!stopped && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      if (stopped) return;
      const body: Record<string, string> = {
        client_id: app.clientId,
        device_code: d.device_code!,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      };
      if (app.clientSecret) body.client_secret = app.clientSecret;
      const r = await fetch(app.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(body) }).catch(() => null);
      if (!r) continue;
      const t = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; error?: string; error_description?: string };
      if (t.access_token) {
        try {
          await onToken({
            access_token: t.access_token,
            token_type: t.token_type ?? "Bearer",
            refresh_token: t.refresh_token ?? "",
            expiry: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
          });
          entry.status = { state: "ok" };
        } catch (e) {
          entry.status = { state: "error", message: (e as Error).message };
        }
        return;
      }
      if (t.error === "authorization_pending") continue;
      if (t.error === "slow_down") {
        interval += 5000;
        continue;
      }
      entry.status = {
        state: "error",
        message: t.error === "access_denied" ? "Has rechazado el permiso" : t.error === "expired_token" ? "El código ha caducado: pulsa «Conectar» otra vez" : (t.error_description ?? t.error ?? "Error al autorizar"),
      };
      return;
    }
    if (!stopped && entry.status.state === "pending") entry.status = { state: "error", message: "El código ha caducado: pulsa «Conectar» otra vez" };
  };
  void poll();
  return { userCode: d.user_code!, verificationUrl: d.verification_url ?? d.verification_uri ?? "", expiresIn: d.expires_in ?? 900 };
}
