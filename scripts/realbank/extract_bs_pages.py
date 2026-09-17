# -*- coding: utf-8 -*-
"""
第一来源（截图卷）造句题 —— 从「写作.pdf」的考试界面截图里拆出可练的题。

1~2 月的合订卷没有单独的「写作.pdf」（一个 PDF 装整套四科）：按 ingest 阶段的 OCR 缓存找出造句那几页只送那几页，
见 combined_writing_pages（2026-09-14 前这 14 套被整套跳过）。

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
import functools
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
# 第二份 GT：条数少些，但有 targets 没有的 8 条（2.8 五条 / 4.20 三条）
GT_ITEMS_FILE = os.path.join(REPO_ROOT, "data", "realExam2026", "writing", "buildSentence.json")
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
# 答案页/截图里混着全角标点（实测 "interesting ？"），不归一就会当成一个多出来的词，整题拼不出
FULLWIDTH = str.maketrans("？！，。：；（）", "?!,.:;()")


def norm_word(s: str) -> str:
    s = str(s or "").replace("\u2019", "'").translate(FULLWIDTH)
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

    def match(ai: int, ws: list[str]):
        """对上了返回**吃掉几个答案词**，对不上返回 None。

        先逐词比；不行再按「去掉空格后的字母序列」整体比 —— 答案页是 OCR 出来的，空格位置经常
        放错（实测 "tha thas" ← "that has"），字母序列却一模一样。这是**严格相等**、不是模糊匹配：
        字母不同照样对不上，所以不会放宽错字那道闸。
        """
        if ai + len(ws) <= len(answer_words) and all(
                _eqw(answer_words[ai + j], ws[j], fuzzy) for j in range(len(ws))):
            return len(ws)
        target = "".join(ws)
        if not target:
            return None
        acc = ""
        for k in range(ai, len(answer_words)):
            acc += answer_words[k]
            if len(acc) > len(target):
                return None
            if acc == target:
                return k - ai + 1
        return None

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
            n = match(ai, target)
            if n is not None:
                dfs(ti + 1, ai + n, used, plan)
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
                n = match(ai2, cw)
                if n is not None:
                    eat(ai2 + n, used2 + (ci,), taken + (ci,))

        eat(ai, used, ())

    dfs(0, 0, (), ())
    return solutions


def build_with_gt_retry(rec: dict, primary: str, alt: str | None, rejects: dict,
                        gt_all: dict[int, str] | None = None):
    """答案句三级回退：答案页那条 → 同题号的 GT → 同卷全部 GT 里唯一能拼出的那条。

    为什么值得重试：答案页是 OCR 出来的（全小写、无标点，实测还带 "broshure" 这类错字），
    而 GT 是按卷逐题人工转写的校准锚 —— 同一道题，答案页的那条拼不出解，GT 那条常常能拼出。

    为什么敢扫同卷全部（第三级）：两个来源的**题号**会错位（实测 3.6 两边同一个题号说的不是
    同一道题），这时同题号的 GT 也拼不出，可正确的那条往往就躺在同一卷的别的题号上。
    机械闸足够严 —— 答案句必须由模板固定词 + 词块**按序恰好**拼出、多余块 ≤1 —— 所以
    「同卷里恰好只有一条能拼出」这件事本身就是强证据。**拼出多条就作废**（ambiguous_gt_scan）：
    宁可少收，不许猜。题号仍以截图那一屏为准（题面为准），GT 只当拼接顺序的裁判。

    只在 no_solution 时重试：其余拒收码（缺模板 / 词块重复 / 多余块太多）是题面那一侧的毛病，
    换答案句解决不了，重试只是白跑。
    """
    try:
        core, fz = build_item(rec, primary)
        return core, fz, None
    except ValueError as e:
        first = str(e)
    if first != "no_solution":
        return None, False, first

    tried = {norm_answer_key(primary or "")}
    if alt and norm_answer_key(alt) not in tried:
        tried.add(norm_answer_key(alt))
        try:
            core, fz = build_item(rec, alt)
            rejects["_gt_answer_ok"] = rejects.get("_gt_answer_ok", 0) + 1
            return core, fz, None
        except ValueError:
            pass

    hits = []
    for cand in (gt_all or {}).values():
        k = norm_answer_key(cand or "")
        if not k or k in tried:
            continue
        tried.add(k)
        try:
            hits.append(build_item(rec, cand))
        except ValueError:
            continue
    if len(hits) > 1:
        return None, False, "ambiguous_gt_scan"
    if hits:
        rejects["_gt_scan_ok"] = rejects.get("_gt_scan_ok", 0) + 1
        core, fz = hits[0]
        return core, fz, None
    return None, False, first


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
    # 词块允许重复：真题里同一个词块真的会摆两块（"…find my charger" 那屏有两块 my）。
    # runtime 侧已按多重集判定（lib/questionBank/runtimeModel.js），这里不再一刀切拒收。

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
    # 歧义按**拼出来的词块文本**判，不按下标：两块文本相同时，用哪一块都拼出同一个句子，
    # 那不是歧义（按下标算会把每道含重复块的题都误判成 ambiguous_solution）。
    if len({tuple(tuple(chunks[i] for i in g) for g in s) for s in sols}) > 1:
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


OCR_TEXT_DIR = os.path.join(REPO_ROOT, ".codex-tmp", "ocr")
_BS_MARK = re.compile(r"makeanappropriatesentence")
_WRITING_TAIL_MARK = re.compile(r"writeanemail|professoristeaching|writeapost")


def combined_writing_pages(setname: str, folder: str) -> tuple[str, list[int]] | None:
    """合订卷（一个 PDF 装整套四科、没有单独「写作.pdf」）→ (PDF 路径, 造句页码列表)。

    2026-09-14 以前本脚本只认单独的「写作.pdf」，1~2 月 13 套合订卷 + 3.14 被整套跳过 ——
    这些卷的造句题一道都没进库，丢题账本里记成「造句只有答案句」131 题。
    合订卷的造句页不必整本送识图（60~80 页 × ¥0.01，还会让模型去读阅读听力页）：
    用 ingest 阶段的 OCR 缓存按页找「Make an appropriate sentence」，取首个造句页到邮件/讨论页之前的整段
    （中间某页标题没被 OCR 认出也会被带上）。缓存没有就跳过这卷 —— 不在这里现场 OCR，保证零意外调用。
    """
    try:
        names = sorted(os.listdir(folder))
    except OSError:
        return None
    for n in names:
        if not n.lower().endswith(".pdf") or n.startswith("~$"):
            continue
        if any(k in n for k in ("答案", "听力原文")):
            continue
        txt = os.path.join(OCR_TEXT_DIR, f"{setname}__{n[:-4]}.txt")
        if not os.path.exists(txt):
            continue
        parts = re.split(r"===== PAGE (\d+) =====", open(txt, "r", encoding="utf-8", errors="replace").read())
        bs_pages, tail_pages = [], []
        for i in range(1, len(parts) - 1, 2):
            page_no = int(parts[i])
            glued = re.sub(r"[^a-z0-9]", "", parts[i + 1].lower())
            if _BS_MARK.search(glued):
                bs_pages.append(page_no)
            if _WRITING_TAIL_MARK.search(glued):
                tail_pages.append(page_no)
        if not bs_pages:
            continue
        start, end = min(bs_pages), max(bs_pages)
        after = [p for p in tail_pages if p > end]
        # 造句段之后紧跟邮件 / 讨论页：把两者之间没被认出标题的页也带上（最多多带 2 页）
        if after:
            end = max(end, min(after[0] - 1, end + 2))
        return os.path.join(folder, n), list(range(start, end + 1))
    return None


def sets_with_writing(only: str | None) -> list[tuple[str, str, list[int] | None]]:
    """[(卷名, 写作pdf路径, 页码列表或 None=整本)]，只留有 structured.json 的卷（没跑过 ingest 的卷落不了库）。
    优先单独的「写作.pdf」（行为与改动前一致）；没有才去合订卷里按 OCR 缓存找造句页。"""
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
            out.append((name, pdf, None))
            continue
        combined = combined_writing_pages(name, folder)
        if combined:
            out.append((name, combined[0], combined[1]))
    return out


def render_pages(setname: str, pdf: str, pages: list[int] | None = None) -> list[tuple[int, str]]:
    """写作 PDF → 逐页 PNG（缓存命中不重渲染）。返回 [(PDF 页码, 页图路径)]。
    页码就是 PDF 里的真实页码（单独写作.pdf 从 1 起，与改动前的缓存文件名一致；合订卷只渲染造句那几页）。"""
    import fitz

    d = os.path.join(PAGE_DIR, re.sub(r"[^\w.-]+", "_", setname))
    os.makedirs(d, exist_ok=True)
    out = []
    with fitz.open(pdf) as doc:
        wanted = pages if pages is not None else list(range(1, doc.page_count + 1))
        for i in wanted:
            if i < 1 or i > doc.page_count:
                continue
            p = os.path.join(d, f"p{i}.png")
            if not os.path.exists(p):
                doc[i - 1].get_pixmap(dpi=DPI).save(p)
            out.append((i, p))
    return out


DEFAULT_VL_MODEL = os.environ.get("QWEN_VL_MODEL") or "qwen3-vl-plus"


def ocr_cache_path(setname: str, idx: int, img_hash: str, model: str | None = None) -> str:
    """识图缓存路径。**默认模型沿用老路径**（否则 333 张已有缓存一次作废、白花 ¥3.33），
    换了模型才另起一份 —— 不同模型的识图结果必须分开存，否则换模型重识会直接命中旧缓存。"""
    d = os.path.join(OCR_DIR, re.sub(r"[^\w.-]+", "_", setname))
    suffix = "" if not model or model == DEFAULT_VL_MODEL else "." + re.sub(r"[^\w.-]+", "_", model)
    return os.path.join(d, f"p{idx}.{img_hash}{suffix}.json")


def page_records(setname: str, idx: int, img_path: str, model: str, no_ocr: bool, refresh: bool = False,
                 samples: int = 1, temperature: float = 0.6):
    """一页 → 识图出的题记录列表（缓存优先；no_ocr 时缓存未命中就返回 None）。

    refresh=True 时跳过缓存重识这一页 —— 上一轮在这页上出过拒收（多半是漏认了一个词块），
    重识有机会认全。一页 ¥0.01，比整库重扫便宜三个数量级。

    重识**必须调高温度**：call_qwen 缺省 temperature=0，同一张图必然读出同样结果，
    照原样重识纯属白花钱。samples 次读数直接首尾相接返回 —— 主循环按题号收题、
    **第一个过机械校验的读法胜出**（没过的不占位），所以多读几遍只会多救几题，不会放低标准。
    """
    data = open(img_path, "rb").read()
    h = hashlib.sha1(data).hexdigest()[:8]
    cp = ocr_cache_path(setname, idx, h, model)
    if os.path.exists(cp) and not refresh:
        try:
            return json.load(open(cp, "r", encoding="utf-8")), True, 0
        except Exception:
            pass
    if no_ocr:
        return None, False, 0
    body, ext = shrink(data, "png")
    n = max(1, samples) if refresh else 1
    recs = []
    for k in range(n):
        text = call_qwen(body, ext, model, prompt=EXTRACT_PROMPT,
                         temperature=(temperature if (refresh and k > 0) else 0.0))
        recs.extend(parse_json_array(text))
    os.makedirs(os.path.dirname(cp), exist_ok=True)
    json.dump(recs, open(cp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return recs, False, n


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


@functools.lru_cache(maxsize=1)
def _gt_by_set() -> dict[str, dict[int, str]]:
    """真题 ground truth 的答案句：{卷名: {题号: 目标句}}。

    两份 GT 都读 —— `buildSentence-targets.json`（504 条）与 `buildSentence.json`（363 条，
    其中 8 条前者没有：2.8 五条、4.20 三条）。

    **按 source（卷名）精确匹配**，不再靠「日期 + 卷别后缀」反推 id：A 卷那几套的 id 根本不带
    `-A` 后缀（2026-01-21 的 27 条里，A 卷 9 条是光身 `2026-01-21_bsN`，只有 B/C 带后缀），
    旧口径要求后缀相等，实测 1.21A / 1.27A / 1.28A / 2.1A / 3.2A 五套一条都取不到，
    1.21C 也少一条 —— 合计 49 条 GT 答案句被白白吞掉（454 → 504）。
    """
    out: dict[str, dict[int, str]] = {}
    for f in (TARGETS_FILE, GT_ITEMS_FILE):
        try:
            raw = json.load(open(f, "r", encoding="utf-8"))
        except Exception:
            continue
        items = raw if isinstance(raw, list) else (raw.get("items") or [])
        for t in items:
            if not isinstance(t, dict):
                continue
            src = str(t.get("source") or "").strip()
            tgt = t.get("target")
            if not src or not tgt:
                continue
            n = t.get("n")
            if not isinstance(n, int):
                m = re.match(r"^\d{4}-\d{2}-\d{2}_bs(\d+)(-[ABC])?$", str(t.get("id") or ""))
                n = int(m.group(1)) if m else None
            if isinstance(n, int):
                out.setdefault(src, {}).setdefault(n, str(tgt))
    return out


def gt_answers_for(setname: str) -> dict[int, str]:
    """这一卷的 GT 答案句。答案页拼不出时拿它再试一次（见 build_with_gt_retry）。"""
    return dict(_gt_by_set().get(setname) or {})


CONVERTED_DIR = os.path.join(OUT_DIR, "src-converted")
_SECTION_HEAD = re.compile(r"^\s*(阅读|听力|写作|口语|答案)\s*[:：]?\s*$")


@functools.lru_cache(maxsize=None)
def docx_section_answers(setname: str, section: str, expect: int) -> dict[int, str]:
    """5 月第二来源（docx 卷）答案页某一科的句子：那份答案页是「一段一句、**不编号**」。

    ingest 的答案解析器只认带题号的写法（`1. what type of work…`），这几套一条都认不出，
    structured 里对应科目为空。convert_docx_set.py 把 docx 转成了 PDF，PDF 里中文表头是乱码、
    长句被折行，不能当源；这里顺着转换记录（src-converted/_convert_<日期>.json）找回原始
    「答案.docx」，按段落读：`section` 表头之后、下一个科目表头之前的非空英文段落，
    **恰好 expect 句**才采用，顺序即题号。

    「恰好 expect 句」是这条路唯一的结构闸：多一段少一段都说明表头之间混进了别的东西，
    宁可整科不收，也不拿一份对不齐的清单去顶题号。

    · 写作（expect=10）：万一顺序与题面错位也不会上错题 —— 下游机械校验要求答案句被模板 +
      词块按序恰好拼出，拼不出时 build_with_gt_retry 会在同卷 10 句里找**唯一**能拼出的那条。
    · 口语（expect=7）：复述句进 merge_recording_asr 后仍只当**锚**（证明这一句存在、在这个位置），
      定稿由录音那一句决定（repeat_text_from_audio），对不上录音的照旧 fail-closed 扣下。
    """
    try:
        names = sorted(os.listdir(CONVERTED_DIR))
    except OSError:
        return {}
    for fn in names:
        if not (fn.startswith("_convert_") and fn.endswith(".json")):
            continue
        try:
            conv = json.load(open(os.path.join(CONVERTED_DIR, fn), "r", encoding="utf-8"))
        except Exception:
            continue
        if os.path.basename(os.path.normpath(str(conv.get("out_dir") or ""))) != setname:
            continue
        for f in conv.get("files") or []:
            src = str(f.get("src") or "")
            if f.get("kind") != "answer-text-pdf" or not src.lower().endswith(".docx"):
                continue
            try:
                import docx  # python-docx
                paras = [p.text.strip() for p in docx.Document(os.path.join(conv["src_dir"], src)).paragraphs]
            except Exception:
                return {}
            out, inside = [], False
            for p in paras:
                h = _SECTION_HEAD.match(p)
                if h:
                    if inside:
                        break
                    inside = h.group(1) == section
                    continue
                if inside and p and re.search(r"[A-Za-z]", p):
                    out.append(p)
            return {i + 1: s for i, s in enumerate(out)} if len(out) == expect else {}
    return {}


def docx_writing_answers(setname: str) -> dict[int, str]:
    """造句那一科的答案句（恰好 10 句）。"""
    return docx_section_answers(setname, "写作", 10)


def docx_speaking_answers(setname: str) -> dict[int, str]:
    """复述那一科的答案句（恰好 7 句）—— merge_recording_asr._build_repeat 的兜底来源。"""
    return docx_section_answers(setname, "口语", 7)


def answers_for(setname: str) -> dict[int, str]:
    """答案页给的 {题号: 答案句}。structured 优先，缺的用 realExam2026 的 GT 补；都没有再退到 docx 卷的不编号写法。"""
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
    for n, t in gt_answers_for(setname).items():
        out.setdefault(n, t)
    if not out:
        out = dict(docx_writing_answers(setname))
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
    ap.add_argument("--samples", type=int, default=3,
                    help="重识时同一页读几遍（只对 --refresh-rejects 的页生效，默认 3）")
    ap.add_argument("--temperature", type=float, default=0.6,
                    help="重识第 2 遍起用的温度（默认 0.6；0 会读出和上次一模一样的结果）")
    ap.add_argument("--refresh-rejects", action="store_true",
                    help="只重识上一轮出过拒收的那些页（跳过缓存）—— 多半是漏认了一个词块，¥0.01/张")
    ap.add_argument("--report-out", default=None,
                    help="把逐条拒收明细另存一份到这个路径（.codex-tmp 不进 git，要离线分析就写到 data/ 下）")
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

    # --refresh-rejects：从上一轮报告里挑出「出过硬拒收」的页。duplicate_q / no_answer_sentence
    # 不是识图的锅（一个是同页重复抽到、一个是答案页没给答案句），重识它们纯属烧钱。
    refresh_pages: set[tuple[str, str]] = set()
    if args.refresh_rejects:
        try:
            prev = json.load(open(os.path.join(OUT_DIR, "_bs_pages_report.json"), "r", encoding="utf-8"))
        except Exception:
            prev = []
        for rep in prev:
            for row in rep.get("reject_rows") or []:
                if row.get("reason") in ("duplicate_q", "no_answer_sentence"):
                    continue
                if row.get("page"):
                    refresh_pages.add((rep.get("set"), row["page"]))
        print(f"■ --refresh-rejects：上一轮出过拒收的 {len(refresh_pages)} 页要重识"
              f"，每页读 {args.samples} 遍（温度 {args.temperature}）"
              f"，约 ¥{len(refresh_pages) * args.samples * CNY_PER_IMAGE:.2f}")
        if not refresh_pages:
            print("  （上一轮报告里没有拒收记录 —— 先跑一次 --no-ocr 生成报告）")

    # ① 渲染（本地零成本）
    rendered: list[tuple[str, list[tuple[int, str]], str]] = []
    for setname, pdf, page_nos in sets:
        where = os.path.basename(pdf) if page_nos is None else f"{os.path.basename(pdf)} p{page_nos[0]}-{page_nos[-1]}（合订卷）"
        rendered.append((setname, render_pages(setname, pdf, page_nos), where))
    total_pages = sum(len(p) for _, p, _ in rendered)

    # ② 报数
    todo = 0
    for setname, pages, where in rendered:
        n_todo = 0
        for i, p in pages:
            h = hashlib.sha1(open(p, "rb").read()).hexdigest()[:8]
            if (setname, os.path.basename(p)) in refresh_pages \
                    or not os.path.exists(ocr_cache_path(setname, i, h, args.model)):
                n_todo += 1
        todo += n_todo
        if n_todo:
            print(f"  待识图 {setname}：{n_todo} 张（{where}）")
    n_refresh = sum(1 for setname, pages, _ in rendered for i, p in pages
                    if (setname, os.path.basename(p)) in refresh_pages)
    billed = (todo - n_refresh) + n_refresh * max(1, args.samples)
    print(f"■ {len(sets)} 套，共渲染 {total_pages} 页；待识图 {todo} 张"
          f"（其中重识 {n_refresh} 张 ×{max(1, args.samples)} 遍），"
          f"预计费用 ¥{billed * CNY_PER_IMAGE:.2f}（¥{CNY_PER_IMAGE}/张估）")
    if args.dry_run:
        print("（--dry-run，未发任何请求）")
        return 0
    if todo > args.max_images:
        print(f"[停] 待识图 {todo} 张超过 --max-images {args.max_images}", file=sys.stderr)
        return 2

    # ③ 识图 + ④ 配答案校验
    report = []
    calls = 0
    for setname, pages, where in rendered:
        answers = answers_for(setname)
        gt_answers = gt_answers_for(setname)
        # 同卷全扫（build_with_gt_retry 第三级）的候选池：有 GT 用 GT；docx 卷没有 GT、答案句又是按段落顺序认的，
        # 就拿这 10 句自己当池子 —— 顺序万一错位，只收唯一能拼出的那条。
        scan_pool = gt_answers or (answers if answers and answers == docx_writing_answers(setname) else {})
        meta_flags = flags_for(setname)
        date = set_date(setname)
        slug = set_slug(setname)
        shash = source_hash(setname)
        seen_q: dict[int, dict] = {}
        rejects: dict[str, int] = {}
        # 逐条拒收明细：只有计数说明不了「这 37 条 no_solution 到底是识图漏块还是答案句对不上」，
        # 得把那一屏的模板 + 词块 + 用过的答案句一起留下来，事后离线看。
        rej_rows: list[dict] = []
        n_seen = 0
        for i, p in pages:
            try:
                recs, cached, n_calls = page_records(
                    setname, i, p, args.model, args.no_ocr,
                    refresh=(setname, os.path.basename(p)) in refresh_pages,
                    samples=args.samples, temperature=args.temperature)
            except SystemicFailure as e:
                print(f"\n[中止] 系统性 API 失败：{e}", file=sys.stderr)
                return EXIT_SYSTEMIC
            except Exception as e:
                rejects["ocr_failed"] = rejects.get("ocr_failed", 0) + 1
                print(f"  {setname} p{i} 识图失败：{str(e)[:140]}")
                continue
            if recs is None:
                continue
            calls += n_calls
            for rec in recs:
                if not isinstance(rec, dict):
                    continue
                n_seen += 1
                try:
                    q = int(rec.get("q"))
                except Exception:
                    rejects["bad_q"] = rejects.get("bad_q", 0) + 1
                    rej_rows.append({"q": None, "page": os.path.basename(p), "reason": "bad_q",
                                     "prompt": str(rec.get("prompt") or "")[:160],
                                     "template": str(rec.get("template") or "")[:160],
                                     "chunks": [str(c or "")[:40] for c in (rec.get("chunks") or [])],
                                     "answer_tried": ""})
                    continue
                note = lambda reason, qq=None, ans=None: rej_rows.append({
                    "q": qq, "page": os.path.basename(p), "reason": reason,
                    "prompt": str(rec.get("prompt") or "")[:160],
                    "template": str(rec.get("template") or "")[:160],
                    "chunks": [str(c or "")[:40] for c in (rec.get("chunks") or [])],
                    "answer_tried": str(ans or "")[:200],
                })
                if q in seen_q:
                    rejects["duplicate_q"] = rejects.get("duplicate_q", 0) + 1
                    note("duplicate_q", q)
                    continue
                if q not in answers:
                    rejects["no_answer_sentence"] = rejects.get("no_answer_sentence", 0) + 1
                    note("no_answer_sentence", q)
                    continue
                core, fz, why = build_with_gt_retry(rec, answers[q], gt_answers.get(q), rejects, scan_pool)
                if core is None:
                    rejects[why] = rejects.get(why, 0) + 1
                    note(why, q, answers[q])
                    continue
                if fz:
                    rejects["_fuzzy_word_ok"] = rejects.get("_fuzzy_word_ok", 0) + 1
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
        # 同一页读多遍时，同一题会「先失败后成功」（第一个过机械校验的读法胜出）——
        # 已经收下的题不该再留在拒收账里，否则报告会把救回来的题也算成丢题。
        if rej_rows:
            # ① 已经收下的题不该再留在拒收账里（多遍读时同一题会先失败后成功）
            fixed = {r["q"] for r in rej_rows if r.get("q") is not None and r["q"] in seen_q}
            # ② 一道题只算一次：读了 3 遍都没过就记 3 条的话，no_solution 会凭空翻倍
            #    （2026-09-15 实测 37 虚涨到 74，看报告的人还以为补题把题补丢了）
            kept, counted = [], set()
            for r in rej_rows:
                q = r.get("q")
                if q in fixed or (q is not None and q in counted):
                    if rejects.get(r["reason"]):
                        rejects[r["reason"]] -= 1
                    continue
                if q is not None:
                    counted.add(q)
                kept.append(r)
            rej_rows = kept
            rejects = {k: v for k, v in rejects.items() if v}

        items = [seen_q[k] for k in sorted(seen_q)]
        out_p = os.path.join(OUT_DIR, f"{setname}.bs.json")
        if items:
            json.dump({"set": setname, "count": len(items), "items": items},
                      open(out_p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        elif os.path.exists(out_p):
            os.remove(out_p)
        report.append({"set": setname, "pages": len(pages), "from": where, "seen": n_seen,
                       "answers": len(answers), "ok": len(items), "rejects": rejects,
                       "reject_rows": rej_rows})
        # "_" 开头的键是**通过**的标记（模糊匹配救回 / GT 答案句救回），不是拒收 —— 分开打，
        # 否则读的人会把 _fuzzy_word_ok 当成丢题（2026-09-15 实测把人绕进去过）。
        marks = {k: v for k, v in rejects.items() if k.startswith("_")}
        hard = {k: v for k, v in rejects.items() if not k.startswith("_")}
        print(f"  · {setname}: {len(pages)} 页 / 识图 {n_seen} 题 / 答案 {len(answers)} 条 "
              f"→ 通过 {len(items)}" + (f"（救回 {marks}）" if marks else "")
              + (f"  拒收 {hard}" if hard else ""))

    # 报告按卷合并：--only 跑一部分卷时，不能把其余卷上一次的记录冲掉（事后要靠它查每套卷为什么缺题）
    report_p = os.path.join(OUT_DIR, "_bs_pages_report.json")
    try:
        prev_report = json.load(open(report_p, "r", encoding="utf-8"))
    except Exception:
        prev_report = []
    done = {r["set"] for r in report}
    merged = sorted([r for r in prev_report if r.get("set") not in done] + report, key=lambda r: r.get("set", ""))
    json.dump(merged, open(report_p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    tot_ok = sum(r["ok"] for r in report)
    agg: dict[str, int] = {}
    for r in report:
        for k, v in r["rejects"].items():
            agg[k] = agg.get(k, 0) + v
    print(f"\n完成：{len(report)} 套，通过 {tot_ok} 题，本次实际调用 {calls} 张 "
          f"（约 ¥{calls * CNY_PER_IMAGE:.2f}）")
    if args.report_out:
        rows = [dict(r, set=rep["set"]) for rep in merged for r in (rep.get("reject_rows") or [])]
        os.makedirs(os.path.dirname(os.path.abspath(args.report_out)) or ".", exist_ok=True)
        json.dump({"generated_by": "scripts/realbank/extract_bs_pages.py --report-out",
                   "_purpose": "识图拿到题面、却过不了机械校验的每一条：那一屏的模板 + 词块 + 试过的答案句。"
                               "只有计数说明不了是识图漏块还是答案句对不上。",
                   "count": len(rows), "rows": rows},
                  open(args.report_out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"逐条拒收明细 → {args.report_out}（{len(rows)} 条）")

    marks = {k: v for k, v in agg.items() if k.startswith("_")}
    hard = {k: v for k, v in agg.items() if not k.startswith("_")}
    if marks:
        print(f"其中救回（已计入通过）：{json.dumps(marks, ensure_ascii=False)}")
    print(f"拒收原因分布：{json.dumps(hard, ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
