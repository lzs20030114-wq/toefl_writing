#!/usr/bin/env python
"""OCR the image PDFs of specific sets (by name substring) into the cache.
Usage: python ocr_sets.py 3.20 3.21 3.25
Skips answer-key / transcript PDFs (those are text -> pdftotext). Idempotent
unless --force. Used for pilots and for re-OCR of specific sets.
"""
import sys, os, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ocr_common import ocr_doc

SRC = r"D:\桌面\【2026改后全科真题】（持续更新中）"
CACHE = r"D:\toefl_writing\.codex-tmp\ocr"
os.makedirs(CACHE, exist_ok=True)
SKIP = ("答案", "参考", "原文")

args = [a for a in sys.argv[1:] if not a.startswith("--")]
force = "--force" in sys.argv
zoom = next((float(a.split("=")[1]) for a in sys.argv if a.startswith("--zoom=")), 3.0)
only = next((a.split("=")[1] for a in sys.argv if a.startswith("--only=")), None)
for s in args:
    for pdf in sorted(glob.glob(os.path.join(SRC, f"*{s}*", "*.pdf"))):
        base = os.path.splitext(os.path.basename(pdf))[0]
        if any(k in base for k in SKIP):
            continue
        if only and only not in base:
            continue
        setname = os.path.basename(os.path.dirname(pdf))
        out = os.path.join(CACHE, f"{setname}__{base}.txt")
        if os.path.exists(out) and os.path.getsize(out) > 50 and not force:
            print("skip(done)", setname, base, flush=True); continue
        try:
            txt = ocr_doc(pdf, zoom=zoom)
            open(out, "w", encoding="utf-8").write(txt)
            print("wrote", setname, "/", base, len(txt), "chars", flush=True)
        except Exception as e:
            print("ERR", setname, base, e, flush=True)
