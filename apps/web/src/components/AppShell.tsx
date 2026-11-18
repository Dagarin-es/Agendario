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
import { apiUrl } from "../lib/api";
import { getServer, setServer } from "../lib/platform";
import { haptic } from "../lib/native";
import { ModeSelector, useColorThemeFromPrefs, useThemeIcon } from "./Personalize";
import { UserAvatar } from "./UserAvatar";

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
  back: () => <I d={<path d="M19 12H5M11 18l-6-6 6-6" />} />,
  add: () => <I d={<path d="M12 5v14M5 12h14" strokeWidth={2.2} />} />,
};

const tabs = [
  { to: "/", end: true, label: "Contactos", icon: icons.contacts },
  { to: "/upcoming", label: "Fechas", icon: icons.event },
  { to: "/duplicates", label: "Duplicados", icon: icons.merge },
] as const;

const titles: [RegExp, string][] = [
  [/^\/$/, "Contactos"],
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

export function AppShell() {
  const location = useLocation();
  const nav = useNavigate();
  const { data: me } = useMe();
  const dupCount = useDuplicateCount();
  const gifts = useGiftsToBuy();
  const pending = usePendingGifts().data?.length ?? 0;
  const [sheet, setSheet] = useState(false);
  useColorThemeFromPrefs();
  const icon = useThemeIcon();
  const headerRef = useRef<HTMLElement>(null);
  const isTab = tabs.some((t) => location.pathname === t.to);
  const title = titles.find(([re]) => re.test(location.pathname))?.[1] ?? APP_NAME;

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

  const badge = (to: string) =>
    to === "/duplicates" ? (dupCount > 0 ? String(dupCount) : null) : to === "/upcoming" ? (gifts.count + pending > 0 ? String(gifts.count + pending) : null) : null;

  return (
    <div className="m3 flex min-h-dvh flex-col">
      {/* Barra superior: baja y siempre «Agendario» (la sección ya se ve en la barra de abajo) */}
      <header ref={headerRef} className={`sticky top-0 z-20 flex h-[calc(3.25rem+var(--sat))] items-center gap-1 px-1 pt-[var(--sat)] transition-colors ${scrolled ? "m3-surface-2" : "m3-surface"}`}>
        {isTab ? (
          <img src={icon} alt="" className="mx-2.5 h-7 w-7" />
        ) : (
          <button className="m3-icon-btn" onClick={() => nav(-1)} aria-label="Atrás">{icons.back()}</button>
        )}
        <span className="min-w-0 flex-1 truncate text-[20px] font-medium tracking-tight text-indigo-950">{APP_NAME}</span>
        <h1 className="sr-only">{title}</h1>
      </header>

      {me?.mustChangePassword && (
        <Link to="/settings" className="mx-4 mt-2 rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-900">🔑 Estás usando una contraseña provisional: cámbiala en Ajustes.</Link>
      )}

      <main className="flex-1 px-4 pb-[calc(104px+var(--sab))] pt-1">
        <Outlet />
      </main>

      {/* Botón flotante: nuevo contacto */}
      {location.pathname === "/" && (
        <Link to="/contacts/new" onClick={() => void haptic()} className="m3-fab fixed bottom-[calc(92px+var(--sab))] right-4 z-20" aria-label="Nuevo contacto">
          {icons.add()} <span className="pr-1 text-sm font-medium">Nuevo</span>
        </Link>
      )}

      {/* Barra de navegación: píldora flotante translúcida */}
      <nav className="m3-pill fixed bottom-[calc(12px+var(--sab))] left-1/2 z-20 grid w-[min(calc(100vw-24px),420px)] -translate-x-1/2 grid-cols-4" aria-label="Navegación principal">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={"end" in t} onClick={() => void haptic()} className="m3-nav-item">
            {({ isActive }) => (
              <>
                <span className={`m3-nav-indicator ${isActive ? "is-active" : ""}`}>
                  {t.icon(isActive)}
                  {badge(t.to) && <span className={`m3-badge ${t.to === "/upcoming" && gifts.red ? "bg-red-600" : t.to === "/upcoming" ? "bg-amber-600" : "bg-red-600"}`}>{badge(t.to)}</span>}
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
      </nav>

      {sheet && <MoreSheet onClose={() => setSheet(false)} />}
    </div>
  );
}

/** Hoja inferior con el resto de opciones. */
function MoreSheet({ onClose }: { onClose: () => void }) {
  const logout = useLogout();
  const { data: me } = useMe();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  const item = "flex h-14 w-full items-center gap-4 rounded-full px-4 text-left text-base active:bg-indigo-100";
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/35" onClick={onClose} role="dialog" aria-modal="true" aria-label="Más opciones">
      <div className="m3-sheet w-full rounded-t-[28px] px-3 pb-[calc(16px+var(--sab))] pt-3" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-8 rounded-full bg-slate-400/60" />
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
        <Link to="/import" className={item}>📥 Importar .vcf</Link>
        <a href={apiUrl("/export/contacts.vcf")} className={item}>📤 Exportar .vcf</a>
        <Link to="/settings" className={item}>⚙️ Ajustes</Link>
        <div className="my-1 h-px bg-slate-200" />
        <button className={item} onClick={() => { setServer(null); void logout().then(() => window.location.reload()); }}>🔁 Cambiar de servidor</button>
        <button className={`${item} text-red-700`} onClick={() => void logout()}>🚪 Salir</button>
        <p className="mt-2 px-4 text-xs text-slate-400">{APP_NAME} {APP_VERSION}</p>
      </div>
    </div>
  );
}
