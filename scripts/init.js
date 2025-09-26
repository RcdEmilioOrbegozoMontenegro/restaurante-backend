// scripts/init.js
import { pool } from '../src/lib/db.js';

async function main() {
  // 1) USERS: crear si no existe
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMIN','WORKER')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Asegurar columnas opcionales en USERS (full_name, phone, active)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='users' AND column_name='full_name'
      ) THEN
        ALTER TABLE users ADD COLUMN full_name TEXT;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='users' AND column_name='phone'
      ) THEN
        ALTER TABLE users ADD COLUMN phone TEXT;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='users' AND column_name='active'
      ) THEN
        ALTER TABLE users ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;
      END IF;
    END $$;
  `);

  // 2) QR_WINDOWS: crear si no existe (versión mínima)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS qr_windows (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL
    );
  `);

  // Asegurar columnas que pueden faltar en QR_WINDOWS
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='qr_windows' AND column_name='expires_at'
      ) THEN
        ALTER TABLE qr_windows ADD COLUMN expires_at TIMESTAMPTZ;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='qr_windows' AND column_name='created_by'
      ) THEN
        ALTER TABLE qr_windows ADD COLUMN created_by TEXT;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='qr_windows' AND column_name='created_at'
      ) THEN
        ALTER TABLE qr_windows ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      END IF;
    END $$;
  `);

  // Intentar añadir FK created_by -> users(id) si aún no existe (opcional suave)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        WHERE tc.table_name = 'qr_windows'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND tc.constraint_name = 'qr_windows_created_by_fkey'
      ) THEN
        BEGIN
          ALTER TABLE qr_windows
            ADD CONSTRAINT qr_windows_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
        EXCEPTION WHEN others THEN
          -- Si falla por datos existentes, se ignora; no es crítico.
          NULL;
        END;
      END IF;
    END $$;
  `);

  // Índices de QR (solo si existe la columna)
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='qr_windows' AND column_name='expires_at'
      ) THEN
        CREATE INDEX IF NOT EXISTS idx_qr_windows_expires_at ON qr_windows(expires_at);
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='qr_windows' AND column_name='token'
      ) THEN
        CREATE INDEX IF NOT EXISTS idx_qr_windows_token ON qr_windows(token);
      END IF;
    END $$;
  `);

  // 3) ATTENDANCE: crear si no existe (mínimo)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      qr_token TEXT
    );
  `);

  // Asegurar FK attendance.user_id -> users(id) (opcional suave)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        WHERE tc.table_name = 'attendance'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND tc.constraint_name = 'attendance_user_id_fkey'
      ) THEN
        BEGIN
          ALTER TABLE attendance
            ADD CONSTRAINT attendance_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        EXCEPTION WHEN others THEN
          NULL;
        END;
      END IF;
    END $$;
  `);

  // (Limpieza opcional) elimina índice viejo si existiera (basado en columna 'day')
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname='public' AND indexname='uniq_attendance_user_day'
      ) THEN
        DROP INDEX uniq_attendance_user_day;
      END IF;
    END $$;
  `);

  // Índice para acelerar por usuario
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id);
  `);

  // ✅ Índice ÚNICO por EXPRESIÓN: 1 asistencia por día (día UTC)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_attendance_user_day_expr
    ON attendance (user_id, ((marked_at AT TIME ZONE 'UTC')::date));
  `);

  console.log('✅ DB init completed (tablas/columnas/índices asegurados)');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
