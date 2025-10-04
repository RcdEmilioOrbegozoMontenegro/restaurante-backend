// src/controllers/attendance.controller.js
import { pool } from "../lib/db.js";
import { customAlphabet } from "nanoid";
import { savePhotoBuffer } from "../lib/upload.js";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

/** Utilidad: valida QR y expiración; retorna fila de qr_windows o null */
async function getValidQRWindowOrFail(qrToken) {
  const win = await pool.query(
    `SELECT id, token, expires_at, on_time_until
       FROM qr_windows
      WHERE token = $1
      LIMIT 1`,
    [qrToken]
  );
  if (win.rowCount === 0) {
    return { error: "QR no válido" };
  }
  const row = win.rows[0];
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  if (expiresAt && new Date() > expiresAt) {
    return { error: "QR expirado" };
  }
  return { row };
}

/** Utilidad: verifica si ya marcó asistencia hoy (zona America/Lima) */
async function hasAttendanceToday(userId) {
  const dup = await pool.query(
    `SELECT 1
       FROM attendance
      WHERE user_id = $1
        AND (marked_at AT TIME ZONE 'America/Lima')::date =
            (now() AT TIME ZONE 'America/Lima')::date`,
    [userId]
  );
  return dup.rowCount > 0;
}

// ---------------------------------------------------------------------------
// POST /attendance/mark  (requireAuth)  -- SIN FOTO (compatibilidad)
// ---------------------------------------------------------------------------
export async function markAttendance(req, res) {
  try {
    const { qrToken } = req.body || {};
    if (!qrToken) return res.status(400).json({ error: "qrToken requerido" });

    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: "no auth" });

    const valid = await getValidQRWindowOrFail(qrToken);
    if (valid.error) return res.status(400).json({ error: valid.error });

    if (await hasAttendanceToday(userId)) {
      return res.status(409).json({ error: "Asistencia ya registrada hoy" });
    }

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
    if (e && e.code === "23505") {
      return res.status(409).json({ error: "Asistencia ya registrada hoy" });
    }
    console.error(e);
    return res.status(500).json({ error: "error registrando asistencia" });
  }
}

// ---------------------------------------------------------------------------
// POST /attendance/mark-with-photo  (requireAuth, multipart/form-data)
// Campos: photo (archivo), qrToken (texto)
// ---------------------------------------------------------------------------
export async function markAttendanceWithPhoto(req, res) {
  try {
    const { qrToken } = req.body || {};
    const file = req.file; // provisto por multer.single("photo")

    if (!qrToken) return res.status(400).json({ error: "qrToken requerido" });
    if (!file) return res.status(400).json({ error: "Foto requerida" });

    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: "no auth" });

    const valid = await getValidQRWindowOrFail(qrToken);
    if (valid.error) return res.status(400).json({ error: valid.error });

    if (await hasAttendanceToday(userId)) {
      return res.status(409).json({ error: "Asistencia ya registrada hoy" });
    }

    // Guardado de foto y hash
    const ext =
      file.mimetype === "image/png"
        ? ".png"
        : file.mimetype === "image/webp"
        ? ".webp"
        : ".jpg"; // default jpeg
    const { publicUrl, sha256 } = savePhotoBuffer(file.buffer, ext);

    // (Opcional) Evitar reuso exacto de imagen el mismo día
    const reuse = await pool.query(
      `SELECT 1
         FROM attendance
        WHERE user_id = $1
          AND (marked_at AT TIME ZONE 'America/Lima')::date =
              (now() AT TIME ZONE 'America/Lima')::date
          AND photo_sha256 = $2`,
      [userId, sha256]
    );
    if (reuse.rowCount > 0) {
      return res.status(400).json({ error: "Foto ya utilizada hoy" });
    }

    // Inserción con cálculo de puntual/tardanza
    const id = nano();
    const ins = await pool.query(
      `
      INSERT INTO attendance (id, user_id, qr_token, status, photo_url, photo_sha256, photo_taken_at)
      SELECT
        $1, $2, $3,
        CASE
          WHEN (now() AT TIME ZONE 'America/Lima')::time >
               COALESCE(w.on_time_until, '09:10'::time)
          THEN 'tardanza'
          ELSE 'puntual'
        END,
        $4, $5, now()
        FROM qr_windows w
       WHERE w.token = $3
      RETURNING marked_at, status, photo_url
      `,
      [id, userId, qrToken, publicUrl, sha256]
    );

    if (ins.rowCount === 0) {
      return res.status(400).json({ error: "QR no válido" });
    }

    return res.json({
      ok: true,
      attendanceId: id,
      markedAt: ins.rows[0].marked_at,
      status: ins.rows[0].status,
      photoUrl: ins.rows[0].photo_url,
    });
  } catch (e) {
    // índice único por día puede disparar 23505
    if (e && e.code === "23505") {
      return res.status(409).json({ error: "Asistencia ya registrada hoy" });
    }
    // errores de multer tipo/size llegan como Error normal
    if (e instanceof Error && /Tipo de imagen no permitido|File too large/i.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    console.error(e);
    return res.status(500).json({ error: "error registrando asistencia con foto" });
  }
}

export default {
  markAttendance,
  markAttendanceWithPhoto,
};
