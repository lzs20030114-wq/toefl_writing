#!/usr/bin/env python
"""Run all realExam2026 extractors over the current OCR/text caches and print a
summary. Assumes:
  - .codex-tmp/exam_txt/  (pdftotext output: transcripts + answer keys)
  - .codex-tmp/ocr/       (RapidOCR output: reading/writing/speaking image PDFs)
Order: listening + BS/speaking (text) -> writing + reading (OCR) -> summary.
"""
import subprocess, os, json, glob

ROOT = r"D:\toefl_writing"
PY = r"D:\python\python"
NODE = "node"
env = dict(os.environ, PYTHONIOENCODING="utf-8")

def _s(name):
    return os.path.join(ROOT, "scripts", "ops", name)

# Order matters: parse_reading/parse_writing emit regex AD/Email/AP which
# merge_struct then OVERWRITES with the DeepSeek-structured clean versions;
# qc_fix runs last (unique ids + content safety-clean). The DeepSeek API steps
# (structure_with_deepseek.py / structure_ap.py) are NOT here — run them only
# when the OCR cache changes; merge_struct just reads their cached output.
STEPS = [
    (NODE, _s("extract-listening.mjs")),     # listening text base (14 combined sets)
    (PY,   _s("parse_listening_audio.py")),  # + split-set audio listening
    (NODE, _s("extract-bs-speaking.mjs")),   # BS target sentences + repeat
    (PY,   _s("parse_speaking_audio.py")),   # interview + repeat-from-audio
    (PY,   _s("parse_reading.py")),          # reading CTW (regex AP overwritten next)
    (PY,   _s("parse_writing.py")),          # BS prompts (regex AD/Email overwritten next)
    (PY,   _s("merge_struct.py")),           # DeepSeek AD/Email/AP -> clean schema
    (NODE, _s("qc_fix.mjs")),                # unique ids + content safety-clean
]

for exe, script in STEPS:
    print(f"\n=== {os.path.basename(script)} ===", flush=True)
    r = subprocess.run([exe, script], cwd=ROOT, env=env, capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        print("STDERR:", r.stderr.strip()[-500:])

print("\n========== realExam2026 folder summary ==========")
base = os.path.join(ROOT, "data", "realExam2026")
for jf in sorted(glob.glob(os.path.join(base, "**", "*.json"), recursive=True)):
    try:
        d = json.load(open(jf, encoding="utf-8"))
        n = d.get("count") or d.get("set_count") or len(d.get("items", d.get("sets", [])))
        rel = os.path.relpath(jf, base)
        print(f"  {rel:42s} {n}")
    except Exception as e:
        print(f"  {jf}: {e}")
