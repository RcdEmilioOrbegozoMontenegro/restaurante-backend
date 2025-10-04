import "dotenv/config";
import { pool } from "../src/lib/db.js";

await pool.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='attendance' AND column_name='photo_url'
    ) THEN
      ALTER TABLE attendance ADD COLUMN photo_url TEXT;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='attendance' AND column_name='photo_sha256'
    ) THEN
      ALTER TABLE attendance ADD COLUMN photo_sha256 TEXT;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='attendance' AND column_name='photo_taken_at'
    ) THEN
      ALTER TABLE attendance ADD COLUMN photo_taken_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
  END $$;
`);
console.log("Migración 003 (foto) aplicada ✅");
process.exit(0);
