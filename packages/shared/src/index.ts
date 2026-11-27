import { z } from "zod";
export { saintDateFor } from "./santoral";

// ---------- Versión ----------
// IS_BETA = true muestra la etiqueta «Beta» (desde la 1.0, false).
export * from "./themes";

export const APP_VERSION = "1.5.1";
export const IS_BETA = false;

// ---------- Enumeraciones ----------

export const visibilities = ["private", "shared", "public"] as const;
export type Visibility = (typeof visibilities)[number];

export const permissions = ["read", "write"] as const;
export type Permission = (typeof permissions)[number];

/** Motivos de un regalo (hecho o recibido). */
export const occasions = [
  "birthday",
  "christmas",
  "reyes",
  "saint_day",
  "anniversary",
  "wedding",
  "thank_you",
  "other",
] as const;
export type Occasion = (typeof occasions)[number];

export const occasionLabels: Record<Occasion, string> = {
  birthday: "Cumpleaños",
  christmas: "Navidad",
  reyes: "Reyes",
  saint_day: "Santo",
  anniversary: "Aniversario",
  wedding: "Boda",
  thank_you: "Agradecimiento",
  other: "Otro",
};

export const dateTypes = ["anniversary", "saint_day", "memorial", "other"] as const;
export type DateType = (typeof dateTypes)[number];

export const dateTypeLabels: Record<DateType, string> = {
  anniversary: "Aniversario",
  saint_day: "Santo",
  memorial: "Recuerdo",
  other: "Otra",
};

export const relationshipTypes = [
  "partner",
  "spouse",
  "parent",
  "child",
  "sibling",
  "grandparent",
  "grandchild",
  "cousin",
  "uncle",
  "nephew",
  "sibling_in_law",
  "parent_in_law",
  "child_in_law",
  "relative",
  "friend",
  "colleague",
  "boss",
  "reports_to",
  "other",
] as const;
export type RelationshipType = (typeof relationshipTypes)[number];

export const relationshipLabels: Record<RelationshipType, string> = {
  partner: "Pareja de",
  spouse: "Cónyuge de",
  parent: "Padre/madre de",
  child: "Hijo/a de",
  sibling: "Hermano/a de",
  grandparent: "Abuelo/a de",
  grandchild: "Nieto/a de",
  cousin: "Primo/a de",
  uncle: "Tío/a de",
  nephew: "Sobrino/a de",
  sibling_in_law: "Cuñado/a de",
  parent_in_law: "Suegro/a de",
  child_in_law: "Yerno/nuera de",
  relative: "Familiar de",
  friend: "Amigo/a de",
  colleague: "Compañero/a de trabajo de",
  boss: "Jefe/a de",
  reports_to: "Trabaja para",
  other: "Relacionado con",
};

/** Relación inversa: si A es «padre/madre de» B, B es «hijo/a de» A. */
export const relationshipInverse: Record<RelationshipType, RelationshipType> = {
  partner: "partner",
  spouse: "spouse",
  parent: "child",
  child: "parent",
  sibling: "sibling",
  grandparent: "grandchild",
  grandchild: "grandparent",
  cousin: "cousin",
  uncle: "nephew",
  nephew: "uncle",
  sibling_in_law: "sibling_in_law",
  parent_in_law: "child_in_law",
  child_in_law: "parent_in_law",
  relative: "relative",
  friend: "friend",
  colleague: "colleague",
  boss: "reports_to",
  reports_to: "boss",
  other: "other",
};

// ---------- Auth ----------

export const registerSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(100),
  password: z.string().min(10, "Mínimo 10 caracteres").max(200),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  mustChangePassword?: boolean;
  /** Versión de la foto de perfil (propia o de «mi ficha»); null = sin foto */
  avatar?: string | null;
  /** true si la foto es la subida por el usuario (no la de «mi ficha») */
  avatarOwn?: boolean;
  /** Contacto marcado como «mi ficha» */
  meContactId?: string | null;
}

export const registrationModes = ["closed", "first", "open"] as const;
export type RegistrationMode = (typeof registrationModes)[number];

/** Administración de usuarios */
export interface AdminUser extends User {
  disabled: boolean;
  createdAt: string;
  contactCount: number;
}
export const adminUserCreateSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(10, "Mínimo 10 caracteres").max(200),
  isAdmin: z.boolean().default(false),
});
export const adminUserPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  isAdmin: z.boolean().optional(),
  disabled: z.boolean().optional(),
  password: z.string().min(10, "Mínimo 10 caracteres").max(200).optional(),
});
export const changePasswordSchema = z.object({
  current: z.string().min(1),
  password: z.string().min(10, "Mínimo 10 caracteres").max(200),
});

// ---------- Contactos ----------

const labeledValue = z.object({
  /** Identificador estable del dato (lo asigna el servidor); permite asociarle una etiqueta. */
  id: z.string().max(64).optional(),
  label: z.string().max(40).default(""),
  value: z.string().min(1).max(300),
});
export type LabeledValue = z.infer<typeof labeledValue>;

const address = z.object({
  id: z.string().max(64).optional(),
  label: z.string().max(40).default(""),
  street: z.string().max(200).default(""),
  city: z.string().max(100).default(""),
  region: z.string().max(100).default(""),
  postalCode: z.string().max(20).default(""),
  country: z.string().max(100).default(""),
  /** Coordenadas (si la dirección está geolocalizada). */
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
});
export type Address = z.infer<typeof address>;

/** ¿Tiene coordenadas esta dirección? */
export const isGeolocated = (a: Pick<Address, "lat" | "lon">) => typeof a.lat === "number" && typeof a.lon === "number";

/**
 * Estado de geolocalización de un contacto según sus direcciones:
 * none = sin direcciones · missing = ninguna localizada · partial = algunas · full = todas.
 */
export const geoStatuses = ["missing", "partial", "none", "full"] as const;
export type GeoStatus = (typeof geoStatuses)[number];
export function geoStatusOf(addresses: Pick<Address, "lat" | "lon">[]): GeoStatus {
  if (!addresses.length) return "none";
  const n = addresses.filter(isGeolocated).length;
  return n === 0 ? "missing" : n === addresses.length ? "full" : "partial";
}
export const geoStatusLabels: Record<GeoStatus, string> = {
  missing: "Dirección sin geolocalizar",
  partial: "Algunas direcciones sin geolocalizar",
  none: "Sin dirección",
  full: "Geolocalizado",
};

/** Sugerencia del buscador de direcciones (ya repartida en los campos de una dirección). */
export interface GeoSuggestion {
  label: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  lat: number;
  lon: number;
}

/** Fecha "YYYY-MM-DD" o "--MM-DD" (sin año, como en vCard). */
export const partialDate = z
  .string()
  .regex(/^(\d{4}-|--)\d{2}-\d{2}$/, "Formato YYYY-MM-DD o --MM-DD");

export const contactInputSchema = z.object({
  givenName: z.string().max(100).default(""),
  familyName: z.string().max(100).default(""),
  displayName: z.string().min(1).max(200),
  nickname: z.string().max(100).default(""),
  organization: z.string().max(200).default(""),
  /** Opcional: la empresa es a su vez un contacto de la agenda. */
  organizationContactId: z.string().uuid().nullable().default(null),
  jobTitle: z.string().max(200).default(""),
  birthday: partialDate.nullable().default(null),
  emails: z.array(labeledValue).max(20).default([]),
  phones: z.array(labeledValue).max(20).default([]),
  urls: z.array(labeledValue).max(20).default([]),
  addresses: z.array(address).max(10).default([]),
  notes: z.string().max(10000).default(""),
  visibility: z.enum(visibilities).default("private"),
  /** Nombre que ve el móvil por CardDAV (y por tanto WhatsApp): nombre y apellidos, apodo o nombre a mostrar */
  mobileName: z.enum(["full", "nickname", "display"]).default("full"),
});
export type ContactInput = z.infer<typeof contactInputSchema>;
export const mobileNameLabels: Record<ContactInput["mobileName"], string> = {
  full: "Nombre y apellidos",
  nickname: "Apodo",
  display: "Nombre a mostrar",
};
export const contactPatchSchema = contactInputSchema.partial();

export interface ContactSummary {
  id: string;
  displayName: string;
  givenName: string;
  familyName: string;
  nickname: string;
  organization: string;
  hasPhoto: boolean;
  visibility: Visibility;
  ownerId: string;
  ownerName: string;
  isMine: boolean;
  canEdit: boolean;
  updatedAt: string;
  /** Tus etiquetas en este contacto (personales). */
  tags: TagLite[];
  /** Teléfono y email a mostrar en la lista (si se filtra por etiqueta, los de esa etiqueta). */
  phone?: string;
  email?: string;
  /** Estado de geolocalización de sus direcciones. */
  geo: GeoStatus;
  /** ¿Tiene cambios en el historial después de su creación? */
  hasHistory?: boolean;
  /** Favorito para ti (personal, como las etiquetas). */
  favorite?: boolean;
}

export interface Contact extends ContactSummary, ContactInput {
  createdAt: string;
  /** Tiene portada (imagen apaisada tras la cabecera; solo en Agendario). */
  hasCover?: boolean;
  /** Contacto enlazado como empresa (si lo hay y puedes verlo). */
  organizationContact: { id: string; displayName: string; hasPhoto: boolean } | null;
}

// ---------- Etiquetas (personales de cada usuario) ----------

/** Colores de etiqueta. «teal» se pinta en índigo (el color del tema) por compatibilidad; los 10 últimos llegaron en la 1.4. */
export const tagColors = ["slate", "red", "orange", "amber", "green", "teal", "sky", "blue", "violet", "pink", "navy", "lime", "forest", "turquoise", "cyan", "eggplant", "fuchsia", "maroon", "brown", "black"] as const;
/** Nombre en castellano de cada color. */
export const tagColorNames: Record<(typeof tagColors)[number], string> = {
  slate: "Gris", red: "Rojo", orange: "Naranja", amber: "Ámbar", green: "Verde", teal: "Índigo (tema)", sky: "Celeste", blue: "Azul", violet: "Violeta", pink: "Rosa",
  navy: "Azul marino", lime: "Lima", forest: "Verde bosque", turquoise: "Turquesa", cyan: "Cian", eggplant: "Berenjena", fuchsia: "Fucsia", maroon: "Granate", brown: "Marrón", black: "Negro",
};
export type TagColor = (typeof tagColors)[number];

export const tagInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.enum(tagColors).default("teal"),
  parentId: z.string().uuid().nullable().optional(),
});
/** Nuevo orden y anidado de todas las etiquetas. */
export const tagOrderSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), parentId: z.string().uuid().nullable(), position: z.number().int().min(0) })).max(1000),
});
export const tagPatchSchema = tagInputSchema.partial();
export type TagInput = z.infer<typeof tagInputSchema>;

export interface TagLite {
  id: string;
  name: string;
  color: TagColor;
}
export interface Tag extends TagLite {
  contactCount: number;
  parentId: string | null;
  position: number;
  /** Contactos con esta etiqueta o alguna de sus subetiquetas */
  totalCount: number;
}

export const contactTagsSchema = z.object({ tagIds: z.array(z.string().uuid()).max(100) });

/** Etiqueta de un dato concreto (teléfono, email o dirección). tagId null = sin etiqueta (por defecto). */
export const itemTagSchema = z.object({ tagId: z.string().uuid().nullable() });

// ---------- Importación ----------

export const duplicateModes = ["skip", "update", "duplicate"] as const;
export type DuplicateMode = (typeof duplicateModes)[number];

export const importRequestSchema = z.object({
  /** Cada elemento es el texto de un vCard (BEGIN:VCARD … END:VCARD). */
  cards: z.array(z.string().max(12_000_000)).min(1).max(500),
  tagIds: z.array(z.string().uuid()).max(20).default([]),
  /** Crea etiquetas a partir del campo CATEGORIES de cada vCard. */
  categoriesAsTags: z.boolean().default(true),
  onDuplicate: z.enum(duplicateModes).default("skip"),
  visibility: z.enum(visibilities).default("private"),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  failed: { name: string; error: string }[];
}

// ---------- Duplicados ----------

export const duplicateReasons = ["email", "phone", "name", "similar_name"] as const;
export type DuplicateReason = (typeof duplicateReasons)[number];

export const duplicateReasonLabels: Record<DuplicateReason, string> = {
  email: "Mismo email",
  phone: "Mismo teléfono",
  name: "Mismo nombre",
  similar_name: "Nombre parecido",
};

export interface DuplicateContact extends ContactSummary {
  /** Cuántos datos tiene (para proponer el más completo como principal). */
  score: number;
  subtitle: string;
  jobTitle: string;
  birthday: string | null;
  phones: string[];
  emails: string[];
  addresses: string[];
  /** Ideas de regalo, regalos recibidos y fechas: se perderían si se borra sin combinar. */
  extras: number;
}

export interface DuplicateGroup {
  key: string;
  /** Los dos primeros son la pareja a revisar; el resto, otros contactos del mismo grupo. */
  contacts: DuplicateContact[];
  /** Motivos de todo el grupo. */
  reasons: DuplicateReason[];
  /** Motivos de la pareja que se muestra (los dos primeros contactos). */
  pairReasons: DuplicateReason[];
}

export const photoSources = ["keep", "remove", "none"] as const;

export const mergeRequestSchema = z.object({
  keepId: z.string().uuid(),
  removeId: z.string().uuid(),
  /** Valores finales del contacto que se conserva (los elige el usuario en el panel). */
  values: contactInputSchema.omit({ visibility: true }),
  photoFrom: z.enum(photoSources).default("keep"),
});
export type MergeRequest = z.infer<typeof mergeRequestSchema>;

export const dismissSchema = z.object({ aId: z.string().uuid(), bId: z.string().uuid() });
export type MergePreview = Omit<MergeRequest, "keepId" | "removeId">;
export const autoMergeSchema = z.object({ keepId: z.string().uuid(), removeId: z.string().uuid() });

// ---------- Acciones en bloque ----------

const idList = z.array(z.string().uuid()).min(1).max(20000);
export const bulkIdsSchema = z.object({ ids: idList });
export const bulkTagSchema = z.object({ ids: idList, tagId: z.string().uuid(), op: z.enum(["add", "remove"]) });
export const exportSelectionSchema = z.object({
  ids: idList,
  gifts: z.boolean().default(false),
  /** Si se indica, de cada contacto se exportan solo los teléfonos/emails/direcciones de esa etiqueta. */
  tagId: z.string().uuid().optional(),
});

export interface BulkResult {
  affected: number;
  /** Contactos que no se han podido tocar (p. ej. borrar contactos que te han compartido). */
  skipped: number;
}

// ---------- Compartir ----------

export const shareSchema = z
  .object({
    userId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
    permission: z.enum(permissions).default("read"),
  })
  .refine((s) => !!s.userId !== !!s.groupId, "Indica userId o groupId, no ambos");
export const sharesInputSchema = z.object({ shares: z.array(shareSchema).max(100) });
export type ShareInput = z.infer<typeof shareSchema>;

export interface Share {
  userId: string | null;
  groupId: string | null;
  name: string;
  permission: Permission;
}

// ---------- Regalos (siempre personales de cada usuario) ----------

/** Estado de una idea: pendiente → comprada (para un evento) → regalada. */
export const giftStatuses = ["idea", "bought", "given"] as const;
export type GiftStatus = (typeof giftStatuses)[number];

export const giftIdeaInputSchema = z.object({
  title: z.string().min(1).max(200),
  url: z.string().url().max(2000).nullable().default(null),
  notes: z.string().max(2000).default(""),
  priceCents: z.number().int().nonnegative().nullable().default(null),
  status: z.enum(giftStatuses).default("idea"),
  /** Compatibilidad: true = regalada */
  given: z.boolean().default(false),
  /** Fecha en que se regala o se va a regalar (la del evento elegido) */
  givenAt: z.string().date().nullable().default(null),
  occasion: z.enum(occasions).nullable().default(null),
  /** Evento para el que es: birthday · saint · date:<id> · custom */
  eventKey: z.string().max(80).nullable().default(null),
  /** Texto del evento («Cumpleaños 2027»…) */
  eventLabel: z.string().max(120).default(""),
  /** Fecha del evento (si se regaló otro día, givenAt es ese día). Nulo = la de givenAt */
  eventDate: z.string().date().nullable().optional(),
  /** Valoración al regalarlo: 0–10 medias estrellas (se muestra como 0–5 estrellas). Nulo = sin valorar */
  rating: z.number().int().min(0).max(10).nullable().optional(),
  /** Anotación al regalarlo */
  givenNote: z.string().max(2000).optional(),
});
export type GiftIdeaInput = z.infer<typeof giftIdeaInputSchema>;
export const giftIdeaPatchSchema = giftIdeaInputSchema.partial();

export interface GiftIdea extends GiftIdeaInput {
  id: string;
  contactId: string;
  createdAt: string;
  /** Versión de la miniatura (null = sin imagen) */
  imageKey?: string | null;
}

/** Pestaña Regalos → Regalados: lo ya regalado, con el contacto. */
export interface GivenGift extends GiftIdea {
  contactName: string;
  hasPhoto: boolean;
  photoVersion: string;
}

/** Pestaña Regalos: contactos con fechas de regalo, su próxima fecha y sus ideas. */
export interface GiftOverviewItem {
  contactId: string;
  contactName: string;
  hasPhoto: boolean;
  photoVersion: string;
  next: UpcomingEvent | null;
  ideas: GiftIdea[];
}

/** Lo que se saca de una página web para una idea de regalo. */
export interface LinkPreview {
  url: string;
  title: string | null;
  image: string | null;
}

/** Llamadas del registro del móvil (app Android). */
export const callImportSchema = z.object({
  calls: z
    .array(
      z.object({
        id: z.string().max(100),
        number: z.string().max(60),
        type: z.enum(["in", "out", "missed"]),
        at: z.string().datetime({ offset: true }),
        durationSec: z.number().int().min(0).max(86400),
      }),
    )
    .max(5000),
});
export type CallImport = z.infer<typeof callImportSchema>;
export interface CallImportResult {
  added: number;
  skipped: number;
  unmatched: number;
  /** Las llamadas guardadas (para el aviso «¿Quieres apuntar algo?» al colgar) */
  items?: { interactionId: string; contactId: string; contactName: string; type: "in" | "out" | "missed"; durationSec: number; at: string; number: string }[];
  /** Llamadas atendidas con números que no son contactos (para el aviso «¿Lo guardas?») */
  unknown?: { unknownCallId: string; number: string; type: "in" | "out"; durationSec: number; at: string }[];
}

/** Lo que muestra la tarjeta de Agendario al sonar o marcar una llamada (app Android) */
export interface CallLookup {
  contactId: string | null;
  name: string;
  subtitle: string;
  notes: { at: string; kind: string; text: string }[];
  reminders: { id: string; kind: ReminderKind; text: string; dueAt: string }[];
}

/** Llamada con un número que no es contacto, con o sin nota */
export interface UnknownCall {
  id: string;
  number: string;
  type: "in" | "out";
  occurredAt: string;
  durationSec: number;
  notes: string;
  attachments?: InteractionAttachment[];
}

// ---------- Recordatorios ----------

export const reminderKinds = ["call", "email", "message", "note", "other"] as const;
export type ReminderKind = (typeof reminderKinds)[number];
export const reminderKindLabels: Record<ReminderKind, string> = {
  call: "Llamar",
  email: "Enviar un correo",
  message: "Enviar un mensaje",
  note: "Anotar algo",
  other: "Otra cosa",
};
export const reminderKindIcons: Record<ReminderKind, string> = { call: "📞", email: "✉️", message: "💬", note: "📝", other: "⏰" };

export const reminderInputSchema = z.object({
  contactId: z.string().uuid().nullable().default(null),
  kind: z.enum(reminderKinds),
  text: z.string().max(2000).default(""),
  dueAt: z.string().datetime({ offset: true }),
});
export const reminderPatchSchema = reminderInputSchema.partial().extend({ done: z.boolean().optional() });
export type ReminderInput = z.infer<typeof reminderInputSchema>;
export interface Reminder extends ReminderInput {
  id: string;
  doneAt: string | null;
  createdAt: string;
  contact: { id: string; displayName: string; hasPhoto: boolean; updatedAt: string } | null;
  /** Enlazado con una tarea de Todoist */
  todoist?: boolean;
  /** La tarea de Todoist se borró: ya no está enlazado */
  todoistUnlinked?: boolean;
  /** false: la app del móvil no avisa (lo hace Todoist) */
  phoneAlert?: boolean;
}

// ---------- Todoist ----------

export interface TodoistStatus {
  connected: boolean;
  projectId: string | null;
  projectName: string | null;
  label: string;
  /** ¿Siguen sonando los avisos de Agendario en el móvil para los recordatorios enlazados? */
  phoneAlerts: boolean;
  publicUrl: string;
  lastSyncAt: string | null;
  lastError: string | null;
}
export const todoistSettingsSchema = z.object({
  token: z.string().min(10).max(200).optional(),
  projectId: z.string().max(100).nullable().optional(),
  label: z.string().max(60).optional(),
  phoneAlerts: z.boolean().optional(),
  publicUrl: z.string().max(300).optional(),
});

// ---------- Gmail (contactos de Agendario → Google Contactos) ----------

export interface GmailAccountStatus {
  /** Identificador de la cuenta dentro de Agendario («main» = la conectada antes de la 1.3.1) */
  id: string;
  /** Dirección de la cuenta de Google (puede faltar si nunca se llegó a conectar) */
  email: string | null;
  /** Tiene permiso de Google; si no, hay que volver a conectarla */
  connected: boolean;
  /** Etiquetas que van a esta cuenta (sin contar las subetiquetas, que entran solas) */
  tagIds: string[];
  /** Contactos que están ahora en esta cuenta */
  linked: number;
  lastSyncAt: string | null;
  lastError: string | null;
  lastResult: { created: number; updated: number; deleted: number } | null;
  running: boolean;
  /** Última búsqueda de fotos en Google y cuántas se añadieron */
  photosAt: string | null;
  photosAdded: number | null;
  photosError: string | null;
}

export interface GmailStatus {
  /** El administrador ha puesto el ID y el secreto de la app de Google (Ajustes → Sincronización) */
  appConfigured: boolean;
  /** ID de cliente (público) para mostrarlo; el secreto nunca se devuelve */
  appClientId: string;
  /** Cuentas de Google del usuario (1.3.1) */
  accounts: GmailAccountStatus[];
  // Lo de abajo es la primera cuenta, para las APK de la 1.3.0 (que solo conocían una)
  connected: boolean;
  email: string | null;
  tagIds: string[];
  linked: number;
  lastSyncAt: string | null;
  lastError: string | null;
  lastResult: { created: number; updated: number; deleted: number } | null;
  running: boolean;
}
export const gmailAppSchema = z.object({
  clientId: z.string().trim().min(10).max(300),
  clientSecret: z.string().trim().min(6).max(300).optional(),
});
/** Etiquetas de una cuenta (sin `accountId`: la primera, como en la 1.3.0) */
export const gmailTagsSchema = z.object({ tagIds: z.array(z.string().uuid()).max(500), accountId: z.string().max(40).optional() });
/** A qué cuentas va una etiqueta */
export const gmailTagAccountsSchema = z.object({ accountIds: z.array(z.string().max(40)).max(50) });

export const giftReceivedInputSchema = z.object({
  description: z.string().min(1).max(300),
  receivedAt: z.string().date().nullable().default(null),
  occasion: z.enum(occasions).nullable().default(null),
  notes: z.string().max(2000).default(""),
  /** Valoración: 0–10 medias estrellas. Nulo = sin valorar */
  rating: z.number().int().min(0).max(10).nullable().optional(),
  /** Quién lo regaló (uno o varios contactos). Desde la ficha, si falta, ese contacto. */
  contactIds: z.array(z.string().uuid()).max(50).optional(),
});
export type GiftReceivedInput = z.infer<typeof giftReceivedInputSchema>;
export const giftReceivedPatchSchema = giftReceivedInputSchema.partial().extend({
  contactIds: z.array(z.string().uuid()).min(1).max(50).optional(),
});

export interface GiftReceived {
  id: string;
  description: string;
  receivedAt: string | null;
  occasion: Occasion | null;
  notes: string;
  rating: number | null;
  /** Versión de la foto (null = sin foto) */
  imageKey: string | null;
  /** Primer contacto (compatibilidad) */
  contactId: string | null;
  /** Todos los que lo regalaron (solo los que puedes ver) */
  contacts: { id: string; displayName: string; hasPhoto: boolean; updatedAt: string }[];
  createdAt: string;
}

// ---------- Fechas importantes ----------

export const importantDateInputSchema = z.object({
  label: z.string().min(1).max(100),
  type: z.enum(dateTypes).default("other"),
  date: partialDate,
  remindDaysBefore: z.number().int().min(0).max(90).default(7),
});
export type ImportantDateInput = z.infer<typeof importantDateInputSchema>;

export interface ImportantDate extends ImportantDateInput {
  id: string;
  contactId: string;
}

// ---------- Relaciones ----------

export const relationshipInputSchema = z.object({
  relatedContactId: z.string().uuid(),
  type: z.enum(relationshipTypes),
});
export type RelationshipInput = z.infer<typeof relationshipInputSchema>;

export interface Relationship {
  id: string;
  type: RelationshipType;
  relatedContactId: string;
  relatedName: string;
}

// ---------- Grupos ----------

export const groupInputSchema = z.object({ name: z.string().min(1).max(100) });
export const groupMemberSchema = z.object({ userId: z.string().uuid() });

export interface Group {
  id: string;
  name: string;
  ownerId: string;
  members: { id: string; name: string }[];
}

// ---------- Ficha completa ----------

export interface ContactDetail extends Contact {
  importantDates: ImportantDate[];
  relationships: Relationship[];
  giftIdeas: GiftIdea[];
  giftsReceived: GiftReceived[];
  shares: Share[] | null; // solo para el propietario
  /** Tus etiquetas en cada dato (teléfono, email, dirección): id del dato → etiqueta. */
  itemTags: Record<string, TagLite>;
  /** Tus llamadas y apuntes con este contacto (privados). */
  interactions: Interaction[];
  /** Tus recordatorios pendientes con este contacto (privados). */
  reminders: Reminder[];
  /** Tus preferencias para este contacto (teléfono, email y app por defecto). */
  prefs: ContactPrefs;
  /** Número de cambios en el historial */
  historyCount: number;
  /** Si es una empresa: contactos que la tienen enlazada */
  employees: { id: string; displayName: string; jobTitle: string; hasPhoto: boolean; updatedAt: string; phone?: string; email?: string }[];
}

// ---------- Efemérides (fechas personales del usuario, sin contacto) ----------

export const personalEventInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  date: partialDate,
  emoji: z.string().max(16).nullable().optional(),
  /** Se recuerda cada año (aparece también en el calendario de Eventos) */
  yearly: z.boolean().default(true),
  description: z.string().max(500).nullable().optional(),
  /** Comentario personal extenso */
  comment: z.string().max(20000).nullable().optional(),
  /** Contactos relacionados */
  contactIds: z.array(z.string().uuid()).max(50).default([]),
});
export type PersonalEventInput = z.infer<typeof personalEventInputSchema>;

export interface PersonalEvent {
  id: string;
  title: string;
  date: string;
  emoji: string | null;
  yearly: boolean;
  description: string | null;
  comment: string | null;
  hasPhoto: boolean;
  /** Contactos relacionados (solo los que el usuario puede ver) */
  contacts: { id: string; displayName: string; hasPhoto: boolean; updatedAt: string }[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Contraseñas de aplicación (CardDAV) ----------

export interface AppPassword {
  id: string;
  name: string;
  /** Primeros caracteres, para reconocerla */
  hint: string;
  lastUsedAt: string | null;
  createdAt: string;
}

// ---------- Calendario suscribible (.ics) ----------

export const calendarFeedSchema = z.object({
  events: z.boolean().default(true),
  personal: z.boolean().default(true),
});
export type CalendarFeedOptions = z.infer<typeof calendarFeedSchema>;
export interface CalendarFeed extends CalendarFeedOptions {
  /** Ruta privada del calendario (sin el servidor); null si no hay enlace creado */
  path: string | null;
}

// ---------- Próximas fechas ----------

export interface UpcomingEvent {
  contactId: string;
  contactName: string;
  hasPhoto: boolean;
  label: string;
  kind: "birthday" | DateType;
  /** birthday · saint (automático) · date:<id> */
  key: string;
  date: string; // ocurrencia YYYY-MM-DD
  daysLeft: number; // negativo si ya pasó
  turning: number | null; // años que cumple, si se conoce el año
  openGiftIdeas: number;
  /** Solo en cumpleaños, aniversarios y santos: none (rojo) · ideas (amarillo) · bought (verde) · given (verde, ya regalado) */
  gift: "none" | "ideas" | "bought" | "given" | null;
  /** Santo calculado por el nombre */
  auto?: boolean;
  /** Emoji elegido para el calendario */
  emoji?: string;
  /** Ideas compradas o regaladas para esta ocurrencia */
  gifts?: { id: string; title: string; status: GiftStatus }[];
}

/** Regalos comprados, sin marcar como regalados, cuyo evento ya pasó. */
export interface PendingGift {
  id: string;
  title: string;
  contactId: string;
  contactName: string;
  eventLabel: string;
  givenAt: string | null;
}

/** Ocasión elegible al marcar un regalo como comprado. */
export interface GiftOccasion {
  key: string;
  label: string;
  date: string;
  occasion: Occasion;
}

export const giftEventKinds = ["birthday", "anniversary", "saint_day"] as const;

// ---------- Nombre de la app ----------

export const APP_NAME = "Agendario";

// ---------- Historial y papelera ----------

/** Días que se conservan el historial y los contactos de la papelera. */
export const HISTORY_DAYS = 60;

/** Campos del contacto que se guardan en el historial (y se pueden restaurar). */
export const historyFields = [
  "displayName",
  "givenName",
  "familyName",
  "nickname",
  "organization",
  "organizationContactId",
  "jobTitle",
  "birthday",
  "phones",
  "emails",
  "urls",
  "addresses",
  "notes",
  "photoKey",
  "visibility",
] as const;
export type HistoryField = (typeof historyFields)[number];

export const historyFieldLabels: Record<HistoryField, string> = {
  displayName: "Nombre a mostrar",
  givenName: "Nombre",
  familyName: "Apellidos",
  nickname: "Apodo",
  organization: "Empresa",
  organizationContactId: "Empresa enlazada",
  jobTitle: "Cargo",
  birthday: "Cumpleaños",
  phones: "Teléfonos",
  emails: "Emails",
  urls: "Webs",
  addresses: "Direcciones",
  notes: "Notas",
  photoKey: "Foto",
  visibility: "Visibilidad",
};

/** Campos que no se restauran uno a uno (la foto no se guarda en el historial). */
export const nonRestorableFields: HistoryField[] = ["photoKey"];

export type HistoryAction = "create" | "update" | "delete" | "restore" | "merge";
export const historyActionLabels: Record<HistoryAction, string> = {
  create: "Creado",
  update: "Modificado",
  delete: "Borrado",
  restore: "Restaurado",
  merge: "Combinado",
};

export interface HistoryEntry {
  id: string;
  action: HistoryAction;
  userName: string | null;
  createdAt: string;
  changes: { field: HistoryField; before: unknown; after: unknown }[];
  snapshot: Partial<Record<HistoryField, unknown>>;
  meta: Record<string, unknown>;
}

export const historyRestoreSchema = z.object({
  /** Un campo concreto; si no se indica, se restaura la versión entera. */
  field: z.enum(historyFields).optional(),
  /** after = dejarlo como quedó tras ese cambio · before = deshacer ese cambio (volver al valor anterior) */
  side: z.enum(["after", "before"]).default("after"),
});

export interface TrashItem {
  id: string;
  displayName: string;
  organization: string;
  hasPhoto: boolean;
  deletedAt: string;
  /** Si se borró al combinarlo con otro contacto */
  mergedInto: { id: string; displayName: string } | null;
  purgeAt: string;
}

// ---------- Llamadas y apuntes ----------

export const interactionKinds = ["call_out", "call_in", "call_missed", "meeting", "message", "note"] as const;
export type InteractionKind = (typeof interactionKinds)[number];
export const interactionKindLabels: Record<InteractionKind, string> = {
  call_out: "Llamada saliente",
  call_in: "Llamada entrante",
  call_missed: "Llamada perdida",
  meeting: "Reunión / en persona",
  message: "Mensaje",
  note: "Apunte",
};
export const interactionKindIcons: Record<InteractionKind, string> = {
  call_out: "📞↗",
  call_in: "📞↙",
  call_missed: "📵",
  meeting: "🤝",
  message: "💬",
  note: "📝",
};

export const interactionInputSchema = z.object({
  kind: z.enum(interactionKinds),
  occurredAt: z.string().datetime({ offset: true }),
  durationMin: z.number().int().min(0).max(24 * 60).nullable().default(null),
  channel: z.string().max(200).default(""),
  notes: z.string().max(20000).default(""),
});
export type InteractionInput = z.infer<typeof interactionInputSchema>;
/** Archivo adjunto a una llamada o apunte (foto, PDF, documento, audio…). */
export interface InteractionAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  hasThumb: boolean;
  createdAt: string;
}
export interface Interaction extends InteractionInput {
  id: string;
  contactId: string;
  createdAt: string;
  attachments: InteractionAttachment[];
}
/** Nota de «Últimas notas»: la anotación con el contacto al que pertenece. */
export interface RecentNote extends Interaction {
  contactName: string;
  contactHasPhoto: boolean;
  contactUpdatedAt: string;
}
export interface RecentNotesPage {
  items: RecentNote[];
  /** Para pedir la página siguiente (?before=…); null si no hay más */
  next: string | null;
}

/** Adjuntos: 25 MB por archivo y los tipos habituales. */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "application/pdf",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
  ".txt", ".csv", ".mp3", ".m4a", ".ogg", ".oga", ".opus",
].join(",");

// ---------- Acciones por defecto (llamar, mensaje, email) ----------

export const messagingApps = ["whatsapp", "whatsapp_business", "telegram", "signal", "sms"] as const;
export type MessagingApp = (typeof messagingApps)[number];
export const messagingAppLabels: Record<MessagingApp, string> = {
  whatsapp: "WhatsApp",
  whatsapp_business: "WhatsApp Business",
  telegram: "Telegram",
  signal: "Signal",
  sms: "SMS",
};

/** Preferencias generales de cada usuario. */
/** Temas de color (el principal sustituye al índigo) */
/** «dynamic» = colores del fondo de pantalla (Material You, solo en la app de Android; en la web, índigo) */
export const colorThemes = ["indigo", "ocean", "lagoon", "lavender", "clay", "graphite", "dynamic"] as const;
export type ColorTheme = (typeof colorThemes)[number];
export const colorThemeLabels: Record<ColorTheme, string> = {
  indigo: "Índigo", ocean: "Océano", lagoon: "Laguna", lavender: "Lavanda", clay: "Arcilla", graphite: "Grafito", dynamic: "Tu fondo de pantalla",
};
/** App con la que se escribe un correo */
export const emailApps = ["system", "gmail", "outlook", "fastmail", "proton"] as const;
export type EmailApp = (typeof emailApps)[number];
export const emailAppLabels: Record<EmailApp, string> = {
  system: "App de correo del sistema", gmail: "Gmail", outlook: "Outlook", fastmail: "Fastmail", proton: "Proton Mail",
};

export const userPrefsSchema = z.object({
  colorTheme: z.enum(colorThemes).default("indigo"),
  emailApp: z.enum(emailApps).default("system"),
  messagingApp: z.enum(messagingApps).default("whatsapp"),
  /** Prefijo que se añade a los números sin prefijo internacional */
  countryCode: z.string().regex(/^\d{1,4}$/).default("34"),
  /** Santos calculados por el nombre en Fechas */
  autoSaints: z.boolean().default(false),
  /** Servidor CardDAV: libretas que se publican (todos los contactos y/o por etiqueta) */
  carddav: z.object({ all: z.boolean().default(true), tagIds: z.array(z.string().uuid()).max(100).default([]) }).default({}),
  /** Etiquetas de teléfonos, emails y webs que se ofrecen en la lista */
  itemLabels: z
    .object({
      phones: z.array(z.string().max(40)).max(60).default(["Móvil", "Casa", "Trabajo"]),
      emails: z.array(z.string().max(40)).max(60).default(["Personal", "Trabajo"]),
      urls: z.array(z.string().max(40)).max(60).default(["Web", "Instagram", "LinkedIn"]),
    })
    .default({}),
});
export type UserPrefs = z.infer<typeof userPrefsSchema>;

/** Preferencias de un usuario para un contacto concreto (ids de los datos elegidos). */
export const contactPrefsSchema = z.object({
  callPhoneId: z.string().max(64).nullable().default(null),
  messagePhoneId: z.string().max(64).nullable().default(null),
  emailId: z.string().max(64).nullable().default(null),
  messagingApp: z.enum(messagingApps).nullable().default(null),
  /** false = sin santo automático para este contacto */
  autoSaint: z.boolean().default(true),
  /** Ajustes de cada fecha (birthday · saint · date:<id>): si lleva regalo y su emoji en el calendario */
  events: z.record(z.string().max(80), z.object({ gift: z.boolean().optional(), emoji: z.string().max(16).optional() })).default({}),
});
export type ContactPrefs = z.infer<typeof contactPrefsSchema>;

// ---------- Copias de seguridad ----------

export const backupDestTypes = ["local", "nfs", "smb", "drive"] as const;
export type BackupDestType = (typeof backupDestTypes)[number];
export const backupDestLabels: Record<BackupDestType, string> = {
  local: "Carpeta local (en el servidor de Agendario)",
  nfs: "NFS (NAS o servidor de archivos)",
  smb: "SMB / Samba (Windows, NAS)",
  drive: "Google Drive",
};
/** Destinos que se autorizan con el botón «Conectar» (código de dispositivo) */
export const oauthDestTypes: BackupDestType[] = ["drive"];
/** Destinos en los que hay que indicar la carpeta obligatoriamente */
export const folderRequiredTypes: BackupDestType[] = ["drive"];

export const backupDestSchema = z.object({
  type: z.enum(backupDestTypes).catch("local").default("local"),
  /** Carpeta dentro del destino */
  path: z.string().max(500).default(""),
  host: z.string().max(255).default(""),
  /** SMB: recurso compartido · NFS: ruta exportada */
  share: z.string().max(255).default(""),
  user: z.string().max(255).default(""),
  domain: z.string().max(255).default(""),
  /** NFS: usuario y grupo numéricos con los que se escribe */
  uid: z.number().int().min(0).max(4294967294).default(0),
  gid: z.number().int().min(0).max(4294967294).default(0),
  /** Al guardar o probar: nueva contraseña (vacía = conservar la actual) */
  password: z.string().max(500).optional(),
  hasPassword: z.boolean().optional(),
  /** OAuth: si ya está conectado (el token nunca sale del servidor) */
  connected: z.boolean().optional(),
  account: z.string().max(255).optional(),
});
export type BackupDest = z.infer<typeof backupDestSchema>;

export const backupConfigSchema = z.object({
  enabled: z.boolean().default(false),
  frequency: z.enum(["daily", "weekly", "monthly"]).default("daily"),
  hour: z.number().int().min(0).max(23).default(3),
  minute: z.number().int().min(0).max(59).default(30),
  /** 1 = lunes … 7 = domingo */
  weekday: z.number().int().min(1).max(7).default(1),
  monthDay: z.number().int().min(1).max(28).default(1),
  /** Número de copias que se conservan (las más recientes) */
  keepCount: z.number().int().min(1).max(1000).default(7),
  dest: backupDestSchema.default({}),
  /** Al guardar: nueva contraseña de cifrado (vacía = conservar) */
  encryptionPassword: z.string().min(8).max(500).optional(),
  hasEncryptionPassword: z.boolean().optional(),
});
export type BackupConfig = z.infer<typeof backupConfigSchema>;

/** Estado de la conexión con Google Drive (código de dispositivo) */
export interface OAuthStart {
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
}
export interface OAuthStatus {
  state: "idle" | "pending" | "ok" | "error";
  message?: string;
}

export interface BackupRun {
  id: string;
  trigger: string;
  status: "running" | "ok" | "error";
  destination: string;
  file: string;
  sizeBytes: number | null;
  error: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface BackupStatus {
  config: BackupConfig;
  nextRun: string | null;
  runs: BackupRun[];
  rclone: boolean;
  /** ¿Están registradas las apps de Google y Microsoft en esta instalación? */
  oauth: { drive: boolean };
  /** Nube con la que hay autorización ahora mismo */
  connected: { type: "drive"; account?: string } | null;
}

export interface BackupFile {
  name: string;
  size: number;
  modTime: string;
}

// ---------- Sincronización (CardDAV: Fastmail…) ----------

export const syncProviders = ["fastmail", "carddav"] as const;
export type SyncProvider = (typeof syncProviders)[number];
export const syncProviderLabels: Record<SyncProvider, string> = { fastmail: "Fastmail", carddav: "Otro servidor CardDAV" };
export const syncIntervals = [0, 5, 15, 30, 60, 180, 720] as const;

/** Datos para conectar (buscar libretas). */
export const syncConnectSchema = z.object({
  provider: z.enum(syncProviders),
  serverUrl: z.string().trim().max(500).default(""),
  username: z.string().trim().min(1, "Falta el usuario").max(300),
  /** Vacía al editar = se mantiene la guardada */
  password: z.string().max(300).default(""),
  accountId: z.string().uuid().optional(),
});

export const syncAccountInputSchema = syncConnectSchema.extend({
  name: z.string().trim().min(1).max(100),
  addressBookUrl: z.string().url(),
  addressBookName: z.string().max(200).default(""),
  tagIds: z.array(z.string().uuid()).min(1, "Elige al menos una etiqueta"),
  newTagId: z.string().uuid().nullable().default(null),
  intervalMin: z.number().int().min(0).max(1440).default(15),
  enabled: z.boolean().default(true),
});
export type SyncAccountInput = z.infer<typeof syncAccountInputSchema>;

export interface SyncSummary {
  uploaded: number;
  downloaded: number;
  created: number;
  updatedLocal: number;
  deletedRemote: number;
  deletedLocal: number;
  paired: number;
  conflicts: number;
  errors: number;
}

export interface SyncAccount {
  id: string;
  provider: SyncProvider;
  name: string;
  serverUrl: string;
  username: string;
  hasPassword: boolean;
  addressBookUrl: string;
  addressBookName: string;
  tagIds: string[];
  newTagId: string | null;
  intervalMin: number;
  enabled: boolean;
  initialized: boolean;
  running: boolean;
  lastSyncAt: string | null;
  /** ok · error · running · blocked:mass_remote · blocked:mass_local */
  lastStatus: string;
  lastError: string;
  lastSummary: SyncSummary | null;
  linkedCount: number;
}

export interface SyncPreview {
  remoteCount: number;
  localCount: number;
  pairs: { localId: string; localName: string; remoteName: string; addsTag: boolean }[];
  toUpload: string[];
  toDownload: string[];
}

export interface SyncLogEntry {
  id: string;
  runId: string;
  action: string;
  contactId: string | null;
  contactName: string;
  detail: string;
  at: string;
}
