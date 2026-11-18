import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { colorThemeLabels, colorThemes, themeDefs, themeIconSvg, type ColorTheme, type UserPrefs } from "@agendario/shared";
import { api } from "../lib/api";
import { isApp } from "../lib/platform";
import { applyColorTheme, commitNativeIcon, getColorTheme, getTheme, getThemeIcon, hasDynamicColor, onThemeChange, onThemeIcon, setTheme, type ThemeMode } from "../lib/theme";
import { useUserPrefs } from "./QuickActions";

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const icons: Record<ThemeMode, string> = {
  auto: "M12 3a9 9 0 1 0 0 18V3zM12 3a9 9 0 0 1 0 18",
  light: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  dark: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
};
const labels: Record<ThemeMode, string> = { auto: "Auto", light: "Claro", dark: "Oscuro" };

/** Selector Claro / Oscuro / Auto con iconos (menú de usuario y Ajustes). */
export function ModeSelector({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<ThemeMode>(getTheme());
  useEffect(() => onThemeChange(setMode), []);
  return (
    <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1" role="radiogroup" aria-label="Modo de color">
      {(["light", "dark", "auto"] as ThemeMode[]).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          title={m === "auto" ? "Automático: el del sistema" : labels[m]}
          onClick={(e) => { e.stopPropagation(); setTheme(m); }}
          className={`flex items-center justify-center gap-1.5 rounded-full py-1.5 text-sm font-medium transition ${mode === m ? "bg-white text-indigo-800 shadow-sm" : "text-slate-500 hover:text-slate-800"} ${compact ? "px-2" : "px-3"}`}
        >
          <Icon d={icons[m]} /> {labels[m]}
        </button>
      ))}
    </div>
  );
}

/** Aplica el tema de color guardado en las preferencias (sigue al usuario en todos sus dispositivos). */
export function useColorThemeFromPrefs() {
  const { data } = useUserPrefs();
  useEffect(() => {
    if (data?.colorTheme && data.colorTheme !== getColorTheme()) applyColorTheme(data.colorTheme);
  }, [data?.colorTheme]);
}

const iconUrl = (t: keyof typeof themeDefs) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(themeIconSvg(themeDefs[t]))}`;

/** Elegir el tema de color: muestra el icono de la app y la paleta de cada uno. */
export function ColorThemePicker() {
  const qc = useQueryClient();
  const { data: prefs } = useUserPrefs();
  const [cur, setCur] = useState<ColorTheme>(getColorTheme());
  const save = useMutation({
    mutationFn: (v: UserPrefs) => api.put("/prefs", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prefs"] }),
  });
  const pick = (t: ColorTheme) => {
    setCur(t);
    applyColorTheme(t);
    if (prefs) save.mutate({ ...prefs, colorTheme: t });
  };
  // Al salir de esta pantalla se cambia el icono del lanzador (en la app)
  useEffect(() => () => commitNativeIcon(), []);
  const list = colorThemes.filter((t) => t !== "dynamic" || (isApp && hasDynamicColor()));
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tema de color">
      {list.map((t) => {
        const def = t === "dynamic" ? null : themeDefs[t];
        const active = cur === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => pick(t)}
            className={`flex items-center gap-3 rounded-2xl border p-2.5 text-left transition ${active ? "border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}
          >
            {def ? (
              <img src={iconUrl(t as keyof typeof themeDefs)} alt="" className="h-11 w-11 shrink-0" />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-gradient-to-br from-indigo-300 via-indigo-500 to-indigo-800 text-lg" aria-hidden="true">🎨</span>
            )}
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">{colorThemeLabels[t]}</span>
              {def ? (
                <span className="mt-1 flex gap-1" aria-hidden="true">
                  {([200, 400, 600, 800] as const).map((k) => <span key={k} className="h-3 w-3 rounded-full" style={{ background: def.palette[k] }} />)}
                </span>
              ) : (
                <span className="block text-xs text-slate-500">Material You</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Icono de la app en el tono del tema actual. */
export function useThemeIcon() {
  const [u, setU] = useState(getThemeIcon());
  useEffect(() => onThemeIcon(setU), []);
  return u;
}
