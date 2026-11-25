import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import type { GmailAccountStatus, GmailStatus } from "@agendario/shared";
import { api } from "../lib/api";
import { isApp } from "../lib/platform";
import { useMe } from "../lib/auth";
import { useAlert, useConfirm } from "./Dialogs";
import { TagChip, useTags } from "./Tags";

type SectionT = (p: { icon: string; title: string; desc?: string; children: ReactNode }) => ReactElement;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "todavía no";

/** Ajustes → Sincronización → Gmail: los contactos de las etiquetas marcadas, a una o varias cuentas de Google Contactos (para Outlook). */
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
    refetchInterval: (q) => (q.state.data?.accounts?.some((a) => a.running) ? 3000 : false),
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
    if (r === "ok") void showAlert("Cuenta de Google conectada", "Ya está. Si ya tenía etiquetas, sus contactos se están enviando (tarda un poco la primera vez). Para una cuenta nueva, elige sus etiquetas en Etiquetas. También busca ya fotos para tus contactos que no tienen.");
    else void showAlert("No se ha podido conectar Gmail", msg ?? "");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveApp = useMutation({
    mutationFn: () => api.put<GmailStatus>("/gmail/app", { clientId: clientId.trim(), ...(secret.trim() ? { clientSecret: secret.trim() } : {}) }),
    onSuccess: (s) => { qc.setQueryData(["gmail"], s); setSecret(""); setEditApp(false); },
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });
  const connect = useMutation({
    mutationFn: (accountId?: string) => api.post<{ url: string }>("/gmail/connect", { origin: window.location.origin, ...(accountId ? { accountId } : {}) }),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => showAlert("No se ha podido conectar", (e as Error).message),
  });
  const syncNow = useMutation({
    mutationFn: (id: string) => api.post<{ status: GmailStatus }>(`/gmail/sync?account=${encodeURIComponent(id)}`),
    onSuccess: (r) => qc.setQueryData(["gmail"], r.status),
    onError: (e) => { qc.invalidateQueries({ queryKey: ["gmail"] }); showAlert("Gmail", (e as Error).message); },
  });
  const photos = useMutation({
    mutationFn: (id: string) => api.post<{ added: number; status: GmailStatus }>(`/gmail/accounts/${encodeURIComponent(id)}/photos`),
    onSuccess: (r) => {
      qc.setQueryData(["gmail"], r.status);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      void showAlert("Fotos desde Google", r.added ? `${r.added} ${r.added === 1 ? "foto añadida" : "fotos añadidas"} a contactos que no tenían.` : "No he encontrado fotos nuevas para tus contactos sin foto.");
    },
    onError: (e) => { qc.invalidateQueries({ queryKey: ["gmail"] }); showAlert("Fotos desde Google", (e as Error).message); },
  });
  const move = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => api.post<{ status: GmailStatus }>(`/gmail/accounts/${encodeURIComponent(from)}/move`, { to }),
    onSuccess: (r) => qc.setQueryData(["gmail"], r.status),
    onError: (e) => showAlert("No se han podido pasar las etiquetas", (e as Error).message),
  });
  const disconnect = useMutation({
    mutationFn: ({ id, remove }: { id: string; remove: boolean }) => api.del(`/gmail/accounts/${encodeURIComponent(id)}${remove ? "?remove=1" : ""}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gmail"] }),
    onError: (e) => showAlert("No se ha podido quitar la cuenta", (e as Error).message),
  });

  const redirect = `${isApp ? "https://agendario.tudominio.es" : window.location.origin}/api/gmail/callback`;
  const accounts = st?.accounts ?? [];
  const label = (a: GmailAccountStatus) => a.email ?? "Cuenta sin conectar";

  const askMove = async (a: GmailAccountStatus, to: string) => {
    const dest = accounts.find((x) => x.id === to);
    if (!dest) return;
    const n = a.tagIds.length;
    if (!(await confirm({
      title: "¿Pasar las etiquetas a otra cuenta?",
      message: `${n === 1 ? "La etiqueta" : `Las ${n} etiquetas`} de ${label(a)} pasan a ${label(dest)}. Agendario creará sus contactos en ${label(dest)} y los quitará de ${label(a)} (solo lo que creó Agendario).`,
      confirmText: "Pasar",
    }))) return;
    move.mutate({ from: a.id, to });
  };
  const askRemove = async (a: GmailAccountStatus) => {
    if (!(await confirm({ title: `¿Quitar ${label(a)}?`, message: "Agendario deja de enviar contactos a esa cuenta y olvida sus etiquetas.", confirmText: "Quitar", danger: true }))) return;
    const remove = a.connected && a.linked > 0
      ? await confirm({ title: "¿Quito también los contactos de Google?", message: `Puedo borrar de esa cuenta de Google los ${a.linked} contactos y las etiquetas que creó Agendario, o dejarlos allí.`, confirmText: "Sí, borrarlos de Google", cancelText: "No, dejarlos" })
      : false;
    disconnect.mutate({ id: a.id, remove });
  };

  return (
    <Section
      icon="📧"
      title="Gmail (para verlos en Outlook)"
      desc="Envía a una o varias cuentas de Google los contactos de las etiquetas que elijas en Etiquetas. Va en un solo sentido: los cambios se hacen en Agendario; en Google y Outlook son para consultar. Añadiendo esa cuenta de Gmail al nuevo Outlook, los verás allí. Además, a tus contactos sin foto les pone la que tengan en Google."
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

          {/* 2. Cuentas de Google */}
          {accounts.map((a) => {
            const chosen = (tags ?? []).filter((t) => a.tagIds.includes(t.id));
            const others = accounts.filter((x) => x.id !== a.id);
            const r = a.lastResult;
            return (
              <div key={a.id} className="space-y-2 rounded-xl border border-slate-200 p-3">
                <p className="flex min-w-0 items-center gap-2 font-medium"><span>📧</span><span className="truncate">{label(a)}</span></p>
                {a.connected ? (
                  <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    ✓ Conectada · {a.linked} {a.linked === 1 ? "contacto" : "contactos"} en Google · última sincronización: {a.running ? "ahora mismo…" : when(a.lastSyncAt)}
                    {r && !a.running && (r.created || r.updated || r.deleted)
                      ? ` (${[r.created && `${r.created} nuevos`, r.updated && `${r.updated} cambiados`, r.deleted && `${r.deleted} quitados`].filter(Boolean).join(", ")})`
                      : ""}
                  </p>
                ) : (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Sin permiso de Google: vuelve a conectarla{isApp ? " desde la web de Agendario" : ""}.</p>
                )}
                {a.lastError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">⚠️ {a.lastError}</p>}
                {a.connected && (
                  <p className="text-xs text-slate-500">
                    📷 Fotos desde Google: {a.photosAt ? `última búsqueda ${when(a.photosAt)}${a.photosAdded ? ` · ${a.photosAdded} ${a.photosAdded === 1 ? "añadida" : "añadidas"}` : ""}` : "todavía no se han buscado"}
                  </p>
                )}
                {a.photosError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">⚠️ Fotos: {a.photosError}</p>}
                <div>
                  <p className="text-xs font-medium text-slate-600">Etiquetas que van a esta cuenta</p>
                  {chosen.length ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">{chosen.map((t) => <TagChip key={t.id} tag={t} />)}</div>
                  ) : (
                    <p className="text-sm text-slate-500">Ninguna todavía.</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {a.connected && (
                    <>
                      <button type="button" className="btn-ghost border border-slate-200" onClick={() => syncNow.mutate(a.id)} disabled={syncNow.isPending || a.running}>{syncNow.isPending && syncNow.variables === a.id || a.running ? "Sincronizando…" : "🔄 Sincronizar ahora"}</button>
                      <button type="button" className="btn-ghost border border-slate-200" onClick={() => photos.mutate(a.id)} disabled={photos.isPending || a.running}>{photos.isPending && photos.variables === a.id ? "Buscando fotos…" : "📷 Buscar fotos en Google ahora"}</button>
                    </>
                  )}
                  {!a.connected && !isApp && st.appConfigured && (
                    <button type="button" className="btn-primary" onClick={() => connect.mutate(a.id)} disabled={connect.isPending}>Volver a conectar</button>
                  )}
                  {others.length > 0 && a.tagIds.length > 0 && (
                    <select className="select w-auto py-1.5 text-sm" value="" disabled={move.isPending} onChange={(e) => e.target.value && void askMove(a, e.target.value)} aria-label="Pasar estas etiquetas a otra cuenta">
                      <option value="">Pasar estas etiquetas a…</option>
                      {others.map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}
                    </select>
                  )}
                  <button type="button" className="btn-danger" onClick={() => void askRemove(a)}>Quitar cuenta</button>
                </div>
              </div>
            );
          })}

          {st.appConfigured && (
            isApp ? (
              accounts.length === 0 && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">Las cuentas de Google se conectan desde la web de Agendario (en el navegador del ordenador o del móvil).</p>
            ) : (
              <div className="space-y-2">
                <button className={accounts.length ? "btn-ghost border border-slate-200" : "btn-primary"} onClick={() => connect.mutate(undefined)} disabled={connect.isPending}>
                  {connect.isPending ? "Abriendo Google…" : accounts.length ? "+ Añadir otra cuenta de Google" : "Conectar cuenta de Google"}
                </button>
                <p className="text-xs text-slate-500">Google te pedirá elegir la cuenta y permiso para gestionar tus contactos. Si sale «Google no ha verificado esta app», pulsa «Configuración avanzada» → «Ir a…»: la app es la tuya.</p>
              </div>
            )
          )}

          <p className="text-xs text-slate-500">
            Las etiquetas de cada cuenta se eligen en <Link to="/tags" className="font-medium text-indigo-700 underline">Etiquetas</Link> (las subetiquetas entran solas; una etiqueta puede ir a varias cuentas). En Google cada etiqueta aparece como una etiqueta de contactos.
            Las fotos: si un contacto tuyo no tiene foto y en Google hay una de esa persona (por su email o teléfono), se la pongo; nunca cambio una foto que ya tengas, y si quitas una que vino de Google no vuelve.
          </p>

          <div className="flex flex-wrap gap-2">
            {st.appConfigured && me?.isAdmin && !editApp && (
              <button type="button" className="btn-ghost text-xs" onClick={() => setEditApp(true)}>Cambiar la app de Google</button>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
