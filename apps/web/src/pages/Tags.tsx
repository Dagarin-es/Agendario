import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import type { Tag, TagColor } from "@agendario/shared";
import { ColorPicker, TagChip, useTags } from "../components/Tags";
import { api } from "../lib/api";
import { useAlert, useConfirm } from "../components/Dialogs";

export function TagsPage() {
  const qc = useQueryClient();
  const { data: tags } = useTags();
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("teal");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; color: TagColor }>({ name: "", color: "teal" });
  const confirm = useConfirm();
  const showAlert = useAlert();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tags"] });
    qc.invalidateQueries({ queryKey: ["contacts"] });
    qc.invalidateQueries({ queryKey: ["contact"] });
  };

  const create = useMutation({
    mutationFn: () => api.post("/tags", { name, color }),
    onSuccess: () => { setName(""); refresh(); },
    onError: (e) => showAlert("No se ha podido crear la etiqueta", (e as Error).message),
  });
  const update = useMutation({
    mutationFn: (id: string) => api.patch(`/tags/${id}`, draft),
    onSuccess: () => { setEditing(null); refresh(); },
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });
  const remove = useMutation({
    mutationFn: ({ id, withContacts }: { id: string; withContacts: boolean }) =>
      api.del<{ deletedContacts: number }>(`/tags/${id}${withContacts ? "?withContacts=true" : ""}`),
    onSuccess: (r) => {
      refresh();
      if (r?.deletedContacts) showAlert("Etiqueta y contactos borrados", `Se han borrado ${r.deletedContacts} contactos.`);
    },
  });

  async function askDelete(t: Tag) {
    if (!(await confirm({ title: `¿Borrar la etiqueta «${t.name}»?`, message: "Los contactos no se borran, solo se les quita la etiqueta.", confirmText: "Borrar etiqueta", danger: true }))) return;
    remove.mutate({ id: t.id, withContacts: false });
  }
  async function askDeleteWithContacts(t: Tag) {
    const ok = await confirm({
      title: `¿Borrar «${t.name}» y sus ${t.contactCount} contactos?`,
      message: <>Solo se borran los contactos que son tuyos (no los que te han compartido). <strong>Irán a la papelera: podrás restaurarlos durante 60 días.</strong></>,
      confirmText: `Borrar ${t.contactCount} contactos`,
      danger: true,
    });
    if (!ok) return;
    remove.mutate({ id: t.id, withContacts: true });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Etiquetas</h1>
      <p className="text-sm text-slate-500">Las etiquetas son personales: puedes ponerlas también en contactos que te han compartido y nadie más las verá.</p>

      <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
        <div className="flex gap-2">
          <input className="input" placeholder="Nueva etiqueta (p. ej. Familia, Trabajo, Proveedores…)" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary shrink-0" disabled={!name.trim()}>Crear</button>
        </div>
        <ColorPicker value={color} onChange={setColor} />
      </form>

      {tags?.length === 0 && <div className="card text-center text-slate-500">Todavía no tienes etiquetas.</div>}
      <ul className="space-y-2">
        {tags?.map((t) => (
          <li key={t.id} className="card">
            {editing === t.id ? (
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); update.mutate(t.id); }}>
                <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
                <ColorPicker value={draft.color} onChange={(c) => setDraft({ ...draft, color: c })} />
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancelar</button>
                  <button className="btn-primary">Guardar</button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/?tag=${t.id}`} className="flex-1"><TagChip tag={t} /> <span className="ml-1 text-sm text-slate-500">{t.contactCount} contactos</span></Link>
                {t.contactCount > 0 && (
                  <a className="btn-ghost" href={`/api/export/contacts.vcf?tag=${t.id}`} title="Exporta sus contactos con los teléfonos, emails y direcciones de esta etiqueta">⤒ Exportar</a>
                )}
                <button className="btn-ghost" onClick={() => { setEditing(t.id); setDraft({ name: t.name, color: t.color }); }}>Editar</button>
                <button className="btn-danger" onClick={() => askDelete(t)}>Borrar</button>
                {t.contactCount > 0 && (
                  <button className="btn-danger text-xs" onClick={() => askDeleteWithContacts(t)} title="Útil para deshacer una importación de prueba">
                    Borrar con contactos
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
