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

# Windows 控制台默认代码页(GBK/cp936)编不出 ⚠ 等符号，report() 里一遇到就整个
# 进程崩掉（本轮 5 月新卷验证时实测 5.11/5.20 两套的 blockers 一有这个字符就炸，
# 后面的对齐结果和 --json 落盘都没跑到）。管道/文件重定向下 stdout 不是 tty，
# reconfigure 不影响交互终端的正常显示，只在编不出的字符上退化成 '?' 而不是崩溃。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ops"))

import fitz  # PyMuPDF
from ingest_common import (
    SECTIONS, align, content_hash, detect_section, find_anchors,
    parse_answer_pdf_with_warnings, resolve_orphan_chains, segment, strip_watermark,
)

DEFAULT_SRC = r"D:\桌面\【2026改后全科真题】（持续更新中）"
# --src / REALBANK_SRC 覆盖源目录（转换后的 docx 套题落在别处，不写回桌面源库）；
# --src 优先于环境变量；两者都没给就用默认桌面路径，行为与改动前一致。
SRC = os.environ.get("REALBANK_SRC") or DEFAULT_SRC
# 产物一律相对仓库根（本文件在 <root>/scripts/realbank/ 下），不再写死 D:\toefl_writing ——
# 云端 checkout 在 /home/runner/work/... 下，写死路径会让整条链路的中间产物落到不存在的盘符。
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OCR_CACHE = os.path.join(REPO_ROOT, ".codex-tmp", "ocr")
OUT = os.path.join(REPO_ROOT, ".codex-tmp", "realbank")
# 口语音频源多为屏幕录制的 .mp4/.mov（15/43 个 2026-09-06 补料文件），
# 音轨同样是 AAC，ffmpeg 可直接抽取；漏掉它们会把有音频的套判成「无音频」。
AUDIO_EXT = (".mp3", ".m4a", ".wav", ".mp4", ".mov")
TEXT_LAYER_MIN = 200  # 去水印后的正文总字符数，低于此判为图片 PDF
# 只看总字数会漏判长篇图片 PDF：实测 `3.2新托福真题B卷/3.2 套二 阅读.pdf`（12 页 629 字）
# 与 `4.20新托福真题/4.20  阅读.pdf`（18 页 703 字）是纯扫描件，只带页眉那一行文字层，
# 总字数却双双越过 200 → 走了文字层、OCR 从没跑过 → 体检表上整科 no_stems。
# 全库 226 份 PDF 实测：真文字 PDF 每页密度最低 384.5 字，这两份是 52.4 / 39.1 字每页，
# 中间是数量级的空档。150 字/页 取在空档中间，两侧都有 2.5 倍以上余量。
TEXT_LAYER_MIN_PER_PAGE = 150


RETRY_ZOOM = 4.5  # OCR 一无所获时的重试倍率（3.0 → 4.5）


def _ocr_all(doc, zoom):
    from ocr_common import ocr_page  # 只在真要现场 OCR 时才加载引擎
    parts = []
    for i in range(doc.page_count):
        parts.append(f"===== PAGE {i + 1} =====")
        parts.append(ocr_page(doc.load_page(i), zoom))
    return "\n".join(parts)


def _barren(text):
    """一份 OCR 结果「一无所获」：既没有题号页眉，也解析不出成串答案。
    这种文本对管线毫无价值，值得用更高倍率重扫一次。"""
    from ingest_common import parse_answer_pdf
    if find_anchors(text):
        return False
    return sum(len(m) for v in parse_answer_pdf(text).values() for m in v) < 10


def pdf_text(path):
    """返回 (文本, 来源)。来源 = text-layer / ocr-cache / ocr-live / ocr-live-4.5。"""
    doc = fitz.open(path)
    raw = "\n".join(doc.load_page(i).get_text() for i in range(doc.page_count))
    body = len(strip_watermark(raw).strip())
    pages = max(1, doc.page_count)
    if body >= TEXT_LAYER_MIN and body / pages >= TEXT_LAYER_MIN_PER_PAGE:
        return raw, "text-layer"

    setname = os.path.basename(os.path.dirname(path))
    base = os.path.splitext(os.path.basename(path))[0]
    cache = os.path.join(OCR_CACHE, f"{setname}__{base}.txt")
    # 高倍率重扫的哨兵：重扫过一次就不再重扫，否则每次跑管线都要白烧一遍 OCR
    sentinel = os.path.join(OCR_CACHE, f"{setname}__{base}.z{int(RETRY_ZOOM * 10)}")
    cached = None
    if os.path.exists(cache) and os.path.getsize(cache) > 50:
        cached = open(cache, encoding="utf-8").read()
        if not _barren(cached) or os.path.exists(sentinel):
            return cached, "ocr-cache"

    os.makedirs(OCR_CACHE, exist_ok=True)
    origin = "ocr-cache"
    if cached is None:
        cached, origin = _ocr_all(doc, 3.0), "ocr-live"
        open(cache, "w", encoding="utf-8").write(cached)
        if not _barren(cached):
            return cached, origin
    # 一无所获 → 换更高倍率再扫一次；**只有真的扫出东西才覆盖缓存**，
    # 否则保留原结果（宁可不动，也不能用更差的结果盖掉原来的）。
    retry = _ocr_all(doc, RETRY_ZOOM)
    open(sentinel, "w", encoding="utf-8").write(f"retried at zoom={RETRY_ZOOM}\n")
    if not _barren(retry):
        open(cache, "w", encoding="utf-8").write(retry)
        return retry, f"ocr-live-{RETRY_ZOOM}"
    return cached, origin


def scan_set(setname, do_ocr=True, src=None):
    folder = os.path.join(src or SRC, setname)
    if not os.path.isdir(folder):
        raise SystemExit(f"找不到卷: {folder}")

    files, audio, answers_from = [], [], None
    answer_modules = {s: [] for s in SECTIONS}
    all_blocks, blockers = [], []
    orphan_chains, answer_entry = [], None

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
            parsed, ans_warnings, orphans = parse_answer_pdf_with_warnings(text)
            n_ans = sum(len(m) for v in parsed.values() for m in v)
            # 无科目头的孤儿块也算进「这份是不是答案页」的证据，否则整段答案没头时
            # 答案页会被判成题面（3.29 的听力段就占了这份 PDF 的 40%）
            n_ans += sum(len(m) for ch in orphans for m in ch["modules"])
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
                answer_entry = entry
                for s in SECTIONS:
                    if parsed[s]:
                        answer_modules[s] = parsed[s]
                orphan_chains.extend((rel, ch) for ch in orphans)
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

    # 无科目头的整块答案：按题号形状与「各科尚无答案的题块组」比对，唯一命中才采用，
    # 采不采用都往 blockers 里写一条，让人能看见这里做过推断。
    if orphan_chains:
        for rel in dict.fromkeys(r for r, _c in orphan_chains):
            for note in resolve_orphan_chains([c for r, c in orphan_chains if r == rel],
                                              answer_modules, all_blocks):
                blockers.append(f"[{rel}] {note['message']}")
        if answer_entry is not None:
            answer_entry["answers"] = {s: [len(m) for m in v]
                                       for s, v in answer_modules.items() if v}

    alignment = {s: align(all_blocks, answer_modules[s], s) for s in SECTIONS}
    for s in SECTIONS:
        for msg in alignment[s].get("self_check", []):
            blockers.append(f"[自检] {msg}")
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
    ap.add_argument("--src", default=None,
                     help="覆盖源目录（默认桌面路径，也可用 REALBANK_SRC 环境变量；"
                          "两者都不给不改变原行为）")
    args = ap.parse_args()
    src = args.src or SRC

    if args.all:
        os.makedirs(OUT, exist_ok=True)
        rows = []
        for d in sorted(os.listdir(src)):
            if not os.path.isdir(os.path.join(src, d)):
                continue
            try:
                r = scan_set(d, src=src)
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
    res = scan_set(args.setname, src=src)
    report(res)
    if args.json:
        os.makedirs(OUT, exist_ok=True)
        p = os.path.join(OUT, f"{args.setname}.json")
        json.dump(res, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"\n中间产物 → {p}")


if __name__ == "__main__":
    main()
