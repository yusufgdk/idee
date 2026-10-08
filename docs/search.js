// Suchlogik ohne Abhängigkeiten – läuft im Browser und in Node (Tests).

const STOPWORDS = new Set([
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "im", "in",
  "am", "an", "auf", "und", "oder", "mit", "ist", "sind", "wird", "werden",
  "druckt", "drucker", "macht", "zeigt", "bei", "von", "vom", "zu", "nicht",
  "the", "a", "an", "is", "of", "and", "or"
]);

// Allgemeine Wörter zählen bei der Bewertung weniger
const WEAK = new Set(["papier", "paper", "ausdruck", "druck", "seite", "blatt", "page", "print"]);

const CODE_RE = /^(\d{2,3})[.\s,\-]?([0-9x]{2,3})$/i;

// "12104" / "121 04" / "121,04" / "121.XX" -> "121.04" / "121.xx"
export function normalizeCode(input) {
  const s = String(input).trim().toLowerCase();
  const m = s.match(CODE_RE);
  if (m) return `${m[1]}.${m[2]}`;
  if (/^\d{2,3}$/.test(s)) return `${s}.`; // nur Hauptgruppe, z. B. "121"
  return null;
}

function codeScore(entryCode, q) {
  const e = entryCode.toLowerCase();
  if (q.endsWith(".")) return e.startsWith(q) ? 70 : 0;
  if (e === q) return 100;
  const [eMain, eSub] = e.split(".");
  const [qMain, qSub] = q.split(".");
  if (eMain !== qMain || eSub === undefined) return 0;
  if (/^x+$/.test(eSub)) return 80; // Eintrag "121.xx" passt zu "121.04"
  if (/^x+$/.test(qSub)) return 70; // Suche "121.xx" passt zu "121.04"
  return 0;
}

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFC")
    .split(/[^a-z0-9äöüß]+/)
    .filter(Boolean);
}

function levenshtein1(a, b) {
  // true, wenn a und b sich um höchstens 1 Zeichen unterscheiden
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

// Ein Suchwort -> Menge englischer/deutscher Begriffe, die im Text vorkommen dürfen
export function expandToken(token, synonyms) {
  const out = new Set([token]);
  const keys = Object.keys(synonyms).filter((k) => !k.startsWith("_"));
  for (const k of keys) {
    const fuzzy = token.length >= 5 && levenshtein1(token, k);
    if (k === token || fuzzy || (token.length >= 4 && token.startsWith(k) && k.length >= 4)) {
      out.add(k);
      for (const s of synonyms[k]) out.add(s);
    }
  }
  return out;
}

function haystackWords(entry, parts) {
  const partNames = (entry.frus || []).map((f) => parts[f]?.name || "");
  return tokenize([entry.code, entry.title, entry.action, ...partNames].join(" "));
}

function wordMatches(term, words) {
  return words.some((w) =>
    w === term ||
    (term.length >= 3 && w.startsWith(term)) ||
    (term.length >= 5 && levenshtein1(term, w))
  );
}

function textSearch(query, data, synonyms) {
  const tokens = tokenize(query).filter((t) => !STOPWORDS.has(t));
  const groups = tokens.map((t) => expandToken(t, synonyms));
  const weights = tokens.map((t) => (WEAK.has(t) ? 0.3 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  if (!groups.length) return [];
  const results = [];
  for (const entry of data.errors) {
    const words = haystackWords(entry, data.parts);
    let hit = 0;
    groups.forEach((g, i) => {
      if ([...g].some((t) => wordMatches(t, words))) hit += weights[i];
    });
    const ratio = hit / total;
    if (hit > 0 && ratio >= 0.5) results.push({ entry, score: Math.round(ratio * 60) });
  }
  return results;
}

// Hauptfunktion: liefert sortierte Treffer [{entry, score, kind}]
export function search(query, data, synonyms = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const code = normalizeCode(q);
  if (code) {
    const hits = data.errors
      .map((entry) => ({ entry, score: codeScore(entry.code, code), kind: "code" }))
      .filter((r) => r.score > 0);
    if (hits.length) return hits.sort((a, b) => b.score - a.score);
  }
  return textSearch(q, data, synonyms)
    .map((r) => ({ ...r, kind: "text" }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

// 230 V (Deutschland/EU) zuerst anzeigen
export function sortParts(frus, parts) {
  const rank = (f) => {
    const v = (parts[f]?.voltage || "").toLowerCase();
    if (v.startsWith("230") || v.startsWith("220")) return 0;
    if (!v) return 1;
    return 2;
  };
  return [...frus].sort((a, b) => rank(a) - rank(b));
}
