# -*- coding: utf-8 -*-
"""
第一来源（截图卷）造句题 —— 从「写作.pdf」的考试界面截图里拆出可练的题。

第一来源每套的写作 PDF 没有文字层，整份是考试界面截图：每页 2 题，一题包含
「Make an appropriate sentence.」标题、上方人物说的题干句、下方一行带下划线空位的
答题模板（模板里可能夹着已给定的词），再下方是打乱的词块。structured.json 的
writing/build 段只有 `{n, sentence}`（答案句，来自答案页），拼不出可练的题 ——
所以 build_bank 一直把这 380 多条判为 thin 丢掉。

本脚本补上缺的那一半：**识图拿题面（模板 + 词块），答案句仍来自答案页**，
再用一道**零 token 的机械校验**把两边对上：

    answer 分词后去掉模板给定词，剩下的词序列必须能被 chunks 里的若干块
    「按顺序、不重叠、恰好」拼出；未用到的块 ≤ 1 个（即 distractor）。

拼不回来 = 识图漏块/多块，或答案句与题面对不上 —— 一律拒收。**绝不让模型猜答案。**

三条规矩（与 ocr_images.py 同一套）：
  · **磁盘缓存**：图缓存 `.codex-tmp/realbank/bs-pages/<卷名>/p<N>.png`，
    识图缓存 `.codex-tmp/realbank/bs-ocr/<卷名>/p<N>.<图hash8>.json`。
    缓存键含图片 hash，重跑零调用、结果可复现。
  · **先报数**：`--dry-run` 打印将调用几张与预计费用（¥0.01/张，与 ocr_images 同口径）。
  · **只产中间件**：产物是 `.codex-tmp/realbank/<卷名>.bs.json`，
    由 build_bank.mjs 读进去落库 —— 本脚本不碰 data/。

用法:
  D:/python/python scripts/realbank/extract_bs_pages.py --dry-run
  D:/python/python scripts/realbank/extract_bs_pages.py --only 3.16
  D:/python/python scripts/realbank/extract_bs_pages.py            # 全部
  D:/python/python scripts/realbank/extract_bs_pages.py --no-ocr   # 只用缓存重跑校验

退出码：0 正常；2 用法/输入缺失；3 API 系统性失败。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ocr_images import (  # noqa: E402  复用同一个 Qwen3-VL 客户端 / 估价口径 / 缩图
    CNY_PER_IMAGE,
    EXIT_SYSTEMIC,
    SystemicFailure,
    call_qwen,
    load_env,
    shrink,
    strip_fence,
)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# 源根目录：REALBANK_SRC（云端 Worker 只设这一个）/ --src 覆盖，默认仍是桌面路径。
SRC_ROOT = os.environ.get("REALBANK_SRC") or r"D:\桌面\【2026改后全科真题】（持续更新中）"
OUT_DIR = os.path.join(REPO_ROOT, ".codex-tmp", "realbank")
PAGE_DIR = os.path.join(OUT_DIR, "bs-pages")
OCR_DIR = os.path.join(OUT_DIR, "bs-ocr")
FLAGS_FILE = os.path.join(REPO_ROOT, "data", "realBank", "source-flags.json")
TARGETS_FILE = os.path.join(REPO_ROOT, "data", "realExam2026", "writing", "buildSentence-targets.json")
DPI = 120

EXTRACT_PROMPT = """You are reading a screenshot of a TOEFL "Build a Sentence" writing task interface.
A page usually contains 1 or 2 questions. Each question has:
  - a header line like "Writing | Question 3 of 10"
  - the title "Make an appropriate sentence."
  - an upper speech line: a sentence spoken by the first person (the prompt)
  - a lower answer template: a line of underlined blanks, sometimes with GIVEN words
    printed between the blanks (e.g. "Can ___ ___ ?", "___ is ___ ." , "Have ___ ___ ?")
  - below it, a row of shuffled word chunks separated by wide horizontal gaps.
    A chunk may contain several words (e.g. "what type", "your scholarship application",
    "was successful as well"). Chunks are separated by LARGE gaps; words inside one chunk
    are separated by a single normal space.

Output STRICTLY a JSON array (no prose, no markdown fence). One object per question:
{"q": <the N in "Question N of 10">, "prompt": "<the upper speech sentence, verbatim>",
 "template": "<the answer template; write each blank as _____ ; keep given words exactly as printed; keep the final punctuation>",
 "chunks": ["<chunk>", "..."]}

Rules:
- Transcribe verbatim. Do NOT translate, do NOT fix spelling, do NOT invent or complete anything.
- Do NOT merge two adjacent chunks into one; do NOT split a multi-word chunk apart.
- List chunks in the left-to-right order they appear on screen (they are shuffled - that is fine).
- The template must have exactly one _____ per blank slot. Given words stay in place.
- Ignore the page watermark (Chinese text at the top), the timer, "Hide Time", and avatars.
- If a page contains no such question, output [].
"""


# ── 词口径（与 lib/realBank.js 的 bsNormWord / stripEdgePunct 同口径）────────
def norm_word(s: str) -> str:
    s = str(s or "").replace("\u2019", "'")
    return re.sub(r"[.,!?;:]", "", s).strip().lower()


def strip_edge_punct(w: str) -> str:
    w = str(w or "").replace("\u2019", "'")
    w = re.sub(r"^[^\w']+", "", w)
    w = re.sub(r"[^\w']+$", "", w)
    return w


def norm_words(text: str) -> list[str]:
    return [w for w in (norm_word(x) for x in str(text or "").split()) if w]


def norm_answer_key(text: str) -> str:
    """跨卷去重用的答案归一化键。"""
    return " ".join(norm_words(text))


# ── 模板解析 ───────────────────────────────────────────────────────────────
BLANK_RE = re.compile(r"_{2,}")


def parse_template(template: str):
    """模板 → (tokens, 尾部标点)。token = ('lit', [原词...]) | ('blank',)。"""
    t = str(template or "").strip().replace("\u2019", "'")
    tail = ""
    m = re.search(r"([?.!])\s*$", t)
    if m:
        tail = m.group(1)
        t = t[: m.start()]
    segments = BLANK_RE.split(t)
    tokens = []
    for i, seg in enumerate(segments):
        raw = [x for x in seg.split() if strip_edge_punct(x)]
        words = [strip_edge_punct(x) for x in raw]
        # 固定词存两份：`words` 剥了标点，用来和答案句对齐（与 lib/realBank.js 的
        # stripEdgePunct 同口径）；`raw` 是屏幕上的原样（"No,"、"Yes."），回填句子时用它 ——
        # 剥了标点再拼回去会得到 "No but what are you planning to do?" 这种缺逗号的句子。
        if words:
            tokens.append(("lit", words, raw))
        if i < len(segments) - 1:
            tokens.append(("blank",))
    return tokens, tail


def collapse(tokens):
    """('lit',words) / ('blank',) 序列 → ('lit',words) / ('gap',) 交替序列。

    **空位的个数不可信**：模板是截图里一行细下划线，实测 Qwen 经常把 4 个空看成 3 个
    （3.16 十题里有 5 题栽在这上面）。所以只保留「这里有没有空档」，几个空由答案句 +
    词块自己解出来 —— 识图只负责认字（给定词），不负责数下划线。
    """
    out = []
    for tok in tokens:
        if tok[0] == "lit":
            if out and out[-1][0] == "lit":
                out[-1] = ("lit", out[-1][1] + tok[1], out[-1][2] + tok[2])
            else:
                out.append(("lit", list(tok[1]), list(tok[2])))
        else:
            if not out or out[-1][0] != "gap":
                out.append(("gap",))
    return out


def derive_prefilled(answer: str, blanks: str):
    """lib/realBank.js deriveBsPrefilled 的等价实现 —— 落库前先在本地过一遍这道闸，
    免得进了库再被前端 groupBsBatches 静默丢掉（库里躺着渲染不了的题最难查）。"""
    tokens, _tail = parse_template(blanks)
    aw = norm_words(answer)
    prefilled, positions = [], {}
    lower, pending = 0, 0
    for tok in tokens:
        if tok[0] == "blank":
            pending += 1
            continue
        target = [norm_word(w) for w in tok[1]]
        found = -1
        i = lower + pending
        while i + len(target) <= len(aw):
            if aw[i:i + len(target)] == target:
                found = i
                break
            i += 1
        key = " ".join(tok[1])
        if found < 0:
            raise ValueError(f"固定词「{key}」无法对齐到 answer")
        if key in positions:
            raise ValueError(f"固定词「{key}」在模板中重复出现")
        prefilled.append(key)
        positions[key] = found
        lower = found + len(target)
        pending = 0
    return prefilled, positions


# ── 核心校验：answer 能不能被「模板固定词 + 若干词块」按顺序恰好拼出 ────────
def _eqw(a: str, b: str, fuzzy: bool) -> bool:
    """词相等。fuzzy=True 时容 1 个字符的编辑距离（仅长度≥4 的词）。

    答案页本身也是 OCR 出来的，实测有 "broshure"←"brochure" 这类单字符错。整句其余
    部分逐词对齐的前提下，一个字符的差错误配的概率可以忽略；拼出来的句子取**截图侧**
    的拼写（截图是题面本体，答案页是二手转写）。每题最多容一个这样的词，且要单独记账。
    """
    if a == b:
        return True
    if not fuzzy or min(len(a), len(b)) < 4 or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(1 for x, y in zip(a, b) if x != y) == 1
    s, l = (a, b) if len(a) < len(b) else (b, a)
    for i in range(len(l)):
        if l[:i] + l[i + 1:] == s:
            return True
    return False


def solve(tokens, chunks: list[str], answer_words: list[str], fuzzy: bool = False,
          limit: int = 200):
    """返回若干个解；一个解 = 每个 gap 用掉的 chunk 下标列表（按 gap 顺序）。

    DFS 全枚举（题面最多 8 个空位、9 个词块，搜索空间小）。枚举而不是贪心是刻意的：
    只有看见「有几个解」才能判断这题是不是有歧义 —— 有歧义就拒收。
    """
    chunk_words = [norm_words(c) for c in chunks]
    solutions = []

    def match(ai: int, ws: list[str]) -> bool:
        if ai + len(ws) > len(answer_words):
            return False
        return all(_eqw(answer_words[ai + j], ws[j], fuzzy) for j in range(len(ws)))

    def dfs(ti: int, ai: int, used: tuple, plan: tuple):
        if len(solutions) >= limit:
            return
        if ti == len(tokens):
            if ai == len(answer_words):
                solutions.append(plan)
            return
        tok = tokens[ti]
        if tok[0] == "lit":
            target = [norm_word(w) for w in tok[1]]
            if match(ai, target):
                dfs(ti + 1, ai + len(target), used, plan)
            return
        # gap：吃掉 1..N 个还没用过的词块（顺序即拼句顺序）
        def eat(ai2: int, used2: tuple, taken: tuple):
            if taken:
                dfs(ti + 1, ai2, used2, plan + (taken,))
            if len(solutions) >= limit:
                return
            for ci, cw in enumerate(chunk_words):
                if ci in used2 or not cw:
                    continue
                if match(ai2, cw):
                    eat(ai2 + len(cw), used2 + (ci,), taken + (ci,))

        eat(ai, used, ())

    dfs(0, 0, (), ())
    return solutions


def build_item(rec: dict, answer_sentence: str):
    """识图结果 + 答案句 → bank 条目（或抛出拒收原因）。"""
    prompt = str(rec.get("prompt") or "").strip()
    template = str(rec.get("template") or "").strip()
    chunks = [str(c or "").strip() for c in (rec.get("chunks") or [])]
    chunks = [c for c in chunks if c]
    if not prompt:
        raise ValueError("missing_prompt")
    if not template or "_" not in template:
        raise ValueError("missing_template")
    if len(chunks) < 2:
        raise ValueError("missing_chunks")
    if len({norm_answer_key(c) for c in chunks}) != len(chunks):
        raise ValueError("duplicate_chunks")

    raw_tokens, tail = parse_template(template)
    if not any(t[0] == "blank" for t in raw_tokens):
        raise ValueError("template_no_blank")
    tokens = collapse(raw_tokens)

    aw = norm_words(answer_sentence)
    if not aw:
        raise ValueError("empty_answer")
    sols = solve(tokens, chunks, aw)
    fuzzy_used = False
    if not sols:
        sols = solve(tokens, chunks, aw, fuzzy=True)
        fuzzy_used = bool(sols)
        if not sols:
            raise ValueError("no_solution")
    if len({tuple(sorted(i for g in s for i in g)) for s in sols}) > 1:
        raise ValueError("ambiguous_solution")
    plan = sols[0]
    used = [i for g in plan for i in g]
    if len(used) != len(set(used)):
        raise ValueError("no_solution")
    spare = [c for i, c in enumerate(chunks) if i not in set(used)]
    if len(spare) > 1:
        raise ValueError(f"too_many_spare_chunks({len(spare)})")

    # 答案句就地回填：模板固定词与词块都带原始大小写，比答案页可信
    # （答案页是 OCR 出来的全小写无标点，还带 "broshure" 这类错字）。
    parts, gi = [], 0
    lay = []  # 与 parts 对齐的模板骨架：固定词原样，词块位置写空
    for tok in tokens:
        if tok[0] == "lit":
            parts.extend(tok[2])
            lay.extend(tok[2])
        else:
            for ci in plan[gi]:
                parts.append(chunks[ci])
                lay.append("_____")
            gi += 1
    answer = " ".join(parts).strip()
    if answer:
        answer = answer[0].upper() + answer[1:]
    answer += tail or "."
    # 首块被大写了，chunks 里那一块也要跟着大写，否则前端拼出来的句子与 answer 对不上大小写。
    out_chunks = list(chunks)
    if tokens and tokens[0][0] == "gap" and plan and plan[0]:
        c0 = out_chunks[plan[0][0]]
        out_chunks[plan[0][0]] = c0[0].upper() + c0[1:]
    blanks = " ".join(lay)
    blanks = (blanks[0].upper() + blanks[1:] if blanks else blanks) + (tail or ".")

    # 落库前先跑一遍前端那道对齐闸（对不齐的题进了库也会被 groupBsBatches 静默丢掉）。
    derive_prefilled(answer, blanks)
    if len(norm_words(answer)) != len(aw):
        raise ValueError("rebuilt_answer_mismatch")

    return {
        "prompt": prompt,
        "blanks": blanks,
        "chunks": out_chunks,
        "answer": answer,
        "distractors": spare,
    }, fuzzy_used


# ── 源料枚举 ───────────────────────────────────────────────────────────────
def writing_pdf(folder: str) -> str | None:
    try:
        names = os.listdir(folder)
    except OSError:
        return None
    hits = [n for n in sorted(names)
            if "写作" in n and n.lower().endswith(".pdf") and not n.startswith("~$")]
    return os.path.join(folder, hits[0]) if hits else None


def sets_with_writing(only: str | None) -> list[tuple[str, str]]:
    """[(卷名, 写作pdf路径)]，只留有 structured.json 的卷（没跑过 ingest 的卷落不了库）。"""
    out = []
    for name in sorted(os.listdir(SRC_ROOT)):
        folder = os.path.join(SRC_ROOT, name)
        if not os.path.isdir(folder):
            continue
        if only and only not in name:
            continue
        if not os.path.exists(os.path.join(OUT_DIR, f"{name}.structured.json")):
            continue
        pdf = writing_pdf(folder)
        if pdf:
            out.append((name, pdf))
    return out


def render_pages(setname: str, pdf: str) -> list[str]:
    """写作 PDF → 逐页 PNG（缓存命中不重渲染）。返回页图路径列表。"""
    import fitz

    d = os.path.join(PAGE_DIR, re.sub(r"[^\w.-]+", "_", setname))
    os.makedirs(d, exist_ok=True)
    paths = []
    with fitz.open(pdf) as doc:
        for i, page in enumerate(doc, start=1):
            p = os.path.join(d, f"p{i}.png")
            if not os.path.exists(p):
                page.get_pixmap(dpi=DPI).save(p)
            paths.append(p)
    return paths


def ocr_cache_path(setname: str, idx: int, img_hash: str) -> str:
    d = os.path.join(OCR_DIR, re.sub(r"[^\w.-]+", "_", setname))
    return os.path.join(d, f"p{idx}.{img_hash}.json")


def page_records(setname: str, idx: int, img_path: str, model: str, no_ocr: bool):
    """一页 → 识图出的题记录列表（缓存优先；no_ocr 时缓存未命中就返回 None）。"""
    data = open(img_path, "rb").read()
    h = hashlib.sha1(data).hexdigest()[:8]
    cp = ocr_cache_path(setname, idx, h)
    if os.path.exists(cp):
        try:
            return json.load(open(cp, "r", encoding="utf-8")), True
        except Exception:
            pass
    if no_ocr:
        return None, False
    body, ext = shrink(data, "png")
    text = call_qwen(body, ext, model, prompt=EXTRACT_PROMPT)
    recs = parse_json_array(text)
    os.makedirs(os.path.dirname(cp), exist_ok=True)
    json.dump(recs, open(cp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return recs, False


def parse_json_array(text: str) -> list:
    s = strip_fence(text)
    try:
        v = json.loads(s)
    except Exception:
        m = re.search(r"\[.*\]", s, re.S)
        if not m:
            return []
        try:
            v = json.loads(m.group(0))
        except Exception:
            return []
    return v if isinstance(v, list) else []


# ── 答案句 ─────────────────────────────────────────────────────────────────
def set_date(setname: str) -> str:
    m = re.match(r"^(\d{1,2})[.．](\d{1,2})", setname)
    return f"2026-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else "2026"


def set_slug(setname: str) -> str:
    """与 build_bank.mjs setSlug 同规则。"""
    if re.match(r"^r[fp]\d{4}$", setname):
        return setname
    m = re.match(r"^(\d{1,2})[.．](\d{1,2})", setname)
    base = f"{m.group(1)}{m.group(2)}" if m else "x"
    v = re.search(r"([ABC])卷", setname)
    rev = re.search(r"_v(\d+)$", setname)
    return base + (v.group(1).lower() if v else "") + (f"v{rev.group(1)}" if rev else "")


def answers_for(setname: str) -> dict[int, str]:
    """答案页给的 {题号: 答案句}。structured 优先，缺的用 realExam2026 targets 补。"""
    out: dict[int, str] = {}
    p = os.path.join(OUT_DIR, f"{setname}.structured.json")
    try:
        st = json.load(open(p, "r", encoding="utf-8"))
    except Exception:
        st = {}
    for r in st.get("results") or []:
        if r.get("section") != "writing" or r.get("type") != "build" or r.get("status") != "ok":
            continue
        for it in r.get("items") or []:
            n, s = it.get("n"), it.get("sentence")
            if isinstance(n, int) and s and n not in out:
                out[n] = str(s)
    date = set_date(setname)
    suffix = ""
    v = re.search(r"([ABC])卷", setname)
    if v:
        suffix = f"-{v.group(1)}"
    try:
        for t in json.load(open(TARGETS_FILE, "r", encoding="utf-8")):
            m = re.match(r"^(\d{4}-\d{2}-\d{2})_bs(\d+)(-[ABC])?$", str(t.get("id") or ""))
            if not m or m.group(1) != date or (m.group(3) or "") != suffix:
                continue
            n = int(m.group(2))
            if n not in out and t.get("target"):
                out[n] = str(t["target"])
    except Exception:
        pass
    return out


def flags_for(setname: str) -> list[dict]:
    try:
        sets = json.load(open(FLAGS_FILE, "r", encoding="utf-8")).get("sets") or {}
    except Exception:
        return []
    return [{"code": f.get("code"), "severity": f.get("severity"), "detail": f.get("detail")}
            for f in sets.get(setname) or []
            if any(x in ("*", "writing") for x in (f.get("sections") or []))]


def source_hash(setname: str) -> str | None:
    try:
        j = json.load(open(os.path.join(OUT_DIR, f"{setname}.json"), "r", encoding="utf-8"))
    except Exception:
        return None
    for f in j.get("files") or []:
        if f.get("role") != "questions" or not f.get("hash"):
            continue
        a = f.get("anchors")
        if (a.get("writing", 0) > 0) if a else (f.get("section") == "writing"):
            return f["hash"]
    return None


# ── 主流程 ─────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="第一来源截图卷 —— 造句题识图抽取")
    ap.add_argument("--dry-run", action="store_true", help="只报将调用张数与预计费用")
    ap.add_argument("--only", help="只处理卷名含该子串的卷")
    ap.add_argument("--no-ocr", action="store_true", help="只用已有缓存跑校验，零调用")
    ap.add_argument("--model", default=os.environ.get("QWEN_VL_MODEL") or "qwen3-vl-plus")
    ap.add_argument("--max-images", type=int, default=400)
    ap.add_argument("--src", default=None,
                    help="覆盖源根目录（默认桌面路径，也可用 REALBANK_SRC 环境变量）")
    args = ap.parse_args()

    global SRC_ROOT
    if args.src:
        SRC_ROOT = args.src

    load_env()
    if not os.path.isdir(SRC_ROOT):
        print(f"找不到源料根目录：{SRC_ROOT}", file=sys.stderr)
        return 2
    sets = sets_with_writing(args.only)
    if not sets:
        print("没有匹配到任何卷", file=sys.stderr)
        return 2

    # ① 渲染（本地零成本）
    rendered: list[tuple[str, list[str]]] = []
    for setname, pdf in sets:
        rendered.append((setname, render_pages(setname, pdf)))
    total_pages = sum(len(p) for _, p in rendered)

    # ② 报数
    todo = 0
    for setname, pages in rendered:
        for i, p in enumerate(pages, start=1):
            h = hashlib.sha1(open(p, "rb").read()).hexdigest()[:8]
            if not os.path.exists(ocr_cache_path(setname, i, h)):
                todo += 1
    print(f"■ {len(sets)} 套，共渲染 {total_pages} 页；待识图 {todo} 张，"
          f"预计费用 ¥{todo * CNY_PER_IMAGE:.2f}（¥{CNY_PER_IMAGE}/张估）")
    if args.dry_run:
        print("（--dry-run，未发任何请求）")
        return 0
    if todo > args.max_images:
        print(f"[停] 待识图 {todo} 张超过 --max-images {args.max_images}", file=sys.stderr)
        return 2

    # ③ 识图 + ④ 配答案校验
    report = []
    calls = 0
    for setname, pages in rendered:
        answers = answers_for(setname)
        meta_flags = flags_for(setname)
        date = set_date(setname)
        slug = set_slug(setname)
        shash = source_hash(setname)
        seen_q: dict[int, dict] = {}
        rejects: dict[str, int] = {}
        n_seen = 0
        for i, p in enumerate(pages, start=1):
            try:
                recs, cached = page_records(setname, i, p, args.model, args.no_ocr)
            except SystemicFailure as e:
                print(f"\n[中止] 系统性 API 失败：{e}", file=sys.stderr)
                return EXIT_SYSTEMIC
            except Exception as e:
                rejects["ocr_failed"] = rejects.get("ocr_failed", 0) + 1
                print(f"  {setname} p{i} 识图失败：{str(e)[:140]}")
                continue
            if recs is None:
                continue
            if not cached:
                calls += 1
            for rec in recs:
                if not isinstance(rec, dict):
                    continue
                n_seen += 1
                try:
                    q = int(rec.get("q"))
                except Exception:
                    rejects["bad_q"] = rejects.get("bad_q", 0) + 1
                    continue
                if q in seen_q:
                    rejects["duplicate_q"] = rejects.get("duplicate_q", 0) + 1
                    continue
                if q not in answers:
                    rejects["no_answer_sentence"] = rejects.get("no_answer_sentence", 0) + 1
                    continue
                try:
                    core, fz = build_item(rec, answers[q])
                    if fz:
                        rejects["_fuzzy_word_ok"] = rejects.get("_fuzzy_word_ok", 0) + 1
                except ValueError as e:
                    k = str(e)
                    rejects[k] = rejects.get(k, 0) + 1
                    continue
                seen_q[q] = {
                    "id": f"bs_{slug}_{q:02d}",
                    **core,
                    "source_label": f"{date} 真题造句",
                    "real": True,
                    "tier": "recalled",
                    "source": setname,
                    "date": date,
                    "source_hash": shash,
                    "source_flags": meta_flags,
                    "_page": os.path.relpath(p, REPO_ROOT).replace("\\", "/"),
                    "_q": q,
                }
        items = [seen_q[k] for k in sorted(seen_q)]
        out_p = os.path.join(OUT_DIR, f"{setname}.bs.json")
        if items:
            json.dump({"set": setname, "count": len(items), "items": items},
                      open(out_p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        elif os.path.exists(out_p):
            os.remove(out_p)
        report.append({"set": setname, "pages": len(pages), "seen": n_seen,
                       "answers": len(answers), "ok": len(items), "rejects": rejects})
        print(f"  · {setname}: {len(pages)} 页 / 识图 {n_seen} 题 / 答案 {len(answers)} 条 "
              f"→ 通过 {len(items)}" + (f"  拒收 {rejects}" if rejects else ""))

    json.dump(report, open(os.path.join(OUT_DIR, "_bs_pages_report.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    tot_ok = sum(r["ok"] for r in report)
    agg: dict[str, int] = {}
    for r in report:
        for k, v in r["rejects"].items():
            agg[k] = agg.get(k, 0) + v
    print(f"\n完成：{len(report)} 套，通过 {tot_ok} 题，本次实际调用 {calls} 张 "
          f"（约 ¥{calls * CNY_PER_IMAGE:.2f}）")
    print(f"拒收原因分布：{json.dumps(agg, ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
