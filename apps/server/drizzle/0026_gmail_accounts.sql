-- Varias cuentas de Google por usuario (1.3.1): la conexión que ya hubiera pasa a ser la cuenta «main»
ALTER TABLE "gmail_links" ADD COLUMN IF NOT EXISTS "account_id" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "gmail_links" DROP CONSTRAINT IF EXISTS "gmail_links_user_id_contact_id_pk";--> statement-breakpoint
ALTER TABLE "gmail_links" ADD CONSTRAINT "gmail_links_user_id_account_id_contact_id_pk" PRIMARY KEY("user_id","account_id","contact_id");
