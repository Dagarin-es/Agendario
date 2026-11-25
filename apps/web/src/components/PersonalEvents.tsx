import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import type { PersonalEvent, PersonalEventInput } from "@agendario/shared";
import { api } from "../lib/api";
import { formatPartialDate } from "../lib/format";
import { apiUrl } from "../lib/platform";
import { Link } from "react-router";
import { Avatar } from "./Avatar";
import { ContactPicker } from "./ContactPicker";
import { Modal, useAlert, useConfirm } from "./Dialogs";
import { EmojiPicker } from "./EmojiPicker";
import { PhotoViewer } from "./PhotoViewer";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const pad = (n: number) => String(n).padStart(2, "0");

export const usePersonalEvents = () =>
  useQuery({ queryKey: ["personal-events"], queryFn: () => api.get<PersonalEvent[]>("/personal-events"), staleTime: 60_000 });

export const personalPhoto = (e: PersonalEvent, size: "thumb" | "full") =>
  apiUrl(`/personal-events/${e.id}/photo?size=${size}&v=${encodeURIComponent(e.updatedAt)}`);

/** Próxima vez que se cumple (hoy incluido) y cuántos años hace. */
export function nextAnniversary(date: string, today = new Date()) {
  const noYear = date.startsWith("--");
  const y0 = noYear ? null : Number(date.slice(0, 4));
  const m = Number(date.slice(noYear ? 2 : 5, noYear ? 4 : 7));
  const d = Number(date.slice(noYear ? 5 : 8));
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const at = (y: number) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return new Date(y, m - 1, m === 2 && d === 29 && !leap ? 28 : d);
  };
  let next = at(t0.getFullYear());
  if (next < t0) next = at(t0.getFullYear() + 1);
  const daysLeft = Math.round((next.getTime() - t0.getTime()) / 86_400_000);
  return { next, daysLeft, years: y0 ? next.getFullYear() - y0 : null };
}

/** Tiempo aproximado entre dos fechas: «2 años», «1 mes»… (null si no llega a un mes). */
function roughSpan(from: Date, to: Date): string | null {
  let years = to.getFullYear() - from.getFullYear();
  if (to.getMonth() < from.getMonth() || (to.getMonth() === from.getMonth() && to.getDate() < from.getDate())) years--;
  if (years >= 1) return `${years} ${years === 1 ? "año" : "años"}`;
  const months = (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth() - (to.getDate() < from.getDate() ? 1 : 0);
  if (months >= 1) return `${months} ${months === 1 ? "mes" : "meses"}`;
  return null;
}

/** «hace 820 días (2 años)», «hace 45 días (1 mes)», «hace 12 días», «hoy», «dentro de 30 días (1 mes)». */
export function ago(date: string, today = new Date()) {
  if (date.startsWith("--")) return "";
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const then = new Date(y, m - 1, d);
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Días naturales (en UTC para que los cambios de hora no descuadren la cuenta)
  const days = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d)) / 86_400_000);
  if (days === 0) return "hoy";
  const n = Math.abs(days);
  const count = `${n.toLocaleString("es-ES")} ${n === 1 ? "día" : "días"}`;
  const rough = days > 0 ? roughSpan(then, now) : roughSpan(now, then);
  const text = rough ? `${count} (${rough})` : count;
  return days > 0 ? `hace ${text}` : `dentro de ${text}`;
}

type Sort = "recent" | "next";
/** Clave nueva en la 1.3.1: así a todos les sale por defecto la próxima que llega */
const SORT_KEY = "agendario-efemerides-orden-v2";

/** De la próxima que se cumple (hoy, la primera) a la más lejana. */
export function byNextAnniversary<T extends { date: string; title: string }>(list: T[]) {
  const today = new Date();
  return [...list].sort((a, b) => nextAnniversary(a.date, today).daysLeft - nextAnniversary(b.date, today).daysLeft || a.title.localeCompare(b.title, "es"));
}

/** Pestaña «Efemérides»: lista tipo diario, con detalle (foto en grande y comentario) y edición. */
export function PersonalEventsView({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const { data: events, isLoading } = usePersonalEvents();
  const [sort, setSort] = useState<Sort>(() => {
    try { return (localStorage.getItem(SORT_KEY) as Sort) || "next"; } catch { return "next"; }
  });
  const [editing, setEditing] = useState<PersonalEvent | "new" | null>(null);
  const list = useMemo(() => {
    if (sort === "next") return byNextAnniversary(events ?? []);
    const l = [...(events ?? [])];
    l.sort((a, b) => b.date.replace(/^--/, "0000-").localeCompare(a.date.replace(/^--/, "0000-")));
    return l;
  }, [events, sort]);
  const open = events?.find((e) => e.id === openId) ?? null;
  const changeSort = (s: Sort) => {
    setSort(s);
    try { localStorage.setItem(SORT_KEY, s); } catch { /* sin almacenamiento */ }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 basis-full text-sm text-slate-500 sm:flex-1 sm:basis-auto">Tus fechas para recordar: un coche nuevo, un ascenso, un viaje…</p>
        <span className="flex-1 sm:hidden" />
        <select className="select py-1.5 text-sm" value={sort} onChange={(e) => changeSort(e.target.value as Sort)} aria-label="Ordenar">
          <option value="next">Próximo aniversario</option>
          <option value="recent">Más recientes</option>
        </select>
        <button className="btn-primary" onClick={() => setEditing("new")}>+ Efeméride</button>
      </div>
      {isLoading && <p className="text-slate-500">Cargando…</p>}
      {!isLoading && list.length === 0 && (
        <div className="card space-y-2 py-8 text-center text-slate-500">
          <div className="text-4xl" aria-hidden="true">📔</div>
          <p>Aún no has guardado ninguna efeméride.</p>
          <button className="btn-primary" onClick={() => setEditing("new")}>+ Añadir la primera</button>
        </div>
      )}
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {list.map((e) => {
          const nx = nextAnniversary(e.date);
          const a = ago(e.date);
          return (
            <li key={e.id}>
              <button className="card flex w-full items-center gap-3 text-left hover:border-indigo-300" onClick={() => onOpen(e.id)}>
                {e.hasPhoto ? (
                  <img src={personalPhoto(e, "thumb")} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-2xl" aria-hidden="true">{e.emoji || "⭐"}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.hasPhoto && e.emoji ? `${e.emoji} ` : ""}{e.title}</span>
                  <span className="block text-sm text-slate-500">
                    {formatPartialDate(e.date)}{a ? ` · ${a}` : ""}
                  </span>
                  {e.description && <span className="block truncate text-xs text-slate-500">{e.description}</span>}
                  {e.contacts.length > 0 && (
                    <span className="mt-1 flex items-center -space-x-1.5">
                      {e.contacts.slice(0, 5).map((p) => (
                        <span key={p.id} className="rounded-full ring-2 ring-white"><Avatar id={p.id} name={p.displayName} hasPhoto={p.hasPhoto} size={20} version={p.updatedAt} /></span>
                      ))}
                      {e.contacts.length > 5 && <span className="pl-2.5 text-xs text-slate-500">+{e.contacts.length - 5}</span>}
                    </span>
                  )}
                </span>
                {e.yearly && (
                  <span className={`shrink-0 text-right text-xs font-semibold ${nx.daysLeft <= 7 ? "text-rose-600" : "text-slate-500"}`}>
                    {nx.daysLeft === 0 ? "¡Hoy!" : `en ${nx.daysLeft} d`}
                    {nx.years ? <span className="block font-normal">{nx.years} {nx.years === 1 ? "año" : "años"}</span> : null}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {open && <EventDetail e={open} onClose={() => onOpen(null)} onEdit={() => setEditing(open)} />}
      {editing && <EventForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); onOpen(id); }} />}
    </div>
  );
}

function EventDetail({ e, onClose, onEdit }: { e: PersonalEvent; onClose: () => void; onEdit: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [zoom, setZoom] = useState(false);
  const del = useMutation({
    mutationFn: () => api.del(`/personal-events/${e.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["personal-events"] }); onClose(); },
  });
  const nx = nextAnniversary(e.date);
  return (
    <Modal title={<span>{e.emoji || "⭐"} {e.title}</span>} onClose={onClose} size="lg">
      <div className="space-y-4 p-4">
        {e.hasPhoto && (
          <button type="button" className="block w-full overflow-hidden rounded-2xl bg-slate-100" onClick={() => setZoom(true)} aria-label="Ver la foto en grande">
            <img src={personalPhoto(e, "full")} alt="" className="max-h-[50vh] w-full object-contain" />
          </button>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
          <span className="font-medium text-slate-800">📅 {formatPartialDate(e.date)}</span>
          {ago(e.date) && <span>{ago(e.date)}</span>}
          {e.yearly && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800">Cada año · {nx.daysLeft === 0 ? "¡hoy!" : `próximo en ${nx.daysLeft} días`}{nx.years ? ` (${nx.years} ${nx.years === 1 ? "año" : "años"})` : ""}</span>}
        </div>
        {e.description && <p className="font-medium text-slate-700">{e.description}</p>}
        {e.contacts.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">👥 Personas</div>
            <div className="flex flex-wrap gap-2">
              {e.contacts.map((p) => (
                <Link key={p.id} to={`/contacts/${p.id}`} onClick={onClose} className="flex items-center gap-2 rounded-full bg-slate-100 py-1 pl-1 pr-3 text-sm hover:bg-indigo-50">
                  <Avatar id={p.id} name={p.displayName} hasPhoto={p.hasPhoto} size={26} version={p.updatedAt} />
                  {p.displayName}
                </Link>
              ))}
            </div>
          </div>
        )}
        {e.comment && (
          <div className="rounded-2xl bg-amber-50/70 p-4 text-[15px] leading-relaxed text-slate-800 ring-1 ring-amber-100">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">🔒 Comentario personal</div>
            <p className="whitespace-pre-wrap">{e.comment}</p>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="btn-ghost text-red-700"
            onClick={async () => (await confirm({ title: `¿Borrar «${e.title}»?`, message: "Se borra con su foto y su comentario. No se puede deshacer.", confirmText: "Borrar", danger: true })) && del.mutate()}
          >
            🗑️ Borrar
          </button>
          <button className="btn-ghost border border-slate-200" onClick={onEdit}>✏️ Editar</button>
          <button className="btn-primary" onClick={onClose}>Aceptar</button>
        </div>
      </div>
      {zoom && <PhotoViewer src={personalPhoto(e, "full")} alt={e.title} onClose={() => setZoom(false)} />}
    </Modal>
  );
}

function EventForm({ initial, onClose, onSaved }: { initial: PersonalEvent | null; onClose: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const showAlert = useAlert();
  const today = new Date();
  const m0 = initial?.date.match(/^(\d{4}|-)-?(\d{2})-(\d{2})$/);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [year, setYear] = useState(m0 ? (m0[1] !== "-" ? m0[1]! : "") : String(today.getFullYear()));
  const [month, setMonth] = useState(m0 ? Number(m0[2]) : today.getMonth() + 1);
  const [day, setDay] = useState(m0 ? Number(m0[3]) : today.getDate());
  const [emoji, setEmoji] = useState(initial?.emoji ?? "");
  const [picker, setPicker] = useState(false);
  const [yearly, setYearly] = useState(initial?.yearly ?? true);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [people, setPeople] = useState<PersonalEvent["contacts"]>(initial?.contacts ?? []);
  const [picking, setPicking] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [dropPhoto, setDropPhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  const valid = title.trim() && (!year || /^\d{4}$/.test(year));

  const save = useMutation({
    mutationFn: async () => {
      const body: PersonalEventInput = {
        title: title.trim(),
        date: `${year || "-"}-${pad(month)}-${pad(day)}`,
        emoji: emoji || null,
        yearly,
        description: description.trim() || null,
        comment: comment.trim() || null,
        contactIds: people.map((p) => p.id),
      };
      const ev = initial ? await api.patch<PersonalEvent>(`/personal-events/${initial.id}`, body) : await api.post<PersonalEvent>("/personal-events", body);
      if (photo) {
        const fd = new FormData();
        fd.append("photo", photo);
        await api.put(`/personal-events/${ev.id}/photo`, fd);
      } else if (dropPhoto && initial?.hasPhoto) {
        await api.del(`/personal-events/${ev.id}/photo`);
      }
      return ev;
    },
    onSuccess: (ev) => {
      qc.invalidateQueries({ queryKey: ["personal-events"] });
      onSaved(ev.id);
    },
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });

  const hasPhoto = !!photo || (!!initial?.hasPhoto && !dropPhoto);
  return (
    <Modal title={initial ? "Editar efeméride" : "Nueva efeméride"} onClose={onClose} size="lg">
      <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); if (valid) save.mutate(); }}>
        <div className="flex gap-2">
          <button type="button" className="input flex w-14 shrink-0 items-center justify-center text-2xl" onClick={() => setPicker((p) => !p)} aria-label="Elegir emoji">
            {emoji || "⭐"}
          </button>
          <input className="input flex-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Qué pasó (p. ej. «Coche nuevo»)" maxLength={120} autoFocus={!initial} />
        </div>
        {picker && <EmojiPicker value={emoji} onPick={(x) => { setEmoji(x); setPicker(false); }} onClear={() => { setEmoji(""); setPicker(false); }} />}
        <div className="grid grid-cols-[auto_1fr_auto] gap-2">
          <select className="input" value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="Día">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Mes">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input className="input w-24" inputMode="numeric" maxLength={4} placeholder="Año" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} aria-label="Año" />
        </div>
        <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={yearly} onChange={(e) => setYearly(e.target.checked)} />
          <span>
            <span className="font-medium">Recordarla cada año</span>
            <span className="block text-xs text-slate-500">Aparece también en el calendario de Eventos y en el calendario suscrito.</span>
          </span>
        </label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción breve (opcional)" maxLength={500} />
        <div>
          <textarea className="input min-h-36 py-2 leading-relaxed" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comentario personal: cómo fue, qué sentiste, a quién se lo contaste primero…" maxLength={20000} />
          <p className="mt-1 text-xs text-slate-500">🔒 Solo lo ves tú: no sale en el calendario suscrito.</p>
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">👥 Personas relacionadas</span>
          <div className="flex flex-wrap items-center gap-2">
            {people.map((p) => (
              <span key={p.id} className="flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-1 pr-1.5 text-sm">
                <Avatar id={p.id} name={p.displayName} hasPhoto={p.hasPhoto} size={24} version={p.updatedAt} />
                {p.displayName}
                <button type="button" className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200" onClick={() => setPeople(people.filter((x) => x.id !== p.id))} aria-label={`Quitar a ${p.displayName}`}>✕</button>
              </span>
            ))}
            <button type="button" className="rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50" onClick={() => setPicking(true)}>+ Añadir persona</button>
          </div>
          {picking && (
            <ContactPicker
              title="¿Quién está relacionado?"
              onClose={() => setPicking(false)}
              onPick={(x) => {
                if (!people.some((p) => p.id === x.id)) setPeople([...people, { id: x.id, displayName: x.displayName, hasPhoto: x.hasPhoto, updatedAt: x.updatedAt }]);
                setPicking(false);
              }}
            />
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasPhoto && (
            <img src={preview ?? (initial ? personalPhoto(initial, "thumb") : "")} alt="" className="h-16 w-16 rounded-xl object-cover" />
          )}
          <button type="button" className="btn-ghost border border-slate-200" onClick={() => fileRef.current?.click()}>📷 {hasPhoto ? "Cambiar foto" : "Añadir foto"}</button>
          {hasPhoto && <button type="button" className="btn-ghost text-red-700" onClick={() => { setPhoto(null); setDropPhoto(true); }}>Quitar</button>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setPhoto(f); setDropPhoto(false); } e.target.value = ""; }} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!valid || save.isPending}>{save.isPending ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}
