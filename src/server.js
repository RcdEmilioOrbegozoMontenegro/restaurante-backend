import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import routes from "./routes/index.js";

const app = express();

const allowList = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const corsMw = cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                    // Postman/CLI
    if (allowList.includes(origin)) return cb(null, true); // p.ej. http://localhost:3000
    try {
      const u = new URL(origin);
      if (u.hostname.endsWith(".vercel.app")) return cb(null, true); // prod Vercel
    } catch {}
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  credentials: true,
  maxAge: 86400,
});

app.use(corsMw);
app.options(/.*/, corsMw); // <- MUY IMPORTANTE en Express 5 (preflight)

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
}));
app.use(morgan("dev"));
app.use(express.json());

app.get("/", (_req, res) => res.send("API OK"));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api", routes);     // <- monta tus rutas aquí, UNA sola vez

const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => console.log(`API on :${PORT}`));
