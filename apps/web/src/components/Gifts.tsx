import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  occasionLabels,
  occasions,
  type GiftIdea,
  type GiftOccasion,
  type GiftReceived,
  type Occasion,
} from "@agendario/shared";
import { api } from "../lib/api";
import { useConfirm } from "./Dialogs";
import { euros, formatDate } from "../lib/format";

const today = () => new Date().toISOString().slice(0, 10);

function OccasionSelect({ value, onChange }: { value: Occasion | null; onChange: (v: Occasion | null) => void }) {
  return (
    <select className="input" value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as Occasion | null)}>
      <option value="">Motivo…</option>
      {occasions.map((o) => <option key={o} value={o}>{occasionLabels[o]}</option>)}
    </select>
  );
}

/** Ideas para regalos: privadas de cada usuario. Idea → comprada (para un evento) → regalada. */
export function GiftIdeas({ contactId, ideas }: { contactId: string; ideas: GiftIdea[] }) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["contact", contactId] });
    qc.invalidateQueries({ queryKey: ["upcoming"] });
    qc.invalidateQueries({ queryKey: ["pending-gifts"] });
  };
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", url: "", price: "", notes: "" });
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const confirm = useConfirm();

  const add = useMutation({
    mutationFn: () =>
      api.post(`/contacts/${contactId}/gift-ideas`, {
        title: draft.title.trim(),
        url: draft.url.trim() || null,
        notes: draft.notes,
        priceCents: draft.price ? Math.round(parseFloat(draft.price.replace(",", ".")) * 100) : null,
      }),
    onSuccess: () => {
      setDraft({ title: "", url: "", price: "", notes: "" });
      setAdding(false);
      refresh();
    },
    onError: (e) => setError((e as Error).message),
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<GiftIdea> }) => api.patch(`/gift-ideas/${id}`, body),
    onSuccess: () => { setBuying(null); refresh(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/gift-ideas/${id}`), onSuccess: refresh });

  const pending = ideas.filter((i) => i.status === "idea");
  const bought = ideas.filter((i) => i.status === "bought");
  const given = ideas.filter((i) => i.status === "given");
  const todayIso = today();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (draft.title.trim()) add.mutate();
  }

  const title = (g: GiftIdea) => (g.url ? <a href={g.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">{g.title} ↗</a> : g.title);

  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title mb-0">🎁 Ideas para regalos</h2>
        {!adding && <button className="btn-ghost" onClick={() => setAdding(true)}>+ Añadir</button>}
      </div>
      <p className="mb-3 text-xs text-slate-400">Solo tú ves tus ideas, aunque el contacto esté compartido.</p>

      {adding && (
        <form onSubmit={submit} className="mb-4 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
          <input className="input sm:col-span-2" placeholder="Idea (p. ej. Bufanda de lana)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} autoFocus required />
          <input className="input" type="url" placeholder="Enlace (opcional)" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          <input className="input" inputMode="decimal" placeholder="Precio € (opcional)" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
          <input className="input sm:col-span-2" placeholder="Notas (talla, color…)" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>Cancelar</button>
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
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">🛍️ {title(g)}</div>
                    <div className="text-sm text-slate-600">
                      Comprado para <strong>{g.eventLabel || (g.occasion ? occasionLabels[g.occasion] : "una fecha")}</strong> · {formatDate(g.givenAt)}
                      {late && <span className="font-medium text-amber-800"> · ¿ya lo has regalado?</span>}
                    </div>
                  </div>
                  <button className="btn-primary px-3 py-1.5" onClick={() => patch.mutate({ id: g.id, body: { status: "given" } })}>✓ Regalado</button>
                  <button className="btn-ghost px-2 py-1.5 text-xs" onClick={() => patch.mutate({ id: g.id, body: { status: "idea" } })} title="Volver a idea">Deshacer</button>
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
              <div className="min-w-0 flex-1">
                <div className="font-medium">{title(g)}</div>
                <div className="text-sm text-slate-500">{[euros(g.priceCents), g.notes].filter(Boolean).join(" · ")}</div>
              </div>
              <button className="btn-ghost text-emerald-700" onClick={() => setBuying(buying === g.id ? null : g.id)}>🛍️ Comprado</button>
              <button className="btn-danger" onClick={async () => (await confirm({ title: "¿Borrar esta idea de regalo?", message: g.title, confirmText: "Borrar", danger: true })) && remove.mutate(g.id)}>✕</button>
            </div>
            {buying === g.id && (
              <BuyForm contactId={contactId} onCancel={() => setBuying(null)} onSave={(body) => patch.mutate({ id: g.id, body })} />
            )}
          </li>
        ))}
      </ul>

      {given.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-600">Ya regalados ({given.length})</summary>
          <ul className="mt-2 space-y-1">
            {given.map((g) => (
              <li key={g.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1">
                  <span className="text-slate-400 line-through">{g.title}</span>{" "}
                  <span className="text-slate-500">
                    · {formatDate(g.givenAt)}{g.eventLabel ? ` · ${g.eventLabel}` : g.occasion ? ` · ${occasionLabels[g.occasion]}` : ""}
                  </span>
                </span>
                <button className="btn-ghost text-xs" onClick={() => patch.mutate({ id: g.id, body: { status: "bought" } })}>Deshacer</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Al comprar: ¿para qué evento? (próximas fechas del contacto, Navidad, Reyes… u otra fecha). */
function BuyForm({ contactId, onCancel, onSave }: { contactId: string; onCancel: () => void; onSave: (b: Partial<GiftIdea>) => void }) {
  const { data: occ } = useQuery({ queryKey: ["gift-occasions", contactId], queryFn: () => api.get<GiftOccasion[]>(`/contacts/${contactId}/gift-occasions`) });
  const [sel, setSel] = useState<string>("");
  const [custom, setCustom] = useState<{ date: string; occasion: Occasion | null; label: string }>({ date: today(), occasion: null, label: "" });
  const [alreadyGiven, setAlreadyGiven] = useState(false);
  const todayIso = today();
  const upcoming = (occ ?? []).filter((o) => o.date >= todayIso);
  const recent = (occ ?? []).filter((o) => o.date < todayIso);
  const chosen = sel && sel !== "custom" ? occ?.find((o) => `${o.key}|${o.date}` === sel) : null;
  // Por defecto, la próxima ocasión
  const value = sel || (upcoming[0] ? `${upcoming[0].key}|${upcoming[0].date}` : "custom");
  const current = sel ? chosen : upcoming[0] ?? null;

  function save() {
    const status = alreadyGiven ? "given" : "bought";
    if (value === "custom") {
      if (!custom.date) return;
      onSave({ status, givenAt: custom.date, occasion: custom.occasion, eventKey: "custom", eventLabel: custom.label.trim() || (custom.occasion ? occasionLabels[custom.occasion] : "Otra fecha") });
    } else if (current) {
      onSave({ status, givenAt: current.date, occasion: current.occasion, eventKey: current.key, eventLabel: current.label });
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-emerald-50 p-2.5">
      <label className="block">
        <span className="label">¿Para qué es?</span>
        <select className="input" value={value} onChange={(e) => setSel(e.target.value)}>
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
          <input className="input" type="date" value={custom.date} onChange={(e) => setCustom({ ...custom, date: e.target.value })} />
          <OccasionSelect value={custom.occasion} onChange={(o) => setCustom({ ...custom, occasion: o })} />
          <input className="input" placeholder="Descripción (opcional)" value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} />
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={alreadyGiven} onChange={(e) => setAlreadyGiven(e.target.checked)} /> Ya lo he regalado
      </label>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn-primary" onClick={save}>Guardar</button>
      </div>
    </div>
  );
}

/** Regalos que te ha hecho este contacto: también privados. */
export function GiftsReceived({ contactId, gifts }: { contactId: string; gifts: GiftReceived[] }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["contact", contactId] });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ description: string; receivedAt: string; occasion: Occasion | null }>({ description: "", receivedAt: today(), occasion: null });

  const add = useMutation({
    mutationFn: () => api.post(`/contacts/${contactId}/gifts-received`, { ...draft, receivedAt: draft.receivedAt || null }),
    onSuccess: () => { setAdding(false); setDraft({ description: "", receivedAt: today(), occasion: null }); refresh(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/gifts-received/${id}`), onSuccess: refresh });
  const confirm = useConfirm();

  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title mb-0">Regalos recibidos</h2>
        {!adding && <button className="btn-ghost" onClick={() => setAdding(true)}>+ Añadir</button>}
      </div>
      {adding && (
        <form onSubmit={(e) => { e.preventDefault(); if (draft.description.trim()) add.mutate(); }} className="mb-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
          <input className="input sm:col-span-3" placeholder="¿Qué te regaló?" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} autoFocus required />
          <input className="input" type="date" value={draft.receivedAt} onChange={(e) => setDraft({ ...draft, receivedAt: e.target.value })} />
          <OccasionSelect value={draft.occasion} onChange={(o) => setDraft({ ...draft, occasion: o })} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>Cancelar</button>
            <button className="btn-primary">Guardar</button>
          </div>
        </form>
      )}
      {gifts.length === 0 && !adding && <p className="text-sm text-slate-500">Nada anotado.</p>}
      <ul className="space-y-1">
        {gifts.map((g) => (
          <li key={g.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">
              {g.description}{" "}
              <span className="text-slate-500">· {formatDate(g.receivedAt)}{g.occasion ? ` · ${occasionLabels[g.occasion]}` : ""}</span>
            </span>
            <button className="btn-danger text-xs" onClick={async () => (await confirm({ title: "¿Borrar este regalo recibido?", message: g.description, confirmText: "Borrar", danger: true })) && remove.mutate(g.id)}>✕</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
