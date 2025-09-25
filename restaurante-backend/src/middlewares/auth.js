import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Sin token" });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { sub, role, email }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token inválido" });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "No autenticado" });
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Solo ADMIN" });
  next();
}
