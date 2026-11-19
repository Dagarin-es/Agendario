ALTER TABLE "contacts" ADD COLUMN "cover_key" text;--> statement-breakpoint
CREATE TABLE "personal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"date" text NOT NULL,
	"emoji" text,
	"yearly" boolean DEFAULT true NOT NULL,
	"description" text,
	"comment" text,
	"photo_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "personal_events" ADD CONSTRAINT "personal_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personal_events_user_idx" ON "personal_events" USING btree ("user_id");
