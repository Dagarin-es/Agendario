import { useEffect, useRef, useState } from "react";
import { Modal } from "./Dialogs";

const OUT = 1024; // lado del recorte final

/**
 * Recortar una foto en cuadrado antes de subirla: arrastrar para encuadrar, acercar (rueda, pellizco
 * o barra) y girar. Conserva la transparencia (sale en PNG; el servidor la pasa a JPEG si no la tiene).
 */
export function PhotoCropper({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (f: File) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Tamaño de la imagen (girada) para que cubra el cuadrado con zoom 1
  const rotated = rot % 180 !== 0;
  const iw = img ? (rotated ? img.naturalHeight : img.naturalWidth) : 1;
  const ih = img ? (rotated ? img.naturalWidth : img.naturalHeight) : 1;
  const cover = (side: number) => (side / Math.min(iw, ih)) * zoom;

  const clampOff = (o: { x: number; y: number }, side: number) => {
    const s = cover(side);
    const mx = Math.max(0, (iw * s - side) / 2);
    const my = Math.max(0, (ih * s - side) / 2);
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  };
  const side = () => box.current?.clientWidth ?? 300;
  useEffect(() => setOff((o) => clampOff(o, side())), [zoom, rot, img]); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      setZoom(Math.min(5, Math.max(1, pinch.current.z * (d / pinch.current.d))));
    } else if (pointers.current.size === 1) {
      setOff((o) => clampOff({ x: o.x + e.clientX - prev.x, y: o.y + e.clientY - prev.y }, side()));
    }
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const save = async () => {
    if (!img) return;
    setBusy(true);
    const c = document.createElement("canvas");
    c.width = c.height = OUT;
    const ctx = c.getContext("2d")!;
    const k = OUT / side();
    const s = cover(OUT);
    ctx.translate(OUT / 2 + off.x * k, OUT / 2 + off.y * k);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(img, (-img.naturalWidth * s) / 2, (-img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    setBusy(false);
    if (blob) onDone(new File([blob], "foto.png", { type: "image/png" }));
  };

  const sz = side();
  const s = cover(sz);
  return (
    <Modal title="Encuadrar la foto" onClose={onCancel}>
      <div className="space-y-4 p-4">
        <div
          ref={box}
          className="relative mx-auto aspect-square w-full max-w-[360px] touch-none select-none overflow-hidden rounded-2xl"
          style={{ background: "repeating-conic-gradient(#e2e8f0 0% 25%, #f8fafc 0% 50%) 50% / 20px 20px", cursor: "grab" }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onWheel={(e) => setZoom((z) => Math.min(5, Math.max(1, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))))}
        >
          {img && (
            <img
              src={img.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
              style={{
                width: img.naturalWidth * s,
                height: img.naturalHeight * s,
                transform: `translate(-50%, -50%) translate(${off.x}px, ${off.y}px) rotate(${rot}deg)`,
              }}
            />
          )}
          {/* Así se verá: círculo */}
          <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/80" style={{ boxShadow: "0 0 0 9999px rgb(15 23 42 / .45)" }} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500" aria-hidden="true">🔍</span>
          <input type="range" min={1} max={5} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1" aria-label="Acercar" />
          <button type="button" className="btn-ghost border border-slate-200 px-3 text-sm" onClick={() => setRot((r) => (r + 90) % 360)}>↻ Girar</button>
        </div>
        <p className="text-xs text-slate-500">Arrastra para encuadrar; acerca con la barra, la rueda del ratón o pellizcando.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancelar</button>
          <button type="button" className="btn-primary" disabled={!img || busy} onClick={() => void save()}>{busy ? "Preparando…" : "Usar foto"}</button>
        </div>
      </div>
    </Modal>
  );
}
