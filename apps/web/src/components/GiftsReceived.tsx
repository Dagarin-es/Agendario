import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { occasionLabels, occasions, type GiftReceived, type Occasion } from "@agendario/shared";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import { Avatar } from "./Avatar";
import { ContactPicker } from "./ContactPicker";
import { Modal, useAlert, useConfirm } from "./Dialogs";
import { ImagePicker, receivedImage, ReceivedGiftRow, StarRating } from "./GiftExtras";

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
    rating: (gift?.rating ?? null) as number | null,
  });
  const [image, setImage] = useState<File | null>(null);
  const [dropImage, setDropImage] = useState(false);
  const [people, setPeople] = useState<Person[]>(gift?.contacts ?? initialPeople);
  // Personas que solo son un nombre (p. ej. desde una lista de deseos)
  const [loose, setLoose] = useState<string[]>(gift?.fromNames ?? []);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const before = gift?.contacts.map((c) => c.id) ?? [];
  const save = useMutation({
    mutationFn: async () => {
      const body = { ...d, description: d.description.trim(), receivedAt: d.receivedAt || null, contactIds: people.map((p) => p.id), ...(gift ? { fromNames: loose } : {}) };
      const row = gift ? await api.patch<GiftReceived>(`/gifts-received/${gift.id}`, body) : await api.post<GiftReceived>("/gifts-received", body);
      if (image) {
        const fd = new FormData();
        fd.append("photo", image);
        await api.put(`/gifts-received/${row.id}/image`, fd);
      } else if (dropImage && gift?.imageKey) await api.del(`/gifts-received/${gift.id}/image`);
    },
    onSuccess: () => { refresh([...before, ...people.map((p) => p.id)]); onClose(); },
    onError: (e) => setError((e as Error).message),
  });
  const ok = d.description.trim() && (people.length > 0 || loose.length > 0);
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
            {loose.map((n) => (
              <span key={n} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-0.5 pl-2.5 pr-1 text-sm">
                <span className="max-w-[12rem] truncate">{n}</span>
                <button type="button" className="rounded-full px-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-700" onClick={() => setLoose(loose.filter((x) => x !== n))} aria-label={`Quitar a ${n}`}>✕</button>
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
        <div className="sm:col-span-2"><span className="label">Valoración</span>
          <StarRating value={d.rating} onChange={(rating) => setD({ ...d, rating })} size={32} />
        </div>
        <label className="sm:col-span-2"><span className="label">Notas</span>
          <textarea className="input min-h-16" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="Opcional" />
        </label>
        <div className="sm:col-span-2"><span className="label">Foto</span>
          <ImagePicker current={gift && !dropImage ? receivedImage(gift) : null} file={image} onChange={(f) => { setImage(f); if (f) setDropImage(false); }} onRemove={() => setDropImage(true)} label="📷 Añadir foto" />
        </div>
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

/** Ver la foto de un regalo recibido en grande. */
function ReceivedPhotoModal({ g, onClose }: { g: GiftReceived; onClose: () => void }) {
  return (
    <Modal title={g.description} onClose={onClose}>
      <div className="p-4"><img src={receivedImage(g, "full") ?? ""} alt="" className="mx-auto max-h-[70vh] rounded-xl object-contain" /></div>
    </Modal>
  );
}

/** Pestaña «Recibidos» del recuadro Regalos de la ficha: los regalos que te ha hecho (solo o con otros). */
export function GiftsReceived({ contactId, contactName, gifts }: { contactId: string; contactName: string; gifts: GiftReceived[] }) {
  const [editing, setEditing] = useState<GiftReceived | "new" | null>(null);
  const [viewing, setViewing] = useState<GiftReceived | null>(null);
  const remove = useDeleteReceived();
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">Lo que te ha regalado, solo o con otros.</p>
        <button className="btn-ghost shrink-0" onClick={() => setEditing("new")}>+ Añadir</button>
      </div>
      {gifts.length === 0 && <p className="text-sm text-slate-500">Nada anotado.</p>}
      <ul className="divide-y divide-slate-100">
        {gifts.map((g) => {
          const others = g.contacts.filter((c) => c.id !== contactId);
          return (
            <li key={g.id} className="py-3 first:pt-0 last:pb-0">
              <ReceivedGiftRow
                g={g}
                onPhoto={g.imageKey ? () => setViewing(g) : () => setEditing(g)}
                from={others.length > 0 && (
                  <>con {others.map((o, i) => (
                    <span key={o.id}>{i > 0 && (i === others.length - 1 ? " y " : ", ")}<Link to={`/contacts/${o.id}`} className="text-indigo-700 hover:underline">{o.displayName}</Link></span>
                  ))}</>
                )}
                actions={
                  <span className="-mr-1 -mt-1 flex shrink-0">
                    <button className="btn-ghost px-2 py-1" onClick={() => setEditing(g)} aria-label="Editar" title="Editar">✏️</button>
                    <button className="btn-danger text-xs" onClick={() => void remove(g)} aria-label="Borrar">✕</button>
                  </span>
                }
              />
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
      {viewing && <ReceivedPhotoModal g={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** Pestaña «Recibidos» de Regalos: todos, por fecha, con buscador y filtro por persona. */
export function ReceivedGiftsList() {
  const { data, isLoading } = useQuery({ queryKey: ["gifts-received"], queryFn: () => api.get<GiftReceived[]>("/gifts-received") });
  const [q, setQ] = useState("");
  const [person, setPerson] = useState("");
  const [editing, setEditing] = useState<GiftReceived | "new" | null>(null);
  const [viewing, setViewing] = useState<GiftReceived | null>(null);
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
          <li key={g.id} className="card !p-3">
            <ReceivedGiftRow
              g={g}
              onPhoto={g.imageKey ? () => setViewing(g) : () => setEditing(g)}
              from={g.contacts.length || g.fromNames?.length ? (
                <span className="inline-flex flex-wrap items-center gap-1">
                  <span className="flex -space-x-1.5">
                    {g.contacts.slice(0, 3).map((c) => (
                      <Link key={c.id} to={`/contacts/${c.id}`} className="rounded-full ring-2 ring-white"><Avatar id={c.id} name={c.displayName} hasPhoto={c.hasPhoto} size={20} version={c.updatedAt} /></Link>
                    ))}
                  </span>
                  De {g.contacts.map((c, i) => (
                    <span key={c.id}>{i > 0 && (i === g.contacts.length + (g.fromNames?.length ?? 0) - 1 ? " y " : ", ")}<Link to={`/contacts/${c.id}`} className="text-indigo-700 hover:underline">{c.displayName}</Link></span>
                  ))}
                  {(g.fromNames ?? []).map((n, i) => {
                    const k = g.contacts.length + i;
                    return <span key={n}>{k > 0 && (k === g.contacts.length + (g.fromNames?.length ?? 0) - 1 ? " y " : ", ")}{n}</span>;
                  })}
                </span>
              ) : "De alguien que ya no está en tu agenda"}
              actions={
                <span className="-mr-1 -mt-1 flex shrink-0">
                  <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setEditing(g)} aria-label={`Editar ${g.description}`} title="Editar">✏️</button>
                  <button className="btn-danger text-xs" onClick={() => void remove(g)} aria-label="Borrar">✕</button>
                </span>
              }
            />
          </li>
        ))}
      </ul>
      {editing && <ReceivedGiftDialog gift={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {viewing && <ReceivedPhotoModal g={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
