# -*- coding: utf-8 -*-
"""真题填词（CTW）「看图正文」—— 源截图 → Qwen3-VL 逐字转写（挖空词只留露出的前缀 + "_"）+ 正文忠实度核对。

为什么要看图（2026-09-13 实测）：第一来源的填词屏是本地 OCR 抽的文本，**常把整行吃掉**；structure_set.mjs 的模型
为了交出「补全后的完整原文」会把缺的句子编出来 —— 3.30 M1 11-20 开头整句丢失，产物写成「Health innovations such as…」；
3.15 M1 1-10 编出「they were also interested in the process of dancing」（同篇 3.29 原文是
「group dancing was important to them. They made masks and costumes…」）。挖空逐空校验（ctw_verify.js）照样过，
因为十个挖空词都在；坏的是挖空之外的正文。看图转写的行是全的，喂给 structure_set.mjs --ctw-vision-body 就不必编。

两种模式：
  转写（默认）：定位填词那一屏（顶栏「Question 1-10 of 35」；认不出就拿这一块的本地 OCR 正文按覆盖率找唯一最像的截图），
               调 Qwen3-VL，只写缓存 .codex-tmp/ocr/ctwvis__<卷>_M<m>_<起>-<止>__img1.txt。不写 structured、不写 data/。
  --fidelity  ：零调用。structured 里 status=ok 的 CTW 块 vs 缓存转写，按词序列对齐（挖空位两边都换成占位），
               统计「正文里有、截图上没有」的实词（编造）与「截图上有、正文里没有」的实词（丢句），落 JSON 报告。

成本护栏：--dry-run 先报「将调用 N 次 / 预计 ¥X」；--max-calls 默认 150，超了须 --yes；命中缓存不再调用。

用法:
  python scripts/realbank/ctw_vision_transcribe.py --set 3.30新托福真题 [--set …] --dry-run
  python scripts/realbank/ctw_vision_transcribe.py --blocks-json blocks.json            # [{"set": "...", "key": "reading|1|11-20|35"}]
  python scripts/realbank/ctw_vision_transcribe.py --fidelity --blocks-json blocks.json --out report.json

退出码：0 正常；2 用法/输入缺失；3 Qwen 系统性失败。
"""
from __future__ import annotations

import argparse
import difflib
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
OCR_DIR = os.path.join(ROOT, ".codex-tmp", "ocr")
CACHE_SETKEY = "ctwvis"  # structure_set.mjs --ctw-vision-body 按同一个名字读
CNY_PER_IMAGE = 0.02
EXIT_SYSTEMIC = 3
CTW_BODY = re.compile(r"fill\s*in\s*the\s*missing\s*letters", re.I)

CTW_PROMPT = """你是逐字转写器（OCR）。图片是 TOEFL「Complete the Words」补全单词题的一屏截图：一段短文，其中一些词只显示前几个字母，后面是空白格。
逐字转写这段短文：
- 完整的词照抄；被挖空的词只写屏幕上露出的那几个字母，紧接一个下划线 _ 表示空白（例如 "Th_ can cha_ landscapes"），不要补全、不要猜后面的字母。
- 保持原文顺序与标点；段落之间空一行。
- 不要转写指令语 "Fill in the missing letters in the paragraph."、顶栏、计时器、按钮、水印。
- 看不清的字符写成 ?，不要猜。
- 直接输出正文本身，不要任何前言、说明或 markdown 代码围栏。"""


def _load_sibling(name: str):
    spec = importlib.util.spec_from_file_location(f"rb_{name}", os.path.join(HERE, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def cache_stem(setname: str, module, start, end) -> str:
    return f"{setname}_M{module}_{start}-{end}"


def load_json(p, fb=None):
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return fb


def ctw_blocks_of(setname: str) -> list[dict]:
    """这套卷里真填词块（答案 ≥5 个 + 正文带填词指令语）。"""
    scan = load_json(os.path.join(OUT_DIR, f"{setname}.json"), {})
    out = []
    for m in (((scan.get("alignment") or {}).get("reading") or {}).get("modules") or []):
        groups: dict = {}
        for x in m.get("matched") or []:
            b = x["block"]
            groups.setdefault((b["start"], b["end"], b["total"]), []).append(x)
        for (s, e, t), xs in groups.items():
            if len(xs) >= 5 and CTW_BODY.search(xs[0]["block"].get("body") or ""):
                out.append({"set": setname, "key": f"reading|{m['module']}|{s}-{e}|{t}", "body": xs[0]["block"].get("body") or ""})
    return out


def block_body(setname: str, key: str) -> str:
    for b in ctw_blocks_of(setname):
        if b["key"] == key:
            return b["body"]
    return ""


# ── 转写 ───────────────────────────────────────────────────────────────────
def cmd_transcribe(args, blocks) -> int:
    ocr = _load_sibling("ocr_images")
    need = [b for b in blocks if args.force or ocr.read_cache(CACHE_SETKEY, stem_of(b), 1) is None]
    print(f"填词块 {len(blocks)}，要调 Qwen {len(need)} 次（{len(blocks) - len(need)} 块命中缓存），预计 ¥{len(need) * CNY_PER_IMAGE:.2f}")
    if args.dry_run:
        print("（--dry-run，未发任何请求）")
        return 0
    if len(need) > args.max_calls and not args.yes:
        print(f"[停] 将调用 {len(need)} 次超过 --max-calls {args.max_calls}；确认要跑请加 --yes", file=sys.stderr)
        return 2
    crop = _load_sibling("crop_materials")
    vis = _load_sibling("vision_restructure_mcq")
    ins = _load_sibling("restore_insert_markers")
    ocr.load_env()
    units_cache: dict = {}
    calls = 0
    for b in need:
        s, key = b["set"], b["key"]
        _, mod, rng, total = key.split("|")
        qs, qe = [int(x) for x in rng.split("-")]
        if s not in units_cache:
            units, _src = crop.build_units(s, "")
            units_cache[s] = (units, vis.infer_headers(units))
        units, heads = units_cache[s]
        hit = [u for u, h in zip(units, heads) if h and h[0] == qs and h[1] == qe and h[2] == int(total)]
        if not hit:
            # 顶栏认不出（M2 填词屏常见）：本地 OCR 正文就是从那一页抽的，按覆盖率找**唯一**最像的截图
            body = re.sub(r"=====\s*PAGE\s+\d+\s*=====", " ", b.get("body") or block_body(s, key))
            scored = sorted(((ins.glued_coverage(body, u["text"]), u) for u in units), key=lambda t: -t[0])
            if scored and scored[0][0] >= 0.8 and (len(scored) < 2 or scored[1][0] < scored[0][0] - 0.1):
                hit = [scored[0][1]]
        if not hit:
            # 仍然认不出：那一页装了两张截图、却只 OCR 出一个顶栏，build_units 整页作废（M2 填词屏在上一屏之后同页）。
            # 退一步：按本地 OCR 正文找覆盖率 ≥0.8 的那一页，页上每张大图各转写一次，取与本地正文最像（≥0.6）的那张。
            # 最多多花一张图的钱；两张都不像就放弃，不猜。
            text, ref, extra = page_fallback(crop, ins, ocr, args, s, b, key)
            calls += extra
            if text is None:
                print(f"  × {s} {key} 找不到源截图")
                continue
            ocr.write_cache(CACHE_SETKEY, stem_of(b), 1, text)
            print(f"  ✓ {s} {key} ← {ref}（整页退路）")
            continue
        png, _ = ins._as_png(hit[0]["img"])
        data, ext = ocr.shrink(png, "png")
        try:
            text = ocr.call_qwen(data, ext, args.model, prompt=CTW_PROMPT)
        except ocr.SystemicFailure as ex:
            print(f"\n[中止] Qwen 系统性失败：{ex}", file=sys.stderr)
            return EXIT_SYSTEMIC
        except Exception as ex:  # noqa: BLE001
            print(f"  × {s} {key} 调用失败：{str(ex)[:100]}")
            continue
        calls += 1
        if text.strip():
            ocr.write_cache(CACHE_SETKEY, stem_of(b), 1, text)
        print(f"  ✓ {s} {key} ← {hit[0]['ref']}")
    print(f"实际调用 Qwen {calls} 次 ≈ ¥{calls * CNY_PER_IMAGE:.2f}")
    return 0


def page_fallback(crop, ins, ocr, args, setname: str, b: dict, key: str):
    """整页退路。返回 (转写文本 | None, 源描述, 实际调用次数)。探测转写各自缓存在 ctwvisprobe__ 下，重跑不重复计费。"""
    body = re.sub(r"=====\s*PAGE\s+\d+\s*=====", " ", b.get("body") or block_body(setname, key))
    pdf = crop.first_source_pdf(setname)
    if not pdf:
        return None, None, 0
    pages = crop.first_source_ocr(setname, pdf)
    scored = sorted(((ins.glued_coverage(body, t), p) for p, t in pages.items()), reverse=True)
    if not scored or scored[0][0] < 0.8:
        return None, None, 0
    page = scored[0][1]
    imgs = crop.pdf_units(pdf).get(page) or []
    best, calls = None, 0
    for k, img in enumerate(imgs, start=1):
        probe_stem = f"{stem_of(b)}_p{page}_{k}"
        text = ocr.read_cache("ctwvisprobe", probe_stem, 1)
        if text is None:
            png, _ = ins._as_png(img["png"])
            data, ext = ocr.shrink(png, "png")
            try:
                text = ocr.call_qwen(data, ext, args.model, prompt=CTW_PROMPT)
            except ocr.SystemicFailure:
                raise
            except Exception:  # noqa: BLE001
                continue
            calls += 1
            if text.strip():
                ocr.write_cache("ctwvisprobe", probe_stem, 1, text)
        cov = ins.glued_coverage(body, text)
        if best is None or cov > best[0]:
            best = (cov, text, f"{os.path.basename(pdf)} p{page} #{k}")
    if best is None or best[0] < 0.6:
        return None, None, calls
    return best[1], best[2], calls


def stem_of(b: dict) -> str:
    _, mod, rng, _t = b["key"].split("|")
    s, e = rng.split("-")
    return cache_stem(b["set"], mod, s, e)


# ── 忠实度 ─────────────────────────────────────────────────────────────────
WORD = re.compile(r"[A-Za-z][A-Za-z'’\-]*_*\?*|_+")
INSTR = re.compile(r"fill\s*in\s*the\s*missing\s*letters\s*in\s*the\s*paragraph\.?", re.I)
HDR = re.compile(r"reading\W{0,6}[I1l|/]?\W{0,6}questions?\W{0,3}\d{1,2}\W{0,3}(?:-\W{0,3}\d{1,2}\W{0,3})?of\W{0,3}\d{1,2}", re.I)
# 判「忠实」的容差：编造实词 ≤1（OCR 一两个字母的出入常被切成一个词）、丢失实词 ≤3（截图边缘半行、页脚残字）。
FAB_MAX = 1
DROP_MAX = 3


def _low(w: str) -> str:
    return re.sub(r"[^a-z]", "", w.lower())


def vision_tokens(text: str) -> list[str]:
    t = HDR.sub(" ", INSTR.sub(" ", text or ""))
    out = []
    for m in WORD.finditer(t):
        w = m.group(0)
        out.append("<B>" if ("_" in w or w.endswith("?")) else _low(w))
    return [x for x in out if x]


def passage_tokens(passage: str, blanks: list) -> list[str]:
    toks = [t for t in (_low(w) for w in re.findall(r"[A-Za-z][A-Za-z'’\-]*", passage or "")) if t]
    cur = 0
    for b in blanks or []:
        want = _low(str(b.get("word") or ""))
        for i in range(cur, len(toks)):
            if toks[i] == want:
                toks[i] = "<B>"
                cur = i + 1
                break
    return toks


def compare(passage: str, blanks: list, vision: str) -> dict:
    """正文 vs 看图转写。返回 {verdict: faithful|fabricated|dropped_text, fab_words, drop_words, fabricated[], dropped[]}。"""
    P = passage_tokens(passage, blanks)
    V = vision_tokens(vision)
    sm = difflib.SequenceMatcher(a=V, b=P, autojunk=False)
    fabricated, dropped = [], []
    fab_words = drop_words = 0
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            continue
        vs = [x for x in V[i1:i2] if x != "<B>"]
        ps = [x for x in P[j1:j2] if x != "<B>"]
        if len(vs) <= 1 and len(ps) <= 1:  # 单词级出入（OCR 错一两个字母 / 挖空被补全）不算
            a, c = (vs[0] if vs else ""), (ps[0] if ps else "")
            if not a or not c or a.startswith(c[:3]) or c.startswith(a[:3]) or difflib.SequenceMatcher(a=a, b=c).ratio() >= 0.7:
                continue
        pc = [x for x in ps if len(x) >= 4 and x not in set(vs)]
        vc = [x for x in vs if len(x) >= 4 and x not in set(ps)]
        if pc:
            fabricated.append(" ".join(P[j1:j2]))
            fab_words += len(pc)
        if vc:
            dropped.append(" ".join(V[i1:i2]))
            drop_words += len(vc)
    verdict = "faithful" if fab_words <= FAB_MAX and drop_words <= DROP_MAX else ("fabricated" if fab_words > FAB_MAX else "dropped_text")
    return {"verdict": verdict, "ratio": round(sm.ratio(), 3), "fab_words": fab_words, "drop_words": drop_words,
            "fabricated": fabricated, "dropped": dropped}


def cmd_fidelity(args, blocks) -> int:
    rows, agg = [], {}
    st_cache: dict = {}
    for b in blocks:
        s, key = b["set"], b["key"]
        if s not in st_cache:
            st_cache[s] = load_json(os.path.join(args.structured_dir or OUT_DIR, f"{s}.structured.json"), {"results": []})
        rec = next((r for r in st_cache[s].get("results", []) if r.get("key") == key), None)
        p = os.path.join(OCR_DIR, f"{CACHE_SETKEY}__{stem_of(b)}__img1.txt")
        vision = open(p, encoding="utf-8").read() if os.path.exists(p) else None
        if not rec or rec.get("status") != "ok" or not rec.get("items"):
            row = {"set": s, "key": key, "verdict": "not_ok", "status": rec.get("status") if rec else None}
        elif not vision:
            row = {"set": s, "key": key, "verdict": "no_vision"}
        else:
            item = rec["items"][0]
            row = {"set": s, "key": key, "body_source": rec.get("body_source") or "local-ocr",
                   **compare(item.get("passage"), item.get("blanks"), vision)}
        agg[row["verdict"]] = agg.get(row["verdict"], 0) + 1
        rows.append(row)
    print("忠实度判定：", agg)
    for r in rows:
        if r["verdict"] in ("fabricated", "dropped_text"):
            print(f"  [{r['verdict']}] {r['set']} {r['key']}（{r['body_source']}）编造实词 {r['fab_words']} / 丢失实词 {r['drop_words']}")
            for x in r["fabricated"][:2]:
                print(f"      + 正文多出：{x[:120]}")
            for x in r["dropped"][:2]:
                print(f"      - 截图上有：{x[:120]}")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"summary": agg, "fab_max": FAB_MAX, "drop_max": DROP_MAX, "rows": rows}, fh, ensure_ascii=False, indent=2)
        print(f"→ {args.out}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="真题填词看图正文：Qwen3-VL 逐字转写 + 忠实度核对")
    ap.add_argument("--set", action="append", default=None, help="处理这些卷的全部填词块（可重复）")
    ap.add_argument("--blocks-json", default=None, help='[{"set": "...", "key": "reading|1|1-10|35"}]')
    ap.add_argument("--fidelity", action="store_true", help="零调用：structured 正文 vs 缓存转写")
    ap.add_argument("--out", default=None)
    ap.add_argument("--structured-dir", default=None, help="--fidelity 读这个目录下的 structured（默认 .codex-tmp/realbank）")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--max-calls", type=int, default=150)
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--model", default=os.environ.get("QWEN_VL_MODEL") or "qwen3-vl-plus")
    args = ap.parse_args()
    blocks: list[dict] = []
    if args.blocks_json:
        blocks = [{"set": b["set"], "key": b["key"]} for b in load_json(args.blocks_json, [])]
    for s in args.set or []:
        blocks += [{"set": b["set"], "key": b["key"], "body": b["body"]} for b in ctw_blocks_of(s)]
    if not blocks:
        ap.print_help()
        return 2
    return cmd_fidelity(args, blocks) if args.fidelity else cmd_transcribe(args, blocks)


if __name__ == "__main__":
    sys.exit(main())
