// scripts/seed-dummy-week.js
import { pool } from "../src/lib/db.js";
import bcrypt from "bcryptjs";
import { customAlphabet } from "nanoid";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

// Helpers ----------------------------------------------------

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

// Crea un Date a las 09:10 hora Lima para una fecha YYYY-MM-DD
function limaDateAt0910(yyyyMmDd) {
  // -05:00 fijo (Lima sin DST)
  return new Date(`${yyyyMmDd}T09:10:00.000-05:00`);
}

// Marca alrededor del límite (offset en minutos desde 09:10 Lima)
function limaDateAtOffset(yyyyMmDd, minutesOffset) {
  const base = new Date(`${yyyyMmDd}T09:10:00.000-05:00`);
  return new Date(base.getTime() + minutesOffset * 60 * 1000);
}

async function isOnTimeUntilTIME() {
  const rs = await pool.query(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_name='qr_windows' AND column_name='on_time_until'
    LIMIT 1
  `);
  const dt = rs.rows[0]?.data_type || "";
  return dt.includes("time") && !dt.includes("with time zone"); // "time without time zone"
}

// Data makers ------------------------------------------------

async function ensureWorker({ fullName, email, password, phone }) {
  const ex = await pool.query("SELECT id FROM users WHERE email=$1", [email.toLowerCase()]);
  if (ex.rowCount) return ex.rows[0].id;

  const id = nano();
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (id, email, password, role, full_name, phone, active)
     VALUES ($1,$2,$3,'WORKER',$4,$5,true)`,
    [id, email.toLowerCase(), hash, fullName, phone || null]
  );
  return id;
}

async function ensureQrForDay(yyyyMmDd, useTimeType) {
  const token = `SEED_QR_${yyyyMmDd.replace(/-/g, "")}`;
  const exists = await pool.query("SELECT id FROM qr_windows WHERE token=$1", [token]);
  if (exists.rowCount) return token;

  const id = nano();
  const label = `Seed turno ${yyyyMmDd}`;

  // on_time_until param según tipo de columna
  const onTimeUntilParam = useTimeType
    ? "09:10:00" // TIME '09:10:00'
    : limaDateAt0910(yyyyMmDd); // TIMESTAMPTZ equivalente

  await pool.query(
    `INSERT INTO qr_windows (id, token, label, on_time_until, created_at)
     VALUES ($1,$2,$3,$4,NOW())`,
    [id, token, label, onTimeUntilParam]
  );
  return token;
}

async function insertAttendanceIfNotExists({ userId, yyyyMmDd, markedAt, qrToken }) {
  // Evita duplicar por día (día UTC)
  const dup = await pool.query(
    `SELECT 1
     FROM attendance
     WHERE user_id=$1
       AND (marked_at AT TIME ZONE 'UTC')::date = $2::date`,
    [userId, yyyyMmDd]
  );
  if (dup.rowCount) return false;

  const id = nano();
  await pool.query(
    `INSERT INTO attendance (id, user_id, marked_at, qr_token)
     VALUES ($1,$2,$3,$4)`,
    [id, userId, markedAt, qrToken]
  );
  return true;
}

// Seed -------------------------------------------------------

async function seedWeek() {
  const useTimeType = await isOnTimeUntilTIME(); // TRUE => TIME, FALSE => TIMESTAMPTZ

  // 3 workers demo
  const users = [
    { fullName: "Ana Demo",   email: "ana.demo@example.com",   password: "demo123", phone: "999111222" },
    { fullName: "Bruno Demo", email: "bruno.demo@example.com", password: "demo123", phone: "999222333" },
    { fullName: "Carla Demo", email: "carla.demo@example.com", password: "demo123", phone: "999333444" },
  ];
  const userIds = [];
  for (const u of users) userIds.push(await ensureWorker(u));

  // últimos 7 días (incluye hoy)
  for (let i = 0; i < 7; i++) {
    const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dayStr = ymd(day); // YYYY-MM-DD en UTC (solo usamos la parte de fecha)

    // Asegura un QR del día con on_time_until correcto (TIME o TIMESTAMPTZ)
    const qrToken = await ensureQrForDay(dayStr, useTimeType);

    // offsets: -7 (puntual), +3 (puntual), +18 (tardanza)
    for (let u = 0; u < userIds.length; u++) {
      const mod = (i + u) % 3;
      const offsetMin = mod === 0 ? -7 : mod === 1 ? +3 : +18;
      const markedAt = limaDateAtOffset(dayStr, offsetMin); // TIMESTAMPTZ en DB
      await insertAttendanceIfNotExists({
        userId: userIds[u],
        yyyyMmDd: dayStr,
        markedAt,
        qrToken,
      });
    }
  }
}

async function main() {
  await seedWeek();
  console.log("✅ Seed de 1 semana cargado (sin tocar el esquema).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
