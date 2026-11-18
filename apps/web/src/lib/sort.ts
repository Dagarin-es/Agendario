import { useEffect, useState } from "react";

const SORT_KEY = "agendario.sort";

/** Campos por los que se puede ordenar la lista (se recuerda en cada dispositivo). */
export const sortOptions = [
  { id: "display", label: "Nombre a mostrar" },
  { id: "given", label: "Nombre" },
  { id: "family", label: "Apellidos" },
  { id: "company", label: "Empresa" },
  { id: "nickname", label: "Apodo" },
  { id: "geo", label: "📍 Sin geolocalizar" },
] as const;
export type SortId = (typeof sortOptions)[number]["id"];

export function loadSort(): SortId {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return sortOptions.some((o) => o.id === v) ? (v as SortId) : "display";
  } catch {
    return "display";
  }
}

const listeners = new Set<(s: SortId) => void>();
export function setSortPref(v: SortId) {
  try {
    localStorage.setItem(SORT_KEY, v);
  } catch {
    /* solo en esta sesión */
  }
  listeners.forEach((l) => l(v));
}

/** Orden de la lista, compartido entre la lista y el botón de la cabecera de la app. */
export function useSortPref(): [SortId, (v: SortId) => void] {
  const [s, setS] = useState<SortId>(loadSort);
  useEffect(() => {
    listeners.add(setS);
    return () => void listeners.delete(setS);
  }, []);
  return [s, setSortPref];
}
