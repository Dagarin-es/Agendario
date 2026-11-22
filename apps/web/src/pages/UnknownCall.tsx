import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { ContactDetail, UnknownCall } from "@agendario/shared";
import { api } from "../lib/api";
import { ContactPicker } from "../components/ContactPicker";
import { useAlert } from "../components/Dialogs";

/** Llamada de un número que no es contacto: guardar el número (nuevo o en un contacto) y apuntar algo. */
export function UnknownCallPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const showAlert = useAlert();
  const { data: call, isLoading, error } = useQuery({ queryKey: ["unknown-call", id], queryFn: () => api.get<UnknownCall>(`/unknown-calls/${id}`) });
  const [notes, setNotes] = useState("");
  const [picking, setPicking] = useState(false);
  useEffect(() => { if (call) setNotes(call.notes); }, [call]);

  const saveNote = async () => {
    if (call && notes !== call.notes) await api.patch(`/unknown-calls/${call.id}`, { notes });
  };
  const note = useMutation({
    mutationFn: saveNote,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["unknown-calls"] }); qc.invalidateQueries({ queryKey: ["unknown-call", id] }); },
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });
  const addTo = useMutation({
    mutationFn: async (contactId: string) => {
      await saveNote();
      const c = await api.get<ContactDetail>(`/contacts/${contactId}`);
      await api.patch(`/contacts/${contactId}`, { phones: [...c.phones, { label: "Móvil", value: call!.number }] });
      return contactId;
    },
    onSuccess: (contactId) => {
      qc.invalidateQueries({ queryKey: ["unknown-calls"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contact", contactId] });
      nav(`/contacts/${contactId}`, { replace: true });
    },
    onError: (e) => showAlert("No se ha podido añadir", (e as Error).message),
  });
  const discard = useMutation({
    mutationFn: () => api.del(`/unknown-calls/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["unknown-calls"] }); nav("/upcoming?vista=recordatorios", { replace: true }); },
  });

  if (isLoading) return <p className="p-4 text-slate-500">Cargando…</p>;
  if (error || !call) return <p className="p-4 text-slate-500">Esta llamada ya no está pendiente (quizá ya guardaste el número).</p>;
  const when = new Date(call.occurredAt).toLocaleString("es-ES", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="card space-y-1">
        <h1 className="text-xl font-semibold">{call.type === "out" ? "📞↗" : "📞↙"} {call.number}</h1>
        <p className="text-sm text-slate-500">{call.type === "out" ? "Llamada saliente" : "Llamada entrante"} · {when} · {Math.max(1, Math.round(call.durationSec / 60))} min</p>
        <p className="text-sm text-slate-600">Este número no está en tu agenda.</p>
      </div>
      <div className="card space-y-2">
        <label className="label" htmlFor="uc-notes">📝 Nota de la llamada</label>
        <textarea id="uc-notes" className="input min-h-28" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="¿De qué habéis hablado?" maxLength={20000} />
        <div className="flex justify-end">
          <button className="btn-ghost border border-slate-200" disabled={note.isPending || notes === call.notes} onClick={() => note.mutate()}>{note.isPending ? "Guardando…" : "Guardar nota"}</button>
        </div>
        <p className="text-xs text-slate-500">Si guardas el número en un contacto, la llamada y esta nota pasan a su ficha.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button className="btn-primary" onClick={async () => { await saveNote().catch(() => undefined); nav(`/contacts/new?phone=${encodeURIComponent(call.number)}`); }}>👤 Nuevo contacto</button>
        <button className="btn-ghost border border-slate-200" onClick={() => setPicking(true)} disabled={addTo.isPending}>➕ Añadir a un contacto</button>
      </div>
      <div className="text-center">
        <button className="btn-ghost text-sm text-slate-500" onClick={() => discard.mutate()}>No guardar este número</button>
      </div>
      {picking && <ContactPicker title="¿A qué contacto añades el número?" onClose={() => setPicking(false)} onPick={(c) => { setPicking(false); addTo.mutate(c.id); }} />}
    </div>
  );
}
