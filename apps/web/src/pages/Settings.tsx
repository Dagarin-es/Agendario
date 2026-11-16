import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import {
  APP_NAME,
  APP_VERSION,
  backupDestLabels,
  backupDestTypes,
  messagingAppLabels,
  messagingApps,
  folderRequiredTypes,
  oauthDestTypes,
  type OAuthStart,
  type OAuthStatus,
  type BackupConfig,
  type BackupFile,
  type BackupStatus,
  type MessagingApp,
  type UserPrefs,
} from "@agendario/shared";
import { useAlert, useConfirm } from "../components/Dialogs";
import { useUserPrefs } from "../components/QuickActions";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import { copyText } from "../lib/clipboard";
import { getTheme, setTheme, type ThemeMode } from "../lib/theme";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const size = (n: number | null) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const weekdays = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function Section({ title, icon, children, desc }: { title: string; icon: string; desc?: string; children: ReactNode }) {
  return (
    <section className="card space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-indigo-950"><span aria-hidden="true">{icon}</span> {title}</h2>
        {desc && <p className="mt-0.5 text-sm text-slate-500">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {children}
    </div>
  );
}

// ---------- Comunicación ----------

function Communication() {
  const qc = useQueryClient();
  const { data } = useUserPrefs();
  const [p, setP] = useState<UserPrefs | null>(null);
  useEffect(() => setP(data ?? null), [data]);
  const save = useMutation({
    mutationFn: (v: UserPrefs) => api.put("/prefs", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prefs"] }),
  });
  if (!p) return null;
  const set = (v: Partial<UserPrefs>) => {
    const n = { ...p, ...v };
    setP(n);
    save.mutate(n);
  };
  return (
    <Section icon="💬" title="Llamadas y mensajes" desc="Lo que se usa por defecto en los botones de cada contacto. En cada ficha puedes elegir otro teléfono, email o app para ese contacto (☆ en el menú ▾).">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">App de mensajería por defecto</span>
          <select className="input" value={p.messagingApp} onChange={(e) => set({ messagingApp: e.target.value as MessagingApp })}>
            {messagingApps.map((a) => <option key={a} value={a}>{messagingAppLabels[a]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Prefijo para los números sin prefijo</span>
          <div className="flex items-center gap-1">
            <span className="text-slate-500">+</span>
            <input className="input w-24" inputMode="numeric" value={p.countryCode} onChange={(e) => /^\d{0,4}$/.test(e.target.value) && setP({ ...p, countryCode: e.target.value })} onBlur={() => p.countryCode && save.mutate(p)} />
            <span className="text-xs text-slate-500">(34 = España)</span>
          </div>
        </label>
      </div>
      <p className="text-xs text-slate-500">
        Para elegir el teléfono: llamar usa el primero de la ficha y los mensajes el primer móvil, salvo que marques otro con ☆. WhatsApp Business se abre directamente en Android; en otros sistemas abre WhatsApp.
      </p>
      {save.isSuccess && <p className="text-xs text-emerald-700">Guardado.</p>}
    </Section>
  );
}

// ---------- Copias de seguridad ----------

function Help({ children }: { children: ReactNode }) {
  return <div className="space-y-1 rounded-lg bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600">{children}</div>;
}

/** NFS: al salir del campo del servidor se consultan sus carpetas exportadas para elegir de una lista. */
function NfsFields({ d, set }: { d: BackupConfig["dest"]; set: (v: Partial<BackupConfig["dest"]>) => void }) {
  const [exportsOf, setExportsOf] = useState<{ host: string; list: { path: string; clients: string[] }[] } | null>(null);
  const [err, setErr] = useState("");
  const [manual, setManual] = useState(false);
  const [adv, setAdv] = useState(d.uid !== 0 || d.gid !== 0);
  const load = useMutation({
    mutationFn: (host: string) => api.get<{ path: string; clients: string[] }[]>(`/backup/nfs/exports?host=${encodeURIComponent(host)}`),
    onSuccess: (list, host) => {
      setErr("");
      setExportsOf({ host, list });
      if (!d.share && list.length === 1) set({ share: list[0].path });
      setManual(!list.length);
    },
    onError: (e) => { setErr((e as Error).message); setExportsOf(null); },
  });
  // Al abrir la pantalla con un servidor ya guardado, se cargan sus carpetas
  useEffect(() => {
    if (d.host.trim()) load.mutate(d.host.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const list = exportsOf?.host === d.host.trim() ? exportsOf.list : null;
  const inList = !!list?.some((x) => x.path === d.share);
  const sel = list?.find((x) => x.path === d.share);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Servidor NFS (IP o nombre)</span>
          <input
            className="input"
            placeholder="192.168.1.10"
            value={d.host}
            onChange={(e) => set({ host: e.target.value })}
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== exportsOf?.host && load.mutate(e.target.value.trim())}
          />
          {load.isPending && <span className="mt-1 block text-xs text-slate-500">Buscando carpetas compartidas…</span>}
          {err && <span className="mt-1 block text-xs text-red-700">{err}</span>}
        </label>
        <label className="block">
          <span className="label">Carpeta compartida</span>
          {list && list.length > 0 && !manual ? (
            <select
              className="input"
              value={inList ? d.share : ""}
              onChange={(e) => (e.target.value === "__otra" ? setManual(true) : set({ share: e.target.value }))}
            >
              <option value="">Elige una carpeta…</option>
              {list.map((x) => (
                <option key={x.path} value={x.path}>{x.path}</option>
              ))}
              <option value="__otra">Escribir otra ruta…</option>
            </select>
          ) : (
            <input className="input" placeholder={list ? "/volume1/copias" : "Escribe el servidor y sal del campo"} value={d.share} onChange={(e) => set({ share: e.target.value })} />
          )}
          {sel && sel.clients.length > 0 && <span className="mt-1 block text-xs text-slate-500">Permitida para: {sel.clients.join(", ")}</span>}
          {list && !list.length && <span className="mt-1 block text-xs text-amber-800">El servidor no anuncia carpetas: escribe la ruta exportada.</span>}
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Carpeta dentro (opcional; se crea si no existe)</span>
          <input className="input" placeholder="agendario" value={d.path} onChange={(e) => set({ path: e.target.value })} />
        </label>
      </div>
      <button type="button" className="text-xs text-indigo-700 hover:underline" onClick={() => setAdv(!adv)}>
        {adv ? "▾" : "▸"} Usuario y grupo con los que escribir (avanzado)
      </button>
      {adv && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Usuario (UID)</span><input className="input" inputMode="numeric" value={d.uid} onChange={(e) => /^\d{0,10}$/.test(e.target.value) && set({ uid: Number(e.target.value || 0) })} /></label>
          <label className="block"><span className="label">Grupo (GID)</span><input className="input" inputMode="numeric" value={d.gid} onChange={(e) => /^\d{0,10}$/.test(e.target.value) && set({ gid: Number(e.target.value || 0) })} /></label>
          <p className="text-xs text-slate-500 sm:col-span-2">NFS no usa usuario y contraseña: el NAS decide por la IP. Por defecto se escribe como root (0); si el NAS lo «aplasta» a otro usuario sin permiso, pon aquí el UID/GID de un usuario del NAS con permiso de escritura en esa carpeta (en Synology, el primer usuario suele ser 1026 y el grupo «users» 100).</p>
        </div>
      )}
      <Help>
        <p>En el NAS, da permiso de <b>lectura/escritura</b> a la carpeta para la <b>IP local del servidor donde corre Agendario</b> (no su dirección web). No hace falta usuario ni contraseña.</p>
        <p>En Synology: Panel de control → Carpeta compartida → Editar → Permisos NFS → Crear: IP del servidor, privilegio Lectura/Escritura, «Asignar todos los usuarios a admin».</p>
      </Help>
    </>
  );
}

function DestFields({ cfg, set }: { cfg: BackupConfig; set: (d: Partial<BackupConfig["dest"]>) => void }) {
  const d = cfg.dest;
  const pw = (
    <label className="block">
      <span className="label">Contraseña {d.hasPassword && <span className="font-normal text-slate-400">(guardada; déjala vacía para no cambiarla)</span>}</span>
      <input className="input" type="password" autoComplete="new-password" value={d.password ?? ""} onChange={(e) => set({ password: e.target.value })} />
    </label>
  );
  switch (d.type) {
    case "local":
      return (
        <>
          <label className="block">
            <span className="label">Carpeta dentro del contenedor (opcional)</span>
            <input className="input" placeholder="/data/backups" value={d.path} onChange={(e) => set({ path: e.target.value })} />
          </label>
          <Help>Por defecto se guardan en <code>data/app/backups</code>, dentro de la carpeta de Agendario en el servidor. Úsalo como copia rápida, pero ten otra fuera de ese servidor (NFS, SMB o la nube).</Help>
        </>
      );
    case "nfs":
      return <NfsFields d={d} set={set} />;
    case "smb":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Servidor (IP o nombre)</span><input className="input" placeholder="192.168.1.10" value={d.host} onChange={(e) => set({ host: e.target.value })} /></label>
          <label className="block"><span className="label">Recurso compartido</span><input className="input" placeholder="copias" value={d.share} onChange={(e) => set({ share: e.target.value })} /></label>
          <label className="block"><span className="label">Carpeta (opcional)</span><input className="input" placeholder="agendario" value={d.path} onChange={(e) => set({ path: e.target.value })} /></label>
          <label className="block"><span className="label">Dominio (opcional)</span><input className="input" placeholder="WORKGROUP" value={d.domain} onChange={(e) => set({ domain: e.target.value })} /></label>
          <label className="block"><span className="label">Usuario</span><input className="input" autoComplete="off" value={d.user} onChange={(e) => set({ user: e.target.value })} /></label>
          {pw}
        </div>
      );
    default:
      return (
        <label className="block">
          <span className="label">Carpeta en {backupDestLabels[d.type]} <span className="text-red-600">*</span></span>
          <input className={`input ${!d.path.trim() ? "border-amber-400" : ""}`} placeholder="Agendario/Copias" value={d.path} onChange={(e) => set({ path: e.target.value })} required />
          {!d.path.trim() && <span className="mt-1 block text-xs text-amber-800">Obligatoria: indica la carpeta donde se guardarán las copias (se crea si no existe).</span>}
        </label>
      );
  }
}

function Connect({ type, connected, account, available, onChange }: { type: "drive"; connected?: boolean; account?: string; available: boolean; onChange: () => void }) {
  const showAlert = useAlert();
  const [code, setCode] = useState<OAuthStart | null>(null);
  const [copied, setCopied] = useState(false);
  const name = backupDestLabels[type];
  const start = useMutation({
    mutationFn: () => api.post<OAuthStart>("/backup/oauth/start", { type }),
    onSuccess: setCode,
    onError: (e) => showAlert("No se ha podido empezar", (e as Error).message),
  });
  const { data: st } = useQuery({
    queryKey: ["oauth-status"],
    queryFn: () => api.get<OAuthStatus>("/backup/oauth/status"),
    enabled: !!code,
    refetchInterval: (q) => (q.state.data?.state === "pending" || !q.state.data ? 2000 : false),
  });
  useEffect(() => {
    if (!code || !st) return;
    if (st.state === "ok") { setCode(null); onChange(); }
    if (st.state === "error") { setCode(null); showAlert("No se ha podido conectar", st.message ?? ""); }
  }, [st, code, onChange, showAlert]);
  const disconnect = useMutation({ mutationFn: () => api.del("/backup/oauth"), onSuccess: onChange });

  if (!available)
    return <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Esta instalación no tiene configurada la app de Google. Mientras tanto, usa NFS, SMB o la carpeta local.</p>;
  if (connected)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">✓ Conectado a {name}{account ? ` (${account})` : ""}</span>
        <button className="btn-ghost text-sm" onClick={() => disconnect.mutate()}>Desconectar</button>
      </div>
    );
  if (code)
    return (
      <div className="space-y-3 rounded-xl bg-indigo-50/70 p-4 text-sm">
        <p>1. Abre <a className="font-medium text-indigo-700 underline" href={code.verificationUrl} target="_blank" rel="noreferrer">{code.verificationUrl.replace(/^https?:\/\//, "")}</a> (en este equipo o en el móvil) y entra con tu cuenta.</p>
        <p>2. Escribe este código:</p>
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-white px-4 py-2 font-mono text-2xl font-semibold tracking-widest text-indigo-900 ring-2 ring-indigo-200">{code.userCode}</span>
          <button className="btn-ghost text-sm" onClick={async () => setCopied(await copyText(code.userCode))}>{copied ? "✓ Copiado" : "📋 Copiar"}</button>
        </div>
        <p className="flex items-center gap-2 text-slate-600"><span className="inline-block h-3 w-3 animate-pulse rounded-full bg-indigo-500" /> 3. Acepta el permiso. Esta pantalla lo detecta sola…</p>
        <button className="text-xs text-slate-500 hover:underline" onClick={() => setCode(null)}>Cancelar</button>
      </div>
    );
  return (
    <div className="space-y-2 rounded-lg bg-indigo-50/60 p-3 text-sm">
      <p>Pulsa <b>Conectar</b>: te daremos un código para escribir en la página de Google con tu cuenta. Agendario solo podrá ver los ficheros que cree él, no el resto de tu Drive.</p>
      <button className="btn-primary" onClick={() => start.mutate()} disabled={start.isPending}>{start.isPending ? "Pidiendo código…" : `Conectar ${name}`}</button>
    </div>
  );
}

function Restore({ status }: { status: BackupStatus }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [files, setFiles] = useState<BackupFile[] | null>(null);
  const [pick, setPick] = useState<{ name?: string; file?: File } | null>(null);
  const [password, setPassword] = useState("");
  const [preview, setPreview] = useState<{ createdAt: string; version: string; counts: Record<string, number> } | null>(null);
  const load = useMutation({ mutationFn: () => api.get<BackupFile[]>("/backup/files"), onSuccess: setFiles, onError: (e) => showAlert("No se ha podido leer el destino", (e as Error).message) });
  const send = useMutation({
    mutationFn: (confirmIt: boolean) => {
      const fd = new FormData();
      fd.append("password", password);
      if (pick?.file) fd.append("file", pick.file);
      if (pick?.name) fd.append("name", pick.name);
      fd.append("confirm", String(confirmIt));
      return api.post<{ manifest: { createdAt: string; version: string; counts: Record<string, number> }; restored: boolean }>("/backup/restore", fd);
    },
    onSuccess: (r) => {
      if (!r.restored) setPreview(r.manifest);
      else {
        qc.clear();
        showAlert("Copia restaurada", "Los datos se han sustituido por los de la copia. Vuelve a entrar con tu usuario.").then(() => (window.location.href = "/"));
      }
    },
    onError: (e) => showAlert("No se ha podido restaurar", (e as Error).message),
  });
  void status;

  return (
    <Sub title="Restaurar una copia">
      <p className="text-xs text-slate-500">Sustituye <b>todos</b> los datos (de todos los usuarios) por los de la copia. Antes se guarda automáticamente una copia del estado actual en data/app/backups.</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost border border-slate-200 text-sm" onClick={() => load.mutate()} disabled={load.isPending}>{load.isPending ? "Leyendo…" : "Ver copias del destino"}</button>
        <label className="btn-ghost cursor-pointer border border-slate-200 text-sm">
          Subir un fichero de copia…
          <input type="file" accept=".age" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setPick({ file: f }); setPreview(null); } }} />
        </label>
      </div>
      {files && (
        <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {!files.length && <li className="p-2 text-sm text-slate-500">No hay copias en el destino.</li>}
          {files.map((f) => (
            <li key={f.name} className={`flex flex-wrap items-center gap-2 p-2 text-sm ${pick?.name === f.name ? "bg-indigo-50" : ""}`}>
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.name}</span>
              <span className="text-xs text-slate-500">{size(f.size)}</span>
              <a className="text-xs text-indigo-700 hover:underline" href={`/api/backup/files/${encodeURIComponent(f.name)}`}>Descargar</a>
              <button className="text-xs font-medium text-indigo-800 hover:underline" onClick={() => { setPick({ name: f.name }); setPreview(null); }}>Elegir</button>
            </li>
          ))}
        </ul>
      )}
      {pick && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="text-sm">Copia elegida: <b className="font-mono text-xs">{pick.name ?? pick.file?.name}</b></p>
          <div className="flex gap-2">
            <input className="input" type="password" placeholder="Contraseña de cifrado de esa copia" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="btn-ghost shrink-0 border border-slate-200" disabled={!password || send.isPending} onClick={() => send.mutate(false)}>Comprobar</button>
          </div>
          {preview && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <p>Copia del <b>{fmt(preview.createdAt)}</b> (versión {preview.version}): {preview.counts.contacts ?? 0} contactos, {preview.counts.users ?? 0} usuarios, {preview.counts.contact_history ?? 0} cambios de historial.</p>
              <button
                className="btn bg-red-700 text-white hover:bg-red-800"
                disabled={send.isPending}
                onClick={async () =>
                  (await confirm({ title: "¿Restaurar esta copia?", message: "Se sustituirán todos los datos actuales por los de la copia. Tendrás que volver a entrar.", confirmText: "Restaurar", danger: true })) &&
                  send.mutate(true)
                }
              >
                {send.isPending ? "Restaurando…" : "Restaurar ahora"}
              </button>
            </div>
          )}
        </div>
      )}
    </Sub>
  );
}

function Backups() {
  const qc = useQueryClient();
  const showAlert = useAlert();
  const { data: status } = useQuery({
    queryKey: ["backup"],
    queryFn: () => api.get<BackupStatus & { running: boolean }>("/backup"),
    refetchInterval: (q) => (q.state.data?.running ? 2000 : false),
  });
  const [cfg, setCfg] = useState<BackupConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (status && !dirty) setCfg(status.config);
  }, [status, dirty]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["backup"] });
  const save = useMutation({
    mutationFn: () => api.put("/backup/config", cfg),
    onSuccess: () => { setDirty(false); setCfg((c) => (c ? { ...c, encryptionPassword: undefined, dest: { ...c.dest, password: undefined } } : c)); refresh(); },
    onError: (e) => showAlert("No se ha podido guardar", (e as Error).message),
  });
  const test = useMutation({
    mutationFn: () => api.post("/backup/test", { dest: cfg?.dest }),
    onSuccess: () => showAlert("Conexión correcta", "Se ha podido escribir en el destino."),
    onError: (e) => showAlert("No se puede escribir en el destino", (e as Error).message),
  });
  const run = useMutation({
    mutationFn: () => api.post<{ file: string; size: number }>("/backup/run"),
    onSuccess: refresh,
    onError: (e) => { refresh(); showAlert("La copia ha fallado", (e as Error).message); },
  });
  if (!status || !cfg) return <Section icon="🛟" title="Copias de seguridad"><p className="text-sm text-slate-500">Cargando…</p></Section>;

  const set = (v: Partial<BackupConfig>) => { setCfg({ ...cfg, ...v }); setDirty(true); };
  const setDest = (v: Partial<BackupConfig["dest"]>) => set({ dest: { ...cfg.dest, ...v } });
  const isOauth = oauthDestTypes.includes(cfg.dest.type);
  const last = status.runs[0];

  return (
    <Section icon="🛟" title="Copias de seguridad" desc="Copia cifrada de toda la base de datos (todos los usuarios) y de las fotos. Solo la ve el administrador.">
      {/* Estado */}
      <div className="grid gap-2 rounded-xl bg-indigo-50/60 p-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="space-y-0.5">
          <p>
            Última copia:{" "}
            {last ? (
              <b className={last.status === "ok" ? "text-emerald-800" : last.status === "error" ? "text-red-700" : "text-indigo-800"}>
                {last.status === "ok" ? "✓" : last.status === "error" ? "✗" : "…"} {fmt(last.startedAt)}
              </b>
            ) : (
              "ninguna todavía"
            )}
          </p>
          <p>Próxima automática: <b>{cfg.enabled && status.nextRun ? fmt(status.nextRun) : "desactivadas"}</b></p>
        </div>
        <button className="btn-primary" disabled={run.isPending || status.running || dirty || !cfg.hasEncryptionPassword} onClick={() => run.mutate()} title={dirty ? "Guarda primero los cambios" : undefined}>
          {run.isPending || status.running ? "Haciendo copia…" : "Hacer copia ahora"}
        </button>
      </div>
      {!status.rclone && (cfg.dest.type === "smb" || isOauth) && (
        <p className="rounded-lg bg-red-50 p-2 text-sm text-red-800">Este servidor no tiene rclone: actualiza a la imagen nueva con el script de actualizar.</p>
      )}

      <Sub title="Dónde se guardan">
        <select className="input" value={cfg.dest.type} onChange={(e) => setDest({ type: e.target.value as BackupConfig["dest"]["type"], path: "" })}>
          {backupDestTypes.map((t) => <option key={t} value={t}>{backupDestLabels[t]}</option>)}
        </select>
        <DestFields cfg={cfg} set={setDest} />
        {isOauth && (
          <Connect
            type={cfg.dest.type as "drive"}
            connected={status.connected?.type === cfg.dest.type}
            account={status.connected?.account}
            available={status.oauth[cfg.dest.type as "drive"]}
            onChange={refresh}
          />
        )}
        <button className="btn-ghost border border-slate-200 text-sm" disabled={test.isPending || (isOauth && status.connected?.type !== cfg.dest.type) || (folderRequiredTypes.includes(cfg.dest.type) && !cfg.dest.path.trim())} onClick={() => test.mutate()}>
          {test.isPending ? "Probando…" : "Probar conexión"}
        </button>
      </Sub>

      <Sub title="Cuándo">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-indigo-700" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Hacer copias automáticas
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label">Frecuencia</span>
            <select className="input" value={cfg.frequency} onChange={(e) => set({ frequency: e.target.value as BackupConfig["frequency"] })}>
              <option value="daily">Cada día</option>
              <option value="weekly">Cada semana</option>
              <option value="monthly">Cada mes</option>
            </select>
          </label>
          {cfg.frequency === "weekly" && (
            <label className="block">
              <span className="label">Día</span>
              <select className="input" value={cfg.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                {weekdays.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}
              </select>
            </label>
          )}
          {cfg.frequency === "monthly" && (
            <label className="block">
              <span className="label">Día del mes</span>
              <select className="input" value={cfg.monthDay} onChange={(e) => set({ monthDay: Number(e.target.value) })}>
                {Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
            </label>
          )}
          <label className="block">
            <span className="label">Hora</span>
            <input
              className="input"
              type="time"
              value={`${String(cfg.hour).padStart(2, "0")}:${String(cfg.minute).padStart(2, "0")}`}
              onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); if (!Number.isNaN(h)) set({ hour: h, minute: m || 0 }); }}
            />
          </label>
        </div>
      </Sub>

      <Sub title="Cuántas se guardan">
        <label className="block max-w-xs">
          <span className="label">Copias a guardar</span>
          <input className="input" type="number" min={1} max={1000} value={cfg.keepCount} onChange={(e) => set({ keepCount: Math.max(1, Number(e.target.value) || 1) })} />
        </label>
        <p className="text-xs text-slate-500">Se conservan las {cfg.keepCount} más recientes; al hacer una nueva, se borra la más antigua. Con copias diarias, {cfg.keepCount} = los últimos {cfg.keepCount} días.</p>
      </Sub>

      <Sub title="Cifrado">
        <label className="block">
          <span className="label">Contraseña de cifrado {cfg.hasEncryptionPassword && <span className="font-normal text-slate-400">(guardada; escribe otra solo para cambiarla)</span>}</span>
          <input className="input" type="password" autoComplete="new-password" minLength={8} placeholder="Mínimo 8 caracteres" value={cfg.encryptionPassword ?? ""} onChange={(e) => set({ encryptionPassword: e.target.value || undefined })} />
        </label>
        <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">⚠️ Apúntala en un sitio seguro (por ejemplo, en Vaultwarden). <b>Sin ella no se puede abrir ninguna copia.</b> Si la cambias, las copias anteriores siguen necesitando la antigua. Las copias se pueden abrir también fuera de la app con <code>age -d</code>.</p>
      </Sub>

      <div className="flex justify-end gap-2">
        {dirty && <button className="btn-ghost" onClick={() => { setDirty(false); setCfg(status.config); }}>Descartar</button>}
        <button className="btn-primary" disabled={!dirty || save.isPending || (folderRequiredTypes.includes(cfg.dest.type) && !cfg.dest.path.trim())} onClick={() => save.mutate()}>{save.isPending ? "Guardando…" : "Guardar ajustes de copias"}</button>
      </div>

      <Sub title="Registro">
        {!status.runs.length && <p className="text-sm text-slate-500">Todavía no se ha hecho ninguna copia.</p>}
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto text-sm">
          {status.runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
              <span className={r.status === "ok" ? "text-emerald-700" : r.status === "error" ? "text-red-700" : "text-indigo-700"}>{r.status === "ok" ? "✓" : r.status === "error" ? "✗" : "…"}</span>
              <span className="text-slate-700">{fmt(r.startedAt)}</span>
              <span className="text-xs text-slate-500">{r.trigger === "auto" ? "automática" : "manual"} · {r.destination}</span>
              {r.sizeBytes != null && <span className="text-xs text-slate-500">· {size(r.sizeBytes)}</span>}
              {r.error && <span className={`w-full text-xs ${r.status === "error" ? "text-red-700" : "text-slate-500"}`}>{r.error}</span>}
            </li>
          ))}
        </ul>
      </Sub>

      <Restore status={status} />
    </Section>
  );
}

function Appearance() {
  const [mode, setMode] = useState<ThemeMode>(getTheme());
  const opts: { v: ThemeMode; label: string; icon: string }[] = [
    { v: "auto", label: "Automático", icon: "🌗" },
    { v: "light", label: "Claro", icon: "☀️" },
    { v: "dark", label: "Oscuro", icon: "🌙" },
  ];
  return (
    <Section icon="🎨" title="Apariencia" desc="Automático sigue el modo del sistema. Se guarda en este dispositivo.">
      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1" role="radiogroup" aria-label="Modo de color">
        {opts.map((o) => (
          <button
            key={o.v}
            role="radio"
            aria-checked={mode === o.v}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium ${mode === o.v ? "bg-indigo-700 text-white shadow" : "text-slate-600 hover:bg-white"}`}
            onClick={() => { setMode(o.v); setTheme(o.v); }}
          >
            <span aria-hidden="true">{o.icon}</span> {o.label}
          </button>
        ))}
      </div>
    </Section>
  );
}

export function SettingsPage() {
  const { data: me } = useMe();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">⚙️ Ajustes</h1>
      <Appearance />
      <Communication />
      {me?.isAdmin && <Backups />}
      <Section icon="📒" title={`Acerca de ${APP_NAME}`}>
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-12 w-12" />
          <div className="text-sm">
            <p className="font-semibold">{APP_NAME} <span className="font-normal text-slate-500">v{APP_VERSION}</span></p>
            <p className="text-slate-500">Agenda de contactos vitaminada, sincronizada, con recordatorios de regalos, copias automáticas, búsqueda de duplicados… Todo lo que siempre has echado de menos en tu gestor de contactos y más aún.</p>
          </div>
        </div>
      </Section>
    </div>
  );
}
