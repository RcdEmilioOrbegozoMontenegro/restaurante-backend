// src/lib/db.js
import pg from "pg";
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // ver formato abajo
  ssl: { rejectUnauthorized: false },         // Supabase requiere TLS
  max: 5,                                     // prudente con PgBouncer
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// opcional: loguea errores del pool
pool.on("error", (err) => {
  console.error("PG POOL ERROR:", err);
});
