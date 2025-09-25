// src/server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import routes from "./routes/index.js";

const app = express();

// ✅ habilita CORS para el front (puerto 3000)
app.use(cors({ origin: ["http://localhost:3000"], credentials: true }));

app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

// Endpoints
app.use("/api", routes);
// ...middlewares
app.get("/", (_req, res) => res.send("API OK"));           // opcional, solo para que no salga 404
app.get("/api/health", (_req, res) => res.json({ ok: true })); // ping de salud

app.use("/api", routes);
 
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API escuchando en http://localhost:${PORT}`));
