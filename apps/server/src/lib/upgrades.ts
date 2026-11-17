/**
 * Ajustes de datos que se hacen una sola vez al actualizar (quedan apuntados en «settings»).
 */
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

const upgrades: { key: string; run: () => Promise<unknown> }[] = [
  {
    // 0.11: las relaciones pasan a ser recíprocas; se completan las que ya existían
    key: "upgrade.reciprocal_relationships",
    run: () =>
      db.execute(sql`
        INSERT INTO relationships (contact_id, related_contact_id, type)
        SELECT r.related_contact_id, r.contact_id,
          (CASE r.type::text
             WHEN 'parent' THEN 'child' WHEN 'child' THEN 'parent'
             WHEN 'grandparent' THEN 'grandchild' WHEN 'grandchild' THEN 'grandparent'
             WHEN 'boss' THEN 'reports_to' WHEN 'reports_to' THEN 'boss'
             ELSE r.type::text END)::relationship_type
        FROM relationships r
        WHERE NOT EXISTS (
          SELECT 1 FROM relationships x
          WHERE x.contact_id = r.related_contact_id AND x.related_contact_id = r.contact_id
            AND x.type::text = (CASE r.type::text
              WHEN 'parent' THEN 'child' WHEN 'child' THEN 'parent'
              WHEN 'grandparent' THEN 'grandchild' WHEN 'grandchild' THEN 'grandparent'
              WHEN 'boss' THEN 'reports_to' WHEN 'reports_to' THEN 'boss'
              ELSE r.type::text END))`),
  },
  {
    // 0.11: los santos automáticos se desactivan (se pueden volver a activar en Ajustes → Fechas)
    key: "upgrade.saints_off",
    run: () => db.execute(sql`UPDATE user_prefs SET prefs = prefs || '{"autoSaints": false}'::jsonb`),
  },
];

export async function runUpgrades() {
  for (const u of upgrades) {
    const [done] = await db.select({ key: schema.settings.key }).from(schema.settings).where(eq(schema.settings.key, u.key));
    if (done) continue;
    await u.run();
    await db.insert(schema.settings).values({ key: u.key, value: { at: new Date().toISOString() } }).onConflictDoNothing();
    console.log(`Actualización de datos aplicada: ${u.key}`);
  }
}
