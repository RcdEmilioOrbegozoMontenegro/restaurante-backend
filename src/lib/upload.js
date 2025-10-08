import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { customAlphabet } from "nanoid";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);
const nanoMenu = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

// Raíz de uploads
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

// Subcarpetas
const UPLOAD_ATTENDANCE_ROOT = path.join(UPLOADS_ROOT, "attendance");
const UPLOAD_MENU_ROOT = path.join(UPLOADS_ROOT, "menu");

// Asegura carpetas base
function ensureBaseDirs() {
  fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
  fs.mkdirSync(UPLOAD_ATTENDANCE_ROOT, { recursive: true });
  fs.mkdirSync(UPLOAD_MENU_ROOT, { recursive: true });
}
ensureBaseDirs();

// Multer en memoria (se reutiliza en endpoints que suben imagen)
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Tipo de imagen no permitido"));
  },
});

// ==== Asistencia ====
export function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_ATTENDANCE_ROOT, { recursive: true });
}

export function savePhotoBuffer(buffer, ext = ".jpg") {
  ensureUploadDir();
  const id = nano();

  const now = new Date();
  const y = String(now.getUTCFullYear());
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");

  const dir = path.join(UPLOAD_ATTENDANCE_ROOT, y, m);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${id}${ext}`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, buffer);

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  // Ruta pública SIN /api (debe existir app.use("/uploads", express.static(...)))
  const publicUrl = `/uploads/attendance/${y}/${m}/${filename}`;

  return { publicUrl, fullPath, sha256 };
}

// ==== Menú ====
export function ensureMenuUploadDir() {
  fs.mkdirSync(UPLOAD_MENU_ROOT, { recursive: true });
}

export function saveMenuBuffer(buffer, ext = ".jpg") {
  ensureMenuUploadDir();
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const fileName = `${nanoMenu()}${ext}`;
  const full = path.join(UPLOAD_MENU_ROOT, fileName);
  fs.writeFileSync(full, buffer);

  // Ruta pública SIN /api
  const publicUrl = `/uploads/menu/${fileName}`;
  return { publicUrl, sha256 };
}
