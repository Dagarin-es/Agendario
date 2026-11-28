-- 1.6.0: Mis deseos y listas para regalarme (ocasiones, lista abierta, invitados con enlace personal).
CREATE TABLE IF NOT EXISTS "wishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"title" text NOT NULL,
	"url" text,
	"notes" text DEFAULT '' NOT NULL,
	"price_cents" integer,
	"image_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wishes_user_idx" ON "wishes" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wish_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"kind" text DEFAULT 'occasion' NOT NULL,
	"title" text NOT NULL,
	"emoji" text DEFAULT '🎁' NOT NULL,
	"event_date" date,
	"reveal" boolean DEFAULT true NOT NULL,
	"include_all" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revealed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wish_lists_user_idx" ON "wish_lists" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wish_list_items" (
	"list_id" uuid NOT NULL REFERENCES "wish_lists"("id") ON DELETE cascade,
	"wish_id" uuid NOT NULL REFERENCES "wishes"("id") ON DELETE cascade,
	CONSTRAINT "wish_list_items_list_id_wish_id_pk" PRIMARY KEY("list_id","wish_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wish_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL REFERENCES "wish_lists"("id") ON DELETE cascade,
	"contact_id" uuid REFERENCES "contacts"("id") ON DELETE set null,
	"name" text NOT NULL,
	"token_hash" text,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wish_guests_token_idx" ON "wish_guests" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wish_guests_list_idx" ON "wish_guests" USING btree ("list_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wish_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL REFERENCES "wish_lists"("id") ON DELETE cascade,
	"wish_id" uuid REFERENCES "wishes"("id") ON DELETE set null,
	"title" text NOT NULL,
	"created_by" uuid REFERENCES "wish_guests"("id") ON DELETE set null,
	"kind" text DEFAULT 'solo' NOT NULL,
	"revealed_at" timestamp with time zone,
	"received_gift_id" uuid REFERENCES "gifts_received"("id") ON DELETE set null,
	"image_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wish_claims_wish_idx" ON "wish_claims" USING btree ("wish_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wish_claims_list_idx" ON "wish_claims" USING btree ("list_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wish_claim_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL REFERENCES "wish_claims"("id") ON DELETE cascade,
	"guest_id" uuid REFERENCES "wish_guests"("id") ON DELETE cascade,
	"free_name" text,
	"status" text DEFAULT 'pending' NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wish_claim_people_claim_idx" ON "wish_claim_people" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wish_claim_people_guest_idx" ON "wish_claim_people" USING btree ("guest_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wish_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL REFERENCES "wish_lists"("id") ON DELETE cascade,
	"guest_id" uuid REFERENCES "wish_guests"("id") ON DELETE set null,
	"from_name" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wish_suggestions_list_idx" ON "wish_suggestions" USING btree ("list_id");
