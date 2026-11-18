/**
 * Generación de vCard 4.0 (RFC 6350). Base de la futura copia "formato CardDAV"
 * y del servidor CardDAV. Incluye la foto embebida.
 */

export interface VCardContact {
  id: string;
  givenName: string;
  familyName: string;
  displayName: string;
  nickname: string;
  organization: string;
  jobTitle: string;
  birthday: string | null;
  emails: { label: string; value: string }[];
  phones: { label: string; value: string }[];
  urls: { label: string; value: string }[];
  addresses: { label: string; street: string; city: string; region: string; postalCode: string; country: string }[];
  notes: string;
  updatedAt: Date;
  photoJpeg?: Buffer | null;
  /** Etiquetas → CATEGORIES */
  categories?: string[];
  /** Propiedades extra (p. ej. ideas de regalo) como X-propiedades. */
  extra?: { name: string; value: string }[];
}

const esc = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

/** Plegado de líneas a 75 octetos sin partir caracteres UTF-8. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + b > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const typeParam = (label: string) => {
  const t = label.trim().toLowerCase();
  const map: Record<string, string> = { casa: "home", trabajo: "work", móvil: "cell", movil: "cell", home: "home", work: "work", cell: "cell", mobile: "cell" };
  return map[t] ? `;TYPE=${map[t]}` : label.trim() ? `;TYPE="${label.replace(/"/g, "")}"` : "";
};

const bday = (d: string) => (d.startsWith("--") ? d.replace(/-/g, "").replace(/^/, "--") : d.replace(/-/g, ""));

export function toVCard(c: VCardContact): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:4.0",
    `UID:urn:uuid:${c.id}`,
    `FN:${esc(c.displayName)}`,
    `N:${esc(c.familyName)};${esc(c.givenName)};;;`,
  ];
  if (c.nickname) lines.push(`NICKNAME:${esc(c.nickname)}`);
  if (c.organization) lines.push(`ORG:${esc(c.organization)}`);
  if (c.jobTitle) lines.push(`TITLE:${esc(c.jobTitle)}`);
  if (c.birthday) lines.push(`BDAY:${bday(c.birthday)}`);
  for (const e of c.emails) lines.push(`EMAIL${typeParam(e.label)}:${esc(e.value)}`);
  for (const p of c.phones) lines.push(`TEL${typeParam(p.label)}:${esc(p.value)}`);
  for (const u of c.urls) lines.push(`URL${typeParam(u.label)}:${esc(u.value)}`);
  for (const a of c.addresses) {
    lines.push(
      `ADR${typeParam(a.label)}:;;${esc(a.street)};${esc(a.city)};${esc(a.region)};${esc(a.postalCode)};${esc(a.country)}`,
    );
  }
  if (c.notes) lines.push(`NOTE:${esc(c.notes)}`);
  if (c.categories?.length) lines.push(`CATEGORIES:${c.categories.map(esc).join(",")}`);
  if (c.photoJpeg) lines.push(`PHOTO:data:image/${c.photoJpeg[0] === 0x89 ? "png" : "jpeg"};base64,${c.photoJpeg.toString("base64")}`);
  for (const x of c.extra ?? []) lines.push(`${x.name}:${esc(x.value)}`);
  lines.push(`REV:${c.updatedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  lines.push("END:VCARD");
  return lines.map(fold).join("\r\n") + "\r\n";
}
