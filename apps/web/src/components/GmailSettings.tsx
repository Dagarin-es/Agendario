import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import type { GmailStatus } from "@agendario/shared";
import { api } from "../lib/api";
import { isApp } from "../lib/platform";
import { useMe } from "../lib/auth";
import { useAlert, useConfirm } from "./Dialogs";
import { TagChip, useTags } from "./Tags";

type SectionT = (p: { icon: string; title: string; desc?: string; children: ReactNode }) => ReactElement;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "todavía no";

/** Ajustes → Sincronización → Gmail: los contactos de las etiquetas marcadas, a Google Contactos (para Outlook). */
export function GmailSettings({ Section }: { Section: SectionT }) {
  const qc = useQueryClient();
  const showAlert = useAlert();
  const confirm = useConfirm();
  const { data: me } = useMe();
  const { data: tags } = useTags();
  const [params, setParams] = useSearchParams();
  const { data: st } = useQuery({
    queryKey: ["gmail"],
    queryFn: () => api.get<GmailStatus>("/gmail"),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [editApp, setEditApp] = useState(false);
  useEffect(() => { if (st) setClientId(st.appClientId); }, [st]);

  // Vuelta desde Google
  useEffect(() => {
    const r = params.get("gmail");
    if (!r) return;
    const msg = params.get("msg");
    params.delete("gmail");
    params.delete("msg");
    setParams(params, { replace: true });
    qc.invalidateQueries({ queryKey: ["gmail"] });
    if (r === "ok") void showAlert("Gmail conectado", "Ya está. Los contactos de las etiquetas marcadas se están enviando a tu cuenta de Google (tarda un poco la primera vez).");
    else void showAlert("No se ha podido conectar Gmail", msg ?? "");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveApp = useMutation({
    mutationFn: () => api.put<GmailStatus>("/gmail/app", { clientId: clientId.trim(), ...(secret.trim() ? { clientSecret: secret.trim() } : {}) }),
    onSuccess: (s) => { qc.setQueryData(["gmail"], s); setSecret(""); setEditApp(false); },
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });
  const connect = useMutation({
    mutationFn: () => api.post<{ url: string }>("/gmail/connect", { origin: window.location.origin }),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => showAlert("No se ha podido conectar", (e as Error).message),
  });
  const syncNow = useMutation({
    mutationFn: () => api.post<{ status: GmailStatus }>("/gmail/sync"),
    onSuccess: (r) => qc.setQueryData(["gmail"], r.status),
    onError: (e) => { qc.invalidateQueries({ queryKey: ["gmail"] }); showAlert("Gmail", (e as Error).message); },
  });
  const disconnect = useMutation({
    mutationFn: (remove: boolean) => api.del(`/gmail${remove ? "?remove=1" : ""}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gmail"] }),
    onError: (e) => showAlert("No se ha podido desconectar", (e as Error).message),
  });

  const redirect = `${isApp ? "https://agendario.tudominio.es" : window.location.origin}/api/gmail/callback`;
  const chosen = (tags ?? []).filter((t) => st?.tagIds.includes(t.id));

  return (
    <Section
      icon="📧"
      title="Gmail (para verlos en Outlook)"
      desc="Envía a una cuenta de Google los contactos de las etiquetas que marques en Etiquetas. Va en un solo sentido: los cambios se hacen en Agendario; en Google y Outlook son para consultar. Añadiendo esa cuenta de Gmail al nuevo Outlook, los verás allí."
    >
      {!st ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="space-y-4">
          {/* 1. App de Google de esta instalación */}
          {(!st.appConfigured || editApp) ? (
            me?.isAdmin ? (
              <form className="space-y-2 rounded-xl border border-slate-200 p-3" onSubmit={(e) => { e.preventDefault(); saveApp.mutate(); }}>
                <p className="text-sm font-medium">App de Google de este servidor</p>
                <p className="text-xs text-slate-500">
                  Se crea una vez en Google Cloud (pasos en el manual): tipo <strong>«Aplicación web»</strong>, con la People API activada y publicada «En producción».
                  Como URI de redirección autorizado pon exactamente:
                </p>
                <code className="block break-all rounded bg-slate-100 px-2 py-1 text-xs">{redirect}</code>
                <label className="label" htmlFor="gm-id">ID de cliente</label>
                <input id="gm-id" className="input font-mono text-xs" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="123…apps.googleusercontent.com" autoComplete="off" />
                <label className="label" htmlFor="gm-secret">Secreto de cliente</label>
                <input id="gm-secret" className="input font-mono text-xs" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={st.appConfigured ? "(sin cambios)" : "GOCSPX-…"} autoComplete="off" />
                <p className="text-xs text-slate-500">Se guardan solo en tu servidor y el secreto no se vuelve a mostrar.</p>
                <div className="flex gap-2">
                  <button className="btn-primary" disabled={!clientId.trim() || (!st.appConfigured && !secret.trim()) || saveApp.isPending}>Guardar</button>
                  {editApp && <button type="button" className="btn-ghost" onClick={() => setEditApp(false)}>Cancelar</button>}
                </div>
              </form>
            ) : (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">El administrador de este servidor tiene que configurar antes la app de Google.</p>
            )
          ) : null}

          {/* 2. Cuenta conectada */}
          {st.appConfigured && !st.connected && (
            isApp ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">La cuenta de Google se conecta desde la web de Agendario (en el navegador del ordenador o del móvil).</p>
            ) : (
              <div className="space-y-2">
                <button className="btn-primary" onClick={() => connect.mutate()} disabled={connect.isPending}>{connect.isPending ? "Abriendo Google…" : "Conectar cuenta de Google"}</button>
                <p className="text-xs text-slate-500">Google te pedirá permiso para gestionar tus contactos. Si sale «Google no ha verificado esta app», pulsa «Configuración avanzada» → «Ir a…»: la app es la tuya.</p>
              </div>
            )
          )}

          {st.connected && (
            <div className="space-y-3">
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                ✓ Conectado{st.email ? ` con ${st.email}` : ""} · {st.linked} {st.linked === 1 ? "contacto" : "contactos"} en Google · última sincronización: {st.running ? "ahora mismo…" : when(st.lastSyncAt)}
                {st.lastResult && !st.running && (st.lastResult.created || st.lastResult.updated || st.lastResult.deleted)
                  ? ` (${[st.lastResult.created && `${st.lastResult.created} nuevos`, st.lastResult.updated && `${st.lastResult.updated} cambiados`, st.lastResult.deleted && `${st.lastResult.deleted} quitados`].filter(Boolean).join(", ")})`
                  : ""}
              </p>
              {st.lastError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">⚠️ {st.lastError}</p>}
            </div>
          )}

          {/* 3. Etiquetas */}
          <div>
            <p className="label">Etiquetas que se sincronizan</p>
            {chosen.length ? (
              <div className="flex flex-wrap gap-1.5">{chosen.map((t) => <TagChip key={t.id} tag={t} />)}</div>
            ) : (
              <p className="text-sm text-slate-500">Ninguna todavía.</p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              Se eligen en <Link to="/tags" className="font-medium text-indigo-700 underline">Etiquetas</Link> con la casilla «Sincronizar con Gmail» (las subetiquetas entran solas). En Google cada etiqueta aparece como una etiqueta de contactos.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {st.connected && (
              <>
                <button type="button" className="btn-ghost border border-slate-200" onClick={() => syncNow.mutate()} disabled={syncNow.isPending || st.running}>{syncNow.isPending || st.running ? "Sincronizando…" : "🔄 Sincronizar ahora"}</button>
                <button type="button" className="btn-danger" onClick={async () => {
                  if (!(await confirm({ title: "¿Desconectar Gmail?", message: "Agendario deja de enviar contactos a esa cuenta.", confirmText: "Desconectar", danger: true }))) return;
                  const remove = await confirm({ title: "¿Quito también los contactos de Google?", message: `Puedo borrar de tu cuenta de Google los ${st.linked} contactos y las etiquetas que creó Agendario, o dejarlos allí.`, confirmText: "Sí, borrarlos de Google", cancelText: "No, dejarlos" });
                  disconnect.mutate(remove);
                }}>Desconectar</button>
              </>
            )}
            {st.appConfigured && me?.isAdmin && !editApp && (
              <button type="button" className="btn-ghost text-xs" onClick={() => setEditApp(true)}>Cambiar la app de Google</button>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
