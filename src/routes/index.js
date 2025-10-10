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
  reasonsSummary,
  exportAttendanceCsv,
} from "../controllers/reports.controller.js";
import { upload, ensureUploadDir } from "../lib/upload.js";
import { chartQA, aiLimiter, hrQA } from "../controllers/ai.controller.js";
import {
  listCategories, createCategory, updateCategory, deleteCategory,
  listItems, createItem, updateItem, deleteItem,
} from "../controllers/menu.controller.js";

const r = Router();
ensureUploadDir();

// AUTH
r.post("/auth/login", login);
r.post("/auth/login-admin", loginAdmin);

// USERS (ADMIN)
r.get("/users", requireAuth, requireAdmin, listUsers);
r.post("/users", requireAuth, requireAdmin, createWorker);
r.get("/users/export", requireAuth, requireAdmin, exportUsersCsv);
r.delete("/users/:id", requireAuth, requireAdmin, deleteUser);
r.get("/users/:id/attendance", requireAuth, requireAdmin, getUserAttendance);

// QR & ATTENDANCE
r.post("/qr/generate", generateQR);
r.post("/attendance/mark", requireAuth, markAttendance);
r.post("/attendance/mark-with-photo", requireAuth, upload.single("photo"), markAttendanceWithPhoto);
r.get("/me/attendance", requireAuth, getMyAttendance);

// REPORTS (ADMIN)
r.get("/reports/attendance/summary", requireAuth, requireAdmin, attendanceSummary);
r.get("/reports/attendance/by-user", requireAuth, requireAdmin, attendanceByUser);
r.get("/reports/attendance/reasons", requireAuth, requireAdmin, reasonsSummary);
r.get("/reports/attendance/export", requireAuth, requireAdmin, exportAttendanceCsv);

// AI (ADMIN)
r.post("/ai/chart-qa", requireAuth, requireAdmin, aiLimiter, chartQA);
r.post("/hr-qa", hrQA);

// Público (menú)
r.get("/menu/categories", listCategories);
r.get("/menu/items", listItems);

// Admin (menú)
r.post("/menu/categories", requireAuth, requireAdmin, createCategory);
r.patch("/menu/categories/:id", requireAuth, requireAdmin, updateCategory);
r.delete("/menu/categories/:id", requireAuth, requireAdmin, deleteCategory);
r.post("/menu/items", requireAuth, requireAdmin, upload.single("image"), createItem);
r.patch("/menu/items/:id", requireAuth, requireAdmin, upload.single("image"), updateItem);
r.delete("/menu/items/:id", requireAuth, requireAdmin, deleteItem);

export default r;
