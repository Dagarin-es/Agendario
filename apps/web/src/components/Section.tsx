import type { ReactNode } from "react";

/** Recuadro de Ajustes (título con icono —emoji o logo—, explicación y contenido). */
export function Section({ title, icon, children, desc }: { title: string; icon: ReactNode; desc?: string; children: ReactNode }) {
  return (
    <section className="card space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-indigo-950"><span aria-hidden="true" className="inline-flex shrink-0 items-center">{icon}</span> {title}</h2>
        {desc && <p className="mt-0.5 text-sm text-slate-500">{desc}</p>}
      </div>
      {children}
    </section>
  );
}
