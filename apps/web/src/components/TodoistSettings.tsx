import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import type { TodoistStatus } from "@agendario/shared";
import { api } from "../lib/api";
import { getServer, isApp } from "../lib/platform";
import { useAlert, useConfirm } from "./Dialogs";
import { syncNativeReminders } from "../lib/native";

type SectionT = (p: { icon: string; title: string; desc?: string; children: ReactNode }) => ReactElement;

/** Dirección con la que se abre Agendario desde los enlaces de las tareas. */
const defaultUrl = () => (isApp ? getServer() ?? "" : window.location.origin);

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "todavía no";

/** Ajustes → Sincronización → Todoist: los recordatorios como tareas, en los dos sentidos. */
export function TodoistSettings({ Section }: { Section: SectionT }) {
  const qc = useQueryClient();
  const showAlert = useAlert();
  const confirm = useConfirm();
  const { data: st } = useQuery({ queryKey: ["todoist"], queryFn: () => api.get<TodoistStatus>("/todoist") });
  const { data: projects } = useQuery({
    queryKey: ["todoist", "projects"],
    queryFn: () => api.get<{ id: string; name: string; inbox: boolean }[]>("/todoist/projects"),
    enabled: !!st?.connected,
  });
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (st) {
      setLabel(st.label);
      setUrl(st.publicUrl || defaultUrl());
    }
  }, [st]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["todoist"] });
    qc.invalidateQueries({ queryKey: ["reminders"] });
  };

  const save = useMutation({
    mutationFn: (b: Record<string, unknown>) => api.put<TodoistStatus>("/todoist", b),
    onSuccess: (s, b) => {
      qc.setQueryData(["todoist"], s);
      qc.invalidateQueries({ queryKey: ["todoist", "projects"] });
      if ("phoneAlerts" in b) { qc.invalidateQueries({ queryKey: ["reminders"] }); void syncNativeReminders(); }
    },
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });
  const connect = useMutation({
    mutationFn: async () => {
      const s = await api.put<TodoistStatus>("/todoist", { token: token.trim(), label: "agendario", publicUrl: defaultUrl() });
      return s;
    },
    onSuccess: async (s) => {
      setToken("");
      qc.setQueryData(["todoist"], s);
      if (await confirm({ title: "Todoist conectado", message: "¿Mando también a Todoist los recordatorios pendientes que ya tienes?", confirmText: "Sí, mandarlos", cancelText: "No, solo los nuevos" })) {
        const r = await api.post<{ sent: number }>("/todoist/push-existing").catch((e) => { showAlert("No se han podido mandar", (e as Error).message); return null; });
        if (r) showAlert("Listo", r.sent ? `${r.sent} ${r.sent === 1 ? "recordatorio enviado" : "recordatorios enviados"} a Todoist.` : "No había recordatorios pendientes.");
      }
      refresh();
    },
    onError: (e) => showAlert("No se ha podido conectar", (e as Error).message),
  });
  const syncNow = useMutation({
    mutationFn: () => api.post<{ changed: number; status: TodoistStatus }>("/todoist/sync"),
    onSuccess: (r) => {
      qc.setQueryData(["todoist"], r.status);
      qc.invalidateQueries({ queryKey: ["reminders"] });
      void syncNativeReminders();
      if (r.status.lastError) showAlert("Todoist", r.status.lastError);
    },
  });
  const disconnect = useMutation({
    mutationFn: () => api.del("/todoist"),
    onSuccess: refresh,
  });

  return (
    <Section icon="✅" title="Todoist" desc="Cada recordatorio crea una tarea en Todoist con el contacto y un enlace a su ficha. Lo que completes, cambies o borres en un lado se refleja en el otro (Todoist se revisa cada 5 minutos).">
      {!st ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : !st.connected ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (token.trim()) connect.mutate(); }}>
          <label className="label" htmlFor="td-token">Clave de Todoist</label>
          <input id="td-token" className="input font-mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Pega aquí tu clave" />
          <p className="text-xs text-slate-500">
            En Todoist: <strong>Ajustes → Integraciones → Desarrollador → Copiar clave de API</strong>. Se guarda solo en tu servidor de Agendario.
          </p>
          <button className="btn-primary" disabled={!token.trim() || connect.isPending}>{connect.isPending ? "Comprobando…" : "Conectar Todoist"}</button>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            ✓ Conectado · última revisión: {when(st.lastSyncAt)}
          </p>
          {st.lastError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">⚠️ {st.lastError}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="td-project">Proyecto donde van las tareas</label>
              <select id="td-project" className="input" value={st.projectId ?? ""} onChange={(e) => save.mutate({ projectId: e.target.value || null })}>
                <option value="">Bandeja de entrada</option>
                {projects?.filter((p) => !p.inbox).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="td-label">Etiqueta en Todoist (opcional)</label>
              <input id="td-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== st.label && save.mutate({ label })} placeholder="agendario" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="td-url">Dirección de Agendario para los enlaces</label>
            <input id="td-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => url !== st.publicUrl && save.mutate({ publicUrl: url })} placeholder="https://agendario.tudominio.es" />
            <p className="mt-1 text-xs text-slate-500">La de tu servidor tal como la abres desde fuera. En el móvil, el enlace ofrece abrirlo con la app de Agendario.</p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={st.phoneAlerts} onChange={(e) => save.mutate({ phoneAlerts: e.target.checked })} />
            <span>
              Avisos de Agendario en el móvil también para los recordatorios enviados a Todoist
              <span className="block text-xs text-slate-500">Desmárcalo si prefieres que te avise solo Todoist.</span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost border border-slate-200" onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>{syncNow.isPending ? "Revisando…" : "🔄 Revisar ahora"}</button>
            <button type="button" className="btn-ghost border border-slate-200" onClick={async () => {
              const r = await api.post<{ sent: number }>("/todoist/push-existing").catch((e) => { showAlert("No se han podido mandar", (e as Error).message); return null; });
              if (r) { showAlert("Listo", r.sent ? `${r.sent} enviados a Todoist.` : "Todos los pendientes ya estaban en Todoist."); refresh(); }
            }}>📤 Mandar los pendientes</button>
            <button type="button" className="btn-danger" onClick={async () => {
              if (await confirm({ title: "¿Desconectar Todoist?", message: "Las tareas se quedan en Todoist y los recordatorios en Agendario, pero dejan de estar enlazados.", confirmText: "Desconectar", danger: true })) disconnect.mutate();
            }}>Desconectar</button>
          </div>
        </div>
      )}
    </Section>
  );
}
