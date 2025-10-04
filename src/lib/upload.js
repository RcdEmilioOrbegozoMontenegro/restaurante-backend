import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { customAlphabet } from "nanoid";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

// Carpeta local para dev
const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads", "attendance");

// Asegura carpeta
export function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

// Multer en memoria (luego escribimos nosotros)
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Tipo de imagen no permitido"));
  },
});

export function savePhotoBuffer(buffer, ext = ".jpg") {
  const id = nano();
  const y = new Date().getUTCFullYear();
  const m = String(new Date().getUTCMonth() + 1).padStart(2, "0");
  const dir = path.join(UPLOAD_ROOT, `${y}`, `${m}`);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${id}${ext}`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, buffer);

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  // URL pública simple (sirve en dev si expones /uploads)
  const publicUrl = `/uploads/attendance/${y}/${m}/${filename}`;
  return { publicUrl, fullPath, sha256 };
}
