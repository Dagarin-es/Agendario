import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { capLabel } from "../lib/text";
export { capLabel };
import { keepInView } from "../lib/keepInView";
import { useConfirm } from "./Dialogs";
import { useUserPrefs } from "./QuickActions";

export type LabelKind = "phones" | "emails" | "urls";
const kindNames: Record<LabelKind, string> = { phones: "teléfonos", emails: "emails", urls: "webs" };
const defaults: Record<LabelKind, string[]> = {
  phones: ["Móvil", "Casa", "Trabajo", "Fax", "Otro"],
  emails: ["Personal", "Trabajo", "Otro"],
  urls: ["Web", "Instagram", "LinkedIn", "Facebook", "X"],
};
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();


/**
 * Lista completa de etiquetas: las guardadas por el usuario, las habituales y las que ya usan sus contactos.
 * `canonical` devuelve la escritura de la lista (p. ej. «movil» → «Móvil»).
 */
export function useItemLabels(kind: LabelKind) {
  const { data: prefs } = useUserPrefs();
  const { data: used } = useQuery({
    queryKey: ["item-labels"],
    queryFn: () => api.get<Record<LabelKind, string[]>>("/contacts/item-labels"),
    staleTime: 5 * 60_000,
  });
  const labels = useMemo(() => {
    const out: string[] = [];
    for (const l of [...(prefs?.itemLabels[kind] ?? []), ...defaults[kind], ...(used?.[kind] ?? [])]) {
      if (l.trim() && !out.some((x) => same(x, l))) out.push(capLabel(l));
    }
    return out;
  }, [prefs, used, kind]);
  const canonical = (l: string) => labels.find((x) => same(x, l)) ?? l.trim();
  return { labels, canonical, prefs };
}

/**
 * Campo de etiqueta con desplegable propio: al tocarlo sale la lista completa, al escribir se filtra
 * y, si no existe, ofrece «+ Crear». Si sales escribiendo una nueva sin elegir, pregunta si se crea.
 */
export function LabelInput({ kind, value, onChange, className = "" }: { kind: LabelKind; value: string; onChange: (v: string) => void; className?: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { labels, prefs } = useItemLabels(kind);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [hi, setHi] = useState(0);
  const before = useRef(value);
  const picking = useRef(false);
  const save = useMutation({
    mutationFn: (next: string[]) => api.put("/prefs", { ...prefs!, itemLabels: { ...prefs!.itemLabels, [kind]: next } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prefs"] }),
  });
  const t = value.trim();
  const shown = typed && t ? labels.filter((l) => l.toLowerCase().includes(t.toLowerCase())) : labels;
  const canCreate = !!t && !labels.some((l) => same(l, t));
  const options = [...shown, ...(canCreate ? [`+ ${t}`] : [])];

  function create(v: string) {
    if (prefs && !(prefs.itemLabels[kind] ?? []).some((l) => same(l, v))) save.mutate([...(prefs.itemLabels[kind] ?? []), v]);
  }
  function pick(i: number) {
    const o = options[i];
    if (o === undefined) return;
    if (canCreate && i === options.length - 1) {
      create(t);
      onChange(t);
    } else onChange(o);
    setOpen(false);
    setTyped(false);
  }
  async function leave() {
    if (picking.current) return;
    setOpen(false);
    setTyped(false);
    if (!t) return;
    const found = labels.find((l) => same(l, t));
    if (found) {
      if (found !== value) onChange(found);
      return;
    }
    const ok = await confirm({ title: `¿Crear la etiqueta «${t}»?`, message: `Se añade a tu lista de etiquetas de ${kindNames[kind]} y la podrás elegir siempre.`, confirmText: "Crear", cancelText: "No" });
    if (ok) create(t);
    else onChange(before.current);
  }
  return (
    <span className={`relative inline-block ${className}`}>
      <input
        className="input w-full py-1 pr-9 text-sm"
        placeholder="Etiqueta"
        // Mientras no se escribe, se muestra con la escritura de la lista («móvil» → «Móvil»)
        value={typed ? value : (labels.find((l) => same(l, value)) ?? capLabel(value))}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={() => { before.current = value; setOpen(true); setTyped(false); setHi(0); }}
        onClick={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setTyped(true); setOpen(true); setHi(0); }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(options.length - 1, h + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(hi); }
          else if (e.key === "Escape") { setOpen(false); }
        }}
        onBlur={() => void setTimeout(() => void leave(), 120)}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Mostrar etiquetas"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { if (!open) before.current = value; setOpen(!open); setTyped(false); setHi(0); }}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-xl text-slate-500 hover:text-slate-800"
      >
        <svg viewBox="0 0 20 20" className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} fill="currentColor" aria-hidden="true"><path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" /></svg>
      </button>
      {open && options.length > 0 && (
        <span
          ref={keepInView}
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 block max-h-64 w-48 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg"
          onPointerDown={() => { picking.current = true; }}
          onPointerUp={() => setTimeout(() => { picking.current = false; }, 200)}
        >
          {options.map((o, i) => {
            const isNew = canCreate && i === options.length - 1;
            return (
              <button
                key={o}
                type="button"
                role="option"
                aria-selected={i === hi}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
                className={`block w-full px-3 py-2 text-left ${i === hi ? "bg-indigo-50" : ""} ${isNew ? "border-t border-slate-100 font-medium text-indigo-700" : same(o, value) ? "font-semibold text-slate-900" : "text-slate-700"} hover:bg-indigo-50`}
              >
                {isNew ? `+ Crear «${t}»` : o}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}
