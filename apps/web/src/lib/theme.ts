/** Modo de color: automático (el del sistema), claro u oscuro. Se guarda en este dispositivo. */
export type ThemeMode = "auto" | "light" | "dark";
const KEY = "agendario-theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

function apply(mode: ThemeMode) {
  const dark = mode === "dark" || (mode === "auto" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#1e1b4b" : "#4338ca");
}

export function setTheme(mode: ThemeMode) {
  try {
    if (mode === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* sin almacenamiento: solo para esta sesión */
  }
  apply(mode);
}

export function initTheme() {
  apply(getTheme());
  media().addEventListener("change", () => getTheme() === "auto" && apply("auto"));
}
