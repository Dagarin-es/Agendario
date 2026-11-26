import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import type { GmailStatus, Tag, TagColor } from "@agendario/shared";
import { ColorPicker, descendantIds, TagChip, tagTree, useTags } from "../components/Tags";
import { api, apiUrl } from "../lib/api";
import { useAlert, useConfirm } from "../components/Dialogs";

export function TagsPage() {
  const qc = useQueryClient();
  const { data: tags } = useTags();
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("teal");
  const [parent, setParent] = useState("");
  const tree = tagTree(tags);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; color: TagColor }>({ name: "", color: "teal" });
  const confirm = useConfirm();
  const showAlert = useAlert();
  // «Sincronizar con Gmail» en cada etiqueta, por cada cuenta de Google (las subetiquetas entran solas)
  const { data: gmail } = useQuery({ queryKey: ["gmail"], queryFn: () => api.get<GmailStatus>("/gmail") });
  const gmailAccounts = gmail?.accounts ?? [];
  const setGmail = useMutation({
    mutationFn: ({ tagId, accountIds }: { tagId: string; accountIds: string[] }) => api.put<GmailStatus>(`/gmail/tag/${tagId}`, { accountIds }),
    onSuccess: (st) => qc.setQueryData(["gmail"], st),
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });
  const toggleGmail = (tagId: string, accId: string, on: boolean) => {
    const accountIds = gmailAccounts.filter((a) => (a.id === accId ? on : a.tagIds.includes(tagId))).map((a) => a.id);
    setGmail.mutate({ tagId, accountIds });
  };
  const gmailInherited = (t: Tag, set: Set<string>): Tag | undefined => {
    let p = t.parentId ? tags?.find((x) => x.id === t.parentId) : undefined;
    for (let i = 0; p && i < 10; i++) {
      if (set.has(p.id)) return p;
      p = p.parentId ? tags?.find((x) => x.id === p!.parentId) : undefined;
    }
    return undefined;
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tags"] });
    qc.invalidateQueries({ queryKey: ["contacts"] });
    qc.invalidateQueries({ queryKey: ["contact"] });
  };

  const create = useMutation({
    mutationFn: () => api.post("/tags", { name, color, parentId: parent || null }),
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

  const reorder = useMutation({
    mutationFn: (items: { id: string; parentId: string | null; position: number }[]) => api.put("/tags/order", { items }),
    onSuccess: refresh,
    onError: (e) => showAlert("No se ha podido mover", (e as Error).message),
  });

  /** Recalcula posiciones con un cambio (subir/bajar o cambiar de madre) y envía el árbol. */
  function applyMove(id: string, change: { delta?: number; parentId?: string | null }) {
    if (!tags) return;
    const parentOf = new Map(tags.map((t) => [t.id, t.parentId]));
    if (change.parentId !== undefined) parentOf.set(id, change.parentId);
    const siblings = new Map<string | null, string[]>();
    for (const n of tree) {
      const p = parentOf.get(n.tag.id) ?? null;
      if (n.tag.id === id && change.parentId !== undefined) continue; // va al final de su nueva madre
      siblings.set(p, [...(siblings.get(p) ?? []), n.tag.id]);
    }
    if (change.parentId !== undefined) siblings.set(change.parentId, [...(siblings.get(change.parentId) ?? []), id]);
    if (change.delta) {
      const list = siblings.get(parentOf.get(id) ?? null)!;
      const i = list.indexOf(id);
      const j = i + change.delta;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    const items = [...siblings.entries()].flatMap(([p, list]) => list.map((tid, position) => ({ id: tid, parentId: p, position })));
    reorder.mutate(items);
  }

  async function askDelete(t: Tag) {
    const hasKids = tags?.some((x) => x.parentId === t.id);
    if (!(await confirm({ title: `¿Borrar la etiqueta «${t.name}»?`, message: `Los contactos no se borran, solo se les quita la etiqueta.${hasKids ? " Sus subetiquetas suben un nivel." : ""}`, confirmText: "Borrar etiqueta", danger: true }))) return;
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
      <h1 className="page-title text-lg font-semibold">Etiquetas</h1>
      <p className="text-sm text-slate-500">Las etiquetas son personales: puedes ponerlas también en contactos que te han compartido y nadie más las verá.</p>

      <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
        <div className="flex gap-2">
          <input className="input" placeholder="Nueva etiqueta (p. ej. Familia, Trabajo, Proveedores…)" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary shrink-0" disabled={!name.trim()}>Crear</button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ColorPicker value={color} onChange={setColor} />
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            Dentro de
            <select className="input w-auto py-1 text-sm" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">(ninguna: nivel principal)</option>
              {tree.map((n) => <option key={n.tag.id} value={n.tag.id}>{"  ".repeat(n.depth)}{n.path}</option>)}
            </select>
          </label>
        </div>
      </form>
      {tree.length > 1 && <p className="text-xs text-slate-500">Usa ↑ ↓ para ordenarlas y «Mover a» para meter una etiqueta dentro de otra. Filtrar o sincronizar una etiqueta incluye sus subetiquetas.</p>}

      {gmailAccounts.some((a) => a.tagIds.length > 0 && !a.connected) && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Hay etiquetas marcadas para una cuenta de Google que no está conectada: <Link to="/settings?tab=sync" className="font-medium underline">Ajustes → Sincronización</Link>.
        </p>
      )}
      {tags?.length === 0 && <div className="card text-center text-slate-500">Todavía no tienes etiquetas.</div>}
      <ul className="space-y-2">
        {tree.map(({ tag: t, depth, childCount }) => {
          const sibs = tree.filter((n) => (n.tag.parentId ?? null) === (t.parentId ?? null));
          const idx = sibs.findIndex((n) => n.tag.id === t.id);
          const blocked = descendantIds(tags, t.id);
          return (
          <li key={t.id} className="card py-3" style={{ marginLeft: `${Math.min(depth, 4) * 1}rem` }}>
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
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex shrink-0 flex-col">
                    <button className="px-1 text-xs leading-none text-slate-500 hover:text-indigo-700 disabled:opacity-20" disabled={idx <= 0} onClick={() => applyMove(t.id, { delta: -1 })} aria-label="Subir">▲</button>
                    <button className="px-1 text-xs leading-none text-slate-500 hover:text-indigo-700 disabled:opacity-20" disabled={idx >= sibs.length - 1} onClick={() => applyMove(t.id, { delta: 1 })} aria-label="Bajar">▼</button>
                  </div>
                  {depth > 0 && <span className="text-slate-300">└</span>}
                  <Link to={`/?tag=${t.id}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <TagChip tag={t} />
                    <span className="whitespace-nowrap text-xs text-slate-500">
                      {t.contactCount} {t.contactCount === 1 ? "contacto" : "contactos"}
                      {childCount > 0 && t.totalCount !== t.contactCount ? ` · ${t.totalCount} con subetiquetas` : ""}
                    </span>
                  </Link>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pl-7">
                  <select className="input w-auto py-1 text-xs" value="" onChange={(e) => e.target.value && applyMove(t.id, { parentId: e.target.value === "__root" ? null : e.target.value })} aria-label="Mover a">
                    <option value="">Mover a…</option>
                    {t.parentId && <option value="__root">Nivel principal</option>}
                    {tree.filter((n) => !blocked.has(n.tag.id) && n.tag.id !== t.parentId).map((n) => <option key={n.tag.id} value={n.tag.id}>Dentro de {n.path}</option>)}
                  </select>
                  {t.contactCount > 0 && (
                    <a className="btn-ghost px-2 py-1 text-xs" href={apiUrl(`/export/contacts.vcf?tag=${t.id}`)} title="Exporta sus contactos con los teléfonos, emails y direcciones de esta etiqueta">⤒ Exportar</a>
                  )}
                  {gmailAccounts.map((acc) => {
                    const set = new Set(acc.tagIds);
                    const via = gmailInherited(t, set);
                    const on = set.has(t.id) || !!via;
                    const name = gmailAccounts.length === 1 ? "Sincronizar con Gmail" : `Gmail: ${acc.email ?? "cuenta sin conectar"}`;
                    return (
                      <label key={acc.id} className={`flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${on ? "border-sky-200 bg-sky-50 text-sky-900" : "border-slate-200 text-slate-600"}`} title={via ? `Ya entra por «${via.name}»` : `Envía sus contactos a ${acc.email ?? "esta cuenta de Google"} (para verlos en Outlook)`}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!!via || setGmail.isPending}
                          onChange={(e) => toggleGmail(t.id, acc.id, e.target.checked)}
                        />
                        <span className="truncate">{name}{via ? ` (por ${via.name})` : ""}</span>
                      </label>
                    );
                  })}
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { setEditing(t.id); setDraft({ name: t.name, color: t.color }); }}>Editar</button>
                  <button className="btn-danger px-2 py-1 text-xs" onClick={() => askDelete(t)}>Borrar</button>
                  {t.contactCount > 0 && (
                    <button className="btn-danger px-2 py-1 text-xs" onClick={() => askDeleteWithContacts(t)} title="Útil para deshacer una importación de prueba">
                      Borrar con contactos
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
          );
        })}
      </ul>
    </div>
  );
}
