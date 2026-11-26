-- 1.4.0: favoritos (personales por usuario, como las etiquetas) y 10 colores de etiqueta nuevos.
CREATE TABLE IF NOT EXISTS "contact_favorites" (
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_favorites_user_id_contact_id_pk" PRIMARY KEY("user_id","contact_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_favorites_contact_idx" ON "contact_favorites" USING btree ("contact_id");--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE IF NOT EXISTS 'navy';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE IF NOT EXISTS 'lime';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE IF NOT EXISTS 'forest';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE IF NOT EXISTS 'turquoise';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE IF NOT EXISTS 'cyan';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE IF NOT EXISTS 'eggplant';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE IF NOT EXISTS 'fuchsia';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE IF NOT EXISTS 'maroon';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE IF NOT EXISTS 'brown';--> statement-breakpoint
ALTER TYPE "public"."tag_color" ADD VALUE IF NOT EXISTS 'black';
