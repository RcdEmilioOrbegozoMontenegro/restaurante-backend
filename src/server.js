import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import routes from "./routes/index.js";
import path from "node:path";
import fs from "node:fs";

const app = express();

/* CORS */
const allowList = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsMw = cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowList.includes(origin)) return cb(null, true);
    try {
      const u = new URL(origin);
      if (u.hostname.endsWith(".vercel.app")) return cb(null, true);
    } catch {}
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400,
});

app.use(corsMw);
app.options(/.*/, corsMw);

/* Static uploads (+ compat /api/uploads) */
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
fs.mkdirSync(path.join(UPLOADS_DIR, "menu"), { recursive: true });

app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/api/uploads", express.static(UPLOADS_DIR)); // compat con filas antiguas

/* Seguridad / parsers / logs */
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* Health */
app.get("/", (_req, res) => res.send("API OK"));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* API */
app.use("/api", routes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => console.log(`API on :${PORT}`));
