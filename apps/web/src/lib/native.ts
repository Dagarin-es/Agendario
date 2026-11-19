import { registerPlugin } from "@capacitor/core";
/**
 * Integración con Android (solo en la app): color dinámico de Material You, barras del sistema,
 * botón atrás y vibración. En la web no se carga nada de esto.
 */
import type { ColorTheme, ThemeScale } from "@agendario/shared";
import { isApp } from "./platform";
import { commitNativeIcon, setDynamicScale, setNativeIconHook } from "./theme";
import { getServer, getToken } from "./platform";

type Tones = Record<string, string>; // "0" … "1000" → "#rrggbb"
interface Palette {
  available: boolean;
  accent1?: Tones;
  accent2?: Tones;
  accent3?: Tones;
  neutral1?: Tones;
  neutral2?: Tones;
}

let palette: Palette | null = null;

/** Escala de Tailwind (50…950) ← tonos de Material You (10 = casi blanco … 1000 = negro). */
const steps: [string, string][] = [
  ["50", "50"], ["100", "100"], ["200", "200"], ["300", "300"], ["400", "400"], ["500", "500"],
  ["600", "600"], ["700", "700"], ["800", "800"], ["900", "900"], ["950", "1000"],
];

/** Escala del fondo de pantalla (accent1 de Material You) para el tema «Tu fondo de pantalla». */
function dynamicScale(): ThemeScale | null {
  if (!palette?.available || !palette.accent1) return null;
  const a = palette.accent1;
  return Object.fromEntries(steps.map(([tw, t]) => [Number(tw), a[t]])) as unknown as ThemeScale;
}

/** Colores de las barras del sistema según el tema. */
export async function syncSystemBars() {
  if (!isApp) return;
  const dark = document.documentElement.classList.contains("dark");
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--app-surface").trim() || (dark ? "#0f172a" : "#ffffff");
  await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
  await StatusBar.setBackgroundColor({ color: bg }).catch(() => undefined);
}

export async function haptic() {
  if (!isApp) return;
  const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
  await Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
}

export async function initNative() {
  if (!isApp) return;
  document.documentElement.classList.add("app");
  const { registerPlugin } = await import("@capacitor/core");
  const MaterialYou = registerPlugin<{
    getPalette(): Promise<Palette>;
    setIcon(o: { theme: string }): Promise<void>;
    installedApps(o: { packages: string[] }): Promise<Record<string, boolean>>;
    mailApps(): Promise<{ apps: MailApp[] }>;
    openMail(o: { to: string; package?: string }): Promise<void>;
    consumeShare(): Promise<{ text?: string; title?: string }>;
    consumeOpen(): Promise<{ path?: string }>;
    addListener(e: "open", fn: (d: { path?: string }) => void): Promise<unknown>;
    addListener(e: "share", fn: (d: { text?: string; title?: string }) => void): Promise<unknown>;
  }>("MaterialYou");
  nativeApi.installedApps = (packages) => MaterialYou.installedApps({ packages });
  nativeApi.mailApps = () => MaterialYou.mailApps().then((r) => r.apps ?? []);
  nativeApi.openMail = (to, pkg) => MaterialYou.openMail({ to, ...(pkg ? { package: pkg } : {}) });
  // «Compartir» desde otra app → Añadir idea de regalo
  const share = (d: { text?: string; title?: string }) => d?.text && window.dispatchEvent(new CustomEvent("agendario-share", { detail: d }));
  void MaterialYou.addListener("share", share).catch(() => undefined);
  setTimeout(() => void MaterialYou.consumeShare().then(share).catch(() => undefined), 800);
  // Abrir una ficha desde un aviso (p. ej. «Abrir ficha» tras una llamada)
  const open = (d: { path?: string }) => d?.path && window.dispatchEvent(new CustomEvent("agendario-open", { detail: d.path }));
  void MaterialYou.addListener("open", open).catch(() => undefined);
  setTimeout(() => void MaterialYou.consumeOpen().then(open).catch(() => undefined), 900);
  try {
    palette = await MaterialYou.getPalette();
    setDynamicScale(dynamicScale());
  } catch {
    /* Android anterior a 12: sin colores del fondo de pantalla */
  }
  // Icono del lanzador con el tono del tema
  setNativeIconHook((t: ColorTheme) => void MaterialYou.setIcon({ theme: t === "dynamic" ? "indigo" : t }).catch(() => undefined));
  await syncSystemBars();
  // Cambios de tema (auto/claro/oscuro): las barras siguen al tema
  new MutationObserver(() => void syncSystemBars()).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  // Botón atrás de Android: atrás en la app; en la pantalla principal, salir
  const { App } = await import("@capacitor/app");
  // El icono del lanzador se cambia al salir de la app (Android la reinicia al cambiarlo)
  App.addListener("appStateChange", ({ isActive }) => { if (!isActive) commitNativeIcon(); });
  // Registro de llamadas: que el envío en segundo plano tenga el servidor y la sesión actuales
  void configureCallLog();
  App.addListener("backButton", ({ canGoBack }) => {
    if (document.querySelector("[role=dialog]")) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      return;
    }
    if (canGoBack && window.location.pathname !== "/") window.history.back();
    else void App.exitApp();
  });
  const { SplashScreen } = await import("@capacitor/splash-screen");
  await SplashScreen.hide().catch(() => undefined);
}

/** Funciones nativas que usan otras pantallas (solo en la app). */
export interface MailApp { package: string; label: string }
export const nativeApi: {
  installedApps?: (packages: string[]) => Promise<Record<string, boolean>>;
  mailApps?: () => Promise<MailApp[]>;
  openMail?: (to: string, pkg?: string) => Promise<void>;
} = {};

// ---------- Registro de llamadas ----------
export interface CallLogStatus {
  enabled: boolean;
  permission: boolean;
  lastSyncAt: number;
  lastAdded: number;
  lastError: string;
  batteryOptimized: boolean;
  lastRead?: number;
  notify?: boolean;
  notifyAllowed?: boolean;
  lastUnmatched?: number;
  lastSkipped?: number;
  since?: number;
}
interface CallLogPlugin {
  getStatus(): Promise<CallLogStatus>;
  openNotificationSettings(): Promise<void>;
  configure(o: { server: string; token: string }): Promise<CallLogStatus>;
  enable(o: { since: string }): Promise<CallLogStatus>;
  disable(): Promise<CallLogStatus>;
  syncNow(): Promise<CallLogStatus>;
  setNotify(o: { enabled: boolean }): Promise<CallLogStatus>;
  openBatterySettings(): Promise<void>;
}
let callLog: CallLogPlugin | null = null;
/**
 * Síncrono a propósito: el plugin de Capacitor es un Proxy que responde a cualquier propiedad, también
 * a «then», y si se devuelve desde una función async la promesa se queda esperando para siempre.
 */
export function getCallLog(): CallLogPlugin | null {
  if (!isApp) return null;
  callLog ??= registerPlugin<CallLogPlugin>("CallLog");
  return callLog;
}
export async function configureCallLog() {
  const p = getCallLog();
  const token = getToken();
  if (p && token) await p.configure({ server: getServer(), token }).catch(() => undefined);
  // Si el registro está activo con aviso tras la llamada pero falta el permiso de notificaciones
  // (p. ej. se activó antes de existir el aviso), se pide al abrir la app; como mucho dos veces.
  if (!p) return;
  try {
    const st = await p.getStatus();
    const asked = Number(localStorage.getItem("agendario-notify-asked") ?? "0");
    if (st.enabled && st.notify !== false && st.notifyAllowed === false && asked < 2) {
      localStorage.setItem("agendario-notify-asked", String(asked + 1));
      await p.setNotify({ enabled: true });
    }
  } catch {
    /* sin plugin o sin almacenamiento: no pasa nada */
  }
}
