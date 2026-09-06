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
# 旧实现要求「完整科目词 + 至多 1 个噪声字符 + Question…」，实测被三类 OCR 噪声打穿：
#   a) 科目词本身被读残：Listening→"ing"/"ng"、Speaking→"peaking"/"eaking1"、
#      Reading→"keaaing"/"Keaaing"、Writing→"Qing"/"oing"/"Vioing"（2.23 整份如此）；
#   b) 科目词与 Question 之间不止 1 个噪声字符："Reading J/"、"Writing T "、
#      "Reading 1 C "、"Listening！ 1"；
#   c) 题号/of 周围混入标点："Question 1.of 32"、"Question12of.15"、"Question /1 of 32"、
#      "Question24.of35"、"Question 4. of 15"，甚至 of 被读成 or/ot（"Question6or10"、
#      "Question14ot15"）。
# 所以拆成两层：QHEAD 只认「Question N (-M)? of T」这个可证伪的骨架；科目由锚点左边
# 最近的那个词决定（精确 → 唯一后缀 → 编辑距离 ≤2），认不出来才由 of-T 反推。
QHEAD = re.compile(
    r"Questions?\s*[|I/\[\]\\.,:;]{0,2}\s*(?P<n1>\d{1,3})\s*(?:[-~—]\s*(?P<n2>\d{1,3}))?"
    r"\s*[.,:;]?\s*(?P<of>[o0][ftr])\s*[.,:;]?\s*(?P<total>\d{1,3})",
    re.I,
)

SECTIONS = ("reading", "listening", "speaking", "writing")

# of-T 的合法取值：全库 4805 个锚点实测只出现过这 7 个 T（阅读 35/15、听力 32/15、
# 口语 11、写作 12/10/2），唯一的例外是 4.18 口语的 "Question 6 of 1"——题号比总数还大，
# 显然是 "of 11" 被读残。放开科目词以后必须靠这张白名单挡住正文里的 "question 1 of 2"。
VALID_TOTALS = frozenset({2, 10, 11, 12, 15, 32, 35})
# T→科目 的唯一反推表（15 同时是阅读 M2 与听力 M2，故意不在表里，只能靠上下文定）
TOTAL_SECTION = {35: "reading", 32: "listening", 11: "speaking", 12: "writing",
                 10: "writing", 2: "writing"}
LEAD_WIDTH = 28      # 只看锚点左边、同一行的最后 28 个字符
WORD_GAP_MAX = 8     # 科目词尾与 Question 之间最多 8 个噪声字符（实测最宽 5：" 1 C "）
HEAD_COL_MAX = 25    # 认不出科目词时，页眉必须靠近行首（实测这类页眉都在第 1–12 列）


def _edit(a, b, cap=2):
    """带上限的编辑距离（超过 cap 直接返回 cap+1，不必算准）。"""
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) > cap:
            return cap + 1
        prev = cur
    return prev[-1]


def _lead(text, pos):
    """锚点左边、同一行的最后 LEAD_WIDTH 个字符 + 该锚点在行内的列号。"""
    line_start = text.rfind("\n", 0, pos) + 1
    return text[max(line_start, pos - LEAD_WIDTH):pos], pos - line_start


def _section_from_lead(lead):
    """从页眉左边的残词判科目。返回 (科目 或 None, 是否精确, 词首在 lead 里的位置)。

    只看最后一个字母词，且要求它离 Question 不超过 WORD_GAP_MAX 个字符——
    「同一行里出现过科目词」太松，会把正文句子里的科目名认成页眉。
    """
    toks = [(m.group(0).lower(), m.start(), m.end())
            for m in re.finditer(r"[A-Za-z]{2,}", lead)]
    if not toks:
        return None, False, None
    tok, s0, s1 = toks[-1]
    if len(lead) - s1 > WORD_GAP_MAX:
        return None, False, None
    if tok in SECTIONS:
        return tok, True, s0
    hits = [s for s in SECTIONS if len(tok) >= 3 and s.endswith(tok)]
    if len(hits) == 1:  # "peaking"→speaking / "eaking"→speaking
        return hits[0], False, s0
    if not hits:        # "keaaing"→reading（编辑距离 2，且只有 reading 够得着）
        hits = [s for s in SECTIONS if abs(len(s) - len(tok)) <= 1 and _edit(tok, s) <= 2]
        if len(hits) == 1:
            return hits[0], False, s0
    return None, False, None  # "ing" 同时是 reading/listening/writing 的后缀 → 交给 of-T


def find_anchors(text):
    """把整份文本里的题号页眉找出来，逐个定科目。

    返回 [{section, start, end, total, pos, body_start, section_inferred, why}]，
    pos = 该页眉的起点（含科目词，用来切上一块的正文），body_start = 页眉之后。
    定不出科目的锚点直接丢弃（fail-closed），不猜。
    """
    raw = []
    for m in QHEAD.finditer(text):
        lead, col = _lead(text, m.start())
        sec, exact, w0 = _section_from_lead(lead)
        n1 = int(m.group("n1"))
        raw.append({
            "section": sec, "exact": exact,
            "start": n1, "end": int(m.group("n2")) if m.group("n2") else n1,
            "total": int(m.group("total")),
            "of_ok": m.group("of").lower() == "of",
            "col": col,
            "pos": m.start() - (len(lead) - w0) if w0 is not None else m.start(),
            "body_start": m.end(),
            "why": "科目词精确" if exact else ("科目词残缺模糊匹配" if sec else None),
        })
    if not raw:
        return []

    # 第二趟：科目词认不出来的，用 of-T 反推。of 被读成 or/ot 的那些**必须**有科目词
    # 兜底（"question 1 or 2" 这种正文句子太常见，不能靠 T 白名单单独扛）。
    for a in raw:
        if a["section"] or not a["of_ok"] or a["col"] > HEAD_COL_MAX:
            continue
        sec = TOTAL_SECTION.get(a["total"])
        if sec:
            a["section"], a["why"] = sec, f"科目词残缺，按 of-{a['total']} 反推"

    # 第三趟：T=15（阅读 M2 / 听力 M2 都可能）之类仍未定的，用同一份文件里最近的
    # 已定科目锚点定（题面 PDF 一份只装一科，这个上下文是可靠的）。
    known = [i for i, a in enumerate(raw) if a["section"]]
    for i, a in enumerate(raw):
        if a["section"] or not a["of_ok"] or a["col"] > HEAD_COL_MAX:
            continue
        near = min(known, key=lambda k: abs(k - i)) if known else None
        if near is not None:
            a["section"] = raw[near]["section"]
            a["why"] = f"科目词残缺，取同文件最近的已定科目锚点（第 {near + 1} 个）"

    # 第四趟：of-T 合法性。T 不在白名单、或题号比 T 还大 → 只接受「同文件同科目里
    # 已确认的 T 的唯一前缀补全」（实测 4.18 口语 "of 1" → of 11），否则整条丢掉。
    good = {}
    for a in raw:
        if a["section"] and a["total"] in VALID_TOTALS and a["start"] <= a["total"]:
            good.setdefault(a["section"], set()).add(a["total"])
    out = []
    for a in raw:
        if not a["section"]:
            continue
        if a["total"] in VALID_TOTALS and a["start"] <= a["total"]:
            out.append(a)
            continue
        cand = [t for t in sorted(good.get(a["section"], ()))
                if t >= a["start"] and str(t).startswith(str(a["total"]))]
        if len(cand) == 1:
            a["why"] = (f"of-{a['total']} 与题号 {a['start']} 矛盾，"
                        f"按同文件同科目唯一候选补全为 of-{cand[0]}")
            a["total"] = cand[0]
            out.append(a)
    for a in out:
        a["section_inferred"] = not a["exact"]
    return out

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
    for a in find_anchors(text):
        counts[a["section"]] += 1
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
    marks = find_anchors(text)
    blocks = []
    for i, a in enumerate(marks):
        body_start = a["body_start"]
        body_end = max(body_start, marks[i + 1]["pos"]) if i + 1 < len(marks) else len(text)
        end = max(a["start"], a["end"])
        blocks.append({
            "section": a["section"],
            "start": a["start"],
            "end": end,
            "total": a["total"],
            "body": strip_watermark(text[body_start:body_end]).strip(),
            "section_inferred": a["section_inferred"],
            "anchor_note": a["why"],
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
    # 加试段的别名实测远不止「加试」：`第二部份`(2.8)、`另一套加试`(3.24)、`加试1a 2a…`
    # (3.4，表头与第一条答案挤在同一行)。别名漏一个 = 整块 15 条答案静默丢失。
    # 尾巴单独捕成 rest：3.4 那种「表头+答案同一行」要把余下的部分当答案行接着解析，
    # 整行吞掉就丢 15 条；而「听力 q4-6 题目缺失」「写作A」这类尾巴过一遍 NUM_ANS
    # 抽不出任何答案，不会有副作用。
    # 「答案」：5.18 卷答案页把阅读段表头直接写成文件标题「答案」（听力/写作/口语
    # 段照常）。只在**尚未出现任何科目表头**时把它当阅读；其后再出现一律视作普通行，
    # 避免正文里的「答案」字样误触发换科。
    r"(?P<cn>阅读|听力|写作|口语|答案|另一套加试|加试二|第二部分|第二部份|第二套|另一套|"
    r"加试|附加|额外)\s*[:：]?\s*(?P<rest>\S.*)?"
    # 英文分支与光杆 Module 分支保持整行严格匹配（放宽会误伤正文里的英文行）
    r"|(?:(?P<en>Reading|Listening|Writing|Speaking)\s*[,，]?\s*(?:module\s*(?P<mod>\d+))?"
    # 光杆 "Module2:"（不带科目名）也是换 module 的信号。实测 1.21A 的答案页就是
    # 「Reading, Module1: … Module2: …」这种写法；漏掉它会让 module2 的答案灌进
    # module1 的字典里**覆盖掉前 15 题的正确答案** —— 题目照常显示、答案静默变错，
    # 该卷盲审因此只有 63%。
    r"|(?P<mod_only>(?:module|part)\s*(?P<mod2>\d+)))\s*[:：]?"
    r")\s*$",
    re.I,
)
CN_SECTION = {"阅读": "reading", "听力": "listening", "写作": "writing", "口语": "speaking"}
EXTRA_MODULE = ("加试", "附加", "额外", "另一套加试", "加试二", "第二部分", "第二部份",
                "第二套", "另一套")
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
    """产出 (行号, 原行, 科目 或 None, 是否加试, 表头后剩下的正文)。

    科目 None 且非加试 = 不是表头行。rest 只有中文表头分支会给（英文分支保持整行
    严格匹配），用来接住「加试1a 2a 3b…」这种表头与答案挤在同一行的排版。
    """
    seen_section = False
    for idx, raw in enumerate(strip_watermark(text).splitlines()):
        h = SEC_HEADER.match(raw.strip())
        if not h:
            yield idx, raw, None, False, ""
            continue
        cn, en, mod_only = h.group("cn"), h.group("en"), h.group("mod_only")
        rest = (h.group("rest") or "").strip() if cn else ""
        if cn == "答案":
            if seen_section:
                yield idx, raw, None, False, ""
                continue
            cn = "阅读"
        if cn or en:
            seen_section = True
        if cn in EXTRA_MODULE:
            yield idx, raw, None, True, rest
        elif cn:
            yield idx, raw, CN_SECTION[cn], False, rest
        elif mod_only:
            # 光杆 Module N / Part N：沿用当前科目，另起一个 module（与「加试」同义）
            yield idx, raw, None, True, ""
        else:
            yield idx, raw, en.lower(), int(h.group("mod") or 1) > 1, ""


def _restart_warning(sink, section, line_no, raw):
    """记一条「无科目头的题号重启块」告警。sink 为 None 时静默丢弃。"""
    if sink is None:
        return
    sink.append({
        "section": section,
        "line": line_no,
        "sample": raw.strip()[:80],
        "message": (f"答案页第 {line_no + 1} 行出现无科目头的题号重启块"
                    f"（上一个科目 {section}），已扣下开孤儿块待题号形状推断："
                    f"{raw.strip()[:60]}"),
    })


def parse_answer_pdf_with_warnings(text):
    """同 parse_answer_pdf，另外返回 (解析告警, 无科目头的孤儿块)。

    告警只保留**最终被采用的那个排版解析器**在该科目上产生的那些——
    落选解析器的告警是噪音，不该吓唬调用方。孤儿块整体取答案更多的那个解析器的，
    因为孤儿块没有科目、没法逐科挑。
    """
    w_inline, w_linewise = [], []
    o_inline, o_linewise = [], []
    inline = _parse_inline(text, w_inline, o_inline)
    linewise = _parse_linewise(text, w_linewise, o_linewise)
    picked, warnings = {}, []
    for sec in SECTIONS:
        a, b = inline.get(sec, []), linewise.get(sec, [])
        if sum(len(m) for m in a) >= sum(len(m) for m in b):
            picked[sec], src = a, w_inline
        else:
            picked[sec], src = b, w_linewise
        warnings.extend(w for w in src if w["section"] == sec)
    n_inline = sum(len(m) for v in inline.values() for m in v)
    n_linewise = sum(len(m) for v in linewise.values() for m in v)
    orphans = o_inline if n_inline >= n_linewise else o_linewise
    return picked, warnings, orphans


def parse_answer_pdf(text):
    """答案 PDF 文本 → {section: [module0, module1, ...]}，module 为 {题号: 答案}。

    同一科目里遇到「加试 / Module2」就开新 module。两种排版都跑一遍，
    取抓到答案更多的那个结果——答案条数是可验证的客观量，不是偏好。
    """
    return parse_answer_pdf_with_warnings(text)[0]


def _new_chain(orphans, prev_sec, line_no):
    """开一条「无科目头」的孤儿链：它后面跟的「加试」也一起挂进来。"""
    chain = {"prev_sec": prev_sec, "next_sec": None, "line": line_no, "modules": []}
    if orphans is not None:
        orphans.append(chain)
    return chain


def _parse_inline(text, warnings=None, orphans=None):
    """排版 A：编号与答案同一行（`1has 2wheels ... 21c`）。"""
    out = {s: [] for s in SECTIONS}
    cur_sec, cur_mod, chain = None, None, None

    def feed(line, idx):
        """把一行答案灌进当前 module；遇到题号重启就切到孤儿块继续灌。"""
        nonlocal cur_sec, cur_mod, chain
        if cur_mod is None:
            return
        pairs = NUM_ANS.findall(line)
        i = 0
        while i < len(pairs):
            n = int(pairs[i][0])
            if _is_restart(n, cur_mod):
                # 不再整块丢弃：开一个「无科目头」的孤儿 module，本行剩下的继续灌进去，
                # 科目留到最后用题号形状与题块组比对来推断（唯一命中才采用）。
                _restart_warning(warnings, cur_sec, idx, line)
                if chain is None:
                    chain = _new_chain(orphans, cur_sec, idx)
                cur_sec = None
                cur_mod = {}
                chain["modules"].append(cur_mod)
                continue
            a = _norm_answer(pairs[i][1])
            if a:
                cur_mod[n] = a
            i += 1

    for idx, raw, sec, extra, rest in _headers(text):
        if sec or extra:
            if sec:
                if chain is not None:
                    chain["next_sec"] = sec
                    chain = None
                cur_sec, cur_mod = sec, {}
                out[sec].append(cur_mod)
            elif chain is not None:          # 孤儿链里的「加试」：仍然没科目，挂在链上
                cur_mod = {}
                chain["modules"].append(cur_mod)
            elif cur_sec:
                cur_mod = {}
                out[cur_sec].append(cur_mod)
            else:
                cur_mod = None
            if rest:
                feed(rest, idx)              # 表头与第一条答案挤在同一行（3.4 听力加试）
            continue
        feed(raw, idx)
    return {s: [m for m in v if m] for s, v in out.items()}


def _parse_linewise(text, warnings=None, orphans=None):
    """排版 B：一行纯数字，下一行是答案。"""
    lines = strip_watermark(text).splitlines()
    out = {s: [] for s in SECTIONS}
    cur_sec, cur_mod, chain = None, None, None
    header_rows = {}
    for idx, raw, sec, extra, _rest in _headers(text):
        if sec or extra:
            header_rows[idx] = (sec, extra)
    idx = 0
    while idx < len(lines):
        if idx in header_rows:
            sec, _extra = header_rows[idx]
            if sec:
                if chain is not None:
                    chain["next_sec"] = sec
                    chain = None
                cur_sec, cur_mod = sec, {}
                out[sec].append(cur_mod)
            elif chain is not None:
                cur_mod = {}
                chain["modules"].append(cur_mod)
            elif cur_sec:
                cur_mod = {}
                out[cur_sec].append(cur_mod)
            idx += 1
            continue
        a = lines[idx].strip()
        b = lines[idx + 1].strip() if idx + 1 < len(lines) else ""
        if cur_mod is not None and re.fullmatch(r"\d{1,2}", a) and b and not re.fullmatch(r"\d{1,2}", b):
            if _is_restart(int(a), cur_mod):
                _restart_warning(warnings, cur_sec, idx, f"{a} / {b}")
                if chain is None:
                    chain = _new_chain(orphans, cur_sec, idx)
                cur_sec = None
                cur_mod = {}
                chain["modules"].append(cur_mod)
                continue
            if not WATERMARK.search(b):
                cur_mod[int(a)] = _norm_answer(b)
            idx += 2
            continue
        idx += 1
    return {s: [m for m in v if m] for s, v in out.items()}


# ── 3b. 无科目头的整块答案 → 按题号形状定科 ────────────────────────────────
# 答案页实测的科目顺序：阅读 → 听力 → 写作 → 口语（3.29/4.18/2.8/3.4/3.24 一致）。
ANSWER_ORDER = ("reading", "listening", "writing", "speaking")


def _order_ok(chain, section):
    """无头块只能落在「上一个有头科目」与「下一个有头科目」之间（含端点——
    同科另起一个 module 也是合法解，实测 4.18 就是听力加试段没写表头）。"""
    i = ANSWER_ORDER.index(section)
    prev, nxt = chain.get("prev_sec"), chain.get("next_sec")
    if prev and ANSWER_ORDER.index(prev) > i:
        return False
    if nxt and ANSWER_ORDER.index(nxt) < i:
        return False
    return True


def _shapes_fit(shape, free):
    """链里每一块的最大题号，是否都能对上该科一个**还没有答案**的题块组 of-N。"""
    pool = list(free)
    for mx, cnt in shape:
        if mx not in pool or cnt > mx:
            return False
        pool.remove(mx)
    return True


def resolve_orphan_chains(orphans, answer_modules, blocks):
    """把答案页里「没写科目名」的整块答案定科（B1），并逐条留痕。

    三条判据全部满足、且**唯一**命中才采用；否则继续扣下，把候选写进留痕给人看。
    旧实现是直接丢弃 + 一条没人看的 warning，实测 3.29 整个听力 47 条答案就这么没的。
    """
    notes = []
    groups = {s: sorted({b["total"] for b in blocks if b["section"] == s}) for s in SECTIONS}
    for ch in orphans:
        mods = [m for m in ch["modules"] if m]
        if not mods:
            continue
        shape = [(max(m), len(m)) for m in mods]
        shape_txt = "、".join(f"of-{mx}({cnt}条)" for mx, cnt in shape)
        where = (f"上一个有头科目={ch.get('prev_sec') or '无'}，"
                 f"下一个有头科目={ch.get('next_sec') or '无'}")
        cands = [s for s in SECTIONS if _order_ok(ch, s)
                 and _shapes_fit(shape, [n for n in groups[s]
                                         if n not in {max(m) for m in answer_modules[s] if m}])]
        if len(cands) == 1:
            sec = cands[0]
            first = len(answer_modules[sec]) + 1
            answer_modules[sec].extend(mods)
            span = (f"module{first}" if len(mods) == 1
                    else f"module{first}-{first + len(mods) - 1}")
            notes.append({
                "adopted": True, "section": sec, "line": ch["line"], "modules": len(mods),
                "answers": sum(len(m) for m in mods),
                "message": (f"答案页第 {ch['line'] + 1} 行起有 {len(mods)} 块答案没写科目头，"
                            f"按题号形状（{shape_txt}）唯一推断为 {sec} {span}（{where}）"
                            f"，已采用——请人工确认"),
            })
        else:
            notes.append({
                "adopted": False, "section": None, "line": ch["line"], "modules": len(mods),
                "answers": sum(len(m) for m in mods),
                "message": (f"答案页第 {ch['line'] + 1} 行起有 {len(mods)} 块答案没写科目头，"
                            f"题号形状（{shape_txt}）在 {where} 的约束下"
                            + (f"有 {len(cands)} 个候选科目 {cands}" if cands else "没有候选科目")
                            + f"，无法唯一确定 → 继续扣下（共 "
                              f"{sum(len(m) for m in mods)} 条答案），请人工指认"),
            })
    return notes


# ── 4. 硬对齐 ───────────────────────────────────────────────────────────────
# 「章节说明屏」：考试每个 section 开头的须知页，也顶着 "Question 13 of 32" 的页眉，
# 于是会伪装成一道题。它没有题干也没有选项，必须排到候选末位。
DIRECTIONS = re.compile(
    r"you will listen only one time|in an actual test|the clock will indicate|"
    r"directions|you will (?:now )?(?:begin|hear)|answer questions about",
    re.I,
)


# 「本来就没有书面答案」的题块组，自检时要放过：写作 of-2 是邮件 + 学术讨论，
# 按考试设计就没有标准答案（53 套全都如此，见源库体检报告 6.3）。
BY_DESIGN_ANSWERLESS = frozenset({("writing", 2)})


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

    # 第三趟：某科**恰好 1 个答案 module + 恰好 1 个题块组**时直接路由。
    # 这时不存在「路由错组」的可能（没有第二个候选），所以不必再要求题号重叠度——
    # 口语 of-11 只有 7 条复述答案，pass-1 的精确匹配永远不成立；只要丢 2 个页眉
    # （5/7=71% < 80%）pass-2 也不成立，整科就 blocked（实测 3.16 / 4.18）。
    if len(answer_modules) == 1 and len(groups) == 1 and route.get(0, (None,))[0] is None:
        only_total = next(iter(groups))
        ans = answer_modules[0]
        if only_total not in used and max(ans) <= only_total:
            route[0] = (only_total, f"该科只有 1 个答案 module 与 1 个题块组"
                                    f"（of-{only_total}），无可混淆对象")
            used.add(only_total)

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

    # 自检：答案 module 数 < 题块组数 = 有整块题干压根没有对应的答案段。
    # 实测 3.4 听力加试的 15 条答案被「表头吞整行」静默吃掉时，align 只报 partial
    # 不报警，没人会去看——这种静默缺口必须顶到 blockers 上。
    self_check = []
    expected = [n for n in sorted(groups) if (section, n) not in BY_DESIGN_ANSWERLESS]
    if len(answer_modules) < len(expected):
        self_check.append(
            f"{section}: 答案只解析出 {len(answer_modules)} 个 module，题块却有 "
            f"{len(expected)} 组（of-{expected}，其中 of-{orphan} 没有答案）——"
            f"要么源里就缺这段答案，要么答案页表头没被认出，请人工看一眼答案页")
    return {"status": status, "modules": mods,
            "matched_count": sum(len(m["matched"]) for m in mods), "note": note,
            "stem_groups": sorted(groups), "orphan_groups": orphan,
            "self_check": self_check}
