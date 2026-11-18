import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { AdminUser, RegistrationMode, User } from "@agendario/shared";
import { api } from "../lib/api";
import { Modal, useAlert, useConfirm } from "./Dialogs";
import { ContactPicker } from "./ContactPicker";
import { UserAvatar } from "./UserAvatar";
import { PhotoCropper } from "./PhotoCropper";
import { Link } from "react-router";
import { useQuery as useQ } from "@tanstack/react-query";
import type { Contact } from "@agendario/shared";

type SectionT = (p: { title: string; icon: string; desc?: string; children: ReactNode }) => ReactNode;

/** Mi cuenta: cambiar la contraseña (para todos). */
export function AccountSettings({ Section, me }: { Section: SectionT; me: User }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ current: "", password: "", repeat: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () => api.post("/auth/password", { current: f.current, password: f.password }),
    onSuccess: () => { setF({ current: "", password: "", repeat: "" }); setMsg({ ok: true, text: "Contraseña cambiada." }); qc.invalidateQueries({ queryKey: ["me"] }); },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });
  return (
    <Section icon="👤" title="Mi cuenta" desc={`${me.name} · ${me.email}`}>
      <Profile me={me} />
      {me.mustChangePassword && <p className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 ring-1 ring-amber-200">Estás usando una contraseña provisional: cámbiala ahora.</p>}
      <form className="grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); setMsg(null); if (f.password !== f.repeat) return setMsg({ ok: false, text: "Las contraseñas nuevas no coinciden" }); save.mutate(); }}>
        <input className="input" type="password" autoComplete="current-password" placeholder="Contraseña actual" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        <input className="input" type="password" autoComplete="new-password" placeholder="Nueva (mín. 10 caracteres)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <input className="input" type="password" autoComplete="new-password" placeholder="Repite la nueva" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} />
        <div className="flex items-center gap-3 sm:col-span-3">
          <button className="btn-primary" disabled={!f.current || f.password.length < 10 || save.isPending}>Cambiar contraseña</button>
          {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
        </div>
      </form>
    </Section>
  );
}

/** Foto de perfil y «mi ficha» (uno de mis contactos: si no subo foto, se usa la suya). */
function Profile({ me }: { me: User }) {
  const qc = useQueryClient();
  const showAlert = useAlert();
  const [picking, setPicking] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const done = (u: User) => qc.setQueryData(["me"], u);
  const fail = (e: unknown) => showAlert("No se ha podido guardar", (e as Error).message);
  const upload = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("photo", f); return api.put<User>("/auth/avatar", fd); },
    onSuccess: done, onError: fail,
  });
  const remove = useMutation({ mutationFn: () => api.del<User>("/auth/avatar"), onSuccess: done, onError: fail });
  const setCard = useMutation({ mutationFn: (contactId: string | null) => api.put<User>("/auth/me-contact", { contactId }), onSuccess: done, onError: fail });
  const { data: card } = useQ({ queryKey: ["contact", me.meContactId], enabled: !!me.meContactId, queryFn: () => api.get<Contact>(`/contacts/${me.meContactId}`) });
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl bg-slate-50 p-3">
      <UserAvatar me={me} size={72} />
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <div className="flex flex-wrap gap-2">
          <label className="btn-ghost cursor-pointer border border-slate-200 bg-white text-sm">
            {upload.isPending ? "Subiendo…" : me.avatarOwn ? "Cambiar foto" : "Subir foto"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setCropFile(f); e.target.value = ""; }} />
          </label>
          {me.avatarOwn && <button className="btn-ghost text-sm text-red-700" onClick={() => remove.mutate()}>Quitar foto</button>}
        </div>
        <p className="text-slate-600">
          <span className="text-slate-500">Mi ficha:</span>{" "}
          {me.meContactId ? <Link className="font-medium text-indigo-700 hover:underline" to={`/contacts/${me.meContactId}`}>{card?.displayName ?? "…"}</Link> : <span className="text-slate-400">ninguna</span>}{" "}
          <button className="ml-1 text-xs text-indigo-700 hover:underline" onClick={() => setPicking(true)}>{me.meContactId ? "Cambiar" : "Elegir contacto"}</button>
          {me.meContactId && <button className="ml-2 text-xs text-slate-500 hover:underline" onClick={() => setCard.mutate(null)}>Quitar</button>}
        </p>
        <p className="text-xs text-slate-500">Si marcas tu propia ficha y no subes foto, se usa la de esa ficha.</p>
      </div>
      {cropFile && <PhotoCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={(f) => { setCropFile(null); upload.mutate(f); }} />}
      {picking && <ContactPicker title="¿Cuál es tu ficha?" initial={me.name} onClose={() => setPicking(false)} onPick={(c) => { setPicking(false); setCard.mutate(c.id); }} />}
    </div>
  );
}

const modeLabels: Record<RegistrationMode, string> = {
  closed: "Cerrado: solo el administrador crea usuarios",
  first: "Solo el primer usuario (el resto lo crea el administrador)",
  open: "Abierto: cualquiera puede crearse una cuenta desde la web",
};

/** Usuarios (solo administradores). */
export function UsersSettings({ Section, me }: { Section: SectionT; me: User }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const { data: users } = useQuery({ queryKey: ["admin-users"], queryFn: () => api.get<AdminUser[]>("/admin/users") });
  const { data: reg } = useQuery({ queryKey: ["admin-registration"], queryFn: () => api.get<{ mode: RegistrationMode }>("/admin/registration") });
  const [creating, setCreating] = useState(false);
  const [pwFor, setPwFor] = useState<AdminUser | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-users"] });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<{ isAdmin: boolean; disabled: boolean; password: string; name: string }> }) => api.patch(`/admin/users/${id}`, body),
    onSuccess: refresh,
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });
  const setMode = useMutation({ mutationFn: (mode: RegistrationMode) => api.put("/admin/registration", { mode }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-registration"] }) });

  return (
    <Section icon="👥" title="Usuarios" desc="Quién puede entrar en este Agendario. Cada usuario tiene sus propios contactos; solo se ven entre ellos si se comparten.">
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {users?.map((u) => (
          <li key={u.id} className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${u.disabled ? "opacity-60" : ""}`}>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {u.name}
                {u.id === me.id && <span className="ml-1 text-xs text-slate-400">(tú)</span>}
                {u.isAdmin && <span className="ml-1.5 rounded-full bg-indigo-100 px-2 py-px text-[11px] font-semibold text-indigo-800">Administrador</span>}
                {u.disabled && <span className="ml-1.5 rounded-full bg-slate-200 px-2 py-px text-[11px] font-semibold text-slate-600">Desactivado</span>}
                {u.mustChangePassword && !u.disabled && <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-px text-[11px] font-semibold text-amber-800">Contraseña provisional</span>}
              </p>
              <p className="truncate text-xs text-slate-500">{u.email} · {u.contactCount} contactos · desde {new Date(u.createdAt).toLocaleDateString("es-ES")}</p>
            </div>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setPwFor(u)}>🔑 Contraseña</button>
            {u.id !== me.id && (
              <>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => patch.mutate({ id: u.id, body: { isAdmin: !u.isAdmin } })}>{u.isAdmin ? "Quitar admin" : "Hacer admin"}</button>
                <button
                  className={`btn-ghost px-2 py-1 text-xs ${u.disabled ? "text-emerald-700" : "text-red-700"}`}
                  onClick={async () =>
                    u.disabled
                      ? patch.mutate({ id: u.id, body: { disabled: false } })
                      : (await confirm({ title: `¿Desactivar a ${u.name}?`, message: "No podrá entrar. Sus contactos no se borran y lo que haya compartido sigue visible.", confirmText: "Desactivar", danger: true })) &&
                        patch.mutate({ id: u.id, body: { disabled: true } })
                  }
                >
                  {u.disabled ? "Reactivar" : "Desactivar"}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <button className="btn-ghost" onClick={() => setCreating(true)}>+ Crear usuario</button>
      <label className="block">
        <span className="label">Registro desde la web</span>
        <select className="input" value={reg?.mode ?? "first"} onChange={(e) => setMode.mutate(e.target.value as RegistrationMode)}>
          {(Object.keys(modeLabels) as RegistrationMode[]).map((m) => <option key={m} value={m}>{modeLabels[m]}</option>)}
        </select>
      </label>
      {creating && <CreateUser onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); }} />}
      {pwFor && (
        <PasswordDialog
          user={pwFor}
          self={pwFor.id === me.id}
          onClose={() => setPwFor(null)}
          onSave={(password) => { patch.mutate({ id: pwFor.id, body: { password } }); setPwFor(null); }}
        />
      )}
    </Section>
  );
}

function randomPassword() {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint32Array(14);
  crypto.getRandomValues(a);
  return [...a].map((n) => chars[n % chars.length]).join("");
}

function CreateUser({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", email: "", password: randomPassword(), isAdmin: false });
  const [error, setError] = useState("");
  const save = useMutation({ mutationFn: () => api.post("/admin/users", f), onSuccess: onDone, onError: (e) => setError((e as Error).message) });
  return (
    <Modal
      title="Crear usuario"
      onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={!f.name || !f.email || f.password.length < 10 || save.isPending} onClick={() => save.mutate()}>Crear</button></>}
    >
      <div className="space-y-3 p-4">
        <label className="block"><span className="label">Nombre</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
        <label className="block"><span className="label">Email (con él entrará)</span><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="block">
          <span className="label">Contraseña provisional (se le pedirá cambiarla)</span>
          <span className="flex gap-2">
            <input className="input font-mono" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            <button type="button" className="btn-ghost shrink-0" onClick={() => setF({ ...f, password: randomPassword() })} title="Generar otra">🎲</button>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isAdmin} onChange={(e) => setF({ ...f, isAdmin: e.target.checked })} /> Administrador (puede gestionar usuarios y copias)</label>
        <p className="text-xs text-slate-500">Apunta la contraseña y pásasela: no se vuelve a mostrar.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

function PasswordDialog({ user, self, onClose, onSave }: { user: AdminUser; self: boolean; onClose: () => void; onSave: (p: string) => void }) {
  const [p, setP] = useState(randomPassword());
  return (
    <Modal
      title={`Nueva contraseña para ${user.name}`}
      onClose={onClose}
      size="sm"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={p.length < 10} onClick={() => onSave(p)}>Guardar</button></>}
    >
      <div className="space-y-2 p-4">
        <span className="flex gap-2">
          <input className="input font-mono" value={p} onChange={(e) => setP(e.target.value)} />
          <button type="button" className="btn-ghost shrink-0" onClick={() => setP(randomPassword())}>🎲</button>
        </span>
        <p className="text-xs text-slate-500">{self ? "Es tu propia contraseña." : "Será provisional: se le pedirá cambiarla y se cerrarán sus sesiones abiertas."}</p>
      </div>
    </Modal>
  );
}
