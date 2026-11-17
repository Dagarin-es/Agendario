CREATE TABLE "sync_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"server_url" text NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"address_book_url" text NOT NULL,
	"address_book_name" text DEFAULT '' NOT NULL,
	"tag_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"new_tag_id" uuid,
	"interval_min" integer DEFAULT 15 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"initialized" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_status" text DEFAULT '' NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"last_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_links" (
	"account_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"href" text NOT NULL,
	"etag" text DEFAULT '' NOT NULL,
	"uid" text NOT NULL,
	"local_hash" text DEFAULT '' NOT NULL,
	"remote_photo_hash" text DEFAULT '' NOT NULL,
	"extra" text DEFAULT '' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_links_account_id_contact_id_pk" PRIMARY KEY("account_id","contact_id")
);
--> statement-breakpoint
ALTER TABLE "sync_accounts" ADD CONSTRAINT "sync_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_accounts" ADD CONSTRAINT "sync_accounts_new_tag_id_tags_id_fk" FOREIGN KEY ("new_tag_id") REFERENCES "public"."tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_links" ADD CONSTRAINT "sync_links_account_id_sync_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."sync_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_links" ADD CONSTRAINT "sync_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_accounts_user_idx" ON "sync_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_links_href_idx" ON "sync_links" USING btree ("account_id","href");