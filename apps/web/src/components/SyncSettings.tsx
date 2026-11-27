import { FastmailLogo } from "./BrandIcons";
import { Chevron } from "./Chevron";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  syncIntervals,
  syncProviderLabels,
  syncProviders,
  type SyncAccount,
  type SyncAccountInput,
  type SyncLogEntry,
  type SyncPreview,
  type SyncProvider,
  type SyncSummary,
} from "@agendario/shared";
import { api } from "../lib/api";
import { Modal, useAlert, useConfirm } from "./Dialogs";
import { TagChip, tagTree, useTags } from "./Tags";

const intervalLabel = (n: number) => (n === 0 ? "Solo a mano" : n < 60 ? `Cada ${n} minutos` : n === 60 ? "Cada hora" : `Cada ${n / 60} horas`);

function ago(iso: string | null) {
  if (!iso) return "nunca";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Resumen legible de una pasada. */
export function summaryText(s: SyncSummary | null): string {
  if (!s) return "";
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => n > 0 && parts.push(`${n} ${n === 1 ? one : many}`);
  add(s.paired, "emparejado", "emparejados");
  add(s.uploaded, "enviado", "enviados");
  add(s.created, "nuevo desde el servicio", "nuevos desde el servicio");
  add(s.updatedLocal, "actualizado en Agendario", "actualizados en Agendario");
  add(s.deletedRemote, "borrado en el servicio", "borrados en el servicio");
  add(s.deletedLocal, "a la papelera", "a la papelera");
  add(s.conflicts, "conflicto resuelto", "conflictos resueltos");
  add(s.errors, "con error", "con error");
  return parts.length ? parts.join(" · ") : "Sin cambios";
}

export function SyncSettings({ Section }: { Section: (p: { title: string; icon: ReactNode; desc?: string; children: ReactNode }) => ReactNode }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const { data: tags } = useTags();
  const { data: accounts } = useQuery({
    queryKey: ["sync"],
    queryFn: () => api.get<SyncAccount[]>("/sync"),
    refetchInterval: (q) => ((q.state.data as SyncAccount[] | undefined)?.some((a) => a.running) ? 2500 : 30000),
  });
  const [editing, setEditing] = useState<SyncAccount | "new" | null>(null);
  const [preview, setPreview] = useState<SyncAccount | null>(null);
  const [logOf, setLogOf] = useState<SyncAccount | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["sync"] });

  const run = useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) => api.post<SyncSummary>(`/sync/${id}/run`, { force: !!force }),
    onSettled: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
    onError: (e) => showAlert("No se ha podido sincronizar", (e as Error).message),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/sync/${id}`), onSuccess: refresh });
  const tagOf = (id: string) => tags?.find((t) => t.id === id);

  return (
    <Section icon="🔄" title="Sincronización" desc="Mantén tus contactos al día con otros servicios. Cada uno sincroniza solo las etiquetas que elijas.">
      {accounts?.length === 0 && <p className="text-sm text-slate-500">Todavía no sincronizas con ningún servicio.</p>}
      <div className="space-y-3">
        {accounts?.map((a) => {
          const blocked = a.lastStatus.startsWith("blocked");
          return (
            <div key={a.id} className="space-y-2 rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                {a.provider === "fastmail" ? <FastmailLogo className="h-6 w-6 shrink-0" /> : <span className="text-lg" aria-hidden="true">🗂️</span>}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-indigo-950">{a.name}</p>
                  <p className="truncate text-xs text-slate-500">{a.username} · {a.addressBookName || "libreta"} · {intervalLabel(a.intervalMin)}{!a.enabled && " · en pausa"}</p>
                </div>
                <button className="btn-ghost px-2.5 py-1 text-sm" onClick={() => setLogOf(a)}>Historial</button>
                <button className="btn-ghost px-2.5 py-1 text-sm" onClick={() => setEditing(a)}>Editar</button>
                <button
                  className="btn-ghost px-2.5 py-1 text-sm text-red-700"
                  onClick={async () =>
                    (await confirm({ title: `¿Quitar la sincronización con ${a.name}?`, message: "No se borra ningún contacto, ni aquí ni en el servicio: simplemente dejan de sincronizarse.", confirmText: "Quitar", danger: true })) && remove.mutate(a.id)
                  }
                >
                  Quitar
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-slate-500">Etiquetas:</span>
                {a.tagIds.map((id) => tagOf(id) && <TagChip key={id} tag={tagOf(id)!} small />)}
              </div>
              {a.running || (run.isPending && run.variables?.id === a.id) ? (
                <p className="text-sm text-indigo-800">⏳ Sincronizando…</p>
              ) : blocked ? (
                <div className="space-y-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
                  <p>⚠️ {a.lastError}</p>
                  <p className="text-xs">Si es lo que querías, aplícalo. Si no, revisa la etiqueta o el servicio: la sincronización automática queda en pausa hasta que decidas.</p>
                  <button className="btn-primary px-3 py-1.5" onClick={() => run.mutate({ id: a.id, force: true })}>Aplicar igualmente</button>
                </div>
              ) : !a.initialized ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50 p-2.5 text-sm text-indigo-900">
                  <span className="flex-1">Falta la primera sincronización: antes verás qué se va a hacer.</span>
                  <button className="btn-primary px-3 py-1.5" onClick={() => setPreview(a)}>Ver vista previa</button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`flex-1 ${a.lastStatus === "error" ? "text-red-700" : "text-slate-600"}`}>
                    {a.lastStatus === "error" ? `❌ ${a.lastError}` : `✅ ${ago(a.lastSyncAt)} · ${summaryText(a.lastSummary)}`}
                    <span className="text-slate-400"> · {a.linkedCount} contactos</span>
                  </span>
                  <button className="btn-ghost px-3 py-1.5" onClick={() => run.mutate({ id: a.id })}>🔄 Sincronizar ahora</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button className="btn-ghost" onClick={() => setEditing("new")}>+ Añadir sincronización</button>
      <p className="text-xs text-slate-500">
        Quitar la etiqueta a un contacto lo borra del servicio (no de Agendario). Lo que crees en el servicio llega con la etiqueta que elijas. Si
        borras un contacto en el servicio, aquí va a la papelera. Si cambia en los dos sitios, gana el cambio más reciente (el otro queda en el historial).
      </p>

      {editing && (
        <AccountEditor
          account={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(a, isNew) => {
            setEditing(null);
            refresh();
            if (isNew || !a.initialized) setPreview(a);
          }}
        />
      )}
      {logOf && <SyncLogDialog account={logOf} onClose={() => setLogOf(null)} />}
      {preview && (
        <PreviewDialog
          account={preview}
          onClose={() => setPreview(null)}
          onStart={() => {
            run.mutate({ id: preview.id });
            setPreview(null);
          }}
        />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

function AccountEditor({ account, onClose, onSaved }: { account: SyncAccount | null; onClose: () => void; onSaved: (a: SyncAccount, isNew: boolean) => void }) {
  const { data: tags } = useTags();
  const [f, setF] = useState<SyncAccountInput>({
    provider: account?.provider ?? "fastmail",
    serverUrl: account?.provider === "carddav" ? account.serverUrl : "",
    username: account?.username ?? "",
    password: "",
    accountId: account?.id,
    name: account?.name ?? "Fastmail",
    addressBookUrl: account?.addressBookUrl ?? "",
    addressBookName: account?.addressBookName ?? "",
    tagIds: account?.tagIds ?? [],
    newTagId: account?.newTagId ?? null,
    intervalMin: account?.intervalMin ?? 15,
    enabled: account?.enabled ?? true,
  });
  const [books, setBooks] = useState<{ url: string; name: string }[] | null>(account ? [{ url: account.addressBookUrl, name: account.addressBookName }] : null);
  const [error, setError] = useState("");
  const set = (v: Partial<SyncAccountInput>) => setF((x) => ({ ...x, ...v }));

  const discover = useMutation({
    mutationFn: () => api.post<{ addressBooks: { url: string; name: string }[] }>("/sync/discover", { provider: f.provider, serverUrl: f.serverUrl, username: f.username, password: f.password, accountId: account?.id }),
    onSuccess: (r) => {
      setError("");
      setBooks(r.addressBooks);
      // Fastmail: la libreta principal se llama «Default»/«Contacts»; se elige sola si solo hay una o si la de antes sigue
      const keep = r.addressBooks.find((b) => b.url === f.addressBookUrl) ?? r.addressBooks[0]!;
      set({ addressBookUrl: keep.url, addressBookName: keep.name });
    },
    onError: (e) => {
      setBooks(null);
      setError((e as Error).message);
    },
  });
  const save = useMutation({
    mutationFn: () => (account ? api.put<SyncAccount>(`/sync/${account.id}`, f) : api.post<SyncAccount>("/sync", f)),
    onSuccess: (a) => onSaved(a, !account),
    onError: (e) => setError((e as Error).message),
  });

  const connected = !!books && !!f.addressBookUrl;
  const toggleTag = (id: string) => {
    const next = f.tagIds.includes(id) ? f.tagIds.filter((x) => x !== id) : [...f.tagIds, id];
    set({ tagIds: next, newTagId: next.includes(f.newTagId ?? "") ? f.newTagId : next[0] ?? null });
  };

  return (
    <Modal
      title={account ? `Editar sincronización con ${account.name}` : "Nueva sincronización"}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!connected || !f.tagIds.length || save.isPending} onClick={() => save.mutate()}>
            {account ? "Guardar" : "Guardar y ver vista previa"}
          </button>
        </>
      }
    >
      <div className="space-y-4 p-4">
        {/* 1. Servicio y credenciales */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-indigo-950">1. Servicio</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Servicio</span>
              <select className="input" value={f.provider} onChange={(e) => { const p = e.target.value as SyncProvider; set({ provider: p, name: p === "fastmail" ? "Fastmail" : f.name === "Fastmail" ? "" : f.name }); setBooks(null); }}>
                {syncProviders.map((p) => <option key={p} value={p}>{syncProviderLabels[p]}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Nombre (para reconocerla)</span>
              <input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="p. ej. Fastmail" />
            </label>
            {f.provider === "carddav" && (
              <label className="block sm:col-span-2">
                <span className="label">Dirección del servidor CardDAV</span>
                <input className="input" value={f.serverUrl} onChange={(e) => { set({ serverUrl: e.target.value }); setBooks(null); }} placeholder="https://cloud.ejemplo.com/remote.php/dav" />
              </label>
            )}
            <label className="block">
              <span className="label">{f.provider === "fastmail" ? "Tu email de Fastmail" : "Usuario"}</span>
              <input className="input" autoComplete="off" value={f.username} onChange={(e) => { set({ username: e.target.value }); setBooks(null); }} placeholder={f.provider === "fastmail" ? "tu@fastmail.com" : ""} />
            </label>
            <label className="block">
              <span className="label">{f.provider === "fastmail" ? "Contraseña de app" : "Contraseña"}</span>
              <input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => set({ password: e.target.value })} placeholder={account?.hasPassword ? "•••••• (guardada)" : ""} />
            </label>
          </div>
          {f.provider === "fastmail" && (
            <div className="rounded-lg bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600">
              <p className="font-semibold text-slate-700">Cómo crear la contraseña de app en Fastmail</p>
              <p>
                En la web de Fastmail: <strong>Settings → Privacy &amp; Security → Connected apps &amp; API tokens → Manage app passwords and access → New app password</strong>
                (en español: Ajustes → Privacidad y seguridad). Ponle de nombre «Agendario» y deja el acceso <strong>Mail, Contacts &amp; Calendars</strong> (o solo contactos/CardDAV si
                te deja elegirlo). Pulsa <strong>Generate password</strong>, cópiala y pégala aquí: no es tu contraseña normal.
              </p>
            </div>
          )}
          <button className="btn-ghost border border-indigo-300 text-indigo-800" disabled={!f.username || (!f.password && !account?.hasPassword) || discover.isPending} onClick={() => discover.mutate()}>
            {discover.isPending ? "Conectando…" : connected ? "✓ Conectado · Volver a probar" : "Conectar"}
          </button>
          {connected && books && books.length > 1 && (
            <label className="block">
              <span className="label">Libreta de contactos</span>
              <select className="input" value={f.addressBookUrl} onChange={(e) => set({ addressBookUrl: e.target.value, addressBookName: books.find((b) => b.url === e.target.value)?.name ?? "" })}>
                {books.map((b) => <option key={b.url} value={b.url}>{b.name}</option>)}
              </select>
            </label>
          )}
          {connected && books && books.length === 1 && <p className="text-xs text-emerald-700">Libreta: {f.addressBookName || "Contactos"}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {/* 2. Qué se sincroniza */}
        <div className={`space-y-3 ${connected ? "" : "pointer-events-none opacity-40"}`}>
          <h3 className="text-sm font-semibold text-indigo-950">2. Qué contactos</h3>
          <div>
            <span className="label">Etiquetas que se sincronizan</span>
            <div className="flex flex-wrap gap-1.5">
              {tagTree(tags).map((n) => <TagChip key={n.tag.id} tag={{ ...n.tag, name: n.path }} active={f.tagIds.includes(n.tag.id)} onClick={() => toggleTag(n.tag.id)} />)}
              {tags?.length === 0 && <span className="text-sm text-slate-500">Crea antes alguna etiqueta (en la ficha de un contacto o en Etiquetas).</span>}
            </div>
            <p className="mt-1 text-xs text-slate-500">Cada etiqueta incluye sus subetiquetas. De cada contacto se envían los datos de estas etiquetas y los que no tienen etiqueta, nunca los de otras.</p>
          </div>
          {f.tagIds.length > 1 && (
            <label className="block">
              <span className="label">Etiqueta para lo que crees en {f.name || "el servicio"}</span>
              <select className="input" value={f.newTagId ?? ""} onChange={(e) => set({ newTagId: e.target.value })}>
                {f.tagIds.map((id) => <option key={id} value={id}>{tags?.find((t) => t.id === id)?.name}</option>)}
              </select>
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Sincronizar automáticamente</span>
              <select className="input" value={f.intervalMin} onChange={(e) => set({ intervalMin: Number(e.target.value) })}>
                {syncIntervals.map((n) => <option key={n} value={n}>{intervalLabel(n)}</option>)}
              </select>
            </label>
            {account && (
              <label className="mt-6 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!f.enabled} onChange={(e) => set({ enabled: !e.target.checked })} /> En pausa
              </label>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function NameList({ title, names, tone }: { title: string; names: string[]; tone: string }) {
  const [open, setOpen] = useState(false);
  if (!names.length) return null;
  return (
    <div className="rounded-lg border border-slate-200">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => setOpen(!open)}>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{names.length}</span>
        <span className="flex-1 font-medium">{title}</span>
        <span className="text-slate-500"><Chevron open={open} /></span>
      </button>
      {open && <ul className="max-h-48 overflow-auto border-t border-slate-100 px-3 py-1.5 text-sm text-slate-600">{names.map((n, i) => <li key={i} className="py-0.5">{n}</li>)}</ul>}
    </div>
  );
}

function PreviewDialog({ account, onClose, onStart }: { account: SyncAccount; onClose: () => void; onStart: () => void }) {
  const { data, error, isLoading } = useQuery({ queryKey: ["sync-preview", account.id], queryFn: () => api.get<SyncPreview>(`/sync/${account.id}/preview`), staleTime: 0, gcTime: 0 });
  return (
    <Modal
      title={`Primera sincronización con ${account.name}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Ahora no</button>
          <button className="btn-primary" disabled={!data} onClick={onStart}>Empezar a sincronizar</button>
        </>
      }
    >
      <div className="space-y-3 p-4 text-sm">
        {isLoading && <p className="text-slate-500">Leyendo los contactos de {account.name}…</p>}
        {error && <p className="text-red-600">{(error as Error).message}</p>}
        {data && (
          <>
            <p className="text-slate-600">
              En {account.name} hay <strong>{data.remoteCount}</strong> contactos; en Agendario, <strong>{data.localCount}</strong> con las etiquetas elegidas. Esto es lo que se hará
              (no se ha cambiado nada todavía):
            </p>
            <NameList title="Están en los dos sitios: se emparejan y se combinan sin perder datos" names={data.pairs.map((p) => (p.localName === p.remoteName ? p.localName : `${p.localName} ↔ ${p.remoteName}`) + (p.addsTag ? " (recibe la etiqueta)" : ""))} tone="bg-indigo-100 text-indigo-800" />
            <NameList title={`Se envían a ${account.name}`} names={data.toUpload} tone="bg-emerald-100 text-emerald-800" />
            <NameList title={`Llegan nuevos desde ${account.name} (con la etiqueta)`} names={data.toDownload} tone="bg-amber-100 text-amber-800" />
            {!data.pairs.length && !data.toUpload.length && !data.toDownload.length && <p className="text-slate-500">No hay nada que sincronizar todavía.</p>}
            <p className="text-xs text-slate-500">Las parejas se buscan por email, teléfono o nombre. Si alguna no es correcta, puedes separarlas después con el buscador de duplicados.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

const actionInfo: Record<string, { icon: string; label: string; group: "new" | "change" | "gone" | "error" | "run" }> = {
  created: { icon: "⬇️", label: "Nuevo en Agendario", group: "new" },
  uploaded_new: { icon: "⬆️", label: "Nuevo en el servicio", group: "new" },
  paired: { icon: "🔗", label: "Emparejado", group: "new" },
  updated: { icon: "✏️", label: "Actualizado en Agendario", group: "change" },
  uploaded: { icon: "✏️", label: "Actualizado en el servicio", group: "change" },
  conflict: { icon: "⚖️", label: "Conflicto", group: "change" },
  deleted_remote: { icon: "🗑️", label: "Borrado del servicio", group: "gone" },
  deleted_local: { icon: "🗑️", label: "A la papelera de Agendario", group: "gone" },
  error: { icon: "❌", label: "Error", group: "error" },
  run: { icon: "🔄", label: "Sincronización", group: "run" },
};
const filters = [
  { id: "all", label: "Todo" },
  { id: "new", label: "Altas" },
  { id: "change", label: "Modificaciones" },
  { id: "gone", label: "Bajas" },
  { id: "error", label: "Errores" },
] as const;

function SyncLogDialog({ account, onClose }: { account: SyncAccount; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["sync-log", account.id], queryFn: () => api.get<SyncLogEntry[]>(`/sync/${account.id}/log`) });
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("all");
  const [q, setQ] = useState("");
  const runs = useMemo(() => {
    const byRun = new Map<string, { run: SyncLogEntry | null; items: SyncLogEntry[]; at: string }>();
    for (const e of data ?? []) {
      const r = byRun.get(e.runId) ?? { run: null, items: [], at: e.at };
      if (e.action === "run") r.run = e;
      else r.items.push(e);
      byRun.set(e.runId, r);
    }
    const term = q.trim().toLowerCase();
    return [...byRun.values()]
      .map((r) => ({ ...r, items: r.items.filter((e) => (filter === "all" || actionInfo[e.action]?.group === filter) && (!term || e.contactName.toLowerCase().includes(term))) }))
      .filter((r) => r.items.length || (filter === "all" && !term))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [data, filter, q]);
  const fmt = (iso: string) => new Date(iso).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <Modal title={`Historial de ${account.name}`} onClose={onClose} size="lg" full>
      <div className="sticky top-0 z-10 space-y-2 border-b border-slate-100 bg-white p-3">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button key={f.id} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${filter === f.id ? "bg-indigo-700 text-white ring-indigo-700" : "bg-white text-slate-600 ring-slate-200"}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <input className="input" type="search" placeholder="Buscar un contacto…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="space-y-3 p-3">
        {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
        {data && runs.length === 0 && <p className="text-sm text-slate-500">Nada que mostrar. Se guardan los últimos 60 días; las pasadas sin cambios no se apuntan.</p>}
        {runs.map((r, i) => {
          let summary: (SyncSummary & { first?: boolean; forced?: boolean }) | null = null;
          try { summary = r.run ? JSON.parse(r.run.detail) : null; } catch { summary = null; }
          return (
            <div key={i} className="rounded-xl border border-slate-200">
              <div className="flex flex-wrap items-baseline gap-x-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                <span className="font-semibold text-slate-700">{fmt(r.at)}</span>
                {summary?.first && <span className="text-xs text-indigo-700">primera sincronización</span>}
                {summary?.forced && <span className="text-xs text-amber-700">aplicada igualmente</span>}
                {summary && <span className="text-xs text-slate-500">{summaryText(summary)}</span>}
              </div>
              <ul className="divide-y divide-slate-100">
                {r.items.map((e) => {
                  const info = actionInfo[e.action] ?? { icon: "•", label: e.action, group: "change" };
                  return (
                    <li key={e.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                      <span aria-hidden="true">{info.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div>
                          {e.contactId ? <Link className="font-medium text-indigo-800 hover:underline" to={`/contacts/${e.contactId}`}>{e.contactName || "Contacto"}</Link> : <span className="font-medium">{e.contactName || info.label}</span>}
                          <span className="text-slate-500"> · {info.label}</span>
                        </div>
                        {e.detail && <div className="text-xs text-slate-500">{e.detail}</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
