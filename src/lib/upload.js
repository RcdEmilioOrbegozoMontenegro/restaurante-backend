// src/lib/upload.js
import multer from "multer";
import path from "node:path";
import fs from "node:fs";

const ROOT = process.cwd();
export const UPLOADS_DIR = path.join(ROOT, "uploads");
export const MENU_DIR = path.join(UPLOADS_DIR, "menu");
export const ATT_DIR  = path.join(UPLOADS_DIR, "attendance"); // para fotos de asistencia

export function ensureUploadDir() {
  fs.mkdirSync(MENU_DIR, { recursive: true });
  fs.mkdirSync(ATT_DIR,  { recursive: true });
}
ensureUploadDir();

function randomName(ext = ".jpg") {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    // image -> menú | photo -> asistencia | fallback -> raíz de uploads
    const dir =
      file.fieldname === "image" ? MENU_DIR :
      file.fieldname === "photo" ? ATT_DIR  :
      UPLOADS_DIR;
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext =
      file.mimetype === "image/png"  ? ".png"  :
      file.mimetype === "image/webp" ? ".webp" : ".jpg";
    cb(null, randomName(ext));
  },
});

const fileFilter = (_req, file, cb) => {
  if (/^image\//.test(file.mimetype)) return cb(null, true);
  cb(new Error("Solo se permiten imágenes"));
};

export const upload = multer({ storage, fileFilter });

/** Guarda un buffer en /uploads/menu y retorna la URL pública. */
export function saveMenuBuffer(buffer, ext = ".jpg") {
  ensureUploadDir();
  const name = randomName(ext);
  const abs = path.join(MENU_DIR, name);
  fs.writeFileSync(abs, buffer);
  return { publicUrl: `/uploads/menu/${name}`, absolutePath: abs };
}

/** Guarda un buffer en /uploads/attendance y retorna la URL pública. */
export function savePhotoBuffer(buffer, ext = ".jpg") {
  ensureUploadDir();
  const name = randomName(ext);
  const abs = path.join(ATT_DIR, name);
  fs.writeFileSync(abs, buffer);
  return { publicUrl: `/uploads/attendance/${name}`, absolutePath: abs };
}
