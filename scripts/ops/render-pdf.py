#!/usr/bin/env python
"""Render PDF pages to PNG using PyMuPDF (fitz).

The Read tool's internal pdftoppm renderer is unavailable in this environment
(poppler ships only pdftotext here). PyMuPDF is installed, so we rasterize
image-only exam PDFs to PNG ourselves, then read the PNGs with the Read tool's
native image support (which does NOT depend on pdftoppm).

Usage:
  python render-pdf.py "<pdf_path>" "<out_dir>" [start_page] [end_page] [zoom]

Pages are 1-based and inclusive. zoom 2.0 ~= 144 DPI (good for OCR-by-vision,
small token footprint). Prints one rendered PNG path per line.
"""
import sys, os
import fitz  # PyMuPDF

def main():
    if len(sys.argv) < 3:
        print("usage: render-pdf.py <pdf> <out_dir> [start] [end] [zoom]", file=sys.stderr)
        sys.exit(2)
    pdf_path = sys.argv[1]
    out_dir = sys.argv[2]
    doc = fitz.open(pdf_path)
    n = doc.page_count
    start = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    end = int(sys.argv[4]) if len(sys.argv) > 4 else n
    zoom = float(sys.argv[5]) if len(sys.argv) > 5 else 2.0
    start = max(1, start)
    end = min(n, end)
    os.makedirs(out_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(pdf_path))[0]
    mat = fitz.Matrix(zoom, zoom)
    print(f"# {pdf_path}\n# total_pages={n} rendering={start}..{end} zoom={zoom}", file=sys.stderr)
    for i in range(start - 1, end):
        page = doc.load_page(i)
        pix = page.get_pixmap(matrix=mat)
        out = os.path.join(out_dir, f"{base}_p{i+1:02d}.png")
        pix.save(out)
        print(out)
    doc.close()

if __name__ == "__main__":
    main()
