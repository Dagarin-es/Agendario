import { RemindersView } from "../components/Reminders";

/** Recordatorios: pantalla propia (pestaña de abajo en la app, enlace del menú en la web). */
export function RemindersPage() {
  return (
    <div className="space-y-4">
      <h1 className="sr-only">Recordatorios</h1>
      <RemindersView />
    </div>
  );
}
