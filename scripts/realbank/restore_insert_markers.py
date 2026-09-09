#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""真题阅读「插入句题」的 ■ 标记找回 —— 重新 OCR 源截图，产出候选带标记正文。

背景：真考 AP 簇的最后一题多半是插入句题（"Look at the four squares [■] … Where would
the sentence best fit?"），插入位靠材料正文里的 4 个 ■ 定位。我们的材料是从考场截图逐字
OCR 出来的，RapidOCR / Qwen 转写都会把黑方块丢掉 —— build_bank.mjs 于是把这类题当
「无法作答的死题」丢弃（stats.droppedInsert）。实测 99 篇 AP 每篇应 5 题、入库平均 3.77 题，
缺的 60 次落在簇内第 5 题、29 次第 4 题，绝大部分就是这一刀。

题本身在 `.codex-tmp/realbank/<卷>.structured.json` 里是 status=ok 的（题干 + 选项 +
答案键都在），**只缺材料里的 ■**。Qwen3-VL 看图是看得见黑方块的，所以做法是：
拿源截图重新转写一次，让模型在原位置吐出 ■，校验通过后存进标记表，落库时查表换材料。

三步（都在本脚本里）：
  --list  扫 structured 产物，挑出「题干像插入题 + status=ok」的阅读 MCQ，回到
          data/realBank/reading/{ap,rdl}.json 按文本匹配到 bank item（拿 bank_id 与
          材料），写 .codex-tmp/realbank/insert-markers.todo.json。
  --fill  对 todo 每条，用 crop_materials 的定位办法（item 文本 ↔ 每张源截图 OCR 文本，
          token 覆盖率 ≥0.6）找到那张源截图，调 Qwen3-VL 用**专门的 prompt** 重新转写，
          初检恰好 4 个 ■ 才写进 insert-markers.candidates.json。
  --self-test  纯 fixture 自检（零网络、零依赖），__tests__/realbank-insert-markers.test.js 调。

合并进正式表是 insert_markers_apply.mjs 的事，本脚本**不写 data/**。

成本护栏（CLAUDE.md 约定）：--dry-run 先打印「将调用 N 次 / 预计 ¥X」；--max-calls 默认 120，
超了必须显式 --yes；命中 .codex-tmp/ocr 缓存的不再调用。

用法:
  python scripts/realbank/restore_insert_markers.py --list
  python scripts/realbank/restore_insert_markers.py --list --set 3.10新托福真题
  python scripts/realbank/restore_insert_markers.py --fill --dry-run
  python scripts/realbank/restore_insert_markers.py --fill
  python scripts/realbank/restore_insert_markers.py --self-test

退出码：0 正常；1 自检失败；2 用法/输入缺失；3 Qwen 系统性失败（鉴权/余额/网络）。
"""
from __future__ import annotations

import argparse
import glob
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_OUT_DIR = os.path.join(ROOT, ".codex-tmp", "realbank")
BANK_DIR = os.path.join(ROOT, "data", "realBank", "reading")
TODO_NAME = "insert-markers.todo.json"
CANDIDATES_NAME = "insert-markers.candidates.json"

EXIT_SYSTEMIC = 3

# 题干/选项里出现这些就当插入句题。与 build_bank.mjs 的 looksLikeInsertQuestion 是**两套**
# 判据：那边宽（连 "slot 1" / 已有 ■ 都算），这边只挑真正需要找回标记的四方块题型，
# 免得把「insert a comma」之类的语法题也拉来烧 Qwen。
INSERT_RE = re.compile(
    r"insert|four squares|where would the (following )?sentence best fit|four locations",
    re.I,
)

# item ↔ 源截图 的定位阈值，与 crop_materials.COVERAGE_MATCH 同一口径（那边已实测可用）。
COVERAGE_MATCH = 0.60
# todo 里 structured 材料 ↔ bank item 的匹配阈值。bank 的材料取的是簇里最长那份 OCR 变体，
# 与单条记录的材料不会逐字相同，所以给到 0.90，并且要求**唯一命中**。
BANK_MATCH_MIN = 0.90

CNY_PER_IMAGE = 0.01  # 与 ocr_images.CNY_PER_IMAGE 同一估价口径
CACHE_SETKEY = "insertmark"  # 缓存键 insertmark__<set>_M<module>_Q<q>__img1.txt

# 专门的转写 prompt：这一趟要的不是「好看的正文」，是**方块在哪**。
MARKER_PROMPT = """你是逐字转写器（OCR）。逐字转写图中左侧文章正文。

铁律：
- 文中每一个黑色方块标记（■ / ▪ / ◼）都必须在**原位置**输出字符 ■，一个都不能漏、不能多。
- 除此之外只转写你真实看到的正文字符，不解释、不翻译、不总结、不补写、不纠错。
- 保持原有的段落与行结构；段落之间空一行。
- 不要转写题干、选项（A/B/C/D）、界面按钮（Hide/Next/Back/Volume/Review）、计时器、页眉页脚、水印。
- 看不清的字符写成 ?，不要猜。
- 直接输出正文本身，不要任何前言、说明或 markdown 代码围栏。"""


# ── 归一化 / 覆盖率（与 scripts/realbank/insert_markers.js 逐字对齐）────────────
def normalize_for_match(text) -> str:
    """与 insert_markers.js 的 normalizeForMatch 同一口径。

    顺序要紧：先删 ■ 与 [A]~[D]，再小写、只留字母数字与空格、压缩空白。
    --self-test 会用 node 跑一遍 JS 版做跨语言比对，两边漂了立刻炸。
    """
    s = str(text if text is not None else "")
    s = re.sub(r"[■▪◼]", " ", s)
    s = re.sub(r"\[\s*[A-Da-d]\s*\]", " ", s)
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def tokens_for_match(text) -> list[str]:
    s = normalize_for_match(text)
    return s.split(" ") if s else []


def coverage(marked, material) -> float:
    """material 的 token（含重复）有多大比例能在 marked 的多重集合里领到一个。"""
    want = tokens_for_match(material)
    if not want:
        return 0.0
    pool: dict[str, int] = {}
    for t in tokens_for_match(marked):
        pool[t] = pool.get(t, 0) + 1
    hit = 0
    for t in want:
        if pool.get(t, 0) > 0:
            pool[t] -= 1
            hit += 1
    return hit / len(want)


def glued_coverage(item_text, ocr_text) -> float:
    """粘字容忍版覆盖率（只用于**定位**）。

    第一来源整份 OCR 是本地引擎跑的，空格常常丢光；按词切完再比会把对得上的页判成
    对不上。口径与 crop_materials.glued_coverage 一致：两边压成纯字母数字长串比子串。
    """
    want = set(t for t in tokens_for_match(item_text) if len(t) >= 3)
    if not want:
        return 0.0
    hay = re.sub(r"[^a-z0-9]+", "", str(ocr_text or "").lower())
    if not hay:
        return 0.0
    return sum(1 for w in want if w in hay) / len(want)


def count_squares(text) -> int:
    return len(re.findall(r"■", str(text or "")))


# ── structured 产物 ────────────────────────────────────────────────────────
def structured_files(out_dir: str) -> list[str]:
    """<卷>.structured.json（排除 .prev / .fs_parsed / .rw 这些中间产物）。"""
    out = []
    for p in sorted(glob.glob(os.path.join(out_dir, "*.structured*.json"))):
        base = os.path.basename(p)
        if not base.endswith(".structured.json"):
            continue
        if base.endswith((".structured.prev.json", ".structured.fs_parsed.json",
                          ".structured.rw.json")):
            continue
        out.append(p)
    return out


def set_name(path: str) -> str:
    return os.path.basename(path)[:-len(".structured.json")]


def looks_like_insert(item: dict) -> bool:
    probe = " ".join([str(item.get("stem") or "")]
                     + [str(o) for o in (item.get("options") or [])])
    return bool(INSERT_RE.search(probe))


def record_material(rec: dict, item: dict) -> str:
    """这道题问的是哪段材料。item 自己带的优先，其次记录级的 material / carryMaterial
    （材料屏与题在两屏时，structure_set.mjs 把上一屏正文挂在 carryMaterial 上）。"""
    for v in (item.get("material"), rec.get("material"), rec.get("carryMaterial")):
        if str(v or "").strip():
            return str(v).strip()
    return ""


def insert_records(structured: dict, setkey: str) -> list[dict]:
    """一份 structured 产物 → 插入句题清单（section=reading、status=ok、题干像插入题）。"""
    rows = []
    for rec in structured.get("results", []) or []:
        if rec.get("section") != "reading" or rec.get("status") != "ok":
            continue
        for item in rec.get("items") or []:
            if not isinstance(item, dict) or not looks_like_insert(item):
                continue
            rows.append({
                "set": setkey,
                "module": rec.get("module"),
                "q_number": item.get("q_number", rec.get("q_start")),
                "stem": re.sub(r"\s+", " ", str(item.get("stem") or "")).strip(),
                "material": record_material(rec, item),
            })
    return rows


# ── 题库匹配 ───────────────────────────────────────────────────────────────
def load_bank(kind: str, bank_dir: str) -> list[dict]:
    p = os.path.join(bank_dir, f"{kind}.json")
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as fh:
        return json.load(fh).get("items") or []


def bank_material(item: dict) -> str:
    return str(item.get("passage") or item.get("text") or "")


def match_bank(material: str, bank_items: list[dict]):
    """structured 材料 → bank item。归一化逐字相同优先；否则覆盖率 ≥ BANK_MATCH_MIN
    的**唯一**命中。匹配不上返回 None（--fill 仍能跑，只是 apply 阶段没法校验）。"""
    key = normalize_for_match(material)
    if not key:
        return None
    exact = [it for it in bank_items if normalize_for_match(bank_material(it)) == key]
    if exact:
        return exact[0]
    near = [it for it in bank_items if coverage(bank_material(it), material) >= BANK_MATCH_MIN]
    return near[0] if len(near) == 1 else None


def _clip(t, n=200):
    t = re.sub(r"\s+", " ", str(t or "")).strip()
    return t if len(t) <= n else t[:n - 1] + "…"


def build_todo(out_dir: str, bank_dir: str, only_sets=None) -> list[dict]:
    bank_items = load_bank("ap", bank_dir) + load_bank("rdl", bank_dir)
    todo = []
    for f in structured_files(out_dir):
        name = set_name(f)
        if only_sets and name not in only_sets:
            continue
        with open(f, encoding="utf-8") as fh:
            structured = json.load(fh)
        for row in insert_records(structured, name):
            hit = match_bank(row["material"], bank_items)
            todo.append({
                "set": row["set"],
                "module": row["module"],
                "q_number": row["q_number"],
                "stem": _clip(row["stem"], 300),
                "bank_id": (hit or {}).get("id"),
                "material_excerpt": _clip(row["material"], 400),
                # 全文不进 todo 的展示字段，但 --fill 定位要用，单独放一个键。
                "material": row["material"],
                "bank_has_squares": bool(hit and count_squares(bank_material(hit))),
            })
    return todo


# ── 主流程：--list ─────────────────────────────────────────────────────────
def cmd_list(args) -> int:
    if not os.path.isdir(args.out_dir):
        print(f"找不到 structured 产物目录：{args.out_dir}", file=sys.stderr)
        return 2
    only = set(args.set or []) or None
    todo = build_todo(args.out_dir, args.bank_dir, only)
    missing = [t for t in todo if not t["bank_has_squares"]]
    os.makedirs(args.out_dir, exist_ok=True)
    path = os.path.join(args.out_dir, TODO_NAME)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"entries": todo}, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"插入题 {len(todo)} 道，其中 bank 材料无 ■ 的 {len(missing)} 道")
    nobank = sum(1 for t in todo if not t["bank_id"])
    print(f"  对不上 bank item 的 {nobank} 道（apply 阶段没法校验，会被跳过）")
    print(f"→ {path}")
    return 0


# ── 主流程：--fill ─────────────────────────────────────────────────────────
def _load_sibling(name: str):
    """同目录脚本按路径加载（它们不是包）。cv2/fitz 这类重依赖只在这里才会被拖进来，
    所以 --self-test 不碰这个函数。"""
    spec = importlib.util.spec_from_file_location(f"rb_{name}", os.path.join(HERE, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def cache_key(entry: dict) -> str:
    return f"{entry.get('set')}_M{entry.get('module')}_Q{entry.get('q_number')}"


def _as_png(data: bytes) -> tuple[bytes, str]:
    """源截图字节 → (PNG 字节, "png")。

    build_units 的 img 有三种来源（PDF 内嵌图 / docx media / 转换产物），扩展名并不统一，
    而 Qwen 端点要按 mime 收图 —— 统一转一次 PNG，免得把 jpeg 当 png 发。
    没有 Pillow 就原样发（转写比讲究格式重要），扩展名退回 png。
    """
    try:
        from PIL import Image  # 延迟导入：--self-test 不该因为缺 Pillow 挂掉
        import io as _io
        im = Image.open(_io.BytesIO(data)).convert("RGB")
        buf = _io.BytesIO()
        im.save(buf, format="PNG")
        return buf.getvalue(), "png"
    except Exception:
        return data, "png"


def cmd_fill(args) -> int:
    todo_path = os.path.join(args.out_dir, TODO_NAME)
    if not os.path.exists(todo_path):
        print(f"没有 {todo_path}，先跑 --list", file=sys.stderr)
        return 2
    with open(todo_path, encoding="utf-8") as fh:
        entries = json.load(fh).get("entries") or []
    if args.set:
        entries = [e for e in entries if e.get("set") in set(args.set)]
    entries = [e for e in entries if not e.get("bank_has_squares")]
    if not entries:
        print("todo 里没有需要找回标记的条目。")
        return 0

    ocr_images = _load_sibling("ocr_images")
    need = [e for e in entries
            if args.force or ocr_images.read_cache(CACHE_SETKEY, cache_key(e), 1) is None]
    print(f"待处理 {len(entries)} 条，其中要调 Qwen 的 {len(need)} 次"
          f"（{len(entries) - len(need)} 条命中缓存），预计 ¥{len(need) * CNY_PER_IMAGE:.2f}"
          f"（按 ¥{CNY_PER_IMAGE}/张估）")
    if args.dry_run:
        for e in need:
            print(f"  · {cache_key(e)}  bank_id={e.get('bank_id')}")
        print("（--dry-run，未写任何文件、未发任何请求）")
        return 0
    if len(need) > args.max_calls and not args.yes:
        print(f"[停] 将调用 {len(need)} 次超过 --max-calls {args.max_calls}；确认要跑请加 --yes",
              file=sys.stderr)
        return 2

    crop = _load_sibling("crop_materials")  # 这一句才会 import cv2 / numpy / PIL
    ocr_images.load_env()

    candidates: list[dict] = []
    skipped: list[dict] = []
    calls = 0
    systemic = False
    units_cache: dict[tuple, list] = {}

    for i, e in enumerate(entries, start=1):
        key = cache_key(e)
        setname = str(e.get("set") or "")
        setkey = crop.set_key_of({"id": e.get("bank_id") or ""})
        # 同一套解析一次源文档就够；setkey 也进键 —— 同套里若有条目对不上 bank_id
        # （setkey 退化成空串），它走的是另一条源路径，不能与正常条目共用缓存。
        ck = (setname, setkey)
        if ck not in units_cache:
            units_cache[ck], _src = crop.build_units(setname, setkey)
        units = units_cache[ck]
        if not units:
            skipped.append({"key": key, "why": "no_source"})
            print(f"  [{i}/{len(entries)}] × {key}  no_source")
            continue
        body = str(e.get("material") or "")
        scored = sorted(((glued_coverage(body, u["text"]), u) for u in units),
                        key=lambda p: p[0], reverse=True)
        top_cov = scored[0][0]
        if top_cov < COVERAGE_MATCH:
            skipped.append({"key": key, "why": "no_page", "match_coverage": round(top_cov, 3)})
            print(f"  [{i}/{len(entries)}] × {key}  no_page cov={top_cov:.2f}")
            continue
        near = [u for c, u in scored if c >= top_cov - 0.02]
        unit = min(near, key=lambda u: u["page"])

        cached = None if args.force else ocr_images.read_cache(CACHE_SETKEY, key, 1)
        if cached is not None:
            text = cached
        elif systemic:
            skipped.append({"key": key, "why": "ocr_aborted"})
            continue
        else:
            png, _ext = _as_png(unit["img"])
            data, ext = ocr_images.shrink(png, "png")
            try:
                text = ocr_images.call_qwen(data, ext, args.model, prompt=MARKER_PROMPT)
            except ocr_images.SystemicFailure as ex:
                print(f"\n[中止] Qwen 系统性失败：{ex}", file=sys.stderr)
                systemic = True
                skipped.append({"key": key, "why": "ocr_systemic_failure"})
                continue
            except Exception as ex:  # noqa: BLE001 —— 单条失败不该拖垮整批
                skipped.append({"key": key, "why": f"ocr_error:{str(ex)[:120]}"})
                print(f"  [{i}/{len(entries)}] × {key}  ocr_error")
                continue
            calls += 1
            if text.strip():
                ocr_images.write_cache(CACHE_SETKEY, key, 1, text)

        squares = count_squares(text)
        if squares != 4:
            skipped.append({"key": key, "why": f"squares={squares}"})
            print(f"  [{i}/{len(entries)}] × {key}  ■×{squares}（要 4 个）  {unit['ref']}")
            continue
        candidates.append({
            "set": e.get("set"), "module": e.get("module"), "q_number": e.get("q_number"),
            "bank_id": e.get("bank_id"), "marked": text, "model": args.model,
            "source_page": unit["ref"],
        })
        print(f"  [{i}/{len(entries)}] ✓ {key}  ■×4  {unit['ref']}")

    out = os.path.join(args.out_dir, CANDIDATES_NAME)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"candidates": candidates, "skipped": skipped}, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"\n候选 {len(candidates)} 条 / 跳过 {len(skipped)} 条；实际调用 {calls} 次 "
          f"≈ ¥{calls * CNY_PER_IMAGE:.2f}")
    print(f"→ {out}")
    print("下一步：node scripts/realbank/insert_markers_apply.mjs --dry-run")
    return EXIT_SYSTEMIC if systemic else 0


# ── 自检 ───────────────────────────────────────────────────────────────────
JS_MODULE = os.path.join(HERE, "insert_markers.js")


def _js_normalize(sample: str):
    """用 node 跑一遍 JS 版 normalizeForMatch，做跨语言口径比对。

    没有 node（或跑不起来）返回 None —— 这一项跳过并打印说明，不算失败：
    自检必须在只有 python 的机器上也能跑完。
    """
    exe = shutil.which("node")
    if not exe:
        return None
    code = (
        "const m=require(process.argv[1]);"
        "let s='';process.stdin.on('data',d=>s+=d)"
        ".on('end',()=>process.stdout.write(m.normalizeForMatch(s)));"
    )
    try:
        p = subprocess.run([exe, "-e", code, JS_MODULE], input=sample.encode("utf-8"),
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    except Exception:
        return None
    if p.returncode != 0:
        return None
    return p.stdout.decode("utf-8", "replace")


def self_test() -> int:
    fails = []

    def check(name, cond, extra=""):
        if not cond:
            fails.append("%s -> %r" % (name, extra))

    # 1) todo 抽取：一条插入题 + 一条普通题，只该抽出插入题那条。
    structured = {"results": [
        {"section": "reading", "type": "ap", "module": 1, "status": "ok", "q_start": 21,
         "material": "Coral reefs grow slowly. ■ Warm water helps them. ■ Storms break them apart. "
                     "■ Recovery takes decades. ■ Scientists monitor the process closely.",
         "items": [{"q_number": 25, "stem": "Look at the four squares [■] that indicate where "
                                            "the following sentence could be added. Where would the "
                                            "sentence best fit?",
                    "options": ["A", "B", "C", "D"], "answer_index": 1}]},
        {"section": "reading", "type": "ap", "module": 1, "status": "ok", "q_start": 22,
         "items": [{"q_number": 22, "stem": "What is the purpose of paragraph 2?",
                    "options": ["a", "b", "c", "d"], "answer_index": 0}]},
        {"section": "reading", "type": "ap", "module": 1, "status": "flagged", "q_start": 30,
         "items": [{"q_number": 30, "stem": "Where would the following sentence best fit?",
                    "options": ["a", "b", "c", "d"], "answer_index": 0}]},
        {"section": "listening", "type": "lat", "module": 1, "status": "ok", "q_start": 5,
         "items": [{"q_number": 5, "stem": "Where would the sentence best fit?", "options": []}]},
    ]}
    rows = insert_records(structured, "卷A")
    check("只抽 reading + status=ok 的插入题", [r["q_number"] for r in rows] == [25], rows)
    check("材料从记录级 material 兜底取到", "Coral reefs" in rows[0]["material"], rows[0])

    d = tempfile.mkdtemp()
    try:
        with open(os.path.join(d, "卷A.structured.json"), "w", encoding="utf-8") as fh:
            json.dump(structured, fh, ensure_ascii=False)
        # 中间产物不该被扫进来
        for name in ("卷A.structured.prev.json", "卷A.structured.fs_parsed.json",
                     "卷B.structured.rw.json"):
            with open(os.path.join(d, name), "w", encoding="utf-8") as fh:
                json.dump(structured, fh, ensure_ascii=False)
        check("只认正式 structured 产物", [set_name(f) for f in structured_files(d)] == ["卷A"],
              structured_files(d))

        bank_dir = os.path.join(d, "bank")
        os.makedirs(bank_dir)
        passage_no_sq = re.sub(r"■\s*", "", structured["results"][0]["material"])
        with open(os.path.join(bank_dir, "ap.json"), "w", encoding="utf-8") as fh:
            json.dump({"items": [{"id": "real_ap_x_1_21", "passage": passage_no_sq}]}, fh,
                      ensure_ascii=False)
        todo = build_todo(d, bank_dir, None)
        check("todo 一条，且匹配到 bank_id",
              len(todo) == 1 and todo[0]["bank_id"] == "real_ap_x_1_21", todo)
        check("bank 材料没有 ■ → 需要找回", todo[0]["bank_has_squares"] is False, todo[0])
    finally:
        shutil.rmtree(d, ignore_errors=True)

    # 2) 候选初检：恰好 4 个 ■ 过，3 个不过。
    four = "a ■ b ■ c ■ d ■ e"
    three = "a ■ b ■ c ■ d"
    check("4 个 ■ 过初检", count_squares(four) == 4, four)
    check("3 个 ■ 不过初检", count_squares(three) != 4, three)

    # 3) 归一化口径：python 版与 JS 版必须逐字一致。
    sample = "Coral  reefs [A] grow ■ slowly.\n\nWarm-water HELPS them (2026)!  [ b ] end"
    py = normalize_for_match(sample)
    check("normalize 去掉 ■ / [A] / 标点并压空白",
          py == "coral reefs grow slowly warm water helps them 2026 end", py)
    js = _js_normalize(sample)
    if js is None:
        print("（跳过跨语言比对：没有可用的 node，或 insert_markers.js 跑不起来）")
    else:
        check("python 与 JS 的 normalizeForMatch 一致", js == py, (py, js))

    # 覆盖率是多重集合口径：重复虚词不该把残文刷及格。
    check("同文覆盖率 1.0", abs(coverage("a b c d", "a b c d") - 1.0) < 1e-9)
    check("多重集合口径", abs(coverage("the cat", "the the cat") - 2 / 3) < 1e-9,
          coverage("the cat", "the the cat"))

    if fails:
        print("SELF-TEST FAILED:")
        for f in fails:
            print(" -", f)
        return 1
    print("SELF-TEST OK")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="真题阅读插入句题的 ■ 标记找回")
    ap.add_argument("--list", action="store_true", help="扫 structured 产物，产出 todo 清单")
    ap.add_argument("--fill", action="store_true", help="按 todo 重新 OCR 源截图，产出候选")
    ap.add_argument("--self-test", action="store_true", help="纯 fixture 自检（零网络、零依赖）")
    ap.add_argument("--set", action="append", default=None, help="只处理这些卷（可重复）")
    ap.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    ap.add_argument("--bank-dir", default=BANK_DIR)
    ap.add_argument("--dry-run", action="store_true", help="只打印将调用几次，不发请求、不写文件")
    ap.add_argument("--force", action="store_true", help="忽略 OCR 缓存重跑")
    ap.add_argument("--max-calls", type=int, default=120, help="安全阀：超过就停（除非 --yes）")
    ap.add_argument("--yes", action="store_true", help="确认超过 --max-calls 也要跑")
    ap.add_argument("--model", default=os.environ.get("QWEN_VL_MODEL") or "qwen3-vl-plus")
    args = ap.parse_args()

    if args.self_test:
        return self_test()
    if args.list:
        return cmd_list(args)
    if args.fill:
        return cmd_fill(args)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
