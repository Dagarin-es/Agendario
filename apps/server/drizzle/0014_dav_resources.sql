CREATE TABLE "dav_resources" (
	"contact_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dav_resources" ADD CONSTRAINT "dav_resources_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dav_resources_name_idx" ON "dav_resources" USING btree ("name");