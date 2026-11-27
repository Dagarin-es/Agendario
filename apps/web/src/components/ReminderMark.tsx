/** Señal de «tiene recordatorios» (en la lista y en la ficha), aunque aún no estén en plazo. */
export function ReminderMark({ count, overdue = false, className = "h-4 w-4" }: { count: number; overdue?: boolean; className?: string }) {
  if (!count) return null;
  const t = overdue ? "Tiene un recordatorio en plazo" : "Tiene recordatorios pendientes";
  return (
    <span className={`reminder-mark ${overdue ? "is-due" : ""}`} title={t} aria-label={t} role="img">
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="13" r="7.5" /><path d="M12 9.5V13l2.5 1.6M4.5 4.5l3 -2M19.5 4.5l-3 -2" />
      </svg>
    </span>
  );
}
