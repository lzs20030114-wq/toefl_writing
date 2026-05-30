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

STEPS = [
    (NODE, os.path.join(ROOT, "scripts", "ops", "extract-listening.mjs")),
    (NODE, os.path.join(ROOT, "scripts", "ops", "extract-bs-speaking.mjs")),
    (PY,   os.path.join(ROOT, "scripts", "ops", "parse_writing.py")),
    (PY,   os.path.join(ROOT, "scripts", "ops", "parse_reading.py")),
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
