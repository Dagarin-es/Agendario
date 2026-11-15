/** Reloj con flecha en sentido antihorario: «tiene historial de cambios». */
export function HistoryIcon({ className = "h-5 w-5", title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3 4.5v4h4" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}
