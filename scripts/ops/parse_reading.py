#!/usr/bin/env python
"""Parse the OCR text cache into structured reading items (CTW + AP).

Reads .codex-tmp/ocr/*.txt. The 2026-reform reading section is:
  - "Fill in the missing letters in the paragraph." -> cloze paragraphs (CTW).
    OCR shows the prose with truncated words at each blank (e.g. "popul" for
    "populations"); the answer key supplies the full words.
  - comprehension passages + multiple-choice questions (AP).

Best-effort structure + cleaned raw text (run-together fixed with wordninja).
Output: data/realExam2026/reading/{completeTheWords,academicPassage}.json
"""
import os, re, json, glob
import wordninja

ROOT = r"D:\toefl_writing"
CACHE = os.path.join(ROOT, ".codex-tmp", "ocr")
OUT = os.path.join(ROOT, "data", "realExam2026", "reading")
os.makedirs(OUT, exist_ok=True)

TIMER = re.compile(r"\d{1,2}:\d{2}:\d{2}")
NOISE = re.compile(r"Hide\s*Time|^Reading\b|^=+\s*PAGE|^\s*$", re.I)
FILL = re.compile(r"Fill in the missing letters", re.I)
QRANGE = re.compile(r"Questions?\s*\d+\s*[-–]?\s*\d*\s*of\s*\d+", re.I)

def respace(s):
    s = re.sub(r"([.,;:?!])([A-Za-z])", r"\1 \2", s)
    s = re.sub(r"(\b[A-Za-z]+'(?:ve|re|ll|d|s|t|m|S))([a-z])", r"\1 \2", s)
    return s

def desplit(s):
    out = []
    for tok in respace(s).split():
        m = re.match(r"^(\W*)(.*?)(\W*)$", tok, re.S)
        pre, core, post = m.group(1), m.group(2), m.group(3)
        if len(core) > 5 and core.isalpha():
            parts = wordninja.split(core)
            if len(parts) > 1:
                if core[0].isupper():
                    parts[0] = parts[0][:1].upper() + parts[0][1:]
                tok = pre + " ".join(parts) + post
        out.append(tok)
    return " ".join(out)

def clean(text):
    out = []
    for ln in text.splitlines():
        ln = TIMER.sub("", ln).strip()
        ln = QRANGE.sub("", ln).strip()
        ln = re.sub(r"[一-鿿]+", " ", ln).strip()   # strip stray CJK (watermark bleed)
        ln = re.sub(r"\s{2,}", " ", ln)
        if not ln or NOISE.search(ln):
            continue
        out.append(ln)
    return out

def set_date(setname):
    m = re.search(r"(\d{1,2})\.(\d{1,2})", setname)
    return f"2026-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else "2026"

HEADER = re.compile(r"Questions?\s*\d+\s*(?:[-–]\s*\d+)?\s*of\s*\d+", re.I)

def parse(full, setname, date):
    ctw, ap = [], []
    # CTW: split on the "Fill in the missing letters" marker
    fills = list(FILL.finditer(full))
    bounds = [m.start() for m in fills] + [len(full)]
    headers = [h.start() for h in HEADER.finditer(full)]
    # everything before the first fill (and after the last CTW block) may hold AP
    for i, m in enumerate(fills):
        # a cloze paragraph ENDS at the next section header ("Questions N of M" /
        # comprehension / next module) — NOT the next Fill marker, else it swallows
        # the whole comprehension section that sits between two cloze paragraphs.
        nxt_hdr = next((h for h in headers if h > m.end()), len(full))
        seg = full[m.end(): min(nxt_hdr, bounds[i + 1])]
        lines = clean(seg)
        # the paragraph = the prose lines until the next marker/Question block
        para = " ".join(lines).strip()
        # strip marker residue ("...in the/a paragraph.") at the segment head
        para = re.sub(r"^\s*in (?:the|a) paragraph[.:]?\s*", "", para, flags=re.I)
        # stop the paragraph at a comprehension question if it bleeds in
        para = re.split(r"\b\d+\s*[\.\)]\s+[A-Z]", para)[0].strip()
        para = desplit(para)
        # JUNK filter: section-nav/instruction text, not an actual cloze paragraph
        JUNK = re.compile(r"Read in Daily Life|Read an Academic|Answer questions about|Choose the best|in (?:the|a) paragraph|Module|Section", re.I)
        n_sent = len(re.findall(r"[.?!]\s", para))
        if not (len(para) > 80 and n_sent >= 1 and re.match(r"^[A-Z]", para) and not JUNK.search(para)):
            continue
        ctw.append({
            "id": f"{date}_ctw{i+1}", "source": setname, "date": date, "tier": "recalled",
            "type": "completeTheWords", "source_kind": "ocr",
            "paragraph": para,
        })
    # AP comprehension: text AFTER the last CTW block that contains MC (A/B/C/D)
    tail = full[bounds[len(fills)-1 if fills else 0]:] if fills else full
    tlines = clean(tail)
    blob = desplit(" ".join(tlines))
    if re.search(r"\b[ABCD]\b\s+\w+.*\b[ABCD]\b", blob) or re.search(r"according to the (passage|paragraph)", blob, re.I):
        ap.append({
            "id": f"{date}_ap", "source": setname, "date": date, "tier": "recalled",
            "type": "academicPassage", "source_kind": "ocr", "passage": blob[:6000],
        })
    return ctw, ap

def main():
    files = glob.glob(os.path.join(CACHE, "*.txt"))
    ctw_all, ap_all, seen = [], [], set()
    for f in sorted(files):
        base = os.path.basename(f)
        if "阅读" not in base and "真题" not in base:
            continue
        full = open(f, encoding="utf-8").read()
        if not FILL.search(full) and "Reading" not in full:
            continue
        setname = base.split("__")[0]
        if setname in seen:
            continue
        seen.add(setname)
        c, a = parse(full, setname, set_date(setname))
        ctw_all.extend(c); ap_all.extend(a)

    def dump(name, arr, title):
        json.dump({"title": title, "tier": "recalled", "source": "2026改后机经 (闲鱼)",
                   "count": len(arr), "items": arr},
                  open(os.path.join(OUT, name), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    dump("completeTheWords.json", ctw_all, "CTW cloze paragraphs (recalled 2026; OCR prose, blanks truncated)")
    dump("academicPassage.json", ap_all, "AP comprehension (recalled 2026; raw OCR)")
    print(f"sets: {len(seen)}")
    print(f"CTW paragraphs: {len(ctw_all)}")
    print(f"AP blocks: {len(ap_all)}")

if __name__ == "__main__":
    main()
