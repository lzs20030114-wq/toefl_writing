#!/usr/bin/env python
"""Structure noisy OCR writing text into CLEAN, CONSISTENT JSON via DeepSeek.

Local OCR already did the expensive image->text (zero Claude tokens). Regex
field-parsing is unreliable across 50 varied OCR layouts, so we use the project's
cheap DeepSeek API to turn each set's writing OCR text into a clean schema:
  ad:    {course, professor, professor_question, students:[{name,text}]}
  email: {scenario, recipient, subject, bullets:[]}
Output: .codex-tmp/struct/<set>.json  (one per set). Idempotent (skip existing).

Usage: python structure_with_deepseek.py [--limit N] [--force] [set_substr ...]
"""
import os, re, json, glob, sys, urllib.request

ROOT = r"D:\toefl_writing"
CACHE = os.path.join(ROOT, ".codex-tmp", "ocr")
OUTDIR = os.path.join(ROOT, ".codex-tmp", "struct")
os.makedirs(OUTDIR, exist_ok=True)

def load_env():
    env = {}
    for line in open(os.path.join(ROOT, ".env.local"), encoding="utf-8"):
        m = re.match(r"\s*([A-Z_]+)\s*=\s*(.+?)\s*$", line)
        if m:
            env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env

ENV = load_env()
KEY = ENV.get("DEEPSEEK_API_KEY", "")
PROXY = ENV.get("DEEPSEEK_PROXY_URL", "")
URL = "https://api.deepseek.com/chat/completions"

SCHEMA_INSTR = (
    "You are given OCR text (with frequent missing spaces and minor errors) of a "
    "TOEFL 2026 writing section that contains an Academic Discussion task and an "
    "Email task. Reconstruct CLEAN text (fix obvious OCR spacing) and return ONLY "
    "JSON with this exact shape:\n"
    '{"ad": {"course": "", "professor": "", "professor_question": "", '
    '"students": [{"name": "", "text": ""}]}, '
    '"email": {"scenario": "", "recipient": "", "subject": "", "bullets": [""]}}\n'
    "Rules: professor_question = ONLY the professor\'s discussion question (ends with "
    "'?'). students = the 1-3 classmate posts with their names. email.scenario = the "
    "situation paragraph; bullets = the 'do the following' task points (exclude 'Write "
    "as much as you can'). Do NOT invent content; if a field is truly absent use \"\" "
    "or []. Output JSON only, no prose."
)

def call_deepseek(text):
    body = json.dumps({
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": SCHEMA_INSTR},
            {"role": "user", "content": text[:9000]},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0,
        "stream": False,
    }).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
    })
    if PROXY:
        req.set_proxy(re.sub(r"^https?://", "", PROXY), "http")
        req.set_proxy(re.sub(r"^https?://", "", PROXY), "https")
    with urllib.request.urlopen(req, timeout=120) as r:
        resp = json.loads(r.read().decode("utf-8"))
    return json.loads(resp["choices"][0]["message"]["content"])

def writing_text(setname):
    for f in glob.glob(os.path.join(CACHE, f"{setname}__*.txt")):
        t = open(f, encoding="utf-8").read()
        if re.search(r"Make an appropriate sentence|Write an email|professor", t, re.I):
            # keep only the AD/Email tail (drop the BS pages to save tokens)
            mk = re.search(r"(Write an email|Question\s*1\s*of\s*2)", t, re.I)
            return t[mk.start()-200:] if mk else t
    return None

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    limit = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--limit=")), None)
    sets = sorted({os.path.basename(f).split("__")[0] for f in glob.glob(os.path.join(CACHE, "*.txt"))})
    if args:
        sets = [s for s in sets if any(a in s for a in args)]
    if limit:
        sets = sets[:limit]
    ok = err = skip = 0
    for s in sets:
        outp = os.path.join(OUTDIR, f"{s}.json")
        if os.path.exists(outp) and not force:
            skip += 1; continue
        txt = writing_text(s)
        if not txt:
            continue
        try:
            data = call_deepseek(txt)
            json.dump({"set": s, **data}, open(outp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            ad = data.get("ad", {}); em = data.get("email", {})
            print(f"OK {s}: AD course={ad.get('course','')!r} students={len(ad.get('students',[]))} | Email subj={em.get('subject','')!r}", flush=True)
            ok += 1
        except Exception as e:
            print(f"ERR {s}: {e}", flush=True); err += 1
    print(f"\nstructured: ok={ok} err={err} skip={skip}", flush=True)

if __name__ == "__main__":
    main()
