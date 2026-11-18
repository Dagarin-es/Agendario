import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { TagLite } from "@agendario/shared";
import { api } from "../lib/api";
import { TagChip, useTags, useTagPath } from "./Tags";

/**
 * Etiqueta de un dato concreto (teléfono, email o dirección).
 * Muestra la etiqueta si la tiene y un botón para cambiarla. Primero se ofrecen las etiquetas del
 * contacto; si eliges otra, se añade también al contacto.
 */
export function ItemTag({ contactId, itemId, current, contactTags }: { contactId: string; itemId?: string; current?: TagLite; contactTags: TagLite[] }) {
  const withPath = useTagPath();
  const qc = useQueryClient();
  const { data: all } = useTags();
  const [open, setOpen] = useState(false);
  const save = useMutation({
    mutationFn: (tagId: string | null) => api.put(`/contacts/${contactId}/items/${itemId}/tag`, { tagId }),
    onSuccess: () => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["contact", contactId] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });
  if (!itemId) return null;
  const inContact = new Set(contactTags.map((t) => t.id));
  const others = (all ?? []).filter((t) => !inContact.has(t.id));

  return (
    <span className="relative inline-flex items-center gap-1 align-middle">
      {current && <TagChip tag={withPath(current)} small />}
      <button
        type="button"
        className="inline-flex h-6 items-center gap-0.5 rounded-md px-1 text-sm leading-none text-slate-400 hover:bg-slate-100 hover:text-indigo-700"
        onClick={() => setOpen(!open)}
        title={current ? "Cambiar la etiqueta de este dato" : "Asociar este dato a una etiqueta"}
        aria-label="Etiqueta de este dato"
      >
        <span className="text-[15px] leading-none">🏷️</span>
        {!current && <span className="text-base font-medium leading-none">+</span>}
      </button>
      {open && <span className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}
      {open && (
        <span className="absolute left-0 top-full z-20 mt-1 block w-60 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-lg">
          <span className="mb-1 block text-[11px] text-slate-500">Asociar a la etiqueta:</span>
          <span className="flex flex-wrap gap-1">
            {contactTags.map((t) => (
              <TagChip key={t.id} tag={withPath(t)} active={current?.id === t.id} onClick={() => save.mutate(t.id)} />
            ))}
            {!contactTags.length && <span className="text-xs text-slate-400">El contacto no tiene etiquetas.</span>}
          </span>
          {others.length > 0 && (
            <>
              <span className="mb-1 mt-2 block text-[11px] text-slate-500">Otras (se añadirán también al contacto):</span>
              <span className="-m-0.5 flex max-h-32 flex-wrap gap-1 overflow-y-auto p-0.5">
                {others.map((t) => <TagChip key={t.id} tag={withPath(t)} onClick={() => save.mutate(t.id)} />)}
              </span>
            </>
          )}
          {current && (
            <button type="button" className="mt-2 block w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50" onClick={() => save.mutate(null)}>
              Quitar etiqueta (dato general)
            </button>
          )}
        </span>
      )}
    </span>
  );
}
