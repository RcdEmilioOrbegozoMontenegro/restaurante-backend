import { pool } from "../lib/db.js";
import { customAlphabet } from "nanoid";
import QRCode from "qrcode";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

export async function generateQR(req, res) {
  try {
    const { label = "Turno" } = req.body || {};
    const id = nano();
    const token = nano();

    await pool.query(
      "INSERT INTO qr_windows (id, token, label) VALUES ($1,$2,$3)",
      [id, token, label]
    );

    const qrImage = await QRCode.toDataURL(token, { margin: 1, width: 256 });
    return res.json({ id, token, label, qrImage });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "error generando QR" });
  }
}
