/**
 * Integración con Android (solo en la app): color dinámico de Material You, barras del sistema,
 * botón atrás y vibración. En la web no se carga nada de esto.
 */
import type { ColorTheme, ThemeScale } from "@agendario/shared";
import { isApp } from "./platform";
import { setDynamicScale, setNativeIconHook } from "./theme";

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
  const MaterialYou = registerPlugin<{ getPalette(): Promise<Palette>; setIcon(o: { theme: string }): Promise<void> }>("MaterialYou");
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
