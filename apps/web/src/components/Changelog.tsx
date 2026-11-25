import { Fragment, type ReactNode } from "react";
import { APP_VERSION } from "@agendario/shared";
// El historial va dentro de la compilación: se ve sin conexión y siempre corresponde a esta versión
import changelog from "../../../../CHANGELOG.md?raw";
import { Modal } from "./Dialogs";

/** Negritas (**…**) y código (`…`) dentro de una línea. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="font-semibold text-slate-800">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-slate-100 px-1 text-[0.85em]">{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type Block = { title: string; lines: string[] };

/** Trocea el CHANGELOG.md en versiones («## 1.3.0 — …»). */
function parse(md: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) blocks.push({ title: line.slice(3).trim(), lines: [] });
    else if (blocks.length && line.trim() && !line.startsWith("# ")) blocks[blocks.length - 1]!.lines.push(line);
  }
  return blocks;
}

/** «Changelog»: el historial de cambios de todas las versiones, la actual primero. */
export function ChangelogModal({ onClose }: { onClose: () => void }) {
  const blocks = parse(changelog);
  return (
    <Modal title={`Changelog ${APP_VERSION}`} onClose={onClose} size="lg" full>
      <div className="space-y-6 px-5 py-4">
        {blocks.map((b, i) => {
          const [version, ...rest] = b.title.split(" — ");
          const current = version?.trim() === APP_VERSION;
          return (
            <section key={b.title}>
              <h2 className="mb-2 flex flex-wrap items-baseline gap-x-2 border-b border-slate-100 pb-1">
                <span className={`text-base font-bold ${current ? "text-indigo-700" : "text-slate-800"}`}>{version}</span>
                {rest.length > 0 && <span className="text-sm font-medium text-slate-600">{rest.join(" — ")}</span>}
                {current && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">Tu versión</span>}
                {i === 0 && !current && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Última</span>}
              </h2>
              <ul className="space-y-1.5 text-sm text-slate-600">
                {b.lines.map((l, j) =>
                  /^\s*- /.test(l) ? (
                    <li key={j} className={`flex gap-2 ${/^\s{2,}- /.test(l) ? "pl-5" : ""}`}>
                      <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-300" />
                      <span className="min-w-0">{inline(l.replace(/^\s*- /, ""))}</span>
                    </li>
                  ) : (
                    <li key={j} className="list-none">{inline(l)}</li>
                  ),
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
