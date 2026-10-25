const MAX_ITEMS = 100;
const MAX_ZONES = 30;
const MAX_EXAMPLES = 30;
const MAX_ARTICLE_LENGTH = 200;
const MAX_ZONE_LENGTH = 80;
const MAX_FAMILY_LENGTH = 80;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const responseSchema = {
  type: "OBJECT",
  properties: {
    classifications: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          item: { type: "STRING" },
          family: { type: "STRING" },
          zone: { type: "STRING" },
          confidence: { type: "NUMBER" },
          reason: { type: "STRING" },
        },
        required: ["item", "family", "zone", "confidence", "reason"],
        propertyOrdering: ["item", "family", "zone", "confidence", "reason"],
      },
    },
  },
  required: ["classifications"],
  propertyOrdering: ["classifications"],
};

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function isNonEmptyString(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function normalizeExamples(examples, zones) {
  if (!Array.isArray(examples)) return [];
  const allowedZones = new Set(zones.map((zone) => zone.toLocaleLowerCase()));
  return examples
    .filter((example) => example && typeof example === "object")
    .filter((example) => isNonEmptyString(example.item, MAX_ARTICLE_LENGTH))
    .filter((example) => isNonEmptyString(example.family, MAX_FAMILY_LENGTH))
    .filter((example) => isNonEmptyString(example.zone, MAX_ZONE_LENGTH))
    .filter((example) => allowedZones.has(example.zone.trim().toLocaleLowerCase()))
    .slice(-MAX_EXAMPLES)
    .map((example) => ({
      item: example.item.trim(),
      family: example.family.trim(),
      zone: zones.find((zone) => zone.toLocaleLowerCase() === example.zone.trim().toLocaleLowerCase()),
    }));
}

function parseModelResponse(payload, articles, zones) {
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini devolvió una respuesta vacía.");

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.classifications) || parsed.classifications.length !== articles.length) {
    throw new Error("Gemini devolvió una cantidad inesperada de artículos.");
  }

  const allowedZones = new Set(zones.map((zone) => zone.toLocaleLowerCase()));
  return parsed.classifications.map((result, index) => {
    if (!result || typeof result !== "object") throw new Error("Gemini devolvió una clasificación inválida.");
    if (typeof result.family !== "string" || result.family.trim().length === 0 || result.family.length > MAX_FAMILY_LENGTH) {
      throw new Error("Gemini devolvió una familia inválida.");
    }
    if (typeof result.zone !== "string" || !allowedZones.has(result.zone.trim().toLocaleLowerCase())) {
      throw new Error("Gemini asignó una zona que no está en la lista.");
    }
    if (typeof result.confidence !== "number" || result.confidence < 0 || result.confidence > 1) {
      throw new Error("Gemini devolvió un nivel de confianza inválido.");
    }
    if (typeof result.reason !== "string" || result.reason.trim().length === 0 || result.reason.length > 300) {
      throw new Error("Gemini devolvió una explicación inválida.");
    }
    return {
      item: articles[index],
      family: result.family.trim(),
      zone: zones.find((zone) => zone.toLocaleLowerCase() === result.zone.trim().toLocaleLowerCase()),
      confidence: result.confidence,
      reason: result.reason.trim(),
    };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "Método no permitido.");
  }

  if (!process.env.GEMINI_API_KEY) {
    return sendError(res, 500, "Falta configurar GEMINI_API_KEY en las variables de entorno.");
  }

  const { articles, zones, examples } = req.body || {};
  if (!Array.isArray(articles) || articles.length === 0 || articles.length > MAX_ITEMS) {
    return sendError(res, 400, `Enviá entre 1 y ${MAX_ITEMS} artículos.`);
  }
  if (!articles.every((article) => isNonEmptyString(article, MAX_ARTICLE_LENGTH))) {
    return sendError(res, 400, `Cada artículo debe tener entre 1 y ${MAX_ARTICLE_LENGTH} caracteres.`);
  }
  if (!Array.isArray(zones) || zones.length === 0 || zones.length > MAX_ZONES) {
    return sendError(res, 400, `Enviá entre 1 y ${MAX_ZONES} zonas.`);
  }
  if (!zones.every((zone) => isNonEmptyString(zone, MAX_ZONE_LENGTH))) {
    return sendError(res, 400, `Cada zona debe tener entre 1 y ${MAX_ZONE_LENGTH} caracteres.`);
  }

  const normalizedZones = zones.map((zone) => zone.trim());
  if (new Set(normalizedZones.map((zone) => zone.toLocaleLowerCase())).size !== normalizedZones.length) {
    return sendError(res, 400, "Las zonas no pueden estar repetidas.");
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const requestBody = {
    systemInstruction: {
      parts: [{
        text: [
          "Sos un asistente para organizar inventarios.",
          "Clasificá cada artículo en exactamente una de las zonas permitidas.",
          "Usá los ejemplos etiquetados como guía: priorizá la zona y la familia corregidas por el usuario para artículos iguales o similares.",
          "Inferí una familia breve y útil para cada artículo; usá una familia consistente para artículos parecidos.",
          "No inventes zonas, no omitas ni combines artículos. Conservá el texto de cada artículo.",
          "La confianza es una estimación de certeza entre 0 y 1. Si la descripción es ambigua, usá un valor bajo y explicalo.",
          "Devolvé únicamente el objeto JSON requerido por el esquema.",
        ].join(" "),
      }],
    },
    contents: [{
      role: "user",
      parts: [{
        text: JSON.stringify({
          zonasPermitidas: normalizedZones,
          ejemplosCorregidosPorElUsuario: normalizeExamples(examples, normalizedZones),
          articulos: articles.map((article) => article.trim()),
        }),
      }],
    }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema,
    },
  };

  let geminiResponse;
  try {
    geminiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    console.error("No se pudo conectar con Gemini.", error);
    return sendError(res, 502, "No se pudo conectar con Gemini. Revisá tu conexión e intentá nuevamente.");
  }

  if (!geminiResponse.ok) {
    console.error("Gemini rechazó la solicitud.", { status: geminiResponse.status });
    if (geminiResponse.status === 429) {
      return sendError(res, 503, "Gemini alcanzó el límite de solicitudes. Esperá un momento e intentá nuevamente.");
    }
    if (geminiResponse.status === 503) {
      return sendError(res, 503, "El modelo Gemini está temporalmente ocupado. Esperá unos segundos e intentá nuevamente.");
    }
    return sendError(res, 502, "Gemini no pudo procesar la lista. Revisá la configuración de la API e intentá nuevamente.");
  }

  let payload;
  try {
    payload = await geminiResponse.json();
    return res.status(200).json({
      classifications: parseModelResponse(payload, articles.map((article) => article.trim()), normalizedZones),
    });
  } catch (error) {
    console.error("Respuesta inválida recibida de Gemini.", error);
    return sendError(res, 502, "Gemini devolvió una respuesta que no se pudo interpretar. Intentá nuevamente.");
  }
}
