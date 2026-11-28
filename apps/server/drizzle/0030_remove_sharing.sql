-- 1.6.0: Agendario pasa a ser un gestor personal: fuera compartir contactos y grupos.
-- Cada contacto sigue siendo de su dueño (no se borra ningún contacto); solo desaparecen los permisos de compartir.
DO $$
DECLARE n_shared integer := 0;
BEGIN
	IF to_regclass('public.contact_shares') IS NOT NULL THEN
		SELECT count(*) INTO n_shared FROM "contact_shares";
	END IF;
	IF n_shared > 0 THEN
		RAISE NOTICE 'Agendario 1.6.0: se quitan % permisos de compartir (los contactos siguen siendo de su dueño)', n_shared;
	END IF;
END $$;--> statement-breakpoint
DROP TABLE IF EXISTS "contact_shares";--> statement-breakpoint
DROP TABLE IF EXISTS "group_members";--> statement-breakpoint
DROP TABLE IF EXISTS "groups";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "visibility";--> statement-breakpoint
DROP TYPE IF EXISTS "visibility";--> statement-breakpoint
DROP TYPE IF EXISTS "permission";--> statement-breakpoint
-- Regalos recibidos: también de personas que solo son un nombre (sin contacto), p. ej. desde una lista de deseos
ALTER TABLE "gifts_received" ADD COLUMN IF NOT EXISTS "from_names" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "gift_received_orphan_cleanup"() RETURNS trigger AS $$
BEGIN
	DELETE FROM "gifts_received" g WHERE g."id" = OLD."gift_id"
		AND jsonb_array_length(g."from_names") = 0
		AND NOT EXISTS (SELECT 1 FROM "gift_received_contacts" l WHERE l."gift_id" = OLD."gift_id");
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
