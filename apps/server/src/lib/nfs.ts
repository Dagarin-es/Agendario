import { connect, type Socket } from "node:net";

/**
 * Cliente NFSv3 mínimo (sin montar nada y sin privilegios): lo justo para las copias de
 * seguridad — listar, subir, bajar y borrar ficheros en una carpeta exportada.
 *
 * Al no ser root, la conexión sale de un puerto alto: el servidor NFS debe permitirlo
 * (opción «insecure» en Linux; «Permitir conexiones desde puertos no privilegiados» en Synology/TrueNAS).
 */

const PROG_PORTMAP = 100000;
const PROG_MOUNT = 100005;
const PROG_NFS = 100003;

const nfsErrors: Record<number, string> = {
  1: "no tienes permiso (NFS3ERR_PERM)",
  2: "no existe (NFS3ERR_NOENT)",
  5: "error de entrada/salida en el servidor",
  13: "acceso denegado: revisa los permisos de la carpeta y el usuario/grupo (NFS3ERR_ACCES)",
  17: "ya existe",
  20: "no es una carpeta",
  28: "el servidor NFS no tiene espacio",
  30: "la carpeta exportada es de solo lectura",
  63: "nombre demasiado largo",
  66: "la carpeta no está vacía",
  69: "cuota de disco superada",
  70: "referencia caducada (NFS3ERR_STALE)",
  10008: "el servidor está ocupado, inténtalo de nuevo",
};

// ---------- XDR ----------

class W {
  private parts: Buffer[] = [];
  u32(n: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n >>> 0);
    this.parts.push(b);
    return this;
  }
  u64(n: number | bigint) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(n));
    this.parts.push(b);
    return this;
  }
  opaque(buf: Buffer) {
    this.u32(buf.length);
    this.parts.push(buf);
    const pad = (4 - (buf.length % 4)) % 4;
    if (pad) this.parts.push(Buffer.alloc(pad));
    return this;
  }
  str(s: string) {
    return this.opaque(Buffer.from(s, "utf8"));
  }
  raw(b: Buffer) {
    this.parts.push(b);
    return this;
  }
  done() {
    return Buffer.concat(this.parts);
  }
}

class R {
  constructor(
    public b: Buffer,
    public o = 0,
  ) {}
  u32() {
    const v = this.b.readUInt32BE(this.o);
    this.o += 4;
    return v;
  }
  u64() {
    const v = this.b.readBigUInt64BE(this.o);
    this.o += 8;
    return v;
  }
  bool() {
    return this.u32() !== 0;
  }
  opaque() {
    const n = this.u32();
    const v = this.b.subarray(this.o, this.o + n);
    this.o += n + ((4 - (n % 4)) % 4);
    return Buffer.from(v);
  }
  str() {
    return this.opaque().toString("utf8");
  }
  skip(n: number) {
    this.o += n;
  }
}

type Attr = { type: number; size: number; mtime: Date };
const FATTR3 = 84;
function readFattr(r: R): Attr {
  const type = r.u32();
  r.skip(16); // mode, nlink, uid, gid
  const size = Number(r.u64());
  r.skip(8 + 8 + 8 + 8 + 8); // used, rdev, fsid, fileid, atime
  const sec = r.u32();
  r.u32(); // nsec
  r.skip(8); // ctime
  return { type, size, mtime: new Date(sec * 1000) };
}
const postOpAttr = (r: R) => (r.bool() ? readFattr(r) : null);
const skipPostOpAttr = (r: R) => {
  if (r.bool()) r.skip(FATTR3);
};
const skipWcc = (r: R) => {
  if (r.bool()) r.skip(24); // pre_op_attr: size, mtime, ctime
  skipPostOpAttr(r);
};
const postOpFh = (r: R) => (r.bool() ? r.opaque() : null);

/** sattr3: solo el modo (resto sin cambiar) */
const sattrMode = (mode: number) => new W().u32(1).u32(mode).u32(0).u32(0).u32(0).u32(0).u32(0).done();

// ---------- RPC sobre TCP ----------

class Rpc {
  private sock!: Socket;
  private buf = Buffer.alloc(0);
  private frags: Buffer[] = [];
  private pending = new Map<number, { resolve: (b: Buffer) => void; reject: (e: Error) => void }>();
  private xid = Math.floor(Math.random() * 0x7fffffff);

  constructor(
    private host: string,
    private port: number,
    private cred: { uid: number; gid: number },
  ) {}

  open(timeoutMs = 8000) {
    return new Promise<void>((resolve, reject) => {
      const s = connect({ host: this.host, port: this.port });
      const t = setTimeout(() => {
        s.destroy();
        reject(new Error(`no responde ${this.host}:${this.port}`));
      }, timeoutMs);
      s.once("connect", () => {
        clearTimeout(t);
        resolve();
      });
      s.once("error", (e) => {
        clearTimeout(t);
        reject(new Error(`no se puede conectar con ${this.host}:${this.port} (${(e as NodeJS.ErrnoException).code ?? e.message})`));
      });
      s.on("data", (d) => this.onData(d));
      s.on("close", () => {
        for (const p of this.pending.values()) p.reject(new Error("el servidor NFS ha cerrado la conexión"));
        this.pending.clear();
      });
      this.sock = s;
    });
  }

  close() {
    this.sock?.destroy();
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 4) {
      const h = this.buf.readUInt32BE(0);
      const len = h & 0x7fffffff;
      if (this.buf.length < 4 + len) break;
      this.frags.push(this.buf.subarray(4, 4 + len));
      this.buf = this.buf.subarray(4 + len);
      if (h & 0x80000000) {
        const msg = Buffer.concat(this.frags);
        this.frags = [];
        this.onMessage(msg);
      }
    }
  }

  private onMessage(msg: Buffer) {
    const r = new R(msg);
    const xid = r.u32();
    const p = this.pending.get(xid);
    if (!p) return;
    this.pending.delete(xid);
    try {
      if (r.u32() !== 1) throw new Error("respuesta RPC no válida");
      if (r.u32() !== 0) throw new Error("el servidor ha rechazado la petición (autenticación)");
      r.u32(); // verf flavor
      r.opaque();
      const st = r.u32();
      if (st !== 0) throw new Error(["", "programa no disponible", "versión no soportada (¿solo NFSv4?)", "procedimiento no disponible", "argumentos no válidos", "error del sistema"][st] ?? `error RPC ${st}`);
      p.resolve(msg.subarray(r.o));
    } catch (e) {
      p.reject(e as Error);
    }
  }

  call(prog: number, vers: number, proc: number, args: Buffer, timeoutMs = 30000) {
    const xid = (this.xid = (this.xid + 1) >>> 0);
    const machine = "agendario";
    const authBody = new W().u32(Math.floor(Date.now() / 1000)).str(machine).u32(this.cred.uid).u32(this.cred.gid).u32(0).done();
    const body = new W()
      .u32(xid)
      .u32(0) // CALL
      .u32(2)
      .u32(prog)
      .u32(vers)
      .u32(proc)
      .u32(1) // AUTH_UNIX
      .opaque(authBody)
      .u32(0) // verf AUTH_NONE
      .u32(0)
      .raw(args)
      .done();
    const head = Buffer.alloc(4);
    head.writeUInt32BE((0x80000000 | body.length) >>> 0);
    return new Promise<R>((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(xid);
        reject(new Error("el servidor NFS no responde"));
      }, timeoutMs);
      this.pending.set(xid, {
        resolve: (b) => {
          clearTimeout(t);
          resolve(new R(b));
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      this.sock.write(Buffer.concat([head, body]));
    });
  }
}

async function getPort(host: string, prog: number, vers: number) {
  const pm = new Rpc(host, 111, { uid: 0, gid: 0 });
  await pm.open();
  try {
    const r = await pm.call(PROG_PORTMAP, 2, 3, new W().u32(prog).u32(vers).u32(6).u32(0).done(), 8000);
    return r.u32();
  } finally {
    pm.close();
  }
}

const check = (r: R, what: string) => {
  const st = r.u32();
  if (st !== 0) throw new Error(`${what}: ${nfsErrors[st] ?? `error NFS ${st}`}`);
};

export type NfsTarget = { host: string; exportPath: string; folder?: string; uid?: number; gid?: number };
export type NfsEntry = { name: string; size: number; mtime: Date };

/** Sesión NFS: monta la exportación (por RPC), entra en la carpeta y permite operar sobre ficheros. */
export class NfsSession {
  private nfs!: Rpc;
  private dir!: Buffer;
  private constructor(private t: NfsTarget) {}

  static async open(t: NfsTarget, create = true) {
    const s = new NfsSession(t);
    const cred = { uid: t.uid ?? 0, gid: t.gid ?? 0 };
    // 1. Puertos (portmapper). NFS suele estar en el 2049 aunque falle el portmapper
    let mountPort: number;
    let nfsPort = 2049;
    try {
      mountPort = await getPort(t.host, PROG_MOUNT, 3);
      nfsPort = (await getPort(t.host, PROG_NFS, 3)) || 2049;
    } catch (e) {
      throw new Error(`No se puede consultar el servidor NFS ${t.host} (portmapper, puerto 111): ${(e as Error).message}`);
    }
    if (!mountPort) throw new Error(`${t.host} no ofrece NFSv3 (mountd). Activa NFSv3 en el servidor.`);
    // 2. MOUNT → identificador de la carpeta exportada
    const m = new Rpc(t.host, mountPort, cred);
    await m.open();
    let root: Buffer;
    try {
      const r = await m.call(PROG_MOUNT, 3, 1, new W().str(t.exportPath).done());
      const st = r.u32();
      if (st !== 0)
        throw new Error(
          st === 13
            ? `El servidor no deja montar ${t.exportPath}: comprueba que la ruta exportada es correcta, que la IP de este servidor está autorizada y que la exportación tiene la opción «insecure» (puertos no privilegiados)`
            : st === 2
              ? `La ruta exportada ${t.exportPath} no existe en ${t.host}`
              : `No se puede montar ${t.exportPath} (error ${st})`,
        );
      root = r.opaque();
    } finally {
      m.close();
    }
    // 3. Conexión NFS y carpeta (se crea si hace falta)
    s.nfs = new Rpc(t.host, nfsPort, cred);
    await s.nfs.open();
    s.dir = root;
    for (const part of (t.folder ?? "").split("/").filter(Boolean)) {
      const fh = await s.lookup(s.dir, part);
      if (fh) s.dir = fh;
      else if (create) s.dir = await s.mkdir(s.dir, part);
      else throw new Error(`La carpeta ${t.folder} no existe en el NFS`);
    }
    return s;
  }

  close() {
    this.nfs?.close();
  }

  private async lookup(dir: Buffer, name: string): Promise<Buffer | null> {
    const r = await this.nfs.call(PROG_NFS, 3, 3, new W().opaque(dir).str(name).done());
    const st = r.u32();
    if (st === 2) return null;
    if (st !== 0) throw new Error(`Buscar «${name}»: ${nfsErrors[st] ?? `error NFS ${st}`}`);
    return r.opaque();
  }

  private async getattr(fh: Buffer): Promise<Attr> {
    const r = await this.nfs.call(PROG_NFS, 3, 1, new W().opaque(fh).done());
    check(r, "Leer atributos");
    return readFattr(r);
  }

  private async mkdir(dir: Buffer, name: string) {
    const r = await this.nfs.call(PROG_NFS, 3, 9, new W().opaque(dir).str(name).raw(sattrMode(0o775)).done());
    check(r, `Crear la carpeta «${name}»`);
    const fh = postOpFh(r);
    return fh ?? (await this.lookup(dir, name))!;
  }

  async list(): Promise<NfsEntry[]> {
    const out: NfsEntry[] = [];
    let cookie = 0n;
    let cverf = Buffer.alloc(8);
    const names: string[] = [];
    for (let guard = 0; guard < 1000; guard++) {
      const r = await this.nfs.call(PROG_NFS, 3, 16, new W().opaque(this.dir).u64(cookie).raw(cverf).u32(32768).done());
      check(r, "Listar la carpeta");
      skipPostOpAttr(r);
      cverf = Buffer.from(rawBytes(r, 8));
      while (r.bool()) {
        r.u64(); // fileid
        const name = r.str();
        cookie = r.u64();
        if (name !== "." && name !== "..") names.push(name);
      }
      if (r.bool()) break; // eof
    }
    for (const name of names) {
      const fh = await this.lookup(this.dir, name);
      if (!fh) continue;
      const a = await this.getattr(fh);
      if (a.type === 1) out.push({ name, size: a.size, mtime: a.mtime });
    }
    return out;
  }

  async write(name: string, data: Buffer) {
    // Si ya existía, se borra antes (así no quedan restos de un fichero más largo)
    if (await this.lookup(this.dir, name)) await this.remove(name);
    const r = await this.nfs.call(PROG_NFS, 3, 8, new W().opaque(this.dir).str(name).u32(0).raw(sattrMode(0o600)).done());
    check(r, `Crear «${name}»`);
    const fh = postOpFh(r) ?? (await this.lookup(this.dir, name));
    if (!fh) throw new Error(`No se ha podido crear «${name}»`);
    const CHUNK = 64 * 1024;
    for (let off = 0; off < data.length; ) {
      const part = data.subarray(off, off + CHUNK);
      const w = await this.nfs.call(PROG_NFS, 3, 7, new W().opaque(fh).u64(off).u32(part.length).u32(off + CHUNK >= data.length ? 2 : 0).opaque(part).done());
      check(w, `Escribir «${name}»`);
      skipWcc(w);
      const n = w.u32();
      if (!n) throw new Error(`El servidor no acepta datos para «${name}»`);
      off += n;
    }
  }

  async read(name: string): Promise<Buffer> {
    const fh = await this.lookup(this.dir, name);
    if (!fh) throw new Error(`«${name}» no existe en el NFS`);
    const parts: Buffer[] = [];
    let off = 0;
    for (;;) {
      const r = await this.nfs.call(PROG_NFS, 3, 6, new W().opaque(fh).u64(off).u32(64 * 1024).done());
      check(r, `Leer «${name}»`);
      skipPostOpAttr(r);
      r.u32(); // count
      const eof = r.bool();
      const data = r.opaque();
      parts.push(data);
      off += data.length;
      if (eof || !data.length) break;
    }
    return Buffer.concat(parts);
  }

  async remove(name: string) {
    const r = await this.nfs.call(PROG_NFS, 3, 12, new W().opaque(this.dir).str(name).done());
    check(r, `Borrar «${name}»`);
  }
}

/** Lee n bytes tal cual (sin longitud delante). */
function rawBytes(r: R, n: number) {
  const b = (r as unknown as { b: Buffer }).b.subarray(r.o, r.o + n);
  r.skip(n);
  return b;
}
