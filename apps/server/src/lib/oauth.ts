import type { OAuthStart, OAuthStatus } from "@agendario/shared";

/**
 * Conexión con Google Drive y OneDrive por «código de dispositivo»: la app muestra un código,
 * el usuario lo escribe en google.com/device (o microsoft.com/devicelogin) con su cuenta y
 * Agendario lo detecta solo. No hay páginas de vuelta ni direcciones que copiar.
 *
 * Usa las apps «Agendario» registradas una vez por el autor del proyecto (ver docs/registrar-apps.md).
 * Una instalación puede usar las suyas propias con las variables de entorno.
 */
export const OAUTH_APPS = {
  drive: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    // Las apps de Google para «TV y dispositivos de entrada limitada» llevan un secreto que no es secreto
    // (va dentro de cada instalación), igual que hace rclone.
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    deviceUrl: "https://oauth2.googleapis.com/device/code",
    tokenUrl: "https://oauth2.googleapis.com/token",
    // Solo los ficheros que crea Agendario: no ve el resto de tu Drive
    scope: "https://www.googleapis.com/auth/drive.file",
  },
  onedrive: {
    clientId: process.env.MICROSOFT_CLIENT_ID ?? "",
    clientSecret: "",
    deviceUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "Files.ReadWrite offline_access User.Read",
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
  if (!app.clientId) throw new Error("Esta instalación no tiene registrada la app de " + (type === "drive" ? "Google" : "Microsoft"));
  cancelOAuth();
  const res = await fetch(app.deviceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ client_id: app.clientId, scope: app.scope }),
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
