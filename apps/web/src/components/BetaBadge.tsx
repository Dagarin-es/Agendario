import { IS_BETA } from "@agendario/shared";

/** Etiqueta «Beta». Desaparece sola cuando IS_BETA = false (packages/shared). */
export function BetaBadge({ size = "sm" }: { size?: "xs" | "sm" }) {
  if (!IS_BETA) return null;
  const cls =
    size === "xs"
      ? "px-1.5 py-px text-[9px] leading-tight"
      : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-block rounded-full bg-amber-100 font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-300/60 ${cls}`}
    >
      Beta
    </span>
  );
}
