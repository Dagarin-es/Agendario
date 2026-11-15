CREATE TABLE "duplicate_dismissals" (
	"user_id" uuid NOT NULL,
	"a_id" uuid NOT NULL,
	"b_id" uuid NOT NULL,
	CONSTRAINT "duplicate_dismissals_user_id_a_id_b_id_pk" PRIMARY KEY("user_id","a_id","b_id")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "merged_uids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "duplicate_dismissals" ADD CONSTRAINT "duplicate_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_dismissals" ADD CONSTRAINT "duplicate_dismissals_a_id_contacts_id_fk" FOREIGN KEY ("a_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_dismissals" ADD CONSTRAINT "duplicate_dismissals_b_id_contacts_id_fk" FOREIGN KEY ("b_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;