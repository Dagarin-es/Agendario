-- Los contactos enlazados a una empresa muestran el nombre actual de esa empresa
UPDATE "contacts" AS x
SET "organization" = o."display_name"
FROM "contacts" AS o
WHERE x."organization_contact_id" = o."id"
  AND x."organization" IS DISTINCT FROM o."display_name";
