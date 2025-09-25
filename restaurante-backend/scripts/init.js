import "dotenv/config";
import { pool } from "../src/lib/db.js";

const sql = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','WORKER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qr_windows (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SIN columnas generadas: guardamos el día explícito
CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  marked_day DATE NOT NULL DEFAULT CURRENT_DATE,
  qr_token TEXT NOT NULL
);

-- Único por usuario y día (no usa funciones)
CREATE UNIQUE INDEX IF NOT EXISTS ux_attendance_user_day
  ON attendance (user_id, marked_day);

CREATE INDEX IF NOT EXISTS ix_attendance_marked_at
  ON attendance (marked_at DESC);
`;


await pool.query(sql);
console.log("Tablas listas ✅");
process.exit(0);
