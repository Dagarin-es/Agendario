ALTER TABLE "sessions" ADD COLUMN "media_id" text;--> statement-breakpoint
CREATE INDEX "sessions_media_idx" ON "sessions" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE "app_passwords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"hint" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_passwords" ADD CONSTRAINT "app_passwords_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_passwords_user_idx" ON "app_passwords" USING btree ("user_id");
