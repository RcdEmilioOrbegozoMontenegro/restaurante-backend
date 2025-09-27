// src/controllers/reports.controller.js
import { pool } from "../lib/db.js";

/**
 * GET /reports/attendance/summary?from=YYYY-MM-DD&to=YYYY-MM-DD[&user_id=<id>]
 * Devuelve, por día, conteos de: puntuales, tardanzas y faltas.
 * "Falta" = trabajador WORKER activo sin registro ese día.
 * Si se envía user_id, filtra por ese empleado.
 */
export const attendanceSummary = async (req, res, next) => {
  try {
    const { from, to, user_id } = req.query;
    if (!from || !to) {
      return res
        .status(400)
        .json({ message: "from y to son requeridos (YYYY-MM-DD)" });
    }

    const q = `
      WITH days AS (
        SELECT d::date AS day
        FROM generate_series($1::date, $2::date, '1 day') AS d
      ),
      workers AS (
        SELECT id
        FROM users
        WHERE role = 'WORKER'
          AND (active IS NULL OR active = TRUE)
          AND ($3::text IS NULL OR id = $3::text)              -- filtra si viene user_id
      ),
      att AS (
        SELECT
          a.user_id,
          (a.marked_at AT TIME ZONE 'America/Lima')::date AS day,
          COALESCE(
            a.status,
            CASE
              WHEN ((a.marked_at AT TIME ZONE 'America/Lima')::time)
                   <= COALESCE(qw.on_time_until, '09:10'::time)
                THEN 'puntual'
              ELSE 'tardanza'
            END
          ) AS status
        FROM attendance a
        LEFT JOIN qr_windows qw ON qw.token = a.qr_token
        WHERE (a.marked_at AT TIME ZONE 'America/Lima')::date BETWEEN $1::date AND $2::date
          AND ($3::text IS NULL OR a.user_id = $3::text)        -- eficiencia: también filtra aquí
      )
      SELECT
        d.day,
        COUNT(*) FILTER (WHERE att.status = 'puntual')  AS puntuales,
        COUNT(*) FILTER (WHERE att.status = 'tardanza') AS tardanzas,
        COUNT(*) FILTER (WHERE att.user_id IS NULL)     AS faltas
      FROM days d
      CROSS JOIN workers u
      LEFT JOIN att ON att.user_id = u.id AND att.day = d.day
      GROUP BY d.day
      ORDER BY d.day ASC;
    `;

    const { rows } = await pool.query(q, [from, to, user_id ?? null]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

export const attendanceByUser = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res
        .status(400)
        .json({ message: "from y to son requeridos (YYYY-MM-DD)" });
    }

    const q = `
      WITH days AS (
        SELECT d::date AS day
        FROM generate_series($1::date, $2::date, '1 day') AS d
      ),
      workers AS (
        SELECT
          id,
          COALESCE(full_name, username, email) AS name,  -- 🔧 aquí el fix
          email
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
              WHEN ((a.marked_at AT TIME ZONE 'America/Lima')::time)
                   <= COALESCE(qw.on_time_until, '09:10'::time)
                THEN 'puntual'
              ELSE 'tardanza'
            END
          ) AS status
        FROM attendance a
        LEFT JOIN qr_windows qw ON qw.token = a.qr_token
        WHERE (a.marked_at AT TIME ZONE 'America/Lima')::date
              BETWEEN $1::date AND $2::date
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
    console.error("attendanceByUser error:", err); // 🔧 deja el log visible en Render
    next(err);
  }
};