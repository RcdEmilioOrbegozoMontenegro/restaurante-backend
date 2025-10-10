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
      return res.status(400).json({ message: "from y to son requeridos (YYYY-MM-DD)" });
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

/**
 * GET /reports/attendance/by-user?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Conteo de puntuales/tardanzas/faltas por usuario en el rango.
 */
export const attendanceByUser = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ message: "from y to son requeridos (YYYY-MM-DD)" });
    }

    const q = `
      WITH days AS (
        SELECT d::date AS day
        FROM generate_series($1::date, $2::date, '1 day') AS d
      ),
      workers AS (
        SELECT
          id,
          COALESCE(full_name, email) AS name,  -- ✅ sin "username"
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
      ORDER BY c.name ASC NULLS LAST;
    `;

    const { rows } = await pool.query(q, [from, to]);
    res.json(rows);
  } catch (err) {
    console.error("attendanceByUser error:", err);
    next(err);
  }
};

/**
 * GET /reports/attendance/reasons?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Devuelve distribución de justificaciones por categoría (para el gráfico de pie).
 * Toma justification_* o late_reason_* (compat).
 */
// ✅ Distribución de razones para el gráfico de pie
export const reasonsSummary = async (req, res, next) => {
  try {
    const { from, to, user_id } = req.query || {};
    if (!from || !to) {
      return res.status(400).json({ error: "from y to requeridos (YYYY-MM-DD)" });
    }

    const q = `
      SELECT
        COALESCE(NULLIF(TRIM(a.late_reason_category), ''), 'Sin razón') AS category,
        COUNT(*)::int AS count
      FROM attendance a
      WHERE a.late_reason_category IS NOT NULL
        AND (a.marked_at AT TIME ZONE 'America/Lima')::date BETWEEN $1::date AND $2::date
        AND ($3::text IS NULL OR a.user_id = $3::text)
      GROUP BY 1
      ORDER BY 2 DESC, 1 ASC
    `;
    const { rows } = await pool.query(q, [from, to, user_id ?? null]);
    const total = rows.reduce((n, r) => n + Number(r.count || 0), 0);
    res.json({ from, to, total, breakdown: rows });
  } catch (err) {
    next(err);
  }
};


export const exportAttendanceCsv = async (req, res, next) => {
  try {
    const { from, to, user_id } = req.query;
    if (!from || !to) {
      return res.status(400).json({ message: "from y to son requeridos (YYYY-MM-DD)" });
    }

    const summarySql = `
      WITH days AS (
        SELECT d::date AS day
        FROM generate_series($1::date, $2::date, '1 day') AS d
      ),
      workers AS (
        SELECT id
        FROM users
        WHERE role = 'WORKER'
          AND (active IS NULL OR active = TRUE)
          AND ($3::text IS NULL OR id = $3::text)
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
          AND ($3::text IS NULL OR a.user_id = $3::text)
      )
      SELECT
        d.day::date AS day,
        COUNT(*) FILTER (WHERE att.status = 'puntual')  AS puntuales,
        COUNT(*) FILTER (WHERE att.status = 'tardanza') AS tardanzas,
        COUNT(*) FILTER (WHERE att.user_id IS NULL)     AS faltas
      FROM days d
      CROSS JOIN workers u
      LEFT JOIN att ON att.user_id = u.id AND att.day = d.day
      GROUP BY d.day
      ORDER BY d.day ASC;
    `;
    const { rows: summary } = await pool.query(summarySql, [from, to, user_id ?? null]);

    const detailSql = `
      SELECT
        COALESCE(u.full_name, u.email) AS worker_name,
        (a.marked_at AT TIME ZONE 'America/Lima')::date AS day_date,
        EXTRACT(DOW FROM (a.marked_at AT TIME ZONE 'America/Lima'))::int AS dow,
        COALESCE(NULLIF(TRIM(a.late_reason_category), ''), 'Sin razón') AS category,
        COALESCE(a.late_reason_text, '') AS reason
      FROM attendance a
      JOIN users u ON u.id = a.user_id
      WHERE (a.marked_at AT TIME ZONE 'America/Lima')::date BETWEEN $1::date AND $2::date
        AND a.status = 'tardanza'
        AND ($3::text IS NULL OR a.user_id = $3::text)
      ORDER BY day_date ASC, worker_name ASC;
    `;
    const { rows: details } = await pool.query(detailSql, [from, to, user_id ?? null]);

    const dias = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const fmtDMY = (d) =>
      new Date(d).toLocaleDateString("es-PE", { timeZone: "America/Lima" }); // DD/MM/YYYY

    let lines = [];
    // Encabezado
    lines.push(`Reporte de Asistencias,${from},${to}${user_id ? `,Usuario:${user_id}` : ""}`);

    // Resumen por día (con fecha DD/MM/YYYY)
    lines.push("");
    lines.push("Resumen por día");
    lines.push("Día,Puntuales,Tardanzas,Faltas");
    for (const r of summary) {
      lines.push(
        [
          esc(fmtDMY(r.day)),
          esc(r.puntuales),
          esc(r.tardanzas),
          esc(r.faltas),
        ].join(",")
      );
    }

    // Justificaciones completas (tardanzas)
    lines.push("");
    lines.push("Justificaciones (tardanzas)");
    lines.push("Fecha,Día,Empleado,Categoría,Justificación");
    for (const d of details) {
      const fecha = fmtDMY(d.day_date);             // 09/10/2025
      const dow = dias[d.dow] ?? "";                // Jue
      lines.push(
        [
          esc(fecha),
          esc(dow),
          esc(d.worker_name),
          esc(d.category),
          esc(d.reason),
        ].join(",")
      );
    }

    const csv = "\uFEFF" + lines.join("\n"); // BOM para Excel/acentos
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    const suffix = user_id ? `_user_${user_id}` : "";
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="asistencia_${from}_a_${to}${suffix}.csv"`
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
};