// src/controllers/ai.controller.js

// Si tu runtime es Node 18+ tienes fetch nativo.
// Si usas una versión anterior, descomenta la siguiente línea e instala node-fetch:
// const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/** ====================== Utilidades ====================== **/

/**
 * Recorta JSON grande para no exceder tokens.
 */
function safeJson(obj, maxChars = 18000) {
  try {
    const s = JSON.stringify(obj ?? {}, null, 2);
    if (s.length <= maxChars) return s;
    return s.slice(0, maxChars) + "\n/* ...recortado... */";
  } catch {
    return "{}";
  }
}

/**
 * Pequeño guard de intención: permite preguntas sobre asistencia, empleados, puntualidad, etc.
 */
function isAllowedQuestion(q = "") {
  const EXTENDED_HINTS = [
    "empleado", "empleados", "trabajador", "trabajadores", "persona", "personal",
    "asistencia", "asistencias", "tardanza", "tardanzas", "puntual", "puntualidad",
    "faltó", "faltas", "falta", "quién", "quien", "cuántos", "cuantos", "total",
    "inventario", "gráfico", "grafico", "barras", "pastel", "pie", "semana", "día", "dia"
  ];
  const l = q.toLowerCase();
  return EXTENDED_HINTS.some(h => l.includes(h));
}

/**
 * Llama a la API de OpenAI (chat completions) sin SDK.
 */
async function askOpenAI({ messages, model = "gpt-4o-mini", temperature = 0.2 }) {
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
      messages,
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
 * System prompt orientado a RRHH + panel.
 */
function buildSystemMsg() {
  return {
    role: "system",
    content: `
Eres un analista de recursos humanos y datos operativos.
Puedes responder sobre:
1) Asistencia general y diaria de empleados (puntuales, tardanzas, faltas, ausencias).
2) Información por trabajador (nombre, usuario, correo, estado, métricas de asistencia).
3) Cantidad total de trabajadores activos/inactivos y resúmenes por periodo.
4) Interpretación de gráficos del panel (barras, pastel, tendencias) relacionados a asistencia e inventario.

Reglas:
- Usa EXCLUSIVAMENTE los datos de contexto que te envío (empleados, asistencia, inventario).
- Si un dato no está en el contexto, dilo claramente y pide el dato faltante.
- Responde en español, en 1-4 frases claras. Si el usuario pide detalle, puedes extenderte con viñetas.
- Si piden datos por una persona específica, intenta empatar por nombre o username exacto (con sensibilidad básica a tildes).
- No inventes cifras. No asumas periodos si no se indican. Indica el rango temporal si está en el contexto.
`
  };
}

/**
 * Construye el mensaje de usuario incluyendo la pregunta + contexto serializado.
 */
function buildUserMsg({ question, attendance, employees, inventory, meta }) {
  const ctx = [
    `Pregunta del usuario:\n${question || ""}`,
    `\n\n--- CONTEXTO DISPONIBLE ---`,
    `Asistencia (JSON):\n${safeJson(attendance)}`,
    `\nEmpleados (JSON):\n${safeJson(employees)}`,
    `\nInventario (JSON):\n${safeJson(inventory)}`,
  ];
  if (meta) ctx.push(`\nMeta (JSON):\n${safeJson(meta)}`);
  return { role: "user", content: ctx.join("\n") };
}

/** ====================== Controladores ====================== **/

/**
 * Endpoint existente: preguntas sobre panel/gráficos, ahora extendido a RRHH.
 * Espera body: { question, attendance?, employees?, inventory?, meta? }
 */
async function chartQA(req, res) {
  try {
    const { question, attendance, employees, inventory, meta } = req.body || {};

    if (!question || !isAllowedQuestion(question)) {
      return res.json({
        ok: true,
        answer:
          "Puedo responder sobre asistencias, empleados, puntualidad, tardanzas, ausencias y la interpretación de gráficos del panel.",
      });
    }

    const messages = [
      buildSystemMsg(),
      buildUserMsg({ question, attendance, employees, inventory, meta }),
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
 * Nuevo endpoint opcional especializado en RRHH.
 * Espera body: { question, employees, attendance?, meta? }
 */
async function hrQA(req, res) {
  try {
    const { question, attendance, employees, meta } = req.body || {};

    if (!question || !isAllowedQuestion(question)) {
      return res.json({
        ok: true,
        answer:
          "Este endpoint responde preguntas de RRHH: totales de empleados, asistencias, tardanzas y detalles por persona.",
      });
    }

    const system = buildSystemMsg();
    // Refuerza que aquí el foco es RRHH:
    system.content += `
- Este endpoint está especializado en RRHH. Prioriza responder con conteos de empleados, estados y métricas por persona.`;

    const messages = [
      system,
      buildUserMsg({ question, attendance, employees, inventory: undefined, meta }),
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
