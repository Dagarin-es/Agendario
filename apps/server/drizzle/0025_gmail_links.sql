CREATE TABLE IF NOT EXISTS "gmail_links" (
	"user_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"resource_name" text NOT NULL,
	"etag" text DEFAULT '' NOT NULL,
	"hash" text DEFAULT '' NOT NULL,
	"photo_key" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_links_user_id_contact_id_pk" PRIMARY KEY("user_id","contact_id")
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gmail_links" ADD CONSTRAINT "gmail_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
