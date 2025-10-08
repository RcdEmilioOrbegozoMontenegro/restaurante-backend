// scripts/migrate-005-fix-menu-image-urls.js
import "dotenv/config";
import { pool } from "../src/lib/db.js";

async function run() {
  console.log("🚀 Iniciando migración 005: Fix image_url de menu_items");

  const stats = async (label) => {
    const r = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE image_url IS NULL)::int AS nulls,
        COUNT(*) FILTER (WHERE image_url ~* '^https?://')::int AS absolutes,
        COUNT(*) FILTER (WHERE image_url ~* '^/uploads/')::int AS uploads,
        COUNT(*) FILTER (
          WHERE image_url IS NOT NULL
            AND image_url !~* '^(https?://|/uploads/)'
        )::int AS invalid
      FROM menu_items;
    `);
    console.log(`📊 ${label}:`, r.rows[0]);
  };

  await stats("Antes");

  try {
    await pool.query("BEGIN");

    // (a) /api/uploads/...  -> /uploads/...
    const a = await pool.query(`
      UPDATE menu_items
      SET image_url = regexp_replace(image_url, '^/api(?=/uploads/)', '', 'i')
      WHERE image_url ~* '^/api/uploads/';
    `);
    console.log(`🔧 Normalizados /api/uploads → /uploads: ${a.rowCount}`);

    // (b) /api/LO-QUE-SEA (que NO sea uploads) -> NULL
    const b = await pool.query(`
      UPDATE menu_items
      SET image_url = NULL
      WHERE image_url ~* '^/api/(?!uploads/)';
    `);
    console.log(`🧹 Anulados /api/ que no son imágenes: ${b.rowCount}`);

    // (c) Cualquier otra cosa rara que no sea http(s):// ni /uploads/... -> NULL
    const c = await pool.query(`
      UPDATE menu_items
      SET image_url = NULL
      WHERE image_url IS NOT NULL
        AND image_url !~* '^(https?://|/uploads/)';
    `);
    console.log(`🧽 Anulados no válidos restantes: ${c.rowCount}`);

    // (d) Constraint para no volver a guardar rutas malas
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'menu_items_image_url_valid_chk'
        ) THEN
          ALTER TABLE menu_items
          ADD CONSTRAINT menu_items_image_url_valid_chk
          CHECK (image_url IS NULL OR image_url ~* '^(https?://|/uploads/)');
        END IF;
      END $$;
    `);
    console.log("✅ Constraint menu_items_image_url_valid_chk aplicado (o ya existía)");

    await pool.query("COMMIT");
  } catch (e) {
    console.error("❌ Error en migración 005:", e);
    try { await pool.query("ROLLBACK"); } catch {}
    process.exit(1);
  }

  await stats("Después");

  // Tip: muestra una muestra de filas sin imagen para re-subir
  const sample = await pool.query(`
    SELECT id, name, image_url
    FROM menu_items
    WHERE image_url IS NULL
    ORDER BY created_at DESC
    LIMIT 10;
  `);
  if (sample.rowCount) {
    console.log("📝 Muestra de ítems sin imagen (re-subir desde admin):");
    for (const r of sample.rows) console.log(` - ${r.id} :: ${r.name}`);
  } else {
    console.log("✅ No hay ítems sin imagen.");
  }

  await pool.end();
  console.log("🏁 Migración 005 finalizada.");
}

run();
