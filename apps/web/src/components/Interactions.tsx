import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  interactionKindIcons,
  interactionKindLabels,
  interactionKinds,
  type ContactDetail,
  type Interaction,
  type InteractionInput,
  type InteractionKind,
} from "@agendario/shared";
import { api } from "../lib/api";
import { AttachButton, AttachmentList, PendingFiles, uploadAttachments } from "./Attachments";
import { useAlert, useConfirm } from "./Dialogs";

/** «2026-11-15T16:30» en hora local, para <input type="datetime-local"> */
export const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export type InteractionPrefill = { kind: InteractionKind; channel?: string; durationMin?: number | null; at?: Date };

export type Draft = { kind: InteractionKind; at: string; durationMin: string; channel: string; notes: string };
const emptyDraft = (p?: InteractionPrefill): Draft => ({
  kind: p?.kind ?? "note",
  at: localInput(p?.at ?? new Date()),
  durationMin: p?.durationMin != null ? String(p.durationMin) : "",
  channel: p?.channel ?? "",
  notes: "",
});

export function InteractionForm({ c, initial, onDone, onCancel, editing, attachments, onAttachmentsChanged }: {
  c: Pick<ContactDetail, "id" | "phones">; initial: Draft; onDone: () => void; onCancel: () => void; editing?: string;
  attachments?: Interaction["attachments"]; onAttachmentsChanged?: () => void;
}) {
  const showAlert = useAlert();
  const [d, setD] = useState(initial);
  // Archivos elegidos: se suben al guardar (la llamada nueva aún no existe en el servidor)
  const [files, setFiles] = useState<File[]>([]);
  const isCall = d.kind.startsWith("call");
  const save = useMutation({
    mutationFn: async () => {
      const body: InteractionInput = {
        kind: d.kind,
        occurredAt: new Date(d.at).toISOString(),
        durationMin: isCall && d.durationMin ? Number(d.durationMin) : null,
        channel: d.channel,
        notes: d.notes,
      };
      const saved = editing ? await api.patch<Interaction>(`/interactions/${editing}`, body) : await api.post<Interaction>(`/contacts/${c.id}/interactions`, body);
      const id = editing ?? saved?.id;
      if (files.length && id) await uploadAttachments(`/interactions/${id}/attachments`, files);
    },
    onSuccess: onDone,
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });
  return (
    <form
      className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr]">
        <select className="input" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as InteractionKind })} aria-label="Tipo">
          {interactionKinds.map((k) => (
            <option key={k} value={k}>{interactionKindIcons[k]} {interactionKindLabels[k]}</option>
          ))}
        </select>
        <input className="input" type="datetime-local" value={d.at} onChange={(e) => setD({ ...d, at: e.target.value })} required aria-label="Fecha y hora" />
      </div>
      {(isCall || d.kind === "message") && (
        <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
          <input className="input" list={`ch-${c.id}`} placeholder={isCall ? "Teléfono" : "Por dónde (WhatsApp, email…)"} value={d.channel} onChange={(e) => setD({ ...d, channel: e.target.value })} aria-label="Teléfono o canal" />
          <datalist id={`ch-${c.id}`}>
            {c.phones.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </datalist>
          {isCall && d.kind !== "call_missed" && (
            <input className="input" type="number" min={0} max={1440} placeholder="Minutos" value={d.durationMin} onChange={(e) => setD({ ...d, durationMin: e.target.value })} aria-label="Duración en minutos" />
          )}
        </div>
      )}
      <textarea className="input min-h-24" placeholder="¿De qué habéis hablado? Acuerdos, pendientes…" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} aria-label="Apuntes" />
      {attachments && attachments.length > 0 && <AttachmentList items={attachments} onChanged={onAttachmentsChanged} />}
      <PendingFiles files={files} onRemove={(i) => setFiles(files.filter((_, k) => k !== i))} />
      <div className="flex items-center justify-between gap-2">
        <AttachButton onFiles={(f) => setFiles([...files, ...f])} />
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn-primary" disabled={save.isPending}>{save.isPending ? (files.length ? "Subiendo…" : "Guardando…") : "Guardar"}</button>
        </div>
      </div>
    </form>
  );
}

/** Llamadas y apuntes de conversaciones (privados: solo los ves tú). */
export function Interactions({ c, prefill, onPrefillUsed, embedded, openId }: { c: ContactDetail; prefill?: InteractionPrefill | null; onPrefillUsed?: () => void; embedded?: boolean; openId?: string | null }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [adding, setAdding] = useState<Draft | null>(null);
  // Desde el aviso «¿Quieres apuntar algo?» se abre directamente esa llamada para escribir la nota
  const [editing, setEditing] = useState<string | null>(openId ?? null);
  const [showAll, setShowAll] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["contact", c.id] });

  useEffect(() => {
    if (prefill) {
      setAdding(emptyDraft(prefill));
      onPrefillUsed?.();
    }
  }, [prefill, onPrefillUsed]);

  const remove = useMutation({ mutationFn: (id: string) => api.del(`/interactions/${id}`), onSuccess: refresh });
  const list = showAll ? c.interactions : c.interactions.slice(0, 5);

  const Wrap = embedded ? "div" : "section";
  return (
    <Wrap className={embedded ? "" : "card"}>
      <div className="mb-3 flex items-center justify-between gap-2">
        {embedded ? <span /> : <h2 className="section-title mb-0">Llamadas y apuntes</h2>}
        {!adding && (
          <div className="flex gap-1">
            <button className="btn-ghost px-2 text-sm" onClick={() => setAdding(emptyDraft({ kind: "call_out", channel: c.phones[0]?.value }))}>📞 Llamada</button>
            <button className="btn-ghost px-2 text-sm" onClick={() => setAdding(emptyDraft({ kind: "note" }))}>📝 Apunte</button>
          </div>
        )}
      </div>
      {adding && (
        <div className="mb-3">
          <InteractionForm c={c} initial={adding} onCancel={() => setAdding(null)} onDone={() => { setAdding(null); refresh(); }} />
        </div>
      )}
      {!c.interactions.length && !adding && <p className="text-sm text-slate-500">Aún no hay nada. Apunta las llamadas y de qué habláis: solo lo ves tú.</p>}
      <ol className="relative space-y-3 border-l-2 border-indigo-100 pl-4">
        {list.map((it: Interaction) =>
          editing === it.id ? (
            <li key={it.id}>
              <InteractionForm
                c={c}
                editing={it.id}
                initial={{ kind: it.kind, at: localInput(new Date(it.occurredAt)), durationMin: it.durationMin != null ? String(it.durationMin) : "", channel: it.channel, notes: it.notes }}
                attachments={it.attachments}
                onAttachmentsChanged={refresh}
                onCancel={() => setEditing(null)}
                onDone={() => { setEditing(null); refresh(); }}
              />
            </li>
          ) : (
            <li key={it.id} className="relative">
              <span className="absolute -left-[1.6rem] top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-sm ring-2 ring-indigo-100">{interactionKindIcons[it.kind].slice(0, 2)}</span>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-sm font-medium text-slate-800">
                  {interactionKindLabels[it.kind]}
                  {it.durationMin != null && <span className="font-normal text-slate-500"> · {it.durationMin} min</span>}
                  {it.channel && <span className="font-normal text-slate-500"> · {it.channel}</span>}
                  {it.attachments?.length > 0 && <span className="font-normal text-slate-500" title={`${it.attachments.length} adjunto(s)`}> · 📎{it.attachments.length > 1 ? it.attachments.length : ""}</span>}
                </span>
                <span className="text-xs text-slate-500">{fmt(it.occurredAt)}</span>
              </div>
              {it.notes && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{it.notes}</p>}
              <AttachmentList items={it.attachments ?? []} onChanged={refresh} canDelete={false} compact />
              <div className="mt-0.5 flex gap-3 text-xs">
                <button className="text-slate-500 hover:underline" onClick={() => setEditing(it.id)}>Editar</button>
                <button
                  className="text-red-700 hover:underline"
                  onClick={async () => (await confirm({ title: "¿Borrar este apunte?", confirmText: "Borrar", danger: true })) && remove.mutate(it.id)}
                >
                  Borrar
                </button>
              </div>
            </li>
          ),
        )}
      </ol>
      {c.interactions.length > 5 && (
        <button className="mt-3 text-sm text-indigo-700 hover:underline" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Ver menos" : `Ver las ${c.interactions.length}`}
        </button>
      )}
    </Wrap>
  );
}
