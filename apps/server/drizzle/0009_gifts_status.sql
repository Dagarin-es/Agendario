ALTER TABLE "gift_ideas" ADD COLUMN "status" text DEFAULT 'idea' NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_ideas" ADD COLUMN "event_key" text;--> statement-breakpoint
ALTER TABLE "gift_ideas" ADD COLUMN "event_label" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "gift_ideas" SET "status" = 'given' WHERE "given" = true;
