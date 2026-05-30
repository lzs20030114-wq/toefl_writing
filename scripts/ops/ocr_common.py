#!/usr/bin/env python
"""Shared local-OCR helpers (PyMuPDF render + RapidOCR) with COLUMN-AWARE
reading order via IMAGE-LEVEL gutter detection.

The 2026-reform writing AD/Email pages (and some reading pages) are TWO-COLUMN.
RapidOCR's line detector merges a left-column line and the right-column line at
the same height into ONE box, so box-coordinate splitting can't recover columns.
Instead we detect the white vertical gutter on the RENDERED IMAGE (a central
band of near-zero ink with substantial text on both sides) and OCR the left and
right halves separately, so RapidOCR never merges across the gutter. Single-
column pages have no such gutter and are OCR'd whole.
"""
import numpy as np
import fitz  # PyMuPDF

_WATERMARK = ("闲鱼", "盗卖", "退款止损", "满分小屋", "甜茶", "及时退款", "盗卖资料")
def is_watermark(t):
    return any(w in t for w in _WATERMARK)

_engine = None
def engine():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _engine = RapidOCR()
    return _engine

def render_array(page, zoom):
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)

def gutter_x(arr):
    """Return x of a central white gutter (two-column page), else None."""
    h, w = arr.shape[0], arr.shape[1]
    gray = arr[:, :, :3].mean(axis=2)
    ink = gray < 160                      # dark = text/ink
    col = ink.sum(axis=0)                 # ink pixels per column
    total = col.sum()
    if total < 0.0005 * h * w:            # near-empty page (e.g. image-only) -> no split
        return None
    lo, hi = int(0.34 * w), int(0.66 * w)
    thresh = max(1.0, 0.012 * h)          # "white" column: <1.2% of height has ink
    best_start = best_len = cur_start = cur_len = 0
    for x in range(lo, hi):
        if col[x] <= thresh:
            if cur_len == 0:
                cur_start = x
            cur_len += 1
            if cur_len > best_len:
                best_len, best_start = cur_len, cur_start
        else:
            cur_len = 0
    if best_len < 0.015 * w:              # gutter must be a real band, not a 1px gap
        return None
    gx = best_start + best_len // 2
    left, right = col[:gx].sum(), col[gx:].sum()
    # both columns must carry substantial text (else it's just a wide margin)
    if left > 0.15 * total and right > 0.15 * total:
        return gx
    return None

def _lines_from(result):
    """result: RapidOCR list -> reading-ordered lines (single column)."""
    boxes = []
    for box, text, score in result or []:
        if is_watermark(text):
            continue
        ys = [p[1] for p in box]; xs = [p[0] for p in box]
        boxes.append((sum(ys) / 4.0, min(xs), max(ys) - min(ys), text))
    if not boxes:
        return []
    boxes.sort(key=lambda t: (t[0], t[1]))
    heights = sorted(b[2] for b in boxes)
    medh = heights[len(heights) // 2] if heights else 12
    lines, cur, cur_y = [], [], None
    for yc, xl, h, text in boxes:
        if cur_y is None or abs(yc - cur_y) <= max(8, 0.6 * medh):
            cur.append((xl, text)); cur_y = yc if cur_y is None else (cur_y + yc) / 2.0
        else:
            cur.sort(key=lambda t: t[0]); lines.append(" ".join(t[1] for t in cur))
            cur = [(xl, text)]; cur_y = yc
    if cur:
        cur.sort(key=lambda t: t[0]); lines.append(" ".join(t[1] for t in cur))
    return lines

def ocr_page(page, zoom=3.0):
    eng = engine()
    arr = render_array(page, zoom)
    gx = gutter_x(arr)
    if gx is not None:
        left = np.ascontiguousarray(arr[:, :gx])
        right = np.ascontiguousarray(arr[:, gx:])
        l, _ = eng(left); r, _ = eng(right)
        return "\n".join(_lines_from(l) + _lines_from(r))
    res, _ = eng(arr)
    return "\n".join(_lines_from(res))

def ocr_doc(pdf_path, start=1, end=None, zoom=3.0):
    doc = fitz.open(pdf_path)
    n = doc.page_count
    end = n if end is None else min(end, n)
    start = max(1, start)
    out = []
    for i in range(start - 1, end):
        out.append(f"===== PAGE {i+1} =====")
        out.append(ocr_page(doc.load_page(i), zoom))
    doc.close()
    return "\n".join(out)
