import "dotenv/config";
import { pool } from "../src/lib/db.js";
import bcrypt from "bcryptjs";

const adminPass = await bcrypt.hash("123456", 10);
const workerPass = await bcrypt.hash("123456", 10);

await pool.query(
  `INSERT INTO users (id,email,password,role)
   VALUES ('u_admin','admin@demo.com',$1,'ADMIN')
   ON CONFLICT (id) DO NOTHING`,
  [adminPass]
);

await pool.query(
  `INSERT INTO users (id,email,password,role)
   VALUES ('u_worker','worker@demo.com',$1,'WORKER')
   ON CONFLICT (id) DO NOTHING`,
  [workerPass]
);

console.log("Usuarios demo creados ✅");
process.exit(0);
