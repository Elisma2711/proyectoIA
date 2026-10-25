const STORAGE_KEY = "ordena.learned-labels.v1";
const MAX_ITEMS = 100;
const MAX_EXAMPLES = 200;

const form = document.querySelector("#classify-form");
const articlesField = document.querySelector("#articles");
const zonesField = document.querySelector("#zones");
const countLabel = document.querySelector("#article-count");
const statusLabel = document.querySelector("#form-status");
const classifyButton = document.querySelector("#classify-button");
const resultsPanel = document.querySelector("#results-panel");
const resultsSummary = document.querySelector("#results-summary");
const zoneGroups = document.querySelector("#zone-groups");
const saveLabelsButton = document.querySelector("#save-labels-button");
const learningCopy = document.querySelector("#learning-copy");
const downloadButton = document.querySelector("#download-button");
const memoryCount = document.querySelector("#memory-count");

let classifications = [];
let currentZones = [];
let learnedExamples = readLearnedExamples();

function readLearnedExamples() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved)
      ? saved.filter(isLearnedExample).slice(-MAX_EXAMPLES)
      : [];
  } catch (error) {
    console.error("No se pudieron leer las etiquetas guardadas.", error);
    return [];
  }
}

function isLearnedExample(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.item === "string"
    && typeof value.zone === "string"
    && typeof value.family === "string";
}

function updateMemoryCount() {
  memoryCount.textContent = String(learnedExamples.length);
}

function getArticleNames() {
  return articlesField.value
    .split(/\r?\n/)
    .map((article) => article.trim())
    .filter(Boolean);
}

function getZones() {
  return zonesField.value
    .split(/[\n,]/)
    .map((zone) => zone.trim())
    .filter(Boolean)
    .filter((zone, index, zones) => zones.findIndex((candidate) => candidate.toLocaleLowerCase() === zone.toLocaleLowerCase()) === index);
}

function updateArticleCount() {
  const count = getArticleNames().length;
  countLabel.textContent = `${count} ${count === 1 ? "artículo" : "artículos"}`;
}

function setStatus(message, type = "error") {
  statusLabel.textContent = message;
  statusLabel.classList.toggle("success", type === "success");
  statusLabel.classList.toggle("info", type === "info");
}

function hasChanges(classification) {
  return classification.zone !== classification.originalZone
    || classification.family !== classification.originalFamily;
}

function updateLearningControls() {
  const pending = classifications.filter(hasChanges).length;
  saveLabelsButton.disabled = pending === 0;
  learningCopy.textContent = pending > 0
    ? `${pending} ${pending === 1 ? "artículo corregido" : "artículos corregidos"} listo${pending === 1 ? "" : "s"} para guardar como ejemplo.`
    : "Guardá tus correcciones para usarlas como ejemplos la próxima vez.";
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderResults() {
  zoneGroups.replaceChildren();

  for (const zone of currentZones) {
    const items = classifications.filter((classification) => classification.zone === zone);
    if (items.length === 0) continue;

    const card = createElement("section", "zone-card");
    const header = createElement("div", "zone-card-header");
    header.append(
      createElement("h3", "zone-name", zone),
      createElement("span", "zone-count", `${items.length} ${items.length === 1 ? "artículo" : "artículos"}`),
    );
    const list = createElement("ul", "zone-items");

    for (const classification of items) {
      const row = createElement("li", "item-row");
      const name = createElement("span", "item-name", classification.item);
      const family = document.createElement("input");
      family.className = "family-field";
      family.type = "text";
      family.maxLength = 80;
      family.value = classification.family;
      family.setAttribute("aria-label", `Familia de ${classification.item}`);
      family.placeholder = "Familia";
      family.addEventListener("input", () => {
        classification.family = family.value.trim();
        updateLearningControls();
      });

      const zoneSelect = document.createElement("select");
      zoneSelect.className = "zone-select";
      zoneSelect.setAttribute("aria-label", `Zona de ${classification.item}`);
      for (const optionZone of currentZones) {
        const option = document.createElement("option");
        option.value = optionZone;
        option.textContent = optionZone;
        option.selected = optionZone === classification.zone;
        zoneSelect.append(option);
      }
      zoneSelect.addEventListener("change", () => {
        classification.zone = zoneSelect.value;
        renderResults();
      });

      const reason = createElement(
        "p",
        "item-reason",
        `${classification.reason} · Confianza estimada: ${Math.round(classification.confidence * 100)}%`,
      );
      reason.title = `Confianza estimada: ${Math.round(classification.confidence * 100)}%`;
      row.append(name, family, zoneSelect, reason);
      list.append(row);
    }

    card.append(header, list);
    zoneGroups.append(card);
  }

  resultsSummary.textContent = `${classifications.length} ${classifications.length === 1 ? "artículo clasificado" : "artículos clasificados"} en ${currentZones.length} zonas disponibles. Revisá las sugerencias antes de usar los resultados.`;
  updateLearningControls();
  resultsPanel.hidden = false;
}

async function classifyArticles(event) {
  event.preventDefault();
  setStatus("");

  if (window.location.protocol === "file:") {
    setStatus("Abriste el HTML directamente. Para usar la aplicación, ejecutá `npm run dev` en la carpeta del proyecto y abrí http://127.0.0.1:3001.", "info");
    return;
  }

  const articles = getArticleNames();
  const zones = getZones();
  if (articles.length === 0) {
    setStatus("Ingresá al menos un artículo, uno por línea.");
    return;
  }
  if (articles.length > MAX_ITEMS) {
    setStatus(`Podés clasificar hasta ${MAX_ITEMS} artículos por vez.`);
    return;
  }
  if (zones.length === 0) {
    setStatus("Ingresá al menos una zona disponible.");
    return;
  }
  if (zones.length > 30) {
    setStatus("Podés definir hasta 30 zonas.");
    return;
  }

  const examples = learnedExamples
    .filter((example) => zones.some((zone) => zone.toLocaleLowerCase() === example.zone.toLocaleLowerCase()))
    .slice(-30);

  classifyButton.disabled = true;
  classifyButton.querySelector("span").textContent = "Clasificando…";
  try {
    const response = await fetch("/api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articles, zones, examples }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.error) throw new Error(data.error);
      if (response.status === 404) {
        throw new Error("No encuentro la API de clasificación. Iniciá la aplicación con `npm run dev` desde la carpeta del proyecto.");
      }
      throw new Error(`La API respondió con el error ${response.status}. Revisá que el servidor local siga activo e intentá nuevamente.`);
    }

    currentZones = zones;
    classifications = data.classifications.map((classification) => ({
      ...classification,
      originalZone: classification.zone,
      originalFamily: classification.family,
    }));
    renderResults();
    setStatus("Listo. Revisá las zonas y ajustá las etiquetas si hace falta.", "success");
  } catch (error) {
    if (error instanceof TypeError) {
      setStatus("No pude conectar con la API. Iniciá la aplicación con `npm run dev` desde la carpeta del proyecto y abrí http://127.0.0.1:3001.");
    } else {
      setStatus(error instanceof Error ? error.message : "Ocurrió un error al clasificar.");
    }
  } finally {
    classifyButton.disabled = false;
    classifyButton.querySelector("span").textContent = "Clasificar artículos";
  }
}

function saveCorrections() {
  const corrections = classifications.filter(hasChanges);
  if (corrections.length === 0) return;
  if (corrections.some((correction) => !correction.family.trim())) {
    setStatus("Completá la familia de cada artículo corregido antes de guardar las etiquetas.");
    return;
  }

  for (const correction of corrections) {
    const key = correction.item.trim().toLocaleLowerCase();
    const existingIndex = learnedExamples.findIndex((example) => example.item.trim().toLocaleLowerCase() === key);
    const example = {
      item: correction.item,
      family: correction.family,
      zone: correction.zone,
    };
    if (existingIndex >= 0) learnedExamples.splice(existingIndex, 1);
    learnedExamples.push(example);
  }
  learnedExamples = learnedExamples.slice(-MAX_EXAMPLES);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(learnedExamples));
  } catch (error) {
    console.error("No se pudieron guardar las etiquetas.", error);
    setStatus("No se pudieron guardar las etiquetas en este navegador. Revisá el espacio disponible.", "error");
    return;
  }

  for (const classification of corrections) {
    classification.originalZone = classification.zone;
    classification.originalFamily = classification.family;
  }
  updateMemoryCount();
  updateLearningControls();
  setStatus(`${corrections.length} ${corrections.length === 1 ? "etiqueta guardada" : "etiquetas guardadas"} para futuras clasificaciones en este navegador.`, "success");
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function downloadCsv() {
  const rows = [
    ["Artículo", "Familia", "Zona", "Confianza", "Motivo"],
    ...classifications.map(({ item, family, zone, confidence, reason }) => [
      item,
      family,
      zone,
      `${Math.round(confidence * 100)}%`,
      reason,
    ]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "articulos-por-zona.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

form.addEventListener("submit", classifyArticles);
articlesField.addEventListener("input", updateArticleCount);
saveLabelsButton.addEventListener("click", saveCorrections);
downloadButton.addEventListener("click", downloadCsv);
updateArticleCount();
updateMemoryCount();
if (window.location.protocol === "file:") {
  setStatus("Para clasificar artículos, ejecutá `npm run dev` en la carpeta del proyecto y abrí http://127.0.0.1:3001.", "info");
}
