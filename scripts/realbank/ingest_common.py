#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""真题录入管线 —— 确定性内核（零 LLM token）。

职责边界：本模块只做「机器能证明对错」的那一半——判科目、切题块、解析答案、
按题号硬对齐、算体检指标。**不做**语义结构化（那是 DeepSeek 阶段的活）。

三条硬约束，全部来自对源文件的实测，不是想当然：
  1. 文件名不可信。实测 `3.10 写作.pdf` 里装的是听力内容（与 `3.10 听力q4开始.pdf`
     逐字一致）。科目一律按**内容**里的题号锚点判定。
  2. 跨卷重复。实测 5 组不同日期的卷共用同一份文件（3.11阅读==3.21阅读 等），
     必须靠内容哈希去重，否则同一套题会被当成两套真题。
  3. 对不齐就扣下。题号集合与答案集合不一致时整段标 blocked，绝不「尽量配一配」：
     错位一格的题库用户看不出来，比没有更糟。
"""
import hashlib
import re

# ── 题号锚点 ────────────────────────────────────────────────────────────────
# 每道题的页眉形如 "Reading Question21of35" / "Listening|Questions1-10of35"。
# OCR 会把竖线读成 I、1、l、斜杠或左方括号，也会把空格整个吃掉，所以分隔符全部放宽。
# 实测：只认 [|I1l] 时命中 4298 处；补上 "/"（实测 451 处）与 "["（实测 16 处）
# 后命中 4765 处，覆盖 155 份。漏掉这两个变体会让整道题的页眉认不出来，
# 表现为对齐阶段 missing_stem（实测 4.15 卷阅读 Q24 + 整个 module2 CTW 均因此丢失）。
ANCHOR = re.compile(
    r"(Reading|Listening|Speaking|Writing)\s*[|I1l/\[]?\s*"
    r"Questions?\s*(\d+)\s*(?:[-~—]\s*(\d+))?\s*of\s*(\d+)",
    re.I,
)

SECTIONS = ("reading", "listening", "speaking", "writing")

# 水印：卖家在每页盖的店铺广告，入库前必须剔干净（qc_realexam.mjs 也查这个）。
WATERMARK = re.compile(r"闲鱼|盗卖|退款|店铺|甜茶|满分小屋|唯一闲")


def strip_watermark(text):
    return "\n".join(l for l in text.splitlines() if not WATERMARK.search(l))


def content_hash(text):
    """归一化后的内容指纹，用于跨卷去重（忽略空白与水印差异）。"""
    norm = re.sub(r"\s+", " ", strip_watermark(text)).strip().lower()
    return hashlib.md5(norm.encode("utf-8")).hexdigest()


# ── 1. 按内容判科目 ─────────────────────────────────────────────────────────
def detect_section(text):
    """返回 (科目, 置信度, 各科锚点计数)。锚点最多的科目获胜。

    置信度 = 优势科目锚点数 / 总锚点数。低于 0.8 说明一份文件里混了多科
    （合集卷就是这样），调用方应按锚点切开，而不是整份归一科。
    """
    counts = {s: 0 for s in SECTIONS}
    for sec, _, _, _ in ANCHOR.findall(text):
        counts[sec.lower()] += 1
    total = sum(counts.values())
    if not total:
        return None, 0.0, counts
    best = max(counts, key=counts.get)
    return best, counts[best] / total, counts


# ── 2. 切题块 ───────────────────────────────────────────────────────────────
def segment(text):
    """把整份 OCR 文本切成逐题块。

    返回 [{section, start, end, total, body}]。start/end 是题号区间（单题
    start==end；"Questions1-10of35" 这类填空块 start=1 end=10）；total 是该科
    总题数（"of 35" 的 35），用来交叉校验答案数量。
    """
    marks = list(ANCHOR.finditer(text))
    blocks = []
    for i, m in enumerate(marks):
        body_start = m.end()
        body_end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        start = int(m.group(2))
        end = int(m.group(3)) if m.group(3) else start
        if end < start:
            end = start
        blocks.append({
            "section": m.group(1).lower(),
            "start": start,
            "end": end,
            "total": int(m.group(4)),
            "body": strip_watermark(text[body_start:body_end]).strip(),
        })
    return blocks


# ── 3. 解析答案 PDF ─────────────────────────────────────────────────────────
# 实测两种排版都要吃：
#   A) 中文科目名 + 行内紧凑   「阅读 / 1has 2wheels ... 21c 22d / 加试 / ...」
#   B) 英文科目名 + 逐行       「Reading, Module1: / 1 / They / 2 / change ...」
# 「加试」/「Module2」都是第二个模块（自适应模考的 M2）。
SEC_HEADER = re.compile(
    r"^\s*(?:"
    # 中文科目名后面允许跟任意尾巴（尾巴一律忽略）。实测存在带注记/分卷后缀的表头：
    #   「听力 q4-6 题目缺失」(4.5 卷)、「写作A」/「写作B」(3.6 卷)。
    # 整行严格匹配会把它们漏成普通行，于是紧跟其后的答案静默灌进**上一科**的
    # module（4.5 的听力答案灌进阅读加试、3.6 的写作B覆盖写作A）——题目照常显示、
    # 答案静默错位，是最危险的错法。
    # 「写作A」后再来「写作B」会自然 append 第二个 module；下游路由要求唯一胜出，
    # 被 blocked 是可接受的 fail-closed 结果。
    r"(?P<cn>阅读|听力|写作|口语|加试|附加|额外)\s*[:：]?\s*(?:\S.*)?"
    # 英文分支与光杆 Module 分支保持整行严格匹配（放宽会误伤正文里的英文行）
    r"|(?:(?P<en>Reading|Listening|Writing|Speaking)\s*[,，]?\s*(?:module\s*(?P<mod>\d+))?"
    # 光杆 "Module2:"（不带科目名）也是换 module 的信号。实测 1.21A 的答案页就是
    # 「Reading, Module1: … Module2: …」这种写法；漏掉它会让 module2 的答案灌进
    # module1 的字典里**覆盖掉前 15 题的正确答案** —— 题目照常显示、答案静默变错，
    # 该卷盲审因此只有 63%。
    r"|(?P<mod_only>module\s*(?P<mod2>\d+)))\s*[:：]?"
    r")\s*$",
    re.I,
)
CN_SECTION = {"阅读": "reading", "听力": "listening", "写作": "writing", "口语": "speaking"}
EXTRA_MODULE = ("加试", "附加", "额外")
# 编号+答案：`1has` `21c` `1. 句子` `1 They`。答案体可以是字母、单词或整句。
NUM_ANS = re.compile(r"(?<![A-Za-z0-9])(\d{1,2})\s*[.、)]?\s*([A-Za-z][^\d\n]*)")


def _is_restart(n, cur_mod):
    """题号「重启到 1」而当前 module 已经有 1 号 —— 说明这里其实换了一科/一个
    module，只是排版上没写科目头（实测 3.29 卷：阅读 / 加试 / **无头的听力** /
    加试 / 写作）。

    旧逻辑会把这块直接灌进上一个 module 的字典，把阅读加试 1–15 的答案**静默
    覆盖**成听力答案——题目照常显示、答案错位，用户看不出来，比缺题更糟。
    所以这里 fail-closed：立刻停止灌入并记 warning，**不猜它属于哪一科**
    （连 cur_sec 一起清掉，否则紧随其后的光杆「加试」会继续挂到上一科名下，
    等于换个姿势乱猜），直到出现下一个明确的科目头才恢复。
    """
    return n == 1 and 1 in cur_mod


def _norm_answer(v):
    v = v.strip().rstrip("\\").strip()
    return v.lower() if len(v) == 1 and v.lower() in "abcd" else v


def _headers(text):
    """产出 (行号, 科目 或 None, 是否加试)。科目 None 且非加试 = 不是表头行。"""
    for idx, raw in enumerate(strip_watermark(text).splitlines()):
        h = SEC_HEADER.match(raw.strip())
        if not h:
            yield idx, raw, None, False
            continue
        cn, en, mod_only = h.group("cn"), h.group("en"), h.group("mod_only")
        if cn in EXTRA_MODULE:
            yield idx, raw, None, True
        elif cn:
            yield idx, raw, CN_SECTION[cn], False
        elif mod_only:
            # 光杆 Module N：沿用当前科目，另起一个 module（与「加试」同义）
            yield idx, raw, None, True
        else:
            yield idx, raw, en.lower(), int(h.group("mod") or 1) > 1


def _restart_warning(sink, section, line_no, raw):
    """记一条「无科目头的题号重启块」告警。sink 为 None 时静默丢弃。"""
    if sink is None:
        return
    sink.append({
        "section": section,
        "line": line_no,
        "sample": raw.strip()[:80],
        "message": (f"答案页第 {line_no + 1} 行出现无科目头的题号重启块"
                    f"（当前科目 {section}），已忽略(fail-closed)：{raw.strip()[:60]}"),
    })


def parse_answer_pdf_with_warnings(text):
    """同 parse_answer_pdf，另外返回解析告警列表。

    告警只保留**最终被采用的那个排版解析器**在该科目上产生的那些——
    落选解析器的告警是噪音，不该吓唬调用方。
    """
    w_inline, w_linewise = [], []
    inline = _parse_inline(text, w_inline)
    linewise = _parse_linewise(text, w_linewise)
    picked, warnings = {}, []
    for sec in SECTIONS:
        a, b = inline.get(sec, []), linewise.get(sec, [])
        if sum(len(m) for m in a) >= sum(len(m) for m in b):
            picked[sec], src = a, w_inline
        else:
            picked[sec], src = b, w_linewise
        warnings.extend(w for w in src if w["section"] == sec)
    return picked, warnings


def parse_answer_pdf(text):
    """答案 PDF 文本 → {section: [module0, module1, ...]}，module 为 {题号: 答案}。

    同一科目里遇到「加试 / Module2」就开新 module。两种排版都跑一遍，
    取抓到答案更多的那个结果——答案条数是可验证的客观量，不是偏好。
    """
    return parse_answer_pdf_with_warnings(text)[0]


def _parse_inline(text, warnings=None):
    """排版 A：编号与答案同一行（`1has 2wheels ... 21c`）。"""
    out = {s: [] for s in SECTIONS}
    cur_sec, cur_mod = None, None
    for idx, raw, sec, extra in _headers(text):
        if sec or extra:
            target = sec or cur_sec
            if target:
                cur_sec = target
                cur_mod = {}
                out[target].append(cur_mod)
            continue
        if cur_mod is None:
            continue
        for num, ans in NUM_ANS.findall(raw):
            n = int(num)
            if _is_restart(n, cur_mod):
                # 整行连同后面所有行一起弃掉，直到下一个明确科目头
                _restart_warning(warnings, cur_sec, idx, raw)
                cur_sec, cur_mod = None, None
                break
            a = _norm_answer(ans)
            if a:
                cur_mod[n] = a
    return {s: [m for m in v if m] for s, v in out.items()}


def _parse_linewise(text, warnings=None):
    """排版 B：一行纯数字，下一行是答案。"""
    lines = strip_watermark(text).splitlines()
    out = {s: [] for s in SECTIONS}
    cur_sec, cur_mod = None, None
    header_rows = {}
    for idx, raw, sec, extra in _headers(text):
        if sec or extra:
            header_rows[idx] = (sec, extra)
    idx = 0
    while idx < len(lines):
        if idx in header_rows:
            sec, _extra = header_rows[idx]
            target = sec or cur_sec
            if target:
                cur_sec = target
                cur_mod = {}
                out[target].append(cur_mod)
            idx += 1
            continue
        a = lines[idx].strip()
        b = lines[idx + 1].strip() if idx + 1 < len(lines) else ""
        if cur_mod is not None and re.fullmatch(r"\d{1,2}", a) and b and not re.fullmatch(r"\d{1,2}", b):
            if _is_restart(int(a), cur_mod):
                _restart_warning(warnings, cur_sec, idx, f"{a} / {b}")
                cur_sec, cur_mod = None, None
                idx += 1
                continue
            if not WATERMARK.search(b):
                cur_mod[int(a)] = _norm_answer(b)
            idx += 2
            continue
        idx += 1
    return {s: [m for m in v if m] for s, v in out.items()}


# ── 4. 硬对齐 ───────────────────────────────────────────────────────────────
# 「章节说明屏」：考试每个 section 开头的须知页，也顶着 "Question 13 of 32" 的页眉，
# 于是会伪装成一道题。它没有题干也没有选项，必须排到候选末位。
DIRECTIONS = re.compile(
    r"you will listen only one time|in an actual test|the clock will indicate|"
    r"directions|you will (?:now )?(?:begin|hear)|answer questions about",
    re.I,
)


def _block_quality(b):
    """候选块打分。越像一道真题分越高：有选项 > 有正文 > 说明屏 > 空块。"""
    body = (b.get("body") or "").strip()
    if not body:
        return -100
    lines = [l.strip() for l in body.splitlines() if l.strip()]
    score = min(len(body), 1200) / 100.0
    if DIRECTIONS.search(body):
        score -= 50  # 说明屏，永远排在真题后面
    # 4 条长度相近的并列短行 ≈ 一组选项，是「这是真题」最强的信号
    tail = [l for l in lines if 2 <= len(l.split()) <= 20]
    if len(tail) >= 4:
        score += 20
    if "?" in body:
        score += 5
    return score


def _looks_like_different_questions(a, b):
    """两个候选是不是**两道不同的真题**（而非同一题的重复截图 / 说明屏）。

    只有两边都像真题、且文本几乎不重叠时才判 True —— 这时先到先得会把 A 的题干
    配上 B 的答案，必须扣下人工。
    """
    if _block_quality(a) < 10 or _block_quality(b) < 10:
        return False  # 至少一边不是真题（说明屏/空块），择优即可，不算争议
    wa = set(re.findall(r"[a-z]{4,}", (a.get("body") or "").lower()))
    wb = set(re.findall(r"[a-z]{4,}", (b.get("body") or "").lower()))
    if not wa or not wb:
        return False
    overlap = len(wa & wb) / min(len(wa), len(wb))
    return overlap < 0.5


def align(blocks, answer_modules, section):
    """把某科的题块与答案 module 按题号对齐。fail-closed。

    module 路由靠题块页眉里的「of N」总题数：一份卷的正卷与加试题号都从头计数，
    单看题号无法区分，但 N 不同（实测 3.10 阅读 of-35 / of-15，听力 of-32 / of-15），
    而 N 恰好等于该 module 的最大题号。所以 `N == max(答案题号)` 就是判据 —— 它是
    可证伪的（对不上就没有候选），不是启发式猜测。

    返回 {status, modules[], matched_count, note}。
    status: ok / partial / blocked / no_stems / no_answers
    """
    secblocks = [b for b in blocks if b["section"] == section]
    if not secblocks:
        return {"status": "no_stems", "modules": [], "matched_count": 0,
                "note": "OCR 里没有该科题块"}
    if not answer_modules:
        return {"status": "no_answers", "modules": [], "matched_count": 0,
                "note": "答案 PDF 里没有该科答案"}

    # 按「of N」把题块分组，组内摊平成逐题号（填空块 1-10 摊成 10 个题号，共享正文）。
    #
    # 同一题号常有多个候选块（实测 49 组重号）：考生把同一屏截了两次，加上「章节说明屏」
    # 也顶着同样的题号页眉。**不能先到先得**——实测第一个到的往往正是那张没有题目的说明屏。
    # 按质量择优，并且当两个候选看起来是**两道不同的真题**时整题扣下（那种情况先到先得
    # 会静默地把 A 题的题干配上 B 题的答案，是最危险的错法）。
    groups, contested = {}, {}
    for b in secblocks:
        stems = groups.setdefault(b["total"], {})
        for n in range(b["start"], b["end"] + 1):
            prev = stems.get(n)
            if prev is None:
                stems[n] = b
                continue
            if _looks_like_different_questions(prev, b):
                contested.setdefault(b["total"], set()).add(n)
            if _block_quality(b) > _block_quality(prev):
                stems[n] = b

    # 两趟路由。第一趟只认「N == 答案最大题号」的精确证据；第二趟才用题号重叠度，
    # 且要求唯一胜出——因为口语这类 module 的 N 会大于答案条数（11 题里只有 7 条
    # 复述有标准答案，4 道面试题本来就没有答案），精确匹配吃不下。
    route, used = {}, set()
    for mi, ans in enumerate(answer_modules):
        want = max(ans)
        if want in groups and want not in used:
            route[mi] = (want, "N 等于答案最大题号")
            used.add(want)
    for mi, ans in enumerate(answer_modules):
        if mi in route:
            continue
        scored = []
        for total, stems in groups.items():
            if total in used:
                continue
            overlap = len(set(ans) & set(stems)) / len(ans)
            if overlap >= 0.8:
                scored.append((overlap, total))
        scored.sort(reverse=True)
        if len(scored) == 1:
            route[mi] = (scored[0][1], f"题号重叠 {scored[0][0]:.0%}，候选唯一")
            used.add(scored[0][1])
        elif len(scored) > 1:
            route[mi] = (None, f"有 {len(scored)} 个题块组都能对上（of-"
                               f"{[t for _, t in scored]}），拒绝二选一")

    mods = []
    for mi, ans in enumerate(answer_modules):
        total, why = route.get(mi, (None, f"没有题块组能对上（现有 of-{sorted(groups)}）"))
        if total is None:
            mods.append({
                "module": mi + 1, "total": max(ans), "status": "blocked",
                "matched": [], "missing_answer": [], "missing_stem": sorted(ans),
                "note": why,
            })
            continue
        stems = groups[total]
        # 有争议的题号（两个候选都像真题却内容不同）整题扣下，绝不择优蒙一个
        bad = contested.get(total, set())
        matched = [{"n": n, "answer": ans[n], "block": b}
                   for n, b in sorted(stems.items()) if n in ans and n not in bad]
        missing_answer = sorted(set(stems) - set(ans) - bad)
        missing_stem = sorted((set(ans) - set(stems)) | (set(ans) & bad))
        note = f"路由到 of-{total}（{why}）"
        if bad:
            note += f"；题号 {sorted(bad)[:10]} 有多个互不相同的候选题干，已扣下"
        mods.append({
            "module": mi + 1, "total": total,
            "status": "blocked" if not matched else ("partial" if missing_answer or missing_stem else "ok"),
            "matched": matched, "missing_answer": missing_answer,
            "missing_stem": missing_stem, "contested": sorted(bad), "note": note,
        })

    orphan = sorted(set(groups) - used)
    statuses = [m["status"] for m in mods]
    status = "ok" if all(s == "ok" for s in statuses) and not orphan else (
        "blocked" if all(s == "blocked" for s in statuses) else "partial")
    note = f"答案 {len(answer_modules)} 个 module；题块组 of-{sorted(groups)}"
    if orphan:
        note += f"；有题干无答案的组 of-{orphan}"
    return {"status": status, "modules": mods,
            "matched_count": sum(len(m["matched"]) for m in mods), "note": note}
