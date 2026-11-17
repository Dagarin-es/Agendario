#!/usr/bin/env bash
# Agendario · Limpieza de teléfonos y etiquetas de teléfonos/emails
#
#  - Teléfonos: quita espacios, guiones, puntos y paréntesis, y el prefijo +34 / 0034 de los
#    números españoles (9 cifras). Los de otros países conservan su prefijo, sin espacios.
#  - Etiquetas de teléfonos y emails: primera letra en mayúscula y con tilde (movil → Móvil).
#  - Primero enseña qué va a cambiar; solo aplica si respondes «s».
#  - Antes de aplicar hace una copia completa de la base de datos.
#  - Cada contacto cambiado queda en su Historial (se puede deshacer desde ahí).
#
# Uso:  bash limpiar-telefonos.sh
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-agendario-db}"
BACKUP_DIR="${BACKUP_DIR:-/opt/agendario/data/app/backups}"
PSQL=(docker exec -i "$DB_CONTAINER" psql -U agendario -d agendario -v ON_ERROR_STOP=1 -q)

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "No encuentro el contenedor $DB_CONTAINER en marcha. ¿Está Agendario arrancado?" >&2
  exit 1
fi

# Funciones auxiliares (solo viven durante la sesión de psql)
FUNCS=$(cat <<'SQL'
CREATE FUNCTION pg_temp.fix_phone(x text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v ~ '^(\+|00)34[0-9]{9}$' THEN regexp_replace(v, '^(\+|00)34', '') ELSE v END
  FROM (SELECT regexp_replace(coalesce(x, ''), '[[:space:]' || chr(160) || '.()/-]', '', 'g') AS v) s
$$;

CREATE FUNCTION pg_temp.fix_label(x text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN t = '' THEN ''
    WHEN l IN ('movil', 'móvil', 'mobile', 'cell', 'celular', 'iphone') THEN 'Móvil'
    WHEN l IN ('telefono', 'teléfono', 'phone', 'voice') THEN 'Teléfono'
    WHEN l IN ('casa', 'home', 'hogar') THEN 'Casa'
    WHEN l IN ('trabajo', 'work', 'empresa') THEN 'Trabajo'
    WHEN l IN ('oficina', 'office') THEN 'Oficina'
    WHEN l IN ('otro', 'other', 'otros') THEN 'Otro'
    WHEN l IN ('principal', 'main', 'pref') THEN 'Principal'
    WHEN l IN ('fax', 'fax trabajo', 'work fax') THEN 'Fax'
    WHEN l IN ('busca', 'pager') THEN 'Busca'
    WHEN l IN ('personal') THEN 'Personal'
    WHEN l IN ('particular') THEN 'Particular'
    WHEN l IN ('estudios', 'school') THEN 'Estudios'
    WHEN l IN ('facturacion', 'facturación') THEN 'Facturación'
    WHEN l IN ('administracion', 'administración') THEN 'Administración'
    WHEN l IN ('direccion', 'dirección') THEN 'Dirección'
    WHEN l IN ('recepcion', 'recepción') THEN 'Recepción'
    WHEN l IN ('atencion al cliente', 'atención al cliente') THEN 'Atención al cliente'
    WHEN l IN ('centralita') THEN 'Centralita'
    ELSE upper(left(t, 1)) || substr(t, 2)
  END
  FROM (SELECT trim(coalesce(x, '')) AS t, lower(trim(coalesce(x, ''))) AS l) s
$$;

CREATE FUNCTION pg_temp.fix_list(arr jsonb, phones boolean) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_agg(
           jsonb_set(
             CASE WHEN phones THEN jsonb_set(e, '{value}', to_jsonb(pg_temp.fix_phone(e->>'value'))) ELSE e END,
             '{label}', to_jsonb(pg_temp.fix_label(e->>'label'))
           ) ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(coalesce(arr, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
$$;

CREATE TEMP TABLE cambios AS
  SELECT id, display_name, phones AS old_phones, emails AS old_emails,
         pg_temp.fix_list(phones, true) AS new_phones,
         pg_temp.fix_list(emails, false) AS new_emails
  FROM contacts
  WHERE deleted_at IS NULL;
DELETE FROM cambios WHERE old_phones = new_phones AND old_emails = new_emails;
SQL
)

echo "== Agendario · limpieza de teléfonos y etiquetas =="
echo
"${PSQL[@]}" <<SQL
$FUNCS
\pset footer off
SELECT count(*) AS "Contactos que cambian" FROM cambios;
\echo
\echo 'Ejemplos de teléfonos (antes → después):'
SELECT display_name AS "Contacto", o->>'value' AS "Antes", n->>'value' AS "Después"
FROM cambios, jsonb_array_elements(old_phones) WITH ORDINALITY a(o, i)
JOIN jsonb_array_elements(new_phones) WITH ORDINALITY b(n, j) ON i = j
WHERE o->>'value' IS DISTINCT FROM n->>'value'
LIMIT 15;
\echo 'Etiquetas que cambian (cuántas veces):'
SELECT o->>'label' AS "Antes", n->>'label' AS "Después", count(*) AS "Veces"
FROM cambios,
     LATERAL (SELECT * FROM jsonb_array_elements(old_phones) WITH ORDINALITY a(o, i)
              JOIN jsonb_array_elements(new_phones) WITH ORDINALITY b(n, j) ON i = j
              UNION ALL
              SELECT * FROM jsonb_array_elements(old_emails) WITH ORDINALITY a(o, i)
              JOIN jsonb_array_elements(new_emails) WITH ORDINALITY b(n, j) ON i = j) x
WHERE o->>'label' IS DISTINCT FROM n->>'label'
GROUP BY 1, 2 ORDER BY 3 DESC;
SQL

echo
read -r -p "¿Aplicar estos cambios? (s/N): " ok
[[ "${ok,,}" == "s" ]] || { echo "No se ha cambiado nada."; exit 0; }

mkdir -p "$BACKUP_DIR"
DUMP="$BACKUP_DIR/antes-de-limpiar-telefonos-$(date +%Y-%m-%d_%H%M).dump"
echo "Copia de seguridad de la base de datos en $DUMP …"
docker exec "$DB_CONTAINER" pg_dump -U agendario -d agendario -Fc > "$DUMP"

"${PSQL[@]}" <<SQL
$FUNCS
BEGIN;
-- Historial: un apunte por contacto, para poder deshacerlo desde la app
INSERT INTO contact_history (contact_id, user_id, action, changes, snapshot, meta)
SELECT c.id, NULL, 'update',
  (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
     SELECT jsonb_build_object('field', 'phones', 'before', ch.old_phones, 'after', ch.new_phones) AS x WHERE ch.old_phones <> ch.new_phones
     UNION ALL
     SELECT jsonb_build_object('field', 'emails', 'before', ch.old_emails, 'after', ch.new_emails) WHERE ch.old_emails <> ch.new_emails) s),
  jsonb_build_object(
    'displayName', c.display_name, 'givenName', c.given_name, 'familyName', c.family_name, 'nickname', c.nickname,
    'organization', c.organization, 'organizationContactId', c.organization_contact_id, 'jobTitle', c.job_title,
    'birthday', c.birthday, 'phones', ch.new_phones, 'emails', ch.new_emails, 'urls', c.urls, 'addresses', c.addresses,
    'notes', c.notes, 'photoKey', c.photo_key, 'visibility', c.visibility),
  '{"source": "Limpieza de teléfonos y etiquetas"}'::jsonb
FROM contacts c JOIN cambios ch ON ch.id = c.id;

UPDATE contacts c
SET phones = ch.new_phones, emails = ch.new_emails, updated_at = now(), revision = c.revision + 1
FROM cambios ch WHERE ch.id = c.id;

-- Lista de etiquetas de cada usuario (las que se ofrecen en el formulario)
UPDATE user_prefs
SET prefs = jsonb_set(jsonb_set(prefs,
      '{itemLabels,phones}', (SELECT coalesce(jsonb_agg(DISTINCT pg_temp.fix_label(v)), '[]'::jsonb) FROM jsonb_array_elements_text(prefs->'itemLabels'->'phones') v WHERE trim(v) <> '')),
      '{itemLabels,emails}', (SELECT coalesce(jsonb_agg(DISTINCT pg_temp.fix_label(v)), '[]'::jsonb) FROM jsonb_array_elements_text(prefs->'itemLabels'->'emails') v WHERE trim(v) <> ''))
WHERE prefs->'itemLabels' ? 'phones' AND prefs->'itemLabels' ? 'emails';
COMMIT;
\pset footer off
SELECT count(*) AS "Contactos actualizados" FROM cambios;
SQL

echo
echo "Hecho. Recarga Agendario en el navegador."
echo "Si algo no te convence, cada contacto tiene el cambio en su Historial (Deshacer)."
echo "Para volver atrás del todo:"
echo "  docker stop agendario && docker exec -i $DB_CONTAINER pg_restore -U agendario -d agendario --clean --if-exists < \"$DUMP\" && docker start agendario"
