import { and, desc, eq } from "drizzle-orm";
import { contactPrefsSchema, userPrefsSchema, type ContactPrefs, type Interaction, type InteractionAttachment, type UserPrefs } from "@agendario/shared";
import { db, schema } from "../db/index.js";
import { attachmentsFor } from "./attachments.js";

const i = schema.interactions;

export function toInteraction(r: typeof i.$inferSelect, attachments: InteractionAttachment[] = []): Interaction {
  return {
    id: r.id,
    contactId: r.contactId,
    kind: r.kind as Interaction["kind"],
    occurredAt: r.occurredAt.toISOString(),
    durationMin: r.durationMin,
    channel: r.channel,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    attachments,
  };
}

/** Llamadas y apuntes de un usuario con un contacto (los más recientes primero). */
export async function interactionsOf(userId: string, contactId: string) {
  const rows = await db
    .select()
    .from(i)
    .where(and(eq(i.userId, userId), eq(i.contactId, contactId)))
    .orderBy(desc(i.occurredAt))
    .limit(500);
  const atts = await attachmentsFor(rows.map((r) => r.id));
  return rows.map((r) => toInteraction(r, atts.get(r.id)));
}

export async function contactPrefsOf(userId: string, contactId: string): Promise<ContactPrefs> {
  const [r] = await db
    .select({ prefs: schema.contactPrefs.prefs })
    .from(schema.contactPrefs)
    .where(and(eq(schema.contactPrefs.userId, userId), eq(schema.contactPrefs.contactId, contactId)));
  return contactPrefsSchema.parse(r?.prefs ?? {});
}

export async function userPrefsOf(userId: string): Promise<UserPrefs> {
  const [r] = await db.select({ prefs: schema.userPrefs.prefs }).from(schema.userPrefs).where(eq(schema.userPrefs.userId, userId));
  const parsed = userPrefsSchema.safeParse(r?.prefs ?? {});
  return parsed.success ? parsed.data : userPrefsSchema.parse({});
}
