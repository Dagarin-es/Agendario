import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { config } from "../config.js";

const dir = () => join(config.dataDir, "photos");
/** Las imágenes con transparencia se guardan en PNG; su clave termina en «-png». */
const isPng = (key: string) => key.endsWith("-png");
const ext = (key: string) => (isPng(key) ? "png" : "jpg");
const file = (key: string, size: PhotoSize) => join(dir(), size === "thumb" ? `${key}_thumb.${ext(key)}` : `${key}.${ext(key)}`);
export const photoType = (key: string) => (isPng(key) ? "image/png" : "image/jpeg");
/** Tipo para el vCard (PHOTO;TYPE=…) a partir de los primeros bytes. */
export const vcardPhotoType = (data: Uint8Array) => (data[0] === 0x89 && data[1] === 0x50 ? "PNG" : "JPEG");

export type PhotoSize = "full" | "thumb";
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Guarda la foto normalizada (JPEG, o PNG si tiene transparencia; orientación corregida, sin metadatos):
 * - full:  hasta 1024 px, la que se usará en vCard/sincronización y copias.
 * - thumb: 256 px cuadrada, para listas.
 */
export async function savePhoto(input: Buffer): Promise<string> {
  await mkdir(dir(), { recursive: true });
  // Logotipos con transparencia: PNG (Fastmail y las agendas CardDAV lo aceptan). El resto, JPEG (ocupa menos).
  const meta = await sharp(input, { failOn: "error" }).metadata();
  const transparent = !!meta.hasAlpha && !(await sharp(input).stats()).isOpaque;
  const key = randomBytes(12).toString("hex") + (transparent ? "-png" : "");
  const base = sharp(input, { failOn: "error" }).rotate();
  const out = (s: sharp.Sharp, q: number) => (transparent ? s.png({ compressionLevel: 9, palette: false }) : s.flatten({ background: "#ffffff" }).jpeg({ quality: q }));
  // Los logotipos se centran en un cuadrado con margen, para que el círculo no les corte las esquinas
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  const logo = (side: number) => {
    const inner = Math.round(side * 0.8);
    const pad = Math.round((side - inner) / 2);
    return base.clone().resize(inner, inner, { fit: "contain", background: clear }).extend({ top: pad, bottom: side - inner - pad, left: pad, right: side - inner - pad, background: clear });
  };
  const full = await (transparent ? out(logo(512), 85) : out(base.clone().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }), 85)).toBuffer();
  const thumb = await (transparent ? out(logo(256), 80) : out(base.clone().resize(256, 256, { fit: "cover" }), 80)).toBuffer();
  await writeFile(file(key, "full"), full);
  await writeFile(file(key, "thumb"), thumb);
  return key;
}

/**
 * Portada (imagen apaisada, ya recortada en el navegador): JPEG de hasta 1600 px de ancho
 * y una versión de 800 px para pantallas pequeñas. Se lee con readPhoto como cualquier foto.
 */
export async function saveCover(input: Buffer): Promise<string> {
  await mkdir(dir(), { recursive: true });
  const key = "cv" + randomBytes(12).toString("hex");
  const base = sharp(input, { failOn: "error" }).rotate().flatten({ background: "#ffffff" });
  await writeFile(file(key, "full"), await base.clone().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer());
  await writeFile(file(key, "thumb"), await base.clone().resize(800, 800, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer());
  return key;
}

/**
 * Lee la imagen subida en el campo «photo» (multipart), comprueba su tamaño y la guarda con `save`
 * (foto normal por defecto, o portada). Devuelve la clave del fichero.
 */
export async function storeUpload(ctx: Context, save: (b: Buffer) => Promise<string> = savePhoto): Promise<string> {
  const file = (await ctx.req.parseBody())["photo"];
  if (!(file instanceof File)) throw new HTTPException(400, { message: "Falta el campo 'photo'" });
  if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "La imagen es demasiado grande" });
  try {
    return await save(Buffer.from(await file.arrayBuffer()));
  } catch {
    throw new HTTPException(400, { message: "No es una imagen válida" });
  }
}

export function readPhoto(key: string, size: PhotoSize) {
  return readFile(file(key, size));
}

export async function deletePhoto(key: string) {
  await Promise.all([rm(file(key, "full"), { force: true }), rm(file(key, "thumb"), { force: true })]);
}
