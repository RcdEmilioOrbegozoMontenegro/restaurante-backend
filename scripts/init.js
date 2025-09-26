// scripts/init.js
import { pool } from "../src/lib/db.js";

async function main() {
  /* ========= USERS ========= */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMIN','WORKER')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='users' AND column_name='employee_no'
      ) THEN
        ALTER TABLE users ADD COLUMN employee_no BIGINT;
      END IF;
    END $$;
  `);

  /* ========= QR WINDOWS ========= */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS qr_windows (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL
    );
  `);

  // Asegurar columnas en qr_windows (label, created_by, created_at, expires_at, on_time_until TIME)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='qr_windows' AND column_name='label'
      ) THEN
        ALTER TABLE qr_windows ADD COLUMN label TEXT;
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

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='qr_windows' AND column_name='expires_at'
      ) THEN
        ALTER TABLE qr_windows ADD COLUMN expires_at TIMESTAMPTZ;
      END IF;
    END $$;
  `);

  // Migrar/asegurar on_time_until como TIME (si existía con otro tipo, convertir)
  await pool.query(`
    DO $$
    DECLARE col_type TEXT;
    BEGIN
      SELECT data_type
        INTO col_type
        FROM information_schema.columns
       WHERE table_name='qr_windows' AND column_name='on_time_until';

      IF col_type IS NULL THEN
        -- No existe: crearla como TIME
        ALTER TABLE qr_windows ADD COLUMN on_time_until TIME;
      ELSIF col_type <> 'time without time zone' THEN
        -- Existe pero no es TIME: migrar a TIME de forma segura
        ALTER TABLE qr_windows ADD COLUMN on_time_until_tmp TIME;
        -- Intentar convertir preservando la "hora del día" en Lima si era timestamptz/timestamp
        BEGIN
          UPDATE qr_windows
             SET on_time_until_tmp =
                   CASE
                     WHEN pg_typeof(on_time_until)::text IN ('timestamp with time zone','timestamptz') THEN
                       (on_time_until AT TIME ZONE 'America/Lima')::time
                     WHEN pg_typeof(on_time_until)::text IN ('timestamp without time zone','timestamp') THEN
                       (on_time_until)::time
                     WHEN pg_typeof(on_time_until)::text IN ('time without time zone','time') THEN
                       on_time_until::time
                     ELSE NULL
                   END;
        EXCEPTION WHEN others THEN
          -- Si algo falla, lo dejamos NULL y se podrá reconfigurar desde el panel
          NULL;
        END;

        ALTER TABLE qr_windows DROP COLUMN on_time_until;
        ALTER TABLE qr_windows RENAME COLUMN on_time_until_tmp TO on_time_until;
      END IF;
    END $$;
  `);

  // FK opcional created_by -> users(id)
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
          NULL;
        END;
      END IF;
    END $$;
  `);

  // Índices en qr_windows
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='qr_windows' AND column_name='token'
      ) THEN
        CREATE INDEX IF NOT EXISTS idx_qr_windows_token ON qr_windows(token);
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='qr_windows' AND column_name='expires_at'
      ) THEN
        CREATE INDEX IF NOT EXISTS idx_qr_windows_expires_at ON qr_windows(expires_at);
      END IF;
    END $$;
  `);

  /* ========= ATTENDANCE ========= */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      qr_token TEXT
    );
  `);

  // Quitar columna legacy 'day' si existe
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='attendance' AND column_name='day'
      ) THEN
        ALTER TABLE attendance DROP COLUMN day;
      END IF;
    END $$;
  `);

  // Asegurar columna status (puntual/tardanza)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='attendance' AND column_name='status'
      ) THEN
        ALTER TABLE attendance ADD COLUMN status TEXT;
      END IF;
    END $$;
  `);

  // FK attendance.user_id -> users(id) (suave)
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

  // Limpiar índices legacy (marked_day/day) y el anterior por UTC si existiera
  await pool.query(`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname='public' AND indexdef ILIKE '%marked_day%'
      LOOP
        EXECUTE format('DROP INDEX IF EXISTS %I', r.indexname);
      END LOOP;

      IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_attendance_user_day') THEN
        DROP INDEX uniq_attendance_user_day;
      END IF;

      IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_attendance_user_marked_day') THEN
        DROP INDEX uniq_attendance_user_marked_day;
      END IF;

      IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_attendance_user_day_expr') THEN
        DROP INDEX uniq_attendance_user_day_expr;
      END IF;
    END $$;
  `);

  // Índices correctos
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id);`);

  // Única asistencia por día (día en America/Lima)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_attendance_user_day_lima
    ON attendance (user_id, ((marked_at AT TIME ZONE 'America/Lima')::date));
  `);

  console.log("✅ DB init completed (tablas/columnas/índices asegurados; on_time_until=TIME; status en attendance; día Lima)");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
