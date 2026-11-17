import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Address, GeoSuggestion } from "@agendario/shared";
import { api } from "../lib/api";
import { addressLine } from "./MapLinks";

/** Capas de mapa disponibles (sin claves ni registro). La elegida se recuerda en cada dispositivo. */
type LayerDef = { id: string; name: string; hint: string; tiles: { url: string; maxNativeZoom?: number; subdomains?: string }[]; attribution: string };

export const mapLayers: LayerDef[] = [
  {
    id: "callejero",
    name: "Callejero",
    hint: "Calles claras y legibles (Esri)",
    tiles: [{ url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", maxNativeZoom: 19 }],
    attribution: "Mapa © Esri, HERE, Garmin, © OpenStreetMap",
  },
  {
    id: "ign",
    name: "IGN España",
    hint: "Mapa base del Instituto Geográfico Nacional (solo España)",
    tiles: [
      {
        url: "https://www.ign.es/wmts/ign-base?request=GetTile&service=WMTS&VERSION=1.0.0&Layer=IGNBaseTodo&Style=default&Format=image/png&TileMatrixSet=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}",
        maxNativeZoom: 20,
      },
    ],
    attribution: 'Mapa base © <a href="https://www.ign.es">Instituto Geográfico Nacional</a>',
  },
  {
    id: "osm",
    name: "OpenStreetMap",
    hint: "El mapa clásico, con portales",
    tiles: [{ url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxNativeZoom: 19 }],
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  {
    id: "satelite",
    name: "Satélite",
    hint: "Foto aérea con calles y nombres",
    tiles: [
      { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", maxNativeZoom: 19 },
      { url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", maxNativeZoom: 19 },
      { url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", maxNativeZoom: 19 },
    ],
    attribution: "Imágenes © Esri, Maxar, Earthstar Geographics",
  },
  {
    id: "pnoa",
    name: "Ortofoto PNOA",
    hint: "Foto aérea del IGN (solo España), muy nítida",
    tiles: [
      {
        url: "https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&VERSION=1.0.0&Layer=OI.OrthoimageCoverage&Style=default&Format=image/jpeg&TileMatrixSet=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}",
        maxNativeZoom: 20,
      },
    ],
    attribution: 'PNOA cedido por © <a href="https://www.ign.es">Instituto Geográfico Nacional</a>',
  },
];

const LAYER_KEY = "agendario.mapLayer";
export function loadLayerId(): string {
  try {
    const v = localStorage.getItem(LAYER_KEY);
    return mapLayers.some((l) => l.id === v) ? v! : "callejero";
  } catch {
    return "callejero";
  }
}
function saveLayerId(id: string) {
  try {
    localStorage.setItem(LAYER_KEY, id);
  } catch {
    /* solo en esta sesión */
  }
}

/** Pone la capa en el mapa (quitando la anterior). */
export function applyLayer(map: L.Map, id: string, current: L.LayerGroup | null, onFail?: () => void): L.LayerGroup {
  current?.remove();
  const def = mapLayers.find((l) => l.id === id) ?? mapLayers[0]!;
  let errors = 0;
  let loaded = 0;
  const group = L.layerGroup(
    def.tiles.map((t, i) =>
      L.tileLayer(t.url, {
        maxZoom: 20,
        maxNativeZoom: t.maxNativeZoom ?? 19,
        subdomains: t.subdomains ?? "abc",
        attribution: i === 0 ? def.attribution : undefined,
        detectRetina: false,
      }),
    ),
  );
  // Si la capa no carga (servicio caído o que ahora pide clave), se pasa a OpenStreetMap
  group.eachLayer((l) => {
    (l as L.TileLayer).on("tileload", () => loaded++);
    (l as L.TileLayer).on("tileerror", () => {
      errors++;
      if (errors === 4 && loaded === 0 && def.id !== "osm") {
        group.remove();
        onFail?.();
      }
    });
  });
  group.addTo(map);
  return group;
}

/** Chincheta con los colores de la app (sin imágenes externas). */
export const pinIcon = L.divIcon({
  className: "",
  html: `<svg viewBox="0 0 32 44" width="34" height="46" style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))"><path d="M16 1C8 1 1.5 7.3 1.5 15.2 1.5 26 16 43 16 43s14.5-17 14.5-27.8C30.5 7.3 24 1 16 1Z" fill="#4338ca" stroke="#fff" stroke-width="2"/><circle cx="16" cy="15" r="5.5" fill="#fde047"/></svg>`,
  iconSize: [34, 46],
  iconAnchor: [17, 45],
});

const SPAIN: L.LatLngTuple = [40.2, -3.7];

/**
 * Mapa para ubicar una dirección: busca, arrastra la chincheta (o toca el mapa) hasta el
 * portal exacto y acepta. Las coordenadas las marcas tú, así que son tuyas sin limitaciones.
 */
export function MapPicker({
  address, onClose, onPick,
}: { address: Address; onClose: () => void; onPick: (patch: Partial<Address>) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [layerId, setLayerId] = useState(loadLayerId);
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(
    address.lat != null && address.lon != null ? { lat: address.lat, lon: address.lon } : null,
  );
  const [q, setQ] = useState(addressLine({ ...address, label: "" }));
  const [results, setResults] = useState<GeoSuggestion[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [fill, setFill] = useState<GeoSuggestion | null>(null);
  const [locating, setLocating] = useState(false);

  function place(lat: number, lon: number, zoom?: number) {
    const m = map.current;
    if (!m) return;
    setPos({ lat, lon });
    if (!marker.current) {
      marker.current = L.marker([lat, lon], { draggable: true, icon: pinIcon, autoPan: true }).addTo(m);
      marker.current.on("dragend", () => {
        const ll = marker.current!.getLatLng();
        setPos({ lat: ll.lat, lon: ll.lng });
        setFill(null);
      });
    } else marker.current.setLatLng([lat, lon]);
    if (zoom) m.setView([lat, lon], zoom);
  }

  // Crear el mapa
  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView(pos ? [pos.lat, pos.lon] : SPAIN, pos ? 18 : 6);
    map.current = m;
    layer.current = applyLayer(m, layerId, null, () => setLayerId("osm"));
    m.on("click", (e: L.LeafletMouseEvent) => {
      place(e.latlng.lat, e.latlng.lng);
      setFill(null);
    });
    if (pos) place(pos.lat, pos.lon);
    // Si no tiene coordenadas, se busca lo escrito para acercarse a la zona
    else if (q.trim().length >= 3) void search(q, true);
    const t = window.setTimeout(() => m.invalidateSize(), 120);
    return () => {
      window.clearTimeout(t);
      m.remove();
      map.current = null;
      marker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map.current) return;
    layer.current = applyLayer(map.current, layerId, layer.current, () => setLayerId("osm"));
    saveLayerId(layerId);
  }, [layerId]);

  // Escape cierra; el fondo no se desplaza mientras está abierto
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function search(text: string, auto = false) {
    if (text.trim().length < 3) return;
    setSearching(true);
    setError("");
    try {
      const r = await api.get<GeoSuggestion[]>(`/geo/search?q=${encodeURIComponent(text.trim())}`);
      setResults(r);
      // Al abrir sin coordenadas, se va directo al primer resultado (con la chincheta ahí)
      if (auto && r[0]) {
        place(r[0].lat, r[0].lon, 18);
        setResults(r.length > 1 ? r : null);
      }
      if (!auto && r.length === 0) setError("Sin resultados. Prueba con menos datos, o mueve el mapa y toca el sitio.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  function choose(s: GeoSuggestion) {
    place(s.lat, s.lon, 18);
    setResults(null);
    setFill(s);
  }

  function myLocation() {
    if (!navigator.geolocation) return setError("Este navegador no da la ubicación.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { place(p.coords.latitude, p.coords.longitude, 18); setFill(null); setLocating(false); },
      () => { setError("No se ha podido obtener tu ubicación (hace falta HTTPS y permiso)."); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function accept() {
    if (!pos) return;
    const patch: Partial<Address> = { lat: Number(pos.lat.toFixed(7)), lon: Number(pos.lon.toFixed(7)) };
    // Si se eligió un resultado del buscador, se rellenan solo los campos vacíos
    if (fill) for (const f of ["street", "city", "region", "postalCode", "country"] as const) if (fill[f] && !address[f].trim()) patch[f] = fill[f];
    onPick(patch);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Ubicar en el mapa">
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white shadow-xl sm:h-[85vh] sm:rounded-2xl">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5">
          <h2 className="flex-1 font-semibold text-indigo-950">🗺️ Ubicar en el mapa</h2>
          <button type="button" className="btn-ghost px-2" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="relative border-b border-slate-200 px-3 py-2">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(q); }}>
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar dirección o lugar…" aria-label="Buscar en el mapa" />
            <button className="btn-primary shrink-0" disabled={searching}>{searching ? "…" : "Buscar"}</button>
          </form>
          {results && results.length > 0 && (
            <div className="absolute inset-x-3 top-full z-[1000] mt-1 max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white text-sm shadow-lg">
              {results.map((s, i) => (
                <button key={i} type="button" className="block w-full border-t border-slate-100 px-3 py-2 text-left first:border-t-0 hover:bg-indigo-50" onClick={() => choose(s)}>
                  📍 {s.label}
                </button>
              ))}
              <button type="button" className="block w-full border-t border-slate-100 px-3 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50" onClick={() => setResults(null)}>Cerrar resultados</button>
            </div>
          )}
          {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
        </div>

        <div className="relative flex-1">
          <div ref={box} className="absolute inset-0 isolate z-0" />
          {/* Selector de capa */}
          <div className="absolute right-2 top-2 z-[500] flex flex-col gap-1 rounded-xl bg-white/95 p-1 text-xs shadow-md ring-1 ring-slate-200">
            {mapLayers.map((l) => (
              <button
                key={l.id}
                type="button"
                title={l.hint}
                onClick={() => setLayerId(l.id)}
                className={`rounded-lg px-2.5 py-1.5 text-left font-medium ${layerId === l.id ? "bg-indigo-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}
              >
                {l.name}
              </button>
            ))}
          </div>
          <button type="button" onClick={myLocation} className="absolute bottom-6 right-2 z-[500] rounded-full bg-white px-3 py-2 text-xs font-medium text-indigo-800 shadow-md ring-1 ring-slate-200 hover:bg-indigo-50" title="Centrar en donde estoy ahora">
            {locating ? "Buscando…" : "◎ Estoy aquí"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2.5">
          <p className="min-w-0 flex-1 text-xs text-slate-500">
            {pos ? (
              <>Arrastra la chincheta o toca el mapa para afinar · <span className="tabular-nums">{pos.lat.toFixed(6)}, {pos.lon.toFixed(6)}</span></>
            ) : (
              "Busca la dirección o toca el mapa donde está."
            )}
          </p>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn-primary" disabled={!pos} onClick={accept}>Guardar ubicación</button>
        </div>
      </div>
    </div>
  );
}

/** Mapa pequeño de la ficha (con la capa que elegiste), sin arrastrar para no estorbar al desplazarte. */
export function MiniMapView({ lat, lon, title }: { lat: number; lon: number; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false }).setView([lat, lon], 17);
    applyLayer(m, loadLayerId(), null, () => applyLayer(m, "osm", null));
    L.marker([lat, lon], { icon: pinIcon, interactive: false }).addTo(m);
    return () => { m.remove(); };
  }, [lat, lon]);
  return <div ref={box} role="img" aria-label={title} className="isolate z-0 mt-2 h-44 w-full overflow-hidden rounded-lg border border-slate-200" />;
}

export default MapPicker;
