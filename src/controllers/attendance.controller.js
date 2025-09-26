import { pool } from "../lib/db.js";
import { customAlphabet } from "nanoid";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

export async function markAttendance(req, res) {
  try {
    const { qrToken } = req.body || {};
    if (!qrToken) {
      return res.status(400).json({ error: "qrToken requerido" });
    }

    // userId viene del JWT
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "no auth" });
    }

    // valida que el token exista
    const win = await pool.query(
      "SELECT id FROM qr_windows WHERE token = $1",
      [qrToken]
    );
    if (win.rowCount === 0) {
      return res.status(400).json({ error: "QR no válido" });
    }

    // evita doble marcación por día (día UTC)
    const dup = await pool.query(
      `SELECT 1
       FROM attendance
       WHERE user_id = $1
         AND (marked_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date`,
      [userId]
    );
    if (dup.rowCount > 0) {
      return res.status(409).json({ error: "Asistencia ya registrada hoy" });
    }

    const id = nano();
    const ins = await pool.query(
      "INSERT INTO attendance (id, user_id, qr_token) VALUES ($1, $2, $3) RETURNING marked_at",
      [id, userId, qrToken]
    );

    return res.json({
      ok: true,
      attendanceId: id,
      markedAt: ins.rows[0].marked_at,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "error registrando asistencia" });
  }
}
