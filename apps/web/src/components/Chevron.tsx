/** Flecha de desplegar/plegar: la misma (grande y del color del texto) en toda la app. */
export function Chevron({ open = false, dir, className = "h-5 w-5" }: { open?: boolean; dir?: "down" | "right"; className?: string }) {
  const rot = dir === "right" ? (open ? "rotate-90" : "") : open ? "rotate-180" : "";
  const path = dir === "right" ? "M9 5l7 7-7 7" : "M5 9l7 7 7-7";
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0 transition-transform duration-200 ${rot}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
