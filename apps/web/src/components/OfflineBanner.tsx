import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, flushOfflineQueue, refreshOfflineSnapshot } from "../lib/api";
import { getOfflineState, initOfflineState, onOfflineState } from "../lib/offline";

function ago(iso: string | null) {
  if (!iso) return "nunca";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `hace ${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

/**
 * Modo sin conexión: guarda una copia de las fichas, avisa cuando el servidor no responde
 * y envía los cambios pendientes al volver la conexión.
 */
export function OfflineBanner() {
  const qc = useQueryClient();
  const [s, setS] = useState(getOfflineState());
  useEffect(() => onOfflineState(setS), []);

  useEffect(() => {
    let alive = true;
    const sync = async () => {
      const sent = await flushOfflineQueue();
      if (sent) await qc.invalidateQueries();
      await refreshOfflineSnapshot().catch(() => undefined);
    };
    void initOfflineState().then(() => { if (alive) void sync(); });
    const back = () => void api.get("/health").then(sync).catch(() => undefined);
    window.addEventListener("online", back);
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && back());
    // Sin conexión: se prueba cada 20 s si el servidor ha vuelto
    const t = setInterval(() => getOfflineState().offline && back(), 20_000);
    return () => { alive = false; clearInterval(t); window.removeEventListener("online", back); };
  }, [qc]);

  if (!s.offline && !s.pending) return null;
  return (
    <div role="status" className={`mx-4 mt-2 flex flex-wrap items-center gap-x-2 rounded-2xl px-4 py-2.5 text-sm ${s.offline ? "bg-slate-800 text-slate-100" : "bg-indigo-100 text-indigo-900"}`}>
      <span aria-hidden="true">{s.offline ? "📴" : "⏳"}</span>
      {s.offline ? (
        <span>Sin conexión con el servidor · ves los datos guardados ({ago(s.snapshotAt)})</span>
      ) : (
        <span>Enviando cambios hechos sin conexión…</span>
      )}
      {s.pending > 0 && <span className="font-semibold">· {s.pending} {s.pending === 1 ? "cambio pendiente" : "cambios pendientes"}</span>}
    </div>
  );
}
