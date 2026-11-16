import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Decrypter, Encrypter } from "age-encryption";
import { desc, eq, sql } from "drizzle-orm";
import * as tar from "tar";
import { APP_VERSION, backupConfigSchema, folderRequiredTypes, type BackupConfig, type BackupDest, type BackupFile } from "@agendario/shared";
import { NfsSession } from "./nfs.js";
import { OAUTH_APPS, startDeviceFlow, type OAuthType } from "./oauth.js";
import { config } from "../config.js";
import { db, schema } from "../db/index.js";
import { getSetting, setSetting } from "./settings.js";

/**
 * Copias de seguridad: volcado de todas las tablas (JSON) + fotos → .tar.gz → cifrado con age
 * (contraseña) → destino. Los destinos remotos (SMB y Google Drive) se manejan
 * con rclone; la carpeta local y NFS (montado como volumen) se escriben directamente.
 */

const CONFIG_KEY = "backup.config";
const SECRETS_KEY = "backup.secrets";
const LAST_AUTO_KEY = "backup.lastAuto";

/** Tablas en orden de dependencias (para restaurar). Las sesiones no se copian. */
const TABLES = [
  "users",
  "groups",
  "group_members",
  "contacts",
  "contact_shares",
  "important_dates",
  "relationships",
  "gift_ideas",
  "gifts_received",
  "tags",
  "contact_tags",
  "duplicate_dismissals",
  "contact_item_tags",
  "contact_history",
  "interactions",
  "user_prefs",
  "contact_prefs",
  "settings",
] as const;

export const FILE_RE = /^agendario-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})\.tar\.gz\.age$/;

type Secrets = { destPassword?: string; encryptionPassword?: string; token?: string; tokenType?: string; driveId?: string; driveType?: string; account?: string };

const dataPath = (...p: string[]) => join(config.dataDir, ...p);
const photosDir = () => dataPath("photos");

// ---------- Configuración ----------

export async function loadConfig(): Promise<BackupConfig> {
  const raw = await getSetting<unknown>(CONFIG_KEY, {});
  const parsed = backupConfigSchema.safeParse(raw);
  const cfg = parsed.success ? parsed.data : backupConfigSchema.parse({});
  const sec = await loadSecrets();
  cfg.hasEncryptionPassword = !!sec.encryptionPassword;
  cfg.dest.hasPassword = !!sec.destPassword;
  cfg.dest.connected = !!sec.token && sec.tokenType === cfg.dest.type;
  cfg.dest.account = sec.account;
  delete cfg.encryptionPassword;
  delete cfg.dest.password;
  return cfg;
}

/** Nube conectada ahora mismo (aunque el destino guardado sea otro) */
export async function connectedTo() {
  const sec = await loadSecrets();
  return sec.token && sec.tokenType === "drive" ? { type: "drive" as const, account: sec.account } : null;
}

export const loadSecrets = () => getSetting<Secrets>(SECRETS_KEY, {});
const saveSecrets = (s: Secrets) => setSetting(SECRETS_KEY, s);

/** Comprobaciones de los datos del destino antes de guardar o probar. */
export function validateDest(d: BackupDest) {
  if (folderRequiredTypes.includes(d.type) && !d.path.trim()) throw new Error("Indica la carpeta donde se guardarán las copias");
  if ((d.type === "smb" || d.type === "nfs") && !d.host.trim()) throw new Error("Indica el servidor");
  if (d.type === "smb" && !d.share.trim()) throw new Error("Indica el recurso compartido");
  if (d.type === "nfs" && !d.share.trim().startsWith("/")) throw new Error("Indica la ruta exportada (empieza por /)");
}

export async function saveConfig(input: BackupConfig) {
  validateDest(input.dest);
  const prev = await getSetting<Partial<BackupConfig>>(CONFIG_KEY, {});
  const sec = await loadSecrets();
  if (input.encryptionPassword) sec.encryptionPassword = input.encryptionPassword;
  if (input.dest.password) sec.destPassword = input.dest.password;
  // Si cambia el tipo de destino: la contraseña anterior ya no vale, y la autorización solo si es de otra nube
  if (prev.dest?.type && prev.dest.type !== input.dest.type) {
    if (sec.tokenType !== input.dest.type) {
      delete sec.token;
      delete sec.tokenType;
      delete sec.driveId;
      delete sec.driveType;
      delete sec.account;
    }
    if (!input.dest.password) delete sec.destPassword;
  }
  await saveSecrets(sec);
  const clean = backupConfigSchema.parse(input);
  delete clean.encryptionPassword;
  delete clean.dest.password;
  delete clean.hasEncryptionPassword;
  delete clean.dest.hasPassword;
  delete clean.dest.connected;
  delete clean.dest.account;
  await setSetting(CONFIG_KEY, clean);
  // La próxima copia automática se calcula a partir de ahora
  await setSetting(LAST_AUTO_KEY, new Date().toISOString());
}

// ---------- Programación ----------

/** Próxima copia automática después de `after` (hora local del servidor, TZ). */
export function nextOccurrence(cfg: BackupConfig, after: Date): Date {
  const d = new Date(after);
  d.setSeconds(0, 0);
  for (let i = 0; i < 400; i++) {
    const cand = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, cfg.hour, cfg.minute, 0, 0);
    if (cand <= after) continue;
    const wd = ((cand.getDay() + 6) % 7) + 1; // 1 = lunes
    if (cfg.frequency === "weekly" && wd !== cfg.weekday) continue;
    if (cfg.frequency === "monthly" && cand.getDate() !== cfg.monthDay) continue;
    return cand;
  }
  return new Date(after.getTime() + 86400_000);
}

export async function nextRun(cfg?: BackupConfig) {
  const c = cfg ?? (await loadConfig());
  if (!c.enabled) return null;
  const last = new Date(await getSetting<string>(LAST_AUTO_KEY, new Date().toISOString()));
  return nextOccurrence(c, last);
}

let running = false;
export const isRunning = () => running;

export function startBackupScheduler() {
  const tick = async () => {
    try {
      const cfg = await loadConfig();
      const next = await nextRun(cfg);
      if (!next || running || Date.now() < next.getTime()) return;
      await setSetting(LAST_AUTO_KEY, new Date().toISOString());
      await runBackup("auto");
    } catch (e) {
      console.warn("Programador de copias:", (e as Error).message);
    }
  };
  setInterval(tick, 60_000).unref();
}

// ---------- rclone ----------

export function hasRclone() {
  return new Promise<boolean>((res) => {
    const p = spawn("rclone", ["version"], { stdio: "ignore" });
    p.on("error", () => res(false));
    p.on("exit", (code) => res(code === 0));
  });
}

function run(cmd: string, args: string[], opts: { input?: string; timeoutMs?: number } = {}) {
  return new Promise<{ code: number; out: string; err: string }>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const t = setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs ?? 30 * 60_000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(t);
      reject(new Error((e as NodeJS.ErrnoException).code === "ENOENT" ? `No se encuentra ${cmd}` : e.message));
    });
    p.on("exit", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, out, err });
    });
    if (opts.input) p.stdin.end(opts.input);
    else p.stdin.end();
  });
}

const obscure = async (pw: string) => {
  const r = await run("rclone", ["obscure", "-"], { input: pw });
  if (r.code) throw new Error("No se ha podido preparar la contraseña para rclone");
  return r.out.trim();
};

const isDirect = (t: BackupDest["type"]) => t === "local";
export const defaultLocalPath = (_t?: BackupDest["type"]) => dataPath("backups");

/** Abre el NFS del destino, hace la operación y cierra. */
async function withNfs<T>(d: BackupDest, fn: (s: NfsSession) => Promise<T>) {
  const s = await NfsSession.open({ host: d.host.trim(), exportPath: d.share.trim(), folder: d.path, uid: d.uid, gid: d.gid });
  try {
    return await fn(s);
  } finally {
    s.close();
  }
}

/** Escribe un rclone.conf temporal con el remoto «dest» y devuelve su ruta y la carpeta remota. */
async function rcloneRemote(dest: BackupDest, sec: Secrets) {
  const lines = ["[dest]"];
  const folder = dest.path.replace(/^\/+|\/+$/g, "");
  let remotePath = folder;
  switch (dest.type) {
    case "smb":
      lines.push("type = smb", `host = ${dest.host}`, `user = ${dest.user || "guest"}`);
      if (dest.domain) lines.push(`domain = ${dest.domain}`);
      if (sec.destPassword) lines.push(`pass = ${await obscure(sec.destPassword)}`);
      remotePath = [dest.share.replace(/^\/+|\/+$/g, ""), folder].filter(Boolean).join("/");
      break;
    case "drive": {
      if (!sec.token) throw new Error("Falta conectar la cuenta (botón «Conectar»)");
      const app = OAUTH_APPS[dest.type];
      lines.push(`type = ${dest.type}`, `client_id = ${app.clientId}`, `token = ${sec.token}`);
      if (app.clientSecret) lines.push(`client_secret = ${app.clientSecret}`);
      lines.push("scope = drive.file");
      break;
    }
  }
  await mkdir(dataPath("tmp"), { recursive: true });
  const file = join(await mkdtemp(dataPath("tmp", "rc-")), "rclone.conf");
  await writeFile(file, lines.join("\n") + "\n", { mode: 0o600 });
  return { file, remote: `dest:${remotePath}` };
}

async function rclone(dest: BackupDest, sec: Secrets, args: (remote: string) => string[], timeoutMs?: number) {
  const { file, remote } = await rcloneRemote(dest, sec);
  try {
    const r = await run("rclone", ["--config", file, "--retries", "2", "--low-level-retries", "3", ...args(remote)], { timeoutMs });
    if (r.code) throw new Error(cleanErr(r.err) || "rclone ha fallado");
    return r.out;
  } finally {
    await rm(join(file, ".."), { recursive: true, force: true });
  }
}

const cleanErr = (s: string) =>
  s
    .split("\n")
    .filter((l) => /ERROR|Failed|error|denied|refused|timeout|unauthorized/i.test(l))
    .map((l) => l.replace(/^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d /, ""))
    .slice(-3)
    .join(" · ")
    .slice(0, 500);

// ---------- Operaciones sobre el destino ----------

export async function listFiles(dest: BackupDest, sec: Secrets): Promise<BackupFile[]> {
  if (isDirect(dest.type)) {
    const dir = dest.path || defaultLocalPath(dest.type);
    const names = await readdir(dir).catch(() => [] as string[]);
    const out: BackupFile[] = [];
    for (const n of names.filter((n) => FILE_RE.test(n))) {
      const st = await stat(join(dir, n));
      out.push({ name: n, size: st.size, modTime: st.mtime.toISOString() });
    }
    return out.sort((a, b) => b.name.localeCompare(a.name));
  }
  if (dest.type === "nfs")
    return (await withNfs(dest, (s) => s.list()))
      .filter((f) => FILE_RE.test(f.name))
      .map((f) => ({ name: f.name, size: f.size, modTime: f.mtime.toISOString() }))
      .sort((a, b) => b.name.localeCompare(a.name));
  const out = await rclone(dest, sec, (r) => ["lsjson", "--files-only", r], 120_000).catch((e) => {
    if (/directory not found/i.test((e as Error).message)) return "[]";
    throw e;
  });
  return (JSON.parse(out || "[]") as { Name: string; Size: number; ModTime: string }[])
    .filter((f) => FILE_RE.test(f.Name))
    .map((f) => ({ name: f.Name, size: f.Size, modTime: f.ModTime }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

async function putFile(dest: BackupDest, sec: Secrets, localFile: string, name: string) {
  if (isDirect(dest.type)) {
    const dir = dest.path || defaultLocalPath(dest.type);
    await mkdir(dir, { recursive: true });
    await copyFile(localFile, join(dir, name));
    return;
  }
  if (dest.type === "nfs") return withNfs(dest, async (s) => s.write(name, await readFile(localFile)));
  await rclone(dest, sec, (r) => ["copyto", localFile, `${r}/${name}`]);
}

export async function getFile(dest: BackupDest, sec: Secrets, name: string, localFile: string) {
  if (!FILE_RE.test(name)) throw new Error("Nombre de copia no válido");
  if (isDirect(dest.type)) return copyFile(join(dest.path || defaultLocalPath(dest.type), name), localFile);
  if (dest.type === "nfs") return withNfs(dest, async (s) => writeFile(localFile, await s.read(name)));
  await rclone(dest, sec, (r) => ["copyto", `${r}/${name}`, localFile]);
}

async function deleteFile(dest: BackupDest, sec: Secrets, name: string) {
  if (isDirect(dest.type)) return unlink(join(dest.path || defaultLocalPath(dest.type), name));
  if (dest.type === "nfs") return withNfs(dest, (s) => s.remove(name));
  await rclone(dest, sec, (r) => ["deletefile", `${r}/${name}`], 120_000);
}

/**
 * Prueba de conexión: escribe y borra un fichero pequeño. Se puede probar con los datos
 * del formulario sin guardarlos (las contraseñas vacías usan las guardadas).
 */
export async function testDestination(draft?: BackupDest) {
  const saved = await loadConfig();
  const sec = { ...(await loadSecrets()) };
  const dest = draft ?? saved.dest;
  validateDest(dest);
  if (draft?.password) sec.destPassword = draft.password;
  if (draft && draft.type !== saved.dest.type && !draft.password) delete sec.destPassword;
  await mkdir(dataPath("tmp"), { recursive: true });
  const probe = dataPath("tmp", "agendario-prueba.txt");
  await writeFile(probe, `Prueba de Agendario ${new Date().toISOString()}\n`);
  try {
    if (isDirect(dest.type)) {
      const dir = dest.path || defaultLocalPath(dest.type);
      await mkdir(dir, { recursive: true });
      await copyFile(probe, join(dir, ".agendario-prueba"));
      await unlink(join(dir, ".agendario-prueba"));
    } else if (dest.type === "nfs") {
      await withNfs(dest, async (s) => {
        await s.write(".agendario-prueba", Buffer.from("prueba"));
        await s.remove(".agendario-prueba");
      });
    } else {
      await rclone(dest, sec, (r) => ["copyto", probe, `${r}/.agendario-prueba`], 120_000);
      await rclone(dest, sec, (r) => ["deletefile", `${r}/.agendario-prueba`], 120_000);
    }
  } finally {
    await unlink(probe).catch(() => {});
  }
}

/** Qué copias se conservan: las N más recientes. */
export function retentionKeep(names: string[], cfg: Pick<BackupConfig, "keepCount">) {
  return new Set(names.filter((n) => FILE_RE.test(n)).sort().reverse().slice(0, Math.max(1, cfg.keepCount)));
}

// ---------- Crear la copia ----------

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

/** Crea el fichero cifrado de copia en una carpeta temporal y devuelve su ruta. */
export async function createArchive(password: string, name = `agendario-${stamp()}.tar.gz.age`) {
  await mkdir(dataPath("tmp"), { recursive: true });
  const work = await mkdtemp(dataPath("tmp", "bk-"));
  const dump: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const where = t === "settings" ? sql.raw(`WHERE key NOT LIKE 'backup.%'`) : sql.raw("");
    const r = await db.execute(sql`SELECT coalesce(json_agg(x), '[]'::json) AS rows FROM ${sql.identifier(t)} x ${where}`);
    dump[t] = ((r as unknown as { rows: unknown[] }[])[0]?.rows ?? []) as unknown[];
  }
  const counts = Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length]));
  await writeFile(join(work, "manifest.json"), JSON.stringify({ app: "agendario", version: APP_VERSION, createdAt: new Date().toISOString(), counts }, null, 2));
  await writeFile(join(work, "db.json"), JSON.stringify(dump));
  await mkdir(photosDir(), { recursive: true });
  await symlink(photosDir(), join(work, "photos"));
  const tgz = join(work, "backup.tar.gz");
  await tar.c({ gzip: true, file: tgz, cwd: work, follow: true, portable: true }, ["manifest.json", "db.json", "photos"]);
  const e = new Encrypter();
  e.setPassphrase(password);
  const out = join(work, name);
  await writeFile(out, await e.encrypt(await readFile(tgz)));
  await chmod(out, 0o600);
  return { file: out, name, work, counts };
}

export async function runBackup(trigger: "auto" | "manual") {
  if (running) throw new Error("Ya hay una copia en marcha");
  running = true;
  const cfg = await loadConfig();
  const sec = await loadSecrets();
  const [run_] = await db
    .insert(schema.backupRuns)
    .values({ trigger, status: "running", destination: describeDest(cfg.dest) })
    .returning();
  let work: string | undefined;
  try {
    if (!sec.encryptionPassword) throw new Error("Falta la contraseña de cifrado");
    const a = await createArchive(sec.encryptionPassword);
    work = a.work;
    const size = (await stat(a.file)).size;
    await putFile(cfg.dest, sec, a.file, a.name);
    // Retención: se borran las que sobran (solo copias automáticas o manuales de Agendario)
    let pruned = 0;
    try {
      const files = await listFiles(cfg.dest, sec);
      const keep = retentionKeep(files.map((f) => f.name), cfg);
      for (const f of files) if (!keep.has(f.name)) await deleteFile(cfg.dest, sec, f.name).then(() => pruned++);
    } catch (e) {
      console.warn("Retención de copias:", (e as Error).message);
    }
    await db
      .update(schema.backupRuns)
      .set({ status: "ok", file: a.name, sizeBytes: size, finishedAt: new Date(), error: pruned ? `${pruned} copias antiguas eliminadas` : "" })
      .where(eq(schema.backupRuns.id, run_.id));
    return { ok: true, file: a.name, size };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 1000);
    await db.update(schema.backupRuns).set({ status: "error", error: msg, finishedAt: new Date() }).where(eq(schema.backupRuns.id, run_.id));
    console.warn("Copia de seguridad fallida:", msg);
    throw e;
  } finally {
    running = false;
    if (work) await rm(work, { recursive: true, force: true });
    // El registro guarda las 200 últimas
    await db.execute(sql`DELETE FROM backup_runs WHERE id NOT IN (SELECT id FROM backup_runs ORDER BY started_at DESC LIMIT 200)`);
  }
}

export function describeDest(d: BackupDest) {
  switch (d.type) {
    case "local":
      return `Local: ${d.path || defaultLocalPath(d.type)}`;
    case "nfs":
      return `NFS: ${d.host}:${d.share}${d.path ? "/" + d.path.replace(/^\/+/, "") : ""}`;
    case "smb":
      return `SMB: //${d.host}/${[d.share, d.path].filter(Boolean).join("/")}`;
    default:
      return `Google Drive: /${d.path}`;
  }
}

export async function recentRuns() {
  const rows = await db.select().from(schema.backupRuns).orderBy(desc(schema.backupRuns.startedAt)).limit(30);
  return rows.map((r) => ({
    ...r,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    status: r.status as "running" | "ok" | "error",
  }));
}

// ---------- Restaurar ----------

/** Descifra y comprueba una copia. Devuelve la carpeta con su contenido. */
export async function openArchive(encrypted: Buffer, password: string) {
  const d = new Decrypter();
  d.addPassphrase(password);
  let plain: Uint8Array;
  try {
    plain = await d.decrypt(new Uint8Array(encrypted));
  } catch {
    throw new Error("La contraseña no es correcta o el fichero no es una copia de Agendario");
  }
  await mkdir(dataPath("tmp"), { recursive: true });
  const work = await mkdtemp(dataPath("tmp", "rs-"));
  await writeFile(join(work, "backup.tar.gz"), plain);
  await mkdir(join(work, "x"));
  await tar.x({ file: join(work, "backup.tar.gz"), cwd: join(work, "x"), strict: true });
  const manifest = JSON.parse(await readFile(join(work, "x", "manifest.json"), "utf8")) as { app: string; version: string; createdAt: string; counts: Record<string, number> };
  if (manifest.app !== "agendario") throw new Error("No es una copia de Agendario");
  return { work, manifest };
}

/**
 * Sustituye todos los datos por los de la copia. Antes se guarda una copia de seguridad
 * local del estado actual («antes de restaurar»).
 */
export async function restoreArchive(work: string) {
  const dump = JSON.parse(await readFile(join(work, "x", "db.json"), "utf8")) as Record<string, unknown[]>;
  const sec = await loadSecrets();
  if (sec.encryptionPassword) {
    const safety = await createArchive(sec.encryptionPassword, `antes-de-restaurar-${stamp()}.tar.gz.age`);
    await mkdir(dataPath("backups"), { recursive: true });
    await copyFile(safety.file, dataPath("backups", safety.name));
    await rm(safety.work, { recursive: true, force: true });
  }
  await db.transaction(async (tx) => {
    const list = TABLES.filter((t) => t !== "settings").map((t) => `"${t}"`).join(", ");
    await tx.execute(sql.raw(`TRUNCATE ${list}, "sessions" CASCADE`));
    await tx.execute(sql`DELETE FROM settings WHERE key NOT LIKE 'backup.%'`);
    for (const t of TABLES) {
      const rows = dump[t] ?? [];
      // Los contactos se enlazan entre sí (empresa): primero sin enlace y después se enlazan
      const prepared = t === "contacts" ? rows.map((r) => ({ ...(r as object), organization_contact_id: null })) : rows;
      for (let i = 0; i < prepared.length; i += 2000) {
        const chunk = JSON.stringify(prepared.slice(i, i + 2000));
        await tx.execute(
          sql`INSERT INTO ${sql.identifier(t)} SELECT * FROM json_populate_recordset(NULL::${sql.identifier(t)}, ${chunk}::json) ON CONFLICT DO NOTHING`,
        );
      }
      if (t === "contacts") {
        const links = JSON.stringify(
          (rows as { id: string; organization_contact_id: string | null }[]).filter((r) => r.organization_contact_id).map((r) => ({ id: r.id, org: r.organization_contact_id })),
        );
        await tx.execute(sql`UPDATE contacts c SET organization_contact_id = l.org::uuid
          FROM json_to_recordset(${links}::json) AS l(id text, org text) WHERE c.id = l.id::uuid`);
      }
    }
  });
  // Fotos: se sustituyen por las de la copia
  const src = join(work, "x", "photos");
  const files = await readdir(src).catch(() => [] as string[]);
  await mkdir(photosDir(), { recursive: true });
  for (const f of await readdir(photosDir())) await unlink(join(photosDir(), f)).catch(() => {});
  for (const f of files) await copyFile(join(src, f), join(photosDir(), f));
}

// ---------- Conectar Google Drive (código de dispositivo) ----------

export function startOAuth(type: OAuthType) {
  return startDeviceFlow(type, async (token) => {
    const sec = await loadSecrets();
    sec.token = JSON.stringify(token);
    sec.tokenType = type;
    sec.account = undefined;
    const me = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }).catch(() => null);
    if (me?.ok) {
      const d = (await me.json()) as { user?: { emailAddress?: string; displayName?: string } };
      sec.account = d.user?.emailAddress ?? d.user?.displayName;
    }
    await saveSecrets(sec);
  });
}

export async function disconnectOAuth() {
  const sec = await loadSecrets();
  delete sec.token;
  delete sec.tokenType;
  delete sec.driveId;
  delete sec.driveType;
  delete sec.account;
  await saveSecrets(sec);
}

