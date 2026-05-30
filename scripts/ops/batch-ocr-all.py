#!/usr/bin/env python
"""Batch-OCR every IMAGE-only exam PDF into a text cache (zero LLM tokens).

Walks the 2026-reform source folder. For each PDF:
  - if it has a genuine embedded text layer (ignoring the reseller watermark,
    which is a text object on every image page) -> SKIP (pdftotext handles it).
  - else (image-only: reading / writing / speaking / combined-set mains)
    -> column-aware render+OCR (ocr_common) -> write text to cache.

Resumable: skips a PDF whose cache file already exists and is non-trivial.
Output: <CACHE>/<set folder>__<pdf base>.txt
"""
import os
import fitz  # PyMuPDF
from ocr_common import ocr_page, is_watermark

SRC = r"D:\桌面\【2026改后全科真题】（持续更新中）"
CACHE = r"D:\toefl_writing\.codex-tmp\ocr"
ZOOM = 3.0
TEXT_LAYER_MIN = 100   # non-watermark embedded chars => text PDF, skip OCR
DONE_MIN = 50          # cache file with >= this many bytes counts as done

def genuine_text_len(doc):
    sample = "\n".join(doc.load_page(i).get_text() for i in range(min(doc.page_count, 5)))
    return sum(len("".join(l.split())) for l in sample.splitlines() if not is_watermark(l))

def ocr_doc_obj(doc):
    out = []
    for i in range(doc.page_count):
        out.append(f"===== PAGE {i+1} =====")
        out.append(ocr_page(doc.load_page(i), ZOOM))
    return "\n".join(out)

def main():
    os.makedirs(CACHE, exist_ok=True)
    pdfs = []
    for root, _, files in os.walk(SRC):
        for f in files:
            if f.lower().endswith(".pdf"):
                pdfs.append(os.path.join(root, f))
    pdfs.sort()
    total = len(pdfs)
    print(f"found {total} PDFs", flush=True)
    n_ocr = n_skip_text = n_skip_done = n_err = 0
    for idx, path in enumerate(pdfs, 1):
        setname = os.path.basename(os.path.dirname(path))
        base = os.path.splitext(os.path.basename(path))[0]
        outp = os.path.join(CACHE, f"{setname}__{base}.txt")
        if os.path.exists(outp) and os.path.getsize(outp) > DONE_MIN:
            n_skip_done += 1; continue
        try:
            doc = fitz.open(path)
            if genuine_text_len(doc) > TEXT_LAYER_MIN:
                doc.close(); n_skip_text += 1; continue
            print(f"[{idx}/{total}] OCR ({doc.page_count}p): {setname}/{base}", flush=True)
            text = ocr_doc_obj(doc); doc.close()
            with open(outp, "w", encoding="utf-8") as fh:
                fh.write(text)
            n_ocr += 1
        except Exception as e:
            n_err += 1
            print(f"  ERROR {setname}/{base}: {e}", flush=True)
    print(f"\nDONE  ocr={n_ocr}  skip_text={n_skip_text}  skip_done={n_skip_done}  err={n_err}", flush=True)

if __name__ == "__main__":
    main()
