import "dotenv/config";
import { pool } from "../src/lib/db.js";

await pool.query(`
  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true
`);
console.log("Migración aplicada ✅");
process.exit(0);
