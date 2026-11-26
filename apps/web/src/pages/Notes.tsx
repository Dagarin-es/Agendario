import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { interactionKindIcons, interactionKindLabels, type RecentNote, type RecentNotesPage } from "@agendario/shared";
import { Avatar } from "../components/Avatar";
import { AttachmentList } from "../components/Attachments";
import { InteractionForm, localInput } from "../components/Interactions";
import { ago } from "../components/PersonalEvents";
import { tagTree, useTags } from "../components/Tags";
import { api } from "../lib/api";

type KindFilter = "" | "calls" | "meeting" | "message" | "note";
const kindFilters: [KindFilter, string][] = [
  ["", "Todas"],
  ["calls", "📞 Llamadas"],
  ["meeting", "🤝 Reuniones"],
  ["message", "💬 Mensajes"],
  ["note", "📝 Apuntes"],
];

const time = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const localDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** «Últimas notas»: las anotaciones de todos tus contactos, de la más reciente a la más antigua. */
export function NotesPage() {
  const [kind, setKind] = useState<KindFilter>("");
  const [tag, setTag] = useState("");
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q.trim());
  const { data: tags } = useTags();
  const qc = useQueryClient();
  const key = ["recent-notes", kind, tag, deferred];
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: "30" });
      if (pageParam) p.set("before", pageParam);
      if (kind) p.set("kind", kind);
      if (tag) p.set("tag", tag);
      if (deferred) p.set("q", deferred);
      return api.get<RecentNotesPage>(`/interactions/recent?${p}`);
    },
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["recent-notes"] });
    qc.invalidateQueries({ queryKey: ["contact"] });
  };

  // Carga la página siguiente al llegar al final
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  return (
    <div className="space-y-3">
      <h1 className="page-title text-lg font-semibold">📝 Últimas notas</h1>
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-0 flex-1" type="search" placeholder="Buscar en las notas o por contacto…" value={q} onChange={(e) => setQ(e.target.value)} />
        {tags && tags.length > 0 && (
          <select className="input w-auto max-w-[12rem]" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Etiqueta del contacto">
            <option value="">Todas las etiquetas</option>
            {tagTree(tags).map((n) => <option key={n.tag.id} value={n.tag.id}>{"\u00a0".repeat(n.depth * 3)}{n.tag.name}</option>)}
          </select>
        )}
      </div>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Tipo">
        {kindFilters.map(([k, label]) => (
          <button
            key={k || "all"}
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={`shrink-0 rounded-full border px-3 py-1 text-sm ${kind === k ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
          >{label}</button>
        ))}
      </div>

      {query.isLoading && <p className="text-slate-500">Cargando…</p>}
      {query.error && <p className="text-red-600">{(query.error as Error).message}</p>}
      {!query.isLoading && items.length === 0 && (
        <div className="card text-center text-slate-500">
          {deferred || kind || tag ? "No hay notas con esos filtros." : "Aún no has escrito ninguna nota. Las notas de las llamadas y los apuntes de tus contactos aparecerán aquí."}
        </div>
      )}

      <ul className="space-y-2">
        {items.map((n, i) => {
          const header = i === 0 || localDate(items[i - 1]!.occurredAt) !== localDate(n.occurredAt);
          return (
            <li key={n.id}>
              {header && <h2 className="mb-1 mt-3 px-1 text-xs font-bold uppercase tracking-wide text-indigo-800 first:mt-0">{day(n.occurredAt)} · {ago(localDate(n.occurredAt))}</h2>}
              <NoteCard n={n} onChanged={refresh} />
            </li>
          );
        })}
      </ul>
      <div ref={sentinel} />
      {query.isFetchingNextPage && <p className="text-center text-sm text-slate-500">Cargando más…</p>}
    </div>
  );
}

function NoteCard({ n, onChanged }: { n: RecentNote; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <InteractionForm
        c={{ id: n.contactId, phones: [] }}
        editing={n.id}
        initial={{ kind: n.kind, at: localInput(new Date(n.occurredAt)), durationMin: n.durationMin != null ? String(n.durationMin) : "", channel: n.channel, notes: n.notes }}
        attachments={n.attachments}
        onAttachmentsChanged={onChanged}
        onCancel={() => setEditing(false)}
        onDone={() => { setEditing(false); onChanged(); }}
      />
    );
  }
  const long = n.notes.length > 220 || n.notes.split("\n").length > 3;
  return (
    <div className="card p-3">
      <div className="flex items-start gap-3">
        <Link to={`/contacts/${n.contactId}`} className="shrink-0" aria-label={`Abrir ${n.contactName}`}>
          <Avatar id={n.contactId} name={n.contactName} hasPhoto={n.contactHasPhoto} version={n.contactUpdatedAt} size={36} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <Link to={`/contacts/${n.contactId}`} className="truncate font-medium text-slate-900 hover:underline">{n.contactName}</Link>
            <span className="shrink-0 text-xs text-slate-500">{time(n.occurredAt)}</span>
          </div>
          <div className="text-xs text-slate-500">
            {interactionKindIcons[n.kind]} {interactionKindLabels[n.kind]}
            {n.durationMin != null && ` · ${n.durationMin} min`}
            {n.attachments.length > 0 && ` · 📎 ${n.attachments.length}`}
          </div>
          {n.notes && (
            <button type="button" className="mt-1 block w-full text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
              <p className={`whitespace-pre-wrap text-sm text-slate-700 ${!open && long ? "line-clamp-3" : ""}`}>{n.notes}</p>
              {long && <span className="text-xs text-indigo-700">{open ? "Ver menos" : "Ver todo"}</span>}
            </button>
          )}
          <AttachmentList items={n.attachments} canDelete={false} compact />
          <button type="button" className="mt-1 text-xs text-slate-500 hover:underline" onClick={() => setEditing(true)}>Editar</button>
        </div>
      </div>
    </div>
  );
}
