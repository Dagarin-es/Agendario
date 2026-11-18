import { useEffect, useState } from "react";
import { getCallLog, type CallLogStatus } from "../lib/native";
import { Modal, useAlert } from "./Dialogs";

const fmt = (ms: number) => (ms ? new Date(ms).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "nunca");

/** App de Android: guardar solas las llamadas con tus contactos (hechas, recibidas y perdidas). */
export function CallLogSettings({ Section }: { Section: (p: { icon: string; title: string; desc?: string; children: React.ReactNode }) => React.ReactElement }) {
  const [st, setSt] = useState<CallLogStatus | null>(null);
  const [asking, setAsking] = useState(false);
  const [from, setFrom] = useState<"all" | "date" | "now">("all");
  const [date, setDate] = useState(() => new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
  const showAlert = useAlert();
  const [err, setErr] = useState("");
  const refresh = () =>
    void (getCallLog()?.getStatus() ?? Promise.reject(new Error("Solo en la app de Android")))
      .then((s) => { setSt(s); setErr(""); })
      .catch((e: Error) => setErr(e?.message || String(e)));
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);
  if (!st)
    return (
      <Section icon="📞" title="Registro de llamadas">
        {err ? (
          <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">No se puede usar el registro de llamadas en este dispositivo: <code className="break-all">{err}</code></p>
        ) : (
          <p className="text-sm text-slate-500">Comprobando…</p>
        )}
      </Section>
    );
  const enable = async () => {
    const p = getCallLog();
    if (!p) return;
    const since = from === "all" ? 0 : from === "date" ? new Date(`${date}T00:00:00`).getTime() : null;
    try {
      setSt(await p.enable({ since }));
      setAsking(false);
    } catch (e) {
      showAlert("No se ha podido activar", (e as Error).message || "Agendario necesita permiso para leer el registro de llamadas.");
    }
  };
  return (
    <Section icon="📞" title="Registro de llamadas" desc="Agendario guarda solas en cada contacto las llamadas hechas, recibidas y perdidas (fecha y duración), aunque llames desde el teléfono del sistema. Se envían al colgar; las de números que no son contactos se ignoran.">
      {st.enabled ? (
        <div className="space-y-2 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">✅ Activado</span>
            <span className="text-slate-600">Último envío: {fmt(st.lastSyncAt)}{st.lastAdded ? ` · ${st.lastAdded} llamadas nuevas` : ""}</span>
          </p>
          {!st.permission && <p className="text-red-700">Falta el permiso de registro de llamadas: desactívalo y vuelve a activarlo.</p>}
          {st.lastError && <p className="text-amber-800">⚠️ {st.lastError}</p>}
          {st.batteryOptimized && (
            <div className="rounded-xl bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">
              Android puede retrasar los envíos para ahorrar batería. Si ves que las llamadas tardan en aparecer, quita a Agendario de la optimización de batería.
              <button className="btn-ghost mt-2 block border border-amber-300 bg-white text-sm" onClick={() => void getCallLog()?.openBatterySettings()}>🔋 Abrir el ajuste de batería</button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost border border-slate-200" onClick={() => void getCallLog()?.syncNow().then(refresh)}>🔄 Enviar ahora</button>
            <button className="btn-ghost text-red-700" onClick={() => void getCallLog()?.disable().then(setSt)}>Desactivar</button>
          </div>
        </div>
      ) : (
        <button className="btn-primary" onClick={() => setAsking(true)}>Activar el registro de llamadas</button>
      )}
      {asking && (
        <Modal title="Activar el registro de llamadas" onClose={() => setAsking(false)}>
          <div className="space-y-3 text-sm">
            <p>¿Traemos también las llamadas que ya tiene el móvil? (Android guarda las últimas, según la marca unas 500–1.000 o unos meses). No se duplican las que ya apuntaste a mano.</p>
            <label className="flex items-center gap-2"><input type="radio" checked={from === "all"} onChange={() => setFrom("all")} /> Sí, todo lo que tenga el móvil</label>
            <label className="flex flex-wrap items-center gap-2"><input type="radio" checked={from === "date"} onChange={() => setFrom("date")} /> Desde el <input type="date" className="input w-auto py-1" value={date} onChange={(e) => { setDate(e.target.value); setFrom("date"); }} /></label>
            <label className="flex items-center gap-2"><input type="radio" checked={from === "now"} onChange={() => setFrom("now")} /> No, solo las nuevas a partir de ahora</label>
            <p className="text-xs text-slate-500">Android te pedirá permiso para leer el registro de llamadas y el estado del teléfono (para saber cuándo cuelgas).</p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setAsking(false)}>Cancelar</button>
              <button className="btn-primary" onClick={() => void enable()}>Activar</button>
            </div>
          </div>
        </Modal>
      )}
    </Section>
  );
}
