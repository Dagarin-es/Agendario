import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { occasionLabels, occasions, type GiftReceived, type Occasion } from "@agendario/shared";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import { Avatar } from "./Avatar";
import { ContactPicker } from "./ContactPicker";
import { Modal, useAlert, useConfirm } from "./Dialogs";

type Person = { id: string; displayName: string; hasPhoto?: boolean; updatedAt?: string };
const today = () => new Date().toISOString().slice(0, 10);

/** Tras cualquier cambio: la lista de recibidos y las fichas de los que lo regalaron. */
function useRefresh() {
  const qc = useQueryClient();
  return (ids: string[]) => {
    qc.invalidateQueries({ queryKey: ["gifts-received"] });
    for (const id of new Set(ids)) qc.invalidateQueries({ queryKey: ["contact", id] });
  };
}

/** «Ana y Pedro», «Ana, Pedro y Luis». */
export function namesList(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** Nuevo regalo recibido o editarlo: qué, cuándo, motivo, notas y quién (uno o varios). */
export function ReceivedGiftDialog({ gift, initialPeople = [], onClose }: { gift?: GiftReceived; initialPeople?: Person[]; onClose: () => void }) {
  const refresh = useRefresh();
  const [d, setD] = useState({
    description: gift?.description ?? "",
    receivedAt: gift ? gift.receivedAt ?? "" : today(),
    occasion: (gift?.occasion ?? null) as Occasion | null,
    notes: gift?.notes ?? "",
  });
  const [people, setPeople] = useState<Person[]>(gift?.contacts ?? initialPeople);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const before = gift?.contacts.map((c) => c.id) ?? [];
  const save = useMutation({
    mutationFn: () => {
      const body = { ...d, description: d.description.trim(), receivedAt: d.receivedAt || null, contactIds: people.map((p) => p.id) };
      return gift ? api.patch(`/gifts-received/${gift.id}`, body) : api.post("/gifts-received", body);
    },
    onSuccess: () => { refresh([...before, ...people.map((p) => p.id)]); onClose(); },
    onError: (e) => setError((e as Error).message),
  });
  const ok = d.description.trim() && people.length > 0;
  return (
    <Modal title={gift ? "Editar regalo recibido" : "Nuevo regalo recibido"} onClose={onClose}>
      <form className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); if (ok) save.mutate(); }}>
        <label className="sm:col-span-2"><span className="label">¿Qué te regalaron?</span>
          <input className="input" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="p. ej. Un libro de cocina" required autoFocus={!gift} />
        </label>
        <div className="sm:col-span-2">
          <span className="label">¿Quién te lo regaló?</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {people.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-0.5 pl-0.5 pr-1 text-sm">
                <Avatar id={p.id} name={p.displayName} hasPhoto={!!p.hasPhoto} size={24} version={p.updatedAt} />
                <span className="max-w-[12rem] truncate">{p.displayName}</span>
                <button type="button" className="rounded-full px-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-700" onClick={() => setPeople(people.filter((x) => x.id !== p.id))} aria-label={`Quitar a ${p.displayName}`}>✕</button>
              </span>
            ))}
            <button type="button" className="btn-ghost border border-dashed border-slate-300 px-3 py-1 text-sm" onClick={() => setPicking(true)}>+ {people.length ? "Añadir a otra persona" : "Elegir contacto"}</button>
          </div>
          {people.length === 0 && <p className="mt-1 text-xs text-slate-500">Puede ser de varias personas (p. ej. de tus padres o de los compañeros).</p>}
        </div>
        <label><span className="label">Fecha</span>
          <input className="input" type="date" value={d.receivedAt} onChange={(e) => setD({ ...d, receivedAt: e.target.value })} />
        </label>
        <label><span className="label">Motivo</span>
          <select className="input" value={d.occasion ?? ""} onChange={(e) => setD({ ...d, occasion: (e.target.value || null) as Occasion | null })}>
            <option value="">Sin motivo</option>
            {occasions.map((o) => <option key={o} value={o}>{occasionLabels[o]}</option>)}
          </select>
        </label>
        <label className="sm:col-span-2"><span className="label">Notas</span>
          <input className="input" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="Opcional" />
        </label>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!ok || save.isPending}>{save.isPending ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
      {picking && (
        <ContactPicker
          title="¿Quién te lo regaló?"
          onClose={() => setPicking(false)}
          onPick={(c) => { if (!people.some((p) => p.id === c.id)) setPeople([...people, { id: c.id, displayName: c.displayName, hasPhoto: c.hasPhoto, updatedAt: c.updatedAt }]); setPicking(false); }}
        />
      )}
    </Modal>
  );
}

/** Borrar (con confirmación; si es de varias personas, se avisa de que desaparece para todas). */
function useDeleteReceived() {
  const refresh = useRefresh();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const del = useMutation({
    mutationFn: (g: GiftReceived) => api.del(`/gifts-received/${g.id}`),
    onSuccess: (_r, g) => refresh(g.contacts.map((c) => c.id)),
    onError: (e) => showAlert("No se ha podido borrar", (e as Error).message),
  });
  return async (g: GiftReceived) => {
    const many = g.contacts.length > 1;
    if (await confirm({ title: "¿Borrar este regalo recibido?", message: many ? `${g.description}. Es de ${namesList(g.contacts.map((c) => c.displayName))}: se borra para todos.` : g.description, confirmText: "Borrar", danger: true })) del.mutate(g);
  };
}

/** Ficha del contacto: los regalos que te ha hecho (solo o con otros). */
export function GiftsReceived({ contactId, contactName, gifts }: { contactId: string; contactName: string; gifts: GiftReceived[] }) {
  const [editing, setEditing] = useState<GiftReceived | "new" | null>(null);
  const remove = useDeleteReceived();
  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title mb-0">🎀 Regalos recibidos</h2>
        <button className="btn-ghost" onClick={() => setEditing("new")}>+ Añadir</button>
      </div>
      {gifts.length === 0 && <p className="text-sm text-slate-500">Nada anotado.</p>}
      <ul className="space-y-1.5">
        {gifts.map((g) => {
          const others = g.contacts.filter((c) => c.id !== contactId);
          return (
            <li key={g.id} className="flex items-start gap-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{g.description}</span>{" "}
                {(g.receivedAt || g.occasion) && <span className="text-slate-500">· {[g.receivedAt ? formatDate(g.receivedAt) : "", g.occasion ? occasionLabels[g.occasion] : ""].filter(Boolean).join(" · ")}</span>}
                {others.length > 0 && (
                  <span className="block text-xs text-slate-500">
                    con {others.map((o, i) => (
                      <span key={o.id}>{i > 0 && (i === others.length - 1 ? " y " : ", ")}<Link to={`/contacts/${o.id}`} className="text-indigo-700 hover:underline">{o.displayName}</Link></span>
                    ))}
                  </span>
                )}
                {g.notes && <span className="block text-xs text-slate-500">{g.notes}</span>}
              </span>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(g)} aria-label="Editar" title="Editar">✏️</button>
              <button className="btn-danger text-xs" onClick={() => void remove(g)} aria-label="Borrar">✕</button>
            </li>
          );
        })}
      </ul>
      {editing && (
        <ReceivedGiftDialog
          gift={editing === "new" ? undefined : editing}
          initialPeople={[{ id: contactId, displayName: contactName }]}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

/** Pestaña «Recibidos» de Regalos: todos, por fecha, con buscador y filtro por persona. */
export function ReceivedGiftsList() {
  const { data, isLoading } = useQuery({ queryKey: ["gifts-received"], queryFn: () => api.get<GiftReceived[]>("/gifts-received") });
  const [q, setQ] = useState("");
  const [person, setPerson] = useState("");
  const [editing, setEditing] = useState<GiftReceived | "new" | null>(null);
  const remove = useDeleteReceived();
  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of data ?? []) for (const c of g.contacts) m.set(c.id, c.displayName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [data]);
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const list = (data ?? []).filter((g) => {
    if (person && !g.contacts.some((c) => c.id === person)) return false;
    if (!q.trim()) return true;
    const hay = norm([g.description, g.notes, g.occasion ? occasionLabels[g.occasion] : "", ...g.contacts.map((c) => c.displayName)].join(" "));
    return norm(q).split(/\s+/).every((w) => hay.includes(w));
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-0 basis-full sm:basis-auto sm:flex-1" type="search" placeholder="Buscar regalo o persona…" value={q} onChange={(e) => setQ(e.target.value)} />
        {people.length > 1 && (
          <select className="input w-auto min-w-0 max-w-[14rem] flex-1 sm:flex-none" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filtrar por persona">
            <option value="">Todas las personas</option>
            {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        <button className="btn-primary ml-auto shrink-0" onClick={() => setEditing("new")}>+ Regalo recibido</button>
      </div>
      {isLoading && <p className="text-slate-500">Cargando…</p>}
      {data && data.length === 0 && <div className="card text-sm text-slate-500">Todavía no has apuntado ningún regalo recibido. Añade el primero con «+ Regalo recibido» o desde la ficha de quien te lo hizo.</div>}
      {data && data.length > 0 && list.length === 0 && <p className="text-sm text-slate-500">Nada coincide con la búsqueda.</p>}
      <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {list.map((g) => (
          <li key={g.id} className="card flex items-start gap-3 !p-3">
            <div className="flex shrink-0 -space-x-2">
              {g.contacts.slice(0, 3).map((c) => (
                <Link key={c.id} to={`/contacts/${c.id}`} className="rounded-full ring-2 ring-white"><Avatar id={c.id} name={c.displayName} hasPhoto={c.hasPhoto} size={40} version={c.updatedAt} /></Link>
              ))}
              {g.contacts.length === 0 && <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-lg" aria-hidden="true">🎀</span>}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-900">{g.description}</p>
              <p className="text-sm text-slate-600">
                {g.contacts.length ? (
                  <>De {g.contacts.map((c, i) => (
                    <span key={c.id}>{i > 0 && (i === g.contacts.length - 1 ? " y " : ", ")}<Link to={`/contacts/${c.id}`} className="text-indigo-700 hover:underline">{c.displayName}</Link></span>
                  ))}</>
                ) : "De alguien que ya no está en tu agenda"}
              </p>
              {(g.receivedAt || g.occasion || g.notes) && <p className="text-xs text-slate-500">{[g.receivedAt ? formatDate(g.receivedAt) : "", g.occasion ? occasionLabels[g.occasion] : "", g.notes].filter(Boolean).join(" · ")}</p>}
            </div>
            <button className="btn-ghost shrink-0 px-2 py-1 text-sm" onClick={() => setEditing(g)} aria-label={`Editar ${g.description}`} title="Editar">✏️</button>
            <button className="btn-danger shrink-0 text-xs" onClick={() => void remove(g)} aria-label="Borrar">✕</button>
          </li>
        ))}
      </ul>
      {editing && <ReceivedGiftDialog gift={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
