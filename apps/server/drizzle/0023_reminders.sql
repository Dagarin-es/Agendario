ALTER TABLE "contacts" ADD COLUMN "mobile_name" text DEFAULT 'full';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"contact_id" uuid,
	"kind" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unknown_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"number" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unknown_calls" ADD CONSTRAINT "unknown_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminders_user_idx" ON "reminders" USING btree ("user_id","done_at","due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unknown_calls_user_idx" ON "unknown_calls" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unknown_calls_external_idx" ON "unknown_calls" USING btree ("user_id","external_id");
