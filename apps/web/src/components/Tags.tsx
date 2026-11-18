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

export type TagNode = { tag: Tag; depth: number; path: string; childCount: number };

/** Etiquetas en árbol, aplanadas en orden (madre seguida de sus subetiquetas). */
export function tagTree(tags: Tag[] | undefined): TagNode[] {
  if (!tags) return [];
  const ids = new Set(tags.map((t) => t.id));
  const kids = new Map<string | null, Tag[]>();
  for (const t of tags) {
    const p = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    kids.set(p, [...(kids.get(p) ?? []), t]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "es"));
  const out: TagNode[] = [];
  const walk = (parent: string | null, depth: number, prefix: string, seen: Set<string>) => {
    for (const t of kids.get(parent) ?? []) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const path = prefix ? `${prefix} › ${t.name}` : t.name;
      out.push({ tag: t, depth, path, childCount: kids.get(t.id)?.length ?? 0 });
      walk(t.id, depth + 1, path, seen);
    }
  };
  walk(null, 0, "", new Set());
  return out;
}

/** Ruta legible de cada etiqueta («Raíz › Sub»). */
export function useTagPath() {
  const { data } = useTags();
  const map = new Map(tagTree(data).map((n) => [n.tag.id, n.path]));
  return <T extends TagLite>(t: T): T => ({ ...t, name: map.get(t.id) ?? t.name });
}

/** Ids de una etiqueta y todas sus subetiquetas. */
export function descendantIds(tags: Tag[] | undefined, id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of tags ?? []) if (t.parentId && out.has(t.parentId) && !out.has(t.id)) { out.add(t.id); grew = true; }
  }
  return out;
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

/** Editor de etiquetas de un contacto (las etiquetas son personales). Se guarda al momento. */
export function ContactTags({ contactId, tags, align = "center" }: { contactId: string; tags: TagLite[]; align?: "center" | "start" }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (tagIds: string[]) => api.put(`/contacts/${contactId}/tags`, { tagIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact", contactId] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });
  return <TagEditor tags={tags} align={align} onChange={(next) => save.mutate(next.map((t) => t.id))} />;
}

/** Selector de etiquetas controlado: no guarda nada, avisa con onChange (lo usa también el formulario). */
export function TagEditor({ tags, onChange, align = "center" }: { tags: TagLite[]; onChange: (tags: TagLite[]) => void; align?: "center" | "start" }) {
  const qc = useQueryClient();
  const { data: all } = useTags();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const showAlert = useAlert();

  const create = useMutation({
    mutationFn: (name: string) => api.post<Tag>("/tags", { name }),
    onSuccess: (t) => {
      setNewName("");
      qc.invalidateQueries({ queryKey: ["tags"] });
      onChange([...tags, t]);
    },
    onError: (e) => showAlert("No se ha podido crear", (e as Error).message),
  });

  const current = new Set(tags.map((t) => t.id));
  const tree = tagTree(all);
  const pathOf = new Map(tree.map((n) => [n.tag.id, n.path]));
  const available = tree.filter((n) => !current.has(n.tag.id)).map((n) => ({ ...n.tag, name: n.path }));

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${align === "center" ? "justify-center" : "justify-start"}`}>
      {tags.map((t) => (
        <TagChip key={t.id} tag={{ ...t, name: pathOf.get(t.id) ?? t.name }} onRemove={() => onChange(tags.filter((x) => x.id !== t.id))} />
      ))}
      {!adding ? (
        <button type="button" className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs text-slate-500 hover:border-indigo-500 hover:text-indigo-700" onClick={() => setAdding(true)}>
          + Etiqueta
        </button>
      ) : (
        <div className="mt-2 w-full space-y-2 rounded-lg bg-slate-50 p-3 text-left">
          {available.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {available.map((t) => (
                <TagChip key={t.id} tag={t} onClick={() => onChange([...tags, (all ?? []).find((x) => x.id === t.id)!])} />
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Nueva etiqueta…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newName.trim()) create.mutate(newName.trim()); } }}
            />
            <button type="button" className="btn-primary shrink-0" disabled={!newName.trim()} onClick={() => create.mutate(newName.trim())}>Crear</button>
            <button type="button" className="btn-ghost shrink-0" onClick={() => setAdding(false)}>Listo</button>
          </div>
          <p className="text-[11px] text-slate-400">Tus etiquetas son personales: nadie más las ve.</p>
        </div>
      )}
    </div>
  );
}
