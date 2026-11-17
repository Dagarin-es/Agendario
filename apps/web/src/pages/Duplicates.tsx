import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { duplicateReasonLabels, type DuplicateContact, type DuplicateGroup } from "@agendario/shared";
import { Avatar } from "../components/Avatar";
import { TagChip } from "../components/Tags";
import { api } from "../lib/api";
import { useConfirm } from "../components/Dialogs";
import { FullCardsModal, PreviewModal } from "../components/DuplicateModals";
import { formatPartialDate } from "../lib/format";

function Lines({ icon, items, max = 2 }: { icon: string; items: string[]; max?: number }) {
  if (!items.length) return null;
  return (
    <div className="flex gap-1.5 text-xs text-slate-600">
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0">
        {items.slice(0, max).map((x, i) => <div key={i} className="truncate">{x}</div>)}
        {items.length > max && <div className="text-slate-400">+{items.length - max} más</div>}
      </div>
    </div>
  );
}

function MiniContact({
  c, principal, marked, onMark, onMakePrincipal,
}: { c: DuplicateContact; principal: boolean; marked: boolean; onMark: () => void; onMakePrincipal: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onMark}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onMark())}
      aria-pressed={marked}
      className={`relative min-w-0 cursor-pointer space-y-1.5 rounded-xl border-2 p-2.5 transition ${
        marked ? "border-red-400 bg-red-50/70" : principal ? "border-indigo-500 bg-indigo-50/50" : "border-slate-200 hover:border-slate-300"
      }`}
    >
      {/* Quién manda */}
      <div className="flex items-center gap-1.5">
        {principal ? (
          <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">★ Principal</span>
        ) : (
          <button
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:border-indigo-500 hover:text-indigo-700"
            onClick={(e) => { e.stopPropagation(); onMakePrincipal(); }}
          >
            Hacer principal
          </button>
        )}
        <Link
          to={`/contacts/${c.id}/edit?back=/duplicates`}
          onClick={(e) => e.stopPropagation()}
          className="ml-auto rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:border-indigo-500 hover:text-indigo-700"
          title="Editar este contacto"
        >
          ✏️ Editar
        </Link>
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px] ${marked ? "border-red-500 bg-red-500 text-white" : "border-slate-300 bg-white"}`}
          title={marked ? "Marcado para borrar" : "Pulsa para marcarlo"}
        >
          {marked && "✓"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Avatar id={c.id} name={c.displayName} hasPhoto={c.hasPhoto} size={40} version={c.updatedAt} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{c.displayName}</div>
          <div className="text-[10px] text-slate-500">{principal ? "Se conserva y manda" : "Se añade al principal"}</div>
        </div>
      </div>
      {(c.jobTitle || c.organization) && <div className="truncate text-xs text-slate-500">{[c.jobTitle, c.organization].filter(Boolean).join(" · ")}</div>}
      <Lines icon="📞" items={c.phones} />
      <Lines icon="✉️" items={c.emails} />
      <Lines icon="📍" items={c.addresses} max={1} />
      {c.birthday && <Lines icon="🎂" items={[formatPartialDate(c.birthday)]} />}
      {c.tags.length > 0 && <div className="flex flex-wrap gap-1">{c.tags.map((t) => <TagChip key={t.id} tag={t} small />)}</div>}
      {!c.phones.length && !c.emails.length && !c.addresses.length && !c.organization && (
        <div className="text-xs italic text-slate-400">Sin más datos</div>
      )}
      {marked && <div className="text-[11px] font-medium text-red-700">Marcado para borrar</div>}
    </div>
  );
}

function GroupCard({ g, onDone }: { g: DuplicateGroup; onDone: (msg: string) => void }) {
  const pair = [g.contacts[0]!, g.contacts[1]!];
  const confirm = useConfirm();
  const [pIdx, setPIdx] = useState(0); // índice del principal (0 = el más completo)
  const [marked, setMarked] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "full" | "preview">(null);
  const [error, setError] = useState("");
  const keep = pair[pIdx]!;
  const other = pair[1 - pIdx]!;

  const merge = useMutation({
    mutationFn: () => api.post("/duplicates/auto-merge", { keepId: keep.id, removeId: other.id }),
    onSuccess: () => { setModal(null); onDone(`Combinados en «${keep.displayName}».`); },
    onError: (e) => setError((e as Error).message),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/contacts/${id}`),
    onSuccess: (_r, id) => onDone(`Borrado «${pair.find((c) => c.id === id)!.displayName}».`),
    onError: (e) => setError((e as Error).message),
  });
  const dismiss = useMutation({
    mutationFn: () => api.post("/duplicates/dismiss", { aId: pair[0]!.id, bId: pair[1]!.id }),
    onSuccess: () => onDone("Marcados como personas distintas."),
    onError: (e) => setError((e as Error).message),
  });
  const busy = merge.isPending || del.isPending || dismiss.isPending;

  async function askDelete() {
    const c = pair.find((x) => x.id === marked);
    if (!c) return;
    const ok = await confirm({
      title: `¿Borrar «${c.displayName}»?`,
      message: (
        <>
          Se conservará «{pair.find((x) => x.id !== c.id)!.displayName}». <strong>Irá a la papelera: podrás restaurarlo durante 60 días.</strong>
          {c.extras > 0 && (
            <span className="mt-2 block rounded-lg bg-amber-50 p-2 text-amber-900">
              Tiene {c.extras} ideas de regalo, regalos o fechas que se perderán. Si quieres conservarlas, usa «Combinar».
            </span>
          )}
        </>
      ),
      confirmText: "Borrar",
      danger: true,
    });
    if (ok) del.mutate(c.id);
  }

  // Botones repartidos a lo ancho de la tarjeta (crecen hasta ocupar toda la fila)
  const action = "btn flex-1 basis-auto justify-center whitespace-nowrap rounded-lg border px-3 py-2 text-center text-[13px]";
  return (
    <li className="card space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        {g.pairReasons.map((r) => (
          <span key={r} className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
            {duplicateReasonLabels[r]}
          </span>
        ))}
        {g.contacts.length > 2 && (
          <span className="ml-auto text-[11px] text-slate-500" title={g.contacts.slice(2).map((c) => c.displayName).join(", ")}>
            Grupo de {g.contacts.length} · después: {g.contacts.slice(2).map((c) => `«${c.displayName}»`).join(", ")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {pair.map((c, i) => (
          <MiniContact
            key={c.id}
            c={c}
            principal={i === pIdx}
            marked={marked === c.id}
            onMark={() => setMarked(marked === c.id ? null : c.id)}
            onMakePrincipal={() => setPIdx(i)}
          />
        ))}
      </div>
      <p className="text-center text-[11px] text-slate-400">Pulsa un contacto para marcarlo y poder borrarlo · «Hacer principal» decide cuál manda al combinar</p>

      <div className="flex flex-wrap gap-2">
        <button className={`${action} border-red-200 text-red-700 hover:bg-red-50 disabled:border-slate-200 disabled:text-slate-400`} disabled={busy || !marked} onClick={askDelete}
          title={marked ? "Borrar el contacto marcado" : "Marca primero uno de los dos contactos"}>
          🗑️ Borrar
        </button>
        <button className={`${action} border-indigo-700 bg-indigo-700 text-white hover:bg-indigo-800`} disabled={busy} onClick={() => merge.mutate()}>{merge.isPending ? "Combinando…" : "⚡ Combinar"}</button>
        <button className={`${action} border-indigo-200 text-indigo-800 hover:bg-indigo-50`} disabled={busy} onClick={() => setModal("preview")}>👁️ Vista previa</button>
        <Link to={`/duplicates/merge?a=${pair[0]!.id}&b=${pair[1]!.id}&p=${keep.id}`} className={`${action} border-indigo-200 text-indigo-800 hover:bg-indigo-50`}>✋ Combinar manualmente</Link>
        <button className={`${action} border-slate-200 text-slate-700 hover:bg-slate-50`} disabled={busy} onClick={() => setModal("full")}>📄 Ver fichas completas</button>
        <button className={`${action} border-slate-300 text-slate-700 hover:bg-slate-50`} disabled={busy} onClick={() => dismiss.mutate()}>🚫 No son duplicados</button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {modal === "full" && (
        <FullCardsModal
          aId={pair[0]!.id}
          bId={pair[1]!.id}
          principalId={keep.id}
          onClose={() => setModal(null)}
          onDeleted={(name) => { setModal(null); onDone(`Borrado «${name}».`); }}
        />
      )}
      {modal === "preview" && (
        <PreviewModal
          keepId={keep.id}
          removeId={other.id}
          onClose={() => setModal(null)}
          onSwap={() => setPIdx(1 - pIdx)}
          onMerge={() => merge.mutate()}
          merging={merge.isPending}
        />
      )}
    </li>
  );
}

export function DuplicatesPage() {
  const qc = useQueryClient();
  const location = useLocation();
  const confirm = useConfirm();
  const [flash, setFlash] = useState<string>((location.state as { flash?: string } | null)?.flash ?? "");
  const { data: groups, isLoading } = useQuery({
    queryKey: ["duplicates"],
    queryFn: () => api.get<DuplicateGroup[]>("/duplicates"),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["duplicates"] });
    qc.invalidateQueries({ queryKey: ["contacts"] });
    qc.invalidateQueries({ queryKey: ["tags"] });
  };
  const done = (msg: string) => {
    setFlash(msg);
    refresh();
  };

  const mergeAll = useMutation({
    mutationFn: () => api.post<{ merged: number; groups: number }>("/duplicates/auto-merge-all"),
    onSuccess: (r) => done(`Combinados ${r.merged} duplicados en ${r.groups} contactos.`),
    onError: (e) => setFlash((e as Error).message),
  });
  const restore = useMutation({
    mutationFn: () => api.del<{ restored: number }>("/duplicates/dismissals"),
    onSuccess: (r) => done(r?.restored ? `Se vuelven a revisar ${r.restored} parejas descartadas.` : "No había parejas descartadas."),
  });

  const extra = groups?.reduce((n, g) => n + g.contacts.length - 1, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Posibles duplicados {groups?.length ? <span className="text-slate-400">({groups.length})</span> : null}</h1>
          <p className="text-sm text-slate-500">Revisa cada pareja: borra uno, combínalos automáticamente o elige tú qué conservar.</p>
        </div>
        {groups && groups.length > 0 && (
          <button
            className="btn-primary"
            disabled={mergeAll.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: `¿Combinar automáticamente los ${groups.length} grupos?`,
                message: `En cada grupo se conservará el contacto más completo y se le añadirán los datos que le falten de los otros. Se eliminarán ${extra} contactos.`,
                confirmText: "Combinar todos",
              });
              if (ok) mergeAll.mutate();
            }}
          >
            {mergeAll.isPending ? "Combinando…" : `⚡ Combinar todos (${groups.length})`}
          </button>
        )}
      </div>

      {flash && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          <span className="flex-1">{flash}</span>
          <button className="text-emerald-700" onClick={() => setFlash("")} aria-label="Cerrar">✕</button>
        </div>
      )}
      {isLoading && <p className="text-slate-500">Buscando duplicados…</p>}
      {groups && groups.length === 0 && <div className="card text-center text-slate-500">🎉 No hay posibles duplicados.</div>}

      <ul className="space-y-3">
        {groups?.map((g) => <GroupCard key={`${g.contacts[0]!.id}|${g.contacts[1]!.id}`} g={g} onDone={done} />)}
      </ul>

      <p className="text-center text-[11px] text-slate-400">
        Solo se buscan entre tus contactos (no los que te comparten). «Combinar» conserva el más completo y le añade lo que le falte del otro; etiquetas, regalos y fechas pasan siempre al que se conserva.
      </p>
      <div className="text-center">
        <button className="btn-ghost text-xs" onClick={() => restore.mutate()}>Volver a revisar las parejas marcadas como «no son duplicados»</button>
      </div>
    </div>
  );
}
