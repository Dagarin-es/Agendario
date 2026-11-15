import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { geoStatusLabels, geoStatuses, type ContactSummary } from "@agendario/shared";
import { GeoIcon } from "../components/MapLinks";
import { HistoryIcon } from "../components/HistoryIcon";
import { Avatar } from "../components/Avatar";
import { useBulkActions } from "../components/BulkBar";
import { useDuplicateCount } from "../components/Layout";
import { TagChip, useTags } from "../components/Tags";
import { VisibilityBadge } from "../components/VisibilityBadge";
import { api } from "../lib/api";

const PAGE_SIZES = [25, 50, 75, 100, 0] as const; // 0 = todos
const PAGE_SIZE_KEY = "contactos.pageSize";

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
  const tag = params.get("tag") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const sort = params.get("sort") === "geo" ? "geo" : "";
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
  function update(changes: { tag?: string; page?: number; q?: string; sort?: string }) {
    const next = new URLSearchParams(params);
    const set = (k: string, v: string | number | undefined, empty: string | number) =>
      v === undefined ? null : v === empty || v === "" ? next.delete(k) : next.set(k, String(v));
    set("tag", changes.tag, "");
    set("page", changes.page, 1);
    set("q", changes.q, "");
    set("sort", changes.sort, "");
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

  const setTag = (id: string) => update({ tag: id && id !== tag ? id : "", page: 1 });
  const changePageSize = (n: number) => {
    setPageSize(n);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(n));
    } catch {
      /* sin almacenamiento: se usa solo en esta sesión */
    }
    update({ page: 1 });
  };
  const goPage = (p: number) => {
    update({ page: p });
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const activeTag = tags?.find((t) => t.id === tag);
  // Orden «sin geolocalizar primero»: con dirección sin localizar, a medias, sin dirección y localizados (dentro, por nombre)
  const sorted =
    data && sort === "geo" ? [...data].sort((a, b) => geoStatuses.indexOf(a.geo) - geoStatuses.indexOf(b.geo)) : data;
  const total = data?.length ?? 0;
  const pages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const current = Math.min(page, pages);
  const visible = sorted ? (pageSize ? sorted.slice((current - 1) * pageSize, current * pageSize) : sorted) : [];
  const from = total ? (pageSize ? (current - 1) * pageSize + 1 : 1) : 0;
  const to = pageSize ? Math.min(current * pageSize, total) : total;

  const filtered = !!(deferred || tag);
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
  const bulk = useBulkActions({ ids: [...selected.keys()], notMine, onClear: () => setSelected(new Map()), onMessage: showToast, filterTag: activeTag });

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

      {/* Filtro por etiquetas */}
      <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 empty:hidden">
        {tags && tags.length > 0 && (
          <TagChip tag={{ id: "", name: "Todos", color: "slate" }} active={!tag} onClick={() => setTag("")} />
        )}
        {tags?.map((t) => (
          <TagChip key={t.id} tag={{ ...t, name: `${t.name} · ${t.contactCount}` }} active={t.id === tag} onClick={() => setTag(t.id)} />
        ))}
      </div>

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
                  <select className="input w-auto py-1 text-xs" value={sort} onChange={(e) => update({ sort: e.target.value, page: 1 })} aria-label="Ordenar">
                    <option value="">Por nombre</option>
                    <option value="geo">📍 Sin geolocalizar primero</option>
                  </select>
                </label>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                  Mostrar
                  <select className="input w-auto py-1 text-xs" value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))}>
                    {PAGE_SIZES.map((n) => <option key={n} value={n}>{n || "Todos"}</option>)}
                  </select>
                </label>
              </>
            )}
          </div>
          {selected.size > 0 && bulk.panelView}
          {selected.size === 0 && sort === "geo" && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1 text-[11px] text-slate-500">
              {geoStatuses.map((g) => (
                <span key={g} className="flex items-center gap-1"><GeoIcon status={g} /> {geoStatusLabels[g]}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white empty:hidden">
        {visible.map((c) => (
          <li key={c.id} className={`flex items-center ${selected.has(c.id) ? "bg-indigo-50/70" : ""}`}>
            <label className="flex cursor-pointer items-center self-stretch pl-4 pr-1" aria-label={`Seleccionar ${c.displayName}`}>
              <input type="checkbox" className="h-4 w-4 cursor-pointer" checked={selected.has(c.id)} onChange={() => toggleOne(c)} />
            </label>
            <Link to={`/contacts/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-2 pr-4 hover:bg-slate-50/60">
              <Avatar id={c.id} name={c.displayName} hasPhoto={c.hasPhoto} version={c.updatedAt} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.displayName}</div>
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
        ))}
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
