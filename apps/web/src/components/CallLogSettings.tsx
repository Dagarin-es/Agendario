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
      setSt(await p.enable({ since: since === null ? "" : String(since) }));
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
            <span className="text-slate-600">Última revisión: {fmt(st.lastSyncAt)}</span>
          </p>
          <p className="text-xs text-slate-500">
            En la última: {st.lastRead ?? 0} leídas del móvil · {st.lastAdded} guardadas · {st.lastSkipped ?? 0} ya estaban · {st.lastUnmatched ?? 0} de números que no son contactos
            {st.since ? ` · se leen las posteriores al ${fmt(st.since)}` : ""}
          </p>
          {!st.permission && <p className="text-red-700">Falta el permiso de registro de llamadas: desactívalo y vuelve a activarlo.</p>}
          {st.lastError && <p className="text-amber-800">⚠️ {st.lastError}</p>}
          {st.batteryOptimized && (
            <div className="rounded-xl bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">
              Android puede retrasar los envíos para ahorrar batería. Si ves que las llamadas tardan en aparecer, quita a Agendario de la optimización de batería.
              <button className="btn-ghost mt-2 block border border-amber-300 bg-white text-sm" onClick={() => void getCallLog()?.openBatterySettings()}>🔋 Abrir el ajuste de batería</button>
            </div>
          )}
          <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={st.notify !== false} onChange={(e) => void getCallLog()?.setNotify({ enabled: e.target.checked }).then(setSt)} />
            <span>
              <span className="font-medium">Al colgar, preguntarme si quiero apuntar algo</span>
              <span className="block text-xs text-slate-500">Aviso con «Escribir nota» (se contesta desde la propia notificación), «Recordatorio» y «No, gracias»; tocándolo se abre la ficha. Solo con contactos y llamadas atendidas de más de 30 segundos.</span>
              {st.notify !== false && st.notifyAllowed === false && (
                <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-amber-800">
                  ⚠️ Agendario no tiene permiso para mostrar notificaciones.
                  <button type="button" className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-900" onClick={(e) => {
                      e.preventDefault();
                      const p = getCallLog();
                      // Si Android ya no muestra la petición (denegada dos veces), se abren sus ajustes
                      void p?.setNotify({ enabled: true }).then((r) => { setSt(r); if (r.notifyAllowed === false) void p.openNotificationSettings(); });
                    }}>Permitir notificaciones</button>
                </span>
              )}
              {st.notify !== false && st.notifyAllowed === true && <span className="mt-1 block text-xs text-emerald-700">✓ Notificaciones permitidas</span>}
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={st.unknownNotify !== false} onChange={(e) => void getCallLog()?.setOptions({ unknownNotify: e.target.checked }).then(setSt)} />
            <span>
              <span className="font-medium">Números desconocidos: preguntarme si lo guardo</span>
              <span className="block text-xs text-slate-500">Tras una llamada atendida de más de un minuto con un número que no está en tu agenda: «Guardar», «Escribir nota» o «No, gracias». Los números ocultos no avisan.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={!!st.overlay} onChange={(e) => {
              const on = e.target.checked;
              const p = getCallLog();
              void p?.setOptions({ overlay: on }).then((r) => { setSt(r); if (on && r.overlayAllowed === false) void p.openOverlaySettings(); });
            }} />
            <span>
              <span className="font-medium">Notas al llamar: tarjeta flotante y burbuja</span>
              <span className="block text-xs text-slate-500">Al sonar o marcar una llamada con un contacto aparece una tarjeta con tus últimas notas y recordatorios. Durante la llamada queda una burbuja de Agendario: tócala para escribir; la nota se guarda en esa llamada al colgar.</span>
              {st.overlay && st.overlayAllowed === false && (
                <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-amber-800">
                  ⚠️ Falta el permiso «Mostrar sobre otras apps».
                  <button type="button" className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-900" onClick={(e) => { e.preventDefault(); void getCallLog()?.openOverlaySettings(); }}>Dar permiso</button>
                </span>
              )}
              {st.overlay && st.overlayAllowed === true && <span className="mt-1 block text-xs text-emerald-700">✓ Permiso concedido</span>}
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={!!st.ongoing} onChange={(e) => void getCallLog()?.setOptions({ ongoing: e.target.checked }).then(setSt)} />
            <span>
              <span className="font-medium">Notificación «Anotar» durante la llamada</span>
              <span className="block text-xs text-slate-500">Alternativa ligera a la burbuja, sin permisos extra: una notificación fija «Llamada con X · Anotar» donde escribes la nota mientras hablas.</span>
            </span>
          </label>
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
          <div className="space-y-3 p-4 text-sm">
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
