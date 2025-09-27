// src/controllers/reports.controller.js
import { pool } from "../db.js";

/**
 * GET /reports/attendance/summary?from=2025-09-22&to=2025-09-27
 * Devuelve, por día, conteo de puntuales, tardanzas y faltas (ausencias).
 * "Falta" = trabajador WORKER activo sin registro en ese día.
 */
export const attendanceSummary = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ message: "from y to son requeridos (YYYY-MM-DD)" });

    const q = `
      WITH days AS (
        SELECT d::date AS day
        FROM generate_series($1::date, $2::date, '1 day') AS d
      ),
      workers AS (
        SELECT id
        FROM users
        WHERE role = 'WORKER' AND (active IS NULL OR active = TRUE)
      ),
      att AS (
        SELECT
          a.user_id,
          (a.marked_at AT TIME ZONE 'America/Lima')::date AS day,
          -- status ya viene calculado en API; si no existe, backfill simple por hora
          COALESCE(
            a.status,
            CASE
              WHEN w.on_time_until IS NOT NULL AND (a.marked_at::time <= w.on_time_until) THEN 'puntual'
              ELSE 'tardanza'
            END
          ) AS status
        FROM attendance a
        LEFT JOIN qr_windows w ON w.token = a.qr_token
      )
      SELECT
        d.day,
        COUNT(*) FILTER (WHERE att.status = 'puntual')    AS puntuales,
        COUNT(*) FILTER (WHERE att.status = 'tardanza')   AS tardanzas,
        COUNT(*) FILTER (WHERE att.user_id IS NULL)       AS faltas
      FROM days d
      CROSS JOIN workers w
      LEFT JOIN att ON att.user_id = w.id AND att.day = d.day
      GROUP BY d.day
      ORDER BY d.day ASC;
    `;
    const { rows } = await pool.query(q, [from, to]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /reports/attendance/by-user?from=2025-09-22&to=2025-09-27
 * Devuelve, por usuario, conteo de puntuales/tardanzas/faltas en el rango.
 */
export const attendanceByUser = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ message: "from y to son requeridos (YYYY-MM-DD)" });

    const q = `
      WITH days AS (
        SELECT d::date AS day
        FROM generate_series($1::date, $2::date, '1 day') AS d
      ),
      workers AS (
        SELECT id, name, email
        FROM users
        WHERE role = 'WORKER' AND (active IS NULL OR active = TRUE)
      ),
      calendar AS (
        SELECT w.id AS user_id, w.name, w.email, d.day
        FROM workers w CROSS JOIN days d
      ),
      att AS (
        SELECT
          a.user_id,
          (a.marked_at AT TIME ZONE 'America/Lima')::date AS day,
          COALESCE(
            a.status,
            CASE
              WHEN w.on_time_until IS NOT NULL AND (a.marked_at::time <= w.on_time_until) THEN 'puntual'
              ELSE 'tardanza'
            END
          ) AS status
        FROM attendance a
        LEFT JOIN qr_windows w ON w.token = a.qr_token
      )
      SELECT
        c.user_id,
        c.name,
        c.email,
        COUNT(*) FILTER (WHERE att.status = 'puntual')  AS puntuales,
        COUNT(*) FILTER (WHERE att.status = 'tardanza') AS tardanzas,
        COUNT(*) FILTER (WHERE att.user_id IS NULL)     AS faltas
      FROM calendar c
      LEFT JOIN att ON att.user_id = c.user_id AND att.day = c.day
      GROUP BY c.user_id, c.name, c.email
      ORDER BY c.name ASC;
    `;
    const { rows } = await pool.query(q, [from, to]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
};
