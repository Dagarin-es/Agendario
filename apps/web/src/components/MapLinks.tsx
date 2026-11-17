import { lazy, Suspense, useState } from "react";
import { copyText } from "../lib/clipboard";
import { geoStatusLabels, isGeolocated, type Address, type GeoStatus } from "@agendario/shared";

/** Texto de la dirección en una línea. */
export const addressLine = (a: Address) =>
  [a.street, [a.postalCode, a.city].filter(Boolean).join(" "), a.region, a.country].filter(Boolean).join(", ");

type Platform = "android" | "ios" | "desktop";
function platform(): Platform {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  // iPadOS se presenta como Mac, pero con pantalla táctil
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return "desktop";
}

type App = "google" | "apple" | "waze" | "osm";
const appLabels: Record<App, string> = { google: "Google Maps", apple: "Apple Maps", waze: "Waze", osm: "OpenStreetMap" };

function linkFor(app: App | "geo", a: Address): string {
  const geo = isGeolocated(a);
  const ll = geo ? `${a.lat},${a.lon}` : "";
  const q = encodeURIComponent(addressLine(a));
  switch (app) {
    case "geo": // Android: abre el selector de apps de mapas (Google Maps, Waze, Organic Maps…)
      return geo ? `geo:${ll}?q=${ll}(${encodeURIComponent(a.label || addressLine(a))})` : `geo:0,0?q=${q}`;
    case "google":
      return `https://www.google.com/maps/search/?api=1&query=${geo ? ll : q}`;
    case "apple":
      return geo ? `https://maps.apple.com/?ll=${ll}&q=${encodeURIComponent(a.label || addressLine(a))}` : `https://maps.apple.com/?q=${q}`;
    case "waze":
      return geo ? `https://waze.com/ul?ll=${ll}&navigate=yes` : `https://waze.com/ul?q=${q}&navigate=yes`;
    case "osm":
      return geo ? `https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lon}#map=17/${a.lat}/${a.lon}` : `https://www.openstreetmap.org/search?query=${q}`;
  }
}

/** Botón «Abrir en mapa» (se adapta al dispositivo) con menú ▾ para elegir otra app. */
export function MapLinks({ address }: { address: Address }) {
  const [open, setOpen] = useState(false);
  const p = platform();
  const main = p === "android" ? linkFor("geo", address) : linkFor(p === "ios" ? "apple" : "google", address);
  const others: App[] = p === "ios" ? ["google", "waze", "osm"] : p === "android" ? ["google", "waze", "osm"] : ["google", "apple", "waze", "osm"];
  const ext = { target: "_blank", rel: "noreferrer" };

  return (
    <span className="relative inline-flex align-middle">
      <a
        href={main}
        {...(main.startsWith("http") ? ext : {})}
        className="inline-flex items-center gap-1 rounded-l-lg border border-indigo-200 bg-white px-2 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-50"
        title={p === "android" ? "Abrir con tu app de mapas" : `Abrir en ${p === "ios" ? "Apple Maps" : "Google Maps"}`}
      >
        🗺️ Abrir en mapa
      </a>
      <button
        type="button"
        className="rounded-r-lg border border-l-0 border-indigo-200 bg-white px-1.5 text-indigo-800 hover:bg-indigo-50"
        onClick={() => setOpen(!open)}
        aria-label="Abrir con otra app"
        aria-expanded={open}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true"><path d="M5.2 7.2a.75.75 0 0 1 1.06 0L10 10.94l3.74-3.74a.75.75 0 1 1 1.06 1.06l-4.27 4.27a.75.75 0 0 1-1.06 0L5.2 8.26a.75.75 0 0 1 0-1.06Z" /></svg>
      </button>
      {open && <span className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}
      {open && (
        <span className="absolute right-0 top-full z-20 mt-1 block w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg">
          <span className="block px-4 pb-1 pt-1.5 text-[11px] font-semibold uppercase text-slate-400">Abrir con…</span>
          {others.map((app) => (
            <a key={app} href={linkFor(app, address)} {...ext} className="block px-4 py-2 hover:bg-slate-50" onClick={() => setOpen(false)}>
              {appLabels[app]}
            </a>
          ))}
          <button
            type="button"
            className="block w-full border-t border-slate-100 px-4 py-2 text-left text-slate-600 hover:bg-slate-50"
            onClick={() => {
              void copyText(addressLine(address));
              setOpen(false);
            }}
          >
            📋 Copiar dirección
          </button>
        </span>
      )}
    </span>
  );
}

/** Mapa pequeño de OpenStreetMap con la chincheta de la dirección. */
const MiniMapView = lazy(() => import("./MapPicker").then((m) => ({ default: m.MiniMapView })));

export function MiniMap({ address }: { address: Address }) {
  if (!isGeolocated(address)) return null;
  return (
    <Suspense fallback={<div className="mt-2 h-44 w-full rounded-lg border border-slate-200 bg-slate-100" />}>
      <MiniMapView lat={address.lat!} lon={address.lon!} title={`Mapa de ${addressLine(address)}`} />
    </Suspense>
  );
}

/** Icono del estado de geolocalización de un contacto (lista principal). */
export function GeoIcon({ status }: { status: GeoStatus }) {
  const styles: Record<GeoStatus, string> = {
    full: "text-emerald-600",
    partial: "text-amber-500",
    missing: "text-red-500",
    none: "text-slate-300",
  };
  const filled = status === "full" || status === "partial";
  return (
    <span className={`inline-flex shrink-0 ${styles[status]}`} title={geoStatusLabels[status]} aria-label={geoStatusLabels[status]} role="img">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? 0 : 2} aria-hidden="true">
        <path d="M12 2.5c-3.9 0-7 3-7 6.9 0 5 6.2 11.4 6.5 11.7.3.3.7.3 1 0 .3-.3 6.5-6.7 6.5-11.7 0-3.9-3.1-6.9-7-6.9Z" />
        {filled ? <circle cx="12" cy="9.4" r="2.6" fill="white" /> : <circle cx="12" cy="9.4" r="2.4" />}
        {status === "none" && <path d="M4 4l16 16" strokeWidth={2} />}
      </svg>
      {status === "partial" && <span className="-ml-1 self-end text-[9px] font-bold">½</span>}
    </span>
  );
}
