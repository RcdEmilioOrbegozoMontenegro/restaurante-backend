import { Router } from "express";
import { generateQR } from "../controllers/qr.controller.js";
import { markAttendance } from "../controllers/attendance.controller.js";
import { createWorker, listUsers, exportUsersCsv, deleteUser, getUserAttendance, getMyAttendance } from "../controllers/users.controller.js";
import { login, loginAdmin } from "../controllers/auth.controller.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const r = Router();

// Auth
r.post("/auth/login", login);            // ADMIN o WORKER
r.post("/auth/login-admin", loginAdmin); // Solo ADMIN (si quieres separar flujos)

// Users (solo ADMIN)
r.get("/users", requireAuth, requireAdmin, listUsers);
r.post("/users", requireAuth, requireAdmin, createWorker);
r.get("/users/export", requireAuth, requireAdmin, exportUsersCsv);
r.delete("/users/:id", requireAuth, requireAdmin, deleteUser);
r.get("/users/:id/attendance", requireAuth, requireAdmin, getUserAttendance);

// QR & Attendance
r.post("/qr/generate", generateQR);                // ← sin el opcional de protegerlo
r.post("/attendance/mark", requireAuth, markAttendance);
r.get("/me/attendance", requireAuth, getMyAttendance);

export default r;
