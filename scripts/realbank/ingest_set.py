#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""真题录入 —— 单套卷端到端驱动（确定性阶段）。

用法:
  python scripts/realbank/ingest_set.py "3.10新托福真题"          # 跑一套
  python scripts/realbank/ingest_set.py --all                      # 扫全部 54 套只出体检表
  python scripts/realbank/ingest_set.py "3.10新托福真题" --json    # 附带落盘中间产物

产出 .codex-tmp/realbank/<套名>.json：
  { set, files[], sections{}, alignment{}, blockers[] }
文本来源优先级：PDF 文字层 > 已有 OCR 缓存 > 现场 OCR（现场 OCR 会写回缓存）。

这一步**不调用任何 LLM**。它的唯一产出是「哪些题能可信地配上答案」，
配不上的一律进 blockers 等人工——语义结构化是下一阶段的事。
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ops"))

import fitz  # PyMuPDF
from ingest_common import (
    SECTIONS, align, content_hash, detect_section, parse_answer_pdf_with_warnings,
    segment, strip_watermark,
)

SRC = r"D:\桌面\【2026改后全科真题】（持续更新中）"
OCR_CACHE = r"D:\toefl_writing\.codex-tmp\ocr"
OUT = r"D:\toefl_writing\.codex-tmp\realbank"
AUDIO_EXT = (".mp3", ".m4a", ".wav")
TEXT_LAYER_MIN = 200  # 去水印后的正文总字符数，低于此判为图片 PDF
# 只看总字数会漏判长篇图片 PDF：实测 `3.2新托福真题B卷/3.2 套二 阅读.pdf`（12 页 629 字）
# 与 `4.20新托福真题/4.20  阅读.pdf`（18 页 703 字）是纯扫描件，只带页眉那一行文字层，
# 总字数却双双越过 200 → 走了文字层、OCR 从没跑过 → 体检表上整科 no_stems。
# 全库 226 份 PDF 实测：真文字 PDF 每页密度最低 384.5 字，这两份是 52.4 / 39.1 字每页，
# 中间是数量级的空档。150 字/页 取在空档中间，两侧都有 2.5 倍以上余量。
TEXT_LAYER_MIN_PER_PAGE = 150


def pdf_text(path):
    """返回 (文本, 来源)。来源 = text-layer / ocr-cache / ocr-live。"""
    doc = fitz.open(path)
    raw = "\n".join(doc.load_page(i).get_text() for i in range(doc.page_count))
    body = len(strip_watermark(raw).strip())
    pages = max(1, doc.page_count)
    if body >= TEXT_LAYER_MIN and body / pages >= TEXT_LAYER_MIN_PER_PAGE:
        return raw, "text-layer"

    setname = os.path.basename(os.path.dirname(path))
    base = os.path.splitext(os.path.basename(path))[0]
    cache = os.path.join(OCR_CACHE, f"{setname}__{base}.txt")
    if os.path.exists(cache) and os.path.getsize(cache) > 50:
        return open(cache, encoding="utf-8").read(), "ocr-cache"

    from ocr_common import ocr_page  # 只在真要现场 OCR 时才加载引擎
    parts = []
    for i in range(doc.page_count):
        parts.append(f"===== PAGE {i + 1} =====")
        parts.append(ocr_page(doc.load_page(i), 3.0))
    text = "\n".join(parts)
    os.makedirs(OCR_CACHE, exist_ok=True)
    open(cache, "w", encoding="utf-8").write(text)
    return text, "ocr-live"


def scan_set(setname, do_ocr=True):
    folder = os.path.join(SRC, setname)
    if not os.path.isdir(folder):
        raise SystemExit(f"找不到卷: {folder}")

    files, audio, answers_from = [], [], None
    answer_modules = {s: [] for s in SECTIONS}
    all_blocks, blockers = [], []

    for root, _, names in os.walk(folder):
        for name in sorted(names):
            path = os.path.join(root, name)
            ext = os.path.splitext(name)[1].lower()
            rel = os.path.relpath(path, folder)
            size_mb = round(os.path.getsize(path) / 1024 / 1024, 1)

            if ext in AUDIO_EXT or "downloading" in name.lower():
                audio.append({"file": rel, "mb": size_mb,
                              "complete": "downloading" not in name.lower()})
                continue
            if ext != ".pdf":
                files.append({"file": rel, "mb": size_mb, "kind": ext.lstrip(".") or "?",
                              "section": None, "note": "非 PDF，本阶段跳过"})
                continue

            if not do_ocr:
                files.append({"file": rel, "mb": size_mb, "kind": "pdf", "section": None,
                              "note": "跳过解析(--fast)"})
                continue

            text, origin = pdf_text(path)
            sec, conf, counts = detect_section(text)
            blocks = segment(text)
            # 答案 PDF 的特征：几乎没有题号锚点，但能解析出成串的编号-答案对
            parsed, ans_warnings = parse_answer_pdf_with_warnings(text)
            n_ans = sum(len(m) for v in parsed.values() for m in v)
            is_answer_key = n_ans >= 10 and len(blocks) <= 2

            entry = {
                "file": rel, "mb": size_mb, "kind": "pdf", "origin": origin,
                "section": sec, "confidence": round(conf, 2), "anchors": counts,
                "blocks": len(blocks), "hash": content_hash(text)[:12],
            }
            if is_answer_key:
                entry["role"] = "answer-key"
                entry["answers"] = {s: [len(m) for m in v] for s, v in parsed.items() if v}
                answers_from = rel
                for s in SECTIONS:
                    if parsed[s]:
                        answer_modules[s] = parsed[s]
                # 答案页解析告警（无科目头的题号重启块等）直接进 blockers 见人
                for w in ans_warnings:
                    blockers.append(f"[{rel}] {w['message']}")
            else:
                entry["role"] = "questions"
                all_blocks.extend(blocks)
            files.append(entry)

    # 跨文件内容重复（同一套卷里两个文件装了同样的东西）
    seen = {}
    for f in files:
        h = f.get("hash")
        if h:
            seen.setdefault(h, []).append(f["file"])
    dupes = [v for v in seen.values() if len(v) > 1]

    alignment = {s: align(all_blocks, answer_modules[s], s) for s in SECTIONS}
    return {
        "set": setname, "answer_key": answers_from, "files": files, "audio": audio,
        "duplicate_files": dupes, "alignment": alignment, "blockers": blockers,
        "blocks": all_blocks,
    }


def report(res):
    print(f"\n{'=' * 74}\n■ {res['set']}\n{'=' * 74}")
    print(f"答案 PDF: {res['answer_key'] or '【缺失】'}")
    print("\n-- 文件 --")
    for f in res["files"]:
        role = f.get("role", "-")
        sec = f.get("section") or "-"
        conf = f.get("confidence", "")
        print(f"  {f['file'][:34]:36s} {f['mb']:6.1f}MB  {role:11s} 科目={sec:9s} "
              f"置信={conf}  来源={f.get('origin', '-')}  题块={f.get('blocks', '-')}")
    for a in res["audio"]:
        flag = "" if a["complete"] else "  ⚠未下完"
        print(f"  {a['file'][:34]:36s} {a['mb']:6.1f}MB  audio{flag}")
    if res["duplicate_files"]:
        print("\n  ⚠ 同卷内内容重复:", res["duplicate_files"])
    if res.get("blockers"):
        print("\n-- blockers --")
        for b in res["blockers"]:
            print(f"  ⚠ {b}")

    print("\n-- 对齐 --")
    icons = {"ok": "OK ", "partial": "部分", "blocked": "扣下", "no_stems": " · ",
             "no_answers": " · "}
    for s in SECTIONS:
        a = res["alignment"][s]
        if not a["modules"]:
            print(f"  {icons[a['status']]} {s:10s} {a['note']}")
            continue
        print(f"  {icons.get(a['status'], ' ? ')} {s:10s} 共配上 {a['matched_count']} 题"
              f"  [{a['status']}]  {a['note']}")
        for m in a["modules"]:
            print(f"        module{m['module']} (of-{m['total']}): 配上 {len(m['matched'])}"
                  f"  缺答案 {len(m['missing_answer'])}  缺题干 {len(m['missing_stem'])}"
                  f"  [{m['status']}]  {m['note']}")
            if m["missing_answer"]:
                print(f"           有题干无答案: {m['missing_answer'][:20]}")
            if m["missing_stem"]:
                print(f"           有答案无题干: {m['missing_stem'][:20]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("setname", nargs="?", help="卷文件夹名，如 3.10新托福真题")
    ap.add_argument("--all", action="store_true", help="扫全部卷，只出汇总表")
    ap.add_argument("--json", action="store_true", help="落盘中间产物")
    args = ap.parse_args()

    if args.all:
        os.makedirs(OUT, exist_ok=True)
        rows = []
        for d in sorted(os.listdir(SRC)):
            if not os.path.isdir(os.path.join(SRC, d)):
                continue
            try:
                r = scan_set(d)
            except Exception as e:  # 单卷炸掉不许拖垮全表
                rows.append((d, f"ERR {type(e).__name__}: {e}"))
                continue
            cells = []
            for s in SECTIONS:
                a = r["alignment"][s]
                cells.append(f"{s[:4]}:{a['matched_count']}/{a['status'][:4]}")
            line = ("答案✓" if r["answer_key"] else "答案✗") + "  " + "  ".join(cells)
            if r.get("blockers"):
                line += f"  ⚠{len(r['blockers'])}"
            rows.append((d, line))
            print(f"{d:26s} {rows[-1][1]}", flush=True)
        json.dump([{"set": a, "summary": b} for a, b in rows],
                  open(os.path.join(OUT, "_all_sets.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        print(f"\n汇总写入 {os.path.join(OUT, '_all_sets.json')}")
        return

    if not args.setname:
        ap.error("给个卷名，或用 --all")
    res = scan_set(args.setname)
    report(res)
    if args.json:
        os.makedirs(OUT, exist_ok=True)
        p = os.path.join(OUT, f"{args.setname}.json")
        json.dump(res, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"\n中间产物 → {p}")


if __name__ == "__main__":
    main()
