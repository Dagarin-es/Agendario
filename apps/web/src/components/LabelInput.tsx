import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { api } from "../lib/api";
import { useConfirm } from "./Dialogs";
import { useUserPrefs } from "./QuickActions";

export type LabelKind = "phones" | "emails" | "urls";
const kindNames: Record<LabelKind, string> = { phones: "teléfonos", emails: "emails", urls: "webs" };

/** Lista de etiquetas del usuario y forma canónica de una etiqueta (misma escritura que en la lista). */
export function useItemLabels(kind: LabelKind) {
  const { data: prefs } = useUserPrefs();
  const labels = prefs?.itemLabels[kind] ?? [];
  const canonical = (l: string) => labels.find((x) => x.toLowerCase() === l.trim().toLowerCase()) ?? l.trim();
  return { labels, canonical, prefs };
}

/** Campo de etiqueta con la lista del usuario; si escribes una nueva, pregunta si se crea. */
export function LabelInput({ kind, value, onChange, className = "" }: { kind: LabelKind; value: string; onChange: (v: string) => void; className?: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { labels, prefs } = useItemLabels(kind);
  const before = useRef(value);
  const save = useMutation({
    mutationFn: (next: string[]) => api.put("/prefs", { ...prefs!, itemLabels: { ...prefs!.itemLabels, [kind]: next } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prefs"] }),
  });
  async function check(v: string) {
    const t = v.trim();
    if (!t || !prefs) return;
    const found = labels.find((l) => l.toLowerCase() === t.toLowerCase());
    if (found) {
      if (found !== v) onChange(found);
      return;
    }
    const ok = await confirm({ title: `¿Crear la etiqueta «${t}»?`, message: `Se añade a tu lista de etiquetas de ${kindNames[kind]} y la podrás elegir siempre.`, confirmText: "Crear", cancelText: "No" });
    if (ok) save.mutate([...labels, t]);
    else onChange(before.current);
  }
  return (
    <>
      <input
        className={`input py-1 text-sm ${className}`}
        list={`item-labels-${kind}`}
        placeholder="Etiqueta"
        value={value}
        onFocus={() => { before.current = value; }}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => void check(e.target.value)}
      />
      <datalist id={`item-labels-${kind}`}>{labels.map((l) => <option key={l} value={l} />)}</datalist>
    </>
  );
}
