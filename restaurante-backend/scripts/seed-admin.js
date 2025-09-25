import "dotenv/config";
import { pool } from "../src/lib/db.js";
import bcrypt from "bcryptjs";
import { customAlphabet } from "nanoid";

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 24);

// Usa variables de entorno si quieres personalizar
const EMAIL = process.env.ADMIN_EMAIL || "admin1@demo.com";
const PASS  = process.env.ADMIN_PASSWORD || "Admin123!";
const NAME  = process.env.ADMIN_FULLNAME || "Administrador";

try {
  const exists = await pool.query("SELECT 1 FROM users WHERE email=$1", [EMAIL.toLowerCase()]);
  if (exists.rowCount) {
    console.log(`Ya existe un usuario con email ${EMAIL}. No se creó otro.`);
    process.exit(0);
  }

  const id = nano();
  const hash = await bcrypt.hash(PASS, 10);

  await pool.query(
    `INSERT INTO users (id, email, password, role, full_name, phone, active)
     VALUES ($1,$2,$3,'ADMIN',$4,NULL,true)`,
    [id, EMAIL.toLowerCase(), hash, NAME]
  );

  const rs = await pool.query(
    `SELECT id, email, role, full_name, employee_no, active, created_at
     FROM users WHERE id=$1`, [id]
  );

  console.log("✅ Admin creado:");
  console.table(rs.rows);
  console.log("\nCredenciales:");
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASS}`);
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
