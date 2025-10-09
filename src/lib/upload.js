// src/lib/upload.js
import multer from "multer";
import path from "node:path";
import fs from "node:fs";

const ROOT = process.cwd();
const UPLOADS_DIR = path.join(ROOT, "uploads");
const MENU_DIR = path.join(UPLOADS_DIR, "menu");

export function ensureUploadDir() {
  fs.mkdirSync(MENU_DIR, { recursive: true });
}
ensureUploadDir();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MENU_DIR),
  filename: (_req, file, cb) => {
    const ext =
      file.mimetype === "image/png" ? ".png" :
      file.mimetype === "image/webp" ? ".webp" : ".jpg";
    const name = Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  },
});

const fileFilter = (_req, file, cb) => {
  if (/^image\//.test(file.mimetype)) return cb(null, true);
  cb(new Error("Solo se permiten imágenes"));
};

export const upload = multer({ storage, fileFilter });

/** Guarda un buffer manualmente y devuelve una URL pública. Útil si usas memoryStorage. */
export function saveMenuBuffer(buffer, ext = ".jpg") {
  ensureUploadDir();
  const fname = Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ext;
  const abs = path.join(MENU_DIR, fname);
  fs.writeFileSync(abs, buffer);
  return { publicUrl: `/uploads/menu/${fname}`, absolutePath: abs };
}
