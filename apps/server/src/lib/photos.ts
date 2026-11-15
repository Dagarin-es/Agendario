import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { config } from "../config.js";

const dir = () => join(config.dataDir, "photos");
const file = (key: string, size: PhotoSize) => join(dir(), size === "thumb" ? `${key}_thumb.jpg` : `${key}.jpg`);

export type PhotoSize = "full" | "thumb";
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Guarda la foto normalizada (JPEG, orientación corregida, sin metadatos):
 * - full:  hasta 1024 px, la que se usará en vCard/sincronización y copias.
 * - thumb: 256 px cuadrada, para listas.
 */
export async function savePhoto(input: Buffer): Promise<string> {
  await mkdir(dir(), { recursive: true });
  const key = randomBytes(12).toString("hex");
  const base = sharp(input, { failOn: "error" }).rotate();
  const full = await base.clone().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const thumb = await base.clone().resize(256, 256, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();
  await writeFile(file(key, "full"), full);
  await writeFile(file(key, "thumb"), thumb);
  return key;
}

export function readPhoto(key: string, size: PhotoSize) {
  return readFile(file(key, size));
}

export async function deletePhoto(key: string) {
  await Promise.all([rm(file(key, "full"), { force: true }), rm(file(key, "thumb"), { force: true })]);
}
