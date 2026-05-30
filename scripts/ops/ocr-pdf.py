#!/usr/bin/env python
"""OCR an image-only PDF to plain text using a LOCAL engine (zero LLM tokens).

These 2026-reform exam PDFs are crisp screenshots of a digital test UI (printed
text, not scanned handwriting) -> near-ideal OCR input. We render each page with
PyMuPDF and recognize text with RapidOCR (ONNX, CPU, offline). Boxes are
re-ordered top-to-bottom / left-to-right and grouped into lines so the output
reads naturally.

Usage:
  python ocr-pdf.py "<pdf_path>" [start_page] [end_page] [zoom]
    -> prints recognized text to stdout, with "===== PAGE n =====" separators.

Pages are 1-based inclusive. zoom 3.0 (~216 DPI) is a good OCR/speed tradeoff.
"""
import sys, io
import numpy as np
import fitz  # PyMuPDF
from rapidocr_onnxruntime import RapidOCR

_engine = None
def engine():
    global _engine
    if _engine is None:
        _engine = RapidOCR()
    return _engine


def page_to_array(page, zoom):
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    return arr  # RGB (n==3)


# 闲鱼/机经 reseller watermark lines — universal junk, drop them.
_WATERMARK = ("闲鱼", "盗卖", "退款止损", "满分小屋", "甜茶", "及时退款")

def _is_watermark(text):
    return any(w in text for w in _WATERMARK)

def order_text(result):
    """result: list of [box(4pts), text, score]. Group into lines by y-center."""
    if not result:
        return ""
    items = []
    for box, text, score in result:
        if _is_watermark(text):
            continue
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        yc = sum(ys) / 4.0
        xl = min(xs)
        h = max(ys) - min(ys)
        items.append((yc, xl, h, text))
    items.sort(key=lambda t: (t[0], t[1]))
    # cluster into lines: new line when y jumps > 0.6 * median height
    heights = sorted(t[2] for t in items)
    medh = heights[len(heights) // 2] if heights else 12
    lines = []
    cur = []
    cur_y = None
    for yc, xl, h, text in items:
        if cur_y is None or abs(yc - cur_y) <= max(8, 0.6 * medh):
            cur.append((xl, text))
            cur_y = yc if cur_y is None else (cur_y + yc) / 2.0
        else:
            cur.sort(key=lambda t: t[0])
            lines.append(" ".join(t[1] for t in cur))
            cur = [(xl, text)]
            cur_y = yc
    if cur:
        cur.sort(key=lambda t: t[0])
        lines.append(" ".join(t[1] for t in cur))
    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print("usage: ocr-pdf.py <pdf> [start] [end] [zoom]", file=sys.stderr)
        sys.exit(2)
    pdf = sys.argv[1]
    doc = fitz.open(pdf)
    n = doc.page_count
    start = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    end = int(sys.argv[3]) if len(sys.argv) > 3 else n
    zoom = float(sys.argv[4]) if len(sys.argv) > 4 else 3.0
    start = max(1, start); end = min(n, end)
    eng = engine()
    for i in range(start - 1, end):
        arr = page_to_array(doc.load_page(i), zoom)
        result, _ = eng(arr)
        print(f"===== PAGE {i+1} =====")
        print(order_text(result))
    doc.close()


if __name__ == "__main__":
    main()
