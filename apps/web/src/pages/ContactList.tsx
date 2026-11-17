import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { geoStatusLabels, geoStatuses, type ContactSummary } from "@agendario/shared";
import { GeoIcon } from "../components/MapLinks";
import { HistoryIcon } from "../components/HistoryIcon";
import { Avatar } from "../components/Avatar";
import { useBulkActions } from "../components/BulkBar";
import { useDuplicateCount } from "../components/Layout";
import { TagChip, tagTree, useTags } from "../components/Tags";
import { VisibilityBadge } from "../components/VisibilityBadge";
import { api } from "../lib/api";

const PAGE_SIZES = [25, 50, 75, 100, 0] as const; // 0 = todos
const PAGE_SIZE_KEY = "contactos.pageSize";
const SORT_KEY = "agendario.sort";

/** Campos por los que se puede ordenar la lista (se recuerda en cada dispositivo). */
const sortOptions = [
  { id: "display", label: "Nombre a mostrar" },
  { id: "given", label: "Nombre" },
  { id: "family", label: "Apellidos" },
  { id: "company", label: "Empresa" },
  { id: "nickname", label: "Apodo" },
  { id: "geo", label: "📍 Sin geolocalizar" },
] as const;
type SortId = (typeof sortOptions)[number]["id"];

function loadSort(): SortId {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return sortOptions.some((o) => o.id === v) ? (v as SortId) : "display";
  } catch {
    return "display";
  }
}

/** Texto por el que se ordena cada contacto ("" = no tiene ese dato: va al final). */
function sortText(c: ContactSummary, sort: SortId): string {
  switch (sort) {
    case "given": return [c.givenName, c.familyName].filter(Boolean).join(" ").trim();
    case "family": return c.familyName.trim() ? `${c.familyName} ${c.givenName}`.trim() : "";
    case "company": return c.organization.trim();
    case "nickname": return c.nickname.trim();
    default: return c.displayName.trim();
  }
}

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
export const ALPHABET = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "Ñ", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "#"];

/** Letra del índice: A-Z y Ñ (sin tildes); lo demás, «#». */
function letterOf(text: string): string {
  const first = text.trim().charAt(0).toUpperCase();
  if (first === "Ñ") return "Ñ";
  const base = first.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /^[A-Z]$/.test(base) ? base : "#";
}

/** Pestañas del abecedario, a todo el ancho, como las de una agenda. Las letras sin contactos, apagadas. */
const tabColors = ["bg-indigo-600", "bg-amber-500", "bg-violet-500", "bg-pink-500"];
function AlphabetTabs({ present, active, onPick }: { present: Set<string>; active: string | null; onPick: (l: string) => void }) {
  return (
    <nav className="grid grid-cols-14 gap-px pt-1 sm:grid-cols-28" aria-label="Saltar a la letra">
      {ALPHABET.map((l, i) => {
        const has = present.has(l);
        const on = active === l;
        return (
          <button
            key={l}
            type="button"
            disabled={!has}
            onClick={() => onPick(l)}
            className={`relative h-7 rounded-t-md text-[11px] font-bold transition sm:h-8 sm:text-xs ${
              on
                ? "z-10 -mb-px translate-y-px bg-white text-indigo-900 ring-1 ring-slate-200"
                : has
                  ? `${tabColors[i % 4]} text-white shadow-[inset_0_-3px_0_rgba(0,0,0,0.12)] hover:-translate-y-0.5`
                  : "bg-slate-100 text-slate-300"
            }`}
            aria-label={`Letra ${l}`}
            aria-current={on ? "true" : undefined}
          >
            {l}
          </button>
        );
      })}
    </nav>
  );
}

function loadPageSize(): number {
  try {
    const v = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(v) && localStorage.getItem(PAGE_SIZE_KEY) !== null ? v : 50;
  } catch {
    return 50;
  }
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const btn = "btn-ghost min-w-9 px-2 py-1.5 disabled:opacity-30";
  // Números visibles: primera, última y las cercanas a la actual
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  return (
    <nav className="flex items-center justify-center gap-0.5 text-sm" aria-label="Paginación">
      <button className={btn} disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Anterior">‹</button>
      {nums.map((n, i) => (
        <span key={n} className="flex items-center">
          {i > 0 && n - nums[i - 1]! > 1 && <span className="px-1 text-slate-400">…</span>}
          <button
            className={`${btn} ${n === page ? "bg-indigo-700 text-white hover:bg-indigo-700" : ""}`}
            onClick={() => onPage(n)}
            aria-current={n === page ? "page" : undefined}
          >
            {n}
          </button>
        </span>
      ))}
      <button className={btn} disabled={page === pages} onClick={() => onPage(page + 1)} aria-label="Siguiente">›</button>
    </nav>
  );
}

export function ContactListPage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const tag = params.get("tag") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [sort, setSortState] = useState<SortId>(loadSort);
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const [q, setQ] = useState(params.get("q") ?? "");
  const deferred = useDeferredValue(q);
  const [pageSize, setPageSize] = useState(loadPageSize);
  const { data: tags } = useTags();
  const dupCount = useDuplicateCount();
  const topRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  // Selección: id → ¿es mío? (se mantiene al cambiar de página o de filtro)
  const [selected, setSelected] = useState<Map<string, boolean>>(new Map());
  const [selMenu, setSelMenu] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number>(undefined);
  const showToast = (t: string) => {
    setToast(t);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 5000);
  };

  const qs = new URLSearchParams();
  if (deferred) qs.set("q", deferred);
  if (tag) qs.set("tag", tag);
  const { data, isLoading, error } = useQuery({
    queryKey: ["contacts", deferred, tag],
    queryFn: () => api.get<ContactSummary[]>(`/contacts${qs.size ? `?${qs}` : ""}`),
    placeholderData: (prev) => prev,
  });

  /** Actualiza la URL (así al volver de una ficha sigues en la misma página). */
  function update(changes: { tag?: string; page?: number; q?: string }) {
    const next = new URLSearchParams(params);
    const set = (k: string, v: string | number | undefined, empty: string | number) =>
      v === undefined ? null : v === empty || v === "" ? next.delete(k) : next.set(k, String(v));
    set("tag", changes.tag, "");
    set("page", changes.page, 1);
    set("q", changes.q, "");
    setParams(next, { replace: true });
  }

  // Al buscar se vuelve a la primera página
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    update({ q: deferred, page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferred]);

  const setTag = (id: string) => update({ tag: id, page: 1 });
  const changePageSize = (n: number) => {
    setPageSize(n);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(n));
    } catch {
      /* sin almacenamiento: se usa solo en esta sesión */
    }
    update({ page: 1 });
  };
  const changeSort = (v: SortId) => {
    setSortState(v);
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {
      /* solo en esta sesión */
    }
    update({ page: 1 });
  };
  const goPage = (p: number) => {
    update({ page: p });
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const activeTag = tags?.find((t) => t.id === tag);
  // Orden «sin geolocalizar primero»: con dirección sin localizar, a medias, sin dirección y localizados (dentro, por nombre).
  // El resto: por el campo elegido; los que no lo tienen, al final (ordenados por nombre a mostrar).
  const sorted = useMemo(() => {
    if (!data) return data;
    if (sort === "geo") return [...data].sort((a, b) => geoStatuses.indexOf(a.geo) - geoStatuses.indexOf(b.geo) || collator.compare(a.displayName, b.displayName));
    return [...data]
      .map((c) => ({ c, k: sortText(c, sort) }))
      .sort((a, b) => (a.k ? 0 : 1) - (b.k ? 0 : 1) || collator.compare(a.k || a.c.displayName, b.k || b.c.displayName))
      .map((x) => x.c);
  }, [data, sort]);
  // Letra de cada contacto según el orden (los que no tienen el campo van a «#»)
  const letters = useMemo(() => {
    const m = new Map<string, string>();
    if (sorted && sort !== "geo") sorted.forEach((c) => m.set(c.id, sortText(c, sort) ? letterOf(sortText(c, sort)) : "#"));
    return m;
  }, [sorted, sort]);
  const firstIndex = useMemo(() => {
    const m = new Map<string, number>();
    sorted?.forEach((c, i) => {
      const l = letters.get(c.id);
      if (l && !m.has(l)) m.set(l, i);
    });
    return m;
  }, [sorted, letters]);
  const total = data?.length ?? 0;
  const pages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const current = Math.min(page, pages);
  const visible = sorted ? (pageSize ? sorted.slice((current - 1) * pageSize, current * pageSize) : sorted) : [];
  const from = total ? (pageSize ? (current - 1) * pageSize + 1 : 1) : 0;
  const to = pageSize ? Math.min(current * pageSize, total) : total;

  const filtered = !!(deferred || tag);
  const showAlphabet = sort !== "geo" && total > 15 && !deferred;

  /** Salta a la primera persona de esa letra (cambiando de página si hace falta). */
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const jumpLetter = (l: string) => {
    setActiveLetter(l);
    const idx = firstIndex.get(l);
    if (idx === undefined) return;
    const p = pageSize ? Math.floor(idx / pageSize) + 1 : 1;
    if (p !== current) update({ page: p });
    setJumpTo(l);
  };
  useEffect(() => {
    if (!jumpTo) return;
    const el = document.getElementById(`letra-${jumpTo}`);
    if (el) {
      el.scrollIntoView({ block: "start" });
      setJumpTo(null);
    }
  }, [jumpTo, visible]);
  const pageAllSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));
  const addToSelection = (list: ContactSummary[]) =>
    setSelected((prev) => {
      const next = new Map(prev);
      list.forEach((c) => next.set(c.id, c.isMine));
      return next;
    });
  const toggleOne = (c: ContactSummary) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(c.id)) next.delete(c.id);
      else next.set(c.id, c.isMine);
      return next;
    });
  const togglePage = () => {
    if (pageAllSelected) {
      setSelected((prev) => {
        const next = new Map(prev);
        visible.forEach((c) => next.delete(c.id));
        return next;
      });
    } else addToSelection(visible);
  };
  async function selectWholeAgenda() {
    const all = await qc.fetchQuery({
      queryKey: ["contacts", "", ""],
      queryFn: () => api.get<ContactSummary[]>("/contacts"),
    });
    addToSelection(all);
    setSelMenu(false);
  }
  const notMine = [...selected.values()].filter((mine) => !mine).length;
  const bulk = useBulkActions({
    ids: [...selected.keys()], notMine, onClear: () => setSelected(new Map()), onMessage: showToast, filterTag: activeTag,
    onCombine: () => {
      const [a, b] = [...selected.keys()];
      nav(`/duplicates/merge?a=${a}&b=${b}&p=${a}&from=list`);
    },
  });

  return (
    <div className="space-y-4" ref={topRef}>
      <div className="flex gap-2">
        <input className="input" placeholder="Buscar por nombre, email, teléfono…" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
        <Link to="/contacts/new" className="btn-primary shrink-0">+ Nuevo</Link>
      </div>

      {dupCount > 0 && (
        <Link to="/duplicates" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100">
          <span>👥</span>
          <span className="flex-1">
            Hay <strong>{dupCount}</strong> {dupCount === 1 ? "grupo" : "grupos"} de posibles duplicados
          </span>
          <span className="font-medium">Revisar y combinar ›</span>
        </Link>
      )}

      {/* Filtro por etiquetas: las principales y, debajo, las subetiquetas de la elegida */}
      {tags && tags.length > 0 && (() => {
        const tree = tagTree(tags);
        const byId = new Map(tags.map((t) => [t.id, t]));
        // Cadena desde la raíz hasta la etiqueta activa
        const chain: string[] = [];
        for (let cur = tag ? byId.get(tag) : undefined; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) chain.unshift(cur.id);
        const levels: { parent: string | null; items: typeof tree }[] = [{ parent: null, items: tree.filter((n) => n.depth === 0) }];
        for (const id of chain) {
          const kids = tree.filter((n) => n.tag.parentId === id);
          if (kids.length) levels.push({ parent: id, items: kids });
        }
        return (
          <div className="space-y-1">
            {levels.map((lv, i) => (
              <div key={lv.parent ?? "root"} className={`-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 py-1 ${i > 0 ? "border-l-2 border-indigo-200" : ""}`}>
                {i === 0 ? (
                  <TagChip tag={{ id: "", name: "Todos", color: "slate" }} active={!tag} onClick={() => setTag("")} />
                ) : (
                  <span className="shrink-0 text-xs text-slate-400">↳ {byId.get(lv.parent!)?.name}:</span>
                )}
                {lv.items.map((n) => (
                  <TagChip
                    key={n.tag.id}
                    tag={{ ...n.tag, name: `${n.tag.name} · ${n.tag.totalCount}${n.childCount ? " ▸" : ""}` }}
                    active={chain.includes(n.tag.id)}
                    onClick={() => setTag(n.tag.id === tag ? (n.tag.parentId ?? "") : n.tag.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        );
      })()}

      {isLoading && <p className="text-slate-500">Cargando…</p>}
      {error && <p className="text-red-600">{(error as Error).message}</p>}
      {data && data.length === 0 && (
        <div className="card text-center text-slate-500">
          {q || tag ? "Sin resultados." : (
            <>Aún no tienes contactos. Crea el primero con «+ Nuevo» o <Link to="/import" className="text-indigo-700 underline">importa un .vcf</Link>.</>
          )}
        </div>
      )}

      {total > 0 && (
        <div className="sticky top-[68px] z-[5] -mx-4 bg-slate-50/95 px-4 py-1.5 backdrop-blur">
          <div className="flex min-h-11 items-center gap-2">
            {/* Selección: casilla + desplegable (agrupados, como en Gmail) */}
            <div className="relative flex shrink-0 items-center rounded-lg border border-slate-300 bg-white">
              <label className="flex cursor-pointer items-center py-2 pl-2.5 pr-1.5" title="Seleccionar los de esta página">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer"
                  checked={pageAllSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !pageAllSelected && visible.some((c) => selected.has(c.id));
                  }}
                  onChange={togglePage}
                  aria-label="Seleccionar los de esta página"
                />
              </label>
              <button
                className="flex items-center self-stretch border-l border-slate-200 px-2 text-slate-600 hover:bg-slate-50"
                onClick={() => setSelMenu(!selMenu)}
                aria-label="Opciones de selección"
                aria-expanded={selMenu}
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true"><path d="M5.2 7.2a.75.75 0 0 1 1.06 0L10 10.94l3.74-3.74a.75.75 0 1 1 1.06 1.06l-4.27 4.27a.75.75 0 0 1-1.06 0L5.2 8.26a.75.75 0 0 1 0-1.06Z" /></svg>
              </button>
              {selMenu && <div className="fixed inset-0 z-10" onClick={() => setSelMenu(false)} />}
              {selMenu && (
                <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg">
                  <button className="block w-full px-4 py-2.5 text-left hover:bg-slate-50" onClick={() => { addToSelection(visible); setSelMenu(false); }}>
                    Los de esta página ({visible.length})
                  </button>
                  {(filtered || pages > 1) && (
                    <button className="block w-full px-4 py-2.5 text-left hover:bg-slate-50" onClick={() => { addToSelection(data ?? []); setSelMenu(false); }}>
                      {filtered ? "Todos los del filtro" : "Todos los de la lista"} ({total})
                    </button>
                  )}
                  <button className="block w-full px-4 py-2.5 text-left hover:bg-slate-50" onClick={selectWholeAgenda}>
                    Toda la agenda
                  </button>
                  <button className="block w-full border-t border-slate-100 px-4 py-2.5 text-left text-slate-500 hover:bg-slate-50" onClick={() => { setSelected(new Map()); setSelMenu(false); }}>
                    Ninguno
                  </button>
                </div>
              )}
            </div>

            {selected.size > 0 ? (
              <>
                <span className="text-sm font-semibold text-indigo-900">
                  {selected.size}
                  <span className="hidden font-normal sm:inline"> {selected.size === 1 ? "seleccionado" : "seleccionados"}</span>
                </span>
                <div className="ml-auto">{bulk.buttons}</div>
                <button className="btn-ghost shrink-0 px-2 text-base leading-none text-slate-500" onClick={() => setSelected(new Map())} aria-label="Quitar la selección" title="Quitar la selección">✕</button>
              </>
            ) : (
              <>
                <p className="min-w-0 flex-1 truncate text-xs text-slate-500">
                  {pageSize && total > pageSize ? `${from}–${to} de ${total}` : `${total} ${total === 1 ? "contacto" : "contactos"}`}
                  {activeTag ? ` con «${activeTag.name}»` : ""}
                </p>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                  <span className="hidden sm:inline">Ordenar</span>
                  <select className="input w-auto max-w-[10rem] py-1 text-xs" value={sort} onChange={(e) => changeSort(e.target.value as SortId)} aria-label="Ordenar por">
                    {sortOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </label>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                  <span className="hidden sm:inline">Mostrar</span>
                  <select className="input w-auto py-1 text-xs" value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))}>
                    {PAGE_SIZES.map((n) => <option key={n} value={n}>{n || "Todos"}</option>)}
                  </select>
                </label>
              </>
            )}
          </div>
          {selected.size > 0 && bulk.panelView}
          {showAlphabet && selected.size === 0 && <AlphabetTabs present={new Set(firstIndex.keys())} active={activeLetter} onPick={jumpLetter} />}
          {selected.size === 0 && sort === "geo" && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1 text-[11px] text-slate-500">
              {geoStatuses.map((g) => (
                <span key={g} className="flex items-center gap-1"><GeoIcon status={g} /> {geoStatusLabels[g]}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <ul className={`divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white empty:hidden ${showAlphabet ? "rounded-t-none" : ""}`}>
        {visible.map((c, i) => {
          const l = letters.get(c.id);
          const header = l && (i === 0 || letters.get(visible[i - 1]!.id) !== l);
          return (
          <Fragment key={c.id}>
          {header && (
            <li id={firstIndex.get(l) !== undefined && sorted![firstIndex.get(l)!]!.id === c.id ? `letra-${l}` : undefined} className="scroll-mt-32 bg-slate-50 px-4 py-1 text-xs font-bold text-indigo-800">
              {l === "#" && sort !== "display" ? `# · sin ${sortOptions.find((o) => o.id === sort)!.label.toLowerCase()} o con otros signos` : l}
            </li>
          )}
          <li className={`flex items-center ${selected.has(c.id) ? "bg-indigo-50/70" : ""}`}>
            <label className="flex cursor-pointer items-center self-stretch pl-4 pr-1" aria-label={`Seleccionar ${c.displayName}`}>
              <input type="checkbox" className="h-4 w-4 cursor-pointer" checked={selected.has(c.id)} onChange={() => toggleOne(c)} />
            </label>
            <Link to={`/contacts/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-2 pr-4 hover:bg-slate-50/60">
              <Avatar id={c.id} name={c.displayName} hasPhoto={c.hasPhoto} version={c.updatedAt} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.displayName}</div>
                {(sort === "family" || sort === "given" || sort === "nickname") && sortText(c, sort) && sortText(c, sort) !== c.displayName && (
                  <div className="truncate text-xs text-indigo-700/80">{sort === "nickname" ? `«${c.nickname}»` : sort === "family" ? `${c.familyName}, ${c.givenName}`.replace(/, $/, "") : sortText(c, sort)}</div>
                )}
                <div className="truncate text-sm text-slate-500">
                  {(tag ? [c.phone, c.email] : [c.organization]).filter(Boolean).join(" · ")}
                  {!c.isMine && <span>{(tag ? c.phone || c.email : c.organization) ? " · " : ""}de {c.ownerName}</span>}
                </div>
                {c.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.tags.map((t) => <TagChip key={t.id} tag={t} small />)}
                  </div>
                )}
              </div>
              {c.visibility !== "private" && <VisibilityBadge v={c.visibility} />}
              {c.hasHistory && <span className="shrink-0 text-indigo-500"><HistoryIcon className="h-5 w-5" title="Tiene cambios en el historial" /></span>}
              <GeoIcon status={c.geo} />
            </Link>
          </li>
          </Fragment>
          );
        })}
      </ul>



      <Pager page={current} pages={pages} onPage={goPage} />

      {toast && (
        <div className={`fixed inset-x-0 z-30 flex justify-center px-4 bottom-6`}>
          <div className="rounded-full bg-slate-900/90 px-4 py-2 text-center text-sm text-white shadow-lg" role="status">{toast}</div>
        </div>
      )}
    </div>
  );
}
