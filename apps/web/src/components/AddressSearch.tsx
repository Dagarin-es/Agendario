import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { isGeolocated, type Address, type GeoSuggestion } from "@agendario/shared";
import { api } from "../lib/api";
import { addressLine } from "./MapLinks";

const MapPicker = lazy(() => import("./MapPicker"));

/** Botón «Ubicar en el mapa» con su ventana (se carga el mapa solo al abrirla). */
export function MapPickerButton({ address, onChange, className = "" }: { address: Address; onChange: (patch: Partial<Address>) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`btn shrink-0 rounded-lg border border-indigo-300 bg-white px-3 text-indigo-800 hover:bg-indigo-50 ${className}`} onClick={() => setOpen(true)} title="Abrir un mapa para colocar la chincheta en el sitio exacto">
        🗺️ <span className="hidden sm:inline">Ubicar en el mapa</span><span className="sm:hidden">Mapa</span>
      </button>
      {open && (
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 text-white">Abriendo el mapa…</div>}>
          <MapPicker address={address} onClose={() => setOpen(false)} onPick={(p) => { onChange(p); setOpen(false); }} />
        </Suspense>
      )}
    </>
  );
}

/** ¿Está activado el buscador de direcciones en el servidor? */
export function useGeocoder() {
  const { data } = useQuery({
    queryKey: ["geo-config"],
    queryFn: () => api.get<{ enabled: boolean }>("/geo/config"),
    staleTime: Infinity,
  });
  return data?.enabled ?? false;
}

/**
 * Buscador de direcciones de una dirección del formulario.
 * - Buscar: al elegir un resultado se rellenan los campos y se guardan las coordenadas.
 * - Geolocalizar (dirección ya escrita): busca con lo escrito y, al elegir, solo guarda las
 *   coordenadas y rellena los campos vacíos (no se pierden detalles como el piso o la puerta).
 */
export function AddressSearch({ address, onChange }: { address: Address; onChange: (patch: Partial<Address>) => void }) {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"fill" | "locate">("fill");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<GeoSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const geo = isGeolocated(address);
  const hasText = !!(address.street.trim() || address.city.trim() || address.postalCode.trim());

  async function run(text: string) {
    const id = ++seq.current;
    setLoading(true);
    setError("");
    try {
      const r = await api.get<GeoSuggestion[]>(`/geo/search?q=${encodeURIComponent(text)}`);
      if (id === seq.current) setResults(r);
    } catch (e) {
      if (id === seq.current) setError((e as Error).message);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }

  // Busca mientras escribes (con una pequeña espera para no lanzar una consulta por tecla)
  useEffect(() => {
    if (!open) return;
    const text = q.trim();
    if (text.length < 3) {
      setResults(null);
      return;
    }
    const t = window.setTimeout(() => void run(text), 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  // Cerrar al pulsar fuera
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  function locate() {
    setMode("locate");
    setQ(addressLine({ ...address, label: "" }));
    setOpen(true);
  }

  function pick(s: GeoSuggestion) {
    const fields = ["street", "city", "region", "postalCode", "country"] as const;
    const patch: Partial<Address> = { lat: s.lat, lon: s.lon };
    for (const f of fields) {
      if (!s[f]) continue;
      if (mode === "fill" || !address[f].trim()) patch[f] = s[f];
    }
    onChange(patch);
    setOpen(false);
    setQ("");
    setResults(null);
    setMode("fill");
  }

  return (
    <div ref={box} className="relative sm:col-span-2">
      <div className="flex gap-2">
        <input
          className="input"
          type="search"
          placeholder={mode === "locate" ? "Ajusta la búsqueda si no aparece…" : "🔍 Buscar dirección para rellenarla y geolocalizarla…"}
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter") {
              e.preventDefault(); // no enviar el formulario: elige el primer resultado
              if (results?.[0]) pick(results[0]);
            }
          }}
          aria-label="Buscar dirección"
        />
        {hasText && (
          <button type="button" className="btn shrink-0 rounded-lg border border-indigo-300 bg-white px-3 text-indigo-800 hover:bg-indigo-50" onClick={locate}
            title="Buscar las coordenadas de la dirección escrita">
            📍 <span className="hidden sm:inline">{geo ? "Volver a geolocalizar" : "Geolocalizar"}</span>
          </button>
        )}
        <MapPickerButton address={address} onChange={onChange} />
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-xs">
        {geo ? (
          <>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 ring-1 ring-emerald-200">📍 Geolocalizada</span>
            <span className="text-slate-400">{address.lat!.toFixed(5)}, {address.lon!.toFixed(5)}</span>
            <button type="button" className="text-slate-500 hover:underline" onClick={() => onChange({ lat: null, lon: null })}>Quitar coordenadas</button>
          </>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">Sin geolocalizar</span>
        )}
      </div>

      {open && q.trim().length >= 3 && (
        <div className="absolute inset-x-0 top-11 z-20 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-lg">
          {mode === "locate" && (
            <p className="border-b border-slate-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
              Elige el resultado correcto: se guardan sus coordenadas y solo se rellenan los campos vacíos.
            </p>
          )}
          {loading && !results && <p className="px-3 py-2.5 text-slate-500">Buscando…</p>}
          {error && <p className="px-3 py-2.5 text-red-600">{error}</p>}
          {results && results.length === 0 && !loading && (
            <p className="px-3 py-2.5 text-slate-500">Sin resultados. Prueba con menos datos (calle, número y ciudad).</p>
          )}
          {results?.map((s, i) => (
            <button key={i} type="button" className="block w-full border-t border-slate-100 px-3 py-2 text-left first:border-t-0 hover:bg-indigo-50" onClick={() => pick(s)}>
              📍 {s.label}
            </button>
          ))}
          <p className="border-t border-slate-100 px-3 py-1 text-right text-[10px] text-slate-400">Datos © OpenStreetMap</p>
        </div>
      )}
    </div>
  );
}
