/**
 * Temas de color de Agendario. La paleta de cada tema sustituye a la escala «indigo»
 * de Tailwind (que es la que usa toda la interfaz como color principal).
 * El icono de la app se genera con los mismos tonos.
 */
export type ThemeScale = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950, string>;
export interface ThemeDef {
  palette: ThemeScale;
  /** Pestañas de la libreta del icono */
  tabs: [string, string, string];
  pencil: string;
}

export const themeDefs = {
  indigo: { palette: { 50: "#EEF2FF", 100: "#E0E7FF", 200: "#C7D2FE", 300: "#A5B4FC", 400: "#818CF8", 500: "#6366F1", 600: "#4F46E5", 700: "#4338CA", 800: "#3730A3", 900: "#312E81", 950: "#1E1B4B" }, tabs: ["#FCD34D", "#A5B4FC", "#F9A8D4"], pencil: "#FCD34D" },
  ocean: { palette: { 50: "#E7F7FF", 100: "#D1EDFF", 200: "#B1DAFF", 300: "#8BC3FD", 400: "#60A3E7", 500: "#3A84CA", 600: "#1F6CB0", 700: "#0A5998", 800: "#00467D", 900: "#003664", 950: "#002245" }, tabs: ["#FBD38D", "#A7D3F5", "#F6B3C0"], pencil: "#F6C453" },
  lagoon: { palette: { 50: "#E3FBFA", 100: "#CAF3F2", 200: "#A4E4E3", 300: "#76CFCF", 400: "#3DB2B2", 500: "#009494", 600: "#007C7C", 700: "#006869", 800: "#005354", 900: "#004142", 950: "#002B2B" }, tabs: ["#FBD38D", "#9FE3DD", "#F7B6A8"], pencil: "#F6C453" },
  lavender: { palette: { 50: "#F8F1FF", 100: "#EEE3FF", 200: "#DDCBFF", 300: "#C8AFF6", 400: "#AA8CDE", 500: "#8D6CC2", 600: "#7555A8", 700: "#624390", 800: "#4F3476", 900: "#3E275F", 950: "#281641" }, tabs: ["#FBD38D", "#D9C6F5", "#F6B6D2"], pencil: "#F6C453" },
  clay: { palette: { 50: "#FFF1EB", 100: "#FEE3D9", 200: "#F3CCBD", 300: "#E4B09D", 400: "#C98E78", 500: "#AB6F57", 600: "#925841", 700: "#7C4631", 800: "#653725", 900: "#50291A", 950: "#36180D" }, tabs: ["#EFD29E", "#E9C9BA", "#C7D3BF"], pencil: "#E8C46A" },
  graphite: { palette: { 50: "#F4F5F7", 100: "#E8EAED", 200: "#D3D6DA", 300: "#BABEC4", 400: "#9A9FA6", 500: "#7C8088", 600: "#656970", 700: "#53575D", 800: "#42454B", 900: "#33363A", 950: "#202225" }, tabs: ["#E5E7EB", "#C4C8CF", "#9AA1AB"], pencil: "#D1D5DB" },
} satisfies Record<string, ThemeDef>;

export type PaletteTheme = keyof typeof themeDefs;

/** Dibujo de la libreta (sin fondo) en una caja de 96×96. */
export function themeIconArt(t: ThemeDef) {
  const bg = t.palette[700];
  return `<rect x="22" y="16" width="44" height="64" rx="6" fill="#fff"/><rect x="66" y="20" width="12" height="14" rx="3" fill="${t.tabs[0]}"/><rect x="66" y="38" width="12" height="14" rx="3" fill="${t.tabs[1]}"/><rect x="66" y="56" width="12" height="14" rx="3" fill="${t.tabs[2]}"/><circle cx="44" cy="36" r="8" fill="${bg}"/><path d="M30 60 Q44 44 58 60 Z" fill="${bg}"/><path d="M50 78 L68 60 L73 65 L55 83 L48 85 Z" fill="${t.pencil}" stroke="${t.palette[900]}" stroke-width="1.8" stroke-linejoin="round"/>`;
}

/** Icono completo (el favicon) de un tema. */
export function themeIconSvg(t: ThemeDef) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="${t.palette[700]}"/>${themeIconArt(t)}</svg>`;
}
