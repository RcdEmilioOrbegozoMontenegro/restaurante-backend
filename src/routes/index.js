// src/routes/index.js
import { Router } from "express";
import { generateQR } from "../controllers/qr.controller.js";
import {
  markAttendance,
  markAttendanceWithPhoto,
} from "../controllers/attendance.controller.js";
import {
  createWorker,
  listUsers,
  exportUsersCsv,
  deleteUser,
  getUserAttendance,
  getMyAttendance,
} from "../controllers/users.controller.js";
import { login, loginAdmin } from "../controllers/auth.controller.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import {
  attendanceSummary,
  attendanceByUser,
} from "../controllers/reports.controller.js";
import { upload, ensureUploadDir } from "../lib/upload.js";

const r = Router();
ensureUploadDir(); // crea carpeta de uploads si no existe

// ---------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------
r.post("/auth/login", login);            // ADMIN o WORKER
r.post("/auth/login-admin", loginAdmin); // Solo ADMIN (si quieres separar flujos)

// ---------------------------------------------------------------------
// USERS (solo ADMIN)
// ---------------------------------------------------------------------
r.get("/users", requireAuth, requireAdmin, listUsers);
r.post("/users", requireAuth, requireAdmin, createWorker);
r.get("/users/export", requireAuth, requireAdmin, exportUsersCsv);
r.delete("/users/:id", requireAuth, requireAdmin, deleteUser);
r.get("/users/:id/attendance", requireAuth, requireAdmin, getUserAttendance);

// ---------------------------------------------------------------------
// QR & ATTENDANCE
// ---------------------------------------------------------------------
r.post("/qr/generate", generateQR); // si deseas, luego protégelo con requireAdmin
r.post("/attendance/mark", requireAuth, markAttendance);

// Nuevo endpoint: asistencia con foto (multipart/form-data)
// Campo requerido: "photo", más el body con "qrToken"
r.post(
  "/attendance/mark-with-photo",
  requireAuth,
  upload.single("photo"),
  markAttendanceWithPhoto
);

r.get("/me/attendance", requireAuth, getMyAttendance);

// ---------------------------------------------------------------------
// REPORTS (solo ADMIN)
// ---------------------------------------------------------------------
r.get("/reports/attendance/summary", requireAuth, requireAdmin, attendanceSummary);
r.get("/reports/attendance/by-user", requireAuth, requireAdmin, attendanceByUser);

export default r;
