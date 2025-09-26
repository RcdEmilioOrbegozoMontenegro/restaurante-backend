// src/controllers/attendance.controller.js
import { pool } from "../lib/db.js";
import { customAlphabet } from "nanoid";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

// POST /attendance/mark  (requireAuth)
export async function markAttendance(req, res) {
  try {
    const { qrToken } = req.body || {};
    if (!qrToken) return res.status(400).json({ error: "qrToken requerido" });

    // userId viene del JWT
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: "no auth" });

    // 1) Validar QR y (opcional) expiración
    const win = await pool.query(
      `SELECT id, expires_at
         FROM qr_windows
        WHERE token = $1`,
      [qrToken]
    );
    if (win.rowCount === 0) {
      return res.status(400).json({ error: "QR no válido" });
    }
    const expiresAt = win.rows[0].expires_at ? new Date(win.rows[0].expires_at) : null;
    if (expiresAt && new Date() > expiresAt) {
      return res.status(400).json({ error: "QR expirado" });
    }

    // 2) Evitar doble marcación por día (día local: America/Lima)
    const dup = await pool.query(
      `SELECT 1
         FROM attendance
        WHERE user_id = $1
          AND (marked_at AT TIME ZONE 'America/Lima')::date =
              (now() AT TIME ZONE 'America/Lima')::date`,
      [userId]
    );
    if (dup.rowCount > 0) {
      return res.status(409).json({ error: "Asistencia ya registrada hoy" });
    }

    // 3) Insertar y calcular status en SQL usando hora local y on_time_until (TIME)
    //    - Si on_time_until es NULL, usar '09:10' por defecto.
    const id = nano();
    const ins = await pool.query(
      `
      INSERT INTO attendance (id, user_id, qr_token, status)
      SELECT
        $1, $2, $3,
        CASE
          WHEN (now() AT TIME ZONE 'America/Lima')::time >
               COALESCE(w.on_time_until, '09:10'::time)
          THEN 'tardanza'
          ELSE 'puntual'
        END
        FROM qr_windows w
       WHERE w.token = $3
      RETURNING marked_at, status
      `,
      [id, userId, qrToken]
    );

    // (Por seguridad) Si no retornó filas, QR no existe (no debería pasar porque lo validamos antes)
    if (ins.rowCount === 0) {
      return res.status(400).json({ error: "QR no válido" });
    }

    return res.json({
      ok: true,
      attendanceId: id,
      markedAt: ins.rows[0].marked_at,
      status: ins.rows[0].status,
    });
  } catch (e) {
    // Respaldo por condición de carrera: índice único por día (Lima)
    if (e && e.code === "23505") {
      return res.status(409).json({ error: "Asistencia ya registrada hoy" });
    }
    console.error(e);
    return res.status(500).json({ error: "error registrando asistencia" });
  }
}
