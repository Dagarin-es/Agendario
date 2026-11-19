import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Visor de una imagen a pantalla completa: acercar con dos dedos, la rueda o doble toque; arrastrar
 * para moverla; cerrar con ✕, Esc, tocando el fondo o deslizando hacia abajo sin zoom.
 * `actions` son botones (p. ej. «Cambiar foto», «Quitar») que se muestran abajo.
 */
export function PhotoViewer({ src, alt = "", onClose, actions, round }: { src: string; alt?: string; onClose: () => void; actions?: ReactNode; round?: boolean }) {
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(0); // desplazamiento vertical para cerrar
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const reset = () => { setZoom(1); setOff({ x: 0, y: 0 }); };
  const down = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      const now = Date.now();
      if (now - lastTap.current < 300) { zoom > 1 ? reset() : setZoom(2.5); lastTap.current = 0; }
      else lastTap.current = now;
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), z: zoom };
    }
  };
  const move = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const z = Math.min(6, Math.max(1, pinch.current.z * (Math.hypot(a!.x - b!.x, a!.y - b!.y) / pinch.current.d)));
      setZoom(z);
      if (z === 1) setOff({ x: 0, y: 0 });
    } else if (pointers.current.size === 1) {
      if (zoom > 1) setOff((o) => ({ x: o.x + e.clientX - prev.x, y: o.y + e.clientY - prev.y }));
      else if (start.current) setDrag(Math.max(0, e.clientY - start.current.y));
    }
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      if (drag > 120) onClose();
      setDrag(0);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex flex-col bg-black text-white"
      style={{ paddingTop: "var(--sat, 0px)", paddingBottom: "var(--sab, 0px)", opacity: 1 - Math.min(0.6, drag / 400) }}
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Foto"}
    >
      <div className="flex justify-end p-2">
        <button className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-xl hover:bg-white/20" onClick={onClose} aria-label="Cerrar">✕</button>
      </div>
      <div
        className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => setZoom((z) => { const n = Math.min(6, Math.max(1, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); if (n === 1) setOff({ x: 0, y: 0 }); return n; })}
        onClick={(e) => { if (e.target === e.currentTarget && zoom === 1) onClose(); }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={`pointer-events-none max-h-full max-w-full object-contain ${round ? "rounded-2xl" : ""}`}
          style={{ transform: `translate(${off.x}px, ${off.y + drag}px) scale(${zoom})`, transition: pointers.current.size ? "none" : "transform .15s", background: "#f1f5f9" }}
        />
      </div>
      {actions && <div className="flex flex-wrap justify-center gap-2 p-4">{actions}</div>}
    </div>,
    document.body,
  );
}

export const viewerBtn = "rounded-full bg-white/15 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/25";
