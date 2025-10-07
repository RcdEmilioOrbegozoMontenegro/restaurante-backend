import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { customAlphabet } from "nanoid";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);
const nanoMenu = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

const UPLOAD_MENU_ROOT = path.resolve(process.cwd(), "uploads", "menu");

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
export function ensureMenuUploadDir() {
  fs.mkdirSync(UPLOAD_MENU_ROOT, { recursive: true });
}

export function saveMenuBuffer(buffer, ext = ".jpg") {
  ensureMenuUploadDir();
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const fileName = `${nanoMenu()}${ext}`;
  const full = path.join(UPLOAD_MENU_ROOT, fileName);
  fs.writeFileSync(full, buffer);
  // Asumiendo que ya sirves /uploads estático; si no, agrega static en server.js
  return { publicUrl: `/uploads/menu/${fileName}`, sha256 };
}
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
