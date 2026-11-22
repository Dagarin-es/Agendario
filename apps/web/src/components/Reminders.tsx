import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import {
  reminderKindIcons,
  reminderKindLabels,
  reminderKinds,
  type Reminder,
  type ReminderInput,
  type ReminderKind,
  type UnknownCall,
} from "@agendario/shared";
import { api } from "../lib/api";
import { syncNativeReminders } from "../lib/native";
import { Avatar } from "./Avatar";
import { ContactPicker } from "./ContactPicker";
import { Modal, useAlert, useConfirm } from "./Dialogs";

export const useReminders = () => useQuery({ queryKey: ["reminders"], queryFn: () => api.get<Reminder[]>("/reminders") });
export const useUnknownCalls = () => useQuery({ queryKey: ["unknown-calls"], queryFn: () => api.get<UnknownCall[]>("/unknown-calls") });

/** Recordatorios vencidos (para el aviso en la pestaña Fechas). */
export function useOverdueCount() {
  const { data } = useReminders();
  const now = Date.now();
  return (data ?? []).filter((r) => new Date(r.dueAt).getTime() <= now).length;
}

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Opciones rápidas de «cuándo». */
function quickTimes(now = new Date()) {
  const at = (days: number, h: number) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d; };
  const list: { label: string; date: Date }[] = [];
  if (now.getHours() < 17) list.push({ label: "Esta tarde", date: at(0, 18) });
  const inHour = new Date(now.getTime() + 3600_000); inHour.setSeconds(0, 0);
  list.push({ label: "En 1 hora", date: inHour });
  list.push({ label: "Mañana", date: at(1, 9) });
  list.push({ label: "En 3 días", date: at(3, 9) });
  list.push({ label: "En una semana", date: at(7, 9) });
  return list;
}

/** «hoy 18:00», «mañana 9:00», «lun 24 nov 9:00», «hace 2 días». */
export function dueText(iso: string, now = new Date()) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 86_400_000;
  const diff = day(d) - day(now);
  if (diff === 0) return `hoy ${time}`;
  if (diff === 1) return `mañana ${time}`;
  if (diff === -1) return `ayer ${time}`;
  if (diff < 0) return `hace ${-diff} días`;
  return `${d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

type ContactRef = { id: string; displayName: string; hasPhoto: boolean; updatedAt: string } | null;

/** Crear o editar un recordatorio: qué hacer y cuándo. */
export function ReminderDialog({ contact, initial, onClose }: { contact?: ContactRef; initial?: Reminder; onClose: () => void }) {
  const qc = useQueryClient();
  const showAlert = useAlert();
  const [kind, setKind] = useState<ReminderKind>(initial?.kind ?? "call");
  const [text, setText] = useState(initial?.text ?? "");
  const [who, setWho] = useState<ContactRef>(initial?.contact ?? contact ?? null);
  const [picking, setPicking] = useState(false);
  const quick = quickTimes();
  const [when, setWhen] = useState(localInput(initial ? new Date(initial.dueAt) : quick.find((q) => q.label === "Mañana")!.date));
  const save = useMutation({
    mutationFn: () => {
      const body: ReminderInput = { contactId: who?.id ?? null, kind, text: text.trim(), dueAt: new Date(when).toISOString() };
      return initial ? api.patch<Reminder>(`/reminders/${initial.id}`, body) : api.post<Reminder>("/reminders", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reminders"] });
      if (who) qc.invalidateQueries({ queryKey: ["contact", who.id] });
      if (initial?.contactId && initial.contactId !== who?.id) qc.invalidateQueries({ queryKey: ["contact", initial.contactId] });
      void syncNativeReminders();
      onClose();
    },
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });
  const valid = !!when && (kind !== "other" || !!text.trim());
  return (
    <Modal title={initial ? "Editar recordatorio" : "⏰ Nuevo recordatorio"} onClose={onClose} size="md">
      <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); if (valid) save.mutate(); }}>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">¿Qué tienes que hacer?</span>
          <div className="flex flex-wrap gap-2">
            {reminderKinds.map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                className={`rounded-full border px-3 py-1.5 text-sm ${kind === k ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 hover:bg-slate-50"}`}>
                {reminderKindIcons[k]} {reminderKindLabels[k]}
              </button>
            ))}
          </div>
        </div>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
          placeholder={kind === "other" ? "¿Qué? (p. ej. «Devolverle el libro»)" : "Detalle (opcional): p. ej. «preguntar por la reforma»"} />
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">¿Cuándo?</span>
          <div className="mb-2 flex flex-wrap gap-2">
            {quick.map((q) => (
              <button key={q.label} type="button" onClick={() => setWhen(localInput(q.date))}
                className={`rounded-full border px-3 py-1.5 text-sm ${when === localInput(q.date) ? "border-indigo-600 bg-indigo-50 text-indigo-800" : "border-slate-200 hover:bg-slate-50"}`}>
                {q.label}
              </button>
            ))}
          </div>
          <input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Fecha y hora" />
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Contacto</span>
          {who ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-1 pr-1.5 text-sm">
              <Avatar id={who.id} name={who.displayName} hasPhoto={who.hasPhoto} size={24} version={who.updatedAt} />
              {who.displayName}
              {!contact && <button type="button" className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200" onClick={() => setWho(null)} aria-label="Quitar contacto">✕</button>}
            </span>
          ) : (
            <button type="button" className="rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50" onClick={() => setPicking(true)}>+ Elegir contacto (opcional)</button>
          )}
          {picking && (
            <ContactPicker title="¿Con quién?" onClose={() => setPicking(false)}
              onPick={(x) => { setWho({ id: x.id, displayName: x.displayName, hasPhoto: x.hasPhoto, updatedAt: x.updatedAt }); setPicking(false); }} />
          )}
        </div>
        <p className="text-xs text-slate-500">📱 En la app de Android te llegará un aviso a esa hora.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!valid || save.isPending}>{save.isPending ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Una fila de recordatorio con «Hecho», editar y borrar. */
export function ReminderRow({ r, showContact = true }: { r: Reminder; showContact?: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const overdue = new Date(r.dueAt).getTime() <= Date.now();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["reminders"] });
    if (r.contactId) qc.invalidateQueries({ queryKey: ["contact", r.contactId] });
    void syncNativeReminders();
  };
  const done = useMutation({ mutationFn: () => api.patch(`/reminders/${r.id}`, { done: true }), onSuccess: refresh });
  const del = useMutation({ mutationFn: () => api.del(`/reminders/${r.id}`), onSuccess: refresh });
  return (
    <li className="flex items-start gap-3 py-2.5">
      <button type="button" onClick={() => done.mutate()} disabled={done.isPending} title="Marcar como hecho" aria-label="Marcar como hecho"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 text-transparent transition hover:border-emerald-500 hover:text-emerald-600">✓</button>
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <span aria-hidden="true">{reminderKindIcons[r.kind]}</span> <span className="font-medium">{reminderKindLabels[r.kind]}</span>
          {showContact && r.contact && <> · <Link to={`/contacts/${r.contact.id}`} className="text-indigo-700 hover:underline">{r.contact.displayName}</Link></>}
        </div>
        {r.text && <p className="whitespace-pre-line text-sm text-slate-700">{r.text}</p>}
        <p className={`text-xs ${overdue ? "font-medium text-red-700" : "text-slate-500"}`}>{overdue ? "⚠️ " : "⏰ "}{dueText(r.dueAt)}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <button type="button" className="btn-ghost px-2" onClick={() => setEditing(true)} aria-label="Editar" title="Editar">✏️</button>
        <button type="button" className="btn-ghost px-2" aria-label="Borrar" title="Borrar"
          onClick={async () => { if (await confirm({ title: "¿Borrar el recordatorio?", confirmText: "Borrar", danger: true })) del.mutate(); }}>🗑️</button>
      </div>
      {editing && <ReminderDialog initial={r} onClose={() => setEditing(false)} />}
    </li>
  );
}

/** Recuadro de la ficha: recordatorios pendientes con este contacto. */
export function ContactReminders({ contact, reminders, autoOpen = false, onAutoOpened }: {
  contact: NonNullable<ContactRef>; reminders: Reminder[]; autoOpen?: boolean; onAutoOpened?: () => void;
}) {
  const [adding, setAdding] = useState(autoOpen);
  return (
    <section className="card">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-semibold">⏰ Recordatorios</h2>
        <button className="btn-ghost px-2 text-sm" onClick={() => setAdding(true)}>+ Añadir</button>
      </div>
      {reminders.length === 0 ? (
        <p className="text-sm text-slate-500">Nada pendiente con {contact.displayName}.</p>
      ) : (
        <ul className="divide-y divide-slate-100">{reminders.map((r) => <ReminderRow key={r.id} r={r} showContact={false} />)}</ul>
      )}
      {adding && <ReminderDialog contact={contact} onClose={() => { setAdding(false); onAutoOpened?.(); }} />}
    </section>
  );
}

const minutes = (sec: number) => `${Math.max(1, Math.round(sec / 60))} min`;

/** Pestaña Fechas → Recordatorios: vencidos, próximos y llamadas de números desconocidos. */
export function RemindersView() {
  const { data, isLoading } = useReminders();
  const { data: unknown } = useUnknownCalls();
  const [adding, setAdding] = useState(false);
  const now = Date.now();
  const list = data ?? [];
  const overdue = list.filter((r) => new Date(r.dueAt).getTime() <= now);
  const next = list.filter((r) => new Date(r.dueAt).getTime() > now);
  const calls = (unknown ?? []).slice(0, 30);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setAdding(true)}>+ Recordatorio</button>
      </div>
      {isLoading && <p className="text-slate-500">Cargando…</p>}
      {!isLoading && list.length === 0 && (
        <div className="card space-y-2 py-8 text-center text-slate-500">
          <div className="text-4xl" aria-hidden="true">⏰</div>
          <p>No tienes nada pendiente.</p>
          <p className="text-sm">Crea recordatorios desde aquí, desde la ficha de un contacto o desde el aviso al colgar una llamada.</p>
        </div>
      )}
      {overdue.length > 0 && (
        <section className="card border-red-200">
          <h2 className="mb-1 font-semibold text-red-800">Para ya ({overdue.length})</h2>
          <ul className="divide-y divide-slate-100">{overdue.map((r) => <ReminderRow key={r.id} r={r} />)}</ul>
        </section>
      )}
      {next.length > 0 && (
        <section className="card">
          <h2 className="mb-1 font-semibold">Próximos ({next.length})</h2>
          <ul className="divide-y divide-slate-100">{next.map((r) => <ReminderRow key={r.id} r={r} />)}</ul>
        </section>
      )}
      {calls.length > 0 && (
        <section className="card">
          <h2 className="font-semibold">📞 Llamadas de números que no son contactos</h2>
          <p className="mb-1 text-xs text-slate-500">Atendidas de más de un minuto. Al guardar el número en un contacto, la llamada y su nota pasan a su ficha.</p>
          <ul className="divide-y divide-slate-100">
            {calls.map((x) => (
              <li key={x.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{x.type === "out" ? "📞↗" : "📞↙"} {x.number}</div>
                  <div className="text-xs text-slate-500">{new Date(x.occurredAt).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {minutes(x.durationSec)}</div>
                  {x.notes && <p className="line-clamp-2 text-sm text-slate-700">📝 {x.notes}</p>}
                </div>
                <Link to={`/unknown-call/${x.id}`} className="btn-ghost shrink-0 border border-slate-200 text-sm">Guardar…</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {adding && <ReminderDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
