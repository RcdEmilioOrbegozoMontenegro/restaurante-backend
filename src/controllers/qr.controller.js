import { pool } from "../lib/db.js";
import { customAlphabet } from "nanoid";
import QRCode from "qrcode";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

// POST /qr/generate
// body: { label?: string, onTimeUntil?: string(ISO o "HH:mm"), expiresAt?: string(ISO) }
export async function generateQR(req, res) {
  try {
    const { label = "Turno", onTimeUntil, expiresAt } = req.body || {};
    const id = nano();
    const token = nano();

    const createdBy = req.user?.sub ?? null;

    // Normaliza on_time_until:
    // - Si viene "HH:mm", se crea para HOY en hora local.
    // - Si viene ISO, se usa tal cual.
    let on_time_until = null;
    if (typeof onTimeUntil === "string" && onTimeUntil.trim()) {
      const hhmm = onTimeUntil.trim();
      if (/^\d{1,2}:\d{2}$/.test(hhmm)) {
        const [hh, mm] = hhmm.split(":").map((s) => parseInt(s, 10));
        const d = new Date();
        d.setHours(hh || 0, mm || 0, 0, 0);
        on_time_until = d;
      } else {
        const d = new Date(onTimeUntil);
        if (!isNaN(d.getTime())) on_time_until = d;
      }
    }

    // Normaliza expires_at si viene
    let expires_at = null;
    if (typeof expiresAt === "string" && expiresAt.trim()) {
      const d = new Date(expiresAt);
      if (!isNaN(d.getTime())) expires_at = d;
    }

    // IMPORTANTE: asegúrate de tener columna 'label' en qr_windows si usas label aquí.
    await pool.query(
      `INSERT INTO qr_windows (id, token, label, created_by, created_at, on_time_until, expires_at)
       VALUES ($1,$2,$3,$4,NOW(),$5,$6)`,
      [id, token, label, createdBy, on_time_until, expires_at]
    );

    const qrImage = await QRCode.toDataURL(token, { margin: 1, width: 256 });

    return res.json({
      ok: true,
      id,
      token,
      label,
      onTimeUntil: on_time_until ? on_time_until.toISOString() : null,
      expiresAt: expires_at ? expires_at.toISOString() : null,
      qrImage,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "error generando QR" });
  }
}
