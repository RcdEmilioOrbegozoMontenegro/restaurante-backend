// scripts/seed-users-and-attendance.js
import { pool } from "../src/lib/db.js";
import bcrypt from "bcryptjs";
import { customAlphabet } from "nanoid";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

// ----------------------- args -----------------------
function getArg(name, def) {
  const flag = `--${name}`;
  const kv = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (kv) return kv.split("=")[1];
  if (process.argv.includes(flag)) return true;
  return def;
}

const FROM = getArg("from", new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10)); // 7 días
const TO   = getArg("to",   new Date().toISOString().slice(0, 10));
const N_WORKERS = Number(getArg("workers", 10));
const P_PUNTUAL = Number(getArg("p_puntual", 0.65));
const P_TARDE   = Number(getArg("p_tarde",   0.20));
const P_FALTA   = Number(getArg("p_falta",   0.15));
const ALL_WORKERS = !!getArg("all-workers", false); // si true, usa todos los WORKER activos (no solo los seed)

// ----------------------- helpers -----------------------
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

function limaDateAt(yyyyMmDd, hh = 9, mm = 10) {
  // Lima (no DST) => -05:00
  const iso = `${yyyyMmDd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000-05:00`;
  return new Date(iso);
}
function limaDateOffsetFrom0910(yyyyMmDd, minutesOffset) {
  const base = limaDateAt(yyyyMmDd, 9, 10);
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
  return dt.includes("time") && !dt.includes("with time zone"); // TIME WITHOUT TZ
}

async function ensureSeedWorker(i) {
  const email = `seed.worker${String(i).padStart(2, "0")}@example.com`;
  const full = `Trabajador Seed ${String(i).padStart(2, "0")}`;
  const ex = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
  if (ex.rowCount) return ex.rows[0].id;

  const id = nano();
  const pass = await bcrypt.hash("demo123", 10);
  await pool.query(
    `INSERT INTO users (id, email, password, role, full_name, active)
     VALUES ($1,$2,$3,'WORKER',$4,true)`,
    [id, email.toLowerCase(), pass, full]
  );
  return id;
}

async function getWorkerIds() {
  if (ALL_WORKERS) {
    const rs = await pool.query(`SELECT id FROM users WHERE role='WORKER' AND COALESCE(active, true)`);
    return rs.rows.map(r => r.id);
  }
  const ids = [];
  for (let i = 1; i <= N_WORKERS; i++) ids.push(await ensureSeedWorker(i));
  return ids;
}

async function ensureQrForDay(yyyyMmDd, useTimeType) {
  const token = `SEED-${yyyyMmDd.replace(/-/g, "")}`;
  const ex = await pool.query("SELECT id FROM qr_windows WHERE token=$1", [token]);
  if (ex.rowCount) return token;

  const id = nano();
  const label = `Seed ${yyyyMmDd}`;
  const onTimeUntilParam = useTimeType ? "09:10:00" : limaDateAt(yyyyMmDd, 9, 10);

  await pool.query(
    `INSERT INTO qr_windows (id, token, label, on_time_until, created_at)
     VALUES ($1,$2,$3,$4,NOW())`,
    [id, token, label, onTimeUntilParam]
  );
  return token;
}

async function insertAttendanceIfAbsent({
  userId, yyyyMmDd, markedAt, qrToken, status, reasonCat, reasonText, reasonScore
}) {
  // Evita duplicado por día (día Lima)
  const dup = await pool.query(
    `SELECT 1 FROM attendance
     WHERE user_id=$1
       AND (marked_at AT TIME ZONE 'America/Lima')::date = $2::date`,
    [userId, yyyyMmDd]
  );
  if (dup.rowCount) return false;

  const id = nano();
  await pool.query(
    `INSERT INTO attendance
      (id, user_id, marked_at, qr_token, status, late_reason_category, late_reason_text, late_reason_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, userId, markedAt, `SEED-${qrToken}`, status, reasonCat || null, reasonText || null, reasonScore || null]
  );
  return true;
}

// ----------------------- razones -----------------------
const REASONS = [
  { cat: "Tráfico",     txt: "Atasco inusual en la vía" },
  { cat: "Transporte",  txt: "Retraso de bus/combi" },
  { cat: "Salud",       txt: "Malestar o cita médica" },
  { cat: "Documentos",  txt: "Trámite urgente" },
  { cat: "Permiso",     txt: "Permiso coordinado con supervisor" },
  { cat: "Familiar",    txt: "Asunto familiar" },
  { cat: "Clima",       txt: "Lluvia/condiciones climáticas" },
  { cat: "Otros",       txt: "Otro motivo" },
];

// ----------------------- main seed -----------------------
async function seed() {
  const useTimeType = await isOnTimeUntilTIME();
  const workerIds = await getWorkerIds();

  // rango de fechas
  const start = new Date(`${FROM}T00:00:00.000Z`);
  const end   = new Date(`${TO}T00:00:00.000Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    throw new Error(`Rango inválido: from=${FROM} to=${TO}`);
  }

  let insCount = 0;
  for (let ts = start.getTime(); ts <= end.getTime(); ts += 864e5) {
    const yyyyMmDd = new Date(ts).toISOString().slice(0,10);
    const qrToken = await ensureQrForDay(yyyyMmDd, useTimeType);

    for (const userId of workerIds) {
      const rnd = Math.random();
      if (rnd < P_PUNTUAL) {
        // puntual: offset entre [-40, 0] minutos respecto a 09:10
        const offset = randInt(-40, 0);
        const markedAt = limaDateOffsetFrom0910(yyyyMmDd, offset);
        if (await insertAttendanceIfAbsent({
          userId, yyyyMmDd, markedAt, qrToken,
          status: "puntual"
        })) insCount++;
      } else if (rnd < P_PUNTUAL + P_TARDE) {
        // tardanza: offset entre [1, 50] minutos
        const offset = randInt(1, 50);
        const markedAt = limaDateOffsetFrom0910(yyyyMmDd, offset);
        const r = pick(REASONS);
        if (await insertAttendanceIfAbsent({
          userId, yyyyMmDd, markedAt, qrToken,
          status: "tardanza",
          reasonCat: r.cat,
          reasonText: r.txt,
          reasonScore: randInt(60, 100),
        })) insCount++;
      } else {
        // falta: no insertamos fila
      }
    }
  }

  console.log(`✅ Seed listo. Insertadas ${insCount} asistencias.`);
}

// ----------------------- clean -----------------------
async function clean() {
  const del1 = await pool.query(`DELETE FROM attendance WHERE qr_token LIKE 'SEED-%'`);
  const del2 = await pool.query(`DELETE FROM qr_windows WHERE token LIKE 'SEED-%'`);
  const del3 = await pool.query(
    `DELETE FROM users WHERE role='WORKER' AND email LIKE 'seed.worker__@example.com'`
  );
  console.log(`🧹 Limpieza: attendance=${del1.rowCount}, qr_windows=${del2.rowCount}, users=${del3.rowCount}`);
}

// ----------------------- runner -----------------------
(async () => {
  try {
    if (getArg("clean", false)) {
      await clean();
    } else {
      console.log(`Seeding from=${FROM} to=${TO} workers=${N_WORKERS} (all-workers=${ALL_WORKERS}) …`);
      await seed();
    }
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
