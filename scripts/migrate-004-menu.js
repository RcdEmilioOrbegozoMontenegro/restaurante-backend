// scripts/migrate-004-menu.js
import "dotenv/config";
import { pool } from "../src/lib/db.js";
import { customAlphabet } from "nanoid";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

async function up() {
  // Categorías
  await pool.query(`
    CREATE TABLE IF NOT EXISTS menu_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      sort_order INT NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Ítems
  await pool.query(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      category_id TEXT REFERENCES menu_categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL DEFAULT 0,
      image_url TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INT NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Índices útiles
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
    CREATE INDEX IF NOT EXISTS idx_menu_items_active ON menu_items(active);
  `);

  // Seed de categorías base si no existen
  const base = [
    { name: "Entradas", slug: "entradas", order: 10 },
    { name: "Platos Principales", slug: "platos-principales", order: 20 },
    { name: "Bebidas", slug: "bebidas", order: 30 },
    { name: "Postres", slug: "postres", order: 40 },
  ];
  for (const c of base) {
    await pool.query(
      `INSERT INTO menu_categories (id, name, slug, sort_order)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) DO NOTHING`,
      [nano(), c.name, c.slug, c.order]
    );
  }

  console.log("✅ Migración 004 (menú) aplicada");
}

up().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
