import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import routes from "./routes/index.js";
import path from "node:path";
import fs from "node:fs";

const app = express();

/* ==== CORS allowlist (coma-separado en .env) ==== */
const allowList = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsMw = cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // Postman/CLI/SSR
    if (allowList.includes(origin)) return cb(null, true); // ej http://localhost:3000
    try {
      const u = new URL(origin);
      if (u.hostname.endsWith(".vercel.app")) return cb(null, true); // front en Vercel
    } catch {}
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400,
});

app.use(corsMw);
app.options(/.*/, corsMw); // preflight en Express 5

/* ==== aseguramos carpetas de estáticos ==== */
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const UPLOADS_MENU_DIR = path.join(UPLOADS_DIR, "menu");
fs.mkdirSync(UPLOADS_MENU_DIR, { recursive: true });

/* ==== estáticos y seguridad ==== */
app.use("/uploads", express.static(UPLOADS_DIR)); // sirve /uploads/**

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // permitir <img src> cross-origin
    crossOriginEmbedderPolicy: false,
  })
);

app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ==== health ==== */
app.get("/", (_req, res) => res.send("API OK"));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* ==== rutas API ==== */
app.use("/api", routes); // monta tus rutas aquí, una sola vez

/* ==== arranque ==== */
const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`API on :${PORT}`);
});
