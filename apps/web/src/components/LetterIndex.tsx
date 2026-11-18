import { useEffect, useRef, useState } from "react";
import { haptic } from "../lib/native";

const ALL = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "Ñ", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "#"];
const MIN_ROW = 15; // px por letra como mínimo para poder tocarla

/**
 * Índice de iniciales (app de Android): franja translúcida pegada al borde derecho. Se toca o se desliza
 * el dedo; una burbuja enseña la letra. Si no caben todas, se saltan algunas y se ponen puntos.
 */
export function LetterIndex({ present, onJump }: { present: Set<string>; onJump: (l: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(500);
  const [active, setActive] = useState<string | null>(null);
  const last = useRef<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Filas a mostrar: todas si caben; si no, una de cada n con «•» entre medias
  const fit = Math.max(5, Math.floor((h - 12) / MIN_ROW));
  let rows: (string | null)[] = ALL;
  if (fit < ALL.length) {
    const keep = Math.ceil(fit / 2);
    const step = (ALL.length - 1) / (keep - 1);
    rows = [];
    for (let i = 0; i < keep; i++) {
      rows.push(ALL[Math.round(i * step)]!);
      if (i < keep - 1) rows.push(null);
    }
  }
  const letterAt = (y: number) => {
    const r = ref.current!.getBoundingClientRect();
    const f = Math.min(0.9999, Math.max(0, (y - r.top - 6) / (r.height - 12)));
    return ALL[Math.floor(f * ALL.length)]!;
  };
  const go = (y: number) => {
    const l = letterAt(y);
    setActive(l);
    if (l !== last.current) {
      last.current = l;
      void haptic();
      onJump(l);
    }
  };
  return (
    <div
      ref={ref}
      className="letter-index m3-index fixed right-0 z-10 flex w-[30px] touch-none select-none flex-col items-center justify-between rounded-l-2xl py-1.5"
      style={{ top: "calc(var(--header-h, 56px) + 118px)", bottom: "calc(160px + var(--sab, 0px))" }}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); go(e.clientY); }}
      onPointerMove={(e) => { if (e.buttons || e.pointerType === "touch") go(e.clientY); }}
      onPointerUp={() => { setActive(null); last.current = null; }}
      onPointerCancel={() => { setActive(null); last.current = null; }}
      aria-label="Índice por iniciales"
      role="navigation"
    >
      {rows.map((l, i) =>
        l ? (
          <span key={l} className={`text-[13px] font-bold leading-none ${present.has(l) ? "text-indigo-800" : "text-slate-400/60"}`}>{l}</span>
        ) : (
          <span key={`d${i}`} className="text-[10px] leading-none text-slate-400" aria-hidden="true">•</span>
        ),
      )}
      {active && (
        <span className="pointer-events-none fixed right-12 top-1/2 flex h-16 w-16 -translate-y-1/2 items-center justify-center rounded-full bg-indigo-700 text-3xl font-bold text-white shadow-xl">
          {active}
        </span>
      )}
    </div>
  );
}
