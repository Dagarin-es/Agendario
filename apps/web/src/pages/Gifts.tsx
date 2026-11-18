import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { GiftOverviewItem } from "@agendario/shared";
import { Avatar } from "../components/Avatar";
import { Modal } from "../components/Dialogs";
import { GiftThumb, QuickIdeaForm } from "../components/Gifts";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import { GiftIcon } from "./Upcoming";

type Sort = "next" | "name";

function when(days: number) {
  if (days === 0) return "Hoy";
  if (days === 1) return "Mañana";
  return `En ${days} días`;
}

function Card({ it, onAdd }: { it: GiftOverviewItem; onAdd: () => void }) {
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
              {g.status === "bought" && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">✅ Comprado</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">Sin ideas todavía.</p>
      )}
    </article>
  );
}

/** Pestaña Regalos: quién tiene fechas de regalo, cuándo es la próxima y qué ideas hay. */
export function GiftsPage() {
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem("gifts-sort") as Sort) || "next");
  const [adding, setAdding] = useState<GiftOverviewItem | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["gifts-overview"], queryFn: () => api.get<GiftOverviewItem[]>("/gifts/overview") });
  const list = useMemo(() => {
    const l = [...(data ?? [])];
    if (sort === "name") l.sort((a, b) => a.contactName.localeCompare(b.contactName, "es"));
    else l.sort((a, b) => (a.next?.date ?? "9").localeCompare(b.next?.date ?? "9"));
    return l;
  }, [data, sort]);
  const pick = (s: Sort) => { setSort(s); try { localStorage.setItem("gifts-sort", s); } catch { /* nada */ } };
  return (
    <div className="space-y-3">
      <h1 className="sr-only">Regalos</h1>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">{data ? `${data.length} ${data.length === 1 ? "persona" : "personas"} con fechas de regalo` : ""}</p>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Ordenar por
          <select className="input w-auto py-1.5" value={sort} onChange={(e) => pick(e.target.value as Sort)}>
            <option value="next">Próximas fechas</option>
            <option value="name">Nombre</option>
          </select>
        </label>
      </div>
      {isLoading && <p className="text-slate-500">Cargando…</p>}
      {data && !data.length && <div className="card text-sm text-slate-500">Nadie tiene todavía fechas con 🎁. Márcalas en la ficha de cada contacto (Fechas importantes).</div>}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((it) => <Card key={it.contactId} it={it} onAdd={() => setAdding(it)} />)}
      </div>
      {adding && (
        <Modal title={`Nueva idea para ${adding.contactName}`} onClose={() => setAdding(null)}>
          <QuickIdeaForm contactId={adding.contactId} onDone={() => setAdding(null)} onCancel={() => setAdding(null)} />
        </Modal>
      )}
    </div>
  );
}
