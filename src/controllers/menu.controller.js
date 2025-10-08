// src/controllers/menu.controller.js
import { pool } from "../lib/db.js";
import { customAlphabet } from "nanoid";
import { saveMenuBuffer } from "../lib/upload.js";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

function slugify(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "cat";
}

/* ================= CATEGORÍAS ================= */

export async function listCategories(_req, res) {
  const rs = await pool.query(`
    SELECT id, name, slug, sort_order AS "sortOrder", created_at AS "createdAt"
    FROM menu_categories
    ORDER BY sort_order ASC, created_at ASC
  `);
  // "Todos" es virtual desde el front
  res.json(rs.rows);
}

export async function createCategory(req, res) {
  const { name, sortOrder } = req.body || {};
  if (!name || String(name).trim().length < 2) {
    return res.status(400).json({ error: "Nombre de categoría inválido" });
  }
  const id = nano();
  const slug = slugify(name);
  const order = Number.isFinite(+sortOrder) ? +sortOrder : 100;
  try {
    const rs = await pool.query(
      `
      INSERT INTO menu_categories (id, name, slug, sort_order)
      VALUES ($1,$2,$3,$4)
      RETURNING id, name, slug, sort_order AS "sortOrder", created_at AS "createdAt"
    `,
      [id, String(name).trim(), slug, order]
    );
    res.status(201).json(rs.rows[0]);
  } catch (e) {
    if (e && String(e.message || "").includes("unique") && String(e.message).includes("slug")) {
      return res.status(409).json({ error: "Ya existe una categoría con un nombre similar" });
    }
    console.error(e);
    res.status(500).json({ error: "error creando categoría" });
  }
}

export async function updateCategory(req, res) {
  const { id } = req.params || {};
  const { name, sortOrder } = req.body || {};
  if (!id) return res.status(400).json({ error: "id requerido" });

  const fields = [];
  const params = [];
  if (name) {
    params.push(String(name).trim());
    fields.push(`name=$${params.length}`);
    params.push(slugify(name));
    fields.push(`slug=$${params.length}`);
  }
  if (sortOrder != null) {
    params.push(+sortOrder);
    fields.push(`sort_order=$${params.length}`);
  }
  if (fields.length === 0) return res.status(400).json({ error: "Nada para actualizar" });

  params.push(id);
  const sql = `UPDATE menu_categories SET ${fields.join(",")}
               WHERE id=$${params.length}
               RETURNING id, name, slug, sort_order AS "sortOrder", created_at AS "createdAt"`;

  try {
    const rs = await pool.query(sql, params);
    if (!rs.rowCount) return res.status(404).json({ error: "Categoría no encontrada" });
    res.json(rs.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "error actualizando categoría" });
  }
}

export async function deleteCategory(req, res) {
  const { id } = req.params || {};
  if (!id) return res.status(400).json({ error: "id requerido" });
  try {
    const del = await pool.query(`DELETE FROM menu_categories WHERE id=$1 RETURNING id`, [id]);
    if (!del.rowCount) return res.status(404).json({ error: "Categoría no encontrada" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "error eliminando categoría" });
  }
}

/* ================= ÍTEMS ================= */

export async function listItems(req, res) {
  const { q, category_id } = req.query || {};
  const params = [];
  let sql = `
    SELECT
      i.id, i.name, i.price::float AS price, i.image_url AS "imageUrl",
      i.active, i.sort_order AS "sortOrder", i.created_at AS "createdAt",
      c.id AS "categoryId", c.name AS "categoryName", c.slug AS "categorySlug"
    FROM menu_items i
    LEFT JOIN menu_categories c ON c.id = i.category_id
    WHERE 1=1
  `;
  if (category_id) {
    params.push(category_id);
    sql += ` AND i.category_id=$${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    sql += ` AND (i.name ILIKE $${params.length})`;
  }
  sql += ` ORDER BY i.sort_order ASC, i.created_at DESC LIMIT 500`;
  const rs = await pool.query(sql, params);
  res.json(rs.rows);
}

export async function createItem(req, res) {
  const { name, price, categoryId, sortOrder, active } = req.body || {};
  if (!name || !Number.isFinite(+price)) {
    return res.status(400).json({ error: "Nombre y precio son requeridos" });
  }

  // Imagen opcional vía multer.single("image")
  const file = req.file;
  let imageUrl = null;
  if (file?.buffer) {
    const ext =
      file.mimetype === "image/png" ? ".png" :
      file.mimetype === "image/webp" ? ".webp" :
      ".jpg"; // default jpeg
    const saved = saveMenuBuffer(file.buffer, ext);
    imageUrl = saved.publicUrl; // p.ej. /uploads/menu/xxx.png (SIN /api)
  }

  const id = nano();
  const params = [
    id,
    categoryId || null,
    String(name).trim(),
    +(+price).toFixed(2),
    imageUrl,
    active != null ? !!active : true,
    Number.isFinite(+sortOrder) ? +sortOrder : 100,
  ];

  try {
    const rs = await pool.query(
      `
      INSERT INTO menu_items (id, category_id, name, price, image_url, active, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id, name, price::float AS price, image_url AS "imageUrl",
                active, sort_order AS "sortOrder", created_at AS "createdAt",
                category_id AS "categoryId"
    `,
      params
    );
    res.status(201).json(rs.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "error creando ítem" });
  }
}

export async function updateItem(req, res) {
  const { id } = req.params || {};
  if (!id) return res.status(400).json({ error: "id requerido" });

  const { name, price, categoryId, sortOrder, active } = req.body || {};
  const file = req.file;

  const fields = [];
  const params = [];

  if (name) {
    params.push(String(name).trim());
    fields.push(`name=$${params.length}`);
  }
  if (price != null && Number.isFinite(+price)) {
    params.push(+(+price).toFixed(2));
    fields.push(`price=$${params.length}`);
  }
  if (categoryId !== undefined) {
    params.push(categoryId || null);
    fields.push(`category_id=$${params.length}`);
  }
  if (sortOrder != null) {
    params.push(+sortOrder);
    fields.push(`sort_order=$${params.length}`);
  }
  if (active != null) {
    params.push(!!active);
    fields.push(`active=$${params.length}`);
  }

  if (file?.buffer) {
    const ext =
      file.mimetype === "image/png" ? ".png" :
      file.mimetype === "image/webp" ? ".webp" :
      ".jpg";
    const saved = saveMenuBuffer(file.buffer, ext);
    params.push(saved.publicUrl);
    fields.push(`image_url=$${params.length}`);
  }

  if (fields.length === 0) return res.status(400).json({ error: "Nada para actualizar" });

  params.push(id);
  const sql = `UPDATE menu_items SET ${fields.join(",")}
               WHERE id=$${params.length}
               RETURNING id, name, price::float AS price, image_url AS "imageUrl",
                         active, sort_order AS "sortOrder", created_at AS "CreatedAt",
                         category_id AS "categoryId"`;
  try {
    const rs = await pool.query(sql, params);
    if (!rs.rowCount) return res.status(404).json({ error: "Ítem no encontrado" });
    res.json(rs.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "error actualizando ítem" });
  }
}

export async function deleteItem(req, res) {
  const { id } = req.params || {};
  if (!id) return res.status(400).json({ error: "id requerido" });
  try {
    const del = await pool.query(`DELETE FROM menu_items WHERE id=$1 RETURNING id`, [id]);
    if (!del.rowCount) return res.status(404).json({ error: "Ítem no encontrado" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "error eliminando ítem" });
  }
}
