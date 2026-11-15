import type { Address, LabeledValue } from "@agendario/shared";

/** Utilidades para saber si dos datos son «el mismo» (igual que hace el servidor al combinar). */

export type ListKey = "phones" | "emails" | "urls" | "addresses";

export const normPhone = (p: string) => {
  let d = p.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  return d.length > 9 ? d.slice(-9) : d;
};
export const addrText = (a: Address) =>
  [a.street, [a.postalCode, a.city].filter(Boolean).join(" "), a.region, a.country].filter(Boolean).join(", ");
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9ñ]/g, "");

export function itemKey(key: ListKey, item: LabeledValue | Address) {
  if (key === "addresses") {
    const a = item as Address;
    return fold([a.street, a.city, a.postalCode].join("|"));
  }
  const v = (item as LabeledValue).value.trim().toLowerCase();
  if (key === "phones") return normPhone(v);
  if (key === "urls") return v.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return v;
}

export const itemText = (key: ListKey, item: LabeledValue | Address) =>
  key === "addresses" ? addrText(item as Address) : (item as LabeledValue).value;

export const isEmpty = (v: string | null | undefined) => !v || !v.trim();
