#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""真题「点选句子」题的题干逐字转写 —— Qwen3-VL 看那一屏源截图。

输入：.codex-tmp/realbank/sentence-select.todo.json（sentence_select_ledger.mjs --list 产出）
输出：.codex-tmp/realbank/sentence-select.stems.json（给 sentence_select_ledger.mjs --merge 用）

为什么要看截图：第一来源的整份 OCR 是本地引擎跑的，右栏题干和左栏正文经常被拼在同一行
（"…Earth's core (the Identify the sentence in paragraph3 thatdescribes a specific"），空格也常丢光；
structured.json 里的题干又是 DeepSeek 读 OCR 之后的结构化输出，可能被顺手「修」过。题干要原样上线给
用户看，所以只认转写。

定位与缓存复用 restore_insert_markers.py / crop_materials.py 那一套：
  · 源截图单元 crop_materials.build_units(套名, "")（第一来源 PDF 逐页大图 + 该页 OCR 分段文本）；
  · 挑单元：先找 OCR 文本里带「Question q of T」页眉、且有 identify/select the sentence 的那一屏；
    页眉被 OCR 吃掉的（1.28A 第 8 页第二张图）退回「有 select 指令 + 与该题材料 / structured 题干的粘字覆盖率 ≥0.6」；
  · Qwen 调用走 ocr_images.call_qwen，结果缓存在 .codex-tmp/ocr/sentsel__<套>_M<m>_Q<q>__img1.txt，
    命中缓存不再花钱。

成本护栏（CLAUDE.md 约定）：--dry-run 先打印「将调用 N 次 / 预计 ¥X」；--max-calls 默认 40，超了须 --yes。
没有答案键的题（答案页漏了这一题）不转写 —— 定不了正确句，转了也上不了线。

用法:
  python scripts/realbank/sentence_select_stems.py --dry-run
  python scripts/realbank/sentence_select_stems.py [--env-file D:/toefl_writing/.env.local] [--set 5.3新托福真题]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RB = os.path.join(ROOT, ".codex-tmp", "realbank")
TODO = os.path.join(RB, "sentence-select.todo.json")
OUT = os.path.join(RB, "sentence-select.stems.json")
CACHE_SETKEY = "sentsel"
COVERAGE_MATCH = 0.60
SELECT_RE = re.compile(r"identify\s*the\s*sentence|select\s*the\s*sentence", re.I)

STEM_PROMPT = """你是逐字转写器（OCR）。这是一张 TOEFL 阅读考试界面截图：一侧是文章正文，另一侧是题目栏。
只转写**题目栏**里的题干文字。

铁律：
- 只转写你真实看到的字符，不解释、不翻译、不总结、不补写、不纠错；单词之间按图中的样子用空格分开。
- 不要转写文章正文、选项、界面按钮（Hide Time / Next / Back / Review / Volume）、计时器、页眉页脚、水印。
- 题干如果有两句（例如 "Identify the sentence in paragraph 2 that ... Select the sentence to make your choice."），两句都照录。
- 看不清的字符写成 ?，不要猜。
- 只输出 JSON：{"stem": "..."}，不要 markdown 代码围栏，不要任何说明。"""


def _load_sibling(name: str):
    spec = importlib.util.spec_from_file_location(f"rb_{name}", os.path.join(HERE, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_env_file(p: str | None) -> None:
    """--env-file 指定的 .env（worktree 里没有 .env.local 时指向主工作树那份，只读）。已有的环境变量不覆盖。"""
    if not p or not os.path.exists(p):
        return
    with open(p, "r", encoding="utf-8") as fh:
        for line in fh:
            m = re.match(r"^\s*(\w+)\s*=\s*(.*)$", line)
            if m and not os.environ.get(m.group(1)):
                os.environ[m.group(1)] = m.group(2).strip().strip("'\"")


def glue(text) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(text or "").lower())


def glued_coverage(item_text, ocr_text) -> float:
    """粘字容忍：item 的每个词（≥3 字母）有多大比例能在 OCR 的纯字母长串里找到。"""
    words = [w for w in re.findall(r"[a-z0-9]+", str(item_text or "").lower()) if len(w) >= 3]
    if not words:
        return 0.0
    hay = glue(ocr_text)
    return sum(1 for w in words if w in hay) / len(words)


def header_hit(text: str, q: int, total: int) -> bool:
    return re.search(rf"question\W{{0,3}}{q}\W{{0,3}}of\W{{0,3}}{total}\b", str(text or ""), re.I) is not None


def pick_unit(units: list, entry: dict):
    q, module = int(entry["q_number"]), int(entry["module"])
    total = 35 if module == 1 else 15
    stem_hint = entry.get("stem_structured") or ""
    material = entry.get("material") or ""
    with_select = [u for u in units if SELECT_RE.search(u["text"]) or "identifythesentence" in glue(u["text"])
                   or "selectthesentence" in glue(u["text"])]
    headed = [u for u in with_select if header_hit(u["text"], q, total)]
    if len(headed) == 1:
        return headed[0], "header"
    pool = headed or with_select
    scored = []
    for u in pool:
        sc_stem = glued_coverage(stem_hint, u["text"]) if stem_hint else 0.0
        sc_mat = glued_coverage(material, u["text"]) if material else 0.0
        if (stem_hint and sc_stem >= COVERAGE_MATCH) or (not stem_hint and sc_mat >= COVERAGE_MATCH):
            scored.append((sc_stem, sc_mat, u))
    if not scored:
        return None, "no_question_page"
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return scored[0][2], "stem_coverage"


def parse_stem(content: str) -> str:
    s = str(content or "").strip()
    try:
        j = json.loads(s)
        if isinstance(j, dict) and isinstance(j.get("stem"), str):
            return j["stem"].strip()
    except Exception:
        pass
    m = re.search(r'"stem"\s*:\s*"((?:[^"\\]|\\.)*)"', s)
    if m:
        return json.loads(f'"{m.group(1)}"').strip()
    return ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--set", action="append")
    ap.add_argument("--max-calls", type=int, default=40)
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--force", action="store_true", help="无视缓存重新转写")
    ap.add_argument("--env-file", default=None)
    ap.add_argument("--model", default=os.environ.get("QWEN_VL_MODEL") or "qwen3-vl-plus")
    args = ap.parse_args()

    if not os.path.exists(TODO):
        print(f"没有 {TODO}，先跑 node scripts/realbank/sentence_select_ledger.mjs --list", file=sys.stderr)
        return 2
    with open(TODO, encoding="utf-8") as fh:
        entries = json.load(fh).get("entries") or []
    if args.set:
        entries = [e for e in entries if e.get("set") in set(args.set)]

    ocr_images = _load_sibling("ocr_images")
    key = lambda e: f"{e['set']}_M{e['module']}_Q{e['q_number']}"
    todo = [e for e in entries if e.get("answer_raw") is not None]
    need = [e for e in todo if args.force or ocr_images.read_cache(CACHE_SETKEY, key(e), 1) is None]
    print(f"候选 {len(entries)} 道；有答案键的 {len(todo)} 道；要调 Qwen 的 {len(need)} 次"
          f"（其余命中缓存），预计 ¥{len(need) * ocr_images.CNY_PER_IMAGE:.2f}")
    if args.dry_run:
        for e in need:
            print(f"  · {key(e)}")
        print("（--dry-run，未发请求、未写文件）")
        return 0
    if len(need) > args.max_calls and not args.yes:
        print(f"[停] 将调用 {len(need)} 次超过 --max-calls {args.max_calls}；确认要跑请加 --yes", file=sys.stderr)
        return 2

    load_env_file(args.env_file)
    ocr_images.load_env()
    crop = _load_sibling("crop_materials")

    out, skipped = [], [{"key": key(e), "why": "no_answer_key"} for e in entries if e.get("answer_raw") is None]
    calls = 0
    units_cache: dict[str, list] = {}
    for e in todo:
        k = key(e)
        if e["set"] not in units_cache:
            units_cache[e["set"]], _src = crop.build_units(e["set"], "")
        units = units_cache[e["set"]]
        if not units:
            skipped.append({"key": k, "why": "no_source"})
            print(f"  × {k}  no_source")
            continue
        unit, how = pick_unit(units, e)
        if unit is None:
            skipped.append({"key": k, "why": how})
            print(f"  × {k}  {how}")
            continue
        cached = None if args.force else ocr_images.read_cache(CACHE_SETKEY, k, 1)
        if cached is None:
            try:
                png = unit["img"]
                data, ext = ocr_images.shrink(png, "png")
                cached = ocr_images.call_qwen(data, ext, args.model, prompt=STEM_PROMPT)
            except ocr_images.SystemicFailure as ex:
                print(f"[中止] Qwen 系统性失败：{ex}", file=sys.stderr)
                return 3
            except Exception as ex:  # noqa: BLE001
                skipped.append({"key": k, "why": f"ocr_error:{str(ex)[:120]}"})
                print(f"  × {k}  ocr_error")
                continue
            calls += 1
            if cached.strip():
                ocr_images.write_cache(CACHE_SETKEY, k, 1, cached)
        stem = parse_stem(cached)
        if not stem:
            skipped.append({"key": k, "why": "unparseable_response"})
            print(f"  × {k}  unparseable_response")
            continue
        out.append({"set": e["set"], "module": e["module"], "q_number": e["q_number"], "stem_raw": stem,
                    "source_page": unit["ref"], "located_by": how, "model": args.model})
        print(f"  ✓ {k}  [{how}] {unit['ref']}  「{stem[:90]}」")

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"generated_by": "scripts/realbank/sentence_select_stems.py", "entries": out, "skipped": skipped},
                  fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"\n转写 {len(out)} 道 / 跳过 {len(skipped)} 道；实际调用 Qwen {calls} 次 ≈ ¥{calls * ocr_images.CNY_PER_IMAGE:.2f}")
    print(f"→ {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
