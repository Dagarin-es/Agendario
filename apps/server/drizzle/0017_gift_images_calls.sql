ALTER TABLE "gift_ideas" ADD COLUMN "image_key" text;--> statement-breakpoint
ALTER TABLE "interactions" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "interactions_external_idx" ON "interactions" ("user_id","external_id");
