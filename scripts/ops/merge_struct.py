#!/usr/bin/env python
"""Merge DeepSeek-structured writing (.codex-tmp/struct/*.json) into the clean,
consistent bank files writing/academicDiscussion.json + writing/email.json.
Only keeps items with real content (drops empty). Replaces the regex output.
"""
import os, re, json, glob

ROOT = r"D:\toefl_writing"
STRUCT = os.path.join(ROOT, ".codex-tmp", "struct")
OUT = os.path.join(ROOT, "data", "realExam2026", "writing")

def set_date(s):
    m = re.search(r"(\d{1,2})\.(\d{1,2})", s)
    return f"2026-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else "2026"

ad_all, email_all = [], []
for f in sorted(glob.glob(os.path.join(STRUCT, "*.json"))):
    d = json.load(open(f, encoding="utf-8"))
    s = d.get("set", os.path.basename(f)[:-5]); date = set_date(s)
    ad = d.get("ad") or {}
    students = [st for st in (ad.get("students") or []) if (st.get("text") or "").strip()]
    if (ad.get("course") or ad.get("professor_question") or students):
        ad_all.append({
            "id": f"{date}_ad", "source": s, "date": date, "tier": "recalled",
            "type": "academicDiscussion", "source_kind": "ocr+deepseek",
            "course": (ad.get("course") or "").strip(),
            "professor": (ad.get("professor") or "").strip(),
            "professor_question": (ad.get("professor_question") or "").strip(),
            "students": [{"name": (st.get("name") or "").strip(), "text": st["text"].strip()} for st in students],
        })
    em = d.get("email") or {}
    bullets = [b.strip() for b in (em.get("bullets") or []) if (b or "").strip()]
    if (em.get("scenario") or bullets):
        email_all.append({
            "id": f"{date}_email", "source": s, "date": date, "tier": "recalled",
            "type": "email", "source_kind": "ocr+deepseek",
            "scenario": (em.get("scenario") or "").strip(),
            "recipient": (em.get("recipient") or "").strip(),
            "subject": (em.get("subject") or "").strip(),
            "bullets": bullets,
        })

def dump(name, arr, title):
    json.dump({"title": title, "tier": "recalled", "source": "2026改后机经 (闲鱼); OCR+DeepSeek structured",
               "count": len(arr), "items": arr},
              open(os.path.join(OUT, name), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

dump("academicDiscussion.json", ad_all, "Academic Discussion prompts (recalled 2026; OCR + DeepSeek structured)")
dump("email.json", email_all, "Email prompts (recalled 2026; OCR + DeepSeek structured)")
print(f"AD: {len(ad_all)} (with students>=2: {sum(1 for x in ad_all if len(x['students'])>=2)}, with Q: {sum(1 for x in ad_all if x['professor_question'])})")
print(f"Email: {len(email_all)} (with recipient: {sum(1 for x in email_all if x['recipient'])}, with bullets: {sum(1 for x in email_all if x['bullets'])})")
