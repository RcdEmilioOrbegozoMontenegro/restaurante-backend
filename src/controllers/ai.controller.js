// src/controllers/ai.controller.js

// Node 18+ trae fetch nativo. Para Node <18 descomenta la siguiente línea e instala node-fetch.
// const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ======== Config del "AI Limiter" (ajustable por env) ========
const AI_LIMITER_ENABLED   = process.env.AI_LIMITER_ENABLED !== "false"; // por defecto ON
const AI_MAX_INPUT_CHARS   = Number(process.env.AI_MAX_INPUT_CHARS || 18000);
const AI_RATE_WINDOW_MS    = Number(process.env.AI_RATE_WINDOW_MS || 60_000); // 1 min
const AI_RATE_LIMIT        = Number(process.env.AI_RATE_LIMIT || 20); // 20 req/min por IP/usuario
const AI_MODEL             = process.env.AI_MODEL || "gpt-4o-mini";
const AI_TEMPERATURE       = Number(process.env.AI_TEMPERATURE || 0.2);
const AI_MAX_TOKENS        = Number(process.env.AI_MAX_TOKENS || 400);

// ======== Memoria simple para rate limit (reinicia al reiniciar el server) ========
const hits = new Map(); // key => { count, resetAt }

function getClientKey(req) {
  const ip =
    (req.headers["x-forwarded-for"]?.toString().split(",")[0] || "") ||
    req.ip ||
    req.connection?.remoteAddress ||
    "unknown";
  const uid = req.user?.id || req.userId || ""; // por si tienes auth middlewares
  return uid ? `u:${uid}` : `ip:${ip}`;
}

function checkRateLimit(req) {
  if (!AI_LIMITER_ENABLED) return { ok: true };

  const key = getClientKey(req);
  const now = Date.now();
  const rec = hits.get(key);

  if (!rec || now > rec.resetAt) {
    hits.set(key, { count: 1, resetAt: now + AI_RATE_WINDOW_MS });
    return { ok: true };
  }

  if (rec.count >= AI_RATE_LIMIT) {
    const waitMs = rec.resetAt - now;
    return { ok: false, message: `Límite de consultas alcanzado. Intenta en ${Math.ceil(waitMs / 1000)}s.` };
  }

  rec.count++;
  return { ok: true };
}

// ======== Utilidades ========

function normalize(str = "") {
  return String(str)
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .trim();
}

/**
 * Recorta JSON grande para no exceder tokens.
 */
function safeJson(obj, maxChars = AI_MAX_INPUT_CHARS) {
  try {
    const s = JSON.stringify(obj ?? {}, null, 2);
    if (s.length <= maxChars) return s;
    return s.slice(0, maxChars) + "\n/* ...recortado... */";
  } catch {
    return "{}";
  }
}

/**
 * Proyección mínima de empleados para evitar datos sensibles y reducir tokens.
 * Ajusta según tus campos disponibles (id, full_name, username, email, active, role, etc.)
 */
function projectEmployees(employees = []) {
  if (!Array.isArray(employees)) return [];
  const max = 500; // evita enviar miles al modelo
  return employees.slice(0, max).map((e) => {
    const a = e || {};
    return {
      id: a.id ?? a._id ?? null,
      full_name: a.full_name ?? a.fullName ?? a.name ?? a.username ?? null,
      username: a.username ?? null,
      email: a.email ?? null,
      active: typeof a.active === "boolean" ? a.active : undefined,
      role: a.role ?? undefined,
    };
  });
}

/**
 * Limita asistencia a lo necesario (resumen por día más totales).
 */
function projectAttendance(attendance = {}) {
  const a = attendance || {};
  const out = {
    from: a.from ?? null,
    to: a.to ?? null,
    userId: a.userId ?? "ALL",
    activeKeys: a.activeKeys ?? undefined,
    // summary ya viene en formato compacto (day, puntuales, tardanzas, faltas)
    summary: Array.isArray(a.summary) ? a.summary.slice(0, 366) : [],
    totalPie: Array.isArray(a.totalPie) ? a.totalPie : [],
    // NO reenviamos la lista completa de workers aquí; va aparte por projectEmployees
  };
  return out;
}

/**
 * Guard temático: solo deja pasar temas de asistencia/empleados/gráficos del panel.
 * (Restaurado y más estricto)
 */
function isAllowedQuestion(q = "") {
  const l = normalize(q).toLowerCase();

  // Tópicos permitidos (ajustables)
  const ALLOWED_HINTS = [
    "empleado", "empleados", "trabajador", "trabajadores", "personal",
    "asistencia", "asistencias", "tardanza", "tardanzas", "puntual", "puntualidad",
    "falta", "faltas", "ausencia", "ausencias",
    "quién", "quien", "cuántos", "cuantos", "total",
    "gráfico", "grafico", "barras", "pastel", "pie", "semana", "día", "dia",
    "resumen", "porcentaje", "tendencia"
  ];
  const allowed = ALLOWED_HINTS.some((h) => l.includes(h));

  // Bloqueos explícitos (credenciales, temas fuera de dominio, etc.)
  const DENY_HINTS = [
    "contraseña", "password", "token", "api key", "apikey", "clave",
    "tarjeta", "cvv", "dni", "dirección", "address",
    "banco", "cuenta", "transferencia",
    "política", "elección", "presidente", "mitre", "owasp", "osstmm", // evita salirse a temas random
  ];
  const denied = DENY_HINTS.some((h) => l.includes(h));

  return allowed && !denied;
}

/**
 * Mensaje al usuario cuando el guard bloquea.
 */
function limiterMessage() {
  return "Solo respondo sobre **asistencia de empleados, puntualidad/tardanzas/faltas** y **gráficos del panel**. " +
         "Ejemplos: “¿Total de tardanzas esta semana?”, “¿Quién faltó más?”, “Asistencia de Carla del lunes?”.";
}

/**
 * Llama a la API de OpenAI (chat completions) sin SDK.
 */
async function askOpenAI({ messages, model = AI_MODEL, temperature = AI_TEMPERATURE }) {
  if (!OPENAI_API_KEY) {
    return { ok: false, answer: "Falta configurar OPENAI_API_KEY en el backend." };
  }

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: AI_MAX_TOKENS,
      messages,
      // stop: ["</script>", "```"], // opcional si quieres cortar salidas no deseadas
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    return { ok: false, answer: `Error del proveedor IA (${resp.status}): ${errText}` };
  }

  const data = await resp.json();
  const answer = data?.choices?.[0]?.message?.content?.trim() || "No obtuve respuesta.";
  return { ok: true, answer };
}

/**
 * System prompt orientado a RRHH + panel, reforzado.
 */
function buildSystemMsg() {
  return {
    role: "system",
    content: `
Eres un analista de RRHH para un dashboard interno.
Respondes EXCLUSIVAMENTE sobre:
- Asistencia general y diaria (puntuales, tardanzas, faltas, ausencias).
- Información por trabajador (nombre/usuario/estado y métricas de asistencia).
- Totales de personal (activos/inactivos) y resúmenes por periodo.
- Interpretación de los gráficos del panel (barras, pastel, tendencias) de asistencia.

Reglas:
- Usa SOLO los datos del contexto recibido (empleados y asistencia). No inventes.
- Si un dato no está en el contexto, dilo y sugiere qué falta.
- Responde en español, claro y breve (1-4 frases; usa viñetas solo si se pide detalle).
- Si se pide por una persona, intenta empatar por nombre o username (sensibilidad básica a tildes).
- Indica el rango temporal cuando esté disponible (from/to).
- Si la pregunta está fuera de alcance (no asistencia/empleados/gráficos), responde que no puedes y recuerda el alcance.`,
  };
}

/**
 * Construye el mensaje de usuario incluyendo la pregunta + contexto minimizado.
 */
function buildUserMsg({ question, attendance, employees, inventory, meta }) {
  const ctx = [
    `Pregunta del usuario:\n${normalize(question || "")}`,
    `\n\n--- CONTEXTO DISPONIBLE ---`,
    `Asistencia (JSON):\n${safeJson(projectAttendance(attendance))}`,
    `\nEmpleados (JSON, minimizado):\n${safeJson(projectEmployees(employees))}`,
    // inventario no aplica aquí, pero lo dejamos para compatibilidad si algún día se usa:
    `\nInventario (JSON):\n${safeJson(inventory)}`,
  ];
  if (meta) ctx.push(`\nMeta (JSON):\n${safeJson(meta)}`);
  return { role: "user", content: ctx.join("\n") };
}

// ====================== Controladores ======================

/**
 * Endpoint existente: preguntas sobre panel/gráficos/empleados (con limiter).
 * Espera body: { question, attendance?, employees?, inventory?, meta? }
 */
async function chartQA(req, res) {
  try {
    // Rate limit
    const rl = checkRateLimit(req);
    if (!rl.ok) {
      return res.status(429).json({ ok: false, answer: rl.message });
    }

    const { question, attendance, employees, inventory, meta } = req.body || {};
    const q = normalize(question || "");

    // Guard temático
    if (AI_LIMITER_ENABLED && (!q || !isAllowedQuestion(q))) {
      return res.json({ ok: true, answer: limiterMessage() });
    }

    const messages = [
      buildSystemMsg(),
      buildUserMsg({ question: q, attendance, employees, inventory, meta }),
    ];

    const result = await askOpenAI({ messages });
    return res.json(result);
  } catch (err) {
    console.error("chartQA error:", err);
    return res.status(500).json({
      ok: false,
      answer: "Ocurrió un error interno procesando tu consulta.",
    });
  }
}

/**
 * Nuevo endpoint opcional especializado en RRHH (mismo limiter).
 * Espera body: { question, employees, attendance?, meta? }
 */
async function hrQA(req, res) {
  try {
    // Rate limit
    const rl = checkRateLimit(req);
    if (!rl.ok) {
      return res.status(429).json({ ok: false, answer: rl.message });
    }

    const { question, attendance, employees, meta } = req.body || {};
    const q = normalize(question || "");

    if (AI_LIMITER_ENABLED && (!q || !isAllowedQuestion(q))) {
      return res.json({
        ok: true,
        answer:
          "Este endpoint responde preguntas de RRHH sobre asistencia y empleados. " +
          "Ej.: “¿Total de empleados activos?”, “Asistencia de [Nombre] esta semana?”.",
      });
    }

    const system = buildSystemMsg();
    system.content += `
- Este endpoint prioriza conteos de empleados, estados y métricas por persona.`;

    const messages = [
      system,
      buildUserMsg({ question: q, attendance, employees, inventory: undefined, meta }),
    ];

    const result = await askOpenAI({ messages });
    return res.json(result);
  } catch (err) {
    console.error("hrQA error:", err);
    return res.status(500).json({
      ok: false,
      answer: "Ocurrió un error interno procesando tu consulta.",
    });
  }
}

module.exports = {
  chartQA,
  hrQA,
};
