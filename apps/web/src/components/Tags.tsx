import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { tagColors, type Tag, type TagColor, type TagLite } from "@agendario/shared";
import { api } from "../lib/api";
import { useAlert } from "./Dialogs";

// Clases completas (Tailwind solo genera las que ve escritas).
export const tagColorClasses: Record<TagColor, { chip: string; dot: string }> = {
  slate: { chip: "bg-slate-100 text-slate-700 ring-slate-300", dot: "bg-slate-500" },
  red: { chip: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500" },
  orange: { chip: "bg-orange-50 text-orange-700 ring-orange-200", dot: "bg-orange-500" },
  amber: { chip: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  green: { chip: "bg-green-50 text-green-700 ring-green-200", dot: "bg-green-500" },
  teal: { chip: "bg-indigo-50 text-indigo-700 ring-indigo-200", dot: "bg-indigo-500" },
  sky: { chip: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500" },
  blue: { chip: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-blue-500" },
  violet: { chip: "bg-violet-50 text-violet-700 ring-violet-200", dot: "bg-violet-500" },
  pink: { chip: "bg-pink-50 text-pink-700 ring-pink-200", dot: "bg-pink-500" },
};

export function TagChip({
  tag, onRemove, active, onClick, small,
}: { tag: TagLite; onRemove?: () => void; active?: boolean; onClick?: () => void; small?: boolean }) {
  const c = tagColorClasses[tag.color];
  const base = `inline-flex shrink-0 items-center gap-1 rounded-full ring-1 font-medium ${small ? "px-1.5 py-px text-[11px]" : "px-2.5 py-1 text-xs"}`;
  const cls = active ? `${base} bg-indigo-700 text-white ring-indigo-700` : `${base} ${c.chip}`;
  const content = (
    <>
      {!active && <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />}
      {tag.name}
      {onRemove && (
        <button type="button" className="-mr-1 ml-0.5 rounded-full px-1 hover:bg-black/10" onClick={onRemove} aria-label={`Quitar ${tag.name}`}>
          ×
        </button>
      )}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>{content}</button>
  ) : (
    <span className={cls}>{content}</span>
  );
}

export function useTags() {
  return useQuery({ queryKey: ["tags"], queryFn: () => api.get<Tag[]>("/tags") });
}

export function ColorPicker({ value, onChange }: { value: TagColor; onChange: (c: TagColor) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tagColors.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`h-6 w-6 rounded-full ${tagColorClasses[c].dot} ${value === c ? "ring-2 ring-slate-900 ring-offset-2" : ""}`}
          aria-label={c}
        />
      ))}
    </div>
  );
}

/** Editor de etiquetas de un contacto (las etiquetas son personales). */
export function ContactTags({ contactId, tags }: { contactId: string; tags: TagLite[] }) {
  const qc = useQueryClient();
  const { data: all } = useTags();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const showAlert = useAlert();

  const save = useMutation({
    mutationFn: (tagIds: string[]) => api.put(`/contacts/${contactId}/tags`, { tagIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact", contactId] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });
  const create = useMutation({
    mutationFn: (name: string) => api.post<Tag>("/tags", { name }),
    onSuccess: (t) => {
      setNewName("");
      save.mutate([...tags.map((x) => x.id), t.id]);
    },
    onError: (e) => showAlert("No se ha podido crear", (e as Error).message),
  });

  const current = new Set(tags.map((t) => t.id));
  const available = (all ?? []).filter((t) => !current.has(t.id));

  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {tags.map((t) => (
        <TagChip key={t.id} tag={t} onRemove={() => save.mutate(tags.filter((x) => x.id !== t.id).map((x) => x.id))} />
      ))}
      {!adding ? (
        <button className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs text-slate-500 hover:border-indigo-500 hover:text-indigo-700" onClick={() => setAdding(true)}>
          + Etiqueta
        </button>
      ) : (
        <div className="mt-2 w-full space-y-2 rounded-lg bg-slate-50 p-3 text-left">
          {available.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {available.map((t) => (
                <TagChip key={t.id} tag={t} onClick={() => save.mutate([...current, t.id])} />
              ))}
            </div>
          )}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) create.mutate(newName.trim()); }}>
            <input className="input" placeholder="Nueva etiqueta…" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="btn-primary shrink-0" disabled={!newName.trim()}>Crear</button>
            <button type="button" className="btn-ghost shrink-0" onClick={() => setAdding(false)}>Listo</button>
          </form>
          <p className="text-[11px] text-slate-400">Tus etiquetas son personales: nadie más las ve.</p>
        </div>
      )}
    </div>
  );
}
