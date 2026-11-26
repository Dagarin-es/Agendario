-- Regalos recibidos de varias personas (1.3.2): enlace regalo ↔ contactos.
-- gifts_received.contact_id se conserva (primer contacto, por compatibilidad) pero ya no borra el regalo.
CREATE TABLE IF NOT EXISTS "gift_received_contacts" (
	"gift_id" uuid NOT NULL REFERENCES "gifts_received"("id") ON DELETE cascade,
	"contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE cascade,
	CONSTRAINT "gift_received_contacts_gift_id_contact_id_pk" PRIMARY KEY("gift_id","contact_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_received_contacts_contact_idx" ON "gift_received_contacts" USING btree ("contact_id");--> statement-breakpoint
INSERT INTO "gift_received_contacts" ("gift_id", "contact_id")
	SELECT "id", "contact_id" FROM "gifts_received" WHERE "contact_id" IS NOT NULL
	ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "gifts_received" ALTER COLUMN "contact_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gifts_received" DROP CONSTRAINT IF EXISTS "gifts_received_contact_id_contacts_id_fk";--> statement-breakpoint
ALTER TABLE "gifts_received" ADD CONSTRAINT "gifts_received_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Si un regalo se queda sin ninguna persona (se borró el último contacto), se borra
CREATE OR REPLACE FUNCTION "gift_received_orphan_cleanup"() RETURNS trigger AS $$
BEGIN
	DELETE FROM "gifts_received" g WHERE g."id" = OLD."gift_id"
		AND NOT EXISTS (SELECT 1 FROM "gift_received_contacts" l WHERE l."gift_id" = OLD."gift_id");
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gift_received_contacts_orphan" ON "gift_received_contacts";--> statement-breakpoint
CREATE TRIGGER "gift_received_contacts_orphan" AFTER DELETE ON "gift_received_contacts"
	FOR EACH ROW EXECUTE FUNCTION "gift_received_orphan_cleanup"();
--> statement-breakpoint
-- Ideas de regalo: fecha del evento aparte de la fecha en que se regaló (al regalar se pregunta el día real)
ALTER TABLE "gift_ideas" ADD COLUMN IF NOT EXISTS "event_date" date;--> statement-breakpoint
UPDATE "gift_ideas" SET "event_date" = "given_at" WHERE "event_date" IS NULL AND "event_key" IS NOT NULL AND "status" <> 'idea';
