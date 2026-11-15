import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import type { ContactSummary } from "@agendario/shared";
import { api } from "../lib/api";
import { Avatar } from "./Avatar";
import { Modal } from "./Dialogs";

/** Buscador de contactos en una ventana (p. ej. para enlazar la empresa). */
export function ContactPicker({
  title, initial = "", excludeId, onPick, onClose,
}: { title: string; initial?: string; excludeId?: string; onPick: (c: ContactSummary) => void; onClose: () => void }) {
  const [q, setQ] = useState(initial);
  const deferred = useDeferredValue(q);
  const { data, isLoading } = useQuery({
    queryKey: ["contacts", deferred, ""],
    queryFn: () => api.get<ContactSummary[]>(`/contacts${deferred ? `?q=${encodeURIComponent(deferred)}` : ""}`),
    placeholderData: (prev) => prev,
  });
  const results = (data ?? []).filter((c) => c.id !== excludeId).slice(0, 50);

  return (
    <Modal title={title} onClose={onClose} size="md">
      <div className="space-y-3 p-4">
        <input className="input" autoFocus placeholder="Buscar por nombre, empresa, email, teléfono…" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
        {isLoading && <p className="text-sm text-slate-500">Buscando…</p>}
        {!isLoading && results.length === 0 && <p className="text-sm text-slate-500">Sin resultados.</p>}
        <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-indigo-50" onClick={() => onPick(c)}>
                <Avatar id={c.id} name={c.displayName} hasPhoto={c.hasPhoto} size={32} version={c.updatedAt} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{c.displayName}</span>
                  {c.organization && <span className="block truncate text-xs text-slate-500">{c.organization}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
