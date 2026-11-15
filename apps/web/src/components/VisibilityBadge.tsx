import type { Visibility } from "@agendario/shared";

const styles: Record<Visibility, [string, string]> = {
  private: ["Privado", "bg-slate-100 text-slate-600"],
  shared: ["Compartido", "bg-sky-50 text-sky-700"],
  public: ["Público", "bg-emerald-50 text-emerald-700"],
};

export function VisibilityBadge({ v }: { v: Visibility }) {
  const [label, cls] = styles[v];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
