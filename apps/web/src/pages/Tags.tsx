/**
 * Gestión de etiquetas (1.4).
 * - Pantalla ancha (web, Fold abierto): árbol a la izquierda y panel con la etiqueta elegida a la derecha.
 * - Móvil: filas grandes y una hoja inferior con las opciones de cada etiqueta.
 * En los dos: se arrastra por el asa ⠿ (o con pulsación larga en el móvil) para ordenar, meter una
 * etiqueta dentro de otra (soltar encima) o sacarla al nivel principal (zona de abajo).
 */
import { Chevron } from "../components/Chevron";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import type { GmailStatus, Tag, TagColor } from "@agendario/shared";
import { ColorPicker, descendantIds, tagColorClasses, tagTree, useTags, type TagNode } from "../components/Tags";
import { api, apiUrl } from "../lib/api";
import { Modal, useAlert, useConfirm } from "../components/Dialogs";
import { GmailLogo } from "../components/BrandIcons";
import { haptic } from "../lib/native";
import { keepInView } from "../lib/keepInView";

type Drop = { id: string; zone: "before" | "after" | "inside" } | { root: true } | null;

function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [q]);
  return m;
}

const COLLAPSED_KEY = "agendario-etiquetas-plegadas";
const loadCollapsed = () => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
  } catch {
    return new Set<string>();
  }
};

const countLabel = (n: number) => `${n} ${n === 1 ? "contacto" : "contactos"}`;

/** Todo lo que comparten las dos versiones: datos, guardado, movimientos y Gmail. */
function useTagsModel() {
  const qc = useQueryClient();
  const { data: tags } = useTags();
  const tree = useMemo(() => tagTree(tags), [tags]);
  const showAlert = useAlert();
  const confirm = useConfirm();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tags"] });
    qc.invalidateQueries({ queryKey: ["contacts"] });
    qc.invalidateQueries({ queryKey: ["contact"] });
  };
  const fail = (title: string) => (e: unknown) => showAlert(title, (e as Error).message);

  // «Sincronizar con Gmail» por etiqueta y cuenta (las subetiquetas entran solas)
  const { data: gmail } = useQuery({ queryKey: ["gmail"], queryFn: () => api.get<GmailStatus>("/gmail") });
  const accounts = gmail?.accounts ?? [];
  const setGmail = useMutation({
    mutationFn: ({ tagId, accountIds }: { tagId: string; accountIds: string[] }) => api.put<GmailStatus>(`/gmail/tag/${tagId}`, { accountIds }),
    onSuccess: (st) => qc.setQueryData(["gmail"], st),
    onError: fail("No se ha podido guardar"),
  });
  const toggleGmail = (tagId: string, accId: string, on: boolean) => {
    const accountIds = accounts.filter((a) => (a.id === accId ? on : a.tagIds.includes(tagId))).map((a) => a.id);
    setGmail.mutate({ tagId, accountIds });
  };
  /** Etiqueta madre por la que ya entra en esa cuenta (si la hay). */
  const inheritedFrom = (t: Tag, accTagIds: string[]): Tag | undefined => {
    const set = new Set(accTagIds);
    let p = t.parentId ? tags?.find((x) => x.id === t.parentId) : undefined;
    for (let i = 0; p && i < 10; i++) {
      if (set.has(p.id)) return p;
      p = p.parentId ? tags?.find((x) => x.id === p!.parentId) : undefined;
    }
    return undefined;
  };

  const create = useMutation({
    mutationFn: (v: { name: string; color: TagColor; parentId: string | null }) => api.post<Tag>("/tags", v),
    onSuccess: refresh,
    onError: fail("No se ha podido crear la etiqueta"),
  });
  const update = useMutation({
    mutationFn: ({ id, ...v }: { id: string; name: string; color: TagColor }) => api.patch(`/tags/${id}`, v),
    onSuccess: refresh,
    onError: fail("No se ha podido guardar"),
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
    onMutate: (items) => {
      // Se ve al momento; si falla, se recarga lo del servidor
      qc.setQueryData<Tag[]>(["tags"], (old) => old?.map((t) => {
        const it = items.find((x) => x.id === t.id);
        return it ? { ...t, parentId: it.parentId, position: it.position } : t;
      }));
    },
    onSuccess: refresh,
    onError: (e) => { refresh(); fail("No se ha podido mover")(e); },
  });

  /** Coloca una etiqueta dentro de `parentId` en la posición `index` (sin contarse a sí misma) y envía el árbol. */
  function moveTo(id: string, parentId: string | null, index?: number) {
    if (!tags) return;
    if (parentId && descendantIds(tags, id).has(parentId)) return; // no dentro de sí misma
    const siblings = new Map<string | null, string[]>();
    for (const n of tree) {
      if (n.tag.id === id) continue;
      const p = n.tag.parentId ?? null;
      siblings.set(p, [...(siblings.get(p) ?? []), n.tag.id]);
    }
    const list = siblings.get(parentId) ?? [];
    list.splice(index === undefined ? list.length : Math.max(0, Math.min(index, list.length)), 0, id);
    siblings.set(parentId, list);
    const items = [...siblings.entries()].flatMap(([p, l]) => l.map((tid, position) => ({ id: tid, parentId: p, position })));
    void haptic();
    reorder.mutate(items);
  }

  /** Aplica lo soltado al arrastrar. */
  function applyDrop(dragId: string, drop: Drop) {
    if (!drop || !tags) return;
    if ("root" in drop) return moveTo(dragId, null);
    const target = tags.find((t) => t.id === drop.id);
    if (!target || target.id === dragId) return;
    if (drop.zone === "inside") return moveTo(dragId, target.id);
    const p = target.parentId ?? null;
    const sibs = tree.filter((n) => (n.tag.parentId ?? null) === p && n.tag.id !== dragId).map((n) => n.tag.id);
    const i = sibs.indexOf(target.id);
    moveTo(dragId, p, drop.zone === "before" ? i : i + 1);
  }

  async function askDelete(t: Tag) {
    const hasKids = tags?.some((x) => x.parentId === t.id);
    if (!(await confirm({ title: `¿Borrar la etiqueta «${t.name}»?`, message: `Los contactos no se borran, solo se les quita la etiqueta.${hasKids ? " Sus subetiquetas suben un nivel." : ""}`, confirmText: "Borrar etiqueta", danger: true }))) return false;
    remove.mutate({ id: t.id, withContacts: false });
    return true;
  }
  async function askDeleteWithContacts(t: Tag) {
    const ok = await confirm({
      title: `¿Borrar «${t.name}» y sus ${t.contactCount} contactos?`,
      message: <><strong>Irán a la papelera: podrás restaurarlos durante 60 días.</strong></>,
      confirmText: `Borrar ${t.contactCount} contactos`,
      danger: true,
    });
    if (!ok) return false;
    remove.mutate({ id: t.id, withContacts: true });
    return true;
  }

  return { tags, tree, accounts, toggleGmail, inheritedFrom, setGmailPending: setGmail.isPending, create, update, moveTo, applyDrop, askDelete, askDeleteWithContacts };
}
type Model = ReturnType<typeof useTagsModel>;

/**
 * Arrastrar con ratón o dedo. Se empieza en el asa (al momento) o con pulsación larga en la fila (móvil).
 * Soltar en el tercio central de una fila = meter dentro; arriba/abajo = antes/después; en la zona final = nivel principal.
 */
function useTreeDrag(tags: Tag[] | undefined, onDrop: (id: string, drop: Drop) => void) {
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; drop: Drop } | null>(null);
  const ref = useRef(drag);
  ref.current = drag;
  const lastEnd = useRef(0);
  const blocked = useMemo(() => (drag && tags ? descendantIds(tags, drag.id) : new Set<string>()), [drag?.id, tags]); // eslint-disable-line react-hooks/exhaustive-deps

  const targetAt = useCallback((x: number, y: number): Drop => {
    const el = document.elementFromPoint(x, y);
    if (el?.closest("[data-tag-root]")) return { root: true };
    const row = el?.closest<HTMLElement>("[data-tag-id]");
    if (!row) return null;
    const id = row.dataset.tagId!;
    if (blocked.has(id)) return null;
    const r = row.getBoundingClientRect();
    const f = (y - r.top) / r.height;
    return { id, zone: f < 0.28 ? "before" : f > 0.72 ? "after" : "inside" };
  }, [blocked]);

  useEffect(() => {
    if (!drag) return;
    let raf = 0;
    let lastY = drag.y;
    // Desplaza la página si el dedo/ratón se acerca a los bordes
    const tick = () => {
      const h = window.innerHeight;
      const edge = 90;
      if (lastY < edge) window.scrollBy(0, -Math.ceil((edge - lastY) / 6));
      else if (lastY > h - edge) window.scrollBy(0, Math.ceil((lastY - (h - edge)) / 6));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const move = (e: PointerEvent) => {
      lastY = e.clientY;
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, drop: targetAt(e.clientX, e.clientY) } : d));
    };
    const up = () => {
      const d = ref.current;
      lastEnd.current = Date.now();
      setDrag(null);
      if (d) onDrop(d.id, d.drop);
    };
    const cancel = () => { lastEnd.current = Date.now(); setDrag(null); };
    const noScroll = (e: TouchEvent) => e.preventDefault();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && cancel();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", esc);
    document.addEventListener("touchmove", noScroll, { passive: false });
    document.documentElement.classList.add("tag-dragging");
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", esc);
      document.removeEventListener("touchmove", noScroll);
      document.documentElement.classList.remove("tag-dragging");
    };
  }, [drag?.id, targetAt, onDrop]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (id: string, e: { clientX: number; clientY: number }) => {
    void haptic();
    setDrag({ id, x: e.clientX, y: e.clientY, drop: null });
  };
  /** Props para el asa: arrastra al momento. */
  const handleProps = (id: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      start(id, e);
    },
    style: { touchAction: "none" } as React.CSSProperties,
  });
  /** Props para la fila (móvil): pulsación larga = levantar. */
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const clearPress = () => { if (press.current) window.clearTimeout(press.current.timer); press.current = null; };
  useEffect(() => clearPress, []);
  const longPressProps = (id: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return;
      clearPress();
      const p = { clientX: e.clientX, clientY: e.clientY };
      press.current = { x: e.clientX, y: e.clientY, timer: window.setTimeout(() => { press.current = null; start(id, p); }, 450) };
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) clearPress();
    },
    onPointerUp: clearPress,
    onPointerCancel: clearPress,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  /** Justo después de soltar llega un «clic»: no debe abrir nada. */
  const justDropped = () => Date.now() - lastEnd.current < 500;
  return { drag, handleProps, longPressProps, justDropped };
}

const Grip = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`h-5 w-5 ${className}`} fill="currentColor" aria-hidden="true">
    {[6, 12, 18].map((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" />))}
  </svg>
);

/** Filas visibles: sin las de etiquetas plegadas; con búsqueda, las que coinciden y sus madres. */
function useVisibleTree(tree: TagNode[], collapsed: Set<string>, q: string) {
  return useMemo(() => {
    const term = q.trim().toLocaleLowerCase("es");
    if (term) {
      const keep = new Set<string>();
      const byId = new Map(tree.map((n) => [n.tag.id, n.tag]));
      for (const n of tree) {
        if (!n.tag.name.toLocaleLowerCase("es").includes(term)) continue;
        for (let t: Tag | undefined = n.tag; t; t = t.parentId ? byId.get(t.parentId) : undefined) keep.add(t.id);
      }
      return tree.filter((n) => keep.has(n.tag.id));
    }
    const hidden = new Set<string>();
    return tree.filter((n) => {
      const p = n.tag.parentId;
      if (p && (collapsed.has(p) || hidden.has(p))) { hidden.add(n.tag.id); return false; }
      return true;
    });
  }, [tree, collapsed, q]);
}

export function TagsPage() {
  const model = useTagsModel();
  const narrow = useMedia("(max-width: 599px)");
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* sin almacenamiento */ }
      return next;
    });
  const onDrop = useCallback((id: string, drop: Drop) => {
    // Al meterla dentro de una plegada, se despliega para verla
    if (drop && "id" in drop && drop.zone === "inside" && collapsed.has(drop.id)) toggleCollapsed(drop.id);
    model.applyDrop(id, drop);
  }, [model, collapsed]); // eslint-disable-line react-hooks/exhaustive-deps
  const drag = useTreeDrag(model.tags, onDrop);
  const props = { model, collapsed, toggleCollapsed, drag };
  return (
    <div className="space-y-3">
      <h1 className={`page-title text-2xl font-bold tracking-tight ${narrow ? "" : "sr-only"}`}>Etiquetas</h1>
      {model.accounts.some((a) => a.tagIds.length > 0 && !a.connected) && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Hay etiquetas marcadas para una cuenta de Google que no está conectada: <Link to="/settings?tab=sync" className="font-medium underline">Ajustes → Sincronización</Link>.
        </p>
      )}
      {narrow ? <MobileTags {...props} /> : <PaneTags {...props} />}
      {drag.drag && <DragGhost tag={model.tags?.find((t) => t.id === drag.drag!.id)} x={drag.drag.x} y={drag.drag.y} drop={drag.drag.drop} tags={model.tags} />}
    </div>
  );
}

type ViewProps = { model: Model; collapsed: Set<string>; toggleCollapsed: (id: string) => void; drag: ReturnType<typeof useTreeDrag> };

/** La etiqueta que se arrastra, siguiendo al puntero, con lo que pasará al soltar. */
function DragGhost({ tag, x, y, drop, tags }: { tag?: Tag; x: number; y: number; drop: Drop; tags?: Tag[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => { if (ref.current) setW(ref.current.offsetWidth); });
  if (!tag) return null;
  const target = drop && "id" in drop ? tags?.find((t) => t.id === drop.id) : undefined;
  const hint = !drop ? "" : "root" in drop ? "Nivel principal" : drop.zone === "inside" ? `Dentro de «${target?.name}»` : drop.zone === "before" ? `Antes de «${target?.name}»` : `Después de «${target?.name}»`;
  return (
    <div ref={ref} className="pointer-events-none fixed z-[60] flex max-w-[calc(100vw-16px)] -translate-y-1/2 rotate-[-1.5deg] items-center gap-2.5 rounded-2xl bg-white px-4 py-3 shadow-[0_14px_40px_rgba(30,27,75,.28)]" style={{ left: Math.max(8, Math.min(x + 14, window.innerWidth - w - 8)), top: y }}>
      <span className="text-indigo-500"><Grip /></span>
      <span className={`h-3 w-3 shrink-0 rounded-full ${tagColorClasses[tag.color].dot}`} />
      <span className="truncate text-base font-semibold">{tag.name}</span>
      {hint && <span className="ml-1 truncate rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">{hint}</span>}
    </div>
  );
}

/** Clases de una fila según dónde se soltaría. */
function dropClasses(drop: Drop, id: string) {
  if (!drop || !("id" in drop) || drop.id !== id) return "";
  return drop.zone === "inside" ? "tag-drop-inside" : drop.zone === "before" ? "tag-drop-before" : "tag-drop-after";
}

// ============================================================ Pantalla ancha

function PaneTags({ model, collapsed, toggleCollapsed, drag }: ViewProps) {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const visible = useVisibleTree(model.tree, collapsed, q);
  const selId = params.get("t") ?? "";
  const select = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("t", id);
    else next.delete("t");
    setParams(next, { replace: true });
  };
  const selected = selId === "new" ? null : model.tags?.find((t) => t.id === selId) ?? model.tree[0]?.tag ?? null;
  const isNew = selId === "new" || (!model.tags?.length && !!model.tags);
  const dragging = drag.drag;

  return (
    <div className="tags-pane overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xl font-bold tracking-tight text-indigo-950">Etiquetas</p>
          <p className="text-sm text-slate-500">Personales: solo las ves tú</p>
        </div>
        <label className="ml-auto flex min-w-0 max-w-xs flex-1 items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-slate-500">
          <span aria-hidden="true">🔍</span>
          <input className="min-w-0 flex-1 bg-transparent text-[15px] text-slate-900 outline-none placeholder:text-slate-400" placeholder="Buscar etiqueta" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
        </label>
        <button className="btn-primary shrink-0 rounded-xl px-4 py-2.5 text-[15px]" onClick={() => select("new")}>＋ Nueva</button>
      </div>
      <div className="grid min-h-[420px] grid-cols-[minmax(240px,340px)_minmax(0,1fr)]">
        <div className="border-r border-slate-100 p-2.5">
          {visible.length === 0 && <p className="px-3 py-6 text-center text-slate-500">{q ? "Ninguna etiqueta coincide." : "Todavía no tienes etiquetas."}</p>}
          <ul className="space-y-0.5">
            {visible.map((n) => {
              const t = n.tag;
              const on = !isNew && selected?.id === t.id;
              return (
                <li
                  key={t.id}
                  data-tag-id={t.id}
                  className={`tag-row group relative flex h-12 cursor-pointer select-none items-center gap-2 rounded-xl pr-3 text-[15px] ${on ? "bg-indigo-50 font-bold text-indigo-900" : "font-medium hover:bg-slate-50"} ${dragging?.id === t.id ? "opacity-40" : ""} ${dropClasses(dragging?.drop ?? null, t.id)}`}
                  style={{ paddingLeft: `${8 + Math.min(n.depth, 5) * 22}px` }}
                  onClick={() => { if (!drag.justDropped()) select(t.id); }}
                >
                  <span className="cursor-grab text-slate-300 hover:text-indigo-500 active:cursor-grabbing" {...drag.handleProps(t.id)} title="Arrastra para mover" aria-label={`Mover ${t.name}`} role="button">
                    <Grip />
                  </span>
                  {n.childCount > 0 ? (
                    <button type="button" className="rounded p-0.5 text-slate-400 hover:bg-slate-200/60" onClick={(e) => { e.stopPropagation(); toggleCollapsed(t.id); }} aria-label={collapsed.has(t.id) ? "Desplegar" : "Plegar"} aria-expanded={!collapsed.has(t.id) || !!q}>
                      <Chevron dir="right" open={!collapsed.has(t.id) || !!q} />
                    </button>
                  ) : <span className="w-5" />}
                  <span className={`h-3 w-3 shrink-0 rounded-full ${tagColorClasses[t.color].dot}`} />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="shrink-0 text-[13px] font-normal text-slate-500">{n.childCount > 0 && t.totalCount !== t.contactCount ? t.totalCount : t.contactCount}</span>
                </li>
              );
            })}
          </ul>
          {model.tree.length > 0 && (
            <div data-tag-root className={`mt-2 rounded-xl border-2 border-dashed px-3 py-3 text-center text-sm transition ${dragging ? (dragging.drop && "root" in dragging.drop ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-500") : "border-transparent text-slate-400"}`}>
              {dragging ? "Suelta aquí para dejarla en el nivel principal" : "Arrastra ⠿ para ordenar; suelta encima de otra para meterla dentro"}
            </div>
          )}
        </div>
        <div className="min-w-0 p-6">
          {isNew ? (
            <TagEditor key="new" model={model} tag={null} onDone={(id) => select(id ?? "")} />
          ) : selected ? (
            <TagEditor key={selected.id} model={model} tag={selected} onDone={(id) => id !== undefined && select(id)} />
          ) : (
            <p className="py-10 text-center text-slate-500">Crea tu primera etiqueta con «＋ Nueva».</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Panel derecho: datos de la etiqueta (o una nueva), sincronización y acciones. */
function TagEditor({ model, tag, onDone }: { model: Model; tag: Tag | null; onDone: (id?: string) => void }) {
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState<TagColor>(tag?.color ?? "teal");
  const [parent, setParent] = useState<string>(tag?.parentId ?? "");
  const [delMenu, setDelMenu] = useState(false);
  const blocked = tag ? descendantIds(model.tags, tag.id) : new Set<string>();
  const subCount = tag ? model.tags?.filter((x) => x.parentId === tag.id).length ?? 0 : 0;
  const dirty = !tag || name.trim() !== tag.name || color !== tag.color || (parent || null) !== (tag.parentId ?? null);
  const accCount = tag ? model.accounts.filter((a) => a.tagIds.includes(tag.id) || model.inheritedFrom(tag, a.tagIds)).length : 0;

  async function save() {
    if (!name.trim()) return;
    if (!tag) {
      const created = await model.create.mutateAsync({ name: name.trim(), color, parentId: parent || null });
      onDone(created.id);
      return;
    }
    if (name.trim() !== tag.name || color !== tag.color) await model.update.mutateAsync({ id: tag.id, name: name.trim(), color });
    if ((parent || null) !== (tag.parentId ?? null)) model.moveTo(tag.id, parent || null);
  }

  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {tag && (
        <div className="grid grid-cols-3 gap-3">
          {[[tag.contactCount, tag.contactCount === 1 ? "contacto" : "contactos"], [subCount, subCount === 1 ? "subetiqueta" : "subetiquetas"], [accCount, accCount === 1 ? "cuenta de Google" : "cuentas de Google"]].map(([n, l]) => (
            <div key={l as string} className="rounded-2xl bg-slate-50 px-4 py-3">
              <b className="block text-2xl text-indigo-950">{n}</b>
              <span className="text-sm text-slate-500">{l}</span>
            </div>
          ))}
        </div>
      )}
      {!tag && <p className="text-xl font-bold text-indigo-950">Nueva etiqueta</p>}
      <label className="block">
        <span className="tag-field-label">Nombre</span>
        <input className="input !rounded-xl !px-4 !py-3 !text-base" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} placeholder="P. ej. Familia, Trabajo, Proveedores…" autoFocus={!tag} />
      </label>
      <div>
        <span className="tag-field-label">Color</span>
        <ColorPicker value={color} onChange={setColor} large />
      </div>
      <label className="block">
        <span className="tag-field-label">Dentro de</span>
        <select className="input !rounded-xl !px-4 !py-3 !text-base" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">— Nivel principal —</option>
          {model.tree.filter((n) => !blocked.has(n.tag.id)).map((n) => <option key={n.tag.id} value={n.tag.id}>{n.path}</option>)}
        </select>
      </label>
      {tag && model.accounts.length > 0 && (
        <div>
          <span className="tag-field-label">Sincronizar con Gmail</span>
          <GmailMultiSelect model={model} tag={tag} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        {tag && (
          <>
            <Link to={`/?tag=${tag.id}`} className="btn-ghost rounded-xl bg-slate-100 px-4 py-2.5">👥 Ver contactos</Link>
            {tag.contactCount > 0 && <a className="btn-ghost rounded-xl bg-slate-100 px-4 py-2.5" href={apiUrl(`/export/contacts.vcf?tag=${tag.id}`)} title="Exporta sus contactos con los teléfonos, emails y direcciones de esta etiqueta">⤒ Exportar .vcf</a>}
            <div className="relative ml-auto">
              <button type="button" className="btn-danger rounded-xl bg-red-50 px-4 py-2.5" onClick={() => setDelMenu(!delMenu)} aria-expanded={delMenu}>🗑 Borrar…</button>
              {delMenu && <div className="fixed inset-0 z-10" onClick={() => setDelMenu(false)} />}
              {delMenu && (
                <div ref={keepInView} className="absolute bottom-full right-0 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg">
                  <button type="button" className="block w-full px-4 py-2.5 text-left text-red-700 hover:bg-red-50" onClick={async () => { setDelMenu(false); if (await model.askDelete(tag)) onDone(""); }}>Borrar la etiqueta</button>
                  {tag.contactCount > 0 && (
                    <button type="button" className="block w-full px-4 py-2.5 text-left text-red-700 hover:bg-red-50" title="Útil para deshacer una importación de prueba" onClick={async () => { setDelMenu(false); if (await model.askDeleteWithContacts(tag)) onDone(""); }}>Borrar con sus {tag.contactCount} contactos</button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
        {!tag && <button type="button" className="btn-ghost ml-auto rounded-xl px-4 py-2.5" onClick={() => onDone("")}>Cancelar</button>}
        <button className="btn-primary rounded-xl px-5 py-2.5" disabled={!name.trim() || !dirty || model.create.isPending || model.update.isPending}>{tag ? "Guardar" : "Crear"}</button>
      </div>
    </form>
  );
}

/** Cuentas de Google de una etiqueta: fichas en una línea y desplegable con casillas. */
function GmailMultiSelect({ model, tag }: { model: Model; tag: Tag }) {
  const [open, setOpen] = useState(false);
  const rows = model.accounts.map((a) => {
    const via = model.inheritedFrom(tag, a.tagIds);
    return { a, via, on: a.tagIds.includes(tag.id) || !!via };
  });
  const chosen = rows.filter((r) => r.on);
  return (
    <div className="relative">
      <button type="button" className={`flex min-h-[52px] w-full flex-wrap items-center gap-2 rounded-xl border-[1.5px] bg-white px-3 py-2 text-left ${open ? "border-indigo-500 ring-4 ring-indigo-100" : "border-slate-200"}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        {chosen.length === 0 && <span className="px-1 text-slate-500">No se sincroniza</span>}
        {chosen.map(({ a, via }) => (
          <span key={a.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-sm font-semibold text-indigo-800">
            <GmailLogo className="h-3.5 w-4 shrink-0" />
            <span className="truncate">{a.email ?? "cuenta sin conectar"}</span>
            {via && <span className="font-normal text-indigo-600/80">· por {via.name}</span>}
          </span>
        ))}
        <span className="ml-auto text-slate-500"><Chevron open={open} /></span>
      </button>
      {open && <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}
      {open && (
        <div ref={keepInView} className="absolute inset-x-0 top-full z-20 mt-2 rounded-2xl bg-white p-2 shadow-[0_12px_40px_rgba(30,27,75,.18)] ring-1 ring-black/5">
          {rows.map(({ a, via, on }) => (
            <label key={a.id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${via ? "opacity-70" : "cursor-pointer hover:bg-indigo-50"}`} title={via ? `Ya entra por «${via.name}»` : `Envía sus contactos a ${a.email ?? "esta cuenta"} (para verlos en Outlook)`}>
              <input type="checkbox" className="h-[18px] w-[18px] accent-indigo-700" checked={on} disabled={!!via || model.setGmailPending} onChange={(e) => model.toggleGmail(tag.id, a.id, e.target.checked)} />
              <span className="min-w-0 flex-1 truncate text-[15px]">{a.email ?? "Cuenta sin conectar"}</span>
              <span className="shrink-0 text-xs text-slate-500">{via ? `por ${via.name}` : !a.connected ? "sin conectar" : ""}</span>
            </label>
          ))}
          <div className="my-1.5 h-px bg-slate-100" />
          <Link to="/settings?tab=sync" className="block rounded-xl px-3 py-2.5 text-[15px] font-semibold text-indigo-700 hover:bg-indigo-50">⚙️ Gestionar cuentas en Ajustes</Link>
        </div>
      )}
    </div>
  );
}

// ============================================================ Móvil

function MobileTags({ model, collapsed, toggleCollapsed, drag }: ViewProps) {
  const [sheet, setSheet] = useState<string | null>(null);
  const [edit, setEdit] = useState<Tag | "new" | null>(null);
  const [moveOf, setMoveOf] = useState<Tag | null>(null);
  const visible = useVisibleTree(model.tree, collapsed, "");
  const dragging = drag.drag;
  const sheetTag = model.tags?.find((t) => t.id === sheet) ?? null;

  return (
    <>
      <p className="text-sm text-slate-500">Personales: solo las ves tú. Mantén pulsada una etiqueta (o arrastra ⠿) para moverla.</p>
      {visible.length === 0 && <div className="card text-center text-slate-500">Todavía no tienes etiquetas.</div>}
      <ul className="-mx-2">
        {visible.map((n) => {
          const t = n.tag;
          const child = n.depth > 0;
          return (
            <li
              key={t.id}
              data-tag-id={t.id}
              className={`tag-row relative flex select-none items-center gap-3.5 rounded-2xl pr-1 [-webkit-touch-callout:none] ${child ? "h-14 text-base" : "h-16 text-[17px]"} ${dragging?.id === t.id ? "opacity-40" : ""} ${dropClasses(dragging?.drop ?? null, t.id)}`}
              style={{ paddingLeft: `${8 + Math.min(n.depth, 4) * 26}px` }}
              {...drag.longPressProps(t.id)}
              onClick={() => { if (!dragging && !drag.justDropped()) { void haptic(); setSheet(t.id); } }}
            >
              {child ? (
                <span className={`mx-3 h-3 w-3 shrink-0 rounded-full ${tagColorClasses[t.color].dot}`} />
              ) : (
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base font-bold text-white ${tagColorClasses[t.color].dot}`}>{t.name.slice(0, 1).toUpperCase()}</span>
              )}
              <span className={`min-w-0 flex-1 truncate ${child ? "" : "font-semibold"}`}>{t.name}</span>
              <span className="shrink-0 text-[15px] text-slate-500">{n.childCount > 0 && t.totalCount !== t.contactCount ? t.totalCount : t.contactCount}</span>
              {n.childCount > 0 ? (
                <button type="button" className="grid h-10 w-8 place-items-center text-slate-400" onClick={(e) => { e.stopPropagation(); toggleCollapsed(t.id); }} aria-label={collapsed.has(t.id) ? "Desplegar" : "Plegar"}>
                  <Chevron dir="right" open={!collapsed.has(t.id)} />
                </button>
              ) : <span className="w-8" />}
              <span className="grid h-11 w-9 place-items-center text-slate-300" {...drag.handleProps(t.id)} onClick={(e) => e.stopPropagation()} aria-label={`Mover ${t.name}`} role="button"><Grip /></span>
            </li>
          );
        })}
      </ul>
      {model.tree.length > 0 && dragging && (
        <div data-tag-root className={`rounded-2xl border-2 border-dashed px-3 py-4 text-center text-sm ${dragging.drop && "root" in dragging.drop ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-500"}`}>
          Suelta aquí para dejarla en el nivel principal
        </div>
      )}
      <button className="m3-fab tags-fab fixed right-4 z-20" onClick={() => { void haptic(); setEdit("new"); }} aria-label="Nueva etiqueta">
        <span className="text-2xl leading-none">＋</span> <span className="pr-1 text-sm font-medium">Nueva</span>
      </button>

      {sheetTag && (
        <TagSheet
          model={model}
          tag={sheetTag}
          onClose={() => setSheet(null)}
          onEdit={() => { setSheet(null); setEdit(sheetTag); }}
          onMove={() => { setSheet(null); setMoveOf(sheetTag); }}
        />
      )}
      {edit && <TagEditDialog model={model} tag={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {moveOf && <MoveDialog model={model} tag={moveOf} onClose={() => setMoveOf(null)} />}
    </>
  );
}

/** Hoja inferior con todo lo de una etiqueta (móvil). */
function TagSheet({ model, tag, onClose, onEdit, onMove }: { model: Model; tag: Tag; onClose: () => void; onEdit: () => void; onMove: () => void }) {
  const subCount = model.tags?.filter((x) => x.parentId === tag.id).length ?? 0;
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  const row = "flex min-h-[54px] w-full items-center gap-4 rounded-2xl px-3 text-left text-base active:bg-indigo-100";
  const Item = ({ children, ...p }: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" className={row} {...p}>{children}</button>;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" style={{ opacity: Math.max(0.2, 1 - dy / 400) }} onClick={onClose} role="dialog" aria-modal="true" aria-label={`Etiqueta ${tag.name}`}>
      <div
        className="m3-sheet tag-sheet max-h-[88dvh] w-full overflow-y-auto rounded-t-[28px] px-4 pb-[calc(20px+var(--sab,0px))] pt-1"
        style={{ transform: dy ? `translateY(${dy}px)` : undefined, transition: start.current === null ? "transform .2s" : "none" }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => { if ((e.currentTarget.scrollTop ?? 0) <= 0) start.current = e.touches[0]!.clientY; }}
        onTouchMove={(e) => { if (start.current !== null) setDy(Math.max(0, e.touches[0]!.clientY - start.current)); }}
        onTouchEnd={() => { const d = dy; start.current = null; if (d > 90) onClose(); else setDy(0); }}
      >
        <div className="flex justify-center py-2.5"><div className="h-1 w-10 rounded-full bg-slate-300" /></div>
        <div className="mb-2 flex items-center gap-3.5 px-1">
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-xl font-bold text-white ${tagColorClasses[tag.color].dot}`}>{tag.name.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[21px] font-bold leading-tight">{tag.name}</p>
            <p className="text-slate-500">{countLabel(tag.contactCount)}{subCount ? ` · ${subCount} ${subCount === 1 ? "subetiqueta" : "subetiquetas"}` : ""}</p>
          </div>
          <button type="button" className="grid h-11 w-11 place-items-center rounded-full text-xl active:bg-indigo-100" onClick={onEdit} aria-label="Cambiar nombre y color">✏️</button>
        </div>
        <Link to={`/?tag=${tag.id}`} className={row} onClick={onClose}>👥 Ver sus contactos</Link>
        <Item onClick={onMove}>📂 Mover dentro de…</Item>
        {tag.contactCount > 0 && <a className={row} href={apiUrl(`/export/contacts.vcf?tag=${tag.id}`)} onClick={onClose}>⤒ Exportar .vcf</a>}
        {model.accounts.length > 0 && (
          <>
            <p className="mb-1 mt-3 px-3 text-[13px] font-bold uppercase tracking-wide text-slate-500">Sincronizar con Gmail</p>
            {model.accounts.map((a) => {
              const via = model.inheritedFrom(tag, a.tagIds);
              const on = a.tagIds.includes(tag.id) || !!via;
              return (
                <label key={a.id} className={`${row} ${via ? "opacity-70" : ""}`}>
                  <GmailLogo className="h-4 w-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{a.email ?? "Cuenta sin conectar"}</span>
                    {via && <span className="block text-xs text-slate-500">Ya entra por «{via.name}»</span>}
                  </span>
                  <input type="checkbox" role="switch" className="m3-switch" checked={on} disabled={!!via || model.setGmailPending} onChange={(e) => model.toggleGmail(tag.id, a.id, e.target.checked)} />
                </label>
              );
            })}
          </>
        )}
        <div className="my-2 h-px bg-slate-200" />
        <Item className={`${row} text-red-700`} onClick={async () => { if (await model.askDelete(tag)) onClose(); }}>🗑 Borrar etiqueta…</Item>
        {tag.contactCount > 0 && <Item className={`${row} text-red-700`} onClick={async () => { if (await model.askDeleteWithContacts(tag)) onClose(); }}>🗑 Borrar con sus {tag.contactCount} contactos…</Item>}
      </div>
    </div>
  );
}

/** Nombre, color y «dentro de» (nueva etiqueta o editar, en el móvil). */
function TagEditDialog({ model, tag, onClose }: { model: Model; tag: Tag | null; onClose: () => void }) {
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState<TagColor>(tag?.color ?? "teal");
  const [parent, setParent] = useState(tag?.parentId ?? "");
  const blocked = tag ? descendantIds(model.tags, tag.id) : new Set<string>();
  async function save() {
    if (!name.trim()) return;
    if (!tag) await model.create.mutateAsync({ name: name.trim(), color, parentId: parent || null });
    else {
      if (name.trim() !== tag.name || color !== tag.color) await model.update.mutateAsync({ id: tag.id, name: name.trim(), color });
      if ((parent || null) !== (tag.parentId ?? null)) model.moveTo(tag.id, parent || null);
    }
    onClose();
  }
  return (
    <Modal
      title={tag ? "Editar etiqueta" : "Nueva etiqueta"}
      onClose={onClose}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button><button type="button" className="btn-primary" disabled={!name.trim()} onClick={() => void save()}>{tag ? "Guardar" : "Crear"}</button></>}
    >
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="block">
          <span className="tag-field-label">Nombre</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoFocus placeholder="P. ej. Familia, Trabajo…" />
        </label>
        <div>
          <span className="tag-field-label">Color</span>
          <ColorPicker value={color} onChange={setColor} large />
        </div>
        <label className="block">
          <span className="tag-field-label">Dentro de</span>
          <select className="input" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">— Nivel principal —</option>
            {model.tree.filter((n) => !blocked.has(n.tag.id)).map((n) => <option key={n.tag.id} value={n.tag.id}>{n.path}</option>)}
          </select>
        </label>
      </form>
    </Modal>
  );
}

/** «Mover dentro de…» (móvil): lista de destinos. */
function MoveDialog({ model, tag, onClose }: { model: Model; tag: Tag; onClose: () => void }) {
  const blocked = descendantIds(model.tags, tag.id);
  const opt = "flex min-h-[50px] w-full items-center gap-3 rounded-xl px-3 text-left text-base active:bg-indigo-100 disabled:opacity-40";
  const go = (p: string | null) => { model.moveTo(tag.id, p); onClose(); };
  return (
    <Modal title={`Mover «${tag.name}»`} onClose={onClose}>
      <div className="space-y-0.5">
        <button type="button" className={opt} disabled={!tag.parentId} onClick={() => go(null)}>⬆️ Nivel principal</button>
        {model.tree.filter((n) => !blocked.has(n.tag.id)).map((n) => (
          <button key={n.tag.id} type="button" className={opt} disabled={n.tag.id === tag.parentId} style={{ paddingLeft: `${12 + n.depth * 20}px` }} onClick={() => go(n.tag.id)}>
            <span className={`h-3 w-3 shrink-0 rounded-full ${tagColorClasses[n.tag.color].dot}`} />
            <span className="truncate">{n.tag.name}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
