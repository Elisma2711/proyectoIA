import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/classify.js";

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

async function callHandler({ method = "POST", body, apiKey = "test-key" } = {}) {
  const req = { method, body };
  const res = createResponse();
  const originalApiKey = process.env.GEMINI_API_KEY;
  if (apiKey === undefined || apiKey === null) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = apiKey;
  try {
    await handler(req, res);
  } finally {
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  }
  return res;
}

test("rejects methods other than POST", async () => {
  const response = await callHandler({ method: "GET" });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, "POST");
});

test("reports a missing Gemini API key", async () => {
  const response = await callHandler({
    body: { articles: ["Taza"], zones: ["Hogar"] },
    apiKey: null,
  });
  assert.equal(response.statusCode, 500);
  assert.match(response.body.error, /GEMINI_API_KEY/);
});

test("validates required articles before calling Gemini", async () => {
  const response = await callHandler({ body: { articles: [], zones: ["Hogar"] } });
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /artículos/);
});

test("returns structured classifications and ignores learned examples for unknown zones", async (context) => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  let requestUrl;
  let requestHeaders;
  globalThis.fetch = async (url, options) => {
    requestUrl = url;
    requestBody = JSON.parse(options.body);
    requestHeaders = options.headers;
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                classifications: [{
                  item: "ignored model text",
                  family: "Vajilla",
                  zone: "hogar",
                  confidence: 0.92,
                  reason: "Artículo de uso doméstico.",
                }],
              }),
            }],
          },
        }],
      }),
    };
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await callHandler({
    body: {
      articles: ["Taza de cerámica"],
      zones: ["Hogar", "Depósito"],
      examples: [
        { item: "Plato", family: "Vajilla", zone: "Hogar" },
        { item: "Ejemplo inválido", family: "Otro", zone: "Zona inventada" },
      ],
    },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.classifications, [{
    item: "Taza de cerámica",
    family: "Vajilla",
    zone: "Hogar",
    confidence: 0.92,
    reason: "Artículo de uso doméstico.",
  }]);
  assert.equal(requestBody.contents[0].parts[0].text.includes("Zona inventada"), false);
  assert.equal(requestHeaders["x-goog-api-key"], "test-key");
  assert.equal(requestUrl.includes("test-key"), false);
  assert.match(requestUrl, /models\/gemini-3\.6-flash:generateContent$/);
});

test("rejects a model response that assigns an unknown zone", async (context) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              classifications: [{
                item: "Taza",
                family: "Vajilla",
                zone: "Zona inventada",
                confidence: 0.9,
                reason: "Motivo.",
              }],
            }),
          }],
        },
      }],
    }),
  });
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await callHandler({ body: { articles: ["Taza"], zones: ["Hogar"] } });
  assert.equal(response.statusCode, 502);
  assert.match(response.body.error, /Gemini devolvió/);
});
