import { LabelInput, useItemLabels, type LabelKind } from "../components/LabelInput";
import { PhotoCropper } from "../components/PhotoCropper";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { Address, Contact, ContactDetail, ContactInput, LabeledValue, TagLite, Visibility } from "@agendario/shared";
import { api } from "../lib/api";
import { ContactPicker } from "../components/ContactPicker";
import { AddressSearch, MapPickerButton, useGeocoder } from "../components/AddressSearch";
import { TagEditor } from "../components/Tags";
import { Avatar } from "../components/Avatar";

const empty: ContactInput = {
  givenName: "", familyName: "", displayName: "", nickname: "", organization: "", organizationContactId: null, jobTitle: "",
  birthday: null, emails: [], phones: [], urls: [], addresses: [], notes: "", visibility: "private",
};

const monthNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function splitBirthday(b: string | null) {
  if (!b) return { day: "", month: "", year: "" };
  const noYear = b.startsWith("--");
  const [y, m, d] = noYear ? ["", b.slice(2, 4), b.slice(5, 7)] : b.split("-");
  return { day: String(Number(d)), month: String(Number(m)), year: y ?? "" };
}
function joinBirthday(day: string, month: string, year: string): string | null {
  if (!day || !month) return null;
  const p = (s: string) => s.padStart(2, "0");
  return year ? `${year.padStart(4, "0")}-${p(month)}-${p(day)}` : `--${p(month)}-${p(day)}`;
}


function ListEditor({
  title, kind, items, onChange, placeholder, type = "text",
}: {
  title: string; kind: LabelKind; items: LabeledValue[]; onChange: (v: LabeledValue[]) => void;
  placeholder: string; type?: string;
}) {
  const { labels } = useItemLabels(kind);
  const setAt = (i: number, patch: Partial<LabeledValue>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <div>
      <label className="label">{title}</label>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            {items.length > 1 && (
              <div className="flex shrink-0 flex-col justify-center">
                <button type="button" className="px-1 text-[10px] leading-tight text-slate-400 hover:text-indigo-700 disabled:opacity-20" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">▲</button>
                <button type="button" className="px-1 text-[10px] leading-tight text-slate-400 hover:text-indigo-700 disabled:opacity-20" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">▼</button>
              </div>
            )}
            <LabelInput kind={kind} className="w-32 shrink-0" value={it.label} onChange={(v) => setAt(i, { label: v })} />
            <input
              className="input"
              type={type}
              placeholder={placeholder}
              value={it.value}
              onChange={(e) => setAt(i, { value: e.target.value })}
            />
            <button type="button" className="btn-danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button type="button" className="btn-ghost" onClick={() => onChange([...items, { label: labels[0] ?? "", value: "" }])}>
          + Añadir
        </button>
      </div>
    </div>
  );
}

/** Tipos de dirección habituales (se puede escribir otro) */
const addressTypes = ["casa", "trabajo", "particular", "facturación", "envío"];

export function ContactFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  // ?back=/duplicates → al guardar o cancelar se vuelve a esa pantalla (solo rutas internas)
  const [search] = useSearchParams();
  const back = search.get("back")?.startsWith("/") ? search.get("back")! : null;
  // ?org=<id>&orgName=… → nuevo trabajador con la empresa ya enlazada
  const [form, setForm] = useState<ContactInput>(() => {
    const org = search.get("org");
    const name = search.get("orgName") ?? "";
    return org && !id ? { ...empty, organizationContactId: org, organization: name } : empty;
  });
  const [bday, setBday] = useState({ day: "", month: "", year: "" });
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const geocoder = useGeocoder();
  const [orgName, setOrgName] = useState(search.get("orgName") ?? ""); // nombre del contacto enlazado como empresa
  const [tags, setTags] = useState<TagLite[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!photo) return setPhotoUrl(null);
    const u = URL.createObjectURL(photo);
    setPhotoUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);

  const { data: existing } = useQuery({
    queryKey: ["contact", id],
    queryFn: () => api.get<ContactDetail>(`/contacts/${id}`),
    enabled: editing,
  });

  useEffect(() => {
    if (!existing) return;
    const { givenName, familyName, displayName, nickname, organization, organizationContactId, jobTitle, birthday, emails, phones, urls, addresses, notes, visibility } = existing;
    setForm({ givenName, familyName, displayName, nickname, organization, organizationContactId, jobTitle, birthday, emails, phones, urls, addresses, notes, visibility });
    setOrgName(existing.organizationContact?.displayName ?? "");
    setTags(existing.tags);
    setBday(splitBirthday(birthday));
  }, [existing]);

  const save = useMutation({
    mutationFn: async (body: ContactInput) => {
      const c = editing ? await api.patch<Contact>(`/contacts/${id}`, body) : await api.post<Contact>("/contacts", body);
      // Etiquetas (personales): solo si han cambiado o es nuevo y tiene alguna
      const before = (existing?.tags ?? []).map((t) => t.id).sort().join(",");
      const after = tags.map((t) => t.id).sort().join(",");
      if (before !== after) await api.put(`/contacts/${c.id}/tags`, { tagIds: tags.map((t) => t.id) });
      if (photo) {
        const fd = new FormData();
        fd.append("photo", photo);
        try { await api.put(`/contacts/${c.id}/photo`, fd); } catch (e) { setError(`Contacto guardado, pero la foto no: ${(e as Error).message}`); }
      }
      return c;
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contact", c.id] });
      qc.invalidateQueries({ queryKey: ["upcoming"] });
      qc.invalidateQueries({ queryKey: ["duplicates"] });
      nav(back ?? `/contacts/${c.id}`, { replace: true });
    },
    onError: (e) => setError((e as Error).message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const displayName = form.displayName.trim() || `${form.givenName} ${form.familyName}`.trim();
    if (!displayName) return setError("Pon al menos un nombre");
    const clean = (l: LabeledValue[]) => l.filter((x) => x.value.trim());
    save.mutate({
      ...form,
      displayName,
      birthday: joinBirthday(bday.day, bday.month, bday.year),
      emails: clean(form.emails),
      phones: clean(form.phones),
      urls: clean(form.urls),
      addresses: form.addresses.filter((a) => [a.street, a.city, a.region, a.postalCode, a.country].some((v) => v.trim())),
    });
  }

  const set = <K extends keyof ContactInput>(k: K, v: ContactInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: "givenName" | "familyName" | "displayName" | "nickname" | "organization" | "jobTitle" | "notes") =>
    ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value) });
  const isOwner = !editing || existing?.isMine;

  const setAddr = (i: number, patch: Partial<Address>) =>
    set("addresses", form.addresses.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-lg font-semibold">{editing ? "Editar contacto" : "Nuevo contacto"}</h1>

      <div className="card flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-1.5">
          <button type="button" className="group relative rounded-full" onClick={() => photoRef.current?.click()} title="Elegir foto">
            {photoUrl ? (
              <img src={photoUrl} alt="" className="h-24 w-24 rounded-full object-cover" />
            ) : editing && existing ? (
              <Avatar id={existing.id} name={existing.displayName} hasPhoto={existing.hasPhoto} size={96} version={existing.updatedAt} />
            ) : (
              <span className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-slate-300 bg-slate-50 text-3xl text-slate-400">📷</span>
            )}
            <span className="absolute inset-0 hidden items-center justify-center rounded-full bg-black/40 text-xs text-white group-hover:flex">Cambiar</span>
          </button>
          <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setCropFile(f); e.target.value = ""; }} />
          {cropFile && <PhotoCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={(f) => { setCropFile(null); setPhoto(f); }} />}
          {photo ? (
            <button type="button" className="text-xs text-slate-500 hover:text-red-600" onClick={() => setPhoto(null)}>Quitar foto nueva</button>
          ) : (
            <button type="button" className="text-xs text-indigo-700 hover:underline" onClick={() => photoRef.current?.click()}>{editing && existing?.hasPhoto ? "Cambiar foto" : "Añadir foto"}</button>
          )}
        </div>
        <div className="w-full flex-1">
          <label className="label">Etiquetas</label>
          <TagEditor tags={tags} onChange={setTags} align="start" />
        </div>
      </div>

      <div className="card grid gap-3 sm:grid-cols-2">
        <div><label className="label">Nombre <span className="font-normal text-slate-400">(o nombre de empresa)</span></label><input className="input" {...text("givenName")} autoFocus /></div>
        <div><label className="label">Apellidos</label><input className="input" {...text("familyName")} /></div>
        <div className="sm:col-span-2">
          <label className="label">Nombre a mostrar (si lo dejas vacío: nombre + apellidos)</label>
          <input className="input" {...text("displayName")} placeholder="p. ej. Mamá" />
        </div>
        <div><label className="label">Apodo</label><input className="input" {...text("nickname")} /></div>
        <div>
          <label className="label">Cumpleaños</label>
          <div className="flex gap-2">
            <input className="input w-16" inputMode="numeric" placeholder="Día" value={bday.day}
              onChange={(e) => setBday({ ...bday, day: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
            <select className="input" value={bday.month} onChange={(e) => setBday({ ...bday, month: e.target.value })}>
              <option value="">Mes</option>
              {monthNames.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <input className="input w-20" inputMode="numeric" placeholder="Año" value={bday.year}
              onChange={(e) => setBday({ ...bday, year: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
          </div>
        </div>
        <div>
          <label className="label">Empresa</label>
          <div className="flex gap-2">
            <input className="input" {...text("organization")} />
            <button type="button" className="btn shrink-0 rounded-lg border border-slate-300 bg-white px-3 hover:border-indigo-500" onClick={() => setPicking(true)} title="Enlazar la empresa con un contacto de la agenda (opcional)">
              🔍
            </button>
          </div>
          {form.organizationContactId && (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-indigo-800">
              🔗 Enlazada con <strong>{orgName || "un contacto"}</strong>
              <button type="button" className="rounded px-1 text-slate-500 hover:bg-slate-100" onClick={() => { set("organizationContactId", null); setOrgName(""); }} title="Quitar el enlace">
                ✕
              </button>
            </div>
          )}
        </div>
        <div><label className="label">Cargo</label><input className="input" {...text("jobTitle")} /></div>
      </div>

      <div className="card space-y-4">
        <ListEditor title="Teléfonos" kind="phones" items={form.phones} onChange={(v) => set("phones", v)} placeholder="+34 600 000 000" type="tel" />
        <ListEditor title="Emails" kind="emails" items={form.emails} onChange={(v) => set("emails", v)} placeholder="nombre@ejemplo.com" type="email" />
        <ListEditor title="Webs y redes" kind="urls" items={form.urls} onChange={(v) => set("urls", v)} placeholder="https://…" type="url" />
      </div>

      <div className="card space-y-3">
        <label className="label">Direcciones</label>
        {form.addresses.map((a, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-slate-200">
            {/* Tipo de dirección, separado y bien visible */}
            <div className="flex flex-wrap items-center gap-2 border-b border-indigo-100 bg-indigo-50/70 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-indigo-900">🏠 Tipo de dirección</span>
              <div className="flex flex-wrap gap-1">
                {addressTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${a.label.toLowerCase() === t ? "bg-indigo-700 text-white ring-indigo-700" : "bg-white text-slate-600 ring-slate-200 hover:ring-indigo-400"}`}
                    onClick={() => setAddr(i, { label: t })}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <input
                className="input ml-auto w-36 py-1 text-sm"
                placeholder="Otro tipo…"
                value={addressTypes.includes(a.label.toLowerCase()) ? "" : a.label}
                onChange={(e) => setAddr(i, { label: e.target.value })}
                aria-label="Otro tipo de dirección"
              />
            </div>
            <div className="grid gap-2 p-3 sm:grid-cols-2">
              {geocoder ? (
                <AddressSearch address={a} onChange={(patch) => setAddr(i, patch)} />
              ) : (
                <div className="flex items-center gap-2 text-xs sm:col-span-2">
                  <MapPickerButton address={a} onChange={(patch) => setAddr(i, patch)} />
                  <span className="text-slate-500">{a.lat != null ? `📍 ${a.lat.toFixed(5)}, ${a.lon!.toFixed(5)}` : "Sin geolocalizar"}</span>
                </div>
              )}
              <label className="block sm:col-span-2"><span className="label">Calle y número</span><input className="input" value={a.street} onChange={(e) => setAddr(i, { street: e.target.value })} /></label>
              <label className="block"><span className="label">Código postal</span><input className="input" value={a.postalCode} onChange={(e) => setAddr(i, { postalCode: e.target.value })} /></label>
              <label className="block"><span className="label">Ciudad</span><input className="input" value={a.city} onChange={(e) => setAddr(i, { city: e.target.value })} /></label>
              <label className="block"><span className="label">Provincia</span><input className="input" value={a.region} onChange={(e) => setAddr(i, { region: e.target.value })} /></label>
              <label className="block"><span className="label">País</span><input className="input" value={a.country} onChange={(e) => setAddr(i, { country: e.target.value })} /></label>
              <button type="button" className="btn-danger sm:col-span-2" onClick={() => set("addresses", form.addresses.filter((_, j) => j !== i))}>Quitar dirección</button>
            </div>
          </div>
        ))}
        <button type="button" className="btn-ghost"
          onClick={() => set("addresses", [...form.addresses, { label: "casa", street: "", city: "", region: "", postalCode: "", country: "España" }])}>
          + Añadir dirección
        </button>
      </div>

      <div className="card space-y-3">
        <div>
          <label className="label">Notas (las ve cualquiera que pueda ver el contacto)</label>
          <textarea className="input min-h-24" {...text("notes")} />
        </div>
        {isOwner && (
          <div>
            <label className="label">Visibilidad</label>
            <select className="input" value={form.visibility} onChange={(e) => set("visibility", e.target.value as Visibility)}>
              <option value="private">Privado: solo yo</option>
              <option value="shared">Compartido: con las personas o grupos que elija</option>
              <option value="public">Público: todos los usuarios del servidor</option>
            </select>
          </div>
        )}
      </div>

      {picking && (
        <ContactPicker
          title="Enlazar la empresa con un contacto"
          initial={form.organization}
          excludeId={id}
          onClose={() => setPicking(false)}
          onPick={(c) => {
            setForm((f) => ({ ...f, organizationContactId: c.id, organization: c.displayName }));
            setOrgName(c.displayName);
            setPicking(false);
          }}
        />
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => (back ? nav(back) : nav(-1))}>Cancelar</button>
        <button className="btn-primary" disabled={save.isPending}>Guardar</button>
      </div>
    </form>
  );
}
