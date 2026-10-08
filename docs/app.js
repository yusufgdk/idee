import { search, sortParts } from "./search.js";

const $ = (id) => document.getElementById(id);
const modelSel = $("model");
const input = $("q");
const results = $("results");
const banner = $("demo-banner");

let index = null;
let synonyms = {};
let data = null;
const cache = {};

function store(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = el("textarea");
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  btn.textContent = "Kopiert ✓";
  setTimeout(() => (btn.textContent = "Kopieren"), 1500);
}

function renderPart(fru) {
  const p = data.parts[fru] || {};
  const tags = [];
  if (p.voltage) tags.push(el("span", { class: "tag" }, p.voltage));
  const btn = el("button", { class: "copy", type: "button" }, "Kopieren");
  btn.addEventListener("click", () => copy(fru, btn));
  return el("div", { class: "part" },
    el("span", { class: "pn" }, fru),
    el("span", { class: "name" }, p.name || "", ...tags),
    btn);
}

function renderEntry({ entry }) {
  const isSymptom = entry.code.startsWith("SYMPTOM");
  const frus = sortParts(entry.frus || [], data.parts);
  const card = el("article", { class: "card" },
    el("div", { class: "code" }, isSymptom ? "Symptom" : `Fehler ${entry.code}`),
    el("div", { class: "title" }, entry.title));
  if (frus.length) frus.forEach((f) => card.append(renderPart(f)));
  else card.append(el("div", { class: "empty" },
    "Keine Teilenummer im Manual zugeordnet – Reparaturschritte im Manual prüfen."));
  if (entry.action) card.append(el("p", { class: "action" }, entry.action));
  const src = [data.source?.manual, entry.page ? `Seite ${entry.page}` : null].filter(Boolean).join(", ");
  if (src) card.append(el("div", { class: "src" }, `Quelle: ${src}`));
  return card;
}

function render() {
  results.replaceChildren();
  if (!data) return;
  const q = input.value.trim();
  if (!q) return;
  const hits = search(q, data, synonyms);
  if (!hits.length) {
    results.append(el("p", { class: "empty" },
      "Nichts gefunden. Code genau so eingeben, wie er am Display steht (z. B. 121.04), oder das Problem mit anderen Worten beschreiben."));
    return;
  }
  hits.forEach((h) => results.append(renderEntry(h)));
}

async function selectModel(model) {
  const fam = index.families.find((f) => f.models.includes(model));
  data = null;
  input.disabled = !fam;
  banner.hidden = true;
  if (!fam) { render(); return; }
  cache[fam.file] ??= await getJSON(`data/${fam.file}`);
  data = cache[fam.file];
  banner.hidden = !data.demo;
  store("model", model);
  render();
  input.focus();
}

async function init() {
  [index, synonyms] = await Promise.all([getJSON("data/index.json"), getJSON("data/synonyms.json")]);
  const models = index.families.flatMap((f) => f.models).sort();
  for (const m of models) modelSel.append(el("option", { value: m }, m));
  modelSel.addEventListener("change", () => selectModel(modelSel.value));
  input.addEventListener("input", render);
  const last = load("model");
  if (last && models.includes(last)) {
    modelSel.value = last;
    await selectModel(last);
  }
}

init().catch((e) => {
  results.replaceChildren(el("p", { class: "empty" }, `Daten konnten nicht geladen werden: ${e.message}`));
});
