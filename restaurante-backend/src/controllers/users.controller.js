// src/controllers/users.controller.js
import { pool } from "../lib/db.js";
import bcrypt from "bcryptjs";
import { customAlphabet } from "nanoid";
import { z } from "zod";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

/* ========= Schemas ========= */

const createWorkerSchema = z.object({
  fullName: z.string().min(2, "Nombre muy corto").max(100),
  email: z.string().email(),
  password: z.string().min(6, "Mínimo 6 caracteres").max(100),
  phone: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^[0-9+\s-]{6,20}$/.test(v), "Teléfono inválido"),
});

/* ========= Controllers ========= */

// POST /users  (ADMIN)  -> Crea trabajador WORKER
export async function createWorker(req, res) {
  try {
    const parsed = createWorkerSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    }
    const { fullName, email, password, phone } = parsed.data;

    const exists = await pool.query("SELECT 1 FROM users WHERE email=$1", [
      email.toLowerCase(),
    ]);
    if (exists.rowCount)
      return res.status(409).json({ error: "Email ya registrado" });

    const id = nano();
    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users (id, email, password, role, full_name, phone, active)
       VALUES ($1,$2,$3,'WORKER',$4,$5,true)`,
      [id, email.toLowerCase(), hash, fullName, phone || null]
    );

    const rs = await pool.query(
      `SELECT id, email, role, full_name AS "fullName", phone, active,
              employee_no AS "employeeNo", created_at AS "createdAt"
       FROM users WHERE id=$1`,
      [id]
    );

    return res.status(201).json(rs.rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "error creando trabajador" });
  }
}

// GET /users?role=WORKER&q=...  (ADMIN)
export async function listUsers(req, res) {
  try {
    const rawRole = (req.query.role || "WORKER").toString().trim();
    const role = rawRole.toUpperCase();
    const q = req.query.q?.toString().trim();

    const params = [];
    let sql = `
      SELECT
        u.id,
        u.email,
        u.role,
        u.full_name AS "fullName",
        u.phone,
        u.active,
        u.employee_no AS "employeeNo",
        u.created_at AS "createdAt",
        EXISTS (
          SELECT 1
          FROM attendance a
          WHERE a.user_id = u.id
            AND a.marked_at::date = CURRENT_DATE   -- << aquí
        ) AS "hasMarkedToday"
      FROM users u
      WHERE 1=1
    `;

    if (role !== "ALL") {
      params.push(role);
      sql += ` AND UPPER(u.role) = $${params.length}`;
    } else {
      sql += ` AND UPPER(u.role) <> 'ADMIN'`;
    }

    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }

    sql += ` ORDER BY u.created_at DESC LIMIT 500`;

    const rs = await pool.query(sql, params);
    return res.json(rs.rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "error listando usuarios" });
  }
}


// GET /users/export  (ADMIN)  -> CSV
export async function exportUsersCsv(req, res) {
  try {
    const rs = await pool.query(
      `
      SELECT employee_no, full_name, email, phone, active, role, created_at
      FROM users
      WHERE role='WORKER'
      ORDER BY employee_no NULLS LAST, created_at DESC
    `
    );

    const rows = rs.rows;
    const header = [
      "employee_no",
      "full_name",
      "email",
      "phone",
      "active",
      "role",
      "created_at",
    ];
    const lines = [header.join(",")];

    for (const r of rows) {
      const vals = [
        r.employee_no ?? "",
        csvSafe(r.full_name),
        r.email,
        r.phone ?? "",
        r.active ? "1" : "0",
        r.role,
        r.created_at?.toISOString?.() ?? r.created_at,
      ];
      lines.push(
        vals
          .map((v) =>
            typeof v === "string" && /[",\n]/.test(v)
              ? `"${v.replace(/"/g, '""')}"`
              : v
          )
          .join(",")
      );
    }

    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="workers.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "error exportando CSV" });
  }
}

// DELETE /users/:id   (ADMIN)  -> Elimina WORKER y sus asistencias
export async function deleteUser(req, res) {
  const { id } = req.params || {};
  if (!id) return res.status(400).json({ error: "id requerido" });

  try {
    await pool.query("BEGIN");

    // Borra asistencias primero (si no tienes FK con ON DELETE CASCADE)
    await pool.query("DELETE FROM attendance WHERE user_id=$1", [id]);

    // Evita eliminar administradores
    const del = await pool.query(
      "DELETE FROM users WHERE id=$1 AND role='WORKER' RETURNING id",
      [id]
    );

    await pool.query("COMMIT");

    if (!del.rowCount) {
      return res
        .status(404)
        .json({ error: "Usuario no encontrado o no es WORKER" });
    }
    return res.json({ ok: true });
  } catch (e) {
    await pool.query("ROLLBACK");
    console.error(e);
    return res.status(500).json({ error: "error eliminando usuario" });
  }
}

// GET /users/:id/attendance?limit=30&from=YYYY-MM-DD&to=YYYY-MM-DD  (ADMIN)
export async function getUserAttendance(req, res) {
  try {
    const { id } = req.params || {};
    if (!id) return res.status(400).json({ error: "id requerido" });

    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 30)));
    const from = req.query.from?.toString();
    const to = req.query.to?.toString();

    const params = [id];
    let sql = `
      SELECT id, marked_at
      FROM attendance
      WHERE user_id = $1`;

    if (from) {
      params.push(from);
      sql += ` AND marked_at::date >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      sql += ` AND marked_at::date <= $${params.length}`;
    }

    params.push(limit);
    sql += ` ORDER BY marked_at DESC LIMIT $${params.length}`;

    const rs = await pool.query(sql, params);
    return res.json(rs.rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "error obteniendo asistencias del usuario" });
  }
}
export async function getMyAttendance(req, res) {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: "no auth" })

    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 60)))
    const from = req.query.from?.toString()
    const to = req.query.to?.toString()

    const params = [userId]
    let sql = `
      SELECT id, marked_at
      FROM attendance
      WHERE user_id = $1
    `
    if (from) {
      params.push(from)
      sql += ` AND marked_at::date >= $${params.length}`
    }
    if (to) {
      params.push(to)
      sql += ` AND marked_at::date <= $${params.length}`
    }
    params.push(limit)
    sql += ` ORDER BY marked_at DESC LIMIT $${params.length}`

    const rs = await pool.query(sql, params)
    return res.json(rs.rows)
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: "error obteniendo mis asistencias" })
  }
}


/* ========= Utils ========= */

function csvSafe(s) {
  if (s == null) return "";
  return String(s);
}
