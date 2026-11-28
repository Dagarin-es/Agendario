import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { ReactNode } from "react";
import {
  dateTypeLabels,
  occasionLabels,
  relationshipLabels,
  type Address,
  type ContactDetail,
  type LabeledValue,
  type MergePreview,
} from "@agendario/shared";
import { api } from "../lib/api";
import { isEmpty, itemKey, itemText, type ListKey } from "../lib/dedupe";
import { euros, formatDate, formatPartialDate } from "../lib/format";
import { Avatar } from "./Avatar";
import { Modal, useConfirm } from "./Dialogs";
import { TagChip } from "./Tags";

function useBoth(aId: string, bId: string) {
  const [qa, qb] = useQueries({
    queries: [aId, bId].map((id) => ({ queryKey: ["contact", id], queryFn: () => api.get<ContactDetail>(`/contacts/${id}`) })),
  });
  return { a: qa?.data, b: qb?.data, error: qa?.error || qb?.error };
}


// ---------- Fichas completas, una junto a otra ----------

function RowPair({ label, a, b }: { label: string; a: ReactNode; b: ReactNode }) {
  const blank = (x: ReactNode) => x === null || x === undefined || x === false || (Array.isArray(x) && x.length === 0) || x === "";
  if (blank(a) && blank(b)) return null;
  const cell = (x: ReactNode) => (blank(x) ? <span className="italic text-slate-300">—</span> : x);
  return (
    <div className="border-b border-slate-100 px-4 py-2.5 last:border-0">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="min-w-0 break-words">{cell(a)}</div>
        <div className="min-w-0 break-words">{cell(b)}</div>
      </div>
    </div>
  );
}

const lines = (items: (LabeledValue | Address)[], key: ListKey) =>
  items.length
    ? items.map((it, i) => (
        <div key={i}>
          {itemText(key, it)} {(it as LabeledValue).label && <span className="text-xs text-slate-400">· {(it as LabeledValue).label}</span>}
        </div>
      ))
    : null;

export function FullCardsModal({
  aId, bId, principalId, onClose, onDeleted,
}: { aId: string; bId: string; principalId: string; onClose: () => void; onDeleted: (name: string) => void }) {
  const { a, b, error } = useBoth(aId, bId);
  const confirm = useConfirm();
  const del = useMutation({
    mutationFn: (c: ContactDetail) => api.del(`/contacts/${c.id}`).then(() => c.displayName),
    onSuccess: (name) => onDeleted(name),
  });
  async function askDelete(c: ContactDetail, keepName: string) {
    const extras = c.giftIdeas.length + c.giftsReceived.length + c.importantDates.length;
    const ok = await confirm({
      title: `¿Borrar «${c.displayName}»?`,
      message: (
        <>
          Se conservará «{keepName}». <strong>Irá a la papelera: podrás restaurarlo durante 60 días.</strong>
          {extras > 0 && (
            <span className="mt-2 block rounded-lg bg-amber-50 p-2 text-amber-900">
              Tiene {extras} ideas de regalo, regalos o fechas que se perderán. Si quieres conservarlas, usa «Combinar».
            </span>
          )}
        </>
      ),
      confirmText: "Borrar",
      danger: true,
    });
    if (ok) del.mutate(c);
  }
  const both = (f: (c: ContactDetail) => ReactNode) => [a ? f(a) : null, b ? f(b) : null] as const;
  const row = (label: string, f: (c: ContactDetail) => ReactNode) => {
    const [x, y] = both(f);
    return <RowPair label={label} a={x} b={y} />;
  };

  return (
    <Modal title="Fichas completas" onClose={onClose} size="xl" full footer={<button className="btn-primary" onClick={onClose}>Cerrar</button>}>
      {error && <p className="p-4 text-red-600">No se han podido cargar los contactos.</p>}
      {(!a || !b) && !error && <p className="p-4 text-slate-500">Cargando…</p>}
      {a && b && (
        <div>
          <div className="sticky top-0 z-[1] grid grid-cols-2 gap-4 border-b border-slate-200 bg-white px-4 py-3">
            {[a, b].map((c) => (
              <div key={c.id} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
                <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase text-white ${c.id === principalId ? "bg-indigo-600" : "bg-slate-400"}`}>
                  {c.id === principalId ? "★ Principal" : "Secundario"}
                </span>
                <Avatar id={c.id} name={c.displayName} hasPhoto={c.hasPhoto} size={72} version={c.updatedAt} />
                <div className="font-semibold">{c.displayName}</div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  <Link to={`/contacts/${c.id}/edit?back=/duplicates`} className="btn rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                    ✏️ Editar
                  </Link>
                  <button
                    className="btn rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50"
                    disabled={del.isPending}
                    onClick={() => askDelete(c, (c.id === a.id ? b : a).displayName)}
                  >
                    🗑️ Borrar
                  </button>
                </div>
              </div>
            ))}
          </div>
          {row("Nombre", (c) => c.givenName)}
          {row("Apellidos", (c) => c.familyName)}
          {row("Apodo", (c) => c.nickname)}
          {row("Empresa", (c) => c.organization)}
          {row("Cargo", (c) => c.jobTitle)}
          {row("Cumpleaños", (c) => (c.birthday ? formatPartialDate(c.birthday) : null))}
          {row("Teléfonos", (c) => lines(c.phones, "phones"))}
          {row("Emails", (c) => lines(c.emails, "emails"))}
          {row("Webs y redes", (c) => lines(c.urls, "urls"))}
          {row("Direcciones", (c) => lines(c.addresses, "addresses"))}
          {row("Notas", (c) => (c.notes ? <span className="whitespace-pre-wrap">{c.notes}</span> : null))}
          {row("Etiquetas", (c) => (c.tags.length ? <div className="flex flex-wrap gap-1">{c.tags.map((t) => <TagChip key={t.id} tag={t} small />)}</div> : null))}
          {row("Fechas importantes", (c) => (c.importantDates.length ? c.importantDates.map((d) => <div key={d.id}>{d.label || dateTypeLabels[d.type]} · {formatPartialDate(d.date)}</div>) : null))}
          {row("Relaciones", (c) => (c.relationships.length ? c.relationships.map((r) => <div key={r.id}>{relationshipLabels[r.type]} {r.relatedName}</div>) : null))}
          {row("Ideas de regalo", (c) =>
            c.giftIdeas.length
              ? c.giftIdeas.map((g) => (
                  <div key={g.id} className={g.given ? "text-slate-400" : ""}>
                    {g.given ? "✓ " : "🎁 "}{g.title}{g.priceCents ? ` · ${euros(g.priceCents)}` : ""}
                  </div>
                ))
              : null,
          )}
          {row("Regalos recibidos", (c) => (c.giftsReceived.length ? c.giftsReceived.map((g) => <div key={g.id}>{g.description}{g.occasion ? ` · ${occasionLabels[g.occasion]}` : ""}</div>) : null))}
          {row("Creado", (c) => formatDate(c.createdAt))}
          {row("Modificado", (c) => formatDate(c.updatedAt))}
        </div>
      )}
    </Modal>
  );
}

// ---------- Vista previa de la combinación ----------

function Struck({ children, from }: { children: ReactNode; from: string }) {
  return (
    <div className="text-xs text-red-700/80">
      <span className="line-through decoration-red-500/70">{children}</span>
      <span className="ml-1 text-[10px] text-slate-400">se descarta · de «{from}»</span>
    </div>
  );
}
const FromOther = ({ name }: { name: string }) => (
  <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">+ de «{name}»</span>
);

function PreviewSection({ label, children, changed }: { label: string; children: ReactNode; changed?: boolean }) {
  return (
    <div className={`border-b border-slate-100 px-4 py-2.5 last:border-0 ${changed ? "border-l-4 border-l-amber-400 bg-amber-50" : ""}`}>
      <div className={`mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide ${changed ? "text-amber-800" : "text-slate-400"}`}>
        {label}
        {changed && <span className="rounded bg-amber-200 px-1.5 py-px text-[9px] font-bold normal-case tracking-normal text-amber-900">cambia</span>}
      </div>
      <div className="space-y-0.5 text-sm">{children}</div>
    </div>
  );
}

export function PreviewModal({
  keepId, removeId, onClose, onSwap, onMerge, merging,
}: { keepId: string; removeId: string; onClose: () => void; onSwap: () => void; onMerge: () => void; merging: boolean }) {
  const { a: keep, b: remove, error } = useBoth(keepId, removeId);
  const { data: preview, error: pErr } = useQuery({
    queryKey: ["merge-preview", keepId, removeId],
    queryFn: () => api.post<MergePreview>("/duplicates/preview", { keepId, removeId }),
  });

  const ready = keep && remove && preview;
  const otherName = remove?.displayName ?? "";

  const single = (label: string, k: "displayName" | "givenName" | "familyName" | "nickname" | "organization" | "jobTitle" | "birthday") => {
    if (!ready) return null;
    const show = (v: string | null) => (k === "birthday" ? formatPartialDate(v) : v ?? "");
    const final = preview.values[k];
    const fromOther = isEmpty(keep[k]) && !isEmpty(remove[k]);
    const dropped = !isEmpty(remove[k]) && !fromOther && (remove[k] ?? "").trim() !== (keep[k] ?? "").trim();
    if (isEmpty(final) && !dropped) return null;
    const changed = (final ?? "").trim() !== (keep[k] ?? "").trim();
    return (
      <PreviewSection label={label} changed={changed}>
        {!isEmpty(final) && <div>{show(final)}{fromOther && <FromOther name={otherName} />}</div>}
        {dropped && <Struck from={otherName}>{show(remove[k])}</Struck>}
      </PreviewSection>
    );
  };

  const list = (label: string, k: ListKey) => {
    if (!ready) return null;
    const keepKeys = new Set((keep[k] as (LabeledValue | Address)[]).map((x) => itemKey(k, x)));
    const final = preview.values[k] as (LabeledValue | Address)[];
    const repeated = (remove[k] as (LabeledValue | Address)[]).filter((x) => keepKeys.has(itemKey(k, x)));
    if (!final.length && !repeated.length) return null;
    const changed = final.some((it) => !keepKeys.has(itemKey(k, it)));
    return (
      <PreviewSection label={label} changed={changed}>
        {final.map((it, i) => (
          <div key={i}>
            {itemText(k, it)} {(it as LabeledValue).label && <span className="text-xs text-slate-400">· {(it as LabeledValue).label}</span>}
            {!keepKeys.has(itemKey(k, it)) && <FromOther name={otherName} />}
          </div>
        ))}
        {repeated.map((it, i) => (
          <div key={`r${i}`} className="text-xs text-slate-400">
            <span className="line-through">{itemText(k, it)}</span>
            <span className="ml-1 text-[10px]">repetido, ya está · de «{otherName}»</span>
          </div>
        ))}
      </PreviewSection>
    );
  };

  const photoFromOther = preview?.photoFrom === "remove";
  const photoDropped = ready && remove.hasPhoto && preview.photoFrom === "keep";
  const finalHasPhoto = preview?.photoFrom !== "none";
  const photoOwner = photoFromOther ? remove : keep;

  return (
    <Modal
      title="Vista previa de la combinación"
      onClose={onClose}
      size="md"
      full
      footer={
        <>
          <button className="btn-ghost mr-auto" onClick={onSwap} title="Usar el otro contacto como principal">⇄ Cambiar principal</button>
          <button className="btn-ghost" onClick={onClose}>Cerrar</button>
          <button className="btn-primary" disabled={!ready || merging} onClick={onMerge}>{merging ? "Combinando…" : "Combinar así"}</button>
        </>
      }
    >
      {(error || pErr) && <p className="p-4 text-red-600">No se ha podido calcular la vista previa.</p>}
      {!ready && !error && !pErr && <p className="p-4 text-slate-500">Calculando…</p>}
      {ready && (
        <div>
          <div className="border-b border-slate-100 bg-indigo-50/60 px-4 py-3 text-xs text-indigo-900">
            Así quedará el contacto. Manda <strong>«{keep.displayName}»</strong> (principal); de <strong>«{remove.displayName}»</strong> se añade lo que falte y él se elimina.
            Lo <span className="line-through">tachado</span> no se conservará y <span className="rounded bg-amber-200 px-1 text-amber-900">en amarillo</span> está lo que cambia respecto a «{keep.displayName}».
          </div>
          <div className="flex flex-col items-center gap-2 px-4 py-4">
            <div className="flex items-end gap-3">
              {finalHasPhoto ? (
                <div className="relative">
                  <Avatar id={photoOwner!.id} name={preview.values.displayName} hasPhoto size={88} version={photoOwner!.updatedAt} />
                  {photoFromOther && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap"><FromOther name={otherName} /></span>}
                </div>
              ) : (
                <Avatar id={keep.id} name={preview.values.displayName} hasPhoto={false} size={88} />
              )}
              {photoDropped && (
                <div className="relative opacity-60" title={`Foto de «${otherName}»: se descarta`}>
                  <Avatar id={remove.id} name={remove.displayName} hasPhoto size={44} version={remove.updatedAt} />
                  <div className="absolute inset-0 flex items-center justify-center"><div className="h-0.5 w-14 rotate-45 bg-red-500" /></div>
                </div>
              )}
            </div>
            <div className="text-lg font-semibold">{preview.values.displayName}</div>
            <div className="flex flex-wrap justify-center gap-1">
              {[...new Map([...keep.tags, ...remove.tags].map((t) => [t.id, t])).values()].map((t) => <TagChip key={t.id} tag={t} small />)}
            </div>
          </div>
          {single("Nombre a mostrar", "displayName")}
          {single("Nombre", "givenName")}
          {single("Apellidos", "familyName")}
          {single("Apodo", "nickname")}
          {single("Empresa", "organization")}
          {single("Cargo", "jobTitle")}
          {single("Cumpleaños", "birthday")}
          {list("Teléfonos", "phones")}
          {list("Emails", "emails")}
          {list("Webs y redes", "urls")}
          {list("Direcciones", "addresses")}
          {!isEmpty(preview.values.notes) && (
            <PreviewSection label="Notas" changed={preview.values.notes.trim() !== keep.notes.trim()}>
              <div className="whitespace-pre-wrap">{preview.values.notes}</div>
              {!isEmpty(keep.notes) && !isEmpty(remove.notes) && keep.notes.trim() !== remove.notes.trim() && (
                <div className="text-[10px] text-slate-400">Se unen las notas de los dos.</div>
              )}
            </PreviewSection>
          )}
          {(remove.giftIdeas.length + remove.giftsReceived.length + remove.importantDates.length + remove.relationships.length) > 0 && (
            <PreviewSection label="Además pasan al principal">
              <div className="text-xs text-slate-600">
                {[
                  remove.giftIdeas.length && `${remove.giftIdeas.length} ideas de regalo`,
                  remove.giftsReceived.length && `${remove.giftsReceived.length} regalos recibidos`,
                  remove.importantDates.length && `${remove.importantDates.length} fechas`,
                  remove.relationships.length && `${remove.relationships.length} relaciones`,
                ].filter(Boolean).join(" · ")}
              </div>
            </PreviewSection>
          )}
        </div>
      )}
    </Modal>
  );
}
