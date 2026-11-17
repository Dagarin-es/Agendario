CREATE TABLE "sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"action" text NOT NULL,
	"contact_id" uuid,
	"contact_name" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_account_id_sync_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."sync_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_log_account_at_idx" ON "sync_log" USING btree ("account_id","at");