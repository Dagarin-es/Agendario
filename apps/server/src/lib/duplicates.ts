/**
 * Detección de posibles duplicados. Lógica pura (sin base de datos) para poder probarla.
 */
import type { DuplicateReason } from "@agendario/shared";

export interface DupInput {
  id: string;
  displayName: string;
  givenName: string;
  familyName: string;
  emails: { value: string }[];
  phones: { value: string }[];
}

export interface DupEdge {
  a: string;
  b: string;
  reasons: Set<DuplicateReason>;
}

const TITLES = new Set(["dr", "dra", "sr", "sra", "srta", "d", "dna", "don", "dona", "mr", "mrs", "ms", "prof"]);
/** Un email o teléfono compartido por más contactos que esto suele ser una centralita o info@… */
const MAX_SHARED = 4;

export function nameTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !TITLES.has(t));
}

export function normalizePhone(p: string): string | null {
  let d = p.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length < 6) return null;
  // Se comparan los 9 últimos dígitos: así +34 600 11 22 33 = 600112233
  return d.length > 9 ? d.slice(-9) : d;
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

/** Devuelve las parejas sospechosas con sus motivos. `dismissed` contiene "idA|idB" con idA < idB. */
export function findDuplicateEdges(contacts: DupInput[], dismissed: Set<string>): DupEdge[] {
  const edges = new Map<string, DupEdge>();
  const add = (x: string, y: string, reason: DuplicateReason) => {
    if (x === y) return;
    const [a, b] = x < y ? [x, y] : [y, x];
    const key = `${a}|${b}`;
    if (dismissed.has(key)) return;
    const e = edges.get(key) ?? { a, b, reasons: new Set<DuplicateReason>() };
    e.reasons.add(reason);
    edges.set(key, e);
  };
  const byKey = (map: Map<string, string[]>, reason: DuplicateReason, limit = Infinity) => {
    for (const ids of map.values()) {
      const unique = [...new Set(ids)];
      if (unique.length < 2 || unique.length > limit) continue;
      for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) add(unique[i]!, unique[j]!, reason);
    }
  };
  const push = (map: Map<string, string[]>, k: string, id: string) => {
    const l = map.get(k);
    if (l) l.push(id);
    else map.set(k, [id]);
  };

  const emails = new Map<string, string[]>();
  const phones = new Map<string, string[]>();
  const names = new Map<string, string[]>();
  const tokensOf = new Map<string, string[]>();
  const byToken = new Map<string, string[]>();

  for (const c of contacts) {
    for (const e of c.emails) if (e.value.includes("@")) push(emails, normalizeEmail(e.value), c.id);
    for (const p of c.phones) {
      const n = normalizePhone(p.value);
      if (n) push(phones, n, c.id);
    }
    const name = c.displayName || `${c.givenName} ${c.familyName}`;
    const tokens = [...new Set(nameTokens(name))];
    if (!tokens.length) continue;
    tokensOf.set(c.id, tokens);
    push(names, [...tokens].sort().join(" "), c.id);
    for (const t of tokens) push(byToken, t, c.id);
  }

  byKey(emails, "email", MAX_SHARED);
  byKey(phones, "phone", MAX_SHARED);
  byKey(names, "name");

  // Nombre contenido en otro, con al menos 2 palabras: "Pedro García" ⊂ "Pedro García López"
  for (const [id, tokens] of tokensOf) {
    if (tokens.length < 2) continue;
    const lists = tokens.map((t) => byToken.get(t) ?? []).sort((x, y) => x.length - y.length);
    for (const other of new Set(lists[0])) {
      if (other === id) continue;
      const ot = tokensOf.get(other)!;
      if (ot.length > tokens.length && tokens.every((t) => ot.includes(t))) add(id, other, "similar_name");
    }
  }
  return [...edges.values()];
}

/** Agrupa las parejas en grupos conectados (union-find). */
export function groupEdges(edges: DupEdge[]): { ids: string[]; reasons: Set<DuplicateReason>; edges: DupEdge[] }[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    if (p !== x) {
      p = find(p);
      parent.set(x, p);
    }
    return p;
  };
  for (const e of edges) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<string, { ids: Set<string>; reasons: Set<DuplicateReason>; edges: DupEdge[] }>();
  for (const e of edges) {
    const r = find(e.a);
    const g = groups.get(r) ?? { ids: new Set<string>(), reasons: new Set<DuplicateReason>(), edges: [] };
    g.ids.add(e.a);
    g.ids.add(e.b);
    g.edges.push(e);
    e.reasons.forEach((x) => g.reasons.add(x));
    groups.set(r, g);
  }
  return [...groups.values()].map((g) => ({ ids: [...g.ids], reasons: g.reasons, edges: g.edges }));
}

/**
 * Elige la pareja que se muestra de un grupo: SIEMPRE dos contactos unidos directamente por una
 * coincidencia no descartada. Preferencia: el más completo del grupo con su vecino más completo.
 * (Así, si descartas A–B en un grupo A, B, C, la siguiente pareja será A–C o B–C, nunca A–B otra vez.)
 */
export function pickPair(edges: DupEdge[], score: (id: string) => number): [string, string] {
  let best: [string, string] = [edges[0]!.a, edges[0]!.b];
  let bestVal = -Infinity;
  for (const e of edges) {
    const [hi, lo] = score(e.a) >= score(e.b) ? [e.a, e.b] : [e.b, e.a];
    const val = score(hi) * 1000 + score(lo);
    if (val > bestVal) {
      bestVal = val;
      best = [hi, lo];
    }
  }
  return best;
}

/** Puntuación de "lo completo" que está un contacto. */
export function completeness(c: {
  givenName: string; familyName: string; nickname: string; organization: string; jobTitle: string;
  birthday: string | null; notes: string; photoKey: string | null;
  emails: unknown[]; phones: unknown[]; urls: unknown[]; addresses: unknown[];
}): number {
  let s = 0;
  for (const v of [c.givenName, c.familyName, c.nickname, c.organization, c.jobTitle, c.notes]) if (v?.trim()) s += 1;
  if (c.birthday) s += 2;
  if (c.photoKey) s += 3;
  s += c.emails.length * 2 + c.phones.length * 2 + c.urls.length + c.addresses.length * 2;
  return s;
}
