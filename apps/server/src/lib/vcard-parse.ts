/**
 * Lector de vCard 2.1 / 3.0 / 4.0.
 * Cubre lo que exportan Google Contacts, Apple (iCloud/macOS/iOS), Android, Outlook y
 * Nextcloud: líneas plegadas, quoted-printable (2.1), charsets, fotos en base64 o data:,
 * etiquetas de Apple (itemN.X-ABLabel), CATEGORIES, aniversarios y el año "1604" de Apple.
 */

import type { Address, LabeledValue } from "@agendario/shared";

export interface ParsedGift {
  title: string;
  url: string | null;
  notes: string;
  given: boolean;
  givenAt: string | null;
  occasion: string | null;
}

export interface ParsedContact {
  uid: string | null;
  givenName: string;
  familyName: string;
  displayName: string;
  nickname: string;
  organization: string;
  jobTitle: string;
  birthday: string | null;
  anniversary: string | null;
  emails: LabeledValue[];
  phones: LabeledValue[];
  urls: LabeledValue[];
  addresses: Address[];
  notes: string;
  categories: string[];
  photo: Buffer | null;
  gifts: ParsedGift[];
}

export interface Prop {
  group: string | null;
  name: string;
  params: Record<string, string[]>;
  types: string[];
  value: string; // ya decodificado (QP/charset), sin des-escapar
  binary: Buffer | null; // ENCODING=b/BASE64
}

// ---------- Utilidades de bajo nivel ----------

/** Separa por un carácter que no esté escapado con "\". */
function splitUnescaped(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\" && i + 1 < s.length) {
      cur += ch + s[i + 1];
      i++;
    } else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function unescapeText(s: string): string {
  return s.replace(/\\([nN,;\\:])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** Separa nombre+parámetros del valor en el primer ":" que no esté entre comillas. */
function splitNameValue(line: string): [string, string] | null {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) return [line.slice(0, i), line.slice(i + 1)];
  }
  return null;
}

function splitParams(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of s) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === ";" && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function decodeQuotedPrintable(s: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      // Carácter literal (puede ser no ASCII si el fichero ya venía en UTF-8)
      for (const b of Buffer.from(ch, "utf8")) bytes.push(b);
    }
  }
  return Uint8Array.from(bytes);
}

function decodeCharset(bytes: Uint8Array, charset: string | undefined): string {
  const cs = (charset ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(cs === "utf8" ? "utf-8" : cs, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// ---------- Líneas y propiedades ----------

export function logicalLines(text: string): string[] {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    const prev = lines.length ? lines[lines.length - 1]! : null;
    if (prev !== null && (line.startsWith(" ") || line.startsWith("\t"))) {
      lines[lines.length - 1] = prev + line.slice(1);
    } else if (prev !== null && /QUOTED-PRINTABLE/i.test(prev.split(":")[0] ?? "") && prev.endsWith("=")) {
      // Salto de línea "suave" de quoted-printable
      lines[lines.length - 1] = prev.slice(0, -1) + line;
    } else if (prev !== null && line.trim() && !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)?[;:]/.test(line) && /ENCODING=(B|BASE64)|;BASE64/i.test(prev.split(":")[0] ?? "")) {
      // vCard 2.1: base64 de fotos en varias líneas sin sangría
      lines[lines.length - 1] = prev + line.trim();
    } else {
      lines.push(line);
    }
  }
  return lines.filter((l) => l.trim() !== "");
}

export function parseProp(line: string): Prop | null {
  const nv = splitNameValue(line);
  if (!nv) return null;
  const [left, rawValue] = nv;
  const parts = splitParams(left);
  let name = parts.shift()!.trim();
  let group: string | null = null;
  const dot = name.indexOf(".");
  if (dot > 0) {
    group = name.slice(0, dot).toLowerCase();
    name = name.slice(dot + 1);
  }
  name = name.toUpperCase();

  const params: Record<string, string[]> = {};
  const types: string[] = [];
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) {
      // vCard 2.1: parámetros sin nombre (TEL;CELL;PREF / PHOTO;JPEG;BASE64)
      const v = p.trim().toUpperCase();
      if (v === "QUOTED-PRINTABLE" || v === "BASE64" || v === "B") (params.ENCODING ??= []).push(v);
      else types.push(v.toLowerCase());
      continue;
    }
    const k = p.slice(0, eq).trim().toUpperCase();
    const vals = p
      .slice(eq + 1)
      .split(",")
      .map((v) => v.trim().replace(/^"|"$/g, ""));
    (params[k] ??= []).push(...vals);
    if (k === "TYPE") types.push(...vals.map((v) => v.toLowerCase()));
  }

  const enc = (params.ENCODING?.[0] ?? "").toUpperCase();
  let value = rawValue;
  let binary: Buffer | null = null;
  if (enc === "QUOTED-PRINTABLE") {
    value = decodeCharset(decodeQuotedPrintable(rawValue), params.CHARSET?.[0]);
  } else if (enc === "B" || enc === "BASE64") {
    binary = Buffer.from(rawValue.replace(/\s+/g, ""), "base64");
  } else if (params.CHARSET?.[0] && !/^utf-?8$/i.test(params.CHARSET[0])) {
    // Texto en otro charset dentro de un fichero leído como UTF-8: se deja tal cual.
    value = rawValue;
  }
  return { group, name, params, types, value, binary };
}

// ---------- Interpretación ----------

const typeLabels: Record<string, string> = {
  cell: "móvil",
  mobile: "móvil",
  iphone: "móvil",
  home: "casa",
  work: "trabajo",
  fax: "fax",
  pager: "busca",
  other: "otro",
  main: "principal",
  school: "estudios",
};
const ignoredTypes = new Set(["pref", "voice", "internet", "x400", "msg", "text", "uri", "intl", "dom", "postal", "parcel"]);

function labelFor(p: Prop, appleLabels: Map<string, string>): string {
  if (p.group && appleLabels.has(p.group)) return appleLabels.get(p.group)!;
  const t = p.types.filter((x) => !ignoredTypes.has(x));
  if (t.includes("fax")) return "fax";
  for (const x of t) if (typeLabels[x]) return typeLabels[x]!;
  const custom = t.find((x) => !x.startsWith("x-"));
  return custom ?? "";
}

function cleanAppleLabel(s: string): string {
  const m = s.match(/^_\$!<(.+)>!\$_$/);
  const v = (m ? m[1]! : s).trim();
  return typeLabels[v.toLowerCase()] ?? v.toLowerCase();
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Normaliza fechas vCard a "YYYY-MM-DD" o "--MM-DD". */
export function parseVCardDate(raw: string, omitYear = false): string | null {
  const v = raw.trim().split("T")[0]!.replace(/\s/g, "");
  let y: number | null = null;
  let m: number;
  let d: number;
  let mm: RegExpMatchArray | null;
  if ((mm = v.match(/^(\d{4})-?(\d{2})-?(\d{2})$/))) {
    y = Number(mm[1]);
    m = Number(mm[2]);
    d = Number(mm[3]);
  } else if ((mm = v.match(/^--(\d{2})-?(\d{2})$/))) {
    m = Number(mm[1]);
    d = Number(mm[2]);
  } else if ((mm = v.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/))) {
    // dd/mm/aaaa (algunas exportaciones de Outlook en español)
    d = Number(mm[1]);
    m = Number(mm[2]);
    y = Number(mm[3]);
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (omitYear || y === 1604 || y === 1900 || (y !== null && y < 1000)) y = null;
  return y ? `${y}-${pad2(m)}-${pad2(d)}` : `--${pad2(m)}-${pad2(d)}`;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

export function parseVCard(text: string): ParsedContact {
  const props = logicalLines(text)
    .map(parseProp)
    .filter((p): p is Prop => !!p && p.name !== "BEGIN" && p.name !== "END");

  const appleLabels = new Map<string, string>();
  for (const p of props) if (p.name === "X-ABLABEL" && p.group) appleLabels.set(p.group, cleanAppleLabel(unescapeText(p.value)));

  const out: ParsedContact = {
    uid: null, givenName: "", familyName: "", displayName: "", nickname: "", organization: "", jobTitle: "",
    birthday: null, anniversary: null, emails: [], phones: [], urls: [], addresses: [], notes: "",
    categories: [], photo: null, gifts: [],
  };
  let fn = "";
  const notes: string[] = [];

  for (const p of props) {
    const text = () => unescapeText(p.value).trim();
    switch (p.name) {
      case "UID":
        out.uid = clip(p.value.trim(), 300) || null;
        break;
      case "FN":
        fn = text();
        break;
      case "N": {
        const [family = "", given = "", additional = "", prefix = "", suffix = ""] = splitUnescaped(p.value, ";").map((x) => unescapeText(x).trim());
        out.familyName = family;
        out.givenName = [given, additional].filter(Boolean).join(" ");
        if (!fn) fn = [prefix, given, additional, family, suffix].filter(Boolean).join(" ");
        break;
      }
      case "NICKNAME":
        out.nickname = splitUnescaped(p.value, ",").map(unescapeText)[0]?.trim() ?? "";
        break;
      case "ORG":
        out.organization = splitUnescaped(p.value, ";").map((x) => unescapeText(x).trim()).filter(Boolean).join(" · ");
        break;
      case "TITLE":
        out.jobTitle = text();
        break;
      case "BDAY":
        out.birthday = parseVCardDate(p.value, !!p.params["X-APPLE-OMIT-YEAR"]);
        break;
      case "ANNIVERSARY":
      case "X-ANNIVERSARY":
      case "X-EVOLUTION-ANNIVERSARY":
      case "X-MS-ANNIVERSARY":
        out.anniversary ??= parseVCardDate(p.value, !!p.params["X-APPLE-OMIT-YEAR"]);
        break;
      case "X-ABDATE": {
        // Apple: fechas con etiqueta; la de aniversario lleva _$!<Anniversary>!$_
        const label = p.group ? appleLabels.get(p.group) ?? "" : "";
        if (/anniversary|aniversario/i.test(label)) out.anniversary ??= parseVCardDate(p.value, !!p.params["X-APPLE-OMIT-YEAR"]);
        break;
      }
      case "EMAIL": {
        const v = text();
        if (v) out.emails.push({ label: labelFor(p, appleLabels), value: clip(v, 300) });
        break;
      }
      case "TEL": {
        const v = text().replace(/^tel:/i, "");
        if (v) out.phones.push({ label: labelFor(p, appleLabels), value: clip(v, 300) });
        break;
      }
      case "URL": {
        const v = text();
        if (v) out.urls.push({ label: labelFor(p, appleLabels), value: clip(v, 300) });
        break;
      }
      case "ADR": {
        const [pobox = "", ext = "", street = "", city = "", region = "", postalCode = "", country = ""] = splitUnescaped(p.value, ";").map((x) => unescapeText(x).trim());
        const fullStreet = [street, ext, pobox ? `Apdo. ${pobox}` : ""].filter(Boolean).join(", ");
        if (fullStreet || city || region || postalCode || country) {
          out.addresses.push({
            label: labelFor(p, appleLabels),
            street: clip(fullStreet, 200), city: clip(city, 100), region: clip(region, 100),
            postalCode: clip(postalCode, 20), country: clip(country, 100),
          });
        }
        break;
      }
      case "NOTE": {
        const v = text();
        if (v) notes.push(v);
        break;
      }
      case "CATEGORIES":
        out.categories.push(...splitUnescaped(p.value, ",").map((x) => unescapeText(x).trim()).filter(Boolean));
        break;
      case "PHOTO": {
        if (out.photo) break;
        if (p.binary?.length) out.photo = p.binary;
        else {
          const m = p.value.trim().match(/^data:image\/[\w.+-]+;base64,(.+)$/is);
          if (m) out.photo = Buffer.from(m[1]!.replace(/\s+/g, ""), "base64");
          // Las fotos por URL (http…) no se descargan.
        }
        break;
      }
      case "X-CONTACTOS-GIFT": {
        try {
          const g = JSON.parse(unescapeText(p.value));
          if (g?.title) {
            out.gifts.push({
              title: clip(String(g.title), 200),
              url: g.url ? clip(String(g.url), 2000) : null,
              notes: clip(String(g.notes ?? ""), 2000),
              given: !!g.given,
              givenAt: typeof g.givenAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(g.givenAt) ? g.givenAt : null,
              occasion: typeof g.occasion === "string" ? g.occasion : null,
            });
          }
        } catch {
          /* ignorar */
        }
        break;
      }
    }
  }

  out.notes = clip(notes.join("\n\n"), 10000);
  out.displayName = clip(
    fn ||
      [out.givenName, out.familyName].filter(Boolean).join(" ") ||
      out.organization ||
      out.emails[0]?.value ||
      out.phones[0]?.value ||
      "Sin nombre",
    200,
  );
  out.givenName = clip(out.givenName, 100);
  out.familyName = clip(out.familyName, 100);
  out.nickname = clip(out.nickname, 100);
  out.organization = clip(out.organization, 200);
  out.jobTitle = clip(out.jobTitle, 200);
  out.emails = out.emails.slice(0, 20);
  out.phones = out.phones.slice(0, 20);
  out.urls = out.urls.slice(0, 20);
  out.addresses = out.addresses.slice(0, 10);
  out.categories = [...new Set(out.categories.filter((c) => !/^(mycontacts|starred in android|mis contactos)$/i.test(c)))];
  return out;
}

/** Divide el texto de un .vcf en vCards individuales. */
export function splitVCards(text: string): string[] {
  return text.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) ?? [];
}
