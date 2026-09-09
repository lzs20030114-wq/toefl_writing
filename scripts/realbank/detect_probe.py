#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""源格式探测的「量」—— 给 detect_source.mjs 喂指标，判据留在 JS 那边。

为什么分两半：判据要能单测（纯 JS 函数 + fixture），但**量**只有 PyMuPDF /
python-docx 量得出来（PDF 文字层密度、docx 内嵌图片数与段落词数）。所以这里只负责
读文件出数字，一个 JSON 打到 stdout，不作任何判断。

用法：
  python scripts/realbank/detect_probe.py <套目录>
输出：
  {"pdf": {"files": n, "pages": n, "body_chars": n, "chars_per_page": f, "has_answer_pdf": bool},
   "docx": {"files": n, "images": n, "words": n},
   "audio": {"files": n}}
任何一份文件读不出来都只是不计入统计（探测本来就是尽力而为），不抛异常。
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Windows 下管道里的 stdout 默认是 cp936：中文文件名会被编成一堆问号，
# 判据那边就认不出「答案 docx」了（实测 5.20 因此判成 unknown）。
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

# ingest_common.strip_watermark 是同一份去水印判据 —— 密度阈值要和 ingest_set.pdf_text
# 对齐，就不能用「原始字符数」，得先把水印行去掉。
try:
    from ingest_common import strip_watermark
except Exception:  # pragma: no cover - 只在依赖缺失时走到
    def strip_watermark(t):
        return t

PDF_EXT = (".pdf",)
DOCX_EXT = (".docx",)
AUDIO_EXT = (".mp3", ".m4a", ".wav", ".mp4", ".mov")
ANSWER_HINT = re.compile(r"答案|answer", re.I)


def probe_pdf(path, acc):
    import fitz
    doc = fitz.open(path)
    try:
        raw = "\n".join(doc.load_page(i).get_text() for i in range(doc.page_count))
        acc["pages"] += max(1, doc.page_count)
        acc["body_chars"] += len(strip_watermark(raw).strip())
    finally:
        doc.close()


def probe_docx(path, acc):
    import docx
    d = docx.Document(path)
    images = len(d.inline_shapes)
    words = 0
    for p in d.paragraphs:
        words += len(p.text.split())
    for t in d.tables:
        for row in t.rows:
            for cell in row.cells:
                words += len(cell.text.split())
    acc["images"] += images
    acc["words"] += words
    # 逐份也记一笔：判据要能把「答案 docx」摘出去。截图套壳的卷答案页照样是纯文本
    # （convert_docx_set.py 就是靠这一点把它转成带文字层的 PDF），混在总数里会把
    # 「文本词数 < 200」这条判据顶穿（实测 5.20 四科正文只有几十词，加上答案页变 355 词）。
    acc["items"].append({"name": os.path.basename(path), "images": images, "words": words})


def main():
    if len(sys.argv) < 2:
        print("用法: detect_probe.py <套目录>", file=sys.stderr)
        return 2
    root = sys.argv[1]
    pdf = {"files": 0, "pages": 0, "body_chars": 0, "has_answer_pdf": False}
    dx = {"files": 0, "images": 0, "words": 0, "items": []}
    audio = {"files": 0}

    for dirpath, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d != "__MACOSX"]
        for name in sorted(names):
            if name.startswith("."):
                continue
            path = os.path.join(dirpath, name)
            ext = os.path.splitext(name)[1].lower()
            try:
                if ext in PDF_EXT:
                    pdf["files"] += 1
                    if ANSWER_HINT.search(name):
                        pdf["has_answer_pdf"] = True
                    probe_pdf(path, pdf)
                elif ext in DOCX_EXT:
                    dx["files"] += 1
                    probe_docx(path, dx)
                elif ext in AUDIO_EXT:
                    audio["files"] += 1
            except Exception:
                continue

    pdf["chars_per_page"] = round(pdf["body_chars"] / pdf["pages"], 1) if pdf["pages"] else 0
    json.dump({"pdf": pdf, "docx": dx, "audio": audio}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
