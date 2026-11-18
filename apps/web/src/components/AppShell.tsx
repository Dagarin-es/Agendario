/**
 * Marco de la app de Android con Material 3 (Material You): barra superior, píldora de navegación
 * inferior flotante (los destinos al alcance del pulgar; tu foto abre la hoja con el resto), botón flotante.
 * La web (PWA) sigue usando Layout; las páginas son las mismas.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { APP_NAME, APP_VERSION } from "@agendario/shared";
import { useDuplicateCount } from "./Layout";
import { useLogout, useMe } from "../lib/auth";
import { useGiftsToBuy, usePendingGifts } from "../lib/gifts";
import { getServer, setServer } from "../lib/platform";
import { haptic } from "../lib/native";
import { ModeSelector, useColorThemeFromPrefs, useThemeIcon } from "./Personalize";
import { UserAvatar } from "./UserAvatar";
import { AboutModal } from "./About";
import { ContactListPage } from "../pages/ContactList";
import { OfflineBanner } from "./OfflineBanner";
import { sortOptions, useSortPref } from "../lib/sort";

// ---------- Iconos (24 px, trazo, estilo Material Symbols) ----------
const I = ({ d, filled, className = "h-6 w-6" }: { d: ReactNode; filled?: boolean; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? 0 : 1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
export const icons = {
  contacts: (f?: boolean) => (
    <I filled={f} d={f ? <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2-7 4.5V21h14v-2.5C19 16 16 14 12 14Z" /> : <><circle cx="12" cy="8" r="3.6" /><path d="M5 20.5v-1.8C5 16.1 8.1 14.5 12 14.5s7 1.6 7 4.2v1.8" /></>} />
  ),
  event: (f?: boolean) => (
    <I filled={f} d={f ? <path d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm-2 8h14v10H5V10Zm9 3v4h4v-4h-4Z" /> : <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /><rect x="13.5" y="13.5" width="3.5" height="3.5" rx="0.6" /></>} />
  ),
  merge: (f?: boolean) => (
    <I filled={f} d={<><circle cx="8.5" cy="9" r="3.2" fill={f ? "currentColor" : "none"} /><circle cx="15.5" cy="9" r="3.2" fill={f ? "currentColor" : "none"} opacity={f ? 0.6 : 1} /><path d="M3.5 19.5c0-2.6 2.2-4.5 5-4.5s5 1.9 5 4.5M10.5 19.5c0-2.6 2.2-4.5 5-4.5s5 1.9 5 4.5" stroke="currentColor" strokeWidth={1.9} fill="none" /></>} />
  ),
  more: (f?: boolean) => <I filled={f} d={<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth={2} />} />,
  gift: (f?: boolean) => (
    <I filled={f} d={f ? <path d="M20 7h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h7V7h2v5h7a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Zm-11-.1a1 1 0 1 1 1-1V7H9a1 1 0 0 1 0-.1Zm6 .1h-1V5.9a1 1 0 1 1 1 1.1ZM4 13v6a2 2 0 0 0 2 2h5v-8Zm9 8h5a2 2 0 0 0 2-2v-6h-7Z" /> : <><rect x="3.5" y="7.5" width="17" height="4.5" rx="1" /><path d="M5 12v7.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V12M12 7.5V21M12 7.5S10.5 3.5 8.2 4.3C6 5 7.3 7.5 9 7.5M12 7.5s1.5-4 3.8-3.2C18 5 16.7 7.5 15 7.5" /></>} />
  ),
  back: () => <I d={<path d="M19 12H5M11 18l-6-6 6-6" />} />,
  add: () => <I d={<path d="M12 5v14M5 12h14" strokeWidth={2.2} />} />,
};

const tabs = [
  { to: "/", end: true, label: "Contactos", icon: icons.contacts },
  { to: "/gifts", label: "Regalos", icon: icons.gift },
  { to: "/upcoming", label: "Fechas", icon: icons.event },
  { to: "/duplicates", label: "Duplicados", icon: icons.merge },
] as const;

const titles: [RegExp, string][] = [
  [/^\/$/, "Contactos"],
  [/^\/gifts/, "Regalos"],
  [/^\/share-gift/, "Añadir idea de regalo"],
  [/^\/upcoming/, "Fechas"],
  [/^\/duplicates\/merge/, "Combinar"],
  [/^\/duplicates/, "Duplicados"],
  [/^\/contacts\/new/, "Nuevo contacto"],
  [/^\/contacts\/[^/]+\/edit/, "Editar contacto"],
  [/^\/contacts\/[^/]+\/history/, "Historial"],
  [/^\/contacts\//, "Contacto"],
  [/^\/settings/, "Ajustes"],
  [/^\/tags/, "Etiquetas"],
  [/^\/groups/, "Grupos"],
  [/^\/trash/, "Papelera"],
  [/^\/import/, "Importar"],
];

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

/** Teclado abierto: la ventana encoge bastante respecto a su altura máxima (Android redimensiona la WebView). */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let max = window.innerHeight;
    let width = window.innerWidth;
    const on = () => {
      if (window.innerWidth !== width) { width = window.innerWidth; max = window.innerHeight; } // giro o plegado
      max = Math.max(max, window.innerHeight);
      const focused = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
      setOpen(focused && window.innerHeight < max - 140);
    };
    window.addEventListener("resize", on);
    window.visualViewport?.addEventListener("resize", on);
    document.addEventListener("focusout", () => setTimeout(on, 120));
    return () => { window.removeEventListener("resize", on); window.visualViewport?.removeEventListener("resize", on); };
  }, []);
  return open;
}

export function AppShell() {
  const location = useLocation();
  const nav = useNavigate();
  const { data: me } = useMe();
  const dupCount = useDuplicateCount();
  const gifts = useGiftsToBuy();
  const pending = usePendingGifts().data?.length ?? 0;
  const [sheet, setSheet] = useState(false);
  const [about, setAbout] = useState(false);
  useColorThemeFromPrefs();
  const icon = useThemeIcon();
  const headerRef = useRef<HTMLElement>(null);
  const isTab = tabs.some((t) => location.pathname === t.to);
  const title = titles.find(([re]) => re.test(location.pathname))?.[1] ?? APP_NAME;
  // Pantalla ancha (Galaxy Fold abierto, tablet): barra lateral y lista + ficha en dos paneles
  const wide = useMedia("(min-width: 600px)");
  const kb = useKeyboardOpen();
  const twoPane = wide && (location.pathname === "/" || /^\/contacts\/(?!new$)[^/]+$/.test(location.pathname));

  useEffect(() => setSheet(false), [location.pathname]);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${el.getBoundingClientRect().height}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // La barra superior cambia de tono al desplazarse (como en Material 3)
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  // «Compartir» desde otra app → Añadir idea de regalo
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ text?: string; title?: string }>).detail;
      nav(`/share-gift?${new URLSearchParams({ text: d.text ?? "", title: d.title ?? "" })}`);
    };
    window.addEventListener("agendario-share", on);
    return () => window.removeEventListener("agendario-share", on);
  }, [nav]);

  const badge = (to: string) => (to === "/duplicates" ? dupCount || null : to === "/upcoming" ? gifts.count + pending || null : null);
  const navItems = (
    <>
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={"end" in t} onClick={() => void haptic()} className="m3-nav-item">
          {({ isActive }) => (
            <>
              <span className={`m3-nav-indicator ${isActive || (t.to === "/" && twoPane && location.pathname.startsWith("/contacts/")) ? "is-active" : ""}`}>
                {t.icon(isActive)}
                {badge(t.to) && <span className={`m3-badge ${t.to === "/upcoming" && !gifts.red ? "bg-amber-600" : "bg-red-600"}`}>{badge(t.to)}</span>}
              </span>
              <span className={`text-[11px] leading-none ${isActive ? "font-bold" : "font-medium"}`}>{t.label}</span>
            </>
          )}
        </NavLink>
      ))}
      <button className="m3-nav-item" onClick={() => { void haptic(); setSheet(true); }} aria-haspopup="dialog" aria-label="Tu cuenta y más opciones">
        <span className={`m3-nav-indicator ${sheet || location.pathname.startsWith("/settings") ? "is-active" : ""}`}>
          <UserAvatar me={me} size={26} className="ring-2 ring-white/70" />
        </span>
        <span className="max-w-full truncate px-1 text-[11px] font-medium leading-none">{me?.name?.split(" ")[0] ?? "Tú"}</span>
      </button>
    </>
  );

  return (
    <div className={`m3 flex min-h-dvh flex-col ${wide ? "pl-[calc(88px+var(--sal,0px))]" : ""}`}>
      {/* Barra superior: baja y siempre «Agendario» (la sección ya se ve en la navegación) */}
      <header ref={headerRef} className={`sticky top-0 z-20 flex h-[calc(3.25rem+var(--sat))] items-center gap-1 px-1 pt-[var(--sat)] transition-colors ${scrolled ? "m3-surface-2" : "m3-surface"}`}>
        {isTab || twoPane ? (
          <img src={icon} alt="" className="mx-2.5 h-7 w-7" />
        ) : (
          <button className="m3-icon-btn" onClick={() => nav(-1)} aria-label="Atrás">{icons.back()}</button>
        )}
        <span className="min-w-0 flex-1 truncate text-[20px] font-medium tracking-tight text-indigo-950">{APP_NAME}</span>
        {!wide && location.pathname === "/" && <SortMenu />}
        <h1 className="sr-only">{title}</h1>
      </header>

      <OfflineBanner />
      {me?.mustChangePassword && (
        <Link to="/settings" className="mx-4 mt-2 rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-900">🔑 Estás usando una contraseña provisional: cámbiala en Ajustes.</Link>
      )}

      {twoPane ? (
        <main className="grid flex-1 grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
          <div className="h-[calc(100dvh-var(--header-h,56px))] overflow-y-auto border-r border-slate-200/70 px-3 pb-6" style={{ ["--header-h" as string]: "0px" }}>
            <ContactListPage pane />
          </div>
          <div className="two-pane-detail h-[calc(100dvh-var(--header-h,56px))] overflow-y-auto px-4 pb-6 pt-1">
            {location.pathname === "/" ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-400">
                <img src={icon} alt="" className="h-16 w-16 opacity-60" />
                <p>Elige un contacto para ver su ficha</p>
              </div>
            ) : (
              <Outlet />
            )}
          </div>
        </main>
      ) : (
        <main className={`flex-1 px-4 pt-1 ${wide ? "pb-8" : "pb-[calc(104px+var(--sab))]"}`}>
          <Outlet />
        </main>
      )}

      {/* Botón flotante: nuevo contacto (en pantalla ancha va arriba en la barra lateral) */}
      {!wide && !kb && location.pathname === "/" && (
        <Link to="/contacts/new" onClick={() => void haptic()} className="m3-fab fixed bottom-[calc(92px+var(--sab))] right-4 z-20" aria-label="Nuevo contacto">
          {icons.add()} <span className="pr-1 text-sm font-medium">Nuevo</span>
        </Link>
      )}

      {wide ? (
        /* Barra lateral (navigation rail) para pantallas anchas */
        <nav className="m3-rail fixed bottom-0 left-0 top-0 z-30 flex w-[calc(88px+var(--sal,0px))] flex-col items-center gap-3 pb-[calc(16px+var(--sab))] pl-[var(--sal,0px)] pt-[calc(12px+var(--sat))]" aria-label="Navegación principal">
          <Link to="/contacts/new" onClick={() => void haptic()} className="m3-fab mb-3 !h-14 !w-14 !justify-center !px-0" aria-label="Nuevo contacto">{icons.add()}</Link>
          <div className="flex flex-1 flex-col gap-3">{navItems}</div>
        </nav>
      ) : (
        /* Píldora de navegación flotante translúcida; se esconde con el teclado abierto */
        <nav className={`m3-pill fixed bottom-[calc(12px+var(--sab))] left-1/2 z-20 grid w-[min(calc(100vw-24px),460px)] -translate-x-1/2 grid-cols-5 transition-[opacity,transform] duration-200 ${kb ? "pointer-events-none translate-y-24 opacity-0" : ""}`} aria-label="Navegación principal">
          {navItems}
        </nav>
      )}

      {sheet && <MoreSheet onClose={() => setSheet(false)} onAbout={() => { setSheet(false); setAbout(true); }} />}
      {about && <AboutModal onClose={() => setAbout(false)} />}
    </div>
  );
}

/** «Ordenar por» en la cabecera (pestaña Contactos en el móvil). */
function SortMenu() {
  const [sort, setSort] = useSortPref();
  const [open, setOpen] = useState(false);
  const label = sortOptions.find((o) => o.id === sort)?.label ?? "";
  return (
    <div className="relative mr-1">
      <button className="flex max-w-[11rem] items-center gap-1 rounded-full px-3 py-1.5 text-sm text-slate-600 active:bg-indigo-100" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <span className="truncate"><span className="text-slate-400">Ordenar por</span> <span className="font-medium text-slate-800">{label}</span></span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="currentColor" aria-hidden="true"><path d="M5.2 7.2a.75.75 0 0 1 1.06 0L10 10.94l3.74-3.74a.75.75 0 1 1 1.06 1.06l-4.27 4.27a.75.75 0 0 1-1.06 0L5.2 8.26a.75.75 0 0 1 0-1.06Z" /></svg>
      </button>
      {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />}
      {open && (
        <div role="menu" className="m3-sheet absolute right-0 top-full z-40 mt-1 w-56 overflow-hidden rounded-2xl py-1 shadow-lg ring-1 ring-black/5">
          {sortOptions.map((o) => (
            <button key={o.id} role="menuitemradio" aria-checked={sort === o.id} className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm ${sort === o.id ? "font-semibold text-indigo-800" : "text-slate-700"} active:bg-indigo-100`} onClick={() => { setSort(o.id); setOpen(false); }}>
              {o.label} {sort === o.id && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Hoja inferior con tu cuenta y el resto de opciones. Se cierra tocando fuera, con atrás o deslizando hacia abajo. */
function MoreSheet({ onClose, onAbout }: { onClose: () => void; onAbout: () => void }) {
  const logout = useLogout();
  const { data: me } = useMe();
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  const item = "flex h-13 min-h-[52px] w-full items-center gap-4 rounded-full px-4 text-left text-base active:bg-indigo-100";
  return (
    <>
      <div className="fixed inset-0 z-40 flex items-end bg-black/35" style={{ opacity: Math.max(0.2, 1 - dy / 400) }} onClick={onClose} role="dialog" aria-modal="true" aria-label="Tu cuenta y más opciones">
        <div
          className="m3-sheet max-h-[90dvh] w-full overflow-y-auto rounded-t-[28px] px-3 pb-[calc(16px+var(--sab))] pt-1"
          style={{ transform: dy ? `translateY(${dy}px)` : undefined, transition: start.current === null ? "transform .2s" : "none" }}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => { if ((e.currentTarget.scrollTop ?? 0) <= 0) start.current = e.touches[0]!.clientY; }}
          onTouchMove={(e) => { if (start.current !== null) setDy(Math.max(0, e.touches[0]!.clientY - start.current)); }}
          onTouchEnd={() => { const d = dy; start.current = null; if (d > 90) onClose(); else setDy(0); }}
        >
          <div className="flex justify-center py-2.5"><div className="h-1 w-8 rounded-full bg-slate-400/60" /></div>
          <Link to="/settings" className="mb-3 flex items-center gap-3 rounded-3xl px-3 py-2 active:bg-indigo-100">
            <UserAvatar me={me} size={48} />
            <span className="min-w-0">
              <span className="block text-base font-medium">{me?.name}</span>
              <span className="block truncate text-sm text-slate-500">{me?.email} · {getServer().replace(/^https?:\/\//, "")}</span>
            </span>
          </Link>
          <div className="mb-2 px-2"><ModeSelector /></div>
          <Link to="/tags" className={item}>🏷️ Etiquetas</Link>
          <Link to="/groups" className={item}>👪 Grupos</Link>
          <Link to="/trash" className={item}>🗑️ Papelera</Link>
          <Link to="/settings" className={item}>⚙️ Ajustes</Link>
          <div className="my-1 h-px bg-slate-200" />
          <button className={item} onClick={() => { setServer(null); void logout().then(() => window.location.reload()); }}>🔁 Cambiar de servidor</button>
          <button className={item} onClick={onAbout}>📒 Acerca de {APP_NAME}</button>
          <button className={`${item} text-red-700`} onClick={() => void logout()}>🚪 Salir</button>
          <p className="mt-2 px-4 text-xs text-slate-400">{APP_NAME} {APP_VERSION}</p>
        </div>
      </div>
    </>
  );
}
