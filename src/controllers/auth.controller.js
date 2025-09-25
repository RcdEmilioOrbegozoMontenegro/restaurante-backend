import { pool } from "../lib/db.js"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || "12h" }
  )
}

// Login general: permite ADMIN o WORKER
export async function login(req, res) {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) return res.status(400).json({ error: "email y password requeridos" })

    const rs = await pool.query(
      `SELECT id, email, password, role, full_name, employee_no, active
       FROM users WHERE email=$1 LIMIT 1`,
      [String(email).toLowerCase()]
    )
    if (!rs.rowCount) return res.status(401).json({ error: "Credenciales inválidas" })

    const u = rs.rows[0]
    if (!u.active) return res.status(403).json({ error: "Usuario inactivo" })

    const ok = await bcrypt.compare(password, u.password)
    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" })

    const token = signToken(u)
    return res.json({
      token,
      user: {
        id: u.id,
        email: u.email,
        role: u.role,
        fullName: u.full_name,
        employeeNo: u.employee_no,
      },
    })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: "error en login" })
  }
}

// Login exclusivo ADMIN (útil para paneles protegidos de admin)
export async function loginAdmin(req, res) {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) return res.status(400).json({ error: "email y password requeridos" })

    const rs = await pool.query(
      `SELECT id, email, password, role, full_name, active
       FROM users WHERE email=$1 LIMIT 1`,
      [String(email).toLowerCase()]
    )
    if (!rs.rowCount) return res.status(401).json({ error: "Credenciales inválidas" })

    const u = rs.rows[0]
    if (!u.active) return res.status(403).json({ error: "Usuario inactivo" })
    if (u.role !== "ADMIN") return res.status(403).json({ error: "Solo ADMIN puede iniciar sesión aquí" })

    const ok = await bcrypt.compare(password, u.password)
    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" })

    const token = signToken(u)
    return res.json({
      token,
      user: { id: u.id, email: u.email, role: u.role, fullName: u.full_name },
    })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: "error en login" })
  }
}
