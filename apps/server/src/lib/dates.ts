/** Utilidades para fechas "YYYY-MM-DD" o "--MM-DD" (sin año). */

export function parsePartial(d: string): { year: number | null; month: number; day: number } {
  const [y, m, dd] = d.startsWith("--") ? [null, d.slice(2, 4), d.slice(5, 7)] : d.split("-");
  return { year: y ? Number(y) : null, month: Number(m), day: Number(dd) };
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Próxima ocurrencia (hoy incluido). El 29 de febrero se celebra el 28 en años no bisiestos. */
export function nextOccurrence(d: string, today: Date) {
  const { year, month, day } = parsePartial(d);
  const t = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  let y = t.getUTCFullYear();
  const make = (yy: number) => {
    const isLeap = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
    const dd = month === 2 && day === 29 && !isLeap ? 28 : day;
    return new Date(Date.UTC(yy, month - 1, dd));
  };
  let next = make(y);
  if (next < t) next = make(++y);
  const daysLeft = Math.round((next.getTime() - t.getTime()) / 86_400_000);
  return {
    date: iso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
    daysLeft,
    turning: year ? next.getUTCFullYear() - year : null,
  };
}
