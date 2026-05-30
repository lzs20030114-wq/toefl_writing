#!/usr/bin/env python
"""Parse the OCR text cache into structured writing items (BS / Email / AD).

Reads .codex-tmp/ocr/*.txt (column-aware OCR output). Page-based: each page is
de-split (wordninja fixes run-together OCR tokens — critical, since markers like
"teaching a class on" are OCR'd as "teachinga class on") and routed by content:
  - "Make an appropriate sentence" / "Question N of 10" -> Build a Sentence
  - "Write an email"                                     -> Email prompt
  - "professor" + "responding"/"discussion"             -> Academic Discussion
BS targets are joined from the answer-key extraction (buildSentence-targets.json).
Output: data/realExam2026/writing/{buildSentence,email,academicDiscussion}.json
"""
import os, re, json, glob
import wordninja

ROOT = r"D:\toefl_writing"
CACHE = os.path.join(ROOT, ".codex-tmp", "ocr")
OUT = os.path.join(ROOT, "data", "realExam2026", "writing")
os.makedirs(OUT, exist_ok=True)

TIMER = re.compile(r"\d{1,2}:\d{2}:\d{2}")
NOISE = re.compile(r"Hide\s*Time|Cut\s*Paste|Word\s*Count|^Writing\b|Your Response|^\s*$|店铺|闲鱼|盗卖", re.I)

def desplit_tok(tok):
    m = re.match(r"^(\W*)(.*?)(\W*)$", tok, re.S)
    pre, core, post = m.group(1), m.group(2), m.group(3)
    if len(core) > 11 and core.isalpha():
        parts = wordninja.split(core)
        if len(parts) > 1:
            if core[0].isupper():
                parts[0] = parts[0][:1].upper() + parts[0][1:]
            return pre + " ".join(parts) + post
    return tok

def desplit(s):
    return " ".join(desplit_tok(t) for t in s.split())

def clean_page(text):
    lines = []
    for ln in text.splitlines():
        ln = TIMER.sub("", ln).strip()
        if not ln or NOISE.search(ln):
            continue
        lines.append(ln)
    return lines

def set_date(s):
    m = re.search(r"(\d{1,2})\.(\d{1,2})", s)
    return f"2026-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else "2026"

def split_pages(full):
    parts = re.split(r"=====\s*PAGE\s*(\d+)\s*=====", full)
    pages = []
    for i in range(1, len(parts), 2):
        pages.append(parts[i + 1])
    return pages if pages else [full]

def load_bs_targets():
    p = os.path.join(OUT, "buildSentence-targets.json")
    by = {}
    if os.path.exists(p):
        for it in json.load(open(p, encoding="utf-8")).get("items", []):
            m = re.search(r"_bs(\d+)$", it["id"])
            if m:
                by.setdefault(it["source"], {})[int(m.group(1))] = it["target"]
    return by

def parse_bs(full, setname, date, targets):
    items = []
    marks = list(re.finditer(r"Question\s*(\d+)\s*of\s*10", full, re.I))
    for i, mk in enumerate(marks):
        n = int(mk.group(1))
        seg = full[mk.end(): marks[i + 1].start() if i + 1 < len(marks) else len(full)]
        lines = [l for l in clean_page(seg) if not re.match(r"^Make an appropriate", l, re.I)
                 and not re.search(r"PAGE \d", l)]
        prompt = desplit(lines[0]) if lines else ""
        items.append({
            "id": f"{date}_bs{n}", "source": setname, "date": date, "tier": "recalled",
            "type": "buildSentence", "n": n,
            "prompt_context": prompt,
            "target": (targets.get(setname, {}) or {}).get(n, ""),
            "scrambled_ocr": [desplit(x) for x in lines[1:]],
        })
    return items

def parse_email(pages, setname, date):
    for pg in pages:
        d = desplit(" ".join(clean_page(pg)))
        if not re.search(r"Write an email", d, re.I):
            continue
        recipient = subject = ""
        rm = re.search(r"To:\s*([A-Z][A-Za-z. ]{1,40})", d)
        sm = re.search(r"Subject:\s*([A-Z][^.]{2,80})", d)
        if rm: recipient = rm.group(1).strip()
        if sm: subject = re.split(r"\b(?:Cut|Paste|Describe|Ask|Inquire|Write)\b", sm.group(1))[0].strip()
        # prompt = the scenario + instructions (drop To/Subject/UI tokens)
        prompt = re.sub(r"To:\s*[A-Z][A-Za-z. ]{1,40}|Subject:\s*[^.]{2,80}|Cut Paste Undo Redo", "", d).strip()
        return {
            "id": f"{date}_email", "source": setname, "date": date, "tier": "recalled",
            "type": "email", "recipient": recipient, "subject": subject,
            "prompt_text": re.sub(r"\s+", " ", prompt),
        }
    return None

def parse_ad(pages, setname, date):
    for pg in pages:
        d = desplit(" ".join(clean_page(pg)))
        if not re.search(r"teaching a class on|responding to the professor", d, re.I):
            continue
        course = ""
        cm = re.search(r"teaching a class on ([^.]+?)\.", d, re.I)
        if cm: course = cm.group(1).strip()
        pm = re.search(r"\b(Dr\.?\s*[A-Z][a-z]+|Professor\s+[A-Z][a-z]+)", d)
        professor = re.sub(r"\s+", " ", pm.group(1)).strip() if pm else ""
        # professor question = first long '?'-ending sentence (robust to glued
        # short tokens that defeat phrase matching). desplit it for readability.
        q = ""
        sents = re.split(r"(?<=[?.])\s+", d)
        qcands = [s.strip() for s in sents if s.rstrip().endswith("?") and len(s) > 40]
        if qcands:
            q = re.sub(r"\s+", " ", desplit(qcands[0]))
            q = re.sub(r"^(Dr\.?\s*[A-Z][a-z]+|Professor\s+[A-Z][a-z]+)\s+", "", q).strip()
        return {
            "id": f"{date}_ad", "source": setname, "date": date, "tier": "recalled",
            "type": "academicDiscussion", "course": course, "professor": professor,
            "professor_question": q, "raw_text": re.sub(r"\s+", " ", d)[:2500],
        }
    return None

def main():
    targets = load_bs_targets()
    bs_all, email_all, ad_all, seen = [], [], [], set()
    for f in sorted(glob.glob(os.path.join(CACHE, "*.txt"))):
        full = open(f, encoding="utf-8").read()
        if not re.search(r"Make an appropriate sentence|Write an email|professor", full, re.I):
            continue
        setname = os.path.basename(f).split("__")[0]
        if setname in seen:
            continue
        seen.add(setname)
        date = set_date(setname)
        pages = split_pages(full)
        bs_all.extend(parse_bs(full, setname, date, targets))
        e = parse_email(pages, setname, date)
        if e: email_all.append(e)
        a = parse_ad(pages, setname, date)
        if a: ad_all.append(a)

    def dump(name, arr, title):
        json.dump({"title": title, "tier": "recalled", "source": "2026改后机经 (闲鱼)",
                   "count": len(arr), "items": arr},
                  open(os.path.join(OUT, name), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    dump("buildSentence.json", bs_all, "Build-a-Sentence items (recalled 2026; prompt+target+scrambled)")
    dump("email.json", email_all, "Email prompts (recalled 2026)")
    dump("academicDiscussion.json", ad_all, "Academic Discussion prompts (recalled 2026)")
    print(f"sets parsed: {len(seen)}")
    print(f"BS items: {len(bs_all)} (with target: {sum(1 for x in bs_all if x['target'])})")
    print(f"Email: {len(email_all)} (with recipient: {sum(1 for x in email_all if x['recipient'])})")
    print(f"AD: {len(ad_all)} (with course: {sum(1 for x in ad_all if x['course'])}, with Q: {sum(1 for x in ad_all if x['professor_question'])})")

if __name__ == "__main__":
    main()
