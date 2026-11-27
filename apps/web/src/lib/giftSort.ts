import { useEffect, useState } from "react";

const KEY = "gifts-sort";

/** Orden de «Para regalar» (Regalos), compartido entre la página y el menú de la cabecera de la app. */
export const giftSortOptions = [
  { id: "next", label: "Próximas fechas" },
  { id: "name", label: "Nombre" },
] as const;
export type GiftSort = (typeof giftSortOptions)[number]["id"];

function load(): GiftSort {
  try {
    const v = localStorage.getItem(KEY);
    return giftSortOptions.some((o) => o.id === v) ? (v as GiftSort) : "next";
  } catch {
    return "next";
  }
}

const listeners = new Set<(s: GiftSort) => void>();
function save(v: GiftSort) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* solo en esta sesión */
  }
  listeners.forEach((l) => l(v));
}

export function useGiftSort(): [GiftSort, (v: GiftSort) => void] {
  const [s, setS] = useState<GiftSort>(load);
  useEffect(() => {
    listeners.add(setS);
    return () => void listeners.delete(setS);
  }, []);
  return [s, save];
}
