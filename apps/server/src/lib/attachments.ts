/**
 * Adjuntos de las llamadas y apuntes: fotos, PDF, documentos de Office/LibreOffice, texto y audios.
 * Se guardan en DATA_DIR/attachments con un nombre aleatorio; las fotos llevan además una miniatura.
 * Son privados de cada usuario, igual que la llamada a la que pertenecen.
 */
import { ATTACHMENT_MAX_BYTES, type InteractionAttachment } from "@agendario/shared";
import { eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import sharp from "sharp";
import { config } from "../config.js";
import { db, schema } from "../db/index.js";

const a = schema.interactionAttachments;
export const attachmentsDir = () => join(config.dataDir, "attachments");
export const attachmentFile = (key: string) => join(attachmentsDir(), key);
export const thumbFile = (key: string) => join(attachmentsDir(), `${key}_thumb.jpg`);

type Family = "jpeg" | "png" | "webp" | "heic" | "pdf" | "zip" | "ole" | "mp3" | "mp4audio" | "ogg" | "text";

/** Tipo permitido por extensión, con la «familia» de bytes que debe tener el fichero de verdad. */
const TYPES: Record<string, { mime: string; family: Family }> = {
  ".jpg": { mime: "image/jpeg", family: "jpeg" },
  ".jpeg": { mime: "image/jpeg", family: "jpeg" },
  ".png": { mime: "image/png", family: "png" },
  ".webp": { mime: "image/webp", family: "webp" },
  ".heic": { mime: "image/heic", family: "heic" },
  ".heif": { mime: "image/heif", family: "heic" },
  ".pdf": { mime: "application/pdf", family: "pdf" },
  ".docx": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", family: "zip" },
  ".xlsx": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", family: "zip" },
  ".pptx": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", family: "zip" },
  ".odt": { mime: "application/vnd.oasis.opendocument.text", family: "zip" },
  ".ods": { mime: "application/vnd.oasis.opendocument.spreadsheet", family: "zip" },
  ".odp": { mime: "application/vnd.oasis.opendocument.presentation", family: "zip" },
  ".doc": { mime: "application/msword", family: "ole" },
  ".xls": { mime: "application/vnd.ms-excel", family: "ole" },
  ".ppt": { mime: "application/vnd.ms-powerpoint", family: "ole" },
  ".txt": { mime: "text/plain; charset=utf-8", family: "text" },
  ".csv": { mime: "text/csv; charset=utf-8", family: "text" },
  ".mp3": { mime: "audio/mpeg", family: "mp3" },
  ".m4a": { mime: "audio/mp4", family: "mp4audio" },
  ".ogg": { mime: "audio/ogg", family: "ogg" },
  ".oga": { mime: "audio/ogg", family: "ogg" },
  ".opus": { mime: "audio/ogg", family: "ogg" },
};

/** Extensión por tipo MIME, para ficheros que llegan sin extensión (p. ej. la cámara del móvil). */
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heif",
  "application/pdf": ".pdf", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/ogg": ".ogg", "text/plain": ".txt", "text/csv": ".csv",
};

const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString("latin1");

/** Familia según los primeros bytes (no nos fiamos solo de la extensión). */
function sniff(b: Buffer): Family | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (b.length >= 5 && ascii(b, 0, 5) === "%PDF-") return "pdf";
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "zip";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "ole";
  if (b.length >= 4 && ascii(b, 0, 4) === "OggS") return "ogg";
  if (b.length >= 3 && ascii(b, 0, 3) === "ID3") return "mp3";
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return "mp3";
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12);
    if (["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "heic";
    if (["M4A ", "M4B ", "mp42", "isom", "mp41", "dash"].includes(brand)) return "mp4audio";
  }
  // Texto: sin bytes nulos y UTF-8 válido en el primer trozo
  const head = b.subarray(0, 64 * 1024);
  if (!head.includes(0)) {
    try {
      // stream: un carácter cortado al final del trozo no cuenta como error
      new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: head.length < b.length });
      return "text";
    } catch {
      // Latin-1 (CSV exportados de Excel): también vale si no hay caracteres de control raros
      if (!/[\x00-\x08\x0e-\x1f]/.test(head.toString("latin1"))) return "text";
    }
  }
  return null;
}

/** Nombre limpio para guardar y mostrar (sin rutas ni caracteres de control). */
function cleanName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 200) || "archivo";
}

/** Comprueba el fichero subido y devuelve su nombre final y tipo, o lanza un error comprensible. */
export function checkAttachment(name: string, declaredMime: string, data: Buffer) {
  let clean = cleanName(name);
  let ext = extname(clean).toLowerCase();
  if (!TYPES[ext]) {
    const byMime = EXT_BY_MIME[declaredMime.split(";")[0]!.trim().toLowerCase()];
    if (byMime) { ext = byMime; clean = `${clean}${byMime}`; }
  }
  const type = TYPES[ext];
  if (!type) throw new HTTPException(415, { message: "Tipo de archivo no admitido. Se admiten fotos, PDF, Word, Excel, PowerPoint, LibreOffice, TXT/CSV y audios." });
  const family = sniff(data);
  // Un .docx «de mentira» (otro ZIP) se tolera: no se ejecuta nada en el servidor, solo se guarda y se descarga
  if (family !== type.family) throw new HTTPException(415, { message: "El contenido del archivo no coincide con su tipo." });
  return { name: clean, mime: type.mime };
}

export function toAttachment(x: typeof a.$inferSelect): InteractionAttachment {
  return { id: x.id, name: x.name, mime: x.mime, size: x.size, hasThumb: x.hasThumb, createdAt: x.createdAt.toISOString() };
}

/** Guarda el adjunto subido en el campo «file» (multipart) para una llamada o una llamada desconocida. */
export async function storeAttachment(ctx: Context, owner: { userId: string; interactionId?: string; unknownCallId?: string }) {
  const body = await ctx.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) throw new HTTPException(400, { message: "Falta el archivo" });
  if (file.size > ATTACHMENT_MAX_BYTES) throw new HTTPException(413, { message: "El archivo pasa de 25 MB" });
  if (file.size === 0) throw new HTTPException(400, { message: "El archivo está vacío" });
  const data = Buffer.from(await file.arrayBuffer());
  const { name, mime } = checkAttachment(typeof body["name"] === "string" && body["name"] ? body["name"] : file.name, file.type, data);
  await mkdir(attachmentsDir(), { recursive: true });
  const key = randomBytes(16).toString("hex");
  await writeFile(attachmentFile(key), data);
  // Miniatura de las fotos (las HEIC no: sharp no las abre sin libheif con HEVC)
  let hasThumb = false;
  if (/^image\/(jpeg|png|webp)$/.test(mime)) {
    try {
      const t = await sharp(data, { failOn: "error" }).rotate().resize(320, 320, { fit: "cover" }).flatten({ background: "#ffffff" }).jpeg({ quality: 75 }).toBuffer();
      await writeFile(thumbFile(key), t);
      hasThumb = true;
    } catch {
      /* foto dañada: se guarda igual, sin miniatura */
    }
  }
  const [row] = await db.insert(a).values({
    userId: owner.userId, interactionId: owner.interactionId ?? null, unknownCallId: owner.unknownCallId ?? null,
    name, mime, size: data.length, fileKey: key, hasThumb,
  }).returning();
  return toAttachment(row!);
}

/** Adjuntos de varias llamadas, agrupados por llamada. */
export async function attachmentsFor(interactionIds: string[]) {
  const map = new Map<string, InteractionAttachment[]>();
  if (!interactionIds.length) return map;
  const rows = await db.select().from(a).where(inArray(a.interactionId, interactionIds)).orderBy(a.createdAt);
  for (const r of rows) map.set(r.interactionId!, [...(map.get(r.interactionId!) ?? []), toAttachment(r)]);
  return map;
}

export async function attachmentsForUnknown(ids: string[]) {
  const map = new Map<string, InteractionAttachment[]>();
  if (!ids.length) return map;
  const rows = await db.select().from(a).where(inArray(a.unknownCallId, ids)).orderBy(a.createdAt);
  for (const r of rows) map.set(r.unknownCallId!, [...(map.get(r.unknownCallId!) ?? []), toAttachment(r)]);
  return map;
}

export async function deleteAttachmentFiles(key: string) {
  await Promise.all([rm(attachmentFile(key), { force: true }), rm(thumbFile(key), { force: true })]);
}

export async function deleteAttachmentRow(id: string) {
  const [row] = await db.delete(a).where(eq(a.id, id)).returning();
  if (row) await deleteAttachmentFiles(row.fileKey);
}

/**
 * Borra del disco los ficheros que ya no tienen fila (llamada borrada, contacto purgado de la papelera…).
 * Las filas se borran solas en cascada; los ficheros, aquí.
 */
export async function sweepOrphanAttachments() {
  const names = await readdir(attachmentsDir()).catch(() => [] as string[]);
  if (!names.length) return 0;
  const keys = new Set((await db.select({ k: a.fileKey }).from(a)).map((r) => r.k));
  let n = 0;
  for (const f of names) {
    const key = f.replace(/_thumb\.jpg$/, "");
    if (!/^[0-9a-f]{32}$/.test(key) || keys.has(key)) continue;
    await rm(join(attachmentsDir(), f), { force: true });
    n++;
  }
  return n;
}

export function startAttachmentSweep() {
  const run = () => sweepOrphanAttachments().catch((e) => console.error("Limpieza de adjuntos:", e));
  setTimeout(run, 60_000).unref();
  setInterval(run, 6 * 3_600_000).unref();
}
