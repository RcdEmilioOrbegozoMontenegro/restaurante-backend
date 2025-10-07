// src/controllers/attendance.controller.js
import { pool } from "../lib/db.js";
import { customAlphabet } from "nanoid";
import { savePhotoBuffer } from "../lib/upload.js";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

/** Clasificación simple de justificación por palabras clave */
function classifyLateReason(text = "") {
  const t = (text || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const rules = [
    { cat: "Trafico",  score: 90, rx: /(trafic|atasco|embotell|congestion|bloqueo|paralizad|accident|micro|bus|combi|transporte|huelga)/ },
    { cat: "Medico",   score: 90, rx: /(medic|doctor|clinica|hospital|emergenc|cita|salud|dolor|enfermo|farmacia)/ },
    { cat: "Personal", score: 80, rx: /(hijo|famil|colegi|tramite|document|hogar|mudanza|imprevist|casa|visita)/ },
  ];
  for (const r of rules) if (r.rx.test(t)) return { category: r.cat, score: r.score };
  return { category: "otros", score: 50 };
}

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

/** Utilidad: determina si AHORA sería tardanza para un token dado */
async function willBeLate(qrToken) {
  const q = await pool.query(
    `SELECT (now() AT TIME ZONE 'America/Lima')::time >
            COALESCE(on_time_until, '09:10'::time) AS is_late
       FROM qr_windows
      WHERE token = $1
      LIMIT 1`,
    [qrToken]
  );
  if (!q.rowCount) return null; // token inválido
  return !!q.rows[0].is_late;
}

// ---------------------------------------------------------------------------
// POST /attendance/mark  (requireAuth)  -- SIN FOTO (compatibilidad)
// Body: { qrToken, lateReasonText? }
// ---------------------------------------------------------------------------
export async function markAttendance(req, res) {
  try {
    const { qrToken, lateReasonText } = req.body || {};
    if (!qrToken) return res.status(400).json({ error: "qrToken requerido" });

    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: "no auth" });

    const valid = await getValidQRWindowOrFail(qrToken);
    if (valid.error) return res.status(400).json({ error: valid.error });

    if (await hasAttendanceToday(userId)) {
      return res.status(409).json({ error: "Asistencia ya registrada hoy" });
    }

    // ¿será tardanza?
    const isLate = await willBeLate(qrToken);
    if (isLate === null) return res.status(400).json({ error: "QR no válido" });

    // Si es tardanza, exigir justificación
    let lateReasonCategory = null, lateReasonScore = null;
    if (isLate) {
      if (!lateReasonText || !lateReasonText.trim()) {
        return res.status(400).json({
          error: "Justificación requerida para tardanza",
          requireJustification: true,
        });
      }
      const cls = classifyLateReason(lateReasonText);
      lateReasonCategory = cls.category;
      lateReasonScore = cls.score;
    }

    const id = nano();
    const ins = await pool.query(
      `
      INSERT INTO attendance
        (id, user_id, qr_token, status,
         late_reason_text, late_reason_category, late_reason_score)
      SELECT
        $1, $2, $3,
        CASE
          WHEN (now() AT TIME ZONE 'America/Lima')::time >
               COALESCE(w.on_time_until, '09:10'::time)
          THEN 'tardanza'
          ELSE 'puntual'
        END,
        $4, $5, $6
        FROM qr_windows w
       WHERE w.token = $3
      RETURNING marked_at, status
      `,
      [id, userId, qrToken, lateReasonText || null, lateReasonCategory, lateReasonScore]
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
// Campos: photo (archivo), qrToken (texto), lateReasonText? (texto)
// ---------------------------------------------------------------------------
export async function markAttendanceWithPhoto(req, res) {
  try {
    const { qrToken, lateReasonText } = req.body || {};
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

    // ¿será tardanza?
    const isLate = await willBeLate(qrToken);
    if (isLate === null) return res.status(400).json({ error: "QR no válido" });

    let lateReasonCategory = null, lateReasonScore = null;
    if (isLate) {
      if (!lateReasonText || !lateReasonText.trim()) {
        return res.status(400).json({
          error: "Justificación requerida para tardanza",
          requireJustification: true,
        });
      }
      const cls = classifyLateReason(lateReasonText);
      lateReasonCategory = cls.category;
      lateReasonScore = cls.score;
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

    // Inserción con cálculo de puntual/tardanza + foto + justificación
    const id = nano();
    const ins = await pool.query(
      `
      INSERT INTO attendance
        (id, user_id, qr_token, status,
         photo_url, photo_sha256, photo_taken_at,
         late_reason_text, late_reason_category, late_reason_score)
      SELECT
        $1, $2, $3,
        CASE
          WHEN (now() AT TIME ZONE 'America/Lima')::time >
               COALESCE(w.on_time_until, '09:10'::time)
          THEN 'tardanza'
          ELSE 'puntual'
        END,
        $4, $5, now(),
        $6, $7, $8
        FROM qr_windows w
       WHERE w.token = $3
      RETURNING marked_at, status, photo_url
      `,
      [
        id, userId, qrToken,
        publicUrl, sha256,
        lateReasonText || null, lateReasonCategory, lateReasonScore
      ]
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
