import { pool } from "../lib/db.js";
import { customAlphabet } from "nanoid";
import QRCode from "qrcode";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

// Normaliza onTimeUntil a "HH:mm" o null
function normalizeTimeHHmm(input) {
  if (!input) return null;
  if (typeof input !== "string") return null;

  const s = input.trim();

  // Caso ideal: ya viene "HH:mm"
  if (/^\d{2}:\d{2}$/.test(s)) return s;

  // Si viene algo tipo "2025-09-26T09:10" o con zona "...09:10:00.000+00:00"
  const m = s.match(/T(\d{2}:\d{2})/);
  if (m) return m[1];

  // Último intento: si es parseable, extrae HH:mm "a lo bruto" (sin zona)
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    // No usaremos zona aquí; si te interesa Lima exacto, pásalo desde el front como "HH:mm"
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  return null;
}

export async function generateQR(req, res) {
  try {
    const { label = "Turno", onTimeUntil } = req.body || {};
    const onTime = normalizeTimeHHmm(onTimeUntil); // ← "HH:mm" | null

    const id = nano();
    const token = nano();

    // Guardamos TIME o NULL; en el cálculo de asistencia usamos COALESCE('09:10'::time)
    await pool.query(
      `INSERT INTO qr_windows (id, token, label, on_time_until)
       VALUES ($1, $2, $3, $4::time)`,
      [id, token, label, onTime] // si onTime es null, inserta NULL
    );

    const qrImage = await QRCode.toDataURL(token, { margin: 1, width: 256 });

    return res.json({
      id,
      token,
      label,
      // Lo que quedó persistido (puede ser null si no enviaste hora)
      onTimeUntil: onTime,
      // Para UX puedes mostrar "efectivo": si no hay, tu backend asume '09:10'
      effectiveOnTimeUntil: onTime || "09:10",
      qrImage,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "error generando QR" });
  }
}
