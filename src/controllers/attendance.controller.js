import { pool } from "../lib/db.js";
import { customAlphabet } from "nanoid";
const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

export async function markAttendance(req, res) {
  try {
    // en producción leerás el userId del JWT; por ahora se acepta del body:
    const { qrToken, userId = "u_worker" } = req.body || {};
    if (!qrToken) return res.status(400).json({ error: "qrToken requerido" });

    // valida que el token exista
    const win = await pool.query("SELECT id FROM qr_windows WHERE token=$1", [qrToken]);
    if (!win.rowCount) return res.status(400).json({ error: "QR no válido" });

    // evita doble marcación por día
    const dup = await pool.query(
    "SELECT 1 FROM attendance WHERE user_id=$1 AND marked_day = CURRENT_DATE",
      [userId]
    );
    if (dup.rowCount) return res.status(409).json({ error: "Asistencia ya registrada hoy" });

    const id = nano();
    const ins = await pool.query(
      "INSERT INTO attendance (id,user_id,qr_token) VALUES ($1,$2,$3) RETURNING marked_at",
      [id, userId, qrToken]
    );

    return res.json({ ok: true, attendanceId: id, markedAt: ins.rows[0].marked_at });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "error registrando asistencia" });
  }
}
