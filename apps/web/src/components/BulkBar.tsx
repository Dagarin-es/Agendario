import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { BulkResult, Tag, TagLite } from "@agendario/shared";
import { api, downloadPost } from "../lib/api";
import { useConfirm } from "./Dialogs";
import { TagChip, tagTree, useTags } from "./Tags";

type Panel = null | "export" | "add" | "remove";

/**
 * Acciones para los contactos seleccionados (exportar, añadir/quitar etiqueta, borrar).
 * Se muestran en la misma fila que la casilla de «seleccionar todos».
 * `notMine` = cuántos de los seleccionados te los han compartido (no se pueden borrar).
 */
export function useBulkActions({
  ids, notMine, onClear, onMessage, filterTag, onCombine,
}: { ids: string[]; notMine: number; onClear: () => void; onMessage: (t: string) => void; filterTag?: TagLite; onCombine?: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: tags } = useTags();
  const [panel, setPanel] = useState<Panel>(null);
  const [withGifts, setWithGifts] = useState(false);
  const [onlyTagData, setOnlyTagData] = useState(true);
  const [newTag, setNewTag] = useState("");
  const [newParent, setNewParent] = useState("");
  const n = ids.length;

  const refresh = () => {
    for (const k of ["contacts", "contact", "tags", "duplicates", "upcoming"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const done = (text: string, clear = false) => {
    setPanel(null);
    onMessage(text);
    refresh();
    if (clear) onClear();
  };
  const fail = (e: unknown) => onMessage((e as Error).message);

  const tagOp = useMutation({
    mutationFn: ({ tagId, op }: { tagId: string; op: "add" | "remove" }) => api.post<BulkResult>("/contacts/bulk/tags", { ids, tagId, op }),
    onSuccess: (r, v) => {
      const name = tagTree(tags).find((n) => n.tag.id === v.tagId)?.path ?? "";
      done(v.op === "add" ? `Etiqueta «${name}» añadida a ${r.affected} contactos` : `Etiqueta «${name}» quitada de ${r.affected} contactos`);
    },
    onError: fail,
  });
  const createAndAdd = useMutation({
    mutationFn: async () => (await api.post<Tag>("/tags", { name: newTag.trim(), color: "violet", parentId: newParent || null })).id,
    onSuccess: async (tagId) => {
      setNewTag("");
      await qc.invalidateQueries({ queryKey: ["tags"] });
      tagOp.mutate({ tagId, op: "add" });
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => api.post<BulkResult>("/contacts/bulk/delete", { ids }),
    onSuccess: (r) => done(`${r.affected} contactos borrados${r.skipped ? ` · ${r.skipped} no eran tuyos y no se han tocado` : ""}`, true),
    onError: fail,
  });
  const exp = useMutation({
    mutationFn: () =>
      downloadPost("/export/selection.vcf", { ids, gifts: withGifts, tagId: filterTag && onlyTagData ? filterTag.id : undefined }, "contactos-seleccion.vcf"),
    onSuccess: () => done(`${n} contactos exportados`),
    onError: fail,
  });

  async function askDelete() {
    const mine = n - notMine;
    if (mine === 0) {
      await confirm({ title: "No se puede borrar", message: "Ninguno de los seleccionados es tuyo: los contactos que te han compartido no se pueden borrar.", alert: true });
      return;
    }
    const ok = await confirm({
      title: `¿Borrar ${mine} ${mine === 1 ? "contacto" : "contactos"}?`,
      message: (
        <>
          Irán a la papelera con sus fotos, ideas de regalo y fechas: <strong>podrás restaurarlos durante 60 días.</strong>
          {notMine > 0 && <span className="mt-2 block text-slate-500">{notMine} de los seleccionados te los han compartido y no se borrarán.</span>}
        </>
      ),
      confirmText: `Borrar ${mine}`,
      danger: true,
    });
    if (ok) remove.mutate();
  }

  const busy = tagOp.isPending || remove.isPending || exp.isPending || createAndAdd.isPending;
  const btn = (active: boolean) =>
    `btn flex-col gap-0 px-2 py-1 text-[11px] leading-tight sm:flex-row sm:gap-1.5 sm:px-2.5 sm:text-sm ${active ? "bg-indigo-100 text-indigo-900" : "text-slate-700 hover:bg-slate-100"}`;
  const toggle = (p: Panel) => setPanel(panel === p ? null : p);

  const buttons = (
    <div className="flex items-center gap-0.5 sm:gap-1">
      {n === 2 && onCombine && (
        <button
          className={`${btn(false)} text-indigo-800`}
          disabled={busy || notMine > 0}
          onClick={onCombine}
          title={notMine > 0 ? "Solo se pueden combinar contactos que son tuyos" : "Combinar estos dos contactos eligiendo qué se queda"}
        >
          <span className="text-base leading-none">🔗</span>Combinar
        </button>
      )}
      <button className={btn(panel === "export")} disabled={busy} onClick={() => toggle("export")}><span className="text-base leading-none">⤒</span>Exportar</button>
      <button className={btn(panel === "add")} disabled={busy} onClick={() => toggle("add")}><span className="text-base leading-none">🏷️</span>+ Etiqueta</button>
      <button className={btn(panel === "remove")} disabled={busy} onClick={() => toggle("remove")}><span className="text-base leading-none">🏷️</span>− Etiqueta</button>
      <button className={`${btn(false)} text-red-700 hover:bg-red-50`} disabled={busy} onClick={askDelete}><span className="text-base leading-none">🗑️</span>Borrar</button>
    </div>
  );

  const panelView = panel && (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      {panel === "export" && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={withGifts} onChange={(e) => setWithGifts(e.target.checked)} />
            Incluir mis ideas de regalo
          </label>
          {filterTag && (
            <label className="flex items-center gap-2" title="Teléfonos, emails y direcciones asociados a esa etiqueta (o los generales si no tiene)">
              <input type="checkbox" checked={onlyTagData} onChange={(e) => setOnlyTagData(e.target.checked)} />
              Solo los datos de «{filterTag.name}»
            </label>
          )}
          <button className="btn-primary ml-auto" disabled={busy} onClick={() => exp.mutate()}>
            {exp.isPending ? "Preparando…" : `Descargar .vcf (${n})`}
          </button>
        </div>
      )}
      {(panel === "add" || panel === "remove") && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            {panel === "add" ? `Elige la etiqueta que quieres añadir a los ${n} contactos:` : `Elige la etiqueta que quieres quitar de los ${n} contactos:`}
          </p>
          <div className="-m-1 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto p-1">
            {tagTree(tags).map((n) => <TagChip key={n.tag.id} tag={{ ...n.tag, name: n.path }} onClick={() => !busy && tagOp.mutate({ tagId: n.tag.id, op: panel })} />)}
            {!tags?.length && <span className="text-xs text-slate-400">Todavía no tienes etiquetas.</span>}
          </div>
          {panel === "add" && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newTag.trim()) createAndAdd.mutate(); }}>
              <input className="input py-1.5" placeholder="O crea una nueva…" value={newTag} onChange={(e) => setNewTag(e.target.value)} />
              <select className="input w-auto max-w-[45%] py-1.5 text-sm" value={newParent} onChange={(e) => setNewParent(e.target.value)} aria-label="Dentro de">
                <option value="">Nivel principal</option>
                {tagTree(tags).map((n) => <option key={n.tag.id} value={n.tag.id}>Dentro de {n.path}</option>)}
              </select>
              <button className="btn-primary shrink-0 py-1.5" disabled={!newTag.trim() || busy}>Crear y añadir</button>
            </form>
          )}
        </div>
      )}
    </div>
  );

  return { buttons, panelView, closePanel: () => setPanel(null) };
}
