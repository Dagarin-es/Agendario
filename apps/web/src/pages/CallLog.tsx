import { CallLogSettings } from "../components/CallLogSettings";
import { Section } from "../components/Section";

/** Registro de llamadas (solo en la app): opción propia del menú de usuario. */
export function CallLogPage() {
  return (
    <div className="space-y-4">
      <h1 className="page-title text-xl font-semibold">📞 Registro de llamadas</h1>
      <CallLogSettings Section={Section} />
    </div>
  );
}
