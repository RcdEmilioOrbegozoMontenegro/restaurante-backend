// src/lib/db.js
import "dotenv/config";           // ← carga .env siempre

import pg from "pg";
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL no está definida. Crea un archivo .env en la raíz y define DATABASE_URL, o configura la variable en tu entorno.'
  );
}

const isNeon = /neon\.tech/i.test(connectionString);

export const pool = new Pool({
  connectionString,
  // Fuerza TLS para Neon/pooler
  ssl: isNeon ? { rejectUnauthorized: false, require: true } : undefined,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
