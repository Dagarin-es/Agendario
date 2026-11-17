import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { APP_NAME, APP_VERSION, type DuplicateGroup } from "@agendario/shared";
import { api } from "../lib/api";
import { useLogout, useMe } from "../lib/auth";
import { BetaBadge } from "./BetaBadge";
import { usePendingGifts } from "../lib/gifts";

const link = ({ isActive }: { isActive: boolean }) =>
  `relative whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium sm:px-3 ${isActive ? "bg-indigo-50 text-indigo-800" : "text-slate-600 hover:bg-slate-100"}`;

/** Número de grupos de posibles duplicados (para el aviso del menú). */
export function useDuplicateCount() {
  const { data } = useQuery({
    queryKey: ["duplicates"],
    queryFn: () => api.get<DuplicateGroup[]>("/duplicates"),
    staleTime: 60_000,
  });
  return data?.length ?? 0;
}

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { data: me } = useMe();
  const logout = useLogout();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const item = "flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50";
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:border-indigo-300 hover:bg-indigo-50"
        onClick={() => setOpen(!open)}
        aria-label="Menú"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        <span className="hidden sm:inline">Menú</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          <Link to="/groups" className={item}>👪 Grupos</Link>
          <Link to="/tags" className={item}>🏷️ Etiquetas</Link>
          <Link to="/trash" className={item}>🗑️ Papelera</Link>
          <Link to="/settings" className={item}>⚙️ Ajustes</Link>
          <div className="my-1 border-t border-slate-100" />
          <Link to="/import" className={item}>📥 Importar .vcf</Link>
          <a href="/api/export/contacts.vcf" className={item}>📤 Exportar .vcf</a>
          <a href="/api/export/contacts.vcf?gifts=true" className={item}>🎁 Exportar .vcf con regalos</a>
          <div className="my-1 border-t border-slate-100" />
          <div className="truncate px-4 pt-1 text-[11px] text-slate-400">{me?.email}</div>
          <button className={`${item} text-red-700`} onClick={logout}>🚪 Salir</button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const dupCount = useDuplicateCount();
  // Altura real de la cabecera: las barras fijas de cada página se pegan justo debajo
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${el.getBoundingClientRect().height}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pendingGifts = usePendingGifts().data?.length ?? 0;
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col">
      <header ref={headerRef} className="sticky top-0 z-10 flex items-center gap-1 border-b border-slate-200 bg-white px-3 py-3 sm:gap-2 sm:px-4">
        <Link to="/" className="mr-1 flex shrink-0 items-center gap-2" title={`${APP_NAME} · versión beta`}>
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          <span className="hidden flex-col items-start leading-none md:flex">
            <span className="text-[17px] font-semibold tracking-tight text-indigo-900">{APP_NAME}</span>
            <BetaBadge size="xs" />
          </span>
          <span className="md:hidden"><BetaBadge size="xs" /></span>
        </Link>
        <nav className="flex flex-1 gap-0.5 overflow-x-auto sm:gap-1">
          <NavLink to="/" end className={link}>Contactos</NavLink>
          <NavLink to="/upcoming" className={link} title={pendingGifts ? "Hay regalos comprados sin marcar como regalados" : undefined}>
            Fechas
            {pendingGifts > 0 && <span className="ml-1 rounded-full bg-rose-500 px-1.5 py-px text-[10px] font-semibold text-white">🛍️{pendingGifts}</span>}
          </NavLink>
          <NavLink to="/duplicates" className={link} title="Buscar y combinar duplicados">
            Duplicados
            {dupCount > 0 && (
              <span className="ml-1 rounded-full bg-amber-500 px-1.5 py-px text-[10px] font-semibold text-white">{dupCount}</span>
            )}
          </NavLink>
        </nav>
        <MoreMenu />
      </header>
      <main className="flex-1 p-4 pb-10">
        <Outlet />
      </main>
      {/* Versión: siempre visible, abajo a la derecha */}
      <div className="pointer-events-none fixed bottom-2 right-2.5 z-0 select-none rounded-md bg-white/85 px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
        {APP_NAME} v{APP_VERSION}
      </div>
    </div>
  );
}
