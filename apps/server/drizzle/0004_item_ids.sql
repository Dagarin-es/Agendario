-- Da un identificador estable a cada teléfono, email, web y dirección ya existentes
-- (necesario para poder asociar una etiqueta a cada dato).
UPDATE "contacts" SET "phones" = (
  SELECT COALESCE(jsonb_agg(CASE WHEN e ? 'id' THEN e ELSE e || jsonb_build_object('id', gen_random_uuid()::text) END), '[]'::jsonb)
  FROM jsonb_array_elements("phones") e
) WHERE jsonb_array_length("phones") > 0;
--> statement-breakpoint
UPDATE "contacts" SET "emails" = (
  SELECT COALESCE(jsonb_agg(CASE WHEN e ? 'id' THEN e ELSE e || jsonb_build_object('id', gen_random_uuid()::text) END), '[]'::jsonb)
  FROM jsonb_array_elements("emails") e
) WHERE jsonb_array_length("emails") > 0;
--> statement-breakpoint
UPDATE "contacts" SET "urls" = (
  SELECT COALESCE(jsonb_agg(CASE WHEN e ? 'id' THEN e ELSE e || jsonb_build_object('id', gen_random_uuid()::text) END), '[]'::jsonb)
  FROM jsonb_array_elements("urls") e
) WHERE jsonb_array_length("urls") > 0;
--> statement-breakpoint
UPDATE "contacts" SET "addresses" = (
  SELECT COALESCE(jsonb_agg(CASE WHEN e ? 'id' THEN e ELSE e || jsonb_build_object('id', gen_random_uuid()::text) END), '[]'::jsonb)
  FROM jsonb_array_elements("addresses") e
) WHERE jsonb_array_length("addresses") > 0;
