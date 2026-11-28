import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type {
  ContactSummary,
  GiftReceived,
  PublicWishItem,
  PublicWishState,
  RemoteWishList,
  Wish,
  WishGuest,
  WishListDetail,
  WishListKind,
  WishListSummary,
  WishRevealed,
} from "@agendario/shared";
import { api, apiUrl } from "../lib/api";
import { useMe } from "../lib/auth";
import { copyText } from "../lib/clipboard";
import { euros, formatDate } from "../lib/format";
import { Avatar } from "./Avatar";
import { ContactPicker } from "./ContactPicker";
import { Modal, useAlert, useConfirm } from "./Dialogs";

type WishesData = { wishes: Wish[]; lists: WishListSummary[]; publicUrl: string };
const useWishes = () => useQuery({ queryKey: ["wishes"], queryFn: () => api.get<WishesData>("/wishes") });

const host = (u: string | null) => {
  if (!u) return "";
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const parsePrice = (t: string) => {
  const n = Number(t.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", "."));
  return t.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const priceText = (c: number | null) => (c == null ? "" : (c / 100).toLocaleString("es-ES", { minimumFractionDigits: c % 100 ? 2 : 0 }));
const daysTo = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  const t = new Date();
  return Math.round((new Date(y!, m! - 1, dd!).getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86_400_000);
};
const whenText = (d: string) => {
  const n = daysTo(d);
  return n < 0 ? "ya pasó" : n === 0 ? "es hoy" : n === 1 ? "mañana" : `dentro de ${n} días`;
};

export function WishThumb({ w, size = 56 }: { w: Pick<Wish, "id" | "imageKey">; size?: number }) {
  return (
    <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-indigo-100 to-pink-100 text-2xl">
      {w.imageKey ? <img src={apiUrl(`/wishes/${w.id}/image?size=thumb&v=${w.imageKey}`)} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span aria-hidden="true">🌟</span>}
    </span>
  );
}

/** Aviso cuando falta la dirección pública (sin ella no se pueden mandar enlaces). */
function PublicUrlNotice({ url }: { url: string }) {
  const { data: me } = useMe();
  if (url) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <b>Falta la dirección pública de las listas.</b> Sin ella puedes preparar tus deseos y ocasiones, pero no mandar enlaces.{" "}
      {me?.isAdmin ? <Link to="/settings?tab=sync" className="font-semibold text-indigo-700 underline">Configúrala en Ajustes</Link> : "Pídesela al administrador del servidor."}
    </div>
  );
}

// ---------- Pestaña Regalos › Mis deseos ----------

export function WishesView() {
  const { data, isLoading } = useWishes();
  const [editing, setEditing] = useState<Wish | "new" | null>(null);
  const [paste, setPaste] = useState(false);
  const nav = useNavigate();
  const open = data?.lists.find((l) => l.kind === "open");
  return (
    <div className="space-y-3">
      {data && <PublicUrlNotice url={data.publicUrl} />}
      {data?.lists.map((l) => <ListCard key={l.id} l={l} />)}
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost border border-slate-200 text-sm" onClick={() => nav("/gifts/lists/new")}>🎄 Nueva ocasión</button>
        {!open && <button className="btn-ghost border border-slate-200 text-sm" onClick={() => nav("/gifts/lists/new?abierta=1")}>📬 Lista siempre abierta</button>}
      </div>

      <section className="card space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title">🌟 Mis deseos{data ? ` · ${data.wishes.length}` : ""}</h2>
          <button className="btn-primary px-3 py-1.5 text-sm" onClick={() => setEditing("new")}>＋ Deseo</button>
        </div>
        {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
        {data && !data.wishes.length && (
          <p className="py-2 text-sm text-slate-500">
            Apunta aquí lo que te gustaría que te regalaran: con su enlace, precio y una nota («talla M»). Desde el móvil, también con <b>Compartir → Agendario</b> en cualquier tienda.
          </p>
        )}
        <ul className="divide-y divide-slate-100">
          {data?.wishes.map((w) => (
            <li key={w.id}>
              <button type="button" className="flex w-full items-center gap-3 py-2.5 text-left" onClick={() => setEditing(w)}>
                <WishThumb w={w} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-900">{w.title}</span>
                  <span className="block truncate text-sm text-slate-500">{[host(w.url), w.priceCents != null ? euros(w.priceCents) : "", w.notes ? `«${w.notes}»` : ""].filter(Boolean).join(" · ")}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {w.lists.length ? w.lists.map((l) => <span key={l.id} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{l.emoji} {l.title}</span>)
                      : <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">Sin ocasión</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <RemoteLists onPaste={() => setPaste(true)} />
      {editing && <WishDialog wish={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {paste && <PasteLinkDialog onClose={() => setPaste(false)} />}
    </div>
  );
}

function ListCard({ l }: { l: WishListSummary }) {
  return (
    <Link to={`/gifts/lists/${l.id}`} className="block rounded-2xl bg-gradient-to-br from-indigo-700 to-violet-700 p-4 text-white shadow-sm">
      <div className="text-lg font-extrabold">{l.emoji} {l.title}</div>
      <div className="text-sm opacity-90">
        {l.status === "revealed" ? "🎉 ¡Ya puedes ver quién te regaló cada cosa!" : l.kind === "open" ? "Lista siempre abierta" : l.eventDate ? `${formatDate(l.eventDate)} · ${whenText(l.eventDate)}` : ""}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[13px] font-semibold">
        <span className="rounded-full bg-white/20 px-2.5 py-1">{l.wishCount} {l.wishCount === 1 ? "deseo" : "deseos"} · {l.guestCount} {l.guestCount === 1 ? "invitado" : "invitados"}</span>
        {l.status === "active" && l.reveal && <span className="rounded-full bg-white/20 px-2.5 py-1">🤫 Sorpresa activada</span>}
        {l.suggestionCount > 0 && <span className="rounded-full bg-amber-300 px-2.5 py-1 text-slate-900">🙋 {l.suggestionCount} {l.suggestionCount === 1 ? "sugerencia" : "sugerencias"}</span>}
      </div>
    </Link>
  );
}

function WishDialog({ wish, onClose }: { wish: Wish | null; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [title, setTitle] = useState(wish?.title ?? "");
  const [url, setUrl] = useState(wish?.url ?? "");
  const [price, setPrice] = useState(priceText(wish?.priceCents ?? null));
  const [notes, setNotes] = useState(wish?.notes ?? "");
  const done = () => { qc.invalidateQueries({ queryKey: ["wishes"] }); onClose(); };
  const fail = (e: unknown) => showAlert("No se ha podido guardar", (e as Error).message);
  const body = () => ({ title: title.trim(), url: url.trim() || null, notes: notes.trim(), priceCents: parsePrice(price) });
  const save = useMutation({ mutationFn: () => (wish ? api.patch(`/wishes/${wish.id}`, body()) : api.post("/wishes", body())), onSuccess: done, onError: fail });
  const del = useMutation({ mutationFn: () => api.del(`/wishes/${wish!.id}`), onSuccess: done, onError: fail });
  const img = useMutation({
    mutationFn: (f: File | "web" | "remove") => {
      if (f === "remove") return api.del(`/wishes/${wish!.id}/image`);
      if (f === "web") return api.put(`/wishes/${wish!.id}/image`, {});
      const fd = new FormData();
      fd.append("photo", f);
      return api.put(`/wishes/${wish!.id}/image`, fd);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wishes"] }),
    onError: (e) => showAlert("No se ha podido cambiar la imagen", (e as Error).message),
  });
  const current = useWishes().data?.wishes.find((x) => x.id === wish?.id) ?? wish;
  return (
    <Modal title={wish ? "Editar deseo" : "Nuevo deseo"} onClose={onClose}>
      <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); if (title.trim()) save.mutate(); }}>
        <label className="block"><span className="label">¿Qué te gustaría?</span><input className="input" autoFocus={!wish} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Auriculares con cancelación" /></label>
        <label className="block"><span className="label">Enlace (opcional)</span><input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
          <label className="block"><span className="label">Precio (€)</span><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="49,90" /></label>
          <label className="block"><span className="label">Nota para quien te lo regale</span><input className="input" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="Talla M, azul o negra" /></label>
        </div>
        {current && (
          <div className="flex flex-wrap items-center gap-2">
            <WishThumb w={current} size={64} />
            <label className="btn-ghost cursor-pointer border border-slate-200 text-sm">📷 Subir imagen<input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && img.mutate(e.target.files[0])} /></label>
            {current.url && <button type="button" className="btn-ghost border border-slate-200 text-sm" onClick={() => img.mutate("web")}>🌐 De la web</button>}
            {current.imageKey && <button type="button" className="btn-ghost text-sm text-red-700" onClick={() => img.mutate("remove")}>Quitar</button>}
          </div>
        )}
        {!wish && <p className="text-xs text-slate-500">Si pones un enlace, Agendario intentará sacar la foto de la web.</p>}
        <div className="flex flex-wrap justify-between gap-2 pt-1">
          {wish ? (
            <button type="button" className="btn-ghost text-red-700" onClick={async () => (await confirm({ title: `¿Borrar «${wish.title}»?`, message: "Sale de tu lista y de las ocasiones en las que esté.", confirmText: "Borrar", danger: true })) && del.mutate()}>Borrar</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" disabled={!title.trim() || save.isPending}>{save.isPending ? "Guardando…" : "Guardar"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Nueva ocasión / editar lista ----------

export function WishListFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const showAlert = useAlert();
  const { data: wishes } = useWishes();
  const { data: existing } = useQuery({ queryKey: ["wish-list", id], queryFn: () => api.get<WishListDetail>(`/wish-lists/${id}`), enabled: !!id });
  const kind: WishListKind = existing?.kind ?? (params.get("abierta") ? "open" : "occasion");
  const year = new Date().getMonth() === 11 && new Date().getDate() > 25 ? new Date().getFullYear() + 1 : new Date().getFullYear();
  const [title, setTitle] = useState(kind === "open" ? "Lo que me gustaría" : `Navidad ${year}`);
  const [emoji, setEmoji] = useState(kind === "open" ? "📬" : "🎄");
  const [date, setDate] = useState(`${year}-12-25`);
  const [reveal, setReveal] = useState(true);
  const [all, setAll] = useState(kind === "open");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!existing) return;
    setTitle(existing.title); setEmoji(existing.emoji); setDate(existing.eventDate ?? ""); setReveal(existing.reveal); setAll(existing.includeAll);
    setPicked(new Set(existing.wishIds));
  }, [existing]);
  const sel = picked ?? new Set(wishes?.wishes.filter((w) => !w.lists.length).map((w) => w.id) ?? []);
  const toggle = (wid: string) => { const s = new Set(sel); if (s.has(wid)) s.delete(wid); else s.add(wid); setPicked(s); };
  const save = useMutation({
    mutationFn: () => {
      const body = { title: title.trim(), emoji: emoji.trim() || "🎁", eventDate: kind === "open" ? null : date || null, reveal, includeAll: all, wishIds: all ? [] : [...sel] };
      return id ? api.patch<WishListDetail>(`/wish-lists/${id}`, body) : api.post<WishListDetail>("/wish-lists", { kind, ...body });
    },
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ["wishes"] }); qc.setQueryData(["wish-list", d.id], d); nav(`/gifts/lists/${d.id}`, { replace: true }); },
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });
  if (id && !existing) return <p className="text-slate-500">Cargando…</p>;
  return (
    <form className="mx-auto max-w-xl space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <h1 className="text-xl font-semibold text-slate-900">{id ? "Editar lista" : kind === "open" ? "📬 Lista siempre abierta" : "🎄 Nueva ocasión"}</h1>
      {kind === "open" && !id && <p className="text-sm text-slate-600">Para quien te pregunte «¿qué te regalo?» en cualquier momento del año. No tiene fecha: cuando quieras, pulsas «Revelar» y lo que te hayan regalado pasa a Recibidos.</p>}
      <section className="card space-y-3">
        <div className="flex gap-3">
          <label className="block w-20"><span className="label">Emoji</span><input className="input text-center text-xl" value={emoji} maxLength={8} onChange={(e) => setEmoji(e.target.value)} /></label>
          <label className="block flex-1"><span className="label">Nombre</span><input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></label>
        </div>
        {kind === "occasion" && (
          <>
            <label className="block"><span className="label">Fecha</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
            <Toggle on={reveal} onChange={setReveal} title="Revelar después de la fecha" desc="Al día siguiente verás quién te regaló cada cosa y pasará a Recibidos. Si lo apagas, nunca lo sabrás: lo elegido simplemente sale de tu lista." />
          </>
        )}
        <Toggle on={all} onChange={setAll} title="Con todos mis deseos" desc="También los que añadas después." />
      </section>
      {!all && (
        <section className="card space-y-1">
          <h2 className="section-title">¿Qué deseos entran? · {sel.size} de {wishes?.wishes.length ?? 0}</h2>
          {wishes && !wishes.wishes.length && <p className="text-sm text-slate-500">Aún no tienes deseos. Añádelos en Regalos › Mis deseos (también puedes hacerlo después).</p>}
          <ul className="divide-y divide-slate-100">
            {wishes?.wishes.map((w) => (
              <li key={w.id}>
                <label className="flex cursor-pointer items-center gap-3 py-2">
                  <input type="checkbox" className="h-5 w-5 accent-indigo-700" checked={sel.has(w.id)} onChange={() => toggle(w.id)} />
                  <WishThumb w={w} size={40} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{w.title}</span><span className="text-sm text-slate-500">{w.priceCents != null ? euros(w.priceCents) : ""}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
      <button className="btn-primary w-full" disabled={!title.trim() || save.isPending}>{save.isPending ? "Guardando…" : id ? "Guardar" : "Siguiente: invitados →"}</button>
    </form>
  );
}

function Toggle({ on, onChange, title, desc }: { on: boolean; onChange: (v: boolean) => void; title: string; desc: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-start gap-3 text-left">
      <span className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-indigo-700" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
      <span className="text-sm"><b className="block">{title}</b><span className="text-slate-500">{desc}</span></span>
    </button>
  );
}

// ---------- La ocasión: invitados, enlaces, sugerencias y revelación ----------

export function WishListPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const { data: l, isLoading, error } = useQuery({ queryKey: ["wish-list", id], queryFn: () => api.get<WishListDetail>(`/wish-lists/${id}`) });
  const [picking, setPicking] = useState<{ initial?: string; suggestion?: string } | null>(null);
  const [sending, setSending] = useState<WishGuest | null>(null);
  const [preview, setPreview] = useState(false);
  const [renaming, setRenaming] = useState<WishGuest | null>(null);
  const set = (d: WishListDetail) => { qc.setQueryData(["wish-list", id], d); qc.invalidateQueries({ queryKey: ["wishes"] }); };
  const fail = (e: unknown) => showAlert("No se ha podido hacer", (e as Error).message);
  const addGuest = useMutation({
    mutationFn: async ({ c, suggestion }: { c: ContactSummary; suggestion?: string }) => {
      const d = await api.post<WishListDetail>(`/wish-lists/${id}/guests`, { contactId: c.id });
      if (suggestion) await api.post(`/wish-suggestions/${suggestion}/dismiss`);
      return suggestion ? api.get<WishListDetail>(`/wish-lists/${id}`) : d;
    },
    onSuccess: (d) => { set(d); setPicking(null); const g = d.guests[d.guests.length - 1]; if (g && d.publicUrl) setSending(g); },
    onError: fail,
  });
  const removeGuest = useMutation({ mutationFn: (gid: string) => api.del<WishListDetail>(`/wish-lists/${id}/guests/${gid}`), onSuccess: set, onError: fail });
  const rename = useMutation({ mutationFn: ({ gid, name }: { gid: string; name: string }) => api.patch<WishListDetail>(`/wish-lists/${id}/guests/${gid}`, { name }), onSuccess: set, onError: fail });
  const dismiss = useMutation({ mutationFn: (sid: string) => api.post(`/wish-suggestions/${sid}/dismiss`), onSuccess: () => qc.invalidateQueries({ queryKey: ["wish-list", id] }), onError: fail });
  const reveal = useMutation({ mutationFn: () => api.post<WishListDetail>(`/wish-lists/${id}/reveal`), onSuccess: (d) => { set(d); qc.invalidateQueries({ queryKey: ["gifts-received"] }); }, onError: fail });
  const archive = useMutation({ mutationFn: () => api.post(`/wish-lists/${id}/archive`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["wishes"] }); nav("/gifts?vista=deseos", { replace: true }); }, onError: fail });
  const del = useMutation({ mutationFn: () => api.del(`/wish-lists/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["wishes"] }); nav("/gifts?vista=deseos", { replace: true }); }, onError: fail });
  if (isLoading) return <p className="text-slate-500">Cargando…</p>;
  if (!l) return <p className="text-slate-500">{(error as Error)?.message ?? "No encontrada"}</p>;
  const active = l.status === "active";
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h1 className="text-xl font-semibold text-slate-900">{l.emoji} {l.title}</h1>
      <p className="text-sm text-slate-500">
        {l.kind === "open" ? "Lista siempre abierta" : l.eventDate ? `${formatDate(l.eventDate)} · ${whenText(l.eventDate)}` : ""} · {l.wishCount} {l.wishCount === 1 ? "deseo" : "deseos"}
      </p>
      {l.revealed.length > 0 && <Revealed list={l} />}
      {active && l.reveal && (
        <div className="flex gap-2.5 rounded-2xl bg-indigo-50 p-3 text-sm text-indigo-950">
          <span aria-hidden="true">🤫</span>
          <span>
            <b>Sorpresa activada.</b> No verás quién marca qué{l.kind === "open" ? " hasta que pulses «Revelar»" : l.eventDate ? ` hasta el día después de la ocasión` : ""}. Solo sabrás si cada invitado ha abierto su enlace.
          </span>
        </div>
      )}
      {active && !l.reveal && <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-700">🙈 Sin revelación: nunca sabrás quién te regaló qué. Lo elegido saldrá de tu lista después de la fecha.</div>}
      {active && <PublicUrlNotice url={l.publicUrl} />}

      {l.suggestions.map((s) => (
        <div key={s.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm">
          <b>🙋 {s.fromName} sugiere invitar a {s.name}</b>
          {s.note && <p className="mt-0.5 text-slate-700">«{s.note}»</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-primary px-3 py-1.5 text-sm" onClick={() => setPicking({ initial: s.name, suggestion: s.id })}>Invitar</button>
            <button className="btn-ghost border border-slate-200 px-3 py-1.5 text-sm" onClick={() => dismiss.mutate(s.id)}>Descartar</button>
          </div>
        </div>
      ))}

      {active && (
        <section className="card space-y-1">
          <h2 className="section-title">Invitados · enlace personal para cada uno</h2>
          {!l.guests.length && <p className="text-sm text-slate-500">Elige entre tus contactos a quién mandar la lista. Cada uno recibe su propio enlace: no necesitan app ni cuenta.</p>}
          <ul className="divide-y divide-slate-100">
            {l.guests.map((g) => (
              <li key={g.id} className="flex items-center gap-3 py-2.5">
                {g.contact ? <Avatar id={g.contact.id} name={g.contact.displayName} hasPhoto={g.contact.hasPhoto} version={g.contact.updatedAt} size={40} /> : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700">{g.name[0]}</span>}
                <div className="min-w-0 flex-1">
                  <button className="block max-w-full truncate text-left font-semibold" title="Cambiar el nombre que ven los demás" onClick={() => setRenaming(g)}>{g.name}</button>
                  <p className="text-xs text-slate-500">
                    {g.contact && g.contact.displayName !== g.name ? `${g.contact.displayName} · ` : ""}
                    {g.openedAt ? <span className="font-semibold text-emerald-700">✓ Abierto</span> : g.sentAt ? "Enviado, sin abrir" : "Sin enviar"}
                  </p>
                </div>
                <button className="rounded-xl bg-[#25d366] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!l.publicUrl} onClick={() => setSending(g)}>{g.sentAt ? "Reenviar" : "Enviar"}</button>
                <button className="btn-ghost px-2 py-1 text-sm text-slate-500" aria-label={`Quitar a ${g.name}`} title="Quitar" onClick={async () => (await confirm({ title: `¿Quitar a ${g.name}?`, message: "Su enlace dejará de funcionar y lo que haya elegido volverá a quedar libre (no sabrás qué era).", confirmText: "Quitar", danger: true })) && removeGuest.mutate(g.id)}>✕</button>
              </li>
            ))}
          </ul>
          <button className="btn-ghost mt-1 w-full border border-slate-200" onClick={() => setPicking({})}>＋ Añadir invitado de mis contactos</button>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {active && <button className="btn-ghost border border-slate-200" onClick={() => nav(`/gifts/lists/${l.id}/edit`)}>✏️ Editar lista</button>}
        {active && <button className="btn-ghost border border-slate-200" onClick={() => setPreview(true)}>👁 Ver como invitado</button>}
        {active && l.kind === "open" && <button className="btn-ghost border border-slate-200" onClick={async () => (await confirm({ title: "¿Revelar ahora?", message: "Verás quién te regaló cada cosa elegida hasta hoy: pasa a Recibidos y sale de la lista. Lo demás sigue en la lista para quien quiera elegirlo.", confirmText: "Revelar" })) && reveal.mutate()}>🎉 Revelar</button>}
        {l.status === "revealed" && <button className="btn-ghost border border-slate-200" onClick={() => archive.mutate()}>📦 Archivar</button>}
        <button className="btn-ghost text-red-700" onClick={async () => (await confirm({ title: `¿Borrar «${l.title}»?`, message: "Los enlaces dejarán de funcionar. Tus deseos no se borran.", confirmText: "Borrar", danger: true })) && del.mutate()}>Borrar lista</button>
      </div>

      {picking && <ContactPicker title="Invitar a…" initial={picking.initial} onClose={() => setPicking(null)} onPick={(c) => addGuest.mutate({ c, suggestion: picking.suggestion })} />}
      {sending && <SendLinkDialog list={l} guest={sending} onClose={() => { setSending(null); qc.invalidateQueries({ queryKey: ["wish-list", id] }); }} />}
      {preview && <GuestPreview list={l} onClose={() => setPreview(false)} />}
      {renaming && <RenameDialog g={renaming} onClose={() => setRenaming(null)} onSave={(name) => { rename.mutate({ gid: renaming.id, name }); setRenaming(null); }} />}
    </div>
  );
}

function RenameDialog({ g, onClose, onSave }: { g: WishGuest; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(g.name);
  return (
    <Modal title="Nombre que ven los demás" onClose={onClose}>
      <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
        <p className="text-sm text-slate-600">Así aparece {g.contact ? `${g.contact.displayName}` : "este invitado"} para el resto de invitados (no se enseña cómo lo tienes guardado en tu agenda).</p>
        <input className="input" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary">Guardar</button></div>
      </form>
    </Modal>
  );
}

/** Enviar el enlace personal: se genera al abrir (o se renueva, si ya se había enviado). */
function SendLinkDialog({ list, guest, onClose }: { list: WishListDetail; guest: WishGuest; onClose: () => void }) {
  const confirm = useConfirm();
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const issue = async () => {
    try {
      setLink((await api.post<{ link: string }>(`/wish-lists/${list.id}/guests/${guest.id}/link`)).link);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    void (async () => {
      if (guest.sentAt && !(await confirm({ title: `¿Nuevo enlace para ${guest.name}?`, message: "El que le mandaste antes dejará de funcionar (lo que haya elegido se mantiene). Mándale el nuevo.", confirmText: "Crear enlace nuevo" }))) return onClose();
      await issue();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const text = link ? `¡Hola, ${guest.name}! Esta es mi lista para ${list.title} ${list.emoji}. Si compras algo, márcalo para que nadie lo repita (yo no veré qué es 😉):\n${link}` : "";
  const copy = async (t: string, what: string) => { if (await copyText(t)) { setCopied(what); setTimeout(() => setCopied(""), 2000); } };
  return (
    <Modal title={`Enlace para ${guest.name}`} onClose={onClose}>
      <div className="space-y-3 p-4">
        {err && <p className="text-sm text-red-700">{err}</p>}
        {!link && !err && <p className="text-sm text-slate-500">Preparando el enlace…</p>}
        {link && (
          <>
            <div className="whitespace-pre-wrap break-words rounded-xl bg-[#e7fdd8] p-3 text-sm text-slate-900">{text}</div>
            <a className="block rounded-xl bg-[#25d366] p-3 text-center font-semibold text-white" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost border border-slate-200" onClick={() => copy(text, "mensaje")}>{copied === "mensaje" ? "✓ Copiado" : "Copiar mensaje"}</button>
              <button className="btn-ghost border border-slate-200" onClick={() => copy(link, "enlace")}>{copied === "enlace" ? "✓ Copiado" : "Copiar enlace"}</button>
            </div>
            <p className="text-xs text-slate-500">El enlace es personal: al abrirlo, la lista ya sabe que es {guest.name}. No lo abras tú, o verás lo que te van a regalar.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Lo que verá un invitado, pero sin nada de lo elegido. */
function GuestPreview({ list, onClose }: { list: WishListDetail; onClose: () => void }) {
  const { data } = useWishes();
  const items = (data?.wishes ?? []).filter((w) => list.wishIds.includes(w.id));
  return (
    <Modal title={`${list.emoji} ${list.title}`} onClose={onClose}>
      <div className="space-y-2 p-4">
        <p className="text-sm text-slate-500">Así ven la lista tus invitados (aquí sin lo que han elegido, para no estropear la sorpresa).</p>
        {items.map((w) => (
          <div key={w.id} className="flex gap-3 rounded-2xl border border-slate-200 p-3">
            <WishThumb w={w} size={56} />
            <div className="min-w-0">
              <p className="font-semibold">{w.title}</p>
              <p className="text-sm text-slate-500">{[w.priceCents != null ? euros(w.priceCents) : "", w.url ? `Ver en ${host(w.url)} ↗` : ""].filter(Boolean).join(" · ")}</p>
              {w.notes && <p className="text-sm italic text-slate-500">«{w.notes}»</p>}
              <span className="mt-1.5 inline-block rounded-lg bg-indigo-700 px-2.5 py-1 text-sm font-semibold text-white">🎁 Lo regalo yo</span>
            </div>
          </div>
        ))}
        {!items.length && <p className="text-sm text-slate-500">La lista aún no tiene deseos.</p>}
      </div>
    </Modal>
  );
}

/** Después de la fecha: quién te regaló cada cosa (y qué hacer con los nombres sueltos). */
function Revealed({ list }: { list: WishListDetail }) {
  const qc = useQueryClient();
  const showAlert = useAlert();
  const [linking, setLinking] = useState<{ r: WishRevealed; name: string } | null>(null);
  const key = `agendario-deseos-sueltos-${list.id}`;
  const [kept, setKept] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(key) ?? "[]") as string[]; } catch { return []; } });
  const keep = (k: string) => { const n = [...kept, k]; setKept(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* sin almacenamiento */ } };
  const resolve = useMutation({
    mutationFn: async ({ r, name, contactId }: { r: WishRevealed; name: string; contactId: string }) => {
      if (!r.giftId) return;
      const g = (await api.get<GiftReceived[]>("/gifts-received")).find((x) => x.id === r.giftId);
      if (!g) return;
      await api.patch(`/gifts-received/${r.giftId}`, { contactIds: [...new Set([...g.contacts.map((c) => c.id), contactId])], fromNames: (g.fromNames ?? []).filter((n) => n !== name) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wish-list", list.id] }); qc.invalidateQueries({ queryKey: ["gifts-received"] }); setLinking(null); },
    onError: (e) => showAlert("No se ha podido enlazar", (e as Error).message),
  });
  const createAndLink = async (r: WishRevealed, name: string) => {
    try {
      const c = await api.post<{ id: string }>("/contacts", { displayName: name, givenName: name });
      resolve.mutate({ r, name, contactId: c.id });
    } catch (e) {
      void showAlert("No se ha podido crear el contacto", (e as Error).message);
    }
  };
  return (
    <>
      <div className="rounded-2xl bg-gradient-to-br from-indigo-700 via-violet-600 to-pink-600 p-4 text-white">
        <p className="text-lg font-extrabold">🎉 ¡Ya puedes verlo!</p>
        <p className="text-sm opacity-90">Esto es lo que te regalaron. Ya está en <Link to="/gifts?vista=recibidos" className="font-semibold underline">Recibidos</Link>{list.kind === "occasion" ? "; lo que nadie eligió sigue en Mis deseos para la próxima." : "."}</p>
      </div>
      <section className="card space-y-1">
        <h2 className="section-title">🎀 Te regalaron</h2>
        <ul className="divide-y divide-slate-100">
          {list.revealed.map((r) => (
            <li key={r.claimId} className="flex gap-3 py-2.5">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-indigo-100 to-pink-100 text-2xl">
                {r.imageKey && r.giftId ? <img src={apiUrl(`/gifts-received/${r.giftId}/image?size=thumb&v=${r.imageKey}`)} alt="" className="h-full w-full object-cover" /> : "🎁"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{r.title}</p>
                <p className="text-sm text-slate-600">De {joinNames(r.people.map((p) => p.name))}</p>
                {r.looseNames.filter((n) => !kept.includes(`${r.claimId}:${n}`)).map((n) => (
                  <div key={n} className="mt-1.5 rounded-xl bg-slate-50 p-2 text-sm">
                    «{n}» no está en tus contactos.
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <button className="btn-primary px-2.5 py-1 text-xs" onClick={() => setLinking({ r, name: n })}>Enlazar con…</button>
                      <button className="btn-ghost border border-slate-200 px-2.5 py-1 text-xs" onClick={() => createAndLink(r, n)}>Crear contacto</button>
                      <button className="btn-ghost border border-slate-200 px-2.5 py-1 text-xs" onClick={() => keep(`${r.claimId}:${n}`)}>Dejarlo así</button>
                    </div>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
      {linking && <ContactPicker title={`¿Quién es «${linking.name}»?`} initial={linking.name} onClose={() => setLinking(null)} onPick={(c) => resolve.mutate({ r: linking.r, name: linking.name, contactId: c.id })} />}
    </>
  );
}

const joinNames = (l: string[]) => (l.length < 2 ? l.join("") : `${l.slice(0, -1).join(", ")} y ${l[l.length - 1]}`);

// ---------- Ajustes: dirección pública de las listas (solo admin) ----------

export function WishPublicUrlSettings({ Section }: { Section: (p: { title: string; icon: ReactNode; desc?: string; children: ReactNode }) => ReactNode }) {
  const qc = useQueryClient();
  const showAlert = useAlert();
  const { data } = useQuery({ queryKey: ["wishes-public-url"], queryFn: () => api.get<{ url: string }>("/wishes/public-url") });
  const [url, setUrl] = useState<string | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const value = url ?? data?.url ?? "";
  const save = useMutation({
    mutationFn: () => api.put<{ url: string }>("/wishes/public-url", { url: value.trim() }),
    onSuccess: (d) => { qc.setQueryData(["wishes-public-url"], d); qc.invalidateQueries({ queryKey: ["wishes"] }); setUrl(null); setCheck(null); },
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });
  const test = useMutation({ mutationFn: () => api.post<{ ok: boolean; message: string }>("/wishes/public-url/check"), onSuccess: setCheck, onError: (e) => setCheck({ ok: false, message: (e as Error).message }) });
  return (
    <Section icon="🎁" title="Listas de deseos: dirección pública" desc="La dirección de los enlaces que mandas a tus invitados. Tiene que ser un subdominio solo para esto (p. ej. https://regalos.midominio.es): por él Agendario solo enseña la página de la lista, nunca tu agenda ni el inicio de sesión.">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-0 flex-1" placeholder="https://regalos.midominio.es" value={value} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
          <button className="btn-primary" disabled={save.isPending || value.trim() === (data?.url ?? "")} onClick={() => save.mutate()}>Guardar</button>
          <button className="btn-ghost border border-slate-200" disabled={!data?.url || test.isPending} onClick={() => test.mutate()}>{test.isPending ? "Comprobando…" : "Comprobar"}</button>
        </div>
        {check && <p className={`text-sm ${check.ok ? "text-emerald-700" : "text-red-700"}`}>{check.ok ? "✓ " : "✕ "}{check.message}</p>}
        <p className="text-xs text-slate-500">En Nginx Proxy Manager: crea un <i>Proxy Host</i> para ese subdominio hacia el mismo Agendario (IP:3002) con certificado de Let's Encrypt. No hace falta nada más: Agendario reconoce la dirección y por ella solo sirve las listas. Detalles en el manual.</p>
      </div>
    </Section>
  );
}

// ---------- «Añadir a mi Agendario»: listas de otras personas ----------

/** Separa la dirección del servidor y el código de un enlace de lista (https://…/#l=CÓDIGO). */
export function parseListLink(raw: string): { origin: string; token: string; url: string } | null {
  const m = raw.trim().match(/(https:\/\/[^\s#/]+)\/?(?:index\.html)?#l=([A-Za-z0-9_-]{40,64})/);
  return m ? { origin: m[1]!, token: m[2]!, url: `${m[1]}/#l=${m[2]}` } : null;
}

function RemoteLists({ onPaste }: { onPaste: () => void }) {
  const { data } = useQuery({ queryKey: ["wishes-remote"], queryFn: () => api.get<RemoteWishList[]>("/wishes/remote") });
  return (
    <section className="card space-y-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-title">📮 Listas de otras personas</h2>
        <button className="btn-ghost border border-slate-200 px-3 py-1.5 text-sm" onClick={onPaste}>Pegar enlace</button>
      </div>
      {!data?.length && <p className="text-sm text-slate-500">¿Te han mandado una lista de deseos de Agendario? Pega aquí su enlace: lo que regales se apuntará solo en la ficha de esa persona.</p>}
      <ul className="divide-y divide-slate-100">
        {data?.map((r) => (
          <li key={r.url}><Link to={`/gifts/remote?u=${encodeURIComponent(r.url)}`} className="block py-2.5 font-medium text-indigo-700">{r.title || host(r.url)} →</Link></li>
        ))}
      </ul>
    </section>
  );
}

function PasteLinkDialog({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [t, setT] = useState("");
  const p = parseListLink(t);
  return (
    <Modal title="Lista de otra persona" onClose={onClose}>
      <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); if (p) { onClose(); nav(`/gifts/remote?u=${encodeURIComponent(p.url)}`); } }}>
        <p className="text-sm text-slate-600">Pega el enlace (o el mensaje entero) que te mandaron.</p>
        <textarea className="input min-h-24" autoFocus value={t} onChange={(e) => setT(e.target.value)} placeholder="https://regalos.…/#l=…" />
        {t && !p && <p className="text-sm text-red-700">Ese texto no tiene un enlace de lista de Agendario.</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={!p}>Abrir</button></div>
      </form>
    </Modal>
  );
}

/** Una lista de otra persona, abierta desde tu Agendario: marcar y apuntar lo regalado en su ficha. */
export function RemoteListPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const showAlert = useAlert();
  const p = parseListLink(params.get("u") ?? "");
  const { data: saved } = useQuery({ queryKey: ["wishes-remote"], queryFn: () => api.get<RemoteWishList[]>("/wishes/remote") });
  const mine = saved?.find((r) => r.url === p?.url);
  const [picking, setPicking] = useState(false);
  const remote = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${p!.origin}/api/l${path}`, { method, headers: { "X-Lista-Token": p!.token, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, referrerPolicy: "no-referrer", cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw new Error(j.error ?? "No se ha podido conectar con la lista");
    return j;
  };
  const { data: st, error, refetch } = useQuery({ queryKey: ["remote-list", p?.url], queryFn: () => remote<PublicWishState>("GET", "/state"), enabled: !!p });
  const save = useMutation({
    mutationFn: (contactId: string | null) => api.put<RemoteWishList[]>("/wishes/remote", { url: p!.url, contactId, title: st ? `${st.list.emoji} ${st.list.title} de ${st.list.ownerName}` : "" }),
    onSuccess: (d) => { qc.setQueryData(["wishes-remote"], d); setPicking(false); },
  });
  useEffect(() => { if (st && p && saved && !mine) save.mutate(null); /* se guarda al abrirla */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, saved]);
  const contactQ = useQuery({ queryKey: ["contact-name", mine?.contactId], queryFn: () => api.get<{ displayName: string }>(`/contacts/${mine!.contactId}`), enabled: !!mine?.contactId });
  const give = useMutation({
    mutationFn: async (it: PublicWishItem) => {
      const s = await remote<PublicWishState>("POST", "/claims", { wishId: it.id, kind: "solo" });
      // Se apunta en la ficha de esa persona como «comprado» para esa ocasión
      if (mine?.contactId && st) {
        await api.post(`/contacts/${mine.contactId}/gift-ideas`, {
          title: it.title, url: it.url, priceCents: it.priceCents, notes: it.notes,
          status: "bought", givenAt: st.list.eventDate, eventDate: st.list.eventDate, eventKey: st.list.eventDate ? "custom" : null, eventLabel: st.list.title,
        });
        qc.invalidateQueries({ queryKey: ["contact", mine.contactId] });
        qc.invalidateQueries({ queryKey: ["gifts-overview"] });
      }
      return s;
    },
    onSuccess: (s) => qc.setQueryData(["remote-list", p?.url], s),
    onError: (e) => { void showAlert("No se ha podido marcar", (e as Error).message); void refetch(); },
  });
  const leave = useMutation({ mutationFn: (cid: string) => remote<PublicWishState>("POST", `/claims/${cid}/leave`), onSuccess: (s) => qc.setQueryData(["remote-list", p?.url], s), onError: (e) => showAlert("No se ha podido", (e as Error).message) });
  const accept = useMutation({ mutationFn: (cid: string) => remote<PublicWishState>("POST", `/claims/${cid}/accept`, {}), onSuccess: (s) => qc.setQueryData(["remote-list", p?.url], s), onError: (e) => showAlert("No se ha podido", (e as Error).message) });
  const remove = useMutation({ mutationFn: () => api.del(`/wishes/remote?url=${encodeURIComponent(p!.url)}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["wishes-remote"] }); history.back(); } });
  const sorted = useMemo(() => st?.items ?? [], [st]);
  if (!p) return <p className="text-slate-500">El enlace no es válido.</p>;
  if (error) return <div className="card text-sm text-slate-600">{(error as Error).message}</div>;
  if (!st) return <p className="text-slate-500">Cargando la lista…</p>;
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h1 className="text-xl font-semibold text-slate-900">{st.list.emoji} {st.list.title} de {st.list.ownerName}</h1>
      <p className="text-sm text-slate-500">{st.list.eventDate ? formatDate(st.list.eventDate) : "Lista siempre abierta"} · entras como <b>{st.me.name}</b></p>
      <div className="card flex items-center gap-3 text-sm">
        <span className="min-w-0 flex-1">
          {mine?.contactId ? <>Lo que regales se apuntará en la ficha de <b>{contactQ.data?.displayName ?? "…"}</b>.</> : <>¿Quién es {st.list.ownerName} en tu agenda? Así lo que regales se apunta solo en su ficha.</>}
        </span>
        <button className="btn-ghost border border-slate-200 px-3 py-1.5 text-sm" onClick={() => setPicking(true)}>{mine?.contactId ? "Cambiar" : "Elegir contacto"}</button>
      </div>
      {sorted.map((it) => {
        const meIn = it.claim?.people.find((x) => x.me);
        return (
          <div key={it.id} className="card flex gap-3 !p-3">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-100 to-pink-100 text-2xl">🎁</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{it.title}</p>
              <p className="text-sm text-slate-500">
                {it.priceCents != null ? euros(it.priceCents) : ""}
                {it.url && <> {it.priceCents != null ? "· " : ""}<a href={it.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-indigo-700">Ver en {host(it.url)} ↗</a></>}
              </p>
              {it.notes && <p className="text-sm italic text-slate-500">«{it.notes}»</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                {it.takenElsewhere ? <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-500">✓ Ya está elegido</span>
                  : !it.claim ? <button className="btn-primary px-3 py-1.5 text-sm" disabled={give.isPending} onClick={() => give.mutate(it)}>🎁 Lo regalo yo</button>
                  : meIn?.status === "pending" ? <><span className="font-semibold">🙋 Te han apuntado</span><button className="btn-primary px-2.5 py-1 text-sm" onClick={() => accept.mutate(it.claim!.id)}>De acuerdo</button><button className="btn-ghost border border-slate-200 px-2.5 py-1 text-sm" onClick={() => leave.mutate(it.claim!.id)}>No participo</button></>
                  : <>
                      <span className={`rounded-lg px-2.5 py-1 font-semibold ${meIn ? "bg-indigo-50 text-indigo-700" : "bg-emerald-50 text-emerald-700"}`}>{it.claim.kind === "group" ? "👥 " : "✓ "}{meIn && it.claim.kind === "solo" ? "Lo regalas tú" : joinNames(it.claim.people.map((x) => (x.me ? "tú" : x.name)))}</span>
                      {meIn && <button className="btn-ghost px-1 text-sm text-indigo-700" onClick={() => leave.mutate(it.claim!.id)}>Ya no lo regalo</button>}
                    </>}
              </div>
            </div>
          </div>
        );
      })}
      <p className="text-xs text-slate-500">Para regalar algo entre varios o sugerir invitados, ábrela en el navegador: <a className="text-indigo-700 underline" href={p.url} target="_blank" rel="noopener noreferrer">abrir la lista</a>.</p>
      <button className="btn-ghost text-sm text-red-700" onClick={() => remove.mutate()}>Quitar de mi Agendario</button>
      {picking && <ContactPicker title={`¿Quién es ${st.list.ownerName}?`} initial={st.list.ownerName} onClose={() => setPicking(false)} onPick={(c) => save.mutate(c.id)} />}
    </div>
  );
}
