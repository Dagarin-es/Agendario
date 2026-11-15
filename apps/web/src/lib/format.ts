const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "1960-11-20" → "20 nov 1960"; "--11-20" → "20 nov". */
export function formatPartialDate(d: string | null | undefined) {
  if (!d) return "";
  const noYear = d.startsWith("--");
  const [y, m, day] = noYear ? [null, d.slice(2, 4), d.slice(5, 7)] : d.split("-");
  return `${Number(day)} ${months[Number(m) - 1]}${y ? ` ${y}` : ""}`;
}

export function formatDate(d: string | null | undefined) {
  if (!d) return "";
  return formatPartialDate(d.slice(0, 10));
}

export function daysLabel(n: number) {
  if (n === 0) return "¡Hoy!";
  if (n === 1) return "Mañana";
  return `En ${n} días`;
}

export const euros = (cents: number | null) =>
  cents == null ? "" : (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
