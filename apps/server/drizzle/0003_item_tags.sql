CREATE TABLE "contact_item_tags" (
	"user_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "contact_item_tags_user_id_contact_id_item_id_pk" PRIMARY KEY("user_id","contact_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "contact_item_tags" ADD CONSTRAINT "contact_item_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_item_tags" ADD CONSTRAINT "contact_item_tags_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_item_tags" ADD CONSTRAINT "contact_item_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_item_tags_tag_idx" ON "contact_item_tags" USING btree ("tag_id");