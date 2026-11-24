ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "todoist_id" text;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "todoist_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "todoist_unlinked" boolean DEFAULT false;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interaction_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"interaction_id" uuid,
	"unknown_call_id" uuid,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"file_key" text NOT NULL,
	"has_thumb" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "interaction_attachments" ADD CONSTRAINT "interaction_attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_attachments" ADD CONSTRAINT "interaction_attachments_interaction_id_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."interactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_attachments" ADD CONSTRAINT "interaction_attachments_unknown_call_id_unknown_calls_id_fk" FOREIGN KEY ("unknown_call_id") REFERENCES "public"."unknown_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interaction_attachments_interaction_idx" ON "interaction_attachments" USING btree ("interaction_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interaction_attachments_unknown_idx" ON "interaction_attachments" USING btree ("unknown_call_id");
