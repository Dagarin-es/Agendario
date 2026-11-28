import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  HISTORY_DAYS,
  historyActionLabels,
  historyFieldLabels,
  historyFields,
  nonRestorableFields,
  type Address,
  type ContactDetail,
  type HistoryEntry,
  type HistoryField,
  type LabeledValue,
} from "@agendario/shared";
import { useAlert, useConfirm } from "../components/Dialogs";
import { HistoryIcon } from "../components/HistoryIcon";
import { addressLine } from "../components/MapLinks";
import { api } from "../lib/api";
import { formatPartialDate } from "../lib/format";

const actionStyle: Record<HistoryEntry["action"], string> = {
  create: "bg-emerald-100 text-emerald-800",
  update: "bg-indigo-100 text-indigo-800",
  delete: "bg-red-100 text-red-800",
  restore: "bg-amber-100 text-amber-900",
  merge: "bg-pink-100 text-pink-800",
};
const actionIcon: Record<HistoryEntry["action"], string> = { create: "✨", update: "✏️", delete: "🗑️", restore: "↩", merge: "🔀" };


const fmt = (iso: string) => new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Valor de un campo, legible. */
function Value({ field, v }: { field: HistoryField; v: unknown }) {
  const none = <span className="italic text-slate-400">(vacío)</span>;
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return none;
  if (field === "photoKey") return <span>con foto</span>;
  if (field === "organizationContactId") return <span>enlazada a un contacto</span>;
  if (field === "birthday") return <span>{formatPartialDate(String(v))}</span>;
  if (field === "addresses")
    return (
      <ul className="space-y-0.5">
        {(v as Address[]).map((a, i) => (
          <li key={i}>{a.label && <span className="text-slate-500">{a.label}: </span>}{addressLine(a)}{typeof a.lat === "number" && " 📍"}</li>
        ))}
      </ul>
    );
  if (Array.isArray(v))
    return (
      <ul className="space-y-0.5">
        {(v as LabeledValue[]).map((x, i) => (
          <li key={i}>{x.label && <span className="text-slate-500">{x.label}: </span>}{x.value}</li>
        ))}
      </ul>
    );
  return <span className="whitespace-pre-wrap">{String(v)}</span>;
}

function metaText(e: HistoryEntry) {
  const m = e.meta as Record<string, unknown>;
  const out: string[] = [];
  if (typeof m.source === "string") out.push(m.source);
  if (typeof m.auto === "string") out.push(m.auto);
  if (m.mergedFrom) out.push(`Se le ha combinado «${(m.mergedFrom as { displayName: string }).displayName}»`);
  if (m.mergedInto) out.push(`Combinado en «${(m.mergedInto as { displayName: string }).displayName}»`);
  if (m.fromTrash) out.push("Recuperado de la papelera");
  if (e.action === "restore" && typeof m.from === "string")
    out.push(`${m.side === "before" ? "Deshecho el cambio" : "Vuelto a la versión"} del ${fmt(m.from)}${m.field ? ` (${historyFieldLabels[m.field as HistoryField]})` : ""}`);
  return out.join(" · ");
}

export function HistoryPage() {
  const { id } = useParams() as { id: string };
  const qc = useQueryClient();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [open, setOpen] = useState<string | null>(null);
  const { data: c } = useQuery({ queryKey: ["contact", id], queryFn: () => api.get<ContactDetail>(`/contacts/${id}`), retry: false });
  const { data, isLoading, error } = useQuery({ queryKey: ["history", id], queryFn: () => api.get<HistoryEntry[]>(`/contacts/${id}/history`) });

  const restore = useMutation({
    mutationFn: (v: { entry: string; field?: HistoryField; side: "after" | "before" }) =>
      api.post(`/contacts/${id}/history/${v.entry}/restore`, { field: v.field, side: v.side }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["history", id] });
      qc.invalidateQueries({ queryKey: ["contact", id] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (e) => showAlert("No se ha podido restaurar", (e as Error).message),
  });
  const canEdit = c?.canEdit ?? false;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to={`/contacts/${id}`} className="btn-ghost px-2" aria-label="Volver">←</Link>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold"><HistoryIcon className="h-6 w-6 text-indigo-700" /> Historial</h1>
          {c && <p className="truncate text-sm text-slate-500">{c.displayName} · se guardan los cambios de los últimos {HISTORY_DAYS} días</p>}
        </div>
      </div>

      {isLoading && <p className="text-slate-500">Cargando…</p>}
      {error && <p className="text-red-600">{(error as Error).message}</p>}
      {data && !data.length && <p className="card text-sm text-slate-500">Todavía no hay cambios registrados para este contacto.</p>}

      <ol className="relative space-y-4 border-l-2 border-indigo-100 pl-5">
        {data?.map((e) => {
          const meta = metaText(e);
          const isOpen = open === e.id;
          return (
            <li key={e.id} className="relative">
              <span className="absolute -left-[2.05rem] top-3 flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm ring-2 ring-indigo-200">{actionIcon[e.action]}</span>
              <div className="card space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${actionStyle[e.action]}`}>{historyActionLabels[e.action]}</span>
                    <span className="text-sm text-slate-700">{fmt(e.createdAt)}</span>
                    <span className="text-xs text-slate-500">· {e.userName ?? "automático"}</span>
                  </div>
                  <div className="flex gap-1">
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(isOpen ? null : e.id)}>{isOpen ? "Ocultar versión" : "Ver versión completa"}</button>
                    {canEdit && e.action !== "delete" && (
                      <button
                        className="btn-ghost px-2 py-1 text-xs text-indigo-800"
                        onClick={async () =>
                          (await confirm({
                            title: "¿Volver a esta versión?",
                            message: `El contacto quedará como estaba el ${fmt(e.createdAt)} (la foto no cambia). Quedará apuntado en el historial y podrás deshacerlo.`,
                            confirmText: "Restaurar",
                          })) && restore.mutate({ entry: e.id, side: "after" })
                        }
                      >
                        ↩ Restaurar esta versión
                      </button>
                    )}
                  </div>
                </div>
                {meta && <p className="text-xs text-slate-500">{meta}</p>}

                {e.changes.length > 0 && (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {e.changes.map((ch) => (
                      <li key={ch.field} className="grid gap-1 p-2.5 text-sm sm:grid-cols-[9rem_1fr_auto] sm:items-start sm:gap-3">
                        <span className="font-medium text-slate-600">{historyFieldLabels[ch.field] ?? ch.field}</span>
                        <div className="grid gap-1 sm:grid-cols-[1fr_auto_1fr] sm:items-start sm:gap-2">
                          {e.action !== "create" && (
                            <>
                              <div className="rounded-md bg-red-50 px-2 py-1 text-red-900 line-through decoration-red-300"><Value field={ch.field} v={ch.before} /></div>
                              <span className="hidden text-slate-400 sm:block">→</span>
                            </>
                          )}
                          <div className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-900"><Value field={ch.field} v={ch.after} /></div>
                        </div>
                        {canEdit && e.action !== "create" && !nonRestorableFields.includes(ch.field) && (
                          <button
                            className="justify-self-start whitespace-nowrap rounded-md px-2 py-1 text-xs text-indigo-800 hover:bg-indigo-50"
                            title="Volver a poner el valor anterior en este campo"
                            onClick={() => restore.mutate({ entry: e.id, field: ch.field, side: "before" })}
                          >
                            ↩ Deshacer
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {e.action === "delete" && <p className="text-sm text-slate-600">Así estaba al borrarlo. Si está en la papelera, puedes recuperarlo desde ⋯ → Papelera.</p>}

                {isOpen && (
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Cómo quedó el contacto</p>
                    {historyFields
                      .filter((f) => f !== "organizationContactId")
                      .map((f) => (
                        <div key={f} className="flex gap-3 py-1 text-sm">
                          <span className="w-32 shrink-0 text-slate-500">{historyFieldLabels[f]}</span>
                          <div className="min-w-0 flex-1 break-words"><Value field={f} v={e.snapshot[f]} /></div>
                          {canEdit && !nonRestorableFields.includes(f) && e.action !== "delete" && (
                            <button className="shrink-0 text-xs text-indigo-800 hover:underline" onClick={() => restore.mutate({ entry: e.id, field: f, side: "after" })}>
                              Recuperar
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
