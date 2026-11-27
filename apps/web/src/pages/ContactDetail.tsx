import { capLabel } from "../lib/text";
import { Chevron } from "../components/Chevron";
import { ReminderMark } from "../components/ReminderMark";
import { keepInView } from "../lib/keepInView";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  dateTypeLabels,
  reminderKindIcons,
  reminderKindLabels,
  isGeolocated,
  dateTypes,
  relationshipLabels,
  relationshipTypes,
  saintDateFor,
  type ContactDetail,
  type ContactSummary,
  type DateType,
  type RelationshipType,
} from "@agendario/shared";
import { Avatar } from "../components/Avatar";
import { GiftsBox } from "../components/GiftsBox";
import { SharePanel } from "../components/SharePanel";
import { ContactTags } from "../components/Tags";
import { ItemTag } from "../components/ItemTag";
import { addressLine, MapLinks, MiniMap } from "../components/MapLinks";
import { MapPickerButton } from "../components/AddressSearch";
import { VisibilityBadge } from "../components/VisibilityBadge";
import { ContactPicker } from "../components/ContactPicker";
import { byNextAnniversary, usePersonalEvents } from "../components/PersonalEvents";
import { PhotoCropper } from "../components/PhotoCropper";
import { PhotoViewer, viewerBtn } from "../components/PhotoViewer";
import { apiUrl } from "../lib/platform";
import { EmojiPicker } from "../components/EmojiPicker";
import { QuickActions, useEmailHref, useUserPrefs } from "../components/QuickActions";
import { Interactions, type InteractionPrefill } from "../components/Interactions";
import { HistoryIcon } from "../components/HistoryIcon";
import { telLink } from "../lib/links";
import { api, photoUrl } from "../lib/api";
import { Modal, useAlert, useConfirm } from "../components/Dialogs";
import { ContactReminders } from "../components/Reminders";
import { noteDial } from "../lib/native";
import { formatPartialDate } from "../lib/format";
import { StarIcon } from "../components/StarIcon";
import { haptic } from "../lib/native";

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

const smallBtn = "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100";

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** Trabajadores: contactos que tienen enlazada esta ficha como empresa. */
function Employees({ c }: { c: ContactDetail }) {
  const mail = useEmailHref();
  return (
    <section className="card">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="section-title mb-0"><span aria-hidden="true">👥</span> Trabajadores ({c.employees.length})</h2>
        {c.canEdit && <Link className="btn-ghost px-2 py-1 text-sm" to={`/contacts/new?org=${c.id}&orgName=${encodeURIComponent(c.displayName)}`}>+ Añadir trabajador</Link>}
      </div>
      <ul className="divide-y divide-slate-100">
        {c.employees.map((e) => (
          <li key={e.id} className="flex items-center gap-3 py-2">
            <Link to={`/contacts/${e.id}`} className="flex min-w-0 flex-1 items-center gap-3 hover:text-indigo-800">
              <Avatar id={e.id} name={e.displayName} hasPhoto={e.hasPhoto} size={36} version={e.updatedAt} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{e.displayName}</span>
                {e.jobTitle && <span className="block truncate text-xs text-slate-500">{e.jobTitle}</span>}
              </span>
            </Link>
            {e.phone && <a className="btn-ghost px-2 py-1 text-sm" href={telLink(e.phone)} title={`Llamar al ${e.phone}`}>📞</a>}
            {e.email && <a className="btn-ghost px-2 py-1 text-sm" href={mail(e.email)} target={mail(e.email).startsWith("http") ? "_blank" : undefined} rel="noreferrer" title={e.email}>✉️</a>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <span className="w-24 shrink-0 pt-0.5 text-slate-500">{capLabel(label) || "—"}</span>
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

/** Bloque con título dentro de «Datos» (Teléfonos, Emails…). */
function Block({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="border-t border-slate-100 pt-2.5 first:border-t-0 first:pt-0">
      <h3 className="mb-1 flex items-center gap-2 text-[16px] font-semibold text-indigo-950">
        <span aria-hidden="true">{icon}</span> {title}
      </h3>
      {children}
    </div>
  );
}

export function ContactDetailPage() {
  const mail = useEmailHref();
  const { id } = useParams() as { id: string };
  const nav = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const showAlert = useAlert();
  // Al volver de una llamada hecha desde aquí, se ofrece apuntarla
  const [lastCall, setLastCall] = useState<{ phone: string; at: number } | null>(null);
  const [askCall, setAskCall] = useState(false);
  const [prefill, setPrefill] = useState<InteractionPrefill | null>(null);
  const [params, setParams] = useSearchParams();
  const openCall = params.get("call");
  // ?remind=1 → abrir «Nuevo recordatorio» (desde el aviso al colgar una llamada)
  const remindNow = params.get("remind") === "1";
  // Antes de llamar desde aquí: tus últimas notas y recordatorios con este contacto
  const [preCall, setPreCall] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(!!openCall || false);
  const [ctab, setCtab] = useState<"tel" | "mail" | "otros">("tel");
  useEffect(() => {
    if (!lastCall) return;
    const onVis = () => document.visibilityState === "visible" && Date.now() - lastCall.at > 3000 && setAskCall(true);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [lastCall]);
  const { data: c, isLoading, error } = useQuery({
    queryKey: ["contact", id],
    queryFn: () => api.get<ContactDetail>(`/contacts/${id}`),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["contact", id] });
    qc.invalidateQueries({ queryKey: ["contacts"] });
    qc.invalidateQueries({ queryKey: ["upcoming"] });
  };

  const [cropFile, setCropFile] = useState<File | null>(null);
  const uploadPhoto = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("photo", file);
      return api.put(`/contacts/${id}/photo`, fd);
    },
    onSuccess: refresh,
    onError: (e) => showAlert("No se ha podido subir la foto", (e as Error).message),
  });
  const removePhoto = useMutation({ mutationFn: () => api.del(`/contacts/${id}/photo`), onSuccess: () => { setViewer(null); refresh(); } });
  // Visor de la foto y de la portada; la portada se recorta apaisada (3:1)
  const [viewer, setViewer] = useState<"photo" | "cover" | null>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const uploadCover = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("photo", file);
      return api.put(`/contacts/${id}/cover`, fd);
    },
    onSuccess: refresh,
    onError: (e) => showAlert("No se ha podido subir la portada", (e as Error).message),
  });
  const removeCover = useMutation({ mutationFn: () => api.del(`/contacts/${id}/cover`), onSuccess: () => { setViewer(null); refresh(); } });
  const remove = useMutation({
    mutationFn: () => api.del(`/contacts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contacts"] }); qc.invalidateQueries({ queryKey: ["trash"] }); qc.invalidateQueries({ queryKey: ["duplicates"] }); nav("/", { replace: true }); },
  });

  if (isLoading) return <p className="text-slate-500">Cargando…</p>;
  if (error || !c) return <p className="text-red-600">{(error as Error)?.message ?? "No encontrado"}</p>;

  const tag = (itemId?: string) => <ItemTag contactId={c.id} itemId={itemId} current={itemId ? c.itemTags[itemId] : undefined} contactTags={c.tags} />;
  const mobileAlias = c.mobileName === "nickname" ? c.nickname.trim() : c.mobileName === "display" ? c.displayName : "";
  const hasOther = !!c.nickname || !!mobileAlias; // el cumpleaños se ve en Celebraciones → Fechas importantes
  const contactTabs = [["tel", "📞 Teléfonos", c.phones.length], ["mail", "✉️ Emails", c.emails.length], ["otros", "🗂️ Otros", (c.nickname ? 1 : 0) + (mobileAlias ? 1 : 0)]] as const;
  const dueNow = c.reminders.some((r) => new Date(r.dueAt).getTime() <= Date.now());
  // Notas y recordatorios que se enseñan antes de llamar
  const lastNotes = c.interactions.filter((x) => x.notes.trim()).slice(0, 3);
  const startCall = (phone: string, e?: React.MouseEvent) => {
    void noteDial(phone);
    if (!preCall && (lastNotes.length || c.reminders.length)) {
      e?.preventDefault();
      setPreCall(phone);
      return;
    }
    setLastCall({ phone, at: Date.now() });
  };

  return (
    <div className="space-y-4">
      {/* Cabecera compacta: foto a la izquierda, todo lo demás a la derecha */}
      <section className={`detail-head card grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 ${c.hasCover ? "overflow-hidden" : ""}`}>
        {c.hasCover && (
          <button
            type="button"
            className="detail-cover col-span-2 -mx-4 -mt-4 block overflow-hidden"
            style={{ width: "calc(100% + 2rem)", height: "min(240px, 33vw)" }}
            onClick={() => setViewer("cover")}
            aria-label="Ver la portada"
          >
            <img src={apiUrl(`/contacts/${c.id}/cover?size=thumb&v=${encodeURIComponent(c.updatedAt)}`)} srcSet={`${apiUrl(`/contacts/${c.id}/cover?size=thumb&v=${encodeURIComponent(c.updatedAt)}`)} 800w, ${apiUrl(`/contacts/${c.id}/cover?size=full&v=${encodeURIComponent(c.updatedAt)}`)} 1600w`} sizes="(min-width: 900px) 900px, 100vw" alt="" className="h-full w-full object-cover" />
          </button>
        )}
        <button
          className={`detail-photo group relative shrink-0 rounded-full sm:row-span-2 ${c.hasCover ? "cover-photo -mt-12" : ""}`}
          disabled={!c.canEdit && !c.hasPhoto}
          onClick={() => (c.hasPhoto ? setViewer("photo") : fileRef.current?.click())}
          title={c.hasPhoto ? "Ver la foto" : c.canEdit ? "Poner foto" : undefined}
        >
          <span className="sm:hidden"><Avatar id={c.id} name={c.displayName} hasPhoto={c.hasPhoto} size={72} version={c.updatedAt} /></span>
          <span className="hidden sm:block"><Avatar id={c.id} name={c.displayName} hasPhoto={c.hasPhoto} size={104} version={c.updatedAt} /></span>
          {c.canEdit && (
            <span className="absolute inset-0 hidden items-center justify-center rounded-full bg-black/40 text-xs text-white group-hover:flex">
              {uploadPhoto.isPending ? "Subiendo…" : c.hasPhoto ? "Ver" : "Poner foto"}
            </span>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setCropFile(f); e.target.value = ""; }} />
        {cropFile && <PhotoCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={(f) => { setCropFile(null); setViewer(null); uploadPhoto.mutate(f); }} />}
        <input ref={coverRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setCoverFile(f); e.target.value = ""; }} />
        {coverFile && <PhotoCropper file={coverFile} aspect={3} title="Encuadrar la portada" onCancel={() => setCoverFile(null)} onDone={(f) => { setCoverFile(null); setViewer(null); uploadCover.mutate(f); }} />}
        {viewer === "photo" && c.hasPhoto && (
          <PhotoViewer
            src={photoUrl(c.id, "full", c.updatedAt)}
            alt={c.displayName}
            round
            onClose={() => setViewer(null)}
            actions={c.canEdit && (
              <>
                <button className={viewerBtn} onClick={() => fileRef.current?.click()}>📷 Cambiar foto</button>
                <button className={viewerBtn} onClick={() => removePhoto.mutate()}>🗑️ Quitar foto</button>
              </>
            )}
          />
        )}
        {viewer === "cover" && c.hasCover && (
          <PhotoViewer
            src={apiUrl(`/contacts/${c.id}/cover?size=full&v=${encodeURIComponent(c.updatedAt)}`)}
            alt={`Portada de ${c.displayName}`}
            onClose={() => setViewer(null)}
            actions={c.canEdit && (
              <>
                <button className={viewerBtn} onClick={() => coverRef.current?.click()}>🖼️ Cambiar portada</button>
                <button className={viewerBtn} onClick={() => removeCover.mutate()}>🗑️ Quitar portada</button>
              </>
            )}
          />
        )}
        <div className="detail-name self-center sm:self-start">
            <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-semibold leading-tight">
              {c.displayName}
              <FavoriteButton id={c.id} favorite={!!c.favorite} />
              {c.reminders.length > 0 && (
                <a href="#recordatorios" className={`reminder-chip ${dueNow ? "is-due" : ""}`} onClick={(e) => { e.preventDefault(); document.getElementById("recordatorios")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                  <ReminderMark count={c.reminders.length} overdue={dueNow} className="h-4 w-4" />
                  {c.reminders.length} {c.reminders.length === 1 ? "recordatorio" : "recordatorios"}
                </a>
              )}
              <span className="text-xs font-normal"><VisibilityBadge v={c.visibility} /></span>
            </h1>
            {(c.jobTitle || (c.organization && c.organization !== c.displayName)) && (
              <p className="mt-0.5 text-slate-500">
                {c.jobTitle}
                {c.jobTitle && c.organization && " · "}
                {c.organizationContact ? (
                  <Link to={`/contacts/${c.organizationContact.id}`} className="text-indigo-700 hover:underline" title="Ver la ficha de la empresa">
                    🔗 {c.organization || c.organizationContact.displayName}
                  </Link>
                ) : (
                  c.organization
                )}
              </p>
            )}
            {!c.isMine && <p className="text-xs text-slate-500">de {c.ownerName}{c.canEdit ? " · puedes editar" : " · solo lectura"}</p>}
        </div>
        {/* En el móvil, de las etiquetas para abajo va debajo de la foto, a todo el ancho */}
        <div className="detail-rest col-span-2 min-w-0 space-y-2.5 sm:col-span-1 sm:col-start-2">
          <ContactTags contactId={c.id} tags={c.tags} align="start" />
          <QuickActions c={c} align="start" onCall={startCall} />
          {askCall && lastCall && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
              ¿Apuntar la llamada?
              <button
                className="btn-primary px-2.5 py-1"
                onClick={() => {
                  setPrefill({ kind: "call_out", channel: lastCall.phone, at: new Date(lastCall.at), durationMin: Math.max(1, Math.round((Date.now() - lastCall.at) / 60000)) });
                  setAskCall(false);
                  setLastCall(null);
                  setShowLog(true);
                  setTimeout(() => document.getElementById("interactions")?.scrollIntoView({ behavior: "smooth" }), 50);
                }}
              >
                Apuntar
              </button>
              <button className="btn-ghost px-2.5 py-1" onClick={() => { setAskCall(false); setLastCall(null); }}>No</button>
            </div>
          )}
          {preCall && (
            <Modal title={<span>📞 Antes de llamar a {c.displayName}</span>} onClose={() => setPreCall(null)} size="md"
              footer={<>
                <button className="btn-ghost" onClick={() => setPreCall(null)}>Cancelar</button>
                <a className="btn-primary" href={telLink(preCall)} onClick={() => { setLastCall({ phone: preCall, at: Date.now() }); setPreCall(null); }}>📞 Llamar · {preCall}</a>
              </>}>
              <div className="space-y-4 p-4">
                {c.reminders.length > 0 && (
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-slate-700">⏰ Pendiente</h3>
                    <ul className="space-y-1.5">
                      {c.reminders.slice(0, 3).map((r) => (
                        <li key={r.id} className="rounded-xl bg-amber-50 px-3 py-2 text-sm ring-1 ring-amber-200">
                          {reminderKindIcons[r.kind]} <span className="font-medium">{reminderKindLabels[r.kind]}</span>{r.text && <> · {r.text}</>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {lastNotes.length > 0 && (
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-slate-700">📝 Últimas anotaciones</h3>
                    <ul className="space-y-1.5">
                      {lastNotes.map((x) => (
                        <li key={x.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                          <span className="block text-xs text-slate-500">{new Date(x.occurredAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}</span>
                          <span className="line-clamp-4 whitespace-pre-line">{x.notes}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Modal>
          )}
          <div className="flex flex-wrap items-center gap-1">
            {c.canEdit && (
              <Link to={`/contacts/${c.id}/edit`} className={smallBtn} title="Editar contacto">
                <PencilIcon className="h-4 w-4" /> Editar
              </Link>
            )}
            <Link to={`/contacts/${c.id}/history`} className={smallBtn} title="Historial de cambios">
              <HistoryIcon className="h-4 w-4" /> Historial{c.historyCount > 0 && <span className="text-slate-400">({c.historyCount})</span>}
            </Link>
            {c.canEdit && !c.hasCover && (
              <button className={smallBtn} onClick={() => coverRef.current?.click()} title="Imagen apaisada detrás de la cabecera (solo se ve en Agendario)">
                <span aria-hidden="true">🖼️</span> {uploadCover.isPending ? "Subiendo…" : "Portada"}
              </button>
            )}
            {c.isMine && (
              <button
                className={`${smallBtn} text-red-700 hover:bg-red-50`}
                onClick={async () => (await confirm({ title: `¿Borrar a «${c.displayName}»?`, message: "Irá a la papelera: podrás restaurarlo durante 60 días, con su foto, fechas e ideas de regalo.", confirmText: "Borrar", danger: true })) && remove.mutate()}
              >
                <TrashIcon className="h-4 w-4" /> Borrar
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Contacto: teléfonos, emails y otros datos en pestañas; debajo, llamadas y apuntes */}
      <section className="card" id="interactions">
        <h2 className="section-title">📇 Contacto</h2>
        <div className="mb-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Datos de contacto">
          {contactTabs.map(([k, label, n]) => (
            <button key={k} type="button" role="tab" aria-selected={ctab === k} className={`m3-subtab is-compact ${ctab === k ? "is-on" : ""}`} onClick={() => setCtab(k)}>
              {label}{n > 0 && <span className="ml-1 opacity-70">{n}</span>}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="min-h-[4.5rem]">
          {ctab === "tel" && (
            <>
              {c.phones.length === 0 && <p className="py-1.5 text-sm text-slate-400">Sin teléfonos.</p>}
              {c.phones.map((p, i) => (
                <Row key={`p${i}`} label={p.label}>
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <a className="text-indigo-700" href={telLink(p.value)} onClick={(e) => startCall(p.value, e)}>{p.value}</a>
                    {tag(p.id)}
                  </span>
                </Row>
              ))}
            </>
          )}
          {ctab === "mail" && (
            <>
              {c.emails.length === 0 && <p className="py-1.5 text-sm text-slate-400">Sin emails.</p>}
              {c.emails.map((e, i) => (
                <Row key={`e${i}`} label={e.label}>
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <a className="break-all text-indigo-700" href={mail(e.value)} target={mail(e.value).startsWith("http") ? "_blank" : undefined} rel="noreferrer">{e.value}</a>
                    {tag(e.id)}
                  </span>
                </Row>
              ))}
            </>
          )}
          {ctab === "otros" && (
            <>
              {!hasOther && <p className="py-1.5 text-sm text-slate-400">Sin otros datos.</p>}
              {c.nickname && <Row label="Apodo">{c.nickname}</Row>}
              {mobileAlias && <Row label="En el móvil">{mobileAlias} <span className="text-xs text-slate-400">(nombre que ven la agenda del móvil y WhatsApp)</span></Row>}
            </>
          )}
        </div>
        <div className="mt-2 border-t border-slate-100 pt-2">
          <button className="btn-ghost w-full justify-between px-2 py-2 text-[15px] font-medium" onClick={() => setShowLog(!showLog)} aria-expanded={showLog}>
            <span>📒 Llamadas y apuntes{c.interactions.length > 0 && <span className="text-slate-400"> ({c.interactions.length})</span>}</span>
            <span className="text-slate-500"><Chevron open={showLog} className="h-6 w-6" /></span>
          </button>
          {showLog && (
            <div className="mt-2">
              <Interactions c={c} embedded prefill={prefill} onPrefillUsed={() => setPrefill(null)} openId={openCall} />
            </div>
          )}
        </div>
      </section>

      {/* Resto de datos */}
      {(c.addresses.length > 0 || c.urls.length > 0 || c.notes) && (
        <section className="card">
          <div className="space-y-2.5">
            {c.addresses.length > 0 && (
              <Block icon="🏠" title="Direcciones">
                <div className="grid gap-3 pt-1 md:grid-cols-2">
                  {c.addresses.map((a, i) => (
                    <div key={`a${i}`} className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3 sm:flex-row">
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{capLabel(a.label ?? "") || "Dirección"}</div>
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span>{addressLine(a)}</span>
                          {isGeolocated(a) && <span title="Dirección geolocalizada">📍</span>}
                          {tag(a.id)}
                        </span>
                        <div className="relative z-10 mt-2"><MapLinks address={a} /></div>
                      </div>
                      {isGeolocated(a) ? (
                        <MiniMap address={a} className="h-36 w-full shrink-0 sm:h-32 sm:w-40" />
                      ) : (
                        c.canEdit && (
                          <div className="flex shrink-0 items-center">
                            <MapPickerButton
                              address={a}
                              onChange={async (patch) => {
                                await api.patch(`/contacts/${c.id}`, { addresses: c.addresses.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                                refresh();
                              }}
                            />
                          </div>
                        )
                      )}
                    </div>
                  ))}
                </div>
              </Block>
            )}
            {c.urls.length > 0 && (
              <Block icon="🌐" title="Webs">
                {c.urls.map((u, i) => <Row key={`u${i}`} label={u.label}><a className="break-all text-indigo-700" href={u.value} target="_blank" rel="noreferrer">{u.value}</a></Row>)}
              </Block>
            )}
            {c.notes && (
              <Block icon="📝" title="Notas">
                <p className="whitespace-pre-wrap py-1.5 text-sm">{c.notes}</p>
              </Block>
            )}
          </div>
        </section>
      )}

      {c.employees.length > 0 && <Employees c={c} />}

      {/* Celebraciones */}
      <div>
        {/* Mosaico: dos columnas independientes, cada recuadro pegado al de encima (en el móvil, uno tras otro) */}
        <div className="grid items-start gap-4 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <GiftsBox contactId={c.id} contactName={c.displayName} ideas={c.giftIdeas} received={c.giftsReceived} />
            <Relationships c={c} onChange={refresh} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <div id="recordatorios" className="scroll-mt-28">
            <ContactReminders
              contact={{ id: c.id, displayName: c.displayName, hasPhoto: c.hasPhoto, updatedAt: c.updatedAt }}
              reminders={c.reminders ?? []}
              autoOpen={remindNow}
              onAutoOpened={() => { if (remindNow) { const n = new URLSearchParams(params); n.delete("remind"); setParams(n, { replace: true }); } }}
            />
            </div>
            <ImportantDates c={c} onChange={refresh} />
            <LinkedPersonalEvents contactId={c.id} />
          </div>
        </div>
      </div>

      {c.isMine && c.visibility === "shared" && c.shares && <SharePanel contactId={c.id} shares={c.shares} />}
      {c.isMine && c.visibility === "private" && (
        <p className="text-center text-xs text-slate-400">Para compartirlo, edítalo y cambia la visibilidad a «Compartido».</p>
      )}
    </div>
  );
}


/** Por fecha (personal): ¿lleva regalo? y emoji para el calendario. */
function EventControls({ c, eventKey, defaultGift, onChange }: { c: ContactDetail; eventKey: string; defaultGift: boolean; onChange: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const cur = c.prefs.events?.[eventKey] ?? {};
  const gift = cur.gift ?? defaultGift;
  const save = useMutation({
    mutationFn: (patch: { gift?: boolean; emoji?: string }) => {
      const next = { ...cur, ...patch };
      if (next.emoji === "") delete next.emoji;
      return api.put(`/contacts/${c.id}/prefs`, { ...c.prefs, events: { ...(c.prefs.events ?? {}), [eventKey]: next } });
    },
    onSuccess: () => { onChange(); qc.invalidateQueries({ queryKey: ["upcoming"] }); },
  });
  return (
    <span className="relative flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => save.mutate({ gift: !gift })}
        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${gift ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-white text-slate-400 ring-slate-200 line-through"}`}
        title={gift ? "Lleva regalo (toca para quitarlo)" : "Sin regalo (toca para que lo lleve)"}
      >
        🎁
      </button>
      <button type="button" onClick={() => setOpen(!open)} className="rounded-full px-1.5 py-0.5 text-sm ring-1 ring-slate-200 hover:bg-slate-50" title="Emoji para el calendario">
        {cur.emoji ?? <span className="text-xs text-slate-400">☺︎+</span>}
      </button>
      {open && <span className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}
      {open && (
        <span ref={keepInView} className="absolute right-0 top-full z-20 mt-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <span className="mb-1 block text-[11px] text-slate-500">Emoji en el calendario</span>
          <EmojiPicker value={cur.emoji} onPick={(e) => { save.mutate({ emoji: e }); setOpen(false); }} onClear={() => { save.mutate({ emoji: "" }); setOpen(false); }} />
        </span>
      )}
    </span>
  );
}

function ImportantDates({ c, onChange }: { c: ContactDetail; onChange: () => void }) {
  const showAlert = useAlert();
  const { data: userPrefs } = useUserPrefs();
  const qc = useQueryClient();
  const saint = c.givenName ? saintDateFor(c.givenName) : null;
  const hasManualSaint = c.importantDates.some((d) => d.type === "saint_day");
  const showAuto = !!saint && !!userPrefs?.autoSaints && !hasManualSaint;
  const toggleAuto = useMutation({
    mutationFn: (autoSaint: boolean) => api.put(`/contacts/${c.id}/prefs`, { ...c.prefs, autoSaint }),
    onSuccess: () => { onChange(); qc.invalidateQueries({ queryKey: ["upcoming"] }); },
  });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ label: string; type: DateType; date: string }>({ label: "", type: "anniversary", date: "" });
  const add = useMutation({
    mutationFn: () => api.post(`/contacts/${c.id}/dates`, { ...draft, label: draft.label || dateTypeLabels[draft.type] }),
    onSuccess: () => { setAdding(false); setDraft({ label: "", type: "anniversary", date: "" }); onChange(); },
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });
  const remove = useMutation({ mutationFn: (sub: string) => api.del(`/contacts/${c.id}/dates/${sub}`), onSuccess: onChange });
  const [editing, setEditing] = useState<string | null>(null); // id de la fecha o "birthday"
  const saveDate = useMutation({
    mutationFn: ({ id, label, date }: { id: string; label: string; date: string }) =>
      id === "birthday" ? api.patch(`/contacts/${c.id}`, { birthday: date }) : api.patch(`/contacts/${c.id}/dates/${id}`, { label, date }),
    onSuccess: () => { setEditing(null); onChange(); qc.invalidateQueries({ queryKey: ["upcoming"] }); qc.invalidateQueries({ queryKey: ["gifts-overview"] }); },
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });

  if (!c.canEdit && c.importantDates.length === 0) return null;
  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title mb-0">📅 Fechas importantes</h2>
        {c.canEdit && !adding && <button className="btn-ghost" onClick={() => setAdding(true)}>+ Añadir</button>}
      </div>
      {adding && (
        <form onSubmit={(e) => { e.preventDefault(); if (draft.date) add.mutate(); }} className="mb-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
          <select className="input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as DateType })}>
            {dateTypes.map((t) => <option key={t} value={t}>{dateTypeLabels[t]}</option>)}
          </select>
          <input className="input" placeholder="Descripción (opcional)" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          <input className="input" type="date" required value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          <div className="flex justify-end gap-2 sm:col-span-3">
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>Cancelar</button>
            <button className="btn-primary">Guardar</button>
          </div>
        </form>
      )}
      {c.birthday && (editing === "birthday" ? (
        <DateEditForm label="Cumpleaños" fixedLabel date={c.birthday} busy={saveDate.isPending} onCancel={() => setEditing(null)} onSave={(label, date) => saveDate.mutate({ id: "birthday", label, date })} />
      ) : (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="flex-1">{c.prefs.events?.birthday?.emoji ?? "🎂"} Cumpleaños <span className="text-slate-500">· {formatPartialDate(c.birthday)}</span></span>
          <EventControls c={c} eventKey="birthday" defaultGift onChange={onChange} />
          {c.canEdit && <button className="btn-ghost px-1.5 py-1 text-xs" title="Editar" onClick={() => setEditing("birthday")}>✏️</button>}
        </div>
      ))}
      {showAuto && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className={`flex-1 ${c.prefs.autoSaint ? "" : "text-slate-400 line-through"}`}>
            {c.prefs.events?.saint?.emoji ?? ""} Santo <span className="text-slate-500">· {formatPartialDate(saint)} (por el nombre)</span>
          </span>
          {c.prefs.autoSaint && <EventControls c={c} eventKey="saint" defaultGift onChange={onChange} />}
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => toggleAuto.mutate(!c.prefs.autoSaint)}>{c.prefs.autoSaint ? "Quitar" : "Volver a poner"}</button>
        </div>
      )}
      {c.importantDates.length === 0 && !adding && !showAuto && !c.birthday && <p className="text-sm text-slate-500">Ninguna. El cumpleaños va en los datos del contacto.</p>}
      <ul className="space-y-1">
        {c.importantDates.map((d) => editing === d.id ? (
          <li key={d.id}><DateEditForm label={d.label} date={d.date} busy={saveDate.isPending} onCancel={() => setEditing(null)} onSave={(label, date) => saveDate.mutate({ id: d.id, label, date })} /></li>
        ) : (
          <li key={d.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm hover:bg-slate-50">
            <span className="flex-1">{c.prefs.events?.[`date:${d.id}`]?.emoji ? `${c.prefs.events[`date:${d.id}`]!.emoji} ` : ""}{d.label} <span className="text-slate-500">· {formatPartialDate(d.date)}</span></span>
            <EventControls c={c} eventKey={`date:${d.id}`} defaultGift={["anniversary", "saint_day"].includes(d.type)} onChange={onChange} />
            {c.canEdit && <button className="btn-ghost px-1.5 py-1 text-xs" title="Editar" onClick={() => setEditing(d.id)}>✏️</button>}
            {c.canEdit && <button className="btn-danger text-xs" onClick={() => remove.mutate(d.id)}>✕</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Editar una fecha: nombre, día, mes y año (opcional; sin año no se calcula la edad). */
function DateEditForm({ label, date, fixedLabel, busy, onSave, onCancel }: { label: string; date: string; fixedLabel?: boolean; busy: boolean; onSave: (label: string, date: string) => void; onCancel: () => void }) {
  const m0 = date.match(/^(\d{4}|-)-?(\d{2})-(\d{2})$/);
  const [name, setName] = useState(label);
  const [year, setYear] = useState(m0 && m0[1] !== "-" ? m0[1]! : "");
  const [month, setMonth] = useState(m0 ? Number(m0[2]) : 1);
  const [day, setDay] = useState(m0 ? Number(m0[3]) : 1);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const valid = name.trim() && (!year || /^\d{4}$/.test(year));
  const submit = () => valid && onSave(name.trim(), `${year ? year : "-"}-${p2(month)}-${p2(day)}`);
  return (
    <form className="mb-2 grid grid-cols-[1fr_auto_auto] gap-2 rounded-lg bg-indigo-50/60 p-3 text-sm" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); submit(); }} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <input className="input col-span-3" value={name} disabled={fixedLabel} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la fecha" autoFocus={!fixedLabel} />
      <select className="input" value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="Día">
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Mes">
        {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <input className="input w-24" inputMode="numeric" maxLength={4} placeholder="Año" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} aria-label="Año (opcional)" />
      <div className="col-span-3 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn-primary" disabled={!valid || busy}>{busy ? "Guardando…" : "Guardar"}</button>
      </div>
    </form>
  );
}

function Relationships({ c, onChange }: { c: ContactDetail; onChange: () => void }) {
  const showAlert = useAlert();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ type: RelationshipType; relatedContactId: string }>({ type: "partner", relatedContactId: "" });
  // Persona relacionada: con buscador (en el móvil una lista de cientos de nombres no se puede usar)
  const [picked, setPicked] = useState<ContactSummary | null>(null);
  const [picking, setPicking] = useState(false);
  const add = useMutation({
    mutationFn: () => api.post(`/contacts/${c.id}/relationships`, draft),
    onSuccess: () => { setAdding(false); setPicked(null); setDraft({ type: "partner", relatedContactId: "" }); onChange(); },
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });
  const remove = useMutation({ mutationFn: (sub: string) => api.del(`/contacts/${c.id}/relationships/${sub}`), onSuccess: onChange });

  if (!c.canEdit && c.relationships.length === 0) return null;
  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title mb-0">👪 Relaciones</h2>
        {c.canEdit && !adding && <button className="btn-ghost" onClick={() => setAdding(true)}>+ Añadir</button>}
      </div>
      {adding && (
        <form onSubmit={(e) => { e.preventDefault(); if (draft.relatedContactId) add.mutate(); }} className="mb-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
          <select className="input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as RelationshipType })}>
            {relationshipTypes.map((t) => <option key={t} value={t}>{relationshipLabels[t]}</option>)}
          </select>
          <button type="button" className="input flex items-center gap-2 text-left" onClick={() => setPicking(true)}>
            {picked ? (
              <>
                <Avatar id={picked.id} name={picked.displayName} hasPhoto={picked.hasPhoto} size={24} version={picked.updatedAt} />
                <span className="min-w-0 flex-1 truncate">{picked.displayName}</span>
                <span className="text-xs text-indigo-700">Cambiar</span>
              </>
            ) : (
              <span className="flex-1 text-slate-500">🔎 Buscar a la persona…</span>
            )}
          </button>
          {picking && (
            <ContactPicker
              title="¿Con quién?"
              excludeId={c.id}
              onClose={() => setPicking(false)}
              onPick={(x) => { setPicked(x); setDraft({ ...draft, relatedContactId: x.id }); setPicking(false); }}
            />
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn-ghost" onClick={() => { setAdding(false); setPicked(null); }}>Cancelar</button>
            <button className="btn-primary" disabled={!draft.relatedContactId || add.isPending}>Guardar</button>
          </div>
        </form>
      )}
      {c.relationships.length === 0 && !adding && <p className="text-sm text-slate-500">Ninguna.</p>}
      <ul className="space-y-1">
        {c.relationships.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">
              {c.displayName} es <span className="lowercase">{relationshipLabels[r.type]}</span>{" "}
              <Link className="font-medium text-indigo-700" to={`/contacts/${r.relatedContactId}`}>{r.relatedName}</Link>
            </span>
            {c.canEdit && <button className="btn-danger text-xs" onClick={() => remove.mutate(r.id)}>✕</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Efemérides tuyas en las que aparece este contacto (solo si hay alguna). */
function LinkedPersonalEvents({ contactId }: { contactId: string }) {
  const { data } = usePersonalEvents();
  // De la próxima que se cumple a la más lejana
  const list = byNextAnniversary((data ?? []).filter((e) => e.contacts.some((p) => p.id === contactId)));
  if (!list.length) return null;
  return (
    <section className="card">
      <h2 className="section-title">📜 Efemérides</h2>
      <ul className="space-y-1.5">
        {list.map((e) => (
          <li key={e.id}>
            <Link to={`/upcoming?vista=efemerides&e=${e.id}`} className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-slate-50">
              <span aria-hidden="true">{e.emoji || "⭐"}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{e.title}</span>
              <span className="shrink-0 text-xs text-slate-500">{formatPartialDate(e.date)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** ☆/★ de la ficha: favorito personal (se ve en la lista y viaja a Gmail, Fastmail y el móvil). */
function FavoriteButton({ id, favorite }: { id: string; favorite: boolean }) {
  const qc = useQueryClient();
  const showAlert = useAlert();
  const [on, setOn] = useState(favorite);
  useEffect(() => setOn(favorite), [favorite]);
  const save = useMutation({
    mutationFn: (v: boolean) => api.put<{ favorite: boolean }>(`/contacts/${id}/favorite`, { favorite: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contact", id] });
    },
    onError: (e) => { setOn(favorite); showAlert("No se ha podido guardar", (e as Error).message); },
  });
  return (
    <button
      type="button"
      className={`inline-flex rounded-full p-1 transition ${on ? "text-amber-500" : "text-slate-400 hover:text-amber-500"}`}
      onClick={() => { void haptic(); setOn(!on); save.mutate(!on); }}
      aria-pressed={on}
      aria-label={on ? "Quitar de favoritos" : "Añadir a favoritos"}
      title={on ? "Favorito (toca para quitarlo)" : "Añadir a favoritos"}
    >
      <StarIcon filled={on} className="h-6 w-6" />
    </button>
  );
}
