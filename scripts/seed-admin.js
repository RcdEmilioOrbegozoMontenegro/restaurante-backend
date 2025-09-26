// scripts/seed-admin.js (ESM)
import { pool } from '../src/lib/db.js';
import { customAlphabet } from 'nanoid';
import bcrypt from 'bcryptjs';

const nano = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 24);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@demo.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin123!';
const ADMIN_FULLNAME = process.env.ADMIN_FULLNAME || 'Administrador';

async function main() {
  // ¿Existe ya?
  const existing = await pool.query('SELECT id FROM users WHERE email=$1', [ADMIN_EMAIL]);
  if (existing.rowCount) {
    console.log('ℹ️ Admin ya existe:', ADMIN_EMAIL);
    return;
  }

  const id = nano();
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  await pool.query(
    `INSERT INTO users (id, email, password, role, full_name, active)
     VALUES ($1, $2, $3, 'ADMIN', $4, TRUE)`,
    [id, ADMIN_EMAIL, hash, ADMIN_FULLNAME]
  );

  console.log('✅ Admin creado:', ADMIN_EMAIL);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
