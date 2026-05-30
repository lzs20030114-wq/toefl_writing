#!/usr/bin/env python
"""OCR an image-only PDF to plain text using a LOCAL engine (zero LLM tokens).

Thin CLI over ocr_common (PyMuPDF render + RapidOCR, column-aware ordering).

Usage:
  python ocr-pdf.py "<pdf_path>" [start_page] [end_page] [zoom]
"""
import sys
from ocr_common import ocr_doc

def main():
    if len(sys.argv) < 2:
        print("usage: ocr-pdf.py <pdf> [start] [end] [zoom]", file=sys.stderr)
        sys.exit(2)
    pdf = sys.argv[1]
    start = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    end = int(sys.argv[3]) if len(sys.argv) > 3 else None
    zoom = float(sys.argv[4]) if len(sys.argv) > 4 else 3.0
    print(ocr_doc(pdf, start, end, zoom))

if __name__ == "__main__":
    main()
