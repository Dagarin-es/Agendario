-- 1.5.0: valoración (0-10 medias estrellas) y anotación al regalar; valoración y foto de los regalos recibidos.
ALTER TABLE "gift_ideas" ADD COLUMN IF NOT EXISTS "rating" smallint;--> statement-breakpoint
ALTER TABLE "gift_ideas" ADD COLUMN IF NOT EXISTS "given_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gifts_received" ADD COLUMN IF NOT EXISTS "rating" smallint;--> statement-breakpoint
ALTER TABLE "gifts_received" ADD COLUMN IF NOT EXISTS "image_key" text;
