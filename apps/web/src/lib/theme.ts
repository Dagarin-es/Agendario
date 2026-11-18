import { themeDefs, themeIconSvg, type ColorTheme, type ThemeScale } from "@agendario/shared";

/** Modo de color: automático (el del sistema), claro u oscuro. Se guarda en este dispositivo. */
export type ThemeMode = "auto" | "light" | "dark";
const KEY = "agendario-theme";
const COLOR_KEY = "agendario-color";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<(m: ThemeMode) => void>();

export function getTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

let currentScale: ThemeScale = themeDefs.indigo.palette;

function apply(mode: ThemeMode) {
  const dark = mode === "dark" || (mode === "auto" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? currentScale[950] : currentScale[700]);
}

export function setTheme(mode: ThemeMode) {
  try {
    if (mode === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* sin almacenamiento: solo para esta sesión */
  }
  apply(mode);
  listeners.forEach((l) => l(mode));
}

/** Para que el selector del menú y el de Ajustes se mantengan iguales. */
export function onThemeChange(fn: (m: ThemeMode) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

// ---------- Tema de color ----------

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/**
 * CSS que sustituye la escala índigo por la del tema, en claro y en oscuro
 * (en oscuro la escala va al revés, como en dark.css, y los fondos fuertes usan los tonos claros originales).
 */
export function themeCss(s: ThemeScale) {
  const light = STEPS.map((k) => `--color-indigo-${k}:${s[k]}`).join(";");
  const dark = STEPS.map((k, i) => `--color-indigo-${k}:${s[STEPS[STEPS.length - 1 - i]!]}`).join(";");
  const bg = ([500, 600, 700, 800, 900] as const).map((k) => `.dark .bg-indigo-${k},.dark .hover\\:bg-indigo-${k}:hover{background-color:${s[k]}}`).join("");
  return `:root{${light}}.dark{${dark}}${bg}.dark .btn-primary{background-color:${s[600]}}.dark .btn-primary:hover{background-color:${s[700]}}`;
}

function setStyle(css: string) {
  let el = document.getElementById("color-theme") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "color-theme";
    document.head.appendChild(el);
  }
  el.textContent = css;
}

let iconUrl = "/favicon.svg";
const iconListeners = new Set<(u: string) => void>();
/** Icono de la app con el tono del tema (para la cabecera y la pestaña del navegador). */
export function getThemeIcon() {
  return iconUrl;
}
export function onThemeIcon(fn: (u: string) => void) {
  iconListeners.add(fn);
  return () => void iconListeners.delete(fn);
}

/** Escala del fondo de pantalla (Material You), la pone native.ts en la app. */
let dynamicScale: ThemeScale | null = null;
export function setDynamicScale(s: ThemeScale | null) {
  dynamicScale = s;
  if (getColorTheme() === "dynamic") applyColorTheme("dynamic");
}
export const hasDynamicColor = () => !!dynamicScale;

export function getColorTheme(): ColorTheme {
  try {
    return (localStorage.getItem(COLOR_KEY) as ColorTheme) || "indigo";
  } catch {
    return "indigo";
  }
}

const nativeIconHook: { fn: ((t: ColorTheme) => void) | null } = { fn: null };
/** native.ts registra aquí el cambio del icono del lanzador de Android. */
export function setNativeIconHook(fn: (t: ColorTheme) => void) {
  nativeIconHook.fn = fn;
}

export function applyColorTheme(theme: ColorTheme) {
  try {
    localStorage.setItem(COLOR_KEY, theme);
  } catch {
    /* nada */
  }
  const def = theme === "dynamic" || !(theme in themeDefs) ? themeDefs.indigo : themeDefs[theme as keyof typeof themeDefs];
  currentScale = theme === "dynamic" && dynamicScale ? dynamicScale : def.palette;
  setStyle(theme === "indigo" || (theme === "dynamic" && !dynamicScale) ? "" : themeCss(currentScale));
  iconUrl = theme === "indigo" || theme === "dynamic" ? "/favicon.svg" : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(themeIconSvg(def))}`;
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((l) => (l.href = iconUrl));
  iconListeners.forEach((l) => l(iconUrl));
  apply(getTheme());
  pendingIcon = theme;
}

/** El icono del lanzador se cambia al salir de Apariencia o de la app: Android reinicia la app al cambiarlo. */
let pendingIcon: ColorTheme | null = null;
export function commitNativeIcon() {
  if (pendingIcon && nativeIconHook.fn) nativeIconHook.fn(pendingIcon);
  pendingIcon = null;
}

export function initTheme() {
  applyColorTheme(getColorTheme());
  media().addEventListener("change", () => getTheme() === "auto" && apply("auto"));
}
