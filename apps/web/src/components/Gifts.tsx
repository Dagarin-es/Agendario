import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  occasionLabels,
  occasions,
  type GiftIdea,
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

/** Ideas para regalos: privadas de cada usuario. */
export function GiftIdeas({ contactId, ideas }: { contactId: string; ideas: GiftIdea[] }) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["contact", contactId] });
    qc.invalidateQueries({ queryKey: ["upcoming"] });
  };
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", url: "", price: "", notes: "" });
  const [giving, setGiving] = useState<string | null>(null);
  const [giveForm, setGiveForm] = useState<{ givenAt: string; occasion: Occasion | null }>({ givenAt: today(), occasion: null });
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
    onSuccess: () => { setGiving(null); refresh(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/gift-ideas/${id}`), onSuccess: refresh });

  const pending = ideas.filter((i) => !i.given);
  const given = ideas.filter((i) => i.given);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (draft.title.trim()) add.mutate();
  }

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

      {pending.length === 0 && !adding && <p className="text-sm text-slate-500">Sin ideas pendientes.</p>}
      <ul className="space-y-2">
        {pending.map((g) => (
          <li key={g.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {g.url ? <a href={g.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">{g.title} ↗</a> : g.title}
                </div>
                <div className="text-sm text-slate-500">{[euros(g.priceCents), g.notes].filter(Boolean).join(" · ")}</div>
              </div>
              <button className="btn-ghost text-indigo-700" onClick={() => { setGiving(g.id); setGiveForm({ givenAt: today(), occasion: null }); }}>Regalado</button>
              <button className="btn-danger" onClick={async () => (await confirm({ title: "¿Borrar esta idea de regalo?", message: g.title, confirmText: "Borrar", danger: true })) && remove.mutate(g.id)}>✕</button>
            </div>
            {giving === g.id && (
              <div className="mt-2 flex flex-wrap gap-2 rounded-lg bg-indigo-50 p-2">
                <input className="input w-auto" type="date" value={giveForm.givenAt} onChange={(e) => setGiveForm({ ...giveForm, givenAt: e.target.value })} />
                <div className="min-w-36 flex-1"><OccasionSelect value={giveForm.occasion} onChange={(o) => setGiveForm({ ...giveForm, occasion: o })} /></div>
                <button className="btn-primary" onClick={() => patch.mutate({ id: g.id, body: { given: true, ...giveForm } })}>Confirmar</button>
                <button className="btn-ghost" onClick={() => setGiving(null)}>Cancelar</button>
              </div>
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
                    · {formatDate(g.givenAt)}{g.occasion ? ` · ${occasionLabels[g.occasion]}` : ""}
                  </span>
                </span>
                <button className="btn-ghost text-xs" onClick={() => patch.mutate({ id: g.id, body: { given: false } })}>Deshacer</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
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
