import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { HISTORY_DAYS, type TrashItem } from "@agendario/shared";
import { Avatar } from "../components/Avatar";
import { useAlert, useConfirm } from "../components/Dialogs";
import { api } from "../lib/api";

const fmt = (iso: string) => new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000));

export function TrashPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const { data, isLoading } = useQuery({ queryKey: ["trash"], queryFn: () => api.get<TrashItem[]>("/trash") });
  const done = () => {
    qc.invalidateQueries({ queryKey: ["trash"] });
    qc.invalidateQueries({ queryKey: ["contacts"] });
    qc.invalidateQueries({ queryKey: ["duplicates"] });
  };
  const onError = (e: unknown) => showAlert("No se ha podido completar", (e as Error).message);
  const restore = useMutation({ mutationFn: (id: string) => api.post(`/trash/${id}/restore`), onSuccess: done, onError });
  const purge = useMutation({ mutationFn: (id: string) => api.del(`/trash/${id}`), onSuccess: done, onError });
  const empty = useMutation({ mutationFn: () => api.del("/trash"), onSuccess: done, onError });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="page-title text-xl font-semibold">🗑️ Papelera</h1>
          <p className="text-sm text-slate-500">Los contactos borrados se pueden recuperar durante {HISTORY_DAYS} días. Después se eliminan del todo.</p>
        </div>
        {!!data?.length && (
          <button
            className="btn-danger border border-red-200"
            onClick={async () =>
              (await confirm({ title: "¿Vaciar la papelera?", message: `Se eliminarán del todo ${data.length} contactos. No se puede deshacer.`, confirmText: "Vaciar", danger: true })) &&
              empty.mutate()
            }
          >
            Vaciar papelera
          </button>
        )}
      </div>

      {isLoading && <p className="text-slate-500">Cargando…</p>}
      {data && !data.length && <p className="card text-sm text-slate-500">La papelera está vacía.</p>}

      {!!data?.length && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar id={t.id} name={t.displayName} hasPhoto={t.hasPhoto} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.displayName}</p>
                <p className="text-xs text-slate-500">
                  {t.mergedInto ? (
                    <>Combinado en <Link className="text-indigo-700 hover:underline" to={`/contacts/${t.mergedInto.id}`}>«{t.mergedInto.displayName}»</Link></>
                  ) : (
                    "Borrado"
                  )}{" "}
                  el {fmt(t.deletedAt)} · se elimina en {daysLeft(t.purgeAt)} días
                </p>
              </div>
              <div className="flex gap-1">
                <Link to={`/contacts/${t.id}/history`} className="btn-ghost px-2 py-1.5 text-sm">Historial</Link>
                <button className="btn-primary px-3 py-1.5 text-sm" disabled={restore.isPending} onClick={() => restore.mutate(t.id)}>↩ Restaurar</button>
                <button
                  className="btn-danger px-2 py-1.5 text-sm"
                  onClick={async () =>
                    (await confirm({ title: `¿Eliminar del todo a «${t.displayName}»?`, message: "No se podrá recuperar.", confirmText: "Eliminar", danger: true })) && purge.mutate(t.id)
                  }
                >
                  Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
