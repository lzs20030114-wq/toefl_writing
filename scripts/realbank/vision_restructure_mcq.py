# -*- coding: utf-8 -*-
"""真题阅读选择题「看图重抽」—— 按题号找回那一屏源截图，Qwen3-VL 只转写题干 / 选项 / 材料。

链路与判据见 scripts/realbank/vision_restructure_mcq.mjs 与 vision_mcq.js 顶部注释。本脚本只做看图这一步：
  读 .codex-tmp/realbank/vision-mcq.todo.json（--plan 的产物）
  → crop_materials.build_units 拿到这套卷的全部源截图（每张截图配它自己那段 OCR 文本）
  → 按考试界面顶栏「Reading | Question q of total」认出这道题那一屏（认不出不猜，记 no_page）
  → Qwen3-VL 用**只转写**的 prompt 出 JSON（题干 + 从上到下的选项 + 左栏材料）
  → 写 .codex-tmp/realbank/vision-mcq.candidates.json。**不写 structured、不写 data/**（写回是 .mjs --apply 的事）。

成本护栏（CLAUDE.md 约定）：--dry-run 先打印「将调用 N 次 / 预计 ¥X」；--max-calls 默认 150，超了必须 --yes；
命中 .codex-tmp/ocr 缓存（visionmcq__<卷>_M<m>_Q<q>__img1.txt）的不再调用。

用法:
  python scripts/realbank/vision_restructure_mcq.py --fill --dry-run
  python scripts/realbank/vision_restructure_mcq.py --fill [--set <卷>]... [--max-calls 150] [--yes]

退出码：0 正常；2 用法/输入缺失；3 Qwen 系统性失败（鉴权/余额/网络）。
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
OUT_DIR = os.path.join(ROOT, ".codex-tmp", "realbank")
TODO = os.path.join(OUT_DIR, "vision-mcq.todo.json")
CANDIDATES = os.path.join(OUT_DIR, "vision-mcq.candidates.json")
CACHE_SETKEY = "visionmcq"
CNY_PER_IMAGE = 0.02  # Qwen3-VL-plus 一张考场截图（~2k 视觉 token + ~1k 输出）按 ¥0.02 保守估
EXIT_SYSTEMIC = 3

# 与 vision_mcq.js 的 HEADER_RE 同一口径：竖线常被 OCR 认成 1/I/l，空格常被吃掉。
HEADER_RE = re.compile(
    r"reading\W{0,6}[I1l|/]?\W{0,6}questions?\W{0,3}(\d{1,2})\W{0,3}(?:-\W{0,3}(\d{1,2})\W{0,3})?of\W{0,3}(\d{1,2})",
    re.I,
)

# 只转写、不解题。选项顺序即答案编号 —— 顺序是硬约束。
MCQ_PROMPT = """你是逐字转写器（OCR）。图片是 TOEFL 阅读考试界面的一屏截图：左栏是阅读材料，右栏是一道选择题（题干 + 从上到下排列的选项）。
把这一屏原样转写成一个 JSON 对象：
{"material": "左栏材料正文：截图里看得见的部分原样转写，段落之间空一行；若是海报/邮件/网页/表格，按屏幕上的阅读顺序逐行转写",
 "material_kind": "poster|instructions|website|email|notice|schedule|advertisement|chart|passage 之一（按材料的样子选）",
 "stem": "右栏题干原文",
 "options": ["第 1 个选项", "第 2 个选项", "第 3 个选项", "第 4 个选项"]}

铁律：
- 只转写你真实看到的字符：不解题、不判断哪个选项正确、不补写截图外的内容、不纠错、不润色、不翻译。
- options 严格按屏幕上从上到下的原始顺序；去掉选项前的圆圈/字母编号；有几个写几个，不要凑数也不要漏。
- 题干上方的指令语（如 "Read a notice."）不算题干；题干是真正的问句或待补全的句子。
- 不要转写界面元素：顶栏 "Reading | Question N of 35"、计时器、Hide Time、Next/Back/Review 按钮、页码、水印。
- 材料里被高亮/加粗/加框的词照常转写，不加任何标记。
- 看不清的字符写成 ?，不要猜。
- 直接输出 JSON 本身，不要任何前言、说明或 markdown 代码围栏。"""


def _load_sibling(name: str):
    spec = importlib.util.spec_from_file_location(f"rb_{name}", os.path.join(HERE, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def unit_header(text: str):
    """这张截图自己的顶栏（段首那一个）。返回 (q, q_end, total) 或 None。"""
    m = HEADER_RE.search(text or "")
    if not m:
        return None
    q = int(m.group(1))
    return q, (int(m.group(2)) if m.group(2) else q), int(m.group(3))


def infer_headers(units: list) -> list:
    """给每张截图一个 (q, total)：OCR 顶栏认得出的直接用；认不出的，夹在两张已知截图之间且
    「张数差 == 题号差」（同一 total、中间一屏一题）才按顺序补上。其余留 None —— 不猜。"""
    known = [unit_header(u["text"]) for u in units]
    out = list(known)
    idx = [i for i, h in enumerate(known) if h and h[0] == h[1]]
    for a, b in zip(idx, idx[1:]):
        qa, _, ta = known[a]
        qb, _, tb = known[b]
        if ta != tb or b - a <= 1 or qb - qa != b - a:
            continue
        for k in range(a + 1, b):
            if known[k] is None:
                out[k] = (qa + (k - a), qa + (k - a), ta)
    return out


def parse_json_loose(raw: str):
    s = str(raw or "").strip()
    s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
    s = re.sub(r"```\s*$", "", s).strip()
    if not s:
        return None
    try:
        return json.loads(s)
    except Exception:
        pass
    dec = json.JSONDecoder()
    for m in re.finditer(r"[\[{]", s):
        try:
            obj, _end = dec.raw_decode(s[m.start():])
            return obj
        except Exception:
            continue
    return None


def cache_key(e: dict) -> str:
    return f"{e['set']}_M{e['module']}_Q{e['q']}"


def cmd_fill(args) -> int:
    if not os.path.exists(TODO):
        print(f"没有 {TODO}，先跑 node scripts/realbank/vision_restructure_mcq.mjs --plan", file=sys.stderr)
        return 2
    with open(TODO, encoding="utf-8") as fh:
        entries = json.load(fh).get("entries") or []
    if args.set:
        entries = [e for e in entries if e.get("set") in set(args.set)]
    if args.keys:
        want = set(k.strip() for k in args.keys.split(",") if k.strip())
        entries = [e for e in entries if e.get("key") in want]
    if not entries:
        print("todo 里没有条目。")
        return 0
    ocr_images = _load_sibling("ocr_images")
    need = [e for e in entries if args.force or ocr_images.read_cache(CACHE_SETKEY, cache_key(e), 1) is None]
    print(f"目标 {len(entries)} 题，其中要调 Qwen 的 {len(need)} 次（{len(entries) - len(need)} 条命中缓存），"
          f"预计 ¥{len(need) * CNY_PER_IMAGE:.2f}（按 ¥{CNY_PER_IMAGE}/张估；定位不到源截图的不调用，实际只少不多）")
    if args.dry_run:
        by = {}
        for e in need:
            by[e["category"]] = by.get(e["category"], 0) + 1
        print("  按分类：", by)
        print("（--dry-run，未写任何文件、未发任何请求）")
        return 0
    if len(need) > args.max_calls and not args.yes:
        print(f"[停] 将调用 {len(need)} 次超过 --max-calls {args.max_calls}；确认要跑请加 --yes", file=sys.stderr)
        return 2

    crop = _load_sibling("crop_materials")  # 这一句才会拖进 cv2 / fitz / PIL
    ocr_images.load_env()
    insert_mod = _load_sibling("restore_insert_markers")

    candidates, skipped = [], []
    calls = 0
    systemic = False
    units_cache: dict = {}
    for i, e in enumerate(sorted(entries, key=lambda x: (x["set"], x["module"], x["q"])), start=1):
        key = e["key"]
        s = e["set"]
        if s not in units_cache:
            units, src = crop.build_units(s, "")
            units_cache[s] = (units, infer_headers(units), src)
        units, heads, _src = units_cache[s]
        hits = [u for u, h in zip(units, heads) if h and h[0] == e["q"] and h[1] == e["q"] and h[2] == e["total"]]
        if not hits:
            skipped.append({"key": key, "why": "no_page"})
            print(f"  [{i}/{len(entries)}] × {key}  no_page（源截图里认不出 Question {e['q']} of {e['total']}）")
            continue
        unit = hits[-1] if len(hits) > 1 else hits[0]
        if len(hits) > 1 and e.get("existing") and e["existing"].get("stem"):
            # 同一题号截了两张（翻页前后）：挑题干最像的那张
            stem = e["existing"]["stem"]
            unit = max(hits, key=lambda u: insert_mod.glued_coverage(stem, u["text"]))
        ck = cache_key(e)
        text = None if args.force else ocr_images.read_cache(CACHE_SETKEY, ck, 1)
        if text is None:
            if systemic:
                skipped.append({"key": key, "why": "ocr_aborted"})
                continue
            png, _ext = insert_mod._as_png(unit["img"])
            data, ext = ocr_images.shrink(png, "png")
            try:
                text = ocr_images.call_qwen(data, ext, args.model, prompt=MCQ_PROMPT)
            except ocr_images.SystemicFailure as ex:
                print(f"\n[中止] Qwen 系统性失败：{ex}", file=sys.stderr)
                systemic = True
                skipped.append({"key": key, "why": "ocr_systemic_failure"})
                continue
            except Exception as ex:  # noqa: BLE001 —— 单条失败不拖垮整批
                skipped.append({"key": key, "why": f"ocr_error:{str(ex)[:120]}"})
                print(f"  [{i}/{len(entries)}] × {key}  ocr_error {str(ex)[:80]}")
                continue
            calls += 1
            if text.strip():
                ocr_images.write_cache(CACHE_SETKEY, ck, 1, text)
        parsed = parse_json_loose(text)
        if not isinstance(parsed, dict):
            skipped.append({"key": key, "why": "unparsable", "raw": text[:400]})
            print(f"  [{i}/{len(entries)}] × {key}  转写不是 JSON 对象")
            continue
        opts = parsed.get("options") if isinstance(parsed.get("options"), list) else []
        candidates.append({
            **{k: e[k] for k in ("key", "set", "module", "q", "total", "answer", "category", "record_key", "record_type")},
            "source_page": unit["ref"], "model": args.model, "raw": text, "parsed": parsed,
        })
        print(f"  [{i}/{len(entries)}] ✓ {key}  {len(opts)} 个选项  {str(parsed.get('stem') or '')[:70]}  ← {unit['ref']}")

    with open(CANDIDATES, "w", encoding="utf-8") as fh:
        json.dump({"candidates": candidates, "skipped": skipped}, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"\n候选 {len(candidates)} 条 / 跳过 {len(skipped)} 条；实际调用 Qwen {calls} 次 ≈ ¥{calls * CNY_PER_IMAGE:.2f}")
    print(f"→ {CANDIDATES}")
    print("下一步：node scripts/realbank/vision_restructure_mcq.mjs --apply --dry")
    return EXIT_SYSTEMIC if systemic else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="真题阅读选择题看图重抽（Qwen3-VL 只转写）")
    ap.add_argument("--fill", action="store_true")
    ap.add_argument("--set", action="append", default=None)
    ap.add_argument("--keys", default=None, help="只处理这些 key（逗号分隔，<卷>|M1|Q27）")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="忽略缓存重跑")
    ap.add_argument("--max-calls", type=int, default=150)
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--model", default=os.environ.get("QWEN_VL_MODEL") or "qwen3-vl-plus")
    args = ap.parse_args()
    if args.fill:
        return cmd_fill(args)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
