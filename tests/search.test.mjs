import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { search, normalizeCode, sortParts } from "../docs/search.js";

const data = JSON.parse(readFileSync(new URL("../docs/data/demo.json", import.meta.url)));
const syn = JSON.parse(readFileSync(new URL("../docs/data/synonyms.json", import.meta.url)));
const top = (q) => search(q, data, syn)[0]?.entry.code;

test("Code-Normalisierung", () => {
  assert.equal(normalizeCode("121.04"), "121.04");
  assert.equal(normalizeCode("12104"), "121.04");
  assert.equal(normalizeCode("121 04"), "121.04");
  assert.equal(normalizeCode("3140"), "31.40");
  assert.equal(normalizeCode("121.XX"), "121.xx");
  assert.equal(normalizeCode("papierstau"), null);
});

test("Fehlercodes", () => {
  assert.equal(top("121.04"), "121.04");
  assert.equal(top("12104"), "121.04");
  assert.equal(top("121.07"), "121.xx");   // Wildcard-Eintrag greift
  assert.equal(top("31.40"), "31.40");
  assert.equal(top("900.12"), "900.xx");
});

test("Problembeschreibungen auf Deutsch", () => {
  assert.equal(top("Papierstau Fach 2"), "242.01");
  assert.equal(top("Ausdruck ist verschmiert"), "SYMPTOM-SMEAR");
  assert.equal(top("Streifen auf dem Papier"), "SYMPTOM-STREAKS");
  assert.ok(search("Fixireinheit", data, syn).length > 0); // Tippfehler
  assert.ok(search("Fixireinheit", data, syn).every((r) => r.entry.frus.includes("DEMO-0001")));
  assert.equal(top("Stau beim Duplex"), "235.01");
});

test("Unbekanntes liefert keine Teilenummer", () => {
  assert.equal(search("999.99", data, syn).length, 0);
  assert.equal(search("Kaffeemaschine", data, syn).length, 0);
});

test("230 V zuerst", () => {
  assert.deepEqual(sortParts(["DEMO-0002", "DEMO-0001"], data.parts), ["DEMO-0001", "DEMO-0002"]);
});
