import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chevron } from "./Chevron";
import { useState, type FormEvent } from "react";
import {
  occasionLabels,
  occasions,
  type GiftIdea,
  type GiftOccasion,
  type Occasion,
} from "@agendario/shared";
import { api, apiUrl } from "../lib/api";
import { Modal, useAlert, useConfirm } from "./Dialogs";
import { euros, formatDate } from "../lib/format";
import { syncNativeReminders } from "../lib/native";
import { givenImage, GivenGiftRow, ImagePicker, StarRating } from "./GiftExtras";

/** Sube la imagen elegida al crear o regalar (multipart «photo»). */
async function uploadIdeaImage(id: string, f: File) {
  const fd = new FormData();
  fd.append("photo", f);
  await api.put(`/gift-ideas/${id}/image`, fd);
}

const today = () => new Date().toISOString().slice(0, 10);

function OccasionSelect({ value, onChange }: { value: Occasion | null; onChange: (v: Occasion | null) => void }) {
  return (
    <select className="input" value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as Occasion | null)}>
      <option value="">Motivo…</option>
      {occasions.map((o) => <option key={o} value={o}>{occasionLabels[o]}</option>)}
    </select>
  );
}

/** Miniatura de una idea (de la web del enlace o subida). Al tocarla: verla en grande y cambiarla. */
export function GiftThumb({ idea, size = 48, onChanged }: { idea: GiftIdea; size?: number; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const showAlert = useAlert();
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: ["contact", idea.contactId] });
    qc.invalidateQueries({ queryKey: ["gifts-overview"] });
    onChanged?.();
  };
  const fail = (e: unknown) => showAlert("No se ha podido cambiar la imagen", (e as Error).message);
  const upload = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("photo", f); return api.put(`/gift-ideas/${idea.id}/image`, fd); },
    onSuccess: () => { setOpen(false); done(); }, onError: fail,
  });
  const fromWeb = useMutation({ mutationFn: () => api.put(`/gift-ideas/${idea.id}/image`, {}), onSuccess: () => { setOpen(false); done(); }, onError: fail });
  const remove = useMutation({ mutationFn: () => api.del(`/gift-ideas/${idea.id}/image`), onSuccess: () => { setOpen(false); done(); }, onError: fail });
  const src = (sz: string) => apiUrl(`/gift-ideas/${idea.id}/image?size=${sz}&v=${idea.imageKey}`);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={{ width: size, height: size }} className="shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white" title={idea.imageKey ? "Ver imagen" : "Añadir imagen"}>
        {idea.imageKey ? <img src={src("thumb")} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="flex h-full w-full items-center justify-center bg-slate-50 text-xl text-slate-300" aria-hidden="true">🎁</span>}
      </button>
      {open && (
        <Modal title={idea.title} onClose={() => setOpen(false)}>
          <div className="p-4">
          {idea.imageKey && <img src={src("full")} alt="" className="mx-auto mb-4 max-h-[50vh] rounded-xl object-contain" />}
          <div className="flex flex-wrap gap-2">
            <label className="btn-primary cursor-pointer">
              {upload.isPending ? "Subiendo…" : idea.imageKey ? "Subir otra" : "Subir imagen"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
            </label>
            {idea.url && <button className="btn-ghost border border-slate-200" disabled={fromWeb.isPending} onClick={() => fromWeb.mutate()}>{fromWeb.isPending ? "Buscando…" : "🌐 Sacar de la web"}</button>}
            {idea.imageKey && <button className="btn-ghost text-red-700" onClick={() => remove.mutate()}>Quitar</button>}
          </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Tras cualquier cambio en las ideas de un contacto. */
export function useGiftRefresh(contactId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["contact", contactId] });
    qc.invalidateQueries({ queryKey: ["upcoming"] });
    qc.invalidateQueries({ queryKey: ["pending-gifts"] });
    qc.invalidateQueries({ queryKey: ["gifts-overview"] });
    qc.invalidateQueries({ queryKey: ["gifts-given"] });
    void syncNativeReminders(); // el aviso de cumpleaños sin regalo de la app se actualiza
  };
}

/** Pestaña «Ideas» del recuadro Regalos: privadas de cada usuario. Idea → comprada (para un evento) → regalada. */
export function GiftIdeas({ contactId, ideas }: { contactId: string; ideas: GiftIdea[] }) {
  const refresh = useGiftRefresh(contactId);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", url: "", price: "", notes: "" });
  const [image, setImage] = useState<File | null>(null);
  const [editing, setEditing] = useState<GiftIdea | null>(null);
  const [error, setError] = useState("");
  const confirm = useConfirm();

  const add = useMutation({
    mutationFn: async () => {
      const row = await api.post<GiftIdea>(`/contacts/${contactId}/gift-ideas`, {
        title: draft.title.trim(),
        url: draft.url.trim() || null,
        notes: draft.notes,
        priceCents: draft.price ? Math.round(parseFloat(draft.price.replace(",", ".")) * 100) : null,
      });
      if (image) await uploadIdeaImage(row.id, image);
    },
    onSuccess: () => {
      setDraft({ title: "", url: "", price: "", notes: "" });
      setImage(null);
      setAdding(false);
      refresh();
    },
    onError: (e) => setError((e as Error).message),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/gift-ideas/${id}`), onSuccess: refresh });

  const pending = ideas.filter((i) => i.status === "idea");
  const bought = ideas.filter((i) => i.status === "bought");
  const todayIso = today();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (draft.title.trim()) add.mutate();
  }

  const title = (g: GiftIdea) => (g.url ? <a href={g.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">{g.title} ↗</a> : g.title);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">Tus ideas de regalo son solo tuyas.</p>
        {!adding && <button className="btn-ghost shrink-0" onClick={() => setAdding(true)}>+ Añadir</button>}
      </div>

      {adding && (
        <form onSubmit={submit} className="mb-4 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
          <input className="input sm:col-span-2" placeholder="Idea (p. ej. Bufanda de lana)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} autoFocus required />
          <input className="input" type="url" placeholder="Enlace (opcional)" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          <input className="input" inputMode="decimal" placeholder="Precio € (opcional)" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
          <input className="input sm:col-span-2" placeholder="Notas (talla, color…)" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          <div className="sm:col-span-2"><ImagePicker file={image} onChange={setImage} hint="Si pones enlace y no eliges imagen, se intenta sacar de la web." /></div>
          {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn-ghost" onClick={() => { setAdding(false); setImage(null); }}>Cancelar</button>
            <button className="btn-primary" disabled={add.isPending}>Guardar</button>
          </div>
        </form>
      )}

      {/* Comprados: pendientes de entregar */}
      {bought.length > 0 && (
        <ul className="mb-3 space-y-2">
          {bought.map((g) => {
            const late = !!g.givenAt && g.givenAt < todayIso;
            return (
              <li key={g.id} className={`rounded-lg border p-3 ${late ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50/60"}`}>
                <div className="flex flex-wrap items-start gap-2">
                  <GiftThumb idea={g} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{title(g)}</div>
                    <div className="text-sm text-slate-600">
                      Para <strong>{g.eventLabel || (g.occasion ? occasionLabels[g.occasion] : "una fecha")}</strong> · {formatDate(g.givenAt)}
                      {late && <span className="font-medium text-amber-800"> · ¿ya lo has regalado?</span>}
                    </div>
                  </div>
                  <div className="flex w-full items-center justify-end gap-1 sm:w-auto">
                    <button className="btn-ghost px-2 py-1.5" onClick={() => setEditing(g)} aria-label="Editar" title="Editar">✏️</button>
                    <GiftStatusButton idea={g} onChanged={refresh} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pending.length === 0 && bought.length === 0 && !adding && <p className="text-sm text-slate-500">Sin ideas pendientes.</p>}
      <ul className="space-y-2">
        {pending.map((g) => (
          <li key={g.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-start gap-2">
              <GiftThumb idea={g} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{title(g)}</div>
                <div className="text-sm text-slate-500">{[euros(g.priceCents), g.notes].filter(Boolean).join(" · ")}</div>
              </div>
              <GiftStatusButton idea={g} onChanged={refresh} className="mt-0.5" />
              <button className="btn-ghost px-2" onClick={() => setEditing(g)} aria-label="Editar" title="Editar">✏️</button>
              <button className="btn-danger" onClick={async () => (await confirm({ title: "¿Borrar esta idea de regalo?", message: g.title, confirmText: "Borrar", danger: true })) && remove.mutate(g.id)}>✕</button>
            </div>
          </li>
        ))}
      </ul>

      {editing && <GiftEditDialog idea={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

/** Pestaña «Regalados» del recuadro Regalos: lo ya regalado, en grande. */
export function GivenGifts({ contactId, ideas }: { contactId: string; ideas: GiftIdea[] }) {
  const refresh = useGiftRefresh(contactId);
  const [editing, setEditing] = useState<GiftIdea | null>(null);
  const [viewing, setViewing] = useState<GiftIdea | null>(null);
  const given = ideas
    .filter((i) => i.status === "given")
    .sort((a, b) => (b.givenAt ?? "").localeCompare(a.givenAt ?? ""));
  if (!given.length) return <p className="text-sm text-slate-500">Todavía no has regalado nada a esta persona. Cuando marques una idea como 🎁 Regalado, aparecerá aquí con su fecha, foto y valoración.</p>;
  return (
    <>
      <ul className="divide-y divide-slate-100">
        {given.map((g) => (
          <li key={g.id} className="py-3 first:pt-0 last:pb-0">
            <GivenGiftRow
              g={g}
              onPhoto={g.imageKey ? () => setViewing(g) : () => setEditing(g)}
              actions={<button className="btn-ghost -mr-1 -mt-1 shrink-0 px-2 py-1" onClick={() => setEditing(g)} aria-label={`Editar ${g.title}`} title="Editar">✏️</button>}
            />
          </li>
        ))}
      </ul>
      {editing && <GivenEditDialog idea={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)}>
          <div className="p-4"><img src={givenImage(viewing, "full") ?? ""} alt="" className="mx-auto max-h-[70vh] rounded-xl object-contain" /></div>
        </Modal>
      )}
    </>
  );
}

/** Editar un regalo ya hecho: día, valoración, anotación, foto (y cambiar su estado). */
export function GivenEditDialog({ idea, onClose, onSaved }: { idea: GiftIdea; onClose: () => void; onSaved: () => void }) {
  const todayIso = today();
  const [d, setD] = useState({ givenAt: idea.givenAt ?? todayIso, rating: idea.rating ?? null, givenNote: idea.givenNote ?? "" });
  const [image, setImage] = useState<File | null>(null);
  const [dropImage, setDropImage] = useState(false);
  const [error, setError] = useState("");
  const current = dropImage ? null : givenImage(idea);
  const save = useMutation({
    mutationFn: async () => {
      await api.patch(`/gift-ideas/${idea.id}`, { givenAt: d.givenAt, rating: d.rating, givenNote: d.givenNote });
      if (image) await uploadIdeaImage(idea.id, image);
      else if (dropImage && idea.imageKey) await api.del(`/gift-ideas/${idea.id}/image`);
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError((e as Error).message),
  });
  return (
    <Modal title={`🎁 ${idea.title}`} onClose={onClose}>
      <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); if (d.givenAt) save.mutate(); }}>
        <label className="block"><span className="label">¿Qué día lo regalaste?</span>
          <input className="input" type="date" value={d.givenAt} max={todayIso} onChange={(e) => setD({ ...d, givenAt: e.target.value })} required />
        </label>
        <div><span className="label">Valoración</span><StarRating value={d.rating} onChange={(rating) => setD({ ...d, rating })} size={32} /></div>
        <label className="block"><span className="label">Anotación</span>
          <textarea className="input min-h-20" value={d.givenNote} onChange={(e) => setD({ ...d, givenNote: e.target.value })} placeholder="¿Le gustó? ¿Acertaste?" />
        </label>
        <div><span className="label">Foto</span>
          <ImagePicker current={current} file={image} onChange={(f) => { setImage(f); if (f) setDropImage(false); }} onRemove={() => setDropImage(true)} label="📷 Añadir foto" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <GiftStatusButton idea={idea} onChanged={() => { onSaved(); onClose(); }} />
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" disabled={save.isPending || !d.givenAt}>{save.isPending ? "Guardando…" : "Guardar"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Editar una idea de regalo: nombre, enlace, precio y notas (también si ya está comprada). */
export function GiftEditDialog({ idea, onClose, onSaved }: { idea: GiftIdea; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState({
    title: idea.title,
    url: idea.url ?? "",
    price: idea.priceCents != null ? (idea.priceCents / 100).toFixed(2).replace(".", ",").replace(/,00$/, "") : "",
    notes: idea.notes ?? "",
  });
  const [error, setError] = useState("");
  // «24,90», «24.90» o «1.250,50»
  const raw = d.price.trim().replace(/\s|€/g, "");
  const price = raw ? Math.round(parseFloat(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw) * 100) : null;
  const badPrice = d.price.trim() !== "" && (price == null || Number.isNaN(price) || price < 0);
  const save = useMutation({
    mutationFn: () => api.patch(`/gift-ideas/${idea.id}`, { title: d.title.trim(), url: d.url.trim() || null, priceCents: price, notes: d.notes }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError((e as Error).message),
  });
  return (
    <Modal title="Editar idea de regalo" onClose={onClose}>
      <form className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); if (d.title.trim() && !badPrice) save.mutate(); }}>
        <label className="sm:col-span-2"><span className="label">Idea</span>
          <input className="input" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} required autoFocus />
        </label>
        <label className="sm:col-span-2"><span className="label">Enlace</span>
          <input className="input" type="url" inputMode="url" placeholder="https://…" value={d.url} onChange={(e) => setD({ ...d, url: e.target.value })} />
        </label>
        <label><span className="label">Precio €</span>
          <input className={`input ${badPrice ? "border-red-400" : ""}`} inputMode="decimal" placeholder="p. ej. 24,90" value={d.price} onChange={(e) => setD({ ...d, price: e.target.value })} />
        </label>
        <label><span className="label">Notas</span>
          <input className="input" placeholder="Talla, color…" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
        </label>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-1 sm:col-span-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={save.isPending || !d.title.trim() || badPrice}>{save.isPending ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * ¿Para qué evento? (próximas fechas del contacto, Navidad, Reyes… u otra fecha).
 * - Comprado: la fecha es la del evento.
 * - Regalado: además pregunta la fecha en que se regaló (por defecto la del evento, si ya pasó, o hoy).
 */
function EventForm({ idea, mode, onCancel, onSave, busy }: { idea: GiftIdea; mode: "bought" | "given"; onCancel: () => void; onSave: (b: Partial<GiftIdea>, image?: File | null) => void; busy?: boolean }) {
  const contactId = idea.contactId;
  const { data: occ } = useQuery({ queryKey: ["gift-occasions", contactId], queryFn: () => api.get<GiftOccasion[]>(`/contacts/${contactId}/gift-occasions`) });
  const todayIso = today();
  const hasEvent = idea.status !== "idea" && !!idea.eventKey;
  const [sel, setSel] = useState<string>(hasEvent ? "current" : "");
  const [custom, setCustom] = useState<{ date: string; occasion: Occasion | null; label: string }>({ date: todayIso, occasion: null, label: "" });
  const evDate = idea.eventDate ?? idea.givenAt;
  const [givenOn, setGivenOn] = useState(idea.status === "given" && idea.givenAt ? idea.givenAt : evDate && evDate <= todayIso ? evDate : todayIso);
  const [rating, setRating] = useState<number | null>(idea.rating ?? null);
  const [note, setNote] = useState(idea.givenNote ?? "");
  const [image, setImage] = useState<File | null>(null);
  const upcoming = (occ ?? []).filter((o) => o.date >= todayIso);
  const recent = (occ ?? []).filter((o) => o.date < todayIso);
  // Por defecto: el evento que ya tenía; si no, al comprar la próxima ocasión y al regalar la más reciente
  const fallback = mode === "bought" ? upcoming[0] ?? null : recent[0] ?? upcoming[0] ?? null;
  const value = sel || (fallback ? `${fallback.key}|${fallback.date}` : "custom");
  const chosen = value !== "custom" && value !== "current" ? occ?.find((o) => `${o.key}|${o.date}` === value) ?? null : null;

  function pickEvent(v: string) {
    setSel(v);
    // Al regalar, si el evento ya pasó, su fecha es la propuesta
    const o = occ?.find((x) => `${x.key}|${x.date}` === v);
    if (mode === "given" && o) setGivenOn(o.date <= todayIso ? o.date : todayIso);
  }

  function save() {
    let ev: Partial<GiftIdea>;
    if (value === "current") {
      const d = idea.eventDate ?? idea.givenAt;
      ev = { givenAt: d, eventDate: d, occasion: idea.occasion, eventKey: idea.eventKey, eventLabel: idea.eventLabel };
    } else if (value === "custom") {
      if (mode === "bought" && !custom.date) return;
      const d = mode === "bought" ? custom.date : givenOn;
      ev = { givenAt: d, eventDate: d, occasion: custom.occasion, eventKey: "custom", eventLabel: custom.label.trim() || (custom.occasion ? occasionLabels[custom.occasion] : "Otra fecha") };
    } else if (chosen) ev = { givenAt: chosen.date, eventDate: chosen.date, occasion: chosen.occasion, eventKey: chosen.key, eventLabel: chosen.label };
    else return;
    if (mode === "given") {
      if (!givenOn) return;
      ev.givenAt = givenOn;
      ev.rating = rating;
      ev.givenNote = note;
    }
    onSave({ status: mode, ...ev }, mode === "given" ? image : null);
  }

  return (
    <div className={`space-y-3 rounded-2xl p-3 ${mode === "given" ? "bg-violet-50" : "bg-emerald-50"}`}>
      <label className="block">
        <span className="label">¿Para qué es?</span>
        <select className="input" value={value} onChange={(e) => pickEvent(e.target.value)}>
          {hasEvent && <option value="current">{idea.eventLabel || (idea.occasion ? occasionLabels[idea.occasion] : "La fecha elegida")} · {formatDate(idea.eventDate ?? idea.givenAt)}</option>}
          {upcoming.map((o) => <option key={`${o.key}|${o.date}`} value={`${o.key}|${o.date}`}>{o.label} · {formatDate(o.date)}</option>)}
          {recent.length > 0 && (
            <optgroup label="Recientes (ya pasadas)">
              {recent.map((o) => <option key={`${o.key}|${o.date}`} value={`${o.key}|${o.date}`}>{o.label} · {formatDate(o.date)}</option>)}
            </optgroup>
          )}
          <option value="custom">Otra fecha…</option>
        </select>
      </label>
      {value === "custom" && (
        <div className="grid gap-2 sm:grid-cols-3">
          {mode === "bought" && <input className="input" type="date" value={custom.date} onChange={(e) => setCustom({ ...custom, date: e.target.value })} aria-label="Fecha" />}
          <OccasionSelect value={custom.occasion} onChange={(o) => setCustom({ ...custom, occasion: o })} />
          <input className="input" placeholder="Descripción (opcional)" value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} />
        </div>
      )}
      {mode === "given" && (
        <label className="block">
          <span className="label">¿Qué día lo regalaste?</span>
          <input className="input" type="date" value={givenOn} max={todayIso} onChange={(e) => setGivenOn(e.target.value)} required />
        </label>
      )}
      {mode === "given" && (
        <>
          <div>
            <span className="label">Valoración</span>
            <StarRating value={rating} onChange={setRating} size={32} />
            <p className="mt-0.5 text-xs text-slate-500">Toca la mitad izquierda de una estrella para media.</p>
          </div>
          <label className="block">
            <span className="label">Anotación</span>
            <textarea className="input min-h-20" value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Le gustó? ¿Acertaste?" />
          </label>
          <div>
            <span className="label">Foto</span>
            <ImagePicker current={givenImage(idea)} file={image} onChange={setImage} label="📷 Añadir foto" hint="Del regalo envuelto, del momento de darlo…" />
          </div>
        </>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={busy || (mode === "given" && !givenOn)} onClick={save}>{mode === "given" ? "🎁 Regalado" : "🛒 Comprado"}</button>
      </div>
    </div>
  );
}

const statusChip: Record<GiftIdea["status"], { label: string; cls: string }> = {
  idea: { label: "⏳ Pendiente", cls: "border-slate-300 bg-white text-slate-700" },
  bought: { label: "🛒 Comprado", cls: "border-emerald-300 bg-emerald-100 text-emerald-900" },
  given: { label: "🎁 Regalado", cls: "border-violet-300 bg-violet-100 text-violet-900" },
};

/**
 * Botón con el estado de una idea (Pendiente · Comprado · Regalado). Al tocarlo se elige el estado:
 * Comprado pregunta para qué evento; Regalado, además, el día en que se regaló.
 */
export function GiftStatusButton({ idea, onChanged, className = "" }: { idea: GiftIdea; onChanged: () => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"menu" | "bought" | "given">("menu");
  const showAlert = useAlert();
  const patch = useMutation({
    mutationFn: async ({ body, image }: { body: Partial<GiftIdea>; image?: File | null }) => {
      await api.patch(`/gift-ideas/${idea.id}`, body);
      if (image) await uploadIdeaImage(idea.id, image);
    },
    onSuccess: () => { setOpen(false); onChanged(); },
    onError: (e) => showAlert("No se ha podido cambiar el estado", (e as Error).message),
  });
  const chip = statusChip[idea.status];
  const close = () => { setOpen(false); setStep("menu"); };
  const options: { id: GiftIdea["status"]; title: string; desc: string }[] = [
    { id: "idea", title: "⏳ Pendiente", desc: "Es solo una idea: todavía no lo has comprado." },
    { id: "bought", title: "🛒 Comprado", desc: "Ya lo tienes. Eliges para qué fecha es." },
    { id: "given", title: "🎁 Regalado", desc: "Ya lo has entregado: el día, una valoración, una anotación y una foto." },
  ];
  return (
    <>
      <button
        type="button"
        className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${chip.cls} ${className}`}
        onClick={() => { setStep("menu"); setOpen(true); }}
        aria-haspopup="dialog"
        title="Cambiar el estado"
      >
        {chip.label} <Chevron className="h-3.5 w-3.5 opacity-70" />
      </button>
      {open && (
        <Modal title={idea.title} onClose={close}>
          <div className="space-y-2 p-4">
            {step === "menu" ? (
              <>
                <p className="text-sm text-slate-500">¿En qué estado está este regalo?</p>
                {options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={patch.isPending}
                    className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left ${idea.status === o.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}
                    onClick={() => (o.id === "idea" ? idea.status !== "idea" && patch.mutate({ body: { status: "idea" } }) : setStep(o.id))}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{o.title}</span>
                      <span className="block text-sm text-slate-500">{o.desc}</span>
                    </span>
                    {idea.status === o.id && <span className="text-indigo-700" aria-label="Estado actual">✓</span>}
                  </button>
                ))}
              </>
            ) : (
              <EventForm idea={idea} mode={step} busy={patch.isPending} onCancel={() => setStep("menu")} onSave={(body, image) => patch.mutate({ body, image })} />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

/** Añadir una idea rápida (pestaña Regalos y «Compartir» desde el móvil). */
export function QuickIdeaForm({ contactId, initial, onDone, onCancel }: { contactId: string; initial?: { title?: string; url?: string }; onDone: () => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState({ title: initial?.title ?? "", url: initial?.url ?? "", price: "" });
  const [image, setImage] = useState<File | null>(null);
  const [error, setError] = useState("");
  const add = useMutation({
    mutationFn: async () => {
      const row = await api.post<GiftIdea>(`/contacts/${contactId}/gift-ideas`, {
        title: d.title.trim(), url: d.url.trim() || null, notes: "",
        priceCents: d.price ? Math.round(parseFloat(d.price.replace(",", ".")) * 100) : null,
      });
      if (image) await uploadIdeaImage(row.id, image);
    },
    onSuccess: () => {
      for (const k of [["contact", contactId], ["upcoming"], ["gifts-overview"]]) qc.invalidateQueries({ queryKey: k });
      onDone();
    },
    onError: (e) => setError((e as Error).message),
  });
  return (
    <form className="grid gap-2 p-4" onSubmit={(e) => { e.preventDefault(); if (d.title.trim()) add.mutate(); }}>
      <input className="input" placeholder="Idea (p. ej. Bufanda de lana)" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} autoFocus required />
      <input className="input" type="url" placeholder="Enlace (opcional; trae la imagen sola)" value={d.url} onChange={(e) => setD({ ...d, url: e.target.value })} />
      <input className="input" inputMode="decimal" placeholder="Precio € (opcional)" value={d.price} onChange={(e) => setD({ ...d, price: e.target.value })} />
      <ImagePicker file={image} onChange={setImage} hint="Si pones enlace y no eliges imagen, se intenta sacar de la web." />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn-primary" disabled={add.isPending}>{add.isPending ? "Guardando…" : "Guardar idea"}</button>
      </div>
    </form>
  );
}

