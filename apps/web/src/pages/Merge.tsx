import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { Address, ContactDetail, LabeledValue } from "@agendario/shared";
import { Avatar } from "../components/Avatar";
import { AddressSearch, useGeocoder } from "../components/AddressSearch";
import { TagChip } from "../components/Tags";
import { LabelInput, useItemLabels } from "../components/LabelInput";
import { api } from "../lib/api";
import { formatPartialDate } from "../lib/format";

type Side = "a" | "b";
type SingleKey = "displayName" | "givenName" | "familyName" | "nickname" | "organization" | "jobTitle" | "birthday";
type TextKey = Exclude<SingleKey, "birthday">;
type ListKey = "phones" | "emails" | "urls" | "addresses";

const singleFields: { key: SingleKey; label: string }[] = [
  { key: "displayName", label: "Nombre a mostrar" },
  { key: "givenName", label: "Nombre" },
  { key: "familyName", label: "Apellidos" },
  { key: "nickname", label: "Apodo" },
  { key: "organization", label: "Empresa" },
  { key: "jobTitle", label: "Cargo" },
  { key: "birthday", label: "Cumpleaños" },
];
const textFields = singleFields.filter((f): f is { key: TextKey; label: string } => f.key !== "birthday");
const listFields: { key: ListKey; label: string }[] = [
  { key: "phones", label: "Teléfonos" },
  { key: "emails", label: "Emails" },
  { key: "urls", label: "Webs y redes" },
  { key: "addresses", label: "Direcciones" },
];

// ---------- "Es el mismo dato" (para no duplicar al combinar) ----------
const normPhone = (p: string) => {
  let d = p.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  return d.length > 9 ? d.slice(-9) : d;
};
const addrText = (a: Address) => [a.street, [a.postalCode, a.city].filter(Boolean).join(" "), a.region, a.country].filter(Boolean).join(", ");
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9ñ]/g, "");
/** «+ Añadir campo»: campos que no tiene ninguno de los dos contactos. */
function AddField({ options, onAdd }: { options: { key: string; label: string }[]; onAdd: (k: string) => void }) {
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-3">
      <span className="text-sm font-medium text-indigo-900">＋ Añadir un campo que no tiene ninguno:</span>
      <select className="select w-auto py-1.5 pl-3 text-sm" value="" onChange={(e) => e.target.value && onAdd(e.target.value)} aria-label="Añadir campo">
        <option value="">Elige un campo…</option>
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** Mini formulario para añadir un dato nuevo (teléfono, email, web o dirección) al contacto combinado. */
function NewItem({ kind, onAdd }: { kind: ListKey; onAdd: (it: LabeledValue | Address) => void }) {
  const [open, setOpen] = useState(false);
  const blankAddr: Address = { label: "casa", street: "", city: "", region: "", postalCode: "", country: "España" };
  const [lv, setLv] = useState<LabeledValue>({ label: "", value: "" });
  const [ad, setAd] = useState<Address>(blankAddr);
  const geocoder = useGeocoder();
  if (!open)
    return (
      <button type="button" className="mt-1.5 text-xs font-medium text-indigo-800 hover:underline" onClick={() => setOpen(true)}>
        ＋ Añadir {kind === "phones" ? "teléfono" : kind === "emails" ? "email" : kind === "urls" ? "web" : "dirección"}
      </button>
    );
  const done = () => { setOpen(false); setLv({ label: "", value: "" }); setAd(blankAddr); };
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-indigo-200 bg-white p-2">
      {kind === "addresses" ? (
        <>
          {geocoder && <AddressSearch address={ad} onChange={(p) => setAd((a) => ({ ...a, ...p }))} />}
          <input className="input py-1.5 text-sm" placeholder="Tipo (casa, trabajo…)" value={ad.label} onChange={(e) => setAd({ ...ad, label: e.target.value })} />
          <input className="input py-1.5 text-sm" placeholder="Calle y número" value={ad.street} onChange={(e) => setAd({ ...ad, street: e.target.value })} />
          <div className="grid grid-cols-2 gap-1.5">
            <input className="input py-1.5 text-sm" placeholder="C. postal" value={ad.postalCode} onChange={(e) => setAd({ ...ad, postalCode: e.target.value })} />
            <input className="input py-1.5 text-sm" placeholder="Ciudad" value={ad.city} onChange={(e) => setAd({ ...ad, city: e.target.value })} />
          </div>
        </>
      ) : (
        <>
          <input className="input py-1.5 text-sm" placeholder={kind === "phones" ? "+34 600 000 000" : kind === "emails" ? "nombre@ejemplo.com" : "https://…"} value={lv.value} onChange={(e) => setLv({ ...lv, value: e.target.value })} />
          <input className="input py-1.5 text-sm" placeholder="Etiqueta (móvil, trabajo…)" value={lv.label} onChange={(e) => setLv({ ...lv, label: e.target.value })} />
        </>
      )}
      <div className="flex justify-end gap-1">
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={done}>Cancelar</button>
        <button
          type="button"
          className="btn-primary px-2.5 py-1 text-xs"
          disabled={kind === "addresses" ? !(ad.street.trim() || ad.city.trim()) : !lv.value.trim()}
          onClick={() => { onAdd(kind === "addresses" ? ad : { ...lv, value: lv.value.trim() }); done(); }}
        >
          Añadir
        </button>
      </div>
    </div>
  );
}

type Move = { to: TextKey; prevTo: string | undefined; prevFrom: Side | null };

/** Devuelve el estado anterior a un movimiento: el destino recupera su valor y el origen su elección. */
function undoInto(
  mv: Move,
  from: TextKey,
  cust: Partial<Record<TextKey, string>>,
  sing: Partial<Record<SingleKey, Side | null>>,
) {
  if (mv.prevTo === undefined) delete cust[mv.to];
  else cust[mv.to] = mv.prevTo;
  sing[from] = mv.prevFrom;
  return { cust, sing };
}

function itemKey(key: ListKey, item: LabeledValue | Address) {
  if (key === "addresses") return fold(addrText(item as Address));
  const v = (item as LabeledValue).value.trim().toLowerCase();
  if (key === "phones") return normPhone(v);
  if (key === "urls") return v.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return v;
}
const empty = (v: string | null | undefined) => !v || !v.trim();
const other = (s: Side): Side => (s === "a" ? "b" : "a");

// ---------- Casilla seleccionable ----------
function Pick({ checked, onClick, children, muted, radio }: { checked: boolean; onClick: () => void; children: ReactNode; muted?: boolean; radio?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full min-w-0 items-start gap-2 rounded-lg border p-2 text-left text-sm transition ${
        checked ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500/40" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border text-[10px] text-white ${radio ? "rounded-full" : "rounded"} ${checked ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white"}`}>
        {checked && "✓"}
      </span>
      <span className={`min-w-0 break-words ${muted ? "italic text-slate-400" : ""}`}>{children}</span>
    </button>
  );
}


// ---------- Recuadro de un campo: contacto A | contacto B | Quedará ----------
function FieldBox({ label, hint, a, b, result, shade }: { label: string; hint?: string; a: ReactNode; b: ReactNode; result: ReactNode; shade: boolean }) {
  return (
    <section className={`rounded-xl border border-slate-200 p-3 shadow-sm ${shade ? "bg-slate-50" : "bg-white"}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 border-b border-slate-200/70 pb-1.5">
        <h3 className="text-base font-semibold text-slate-800">{label}</h3>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_1.1fr]">
        <div className="min-w-0 space-y-1.5">{a}</div>
        <div className="min-w-0 space-y-1.5">{b}</div>
        <div className="col-span-2 min-w-0 rounded-lg border-2 border-indigo-300 bg-indigo-50 p-2.5 md:col-span-1">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-indigo-800">Quedará</div>
          {result}
        </div>
      </div>
    </section>
  );
}

// ---------- Página ----------
export function MergePage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const ids = { a: params.get("a") ?? "", b: params.get("b") ?? "" };

  const [qa, qb] = useQueries({
    queries: (["a", "b"] as Side[]).map((s) => ({
      queryKey: ["contact", ids[s]],
      queryFn: () => api.get<ContactDetail>(`/contacts/${ids[s]}`),
      enabled: !!ids[s],
    })),
  });
  const C = { a: qa?.data, b: qb?.data } as Record<Side, ContactDetail | undefined>;

  const [principal, setPrincipal] = useState<Side>("a");
  const [single, setSingle] = useState<Partial<Record<SingleKey, Side | null>>>({});
  // Valor escrito a mano (o movido desde otro campo) para el contacto combinado
  const [custom, setCustom] = useState<Partial<Record<TextKey, string>>>({});
  // Valores movidos a otro campo: "campo:lado" → destino y cómo estaba todo antes (para deshacer)
  const [moves, setMoves] = useState<Record<string, Move>>({});
  // Campos añadidos a mano (que no tiene ninguno de los dos) y datos nuevos en «Quedará»
  const [added, setAdded] = useState<string[]>([]);
  const [extra, setExtra] = useState<Partial<Record<ListKey, (LabeledValue | Address)[]>>>({});
  const [extraNotes, setExtraNotes] = useState("");
  const [customBirthday, setCustomBirthday] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Side | null>(null);
  const [notes, setNotes] = useState<Record<Side, boolean>>({ a: false, b: false });
  const [lists, setLists] = useState<Record<string, boolean>>({}); // "phones:a:0" → marcado
  const [ready, setReady] = useState(false);
  // En «Quedará»: etiqueta elegida para cada dato y orden final
  const [labelOv, setLabelOv] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<Partial<Record<ListKey, string[]>>>({});
  const phoneLabels = useItemLabels("phones");
  const emailLabels = useItemLabels("emails");
  const urlLabels = useItemLabels("urls");
  const canon = (k: ListKey, l: string) => (k === "phones" ? phoneLabels : k === "emails" ? emailLabels : k === "urls" ? urlLabels : null)?.canonical(l) ?? l;
  const [error, setError] = useState("");

  /** Marca por defecto lo que haría «Combinar automáticamente» con el principal indicado. */
  function applyDefaults(p: Side, ca: ContactDetail, cb: ContactDetail) {
    const byS = { a: ca, b: cb };
    const P = byS[p];
    const O = byS[other(p)];
    const s: Partial<Record<SingleKey, Side | null>> = {};
    for (const f of singleFields) s[f.key] = !empty(P[f.key]) ? p : !empty(O[f.key]) ? other(p) : null;
    setSingle(s);
    setPhoto(P.hasPhoto ? p : O.hasPhoto ? other(p) : null);
    const nP = !empty(P.notes);
    const nO = !empty(O.notes) && O.notes.trim() !== P.notes.trim();
    setNotes({ [p]: nP, [other(p)]: nO } as Record<Side, boolean>);
    const l: Record<string, boolean> = {};
    for (const { key } of listFields) {
      const seen = new Set<string>();
      (P[key] as (LabeledValue | Address)[]).forEach((it, i) => {
        l[`${key}:${p}:${i}`] = true;
        seen.add(itemKey(key, it));
      });
      (O[key] as (LabeledValue | Address)[]).forEach((it, i) => {
        const k = itemKey(key, it);
        l[`${key}:${other(p)}:${i}`] = !seen.has(k);
        seen.add(k);
      });
    }
    setLists(l);
    setCustom({});
    setMoves({});
    setAdded([]);
    setExtra({});
    setExtraNotes("");
    setCustomBirthday(null);
  }

  useEffect(() => {
    if (!C.a || !C.b || ready) return;
    // Por defecto, principal = el más completo
    const score = (c: ContactDetail) =>
      c.phones.length * 2 + c.emails.length * 2 + c.addresses.length * 2 + c.urls.length + (c.hasPhoto ? 3 : 0) + (c.birthday ? 2 : 0) +
      [c.givenName, c.familyName, c.nickname, c.organization, c.jobTitle, c.notes].filter((x) => !empty(x)).length;
    const wanted = params.get("p");
    const p: Side = wanted === ids.b ? "b" : wanted === ids.a ? "a" : score(C.b) > score(C.a) ? "b" : "a";
    setPrincipal(p);
    applyDefaults(p, C.a, C.b);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [C.a, C.b, ready]);

  const merge = useMutation({
    mutationFn: () => {
      const P = C[principal]!;
      const O = C[other(principal)]!;
      const val = <K extends SingleKey>(k: K) => {
        if (k !== "birthday" && custom[k as TextKey] !== undefined) return custom[k as TextKey]!.trim();
        if (k === "birthday" && customBirthday) return customBirthday;
        const s = single[k];
        return s ? C[s]![k] : k === "birthday" ? null : "";
      };
      const list = <K extends ListKey>(k: K) => finalEntries(k).map((e) => e.item);
      const finalNotes = [
        ...[principal, other(principal)].filter((s) => notes[s] && !empty(C[s]!.notes)).map((s) => C[s]!.notes.trim()),
        ...(extraNotes.trim() ? [extraNotes.trim()] : []),
      ].join("\n\n");
      return api.post("/duplicates/merge", {
        keepId: P.id,
        removeId: O.id,
        photoFrom: photo === null ? "none" : photo === principal ? "keep" : "remove",
        values: {
          displayName: (val("displayName") as string) || P.displayName,
          givenName: val("givenName"),
          familyName: val("familyName"),
          nickname: val("nickname"),
          organization: val("organization"),
          // El enlace de la empresa va con el valor elegido (si se escribe a mano, solo se conserva si coincide)
          organizationContactId: (() => {
            const org = (val("organization") as string).trim();
            if (custom.organization === undefined && single.organization) return C[single.organization]!.organizationContactId;
            const same = (["a", "b"] as Side[]).find((sd) => C[sd]!.organization.trim() === org && C[sd]!.organizationContactId);
            return same ? C[same]!.organizationContactId : null;
          })(),
          jobTitle: val("jobTitle"),
          birthday: val("birthday"),
          notes: finalNotes.slice(0, 10000),
          phones: list("phones"),
          emails: list("emails"),
          urls: list("urls"),
          addresses: list("addresses"),
        },
      });
    },
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["contact", ids.a] });
      qc.removeQueries({ queryKey: ["contact", ids.b] });
      qc.invalidateQueries({ queryKey: ["duplicates"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
      if (params.get("from") === "list") nav(`/contacts/${C[principal]!.id}`, { replace: true });
      else nav("/duplicates", { replace: true, state: { flash: `Combinados en «${C[principal]!.displayName}».` } });
    },
    onError: (e) => setError((e as Error).message),
  });

  if (!ids.a || !ids.b) return <p className="text-slate-500">Faltan los contactos a combinar.</p>;
  if (qa?.error || qb?.error) return <p className="text-red-600">No se han podido cargar los contactos (puede que ya se hayan combinado o borrado).</p>;
  if (!C.a || !C.b || !ready) return <p className="text-slate-500">Cargando…</p>;
  const ca = C.a;
  const cb = C.b;

  /** Olvida los movimientos que llevaban un valor al campo indicado (porque se ha elegido o escrito otro). */
  const forgetMovesInto = (to: TextKey) => setMoves((m) => Object.fromEntries(Object.entries(m).filter(([, mv]) => mv.to !== to)));
  const toggleSingle = (k: SingleKey, s: Side) => {
    setSingle((x) => ({ ...x, [k]: x[k] === s ? null : s }));
    setCustom(({ [k as TextKey]: _drop, ...rest }) => rest); // al elegir un valor se descarta lo escrito a mano
    forgetMovesInto(k as TextKey);
  };
  /** Valor final que tendrá el campo en el contacto combinado. */
  const finalOf = (k: TextKey) => custom[k] ?? (single[k] ? (C[single[k]!]![k] as string) : "");
  /** «Mover a…»: el valor de un contacto pasa a otro campo del resultado. */
  const moveTo = (from: TextKey, side: Side, to: TextKey) => {
    const key = `${from}:${side}`;
    // Si ya estaba movido a otro campo, primero se deshace ese movimiento
    const prev = moves[key];
    let cust = { ...custom };
    let sing = { ...single };
    if (prev) ({ cust, sing } = undoInto(prev, from, cust, sing));
    const value = C[side]![from] as string;
    const mv: Move = { to, prevTo: cust[to], prevFrom: sing[from] ?? null };
    cust[to] = value;
    // si ese valor era el elegido para su campo original, se cambia por el del otro contacto (o vacío)
    if (sing[from] === side) {
      const o = other(side);
      sing[from] = empty(C[o]![from] as string) ? null : o;
    }
    setCustom(cust);
    setSingle(sing);
    setMoves((m) => ({ ...m, [key]: mv }));
  };
  /** Deja el valor sin mover: el campo destino y el de origen vuelven a como estaban. */
  const undoMove = (from: TextKey, side: Side) => {
    const key = `${from}:${side}`;
    const mv = moves[key];
    if (!mv) return;
    const { cust, sing } = undoInto(mv, from, { ...custom }, { ...single });
    setCustom(cust);
    setSingle(sing);
    setMoves(({ [key]: _d, ...rest }) => rest);
  };
  const toggleList = (id: string) => setLists((x) => ({ ...x, [id]: !x[id] }));
  const makePrincipal = (s: Side) => {
    if (s === principal) return;
    setPrincipal(s);
    applyDefaults(s, ca, cb);
  };

  /** Lista final de un tipo de dato (lo marcado de los dos, sin repetidos; primero el principal). */
  type Entry = { id: string; item: LabeledValue | Address; extraIndex?: number };
  /** Lo que quedará en cada lista: lo marcado + lo nuevo, en el orden elegido y con su etiqueta. */
  const finalEntries = (k: ListKey): Entry[] => {
    const all: Entry[] = [
      ...finalList(k).map((it) => ({ id: itemKey(k, it), item: it })),
      ...(extra[k] ?? []).map((it, i) => ({ id: `x:${i}`, item: it, extraIndex: i })),
    ];
    const ord = order[k] ?? [];
    const pos = (e: Entry, i: number) => (ord.includes(e.id) ? ord.indexOf(e.id) : 1000 + i);
    const sorted = all.map((e, i) => ({ e, p: pos(e, i) })).sort((a, b) => a.p - b.p).map((x) => x.e);
    return sorted.map((e) => {
      const lbl = labelOv[`${k}|${e.id}`] ?? (e.item as LabeledValue).label ?? "";
      return { ...e, item: { ...e.item, label: canon(k, lbl) } as LabeledValue | Address };
    });
  };
  const moveEntry = (k: ListKey, id: string, d: number) => {
    const ids = finalEntries(k).map((e) => e.id);
    const i = ids.indexOf(id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    setOrder((o) => ({ ...o, [k]: ids }));
  };

  const finalList = (k: ListKey) => {
    const out: (LabeledValue | Address)[] = [];
    const seen = new Set<string>();
    for (const sd of [principal, other(principal)]) {
      (C[sd]![k] as (LabeledValue | Address)[]).forEach((it, i) => {
        const key = itemKey(k, it);
        if (lists[`${k}:${sd}:${i}`] && !seen.has(key)) {
          seen.add(key);
          out.push(it);
        }
      });
    }
    return out;
  };
  const finalNotes = [principal, other(principal)].filter((sd) => notes[sd] && !empty(C[sd]!.notes)).map((sd) => C[sd]!.notes.trim()).join("\n\n");
  const roleOf = (sd: Side) => (sd === principal ? "Contacto principal" : "Contacto a eliminar");
  let boxIndex = 0;
  const shade = () => boxIndex++ % 2 === 1; // recuadros alternos
  const nothing = (txt = "(vacío)") => <div className="p-2 text-xs italic text-slate-400">{txt}</div>;

  return (
    <div className="space-y-4 pb-24">
      <div>
        <h1 className="text-lg font-semibold">Combinar manualmente</h1>
        <p className="mt-1 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
          <strong>Seleccione los elementos a conservar de cada contacto.</strong> Puede marcar elementos de los dos: por ejemplo, si marca las dos direcciones, el contacto combinado tendrá ambas. En la columna <strong>Quedará</strong> ve cómo quedará el contacto.
        </p>
      </div>

      {/* Cabeceras de columna: se quedan fijas al bajar */}
      <div className="sticky top-[68px] z-[5] -mx-4 bg-slate-50/95 px-4 py-2 backdrop-blur">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_1.1fr]">
          {(["a", "b"] as Side[]).map((sd) => {
            const c = C[sd]!;
            const isP = principal === sd;
            return (
              <div key={sd} className={`flex items-center gap-2 rounded-xl border-2 p-2 ${isP ? "border-indigo-500 bg-indigo-50" : "border-red-300 bg-red-50"}`}>
                <Avatar id={c.id} name={c.displayName} hasPhoto={c.hasPhoto} size={40} version={c.updatedAt} />
                <div className="min-w-0 flex-1">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white ${isP ? "bg-indigo-600" : "bg-red-500"}`}>{roleOf(sd)}</span>
                  <div className="truncate text-sm font-semibold">{c.displayName}</div>
                  <div className="flex flex-wrap gap-x-2">
                    {!isP && <button className="text-xs font-medium text-indigo-800 hover:underline" onClick={() => makePrincipal(sd)}>Hacer principal</button>}
                    <Link className="text-xs text-slate-600 hover:underline" to={`/contacts/${c.id}/edit?back=${encodeURIComponent(`/duplicates/merge?a=${ids.a}&b=${ids.b}&p=${C[principal]!.id}`)}`}>
                      ✏️ Editar
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="col-span-2 flex items-center justify-center rounded-xl border-2 border-indigo-400 bg-indigo-600 p-2 text-sm font-semibold text-white md:col-span-1">
            Quedará (contacto combinado)
          </div>
        </div>
      </div>

      {(ca.hasPhoto || cb.hasPhoto) && (
        <FieldBox shade={shade()}
          label="Foto"
          hint="solo una"
          a={ca.hasPhoto ? <Pick radio checked={photo === "a"} onClick={() => setPhoto(photo === "a" ? null : "a")}><Avatar id={ca.id} name={ca.displayName} hasPhoto size={48} version={ca.updatedAt} /></Pick> : nothing("Sin foto")}
          b={cb.hasPhoto ? <Pick radio checked={photo === "b"} onClick={() => setPhoto(photo === "b" ? null : "b")}><Avatar id={cb.id} name={cb.displayName} hasPhoto size={48} version={cb.updatedAt} /></Pick> : nothing("Sin foto")}
          result={photo ? <Avatar id={C[photo]!.id} name={finalOf("displayName")} hasPhoto size={48} version={C[photo]!.updatedAt} /> : <span className="text-sm italic text-slate-500">Sin foto</span>}
        />
      )}

      {singleFields.map(({ key, label }) => {
        const isText = key !== "birthday";
        const tk = key as TextKey;
        const hasCustom = isText && custom[tk] !== undefined;
        if (empty(ca[key]) && empty(cb[key]) && !hasCustom && !added.includes(key)) return null;
        const col = (sd: Side) => {
          const v = C[sd]![key];
          if (empty(v)) return nothing();
          return (
            <>
              <Pick radio checked={!hasCustom && single[key] === sd} onClick={() => toggleSingle(key, sd)}>
                {key === "birthday" ? formatPartialDate(v) : v}
              </Pick>
              {isText && (() => {
                const mv = moves[`${tk}:${sd}`];
                return (
                  <>
                    <select
                      className={`select w-full py-1.5 pl-2 text-xs ${mv ? "border-amber-400 bg-amber-50 font-medium text-amber-900" : "text-slate-600"}`}
                      value={mv?.to ?? ""}
                      onChange={(e) => (e.target.value ? moveTo(tk, sd, e.target.value as TextKey) : undoMove(tk, sd))}
                      aria-label={`Mover «${v}» a otro campo`}
                    >
                      <option value="">{mv ? "— No mover —" : "↪ Mover a otro campo…"}</option>
                      {textFields.filter((f) => f.key !== key).map((f) => <option key={f.key} value={f.key}>{mv ? `↪ Movido a ${f.label}` : f.label}</option>)}
                    </select>
                    {mv && (
                      <button type="button" className="mt-1 text-xs font-medium text-amber-900 hover:underline" onClick={() => undoMove(tk, sd)}>
                        ↩ Deshacer: no mover
                      </button>
                    )}
                  </>
                );
              })()}
            </>
          );
        };
        return (
          <FieldBox shade={shade()}
            key={key}
            label={label}
            hint={isText ? "elige uno, escríbelo o mueve un valor a otro campo" : "elige uno"}
            a={col("a")}
            b={col("b")}
            result={
              isText ? (
                <>
                  <input className={`input bg-white ${hasCustom ? "border-amber-400 ring-2 ring-amber-200" : ""}`} value={finalOf(tk)} placeholder="(vacío)" onChange={(e) => setCustom((x) => ({ ...x, [tk]: e.target.value }))} />
                  {hasCustom && !Object.values(moves).some((m) => m.to === tk) && (
                    <button type="button" className="mt-1 text-xs text-slate-600 hover:underline" onClick={() => setCustom(({ [tk]: _d, ...rest }) => rest)}>
                      ↺ Deshacer lo escrito
                    </button>
                  )}
                  {Object.entries(moves).filter(([, m]) => m.to === tk).map(([k]) => {
                    const [f, sd] = k.split(":") as [TextKey, Side];
                    return (
                      <button key={k} type="button" className="mt-1 block text-xs text-amber-900 hover:underline" onClick={() => undoMove(f, sd)}>
                        ↩ Viene de «{textFields.find((x) => x.key === f)?.label}» ({sd === principal ? "principal" : "a eliminar"}) · deshacer
                      </button>
                    );
                  })}
                </>
              ) : (
                customBirthday !== null || (empty(ca.birthday) && empty(cb.birthday)) ? (
                  <input className="input bg-white" type="date" value={customBirthday ?? ""} onChange={(e) => { setCustomBirthday(e.target.value || null); setSingle((x) => ({ ...x, birthday: null })); }} aria-label="Cumpleaños" />
                ) : (
                  <div className="text-sm font-medium">{single[key] ? formatPartialDate(C[single[key]!]![key]) : <span className="italic text-slate-500">(vacío)</span>}</div>
                )
              )
            }
          />
        );
      })}

      {listFields.map(({ key, label }) => {
        if (!ca[key].length && !cb[key].length && !added.includes(key) && !extra[key]?.length) return null;
        const col = (sd: Side) => {
          const items = C[sd]![key] as (LabeledValue | Address)[];
          if (!items.length) return nothing("(ninguno)");
          return items.map((it, i) => {
            const id = `${key}:${sd}:${i}`;
            const lbl = (it as LabeledValue).label;
            return (
              <Pick key={id} checked={!!lists[id]} onClick={() => toggleList(id)}>
                {key === "addresses" ? addrText(it as Address) : (it as LabeledValue).value}
                {lbl && <span className="block text-[11px] text-slate-500">{lbl}</span>}
              </Pick>
            );
          });
        };
        const entries = finalEntries(key);
        return (
          <FieldBox shade={shade()}
            key={key}
            label={label}
            hint="marca todos los que quieras conservar"
            a={col("a")}
            b={col("b")}
            result={
              <>
                {entries.length ? (
                  <ul className="space-y-1 text-sm">
                    {entries.map((e, i) => (
                      <li key={e.id} className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 ${e.extraIndex !== undefined ? "bg-amber-50 ring-1 ring-amber-200" : "bg-white"}`}>
                        {entries.length > 1 && (
                          <span className="flex shrink-0 flex-col">
                            <button type="button" className="px-0.5 text-[10px] leading-tight text-slate-400 hover:text-indigo-700 disabled:opacity-20" disabled={i === 0} onClick={() => moveEntry(key, e.id, -1)} aria-label="Subir">▲</button>
                            <button type="button" className="px-0.5 text-[10px] leading-tight text-slate-400 hover:text-indigo-700 disabled:opacity-20" disabled={i === entries.length - 1} onClick={() => moveEntry(key, e.id, 1)} aria-label="Bajar">▼</button>
                          </span>
                        )}
                        <span className="min-w-0 flex-1 break-words">
                          {key === "addresses" ? addrText(e.item as Address) : (e.item as LabeledValue).value}
                          {key === "addresses" && (e.item as Address).label && <span className="text-[11px] text-slate-500"> · {(e.item as Address).label}</span>}
                          {e.extraIndex !== undefined && <span className="ml-1 text-[10px] font-semibold uppercase text-amber-800">nuevo</span>}
                        </span>
                        {key !== "addresses" && (
                          <LabelInput kind={key} className="w-28 shrink-0 bg-white" value={(e.item as LabeledValue).label} onChange={(v) => setLabelOv((o) => ({ ...o, [`${key}|${e.id}`]: v }))} />
                        )}
                        {e.extraIndex !== undefined && (
                          <button type="button" className="text-xs text-slate-500 hover:text-red-700" aria-label="Quitar" onClick={() => setExtra((x) => ({ ...x, [key]: x[key]!.filter((_, j) => j !== e.extraIndex) }))}>✕</button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-sm italic text-slate-500">(ninguno)</span>
                )}
                <NewItem kind={key} onAdd={(it) => setExtra((x) => ({ ...x, [key]: [...(x[key] ?? []), it] }))} />
              </>
            }
          />
        );
      })}

      {(!empty(ca.notes) || !empty(cb.notes) || added.includes("notes")) && (
        <FieldBox shade={shade()}
          label="Notas"
          hint="si marcas las dos, se unen"
          a={empty(ca.notes) ? nothing() : <Pick checked={notes.a} onClick={() => setNotes((n) => ({ ...n, a: !n.a }))}><span className="whitespace-pre-wrap">{ca.notes}</span></Pick>}
          b={empty(cb.notes) ? nothing() : <Pick checked={notes.b} onClick={() => setNotes((n) => ({ ...n, b: !n.b }))}><span className="whitespace-pre-wrap">{cb.notes}</span></Pick>}
          result={
            <>
              {finalNotes ? <div className="whitespace-pre-wrap text-sm">{finalNotes}</div> : !added.includes("notes") && <span className="text-sm italic text-slate-500">(sin notas)</span>}
              <textarea className="input mt-1 min-h-16 bg-white" placeholder="Añadir una nota…" value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} />
            </>
          }
        />
      )}

      <AddField
        options={[
          ...singleFields.filter((f) => empty(ca[f.key]) && empty(cb[f.key]) && !added.includes(f.key) && (f.key === "birthday" || custom[f.key as TextKey] === undefined)),
          ...listFields.filter((f) => !ca[f.key].length && !cb[f.key].length && !added.includes(f.key)),
          ...(empty(ca.notes) && empty(cb.notes) && !added.includes("notes") ? [{ key: "notes", label: "Notas" }] : []),
        ]}
        onAdd={(k) => setAdded((a) => [...a, k])}
      />

      <p className="text-center text-xs text-slate-500">
        Las etiquetas, ideas de regalo, regalos recibidos, fechas y relaciones de los dos pasan siempre al contacto principal.
      </p>
      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-2 px-4 py-3">
          <button className="btn-ghost" onClick={() => applyDefaults(principal, ca, cb)}>Restablecer</button>
          <button className="btn-ghost" onClick={() => (params.get("from") === "list" ? nav(-1) : nav("/duplicates"))}>Cancelar</button>
          <button className="btn-primary px-5" disabled={merge.isPending} onClick={() => merge.mutate()}>
            {merge.isPending ? "Combinando…" : "Combinar"}
          </button>
        </div>
      </div>
    </div>
  );
}
