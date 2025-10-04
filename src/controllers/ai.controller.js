// src/controllers/ai.controller.js
import rateLimit from "express-rate-limit"

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"
const MAX_TOKENS = Number(process.env.OPENAI_MAX_TOKENS || 400)

// Palabras guía para “se ve relacionado con gráficos”
const ALLOWED_HINTS = [
  "asistencia","tardanza","tardanzas","puntual","puntuales","faltas",
  "gráfico","gráficos","inventario","categoría","porcentaje",
  "semana","día","pie","barras","distribución"
]

function isRelated(question = "") {
  const q = String(question).toLowerCase()
  return ALLOWED_HINTS.some(h => q.includes(h))
}

// Límite: 30 req/5min por IP
export const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
})

/**
 * POST /ai/chart-qa  (requireAuth + requireAdmin)
 * Body:
 *  - question: string
 *  - attendance: { from?, to?, userId?, activeKeys?, summary?, totalPie? }
 *  - inventory: { data: [{name, value}], description? }
 */
export async function chartQA(req, res) {
  try {
    const { question, attendance, inventory } = req.body || {}

    // Guardia 1: si no parece de gráficos => respuesta controlada
    if (!question || !isRelated(question)) {
      return res.json({
        ok: true,
        answer: "Solo respondo sobre los gráficos del panel administrador (asistencia e inventario).",
      })
    }

    const systemMsg = {
      role: "system",
      content:
        "Eres un analista de datos del panel ADMIN. SOLO puedes hablar sobre: " +
        "1) 'Asistencias de esta semana' (barras y pie con puntuales, tardanzas, faltas por día/total) " +
        "y 2) 'Distribución de inventario' (pie por categorías). " +
        "Si te preguntan algo fuera de eso, responde exactamente: " +
        "'No puedo ayudarte con eso; solo gráficos del panel administrador.' " +
        "Responde en español, muy breve y directo, citando métricas del contexto provisto sin inventar valores.",
    }

    const userMsg = {
      role: "user",
      content: [
        "Pregunta:", String(question),
        "\n\nContexto asistencia:", JSON.stringify(attendance ?? {}),
        "\n\nContexto inventario:", JSON.stringify(inventory ?? {}),
      ].join(" "),
    }

    const body = {
      model: MODEL,
      messages: [systemMsg, userMsg],
      temperature: 0.2,
      max_tokens: MAX_TOKENS,
    }

    const resp = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const text = await resp.text()
      return res.status(500).json({ ok: false, error: text })
    }

    const json = await resp.json()
    const answer = json?.choices?.[0]?.message?.content?.trim() || "No se obtuvo respuesta."

    // Guardia 2: si el modelo se desvió, recortamos
    const SAFE_PREFIX = "No puedo ayudarte con eso; solo gráficos del panel administrador."
    const looksSafe = isRelated(answer) || /gráficos del panel administrador/i.test(answer)
    const safeAnswer = looksSafe ? answer : SAFE_PREFIX

    return res.json({ ok: true, answer: safeAnswer })
  } catch (err) {
    console.error("chartQA error:", err)
    return res.status(500).json({ ok: false, error: "Error interno" })
  }
}
