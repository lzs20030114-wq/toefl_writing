#!/usr/bin/env python
"""Structure reading-comprehension (AP) OCR into clean JSON via DeepSeek.
Per set: {passages:[{topic, text, questions:[{stem, options:[]}]}]}.
Output: .codex-tmp/struct_ap/<set>.json. Usage: [--limit N] [--force] [substr...]
"""
import os, re, json, glob, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
_spec = importlib.util.spec_from_file_location("sd", os.path.join(os.path.dirname(os.path.abspath(__file__)), "structure_with_deepseek.py"))
sd = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(sd)

CACHE = sd.CACHE
OUTDIR = os.path.join(sd.ROOT, ".codex-tmp", "struct_ap")
os.makedirs(OUTDIR, exist_ok=True)

AP_INSTR = (
    "You are given OCR text (with frequent missing spaces / minor errors) of a "
    "TOEFL 2026 READING section. It contains 'Fill in the missing letters' cloze "
    "paragraphs (IGNORE those) and ACADEMIC COMPREHENSION passages each followed by "
    "multiple-choice questions. Reconstruct CLEAN text and return ONLY JSON:\n"
    '{"passages": [{"topic": "", "text": "", "questions": [{"stem": "", "options": ["",""]}]}]}\n'
    "Rules: include only real comprehension passages (academic prose) and their MC "
    "questions with answer options. Fix obvious OCR spacing. Do NOT invent content or "
    "answers; omit anything not present. Output JSON only."
)

def call(text):
    return sd.call_deepseek.__wrapped__(text) if hasattr(sd.call_deepseek, "__wrapped__") else _call(text)

def _call(text):
    import urllib.request
    body = json.dumps({"model": "deepseek-v4-flash",
        "messages": [{"role": "system", "content": AP_INSTR}, {"role": "user", "content": text[:13000]}],
        "response_format": {"type": "json_object"}, "temperature": 0, "stream": False}).encode("utf-8")
    req = urllib.request.Request(sd.URL, data=body, headers={"Authorization": f"Bearer {sd.KEY}", "Content-Type": "application/json"})
    if sd.PROXY:
        req.set_proxy(re.sub(r"^https?://", "", sd.PROXY), "http"); req.set_proxy(re.sub(r"^https?://", "", sd.PROXY), "https")
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(json.loads(r.read().decode("utf-8"))["choices"][0]["message"]["content"])

def reading_text(setname):
    best = None
    for f in glob.glob(os.path.join(CACHE, f"{setname}__*.txt")):
        b = os.path.basename(f)
        t = open(f, encoding="utf-8").read()
        if "阅读" in b or re.search(r"according to|comprehension|Reading", t, re.I):
            if best is None or len(t) > len(best): best = t
    return best

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    limit = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--limit=")), None)
    sets = sorted({os.path.basename(f).split("__")[0] for f in glob.glob(os.path.join(CACHE, "*.txt"))})
    if args: sets = [s for s in sets if any(a in s for a in args)]
    if limit: sets = sets[:limit]
    ok = err = skip = 0
    for s in sets:
        outp = os.path.join(OUTDIR, f"{s}.json")
        if os.path.exists(outp) and not force: skip += 1; continue
        txt = reading_text(s)
        if not txt: continue
        try:
            data = _call(txt)
            json.dump({"set": s, **data}, open(outp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            ps = data.get("passages", [])
            print(f"OK {s}: passages={len(ps)} Qs={sum(len(p.get('questions',[])) for p in ps)}", flush=True); ok += 1
        except Exception as e:
            print(f"ERR {s}: {e}", flush=True); err += 1
    print(f"\nAP structured: ok={ok} err={err} skip={skip}", flush=True)

if __name__ == "__main__":
    main()
