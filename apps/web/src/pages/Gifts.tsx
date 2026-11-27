import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGiftSort } from "../lib/giftSort";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { GiftIdea, GiftOverviewItem, GivenGift } from "@agendario/shared";
import { Avatar } from "../components/Avatar";
import { Modal } from "../components/Dialogs";
import { GiftEditDialog, GiftStatusButton, GiftThumb, GivenEditDialog, QuickIdeaForm } from "../components/Gifts";
import { givenImage, GivenGiftRow } from "../components/GiftExtras";
import { ReceivedGiftsList } from "../components/GiftsReceived";
import { api } from "../lib/api";
import { syncNativeReminders } from "../lib/native";
import { formatDate } from "../lib/format";
import { GiftIcon } from "./Upcoming";

type Sort = "next" | "name";

function when(days: number) {
  if (days === 0) return "Hoy";
  if (days === 1) return "Mañana";
  return `En ${days} días`;
}

function Card({ it, onAdd, onEdit, onChanged }: { it: GiftOverviewItem; onAdd: () => void; onEdit: (g: GiftIdea) => void; onChanged: (g: GiftIdea) => void }) {
  const e = it.next;
  const tone = e?.gift === "none" ? "none" : e?.gift === "ideas" ? "ideas" : e?.gift ? "bought" : "grey";
  return (
    <article className="card flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Link to={`/contacts/${it.contactId}`} className="shrink-0"><Avatar id={it.contactId} name={it.contactName} hasPhoto={it.hasPhoto} version={it.photoVersion} size={52} /></Link>
        <div className="min-w-0 flex-1">
          <Link to={`/contacts/${it.contactId}`} className="block truncate font-semibold text-slate-900 hover:text-indigo-700">{it.contactName}</Link>
          {e && (
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-slate-600">
              <GiftIcon tone={tone as "none"} className="h-4 w-4" />
              {e.emoji && <span aria-hidden="true">{e.emoji}</span>}
              <span>{e.label}{e.turning ? ` (${e.turning})` : ""} · {formatDate(e.date)}</span>
              <span className={`font-medium ${e.daysLeft <= 7 ? "text-red-700" : e.daysLeft <= 30 ? "text-amber-700" : "text-slate-500"}`}>· {when(e.daysLeft)}</span>
            </p>
          )}
        </div>
        <button className="btn-ghost shrink-0 border border-slate-200 px-3 py-1.5 text-sm" onClick={onAdd}>+ Idea</button>
      </div>
      {it.ideas.length > 0 ? (
        <ul className="space-y-1.5">
          {it.ideas.map((g) => (
            <li key={g.id} className="flex items-center gap-2.5">
              <GiftThumb idea={g} size={40} />
              <span className="min-w-0 flex-1 truncate text-sm">
                {g.url ? <a href={g.url} target="_blank" rel="noreferrer" className="text-slate-800 hover:text-indigo-700">{g.title} ↗</a> : g.title}
              </span>
              <GiftStatusButton idea={g} onChanged={() => onChanged(g)} />
              <button className="btn-ghost shrink-0 px-1.5 py-1 text-sm" onClick={() => onEdit(g)} aria-label={`Editar ${g.title}`} title="Editar">✏️</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">Sin ideas todavía.</p>
      )}
    </article>
  );
}

/** Regalos: «Para regalar» (fechas e ideas), «Regalados» (lo ya regalado) y «Recibidos» (lo que te han regalado). */
export function GiftsPage() {
  const [params, setParams] = useSearchParams();
  const v = params.get("vista");
  const view = v === "recibidos" || v === "regalados" ? v : "regalar";
  const tabs = [
    { id: "regalar", label: "🎁 Para regalar" },
    { id: "regalados", label: "✅ Regalados" },
    { id: "recibidos", label: "🎀 Recibidos" },
  ] as const;
  return (
    <div className="space-y-3">
      <h1 className="sr-only">Regalos</h1>
      {/* Siempre arriba al desplazar */}
      {/* Banda de pestañas pegada a la cabecera: siempre visible */}
      <nav className="m3-subtabs" role="tablist" aria-label="Regalos">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={view === t.id}
            onClick={() => setParams(t.id === "regalar" ? {} : { vista: t.id }, { replace: true })}
            className={`m3-subtab ${view === t.id ? "is-on" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {view === "recibidos" ? <ReceivedGiftsList /> : view === "regalados" ? <GivenList /> : <ToGive />}
    </div>
  );
}

/** «Para regalar»: quién tiene fechas de regalo, cuándo es la próxima y qué ideas hay. */
function ToGive() {
  const [sort, setSort] = useGiftSort();
  const [adding, setAdding] = useState<GiftOverviewItem | null>(null);
  const [editing, setEditing] = useState<GiftIdea | null>(null);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["gifts-overview"], queryFn: () => api.get<GiftOverviewItem[]>("/gifts/overview") });
  const list = useMemo(() => {
    const l = [...(data ?? [])];
    if (sort === "name") l.sort((a, b) => a.contactName.localeCompare(b.contactName, "es"));
    else l.sort((a, b) => (a.next?.date ?? "9").localeCompare(b.next?.date ?? "9"));
    return l;
  }, [data, sort]);
  const changed = (g: GiftIdea) => {
    for (const k of [["gifts-overview"], ["gifts-given"], ["contact", g.contactId], ["upcoming"], ["pending-gifts"]]) qc.invalidateQueries({ queryKey: k });
    void syncNativeReminders();
  };
  const pick = (s: Sort) => setSort(s);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">{data ? `${data.length} ${data.length === 1 ? "persona" : "personas"} con fechas de regalo` : ""}</p>
        <label className="hidden shrink-0 items-center gap-2 text-sm text-slate-600 sm:flex">
          <span className="hidden sm:inline">Ordenar por</span>
          <select className="input w-auto py-1.5" aria-label="Ordenar por" value={sort} onChange={(e) => pick(e.target.value as Sort)}>
            <option value="next">Próximas fechas</option>
            <option value="name">Nombre</option>
          </select>
        </label>
      </div>
      {isLoading && <p className="text-slate-500">Cargando…</p>}
      {data && !data.length && <div className="card text-sm text-slate-500">Nadie tiene todavía fechas con 🎁. Márcalas en la ficha de cada contacto (Fechas importantes).</div>}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {list.map((it) => <Card key={it.contactId} it={it} onAdd={() => setAdding(it)} onEdit={setEditing} onChanged={changed} />)}
      </div>
      {editing && (
        <GiftEditDialog idea={editing} onClose={() => setEditing(null)} onSaved={() => {
          qc.invalidateQueries({ queryKey: ["gifts-overview"] });
          qc.invalidateQueries({ queryKey: ["contact", editing.contactId] });
          qc.invalidateQueries({ queryKey: ["upcoming"] });
          void syncNativeReminders();
        }} />
      )}
      {adding && (
        <Modal title={`Nueva idea para ${adding.contactName}`} onClose={() => setAdding(null)}>
          <QuickIdeaForm contactId={adding.contactId} onDone={() => setAdding(null)} onCancel={() => setAdding(null)} />
        </Modal>
      )}
    </div>
  );
}

/** «Regalados»: todo lo que ya has regalado, de lo más reciente a lo más antiguo, con buscador. */
function GivenList() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["gifts-given"], queryFn: () => api.get<GivenGift[]>("/gifts/given") });
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<GivenGift | null>(null);
  const [viewing, setViewing] = useState<GivenGift | null>(null);
  const norm = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const list = (data ?? []).filter((g) => {
    if (!q.trim()) return true;
    const hay = norm([g.title, g.contactName, g.eventLabel, g.givenNote, g.notes].join(" "));
    return norm(q).split(/\s+/).every((w) => hay.includes(w));
  });
  const saved = (g: GiftIdea) => {
    for (const k of [["gifts-given"], ["gifts-overview"], ["contact", g.contactId], ["upcoming"], ["pending-gifts"]]) qc.invalidateQueries({ queryKey: k });
    void syncNativeReminders();
  };
  return (
    <div className="space-y-3">
      <input className="input" type="search" placeholder="Buscar regalo, persona u ocasión…" value={q} onChange={(e) => setQ(e.target.value)} />
      {isLoading && <p className="text-slate-500">Cargando…</p>}
      {data && data.length === 0 && <div className="card text-sm text-slate-500">Todavía no has marcado ningún regalo como 🎁 Regalado. Cuando lo hagas, aparecerá aquí con su fecha, foto y valoración.</div>}
      {data && data.length > 0 && list.length === 0 && <p className="text-sm text-slate-500">Nada coincide con la búsqueda.</p>}
      <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {list.map((g) => (
          <li key={g.id} className="card !p-3">
            <GivenGiftRow
              g={g}
              onPhoto={g.imageKey ? () => setViewing(g) : () => setEditing(g)}
              extra={
                <Link to={`/contacts/${g.contactId}`} className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-indigo-700 hover:underline">
                  <Avatar id={g.contactId} name={g.contactName} hasPhoto={g.hasPhoto} version={g.photoVersion} size={20} />
                  {g.contactName}
                </Link>
              }
              actions={<button className="btn-ghost -mr-1 -mt-1 shrink-0 px-2 py-1 text-sm" onClick={() => setEditing(g)} aria-label={`Editar ${g.title}`} title="Editar">✏️</button>}
            />
          </li>
        ))}
      </ul>
      {editing && <GivenEditDialog idea={editing} onClose={() => setEditing(null)} onSaved={() => saved(editing)} />}
      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)}>
          <div className="p-4"><img src={givenImage(viewing, "full") ?? ""} alt="" className="mx-auto max-h-[70vh] rounded-xl object-contain" /></div>
        </Modal>
      )}
    </div>
  );
}
