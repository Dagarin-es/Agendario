import { useEffect, useId, useState, type ReactNode } from "react";
import { occasionLabels, type GiftIdea, type GiftReceived } from "@agendario/shared";
import { apiUrl } from "../lib/api";
import { euros, formatDate } from "../lib/format";

/**
 * Valoración de 0 a 5 estrellas con medias (se guarda como 0–10 medias estrellas).
 * Con `onChange` se puede tocar: la mitad izquierda de una estrella da media.
 */
export function StarRating({ value, onChange, size = 18, showNumber = true }: { value: number | null | undefined; onChange?: (v: number | null) => void; size?: number; showNumber?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const v = hover ?? value ?? 0;
  const pick = (i: number, e: React.MouseEvent<HTMLButtonElement> | React.PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return (i - 1) * 2 + (e.clientX - r.left < r.width / 2 ? 1 : 2);
  };
  const stars = [1, 2, 3, 4, 5].map((i) => {
    const fill = v >= i * 2 ? 1 : v >= i * 2 - 1 ? 0.5 : 0;
    const svg = (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <defs><clipPath id={`${uid}-${i}`}><rect width={24 * fill} height="24" /></clipPath></defs>
        <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" className="fill-slate-300" />
        <path clipPath={`url(#${uid}-${i})`} d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" fill="#f59e0b" />
      </svg>
    );
    if (!onChange) return <span key={i} className="inline-flex">{svg}</span>;
    return (
      <button
        key={i}
        type="button"
        className="inline-flex rounded p-0.5 focus-visible:outline-2 focus-visible:outline-indigo-500"
        onPointerMove={(e) => e.pointerType === "mouse" && setHover(pick(i, e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => { const n = pick(i, e); onChange(n === value ? null : n); setHover(null); }}
        aria-label={`${i - 0.5} o ${i} estrellas`}
      >
        {svg}
      </button>
    );
  });
  const label = value == null ? "Sin valorar" : `${String(value / 2).replace(".", ",")} de 5 estrellas`;
  return (
    <span className="inline-flex items-center gap-0.5" role={onChange ? "group" : "img"} aria-label={label}>
      {stars}
      {showNumber && value != null && <b className="ml-1.5 text-xs font-semibold text-amber-800">{String(v / 2).replace(".", ",")}</b>}
      {onChange && value != null && (
        <button type="button" className="ml-2 text-xs text-slate-400 hover:text-red-700" onClick={() => onChange(null)}>Quitar</button>
      )}
    </span>
  );
}

/**
 * Elegir una imagen al crear o editar (aún sin subir). Muestra la que hay (`current`) o la elegida.
 * `onChange(file)` = nueva; `onChange(null)` con `onRemove` = quitar la actual.
 */
export function ImagePicker({ current, file, onChange, onRemove, hint, label = "📷 Añadir imagen" }: { current?: string | null; file: File | null; onChange: (f: File | null) => void; onRemove?: () => void; hint?: ReactNode; label?: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const shown = preview ?? current ?? null;
  return (
    <div className="flex items-center gap-3">
      <span className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl ${shown ? "border border-slate-200 bg-white" : "border-2 border-dashed border-slate-300 bg-slate-50 text-2xl text-slate-300"}`}>
        {shown ? <img src={shown} alt="" className="h-full w-full object-cover" /> : <span aria-hidden="true">🖼️</span>}
      </span>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap gap-2">
          <label className="btn-ghost cursor-pointer border border-slate-200 bg-indigo-50 text-indigo-800">
            {shown ? "📷 Cambiar" : label}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange(f); e.target.value = ""; }} />
          </label>
          {file && <button type="button" className="btn-ghost text-sm" onClick={() => onChange(null)}>Deshacer</button>}
          {!file && current && onRemove && <button type="button" className="btn-ghost text-sm text-red-700" onClick={onRemove}>Quitar</button>}
        </div>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

/** Texto del evento de un regalo: «Cumpleaños 2026», «Navidad»… */
export function eventText(g: Pick<GiftIdea, "eventLabel" | "occasion">) {
  return g.eventLabel || (g.occasion ? occasionLabels[g.occasion] : "");
}

const tones = ["from-amber-200 to-rose-300", "from-emerald-200 to-cyan-200", "from-violet-200 to-pink-200", "from-sky-200 to-indigo-200", "from-pink-200 to-amber-200"];
const toneOf = (id: string) => tones[[...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % tones.length];

/** Foto grande de un regalo (o un 🎁 sobre degradado si no tiene). */
export function GiftPhoto({ src, id, emoji = "🎁", size = 84, onClick }: { src: string | null; id: string; emoji?: string; size?: number; onClick?: () => void }) {
  const inner = src
    ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
    : <span className={`flex h-full w-full items-center justify-center bg-linear-to-br ${toneOf(id)} text-3xl`} aria-hidden="true">{emoji}</span>;
  const cls = "shrink-0 overflow-hidden rounded-xl border border-slate-200/70";
  return onClick
    ? <button type="button" onClick={onClick} className={cls} style={{ width: size, height: size }} title="Ver en grande">{inner}</button>
    : <span className={cls} style={{ width: size, height: size }}>{inner}</span>;
}

export const givenImage = (g: GiftIdea, size: "thumb" | "full" = "thumb") => (g.imageKey ? apiUrl(`/gift-ideas/${g.id}/image?size=${size}&v=${g.imageKey}`) : null);
export const receivedImage = (g: GiftReceived, size: "thumb" | "full" = "thumb") => (g.imageKey ? apiUrl(`/gifts-received/${g.id}/image?size=${size}&v=${g.imageKey}`) : null);

/** Tarjeta de un regalo hecho: foto, qué, evento, fecha, precio, estrellas y anotación. */
export function GivenGiftRow({ g, extra, actions, onPhoto }: { g: GiftIdea; extra?: ReactNode; actions?: ReactNode; onPhoto?: () => void }) {
  const ev = eventText(g);
  return (
    <div className="flex gap-3">
      <GiftPhoto src={givenImage(g)} id={g.id} onClick={onPhoto} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 font-semibold leading-snug text-slate-900">
            {g.url ? <a href={g.url} target="_blank" rel="noreferrer" className="hover:text-indigo-700">{g.title} ↗</a> : g.title}
          </p>
          {actions}
        </div>
        {extra}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
          {ev && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">{ev}</span>}
          {(g.givenAt || g.priceCents != null) && <span className="whitespace-nowrap">{[g.givenAt ? formatDate(g.givenAt) : "", g.priceCents != null ? euros(g.priceCents) : ""].filter(Boolean).join(" · ")}</span>}
        </p>
        {g.rating != null && <div className="mt-1"><StarRating value={g.rating} size={17} /></div>}
        {g.givenNote && <p className="mt-1.5 whitespace-pre-line rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700">{g.givenNote}</p>}
      </div>
    </div>
  );
}

/** Tarjeta de un regalo recibido: foto, qué, motivo, fecha, de quién, estrellas y notas. */
export function ReceivedGiftRow({ g, from, actions, onPhoto }: { g: GiftReceived; from?: ReactNode; actions?: ReactNode; onPhoto?: () => void }) {
  return (
    <div className="flex gap-3">
      <GiftPhoto src={receivedImage(g)} id={g.id} emoji="🎀" onClick={onPhoto} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 font-semibold leading-snug text-slate-900">{g.description}</p>
          {actions}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
          {g.occasion && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">{occasionLabels[g.occasion]}</span>}
          {g.receivedAt && <span>{formatDate(g.receivedAt)}</span>}
        </p>
        {from && <p className="mt-0.5 text-xs text-slate-500">{from}</p>}
        {g.rating != null && <div className="mt-1"><StarRating value={g.rating} size={17} /></div>}
        {g.notes && <p className="mt-1.5 whitespace-pre-line rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700">{g.notes}</p>}
      </div>
    </div>
  );
}

/** Pestañas con emoji y contador (recuadro Regalos de la ficha). */
export function MiniTabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; emoji: string; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`m3-subtab is-compact inline-flex items-center justify-center gap-1 ${value === t.id ? "is-on" : ""}`}
        >
          <span aria-hidden="true">{t.emoji}</span>{t.label}
          {!!t.count && <span className="ml-0.5 opacity-75">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
