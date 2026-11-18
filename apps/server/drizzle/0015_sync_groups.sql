CREATE TABLE "sync_group_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"tag_id" uuid,
	"href" text NOT NULL,
	"uid" text NOT NULL,
	"etag" text DEFAULT '' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"members" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_group_links" ADD CONSTRAINT "sync_group_links_account_id_sync_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."sync_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_group_links" ADD CONSTRAINT "sync_group_links_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_group_links_href_idx" ON "sync_group_links" USING btree ("account_id","href");