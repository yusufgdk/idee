#!/usr/bin/env python3
"""Liest ein Lexmark Service-Manual (PDF) und erzeugt die Daten für die Web-App.

Beispiel:
    python tools/extract.py manuals/cs720.pdf --family cs72x \
        --models CS720,CS725,CX725 --manual "Lexmark CS72x Service Manual"

Ergebnis: docs/data/<family>.json und ein Eintrag in docs/data/index.json.

Vorgehen:
  1. Parts-Catalog: Zeilen mit Lexmark-Teilenummer (z. B. 41X1228) + Beschreibung.
  2. Fehlercodes: Zeilen, die mit einem Code beginnen (z. B. 121.04).
  3. Zuordnung: "Replace the ..."-Schritte beim Code bzw. im verlinkten
     Service-Check ("Go to “...”") werden mit den Teilebeschreibungen abgeglichen.
Es werden nur Teilenummern ausgegeben, die im Parts-Catalog des Manuals stehen.
Die Ergebnisse sind heuristisch – Stichproben gegen das PDF prüfen.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"

PN_RE = re.compile(r"\b(\d{2}[A-Z]\d{4})\b")
PART_LINE_RE = re.compile(
    r"^\s*(?:\d+\s+)?(?P<pn>\d{2}[A-Z]\d{4})\s+(?:(?:\d+|NS|NP)\s+){0,2}(?P<desc>[A-Za-z].+?)\s*$"
)
CODE_LINE_RE = re.compile(r"^\s*(?P<code>\d{2,3}\.[0-9Xx]{2,3}[A-Z]?)\s+(?P<rest>\S.*)$")
GOTO_RE = re.compile(r"Go to [“\"](?P<title>[^”\"]+)[”\"]")
REPLACE_RE = re.compile(r"Replace the (?P<what>[^.,;]+?)(?:\.|,|;| See | and |$)", re.I)
VOLT_RE = re.compile(r"\b(1[01][05]|2[23]0)\s?-?\s?V\b", re.I)
STOP = {"the", "a", "an", "assembly", "asm", "and", "or", "of", "kit", "if", "with", "to", "see", "unit"}


def words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP}


def read_pdf(path: Path) -> list[str]:
    import pdfplumber  # erst hier importieren, damit Tests ohne PDF laufen

    with pdfplumber.open(path) as pdf:
        return [page.extract_text() or "" for page in pdf.pages]


def parse_parts(pages: list[str]) -> dict[str, dict]:
    parts: dict[str, dict] = {}
    for no, text in enumerate(pages, start=1):
        for line in text.splitlines():
            m = PART_LINE_RE.match(line)
            if not m or m["pn"] in parts:
                continue
            desc = m["desc"].strip()
            part = {"name": desc, "page": no}
            v = VOLT_RE.search(desc)
            if v:
                part["voltage"] = "230V" if v[1] in ("220", "230") else f"{v[1]}V"
            parts[m["pn"]] = part
    return parts


def find_section(pages: list[str], title: str) -> str:
    """Text des Abschnitts mit dieser Überschrift (Inhaltsverzeichnis wird übersprungen)."""
    t = title.strip().lower()
    for no, text in enumerate(pages):
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if line.strip().lower() == t:  # TOC-Zeilen enden mit "....  123"
                rest = "\n".join(lines[i + 1:])
                nxt = pages[no + 1] if no + 1 < len(pages) else ""
                return rest + "\n" + nxt
    return ""


def parse_errors(pages: list[str]) -> list[dict]:
    errors: list[dict] = []
    seen: set[str] = set()
    for no, text in enumerate(pages, start=1):
        lines = text.splitlines()
        for i, line in enumerate(lines):
            m = CODE_LINE_RE.match(line)
            if not m:
                continue
            code = m["code"].lower()
            if code in seen or PN_RE.search(line) or "...." in line:
                continue
            body = [m["rest"]]
            for nxt in lines[i + 1:i + 8]:
                if CODE_LINE_RE.match(nxt):
                    break
                body.append(nxt.strip())
            full = " ".join(body)
            title = re.split(r"(?<=[a-z])\.\s|Go to|Replace the|Note:", full)[0].strip(" .")
            errors.append({"code": code, "title": title[:160], "text": full, "page": no})
            seen.add(code)
    return errors


def components(text: str, pages: list[str]) -> list[str]:
    found = [m["what"].strip() for m in REPLACE_RE.finditer(text)]
    for g in GOTO_RE.finditer(text):
        section = find_section(pages, g["title"])
        found += [m["what"].strip() for m in REPLACE_RE.finditer(section[:4000])]
    return list(dict.fromkeys(found))


def match_parts(component: str, parts: dict[str, dict]) -> list[str]:
    want = words(component)
    if not want:
        return []
    best, best_pns = 0.0, []
    for pn, p in parts.items():
        have = words(p["name"])
        score = len(want & have) / len(want)
        if score > best:
            best, best_pns = score, [pn]
        elif score == best and score > 0:
            best_pns.append(pn)
    return best_pns if best >= 0.99 else []


def build(pages: list[str], family: str, models: list[str], manual: str, url: str) -> dict:
    parts = parse_parts(pages)
    errors = []
    for e in parse_errors(pages):
        comps = components(e["text"], pages)
        frus = list(dict.fromkeys(pn for c in comps for pn in match_parts(c, parts)))
        action = "; ".join(f"Replace the {c}" for c in comps)
        errors.append({"code": e["code"], "title": e["title"], "action": action,
                       "frus": frus, "page": e["page"]})
    used = {f for e in errors for f in e["frus"]}
    assert used <= parts.keys(), "Teilenummer ohne Eintrag im Parts-Catalog"
    return {
        "family": family,
        "title": manual,
        "demo": False,
        "models": models,
        "source": {"manual": manual + " (PDF-Seite)", "url": url},
        "parts": parts,
        "errors": errors,
    }


def update_index(family: str, models: list[str]) -> None:
    path = DATA / "index.json"
    index = json.loads(path.read_text(encoding="utf-8"))
    fams = [f for f in index["families"] if f["family"] != family]
    fams.append({"family": family, "file": f"{family}.json", "models": models})
    index["families"] = fams
    path.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", type=Path, help="Service-Manual als PDF")
    ap.add_argument("--family", required=True, help="Kurzname, z. B. cs72x")
    ap.add_argument("--models", required=True, help="Kommagetrennt, z. B. CS720,CS725,CX725")
    ap.add_argument("--manual", required=True, help="Name des Manuals für die Quellenangabe")
    ap.add_argument("--url", default="", help="Download-Link des Manuals")
    args = ap.parse_args(argv)

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    data = build(read_pdf(args.pdf), args.family, models, args.manual, args.url)
    out = DATA / f"{args.family}.json"
    out.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    update_index(args.family, models)

    with_fru = sum(1 for e in data["errors"] if e["frus"])
    print(f"{out}: {len(data['errors'])} Fehlercodes ({with_fru} mit Teilenummer), "
          f"{len(data['parts'])} Teile", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
