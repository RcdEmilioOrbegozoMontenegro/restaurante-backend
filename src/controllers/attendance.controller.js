// src/controllers/attendance.controller.js
import fs from "node:fs";
import crypto from "node:crypto";
import { pool } from "../lib/db.js";
import { customAlphabet } from "nanoid";
// import { savePhotoBuffer } from "../lib/upload.js"; // ⬅️ YA NO SE USA CON diskStorage

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

/** Clasifica la justificación en categorías usadas por los gráficos */
function classifyLateReason(text = "") {
  const t = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  const rules = [
    { cat: "Tráfico",     score: 95, rx: /(trafic|atasc|embotell|congestion|choque|accident|bloque|paraliz|desvio)/ },
    { cat: "Transporte",  score: 92, rx: /(bus|micro|combi|colectivo|metro|tren|mototaxi|taxi|paradero|transporte|vehicul|auto)/ },
    { cat: "Salud",       score: 92, rx: /(salud|medic|doctor|doctora|cita|clinica|hospital|fiebre|dolor|enferm|farmaci|odont|dental|analisis|prueba|psicolog|terapia)/ },
    { cat: "Documentos",  score: 90, rx: /(tramite|tramites|document|dni|reniec|notari|banco|sunat|licencia|certific|constancia|registro|pago)/ },
    { cat: "Permiso",     score: 88, rx: /(permiso|autoriz|me autoriz|licencia laboral)/ },
    { cat: "Familiar",    score: 88, rx: /(hijo|hija|famil|mama|papa|abuela|abuelo|esposa|esposo|pareja|colegi|escuela|jardin|guarderia|velorio|funeral|emergencia familiar)/ },
  ];
  for (const r of rules) if (r.rx.test(t)) return { category: r.cat, score: r.score };
  return { category: "Otros", score: 50 };
}

function sha256File(absPath) {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
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
  if (win.rowCount === 0) return { error: "QR no válido" };
  const row = win.rows[0];
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  if (expiresAt && new Date() > expiresAt) return { error: "QR expirado" };
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
  if (!q.rowCount) return null;
  return !!q.rows[0].is_late;
}

// ---------------------------------------------------------------------------
// POST /attendance/mark  (requireAuth)  -- SIN FOTO (compat)
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

    if (!ins.rowCount) return res.status(400).json({ error: "QR no válido" });

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
    const file = req.file; // viene de multer.diskStorage (req.file.path y req.file.filename)

    if (!qrToken) return res.status(400).json({ error: "qrToken requerido" });
    if (!file)    return res.status(400).json({ error: "Foto requerida" });

    const userId = req.user?.sub;
    if (!userId)  return res.status(401).json({ error: "no auth" });

    const valid = await getValidQRWindowOrFail(qrToken);
    if (valid.error) return res.status(400).json({ error: valid.error });

    if (await hasAttendanceToday(userId)) {
      return res.status(409).json({ error: "Asistencia ya registrada hoy" });
    }

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

    // multer ya guardó el archivo en /uploads/attendance
    const publicUrl = `/uploads/attendance/${file.filename}`;
    let sha256 = "";
    try {
      sha256 = sha256File(file.path);
    } catch (e) {
      console.error("[attendance] sha256 error:", e);
      return res.status(500).json({ error: "Fallo procesando la foto" });
    }

    // Evitar reuso de la misma foto el mismo día
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
      [id, userId, qrToken, publicUrl, sha256, lateReasonText || null, lateReasonCategory, lateReasonScore]
    );

    if (!ins.rowCount) return res.status(400).json({ error: "QR no válido" });

    return res.json({
      ok: true,
      attendanceId: id,
      markedAt: ins.rows[0].marked_at,
      status: ins.rows[0].status,
      photoUrl: ins.rows[0].photo_url,
    });

  } catch (e) {
    if (e && e.code === "23505") {
      return res.status(409).json({ error: "Asistencia ya registrada hoy" });
    }
    if (e instanceof Error && /Tipo de imagen no permitido|File too large/i.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    console.error("[attendance] mark-with-photo unexpected error:", e);
    return res.status(500).json({ error: "error registrando asistencia con foto" });
  }
}

export default {
  markAttendance,
  markAttendanceWithPhoto,
};
