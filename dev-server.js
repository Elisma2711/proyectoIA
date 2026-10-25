import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import handler from "./api/classify.js";

const projectDirectory = fileURLToPath(new URL(".", import.meta.url));
const publicDirectory = resolve(projectDirectory, "public");
const maxBodyBytes = 1024 * 1024;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function loadEnvironmentFile(filename) {
  let contents;
  try {
    contents = await readFile(resolve(projectDirectory, filename), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("El cuerpo de la solicitud es demasiado grande.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("El cuerpo debe ser JSON válido.");
    error.statusCode = 400;
    throw error;
  }
}

async function serveApi(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, error.statusCode || 400, { error: error.message });
    return;
  }

  const apiResponse = {
    statusCode: 200,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    setHeader(name, value) {
      res.setHeader(name, value);
    },
    json(payload) {
      sendJson(res, this.statusCode, payload);
      return this;
    },
  };

  try {
    await handler({ method: req.method, body }, apiResponse);
  } catch (error) {
    console.error("Error inesperado en la API local.", error);
    if (!res.headersSent) sendJson(res, 500, { error: "Ocurrió un error interno en la API local." });
  }
}

async function serveStatic(pathname, res) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end("Ruta inválida.");
    return;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const filePath = resolve(publicDirectory, relativePath);
  if (filePath !== publicDirectory && !filePath.startsWith(`${publicDirectory}${sep}`)) {
    res.writeHead(403).end("Acceso denegado.");
    return;
  }

  try {
    const contents = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(contents);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      res.writeHead(404).end("No encontrado.");
      return;
    }
    console.error("No se pudo servir un archivo estático.", error);
    res.writeHead(500).end("No se pudo leer el archivo.");
  }
}

await loadEnvironmentFile(".env");
await loadEnvironmentFile(".env.local");

const port = Number.parseInt(process.env.PORT || "3001", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT debe ser un número entre 1 y 65535.");
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/api/classify") {
    await serveApi(req, res);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end("Método no permitido.");
    return;
  }

  await serveStatic(pathname, res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Ordena está disponible en http://127.0.0.1:${port}`);
});

server.on("error", (error) => {
  console.error("No se pudo iniciar el servidor local.", error);
  process.exitCode = 1;
});
