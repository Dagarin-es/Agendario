import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  dateTypes,
  occasions,
  permissions,
  relationshipTypes,
  visibilities,
  tagColors,
  type Address,
  type LabeledValue,
} from "@agendario/shared";

export const visibilityEnum = pgEnum("visibility", visibilities);
export const permissionEnum = pgEnum("permission", permissions);
export const occasionEnum = pgEnum("occasion", occasions);
export const dateTypeEnum = pgEnum("date_type", dateTypes);
export const tagColorEnum = pgEnum("tag_color", tagColors);
export const relationshipTypeEnum = pgEnum("relationship_type", relationshipTypes);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ---------- Usuarios y sesiones ----------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    isAdmin: boolean("is_admin").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_idx").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable("sessions", {
  // Se guarda el hash SHA-256 del token, nunca el token en claro.
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Grupos (para compartir con varias personas a la vez) ----------

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

// ---------- Contactos (datos compartibles) ----------

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    visibility: visibilityEnum("visibility").notNull().default("private"),
    givenName: text("given_name").notNull().default(""),
    familyName: text("family_name").notNull().default(""),
    displayName: text("display_name").notNull(),
    nickname: text("nickname").notNull().default(""),
    organization: text("organization").notNull().default(""),
    // Opcional: la empresa enlazada a otro contacto de la agenda
    organizationContactId: uuid("organization_contact_id").references((): AnyPgColumn => contacts.id, { onDelete: "set null" }),
    jobTitle: text("job_title").notNull().default(""),
    birthday: text("birthday"), // YYYY-MM-DD o --MM-DD
    emails: jsonb("emails").$type<LabeledValue[]>().notNull().default([]),
    phones: jsonb("phones").$type<LabeledValue[]>().notNull().default([]),
    urls: jsonb("urls").$type<LabeledValue[]>().notNull().default([]),
    addresses: jsonb("addresses").$type<Address[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    photoKey: text("photo_key"), // nombre del fichero en /data/photos
    // UID del vCard de origen (importación). Sirve para detectar duplicados al reimportar.
    vcardUid: text("vcard_uid"),
    // UIDs de los contactos fusionados en este (para no recrearlos al reimportar).
    mergedUids: jsonb("merged_uids").$type<string[]>().notNull().default([]),
    // Para la futura sincronización: se incrementa con cada cambio (ETag de CardDAV).
    revision: integer("revision").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("contacts_owner_idx").on(t.ownerId),
    index("contacts_name_idx").on(sql`lower(${t.displayName})`),
    index("contacts_owner_uid_idx").on(t.ownerId, t.vcardUid),
  ],
);

export const contactShares = pgTable(
  "contact_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),
    permission: permissionEnum("permission").notNull().default("read"),
  },
  (t) => [
    index("contact_shares_contact_idx").on(t.contactId),
    check("share_target", sql`(${t.userId} IS NULL) <> (${t.groupId} IS NULL)`),
  ],
);

export const importantDates = pgTable("important_dates", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  type: dateTypeEnum("type").notNull().default("other"),
  date: text("date").notNull(), // YYYY-MM-DD o --MM-DD
  remindDaysBefore: integer("remind_days_before").notNull().default(7),
});

export const relationships = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    relatedContactId: uuid("related_contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    type: relationshipTypeEnum("type").notNull(),
  },
  (t) => [index("relationships_contact_idx").on(t.contactId)],
);

// ---------- Datos personales de cada usuario sobre un contacto ----------
// Nunca se comparten, aunque el contacto sí lo esté.

export const giftIdeas = pgTable(
  "gift_ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url"),
    notes: text("notes").notNull().default(""),
    priceCents: integer("price_cents"),
    given: boolean("given").notNull().default(false),
    givenAt: date("given_at"),
    occasion: occasionEnum("occasion"),
    ...timestamps,
  },
  (t) => [index("gift_ideas_contact_user_idx").on(t.contactId, t.userId)],
);

export const giftsReceived = pgTable(
  "gifts_received",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    receivedAt: date("received_at"),
    occasion: occasionEnum("occasion"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gifts_received_contact_user_idx").on(t.contactId, t.userId)],
);

// ---------- Etiquetas (personales) ----------

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: tagColorEnum("color").notNull().default("teal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tags_user_name_idx").on(t.userId, sql`lower(${t.name})`)],
);

export const contactTags = pgTable(
  "contact_tags",
  {
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tagId] }), index("contact_tags_tag_idx").on(t.tagId)],
);

// ---------- Duplicados descartados ("no son la misma persona") ----------

export const duplicateDismissals = pgTable(
  "duplicate_dismissals",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Siempre aId < bId para que la pareja sea única.
    aId: uuid("a_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    bId: uuid("b_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.aId, t.bId] })],
);

// ---------- Etiqueta de cada dato (teléfono, email, dirección) — personal ----------

export const contactItemTags = pgTable(
  "contact_item_tags",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** id del dato dentro de phones/emails/addresses */
    itemId: text("item_id").notNull(),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.contactId, t.itemId] }), index("contact_item_tags_tag_idx").on(t.tagId)],
);

// ---------- Historial de cambios de cada contacto (se conserva 60 días) ----------

export const contactHistory = pgTable(
  "contact_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** Quién hizo el cambio (null si fue automático) */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** create · update · delete · restore · merge */
    action: text("action").notNull(),
    /** Campos cambiados: [{ field, before, after }] */
    changes: jsonb("changes").$type<{ field: string; before: unknown; after: unknown }[]>().notNull().default([]),
    /** Cómo quedó el contacto tras el cambio (o cómo estaba al borrarlo) */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    /** Datos extra: origen (importación, combinación…), enlaces quitados al borrar, etc. */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contact_history_contact_idx").on(t.contactId, t.createdAt), index("contact_history_created_idx").on(t.createdAt)],
);

// ---------- Llamadas y apuntes de conversaciones (privados de cada usuario) ----------

export const interactions = pgTable(
  "interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** call_out · call_in · call_missed · meeting · message · note */
    kind: text("kind").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    durationMin: integer("duration_min"),
    /** Teléfono o canal usado (opcional) */
    channel: text("channel").notNull().default(""),
    notes: text("notes").notNull().default(""),
    ...timestamps,
  },
  (t) => [index("interactions_contact_idx").on(t.userId, t.contactId, t.occurredAt)],
);

// ---------- Preferencias de cada usuario y por contacto ----------

export const userPrefs = pgTable("user_prefs", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  prefs: jsonb("prefs").$type<Record<string, unknown>>().notNull().default({}),
});

export const contactPrefs = pgTable(
  "contact_prefs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    prefs: jsonb("prefs").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.userId, t.contactId] })],
);

// ---------- Ajustes del servidor y copias de seguridad ----------

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const backupRuns = pgTable(
  "backup_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** auto · manual · restore-safety */
    trigger: text("trigger").notNull(),
    /** running · ok · error */
    status: text("status").notNull(),
    destination: text("destination").notNull().default(""),
    file: text("file").notNull().default(""),
    sizeBytes: integer("size_bytes"),
    error: text("error").notNull().default(""),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("backup_runs_started_idx").on(t.startedAt)],
);

// ---------- Sincronización con servicios externos (CardDAV: Fastmail…) ----------

export const syncAccounts = pgTable(
  "sync_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** fastmail · carddav */
    provider: text("provider").notNull(),
    name: text("name").notNull(),
    serverUrl: text("server_url").notNull(),
    username: text("username").notNull(),
    password: text("password").notNull(),
    addressBookUrl: text("address_book_url").notNull(),
    addressBookName: text("address_book_name").notNull().default(""),
    /** Etiquetas que se sincronizan con este servicio */
    tagIds: jsonb("tag_ids").$type<string[]>().notNull().default([]),
    /** Etiqueta que reciben los contactos creados en el servicio */
    newTagId: uuid("new_tag_id").references(() => tags.id, { onDelete: "set null" }),
    /** Minutos entre sincronizaciones automáticas (0 = solo a mano) */
    intervalMin: integer("interval_min").notNull().default(15),
    enabled: boolean("enabled").notNull().default(true),
    /** ¿Se hizo ya la primera sincronización (con su vista previa)? */
    initialized: boolean("initialized").notNull().default(false),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    /** ok · error · running */
    lastStatus: text("last_status").notNull().default(""),
    lastError: text("last_error").notNull().default(""),
    lastSummary: jsonb("last_summary").$type<Record<string, number>>(),
    ...timestamps,
  },
  (t) => [index("sync_accounts_user_idx").on(t.userId)],
);

export const syncLinks = pgTable(
  "sync_links",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => syncAccounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    href: text("href").notNull(),
    etag: text("etag").notNull().default(""),
    uid: text("uid").notNull(),
    /** Huella de lo que se envió/recibió la última vez desde Agendario */
    localHash: text("local_hash").notNull().default(""),
    /** Huella de la foto del servicio (para no volver a guardarla si no cambia) */
    remotePhotoHash: text("remote_photo_hash").notNull().default(""),
    /** Propiedades del vCard que Agendario no maneja (se conservan al reenviarlo) */
    extra: text("extra").notNull().default(""),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.contactId] }), uniqueIndex("sync_links_href_idx").on(t.accountId, t.href)],
);
