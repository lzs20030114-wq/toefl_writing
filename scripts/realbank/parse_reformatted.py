# -*- coding: utf-8 -*-
"""
真题录入（重排版格式）—— 确定性解析器，零 LLM。

第二来源的商家把每套真题重新排版成了 4+1 份**文字原生 docx**
（Reading / Listening / Speaking / Writing + Answers），题干、选项、答案全都是可选中的文本，
不再是旧源那种整页截图。所以这一支不需要 OCR→DeepSeek 语义结构化那条贵链路：
**版式本身就是结构**，正则就能把它拆干净，且完全可复现、零 token。

产物刻意长成旧链路的样子 —— `.codex-tmp/realbank/<setkey>.structured.json`，schema 与
scripts/realbank/structure_set.mjs 的输出逐字段对齐，因此
`audit_answers.mjs`（盲审）与 `build_bank.mjs`（落库）几乎零改动就能消费。

几条硬约定：

1. **setkey 用 `rf` 前缀**（rf0610 / rf0615 …）。旧源的 setkey 是中文卷名，两套 key
   空间必须不相交，否则 build_bank 汇总 .codex-tmp 时会互相盖。

2. **听力/口语只解析、不落库**：它们的题面依赖逐题 mp3，本期不处理音频，所以这些
   result 的 status 一律 `deferred`。audit_answers 与 build_bank 都只看 `status === "ok"`，
   于是它们天然被两边跳过 —— 不是靠谁记得加过滤，是靠状态位。

3. **fail-soft**：缺文件、缺 section、答案对不上，一律记 problem 继续，绝不整套崩。
   状态位沿用旧链路的三档：ok / flagged（有问题，不落库）/ deferred。

4. **图片内容只读 OCR 缓存**：RDL 材料截图与图片版 Answers 的文字来自
   `.codex-tmp/ocr/`（由 scripts/realbank/ocr_images.py 预先生成）。本脚本**不联网**，
   缓存没有就记 problem —— 保证解析结果确定、可复现、不产生意外费用。

用法:
  python scripts/realbank/parse_reformatted.py "<套题文件夹>"
  python scripts/realbank/parse_reformatted.py "<套题文件夹>" --dry     # 只打印统计不写盘
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import audio_names  # noqa: E402  （同目录脚本：逐题音频文件名的读法）
import ocr_images  # noqa: E402  （同目录脚本：只用它的缓存读取与 setkey 规则）

REPO_ROOT = os.path.dirname(os.path.dirname(_HERE))
OUT_DIR = os.path.join(REPO_ROOT, ".codex-tmp", "realbank")
PARSER_ID = "reformatted-parser-v1"
TIER = "recalled"

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
RELNS = "{http://schemas.openxmlformats.org/package/2006/relationships}"

LETTERS = "ABCDEFGH"


# ══ docx 读取 ══════════════════════════════════════════════════════════════
class Para:
    __slots__ = ("text", "images", "in_table", "i", "ocr_sourced")

    def __init__(self, text: str, images: list[int], in_table: bool, i: int):
        self.text = text
        self.images = images
        self.in_table = in_table
        self.i = i
        self.ocr_sourced = False

    def __repr__(self):
        return f"<P{self.i}{'T' if self.in_table else ''} imgs={self.images} {self.text[:40]!r}>"


def _media_ordinals(z: zipfile.ZipFile) -> dict[str, int]:
    """rId → 图序（与 ocr_images.docx_images 的排序口径必须一致，否则缓存对不上）。"""
    names = [n for n in z.namelist() if n.startswith("word/media/")]

    def sort_key(n: str):
        m = re.search(r"(\d+)", os.path.basename(n))
        return (int(m.group(1)) if m else 0, n)

    order = {os.path.basename(n): i for i, n in enumerate(sorted(names, key=sort_key), start=1)}
    out: dict[str, int] = {}
    try:
        rels = ET.fromstring(z.read("word/_rels/document.xml.rels"))
    except KeyError:
        return out
    for rel in rels:
        target = os.path.basename(rel.get("Target") or "")
        if target in order:
            out[rel.get("Id")] = order[target]
    return out


def read_docx(path: str) -> list[Para]:
    """按文档顺序摊平成段落列表，保留表格归属与图片锚点。

    刻意直接读 word/document.xml 而不用 python-docx 的 `doc.paragraphs`：后者会漏掉
    表格里的段落，而这批 docx 有一半的阅读材料/写作题面就装在表格里。
    """
    with zipfile.ZipFile(path) as z:
        rid2ord = _media_ordinals(z)
        root = ET.fromstring(z.read("word/document.xml"))
    out: list[Para] = []

    def walk(node, in_table: bool):
        for ch in node:
            if ch.tag == W + "p":
                txt = "".join(t.text or "" for t in ch.iter(W + "t"))
                # 排版软件的弯引号会让「模板里的固定词」和「答案句里的同一个词」在字符层面
                # 对不上（I don’t vs I don't），造句题因此整题作废 —— 先统一成直引号。
                txt = (txt.replace("\xa0", " ").replace("–", "-").replace("—", "-")
                          .replace("’", "'").replace("‘", "'")
                          .replace("“", '"').replace("”", '"'))
                imgs = []
                for blip in ch.iter(A + "blip"):
                    rid = blip.get(R + "embed") or blip.get(R + "link")
                    if rid in rid2ord:
                        imgs.append(rid2ord[rid])
                out.append(Para(txt.strip(), imgs, in_table, len(out)))
            elif ch.tag == W + "tbl":
                walk(ch, True)
            else:
                walk(ch, in_table)

    walk(root, False)
    return out


# ══ 小工具 ════════════════════════════════════════════════════════════════
# ══ 文档来源解析（docx 文字 / docx 图 OCR / PDF 页 OCR）═══════════════════
#
# 第一波 8 套的每个 section 都是一份文字原生 `Reading.docx`，所以原来是「按精确文件名
# 找 docx」。第二波源料退化出三种形态，必须统一收口：
#   A) 文字原生 docx —— 老路径，逐字不变；
#   B) 图片版 docx（正文几乎没字，内容全在内嵌图里）—— 读 OCR 缓存；
#   C) 图片版 PDF（整份没有文字层）—— 读 OCR 缓存（ocr_images 逐页渲染后转写）。
#
# 三种形态最后都摊平成同一个 `list[Para]`，下游的 section 解析器一行都不用改。
# 本模块**绝不联网**：缓存没有就记 problem，让人先去跑 ocr_images.py。

SECTION_ALIASES = {
    "reading": ["reading", "阅读"],
    "listening": ["listening", "听力"],
    "speaking": ["speaking", "口语"],
    "writing": ["writing", "写作"],
    "answer": ["answer", "答案"],
}
# 正文词数低于此值的 docx 判定「内容在图里」（与 ocr_images.THIN_DOCX_WORDS 同口径）。
THIN_DOCX_WORDS = 300

# 「题池」模式（--pool）：第二波里有一批「国内线下」拼盘 —— 不是完整一卷，
# 阅读 38~45 题、写作 1500~2800 词、听力只有零星讲座、口语题号自成一套。
# 这些不按「整卷」收，按题型能收多少收多少：
#   · setkey 前缀 rp（与整卷模式的 rf 分开，id/缓存/去重都不相撞）；
#   · 每道题带 vendor_pool(warn) 源料标记，前端与盲审都知情；
#   · 听力若整组没有音频，只要文档逐字稿词数达标就直接拿文档当逐字稿。
POOL_MODE = False
# 无音频听力「文档逐字稿够不够用」的门槛（词），与 merge 阶段的节选判据同口径。
POOL_TRANSCRIPT_MIN = {"lat": 150, "lc": 60, "la": 40, "lcr": 20, "listening_mcq": 60}


def _ocr_note(origin: str, fn: str) -> list[str]:
    """题面来自图片 OCR 时的机器可读记号（build_bank 的 source_notes 认 `code: 详情` 这个形状）。"""
    if origin != "ocr":
        return []
    return [f"ocr_sourced: 题面来自 {fn} 的图片 OCR 转写，需人工抽检"]


def _section_candidates(folder: str, section: str) -> list[str]:
    keys = SECTION_ALIASES[section]
    other = [k for s, ks in SECTION_ALIASES.items() if s != section and s != "answer" for k in ks]
    hits = []
    if not os.path.isdir(folder):
        return hits
    for fn in sorted(os.listdir(folder)):
        if fn.startswith("~$"):
            continue
        low = fn.lower()
        if not (low.endswith(".docx") or low.endswith(".pdf")):
            continue
        if not any(k in low for k in keys):
            continue
        # 「Answers」这份不是任何做题 section 的题面；反过来 answer 段也不该收题面文档。
        if section != "answer" and any(k in low for k in SECTION_ALIASES["answer"]):
            continue
        hits.append(fn)
    if not hits:
        return []
    # 命中多份时优先「专用文档」（文件名里只提到本 section），再优先 docx。
    def rank(fn: str):
        low = fn.lower()
        mixed = sum(1 for k in other if k in low)
        return (mixed, 0 if low.endswith(".docx") else 1, fn)

    return sorted(hits, key=rank)


def _ocr_paras(setkey: str, path: str, problems: list[str], label: str) -> list[Para] | None:
    """从 OCR 缓存拼 Para 列表。缓存缺失记 problem 返回 None。"""
    base = ocr_images.cache_base(os.path.basename(path))
    cache = ocr_images.cached_texts(setkey, base)
    if not cache:
        problems.append(f"{os.path.basename(path)} 是图片版（{label}）且没有 OCR 缓存 —— 先跑 "
                        f"`python scripts/realbank/ocr_images.py \"{os.path.dirname(path)}\"`")
        return None
    total = ocr_images.source_image_count(path)
    missing = [i for i in range(1, total + 1) if i not in cache]
    if missing:
        problems.append(f"{os.path.basename(path)} 有 {len(missing)} 张图没有 OCR 缓存"
                        f"（img{missing[:8]}{'…' if len(missing) > 8 else ''}），内容可能不全")
    out: list[Para] = []
    for i in sorted(cache):
        for line in cache[i].splitlines():
            # OCR prompt 要求表格用 " | " 分列，Qwen 有时改吐制表符（8.08/8.26 的答案页）。
            # 不归一化的话「Q1 \t D \t Q17 \t A」会被当成一个整体，答案解析成
            # 「D Q17 A」这种非单字母，整张答案表作废。
            line = re.sub(r"[ \t]*\t[ \t]*", " | ", line)
            line = (line.replace("\xa0", " ").replace("–", "-").replace("—", "-")
                        .replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')).strip()
            out.append(Para(line, [], False, len(out)))
    return out


def resolve_doc(folder: str, setkey: str, section: str, problems: list[str]):
    """section → (paras, origin, filename)。找不到任何来源时返回 (None, None, None)。"""
    cands = _section_candidates(folder, section)
    if not cands:
        return None, None, None
    # 先看有没有「文字够用的 docx」；有就直接用（第一波的行为逐字不变）。
    for fn in cands:
        if not fn.lower().endswith(".docx"):
            continue
        paras = read_docx(os.path.join(folder, fn))
        total_words = sum(nwords(p.text) for p in paras)
        n_images = sum(len(p.images) for p in paras)
        # 「内容在图里」的判定必须同时看字数和图数：第一波的 Speaking.docx 只有 1 张示意图、
        # 正文 130–250 词，仍是文字原生；截图套壳的 docx 是 0 字 + 几十张图。
        # 没有内嵌图的 docx 无论多短都只能按文字读（没有别的可读）。
        is_thin = n_images > 0 and (total_words < 60 or (n_images >= 5 and total_words < THIN_DOCX_WORDS))
        if not is_thin:
            return paras, "docx", fn
    # 退而求其次：图片版（docx 内嵌图 / PDF 页）走 OCR 缓存。
    for fn in cands:
        path = os.path.join(folder, fn)
        label = "PDF 整份是截图" if fn.lower().endswith(".pdf") else "docx 正文在图里"
        paras = _ocr_paras(setkey, path, problems, label)
        if paras:
            for p in paras:
                p.ocr_sourced = True
            return paras, "ocr", fn
    return None, None, cands[0]


def words(s: str) -> list[str]:
    return [w for w in str(s or "").strip().split() if w]


def nwords(s: str) -> int:
    return len(words(s))


def norm_word(s: str) -> str:
    return re.sub(r"[^a-z0-9']", "", str(s or "").lower().replace("’", "'").replace("‘", "'"))


BOILERPLATE = re.compile(
    r"^(TOEFL\s+(Reading|Listening|Speaking|Writing|Answers)|Your Response|Class Discussion|"
    r"Cut\s+Paste|Hide (Word Count|Time)|Question \d+ of \d+|Writing \| Question|"
    r"Reading \| Question|Listening \| Question|Speaking \| Question|"
    r"An effective response will contain|In your response, you should do the following|"
    r"Write as much as you can|Where would the sentence best fit|Selected sentence:|"
    r"Express and support your opinion|Make a contribution to the discussion)",
    re.I,
)

UNDERLINE_ONLY = re.compile(r"^[_\s.·•\-]*$")


def is_noise(t: str) -> bool:
    if not t:
        return True
    if UNDERLINE_ONLY.match(t):
        return True
    if BOILERPLATE.match(t):
        return True
    return False


TOPIC_KEYWORDS = [
    ("biology", r"\b(biolog|cell|species|organism|ecosystem|tortoise|pangolin|bird|wetland|coral|reef|animal|plant)"),
    ("astronomy", r"\b(astronom|galax|planet|cosmic|universe|telescope|stellar)"),
    ("geology", r"\b(geolog|earthquake|volcan|rock|mineral|seismic|microseism|core of the earth|delta)"),
    ("history", r"\b(histor|ancient|medieval|roman|empire|archaeolog|civilizat)"),
    ("art", r"\b(art\b|painting|surreal|playwriting|theatre|theater|museum|exhibit)"),
    ("music", r"\b(music|baroque|composer|melod|instrument)"),
    ("technology", r"\b(technolog|comput|software|algorithm|digital|expert system|machine learning|engineering|robot)"),
    ("chemistry", r"\b(chemi|molecul|compound|crystal|biochem)"),
    ("physics", r"\b(physic|gravit|光|polarized light|quantum|optic)"),
    ("environment", r"\b(environment|climate|pollution|renewable|conservation|sustainab)"),
    ("sociology", r"\b(sociolog|social role|society|community|behavio)"),
    ("linguistics", r"\b(linguist|language|syntax|morpholog)"),
    ("philosophy", r"\b(philosoph|free will|determinism|libertarian|ethic)"),
    ("health", r"\b(health|medic|disease|antimicrob|patient|public health)"),
    ("education", r"\b(educat|student|classroom|curricul|teaching)"),
    ("economics", r"\b(econom|market|trade|business|marketing|consumer)"),
]


def guess_topic(text: str) -> str:
    blob = str(text or "").lower()
    for name, pat in TOPIC_KEYWORDS:
        if re.search(pat, blob):
            return name
    return "other"


# ══ 答案页解析 ════════════════════════════════════════════════════════════
SECTION_HEAD = re.compile(r"^(Reading|Listening|Speaking|Writing)\s+Answers\b", re.I)
MODULE_IN_LINE = re.compile(r"\bModule\s*(\d)\b", re.I)


class AnswerKey:
    """一套卷的全部答案，按科目/题型摊平。

    CTW（填词）与 MCQ 混在同一批 `... : ...` 行里，判据是冒号右边的形态：
    `Q21 B; Q22 C` 这种「题号 + 单字母」是选择题，`had; wheels; place` 这种是填词。
    刻意不靠 header 文案（"Multiple Choice" / "Fill-in-the-Blank" / "Q1-Q10" 三套写法都有），
    靠内容形态更稳。
    """

    def __init__(self):
        self.reading_ctw: list[dict] = []      # [{module, order, words:[...], header}]
        self.reading_mcq: dict[tuple, str] = {}   # (module, q) → letter
        self.listening_mcq: dict[tuple, str] = {}
        self.bs: dict[int, str] = {}           # 造句题号 → 完整句子
        self.repeat: dict[int, str] = {}       # 复述题号 → 原句
        self.interview: dict[int, str] = {}    # 兼容字段 = interview_answer
        self.interview_stem: dict[int, str] = {}     # 面试题号 → 题干（问句）
        self.interview_answer: dict[int, str] = {}   # 面试题号 → 参考答案
        self.transcripts: list[dict] = []
        self.problems: list[str] = []
        self.raw_lines: list[str] = []


def _split_semis(body: str) -> list[str]:
    # 刻意**不**剥句末标点：造句/复述的答案就是整句，剥掉问号会让 realBank 的
    # has_question_mark 判错（拼出来的句子少个问号，用户看着就是错的）。
    # 需要剥的只有「单字母选项 + 尾点」和填词答案，各自在用的地方剥。
    parts = [p.strip() for p in re.split(r"[;；]", body)]
    return [p for p in parts if p]


# 答案页有三种形态，同一套里还会混用，所以解析按「表头 + 数据行」两段式做，
# 而不是逐行硬匹配某一种写法：
#   A) 文本 docx 的行内式：`Reading Module 1 Multiple Choice: Q21 B; Q22 A; …`
#   B) 图片版 OCR 出来的表格式：表头独占一行，后面是 `Q1 | It | Q6 | and` 双栏行
#   C) 裸词序列：`Reading Module 1 Q1-Q10: allows; to; insights; …`（填词，靠顺序对位）
_H_CTW = re.compile(r"(Complete the Words|Fill[- ]in[- ]the[- ]Blanks?|Missing Letters)", re.I)
_H_MCQ = re.compile(r"(Multiple Choice|Academic)", re.I)
_H_RANGE = re.compile(r"Q?(\d+)\s*-\s*Q?(\d+)")
_ROW_CELL = re.compile(r"^Q?(\d+)$")


def classify_header(h: str, section: str | None, cur_module: int = 1, zone_seq: dict = None):
    """一行是不是表头？是的话返回 (kind, module, q_start)。

    `cur_module` 是「最近一次见到的 Module N」。图片版答案页常把上下文拆成两行
    （`Reading Module 1` 独占一行，下一行才是 `Fill-in-the-Blank Q1-Q10`），
    第二行自己不带 module —— 不继承上下文就会把整个 module 的答案糊成一坨。
    """
    t = re.sub(r"\s+", " ", h).strip().strip(":：")
    if not t or len(t) > 90:
        return None
    mm = MODULE_IN_LINE.search(t)
    module = int(mm.group(1)) if mm else None
    rng = _H_RANGE.search(t)
    if rng:
        q_start = int(rng.group(1))
    else:
        # `Sentence Construction Q3` / `Fill-in-the-Blank 2` 这类单题号表头：没有区间就取
        # 表头里最后一个 Qn 当起点，否则整份答案会全部压到 Q1 上互相覆盖。
        solo = re.findall(r"Q(\d+)", t)
        q_start = int(solo[-1]) if solo else 1
    if re.match(r"^Sentence Construction", t, re.I):
        return ("bs", module or 1, q_start)
    if SPEAK_ZONE_REPEAT.match(t) or SPEAK_ZONE_INTERVIEW.match(t):
        # 口语两块的排版有四五种（编号行 / 单列表 / 双列表 / 一行两题 / 只有 Qn 没题干），
        # 通用「表头 + 数据行」两段式吃不下，交给 parse_speaking_zones 专门解析。
        return ("ignore", 1, 1)
    if re.match(r"^(Write an )?Email", t, re.I) or re.match(r"^Academic Discussion", t, re.I):
        return ("ignore", 1, 1)
    # 听力先判：`Listening Module 1` 这行在 section 还停留在 reading 时也必须归听力，
    # 否则整个听力答案会被算进阅读，把阅读的题号覆盖掉。
    if re.match(r"^Listening\b", t, re.I):
        return ("listening_mcq", module or 1, q_start)
    if section == "listening" and (module or re.match(r"^Module\s*\d", t, re.I)):
        return ("listening_mcq", module or cur_module, q_start)
    if POOL_MODE and section == "listening":
        mf = POOL_LISTEN_HEAD.match(t)
        if mf:
            return ("listening_mcq", int(mf.group(1)), 1)
    if section == "reading" or re.match(r"^Reading\b", t, re.I):
        # 分区表头要**最先**判：`Academic Reading 1 | Dinosaur Feathers` 会被 _H_MCQ 的
        # "Academic" 抢先吃掉，那样序号就丢了，一个分区里七篇的答案又糊回同一格。
        if POOL_MODE:
            mz = POOL_READ_ZONE.search(t)
            if mz:
                base = pool_zone_base(mz.group(1))
                # 表头带篇号就用它；不带（7.04 的 `Reading Module 2 Academic Reading: 标题`）
                # 就在本分区里顺着数 —— 题面那边没写篇号时也是顺着数的。
                if mz.group(2):
                    n = int(mz.group(2))
                else:
                    n = zone_seq.get(base, 0) + 1 if zone_seq is not None else 1
                if zone_seq is not None:
                    zone_seq[base] = n
                return ("reading_mcq", base + n, 1)
        if _H_CTW.search(t):
            return ("reading_ctw", module or cur_module, q_start)
        if _H_MCQ.search(t):
            return ("reading_mcq", module or cur_module, q_start)
        # 题池模式：拼盘常用 `Task 4 | Moon Phases` / `Form 02` 分节（8.30），不带 Module。
        # 不认这行的话十几段填词的答案会堆进同一块，空位数对不上、整科作废。
        mf = POOL_FORM_HEAD.match(t) if POOL_MODE else None
        if mf:
            return ("reading_auto", module or int(mf.group(1)), 1)
        if module:
            return ("reading_auto", module, q_start)
        # 光有 `Q11-Q15` 这种区间、没有任何关键词的行也算表头（6.29 就是这么排的），
        # 但必须整行只有区间，免得把正文句子里的 "Q1-Q10" 误当表头。
        if rng and re.match(r"^Q?\d+\s*-\s*Q?\d+$", t):
            return ("reading_auto", cur_module, q_start)
        # 题池模式：拼盘的答案页不写「Reading Module 1 Fill-in-the-Blank Q1-Q10」，
        # 直接拿文章标题当分节（7.18 的 `Craftsmanship as Art`）。没有这条的话整份
        # 阅读答案会糊成一块、CTW 的 order 永远对不上。判据收紧到「像标题」：
        # 首字母大写、≤8 词、不带数字/分隔符、不以句末标点收尾。
        if (POOL_MODE and section == "reading" and not rng and not module
                and "|" not in t and not re.search(r"\d", t)
                and not t.endswith((".", "?", "!", ",", ";", ":"))
                and 1 <= len(words(t)) <= 8 and t[:1].isupper()):
            return ("reading_auto", cur_module, 1)
        return None
    return None


# ── 口语两块的专用解析 ────────────────────────────────────────────────────
# 商家的「Listen and Repeat / Take an Interview」在 8 套里出现过五种排版：
#   A) `Q1. We serve coffee and tea at the main counter.`（标准编号行）
#   B) `Question | Answer` 单列表格
#   C) `Q1 | 句子 | Q5 | 句子` 双列表格（6.29 / 7.08）
#   D) `Q2. …。Q3. …` 一行挤两题（7.16 的截图接缝处）
#   E) `Take an Interview Q1 - Sample Response` 后面直接跟答案，题干在 Speaking.docx 里
# 通用累加器按「一行一条」吃，B/C/D 全漏；所以这里按 `Qn` 切分 + 跨行拼接单独解析一遍。
# 题号一律以行内 `Qn` 为准，没有 `Qn` 的行算上一题的续行（答案/长句换行都靠这条接回来）。
SPEAK_ZONE_REPEAT = re.compile(r"^(?:Task\s*\d+\s*[:：.\-–—]\s*)?Listen\s+and\s+Repeat\b", re.I)
SPEAK_ZONE_INTERVIEW = re.compile(r"^(?:Task\s*\d+\s*[:：.\-–—]\s*)?Take\s+an\s+Interview\b", re.I)
# 一行里第二个及以后的 `Qn.` 前面切开（行首那个不切，免得切出空块）
_Q_SPLIT = re.compile(r"(?<!^)(?=\bQ\s*\d+\s*[.:：、)]\s*\S)")
_Q_LEAD = re.compile(r"^Q?\s*(\d+)\s*[.:：、)]\s*(.*)$", re.S)
# `Response: ______` / `_____________` / `Q1. Response: ___` 都是留白，不是内容
_BLANK_LINE = re.compile(r"^(?:Q?\s*\d+\s*[.:：、)]\s*)?(?:Response\s*[:：]?\s*)?[_\s.]*$", re.I)
_SAMPLE_LEAD = re.compile(r"^(?:Sample\s+(?:Answer|Response)s?|Answer)\s*[:：]\s*", re.I)
_LEAVE_SPEAKING = re.compile(
    r"^(?:(?:Reading|Listening|Writing)\s+Answers\b|Listening\s+Transcript\b"
    r"|Sentence\s+Construction\b|(?:Write\s+(?:an?\s+)?)?Email\b|Academic\s+Discussion\b"
    r"|Write\s+for\s+an\s+Academic\s+Discussion\b)", re.I)


def _is_question_line(t: str) -> bool:
    """一段文字是「题干」还是「参考答案」。

    面试块里两者都可能出现在同一个 Qn 下（`Q1. <题干>` 换行 `<参考答案>`）。
    题干必带问号，但**不一定以问号收尾**（"…your work and personal life? Give details
    to explain your answer." 这种「问句 + 追加要求」在 8 套里占了 6 条）；
    参考答案是 90~120 词的陈述段落。所以用「含问号 + 词数上限」两条一起判 ——
    只看问号会把答案里那句反问也算成题干，只看句尾会漏掉上面那 6 条。
    """
    t = t.strip()
    if not t:
        return False
    return "?" in t and nwords(t) <= 70


def parse_speaking_zones(lines: list, ak: AnswerKey) -> None:
    """答案页里的口语两块 → ak.repeat / ak.interview_stem / ak.interview_answer。"""
    zone = None
    blocks: dict = {"repeat": {}, "interview": {}}   # zone → {n: [chunk, ...]}
    cur_n = None

    def add(kind: str, n: int, text: str):
        text = text.strip()
        if not text:
            return
        blocks[kind].setdefault(n, []).append(text)

    for raw in lines:
        t = re.sub(r"[ 	]+", " ", str(raw or "")).strip()
        if not t:
            continue
        mz = SPEAK_ZONE_REPEAT.match(t) or SPEAK_ZONE_INTERVIEW.match(t)
        if mz:
            zone = "repeat" if SPEAK_ZONE_REPEAT.match(t) else "interview"
            rest = t[mz.end():].strip(" :：-–—")
            # `Take an Interview Q3 - Sample Response`：表头自带题号，后面那段答案属于它
            solo = re.findall(r"Q\s*(\d+)", rest)
            rng = re.match(r"^Q?\s*\d+\s*-\s*Q?\s*\d+", rest)
            cur_n = int(solo[0]) if (solo and not rng) else None
            continue
        if zone is None:
            continue
        if _LEAVE_SPEAKING.match(t) or SECTION_HEAD.match(t):
            zone = None
            cur_n = None
            continue
        if _BLANK_LINE.match(t):
            continue
        if "|" in t:
            pairs = _row_pairs(t)
            if pairs:
                for n, v in pairs:
                    if n is None:
                        if cur_n is not None:
                            add(zone, cur_n, v)
                        continue
                    cur_n = n
                    add(zone, n, v)
                continue
        for chunk in _Q_SPLIT.split(t):
            chunk = chunk.strip()
            if not chunk or _BLANK_LINE.match(chunk):
                continue
            m = _Q_LEAD.match(chunk)
            if m:
                cur_n = int(m.group(1))
                add(zone, cur_n, m.group(2))
            elif cur_n is not None:
                add(zone, cur_n, chunk)                 # 跨行续写（长句/参考答案换行）

    for n, chunks in blocks["repeat"].items():
        sent = " ".join(chunks).strip()
        if nwords(sent) >= 3:
            ak.repeat[n] = sent
    for n, chunks in blocks["interview"].items():
        chunks = [_SAMPLE_LEAD.sub("", c).strip() for c in chunks]
        chunks = [c for c in chunks if c]
        if not chunks:
            continue
        if _is_question_line(chunks[0]):
            ak.interview_stem[n] = chunks[0]
            rest = " ".join(chunks[1:]).strip()
        else:
            rest = " ".join(chunks).strip()
        if nwords(rest) >= 8:
            ak.interview_answer[n] = rest
    ak.interview = dict(ak.interview_answer)


def _row_pairs(line: str) -> list:
    """一行数据 → [(题号 or None, 答案)]。覆盖表格双栏、行内分号、裸词序列。"""
    t = line.strip()
    if not t:
        return []
    if "|" in t:
        cells = [c.strip() for c in t.split("|")]
        if all(re.match(r"^(Question|Answer)$", c, re.I) for c in cells if c):
            return []
        out = []
        i = 0
        while i < len(cells):
            m = _ROW_CELL.match(cells[i])
            if m and i + 1 < len(cells):
                out.append((int(m.group(1)), cells[i + 1].strip()))
                i += 2
            else:
                i += 1
        return out
    # 「裸多栏」：答案表是 4 栏（Question|Answer|Question|Answer），但源里分隔符全丢了 ——
    # docx 表格被读成一段 `Q33 B Q34 D`，OCR 也常吐成这样。不认的话整行会被当成
    # 「Q33 的答案是『B Q34 D』」，一张答案表全废（7.04 / 8.08 实测）。
    # 判据收得很紧：整行必须是「Q数字 + ≤3 词」重复两次以上，长答案（含引用句）不受影响。
    if ";" not in t and "；" not in t and len(re.findall(r"(?<![A-Za-z0-9])Q\d+\b", t)) >= 2:
        segs = [s.strip() for s in re.split(r"(?<![A-Za-z0-9])(?=Q\d+\b)", t) if s.strip()]
        multi = []
        for s in segs:
            m = re.match(r"^Q(\d+)\s+([A-Za-z][A-Za-z'\-]*)$", s)
            if not m:
                multi = []
                break
            multi.append((int(m.group(1)), m.group(2)))
        if len(multi) >= 2:
            return multi
    out = []
    for part in _split_semis(t):
        m = re.match(r"^Q?(\d+)[.、)]?\s+(.+)$", part)
        if m:
            out.append((int(m.group(1)), m.group(2).strip()))
        else:
            out.append((None, part))
    return out


class _Acc:
    def __init__(self, kind: str, module: int, q_start: int, header: str):
        self.kind = kind
        self.module = module
        self.q_start = q_start
        self.header = header
        self.pairs: list = []


def parse_answers_lines(lines: list) -> AnswerKey:
    ak = AnswerKey()
    ak.raw_lines = list(lines)
    section = None
    acc = None
    ctw_order: dict = {}
    zone_seq: dict = {}      # 题池阅读分区（日常/学术）各自数到第几篇
    cur_module = 1
    transcript_mode = False
    cur_tr = None

    def flush():
        nonlocal acc
        if acc is None:
            return
        a, acc = acc, None
        if a.kind == "ignore" or not a.pairs:
            return
        kind = a.kind
        if kind == "reading_auto":
            letters = sum(1 for _, v in a.pairs if re.match(r"^[A-H]$", v.strip(), re.I))
            kind = "reading_mcq" if letters >= max(1, len(a.pairs) // 2) else "reading_ctw"
        numbered = [(q, v) for q, v in a.pairs if q is not None]
        if kind == "reading_ctw":
            ws = [v for _, v in sorted(numbered)] if numbered else [v for _, v in a.pairs]
            ws = [w.strip().strip(".,;:") for w in ws]      # 行末那个句点不是答案的一部分
            bad = any(not re.match(r"^[A-Za-z][A-Za-z'\-]*$", w) for w in ws)
            order = ctw_order.get(a.module, 0) + 1
            ctw_order[a.module] = order
            ak.reading_ctw.append({"module": a.module, "order": order, "words": ws,
                                   "header": a.header, "malformed": bad})
            return
        if kind in ("reading_mcq", "listening_mcq"):
            target = ak.reading_mcq if kind == "reading_mcq" else ak.listening_mcq
            n = a.q_start
            for q, v in a.pairs:
                qn = q if q is not None else n
                n = qn + 1
                v = v.strip().rstrip(".")
                if re.match(r"^[A-H]$", v, re.I):
                    target[(a.module, qn)] = v.upper()
                else:
                    ak.problems.append(
                        f"{kind} module{a.module} Q{qn} 答案不是单字母（源料给的是「{v[:50]}」）")
            return
        if kind in ("bs", "repeat", "interview"):
            store = {"bs": ak.bs, "repeat": ak.repeat, "interview": ak.interview}[kind]
            n = a.q_start
            for q, v in a.pairs:
                qn = q if q is not None else n
                n = qn + 1
                if nwords(v) >= 3:
                    store[qn] = v.strip()

    for raw in lines:
        t = re.sub(r"[ \t]+", " ", str(raw or "")).strip()
        if not t:
            continue
        m = SECTION_HEAD.match(t)
        if m:
            flush()
            section = m.group(1).lower()
            transcript_mode = False
            cur_tr = None
            continue
        if re.match(r"^Listening\s+Transcript\b", t, re.I):
            flush()
            transcript_mode = True
            cur_tr = None
            continue

        if transcript_mode:
            head = re.match(r"^(?:Listening\s+)?Module\s*(\d)\s*Q(\d+)(?:\s*-\s*Q?(\d+))?\s*\|\s*(.+)$",
                            t, re.I)
            if head:
                kt = head.group(4)
                cur_tr = {"module": int(head.group(1)), "q_start": int(head.group(2)),
                          "q_end": int(head.group(3) or head.group(2)),
                          "kind": kt.split(":")[0].strip(),
                          "title": kt.split(":", 1)[1].strip() if ":" in kt else "",
                          "lines": []}
                ak.transcripts.append(cur_tr)
                continue
            if re.match(r"^(Writing|Speaking|Reading) Answers", t, re.I):
                transcript_mode = False
            else:
                if cur_tr is None:
                    cur_tr = {"module": 1, "q_start": 1, "q_end": 12,
                              "kind": "Choose the Best Response", "title": "", "lines": []}
                    ak.transcripts.append(cur_tr)
                cur_tr["lines"].append(t)
                continue

        head_text, inline = t, None
        if ":" in t and "|" not in t.split(":", 1)[0]:
            head_text, inline = t.split(":", 1)
        cls = classify_header(head_text, section, cur_module, zone_seq)
        if cls:
            flush()
            cur_module = cls[1]
            acc = _Acc(cls[0], cls[1], cls[2], head_text.strip())
            if inline and inline.strip():
                acc.pairs.extend(_row_pairs(inline))
            continue
        if acc is not None:
            acc.pairs.extend(_row_pairs(t))

    flush()
    parse_speaking_zones(lines, ak)
    return ak



_CELL_QNO = re.compile(r"^Q\s*\d+$", re.I)
_CELL_HEAD = re.compile(r"^(Question|Answer)$", re.I)


def reflow_cell_lines(lines: list[str]) -> list[str]:
    """docx 表格被读成「一格一行」时，把 `Q1` 和它下一行的值拼回 `Q1 | 值`。

    read_docx 是按段落取文本的，多数套的答案表一行一段（`Q1 | precise | Q6 | fabricate`），
    但有几套（7.11 / 7.19）每个单元格自成一段 —— 那样 `Q1` 这一行没有值、`precise`
    这一行没有题号，整张答案表解不出任何一对。表头单元格（Question/Answer）顺手丢掉。
    """
    out: list[str] = []
    i = 0
    while i < len(lines):
        t = lines[i].strip()
        if _CELL_HEAD.match(t):
            i += 1
            continue
        if _CELL_QNO.match(t) and i + 1 < len(lines):
            nxt = lines[i + 1].strip()
            if nxt and not _CELL_QNO.match(nxt) and not _CELL_HEAD.match(nxt):
                out.append("%s | %s" % (t, nxt))
                i += 2
                continue
        out.append(lines[i])
        i += 1
    return out


def load_answer_lines(folder: str, setkey: str, problems: list[str]) -> list[str]:
    """答案页文本：优先 docx 里的文字；整份是截图的那 6 套改读 OCR 缓存。"""
    cand = _section_candidates(folder, "answer")
    if not cand:
        problems.append("找不到 Answers 文档（docx/pdf 都没有）")
        return []
    fn = cand[0]
    base = ocr_images.cache_base(fn)
    if fn.lower().endswith(".pdf"):
        # 图片版 PDF 答案页：整份没有文字层，只能读 OCR 缓存。
        paras = _ocr_paras(setkey, os.path.join(folder, fn), problems, "PDF 整份是截图")
        if not paras:
            return []
        problems.append(f"{fn} 的答案文本来自 OCR（ocr_sourced）")
        return reflow_cell_lines([p.text for p in paras])
    paras = read_docx(os.path.join(folder, fn))
    text_lines = [p.text for p in paras if p.text.strip()]
    # 判据是「有没有图 + 文字够不够」两条一起看：图片版答案页（8 套里的 6 套）是整份 7~10 张
    # 截图、一个字都没有；纯文字版一张图都没有。只看字数会把短小的文字版误判成图片版。
    has_images = any(p.images for p in paras)
    if not has_images or sum(nwords(l) for l in text_lines) >= 200:
        return reflow_cell_lines(text_lines)
    cache = ocr_images.cached_texts(setkey, base)
    if not cache:
        problems.append(f"{fn} 是图片版答案且没有 OCR 缓存 —— 先跑 "
                        f"`python scripts/realbank/ocr_images.py \"{folder}\"`")
        return text_lines
    imgs = ocr_images.docx_images(os.path.join(folder, fn))
    missing = [i for i, _, _ in imgs if i not in cache]
    if missing:
        problems.append(f"{fn} 有 {len(missing)} 张图没有 OCR 缓存（img{missing}），答案可能不全")
    out: list[str] = []
    for i, _, _ in imgs:
        if i in cache:
            out.extend(re.sub(r"[ \t]*\t[ \t]*", " | ", l) for l in cache[i].splitlines())
    return out


# ══ 阅读解析 ══════════════════════════════════════════════════════════════
CTW_HEAD = re.compile(
    r"^(Fill[- ]in[- ]the[- ]Blanks?|Missing Letters|Complete the Words)\b(.*)$", re.I)
# 日常阅读的指令句。冠词是可选的 —— 7.16 用的是 `Read instructions.`（没有冠词），
# 强制要冠词会让那一屏被误判成学术短文。
RDL_HEAD = re.compile(r"^Read\s+(?:a|an|the|some\s+)?\w[\w' -]{0,50}[.．]?\s*$", re.I)
MODULE_HEAD = re.compile(r"^(?:Reading|Listening)?\s*Module\s*(\d)\b", re.I)
# 题池版式：拼盘不写 `Module N`，写 `Form 02 | Dark Stores` / `Task 4 | Moon Phases`。
# 音频文件名里的 form/set 编号也是同一套（listening_form02_… → module 2），
# 所以把它当 module 用 —— 题面、答案页、音频三边才对得上（8.30 实测：不这么做
# 12 个 form 的题号全撞在 module 1 上，答案错位一整格）。
POOL_FORM_HEAD = re.compile(r"^(?:Form|Task|Set|Passage)\s*0*(\d+)\b", re.I)
# 听力侧同理，但拼盘写的是体裁：`Lecture 3 | Indian Pangolin`（8.30 的题面与答案页都这么写）。
POOL_LISTEN_HEAD = re.compile(
    r"^(?:Lecture|Conversation|Announcement|Talk|Discussion|Form|Set|Task)\s*0*(\d+)\b", re.I)
# 题池的阅读选择题分区。题面侧只有一行大写分区名（`ACADEMIC READING`），答案侧带序号
# （`Academic Reading 3 | Unveiling Earth's Core`）。两个分区各自从 1 数起，会撞号，
# 所以给各自一个 module 命名空间。
POOL_READ_ZONE = re.compile(r"(Daily[- ]?life\s+Reading|Academic\s+Reading)\s*:?\s*0*(\d*)\b", re.I)
POOL_ZONE_BASE = {"daily": 1000, "academic": 2000}


def pool_zone_base(name: str) -> int:
    return POOL_ZONE_BASE["academic" if re.match(r"^academic", name.strip(), re.I) else "daily"]
Q_HEAD = re.compile(r"^Q\s*(\d+)\s*[.:]?\s*(.*)$")
OPT_HEAD = re.compile(r"^([A-H])[.)]\s*(.+)$")
AP_HEAD = re.compile(r"^Academic Reading\b\s*[:：]?\s*(.*)$", re.I)
BLANK_RE = re.compile(r"([A-Za-z][A-Za-z'’]*)((?:\s*_)+)")
INSERT_HINT = re.compile(r"four locations|where would the following sentence|best fit", re.I)


def split_blanks(passage_raw: str):
    """`It h _ _ two whe _ _ _` → (给定前缀 + 隐藏字母数) 序列，以及一个可回填的模板。

    这类题屏幕上印的是「首字母 + 每个隐藏字母一条下划线」，所以下划线个数就是隐藏长度 ——
    这是唯一能把答案词校验回原文的锚。模板里用 \x00 占位，回填时按顺序替换。
    """
    hits = []
    template_parts = []
    last = 0
    for m in BLANK_RE.finditer(passage_raw):
        hidden = m.group(2).count("_")
        if hidden < 1:
            continue
        hits.append({"given": m.group(1), "hidden": hidden})
        template_parts.append(passage_raw[last:m.start()])
        template_parts.append("\x00")
        last = m.end()
    template_parts.append(passage_raw[last:])
    return hits, "".join(template_parts)


def build_ctw_item(passage_raw: str, answer_words: list[str], title: str):
    """把「残缺原文 + 答案词表」还原成 build_bank.buildCtw 要的 {passage, blanks:[{word,given}]}。"""
    hits, template = split_blanks(passage_raw)
    problems: list[str] = []
    if not hits:
        return None, ["段落里找不到任何挖空标记（`词 _ _` 形态）"]
    if len(hits) != len(answer_words):
        problems.append(f"空位数 {len(hits)} ≠ 答案词数 {len(answer_words)}")
        return None, problems
    blanks = []
    soft: list[str] = []
    for i, (h, w) in enumerate(zip(hits, answer_words), start=1):
        word = str(w).strip()
        given = h["given"]
        if not word.lower().startswith(given.lower()):
            # 硬伤：屏幕上印的前缀和答案对不上 = 这个空永远填不对，整段作废。
            problems.append(f"第 {i} 空：答案 \"{word}\" 不以屏幕上的前缀 \"{given}\" 开头")
            continue
        if len(word) != len(given) + h["hidden"]:
            # 软伤：商家排版的下划线个数和答案词长度差一两个（实测这批很常见）。
            # 落库时 build_bank.buildCtw 是按 `答案长度 - 前缀长度` 重算空格宽度的，
            # 源料的下划线个数根本不参与，所以题目仍然自洽可答 —— 只记账不拦。
            soft.append(
                f"第 {i} 空：答案 \"{word}\" 长度 {len(word)} ≠ 前缀 {len(given)} + 下划线 {h['hidden']}"
                f"（源料下划线个数不准，落库按答案长度重算）")
        blanks.append({"word": word, "given": given})
    if problems:
        return None, problems
    # 回填：占位符按顺序换成完整答案词
    parts = template.split("\x00")
    passage = parts[0]
    for w, tail in zip(answer_words, parts[1:]):
        # 空位后面常常直接顶着下一个词（源里写成 `prod _ _ _ _by colonies`）。不补这个空格，
        # 回填出来就是 "producedby colonies" —— 屏幕上是错字，题也没法读
        # （8.19/8.22 实测 15 段全中）。
        if tail[:1].isalpha():
            tail = " " + tail
        passage += str(w).strip() + tail
    passage = re.sub(r"\s+", " ", passage).strip()
    return {"passage": passage, "blanks": blanks, "topic": guess_topic(f"{title} {passage}"),
            "title": title}, soft


def material_kind(b: dict) -> str:
    """RDL 的体裁标签：`Read an excerpt from a syllabus.` → `excerpt from a syllabus`。

    build_bank 把它写进成品的 `genre`（AP 写进 `topic`），所以要的是体裁词本身，
    不是那句 ETS 指令语。
    """
    if b["kind"] == "ap":
        return guess_topic(f"{b['label']} {' '.join(b['material'])}")
    label = re.sub(r"^read\s+(the following\s+|a\s+|an\s+|some\s+|the\s+)?", "",
                   (b["label"] or "").strip(), flags=re.I).strip(" .")
    return label.lower() or "other"


# C-test 版式的分离下划线：`pre _ _ _ _` / `wi _ _`（字母 + 至少两个用空格隔开的下划线）
_CTEST_BLANK = re.compile(r"([A-Za-z])((?:\s*_){2,})")


def parse_reading(folder: str, setkey: str, ak: AnswerKey) -> list[dict]:
    """Reading.docx → results（ctw / rdl / ap）。"""
    src_problems: list[str] = []
    paras, origin, fn = resolve_doc(folder, setkey, "reading", src_problems)
    if paras is None:
        return [{"key": "reading|missing", "section": "reading", "module": 1, "type": "unknown",
                 "q_start": 0, "q_end": 0, "tier": TIER, "status": "flagged",
                 "problems": src_problems or ["缺 Reading 文档"], "items": []}]
    path = os.path.join(folder, fn)
    base = ocr_images.cache_base(os.path.basename(path))
    ocr_cache = ocr_images.cached_texts(setkey, base) if origin == "docx" else {}

    module = 1
    zone_base = 0          # 题池选择题分区码：1000=日常阅读，2000=学术阅读
    zone_explicit = None   # 分区表头上写明的篇号（`Academic Reading 3:`），没写就顺延
    zone_pending = False   # 刚见过分区表头，下一个材料块归它
    results: list[dict] = []
    ctw_seen: dict[int, int] = {}
    blocks: list[dict] = []      # 选择题材料块
    cur: dict | None = None
    pending_ctw: dict | None = None
    pending_insert = 0            # 插入题后面跟着的 1~2 行说明，吞掉不当新块

    def close_block():
        nonlocal cur
        if cur and (cur["questions"] or cur["material"] or cur["images"]):
            blocks.append(cur)
        cur = None

    def new_block(kind: str, label: str):
        nonlocal cur, zone_pending
        close_block()
        m = module
        if False:
            # 题池的选择题分区（`DAILY-LIFE READING` / `ACADEMIC READING`）里，
            # 每篇材料的题号都从 Q1 重来，而答案页按 `Academic Reading 3 | 标题` 分节 ——
            # 所以用「分区码 + 第几篇」当 module，两边才对得上。不这么做，一个分区里
            # 五篇文章的 Q1-Q5 全撞在同一个 (module, q) 上，只有最后一篇的答案留得下来
            # （8.19/8.22 实测盲审一致率掉到 33~40%，跟瞎猜一个量级）。
            pass
        cur = {"kind": kind, "label": label, "module": m, "zone": zone_base,
               "zone_no": zone_explicit if zone_pending else None, "material": [],
               "images": [], "questions": []}
        zone_pending = False

    for p in paras:
        t = p.text.strip()
        # 插入题（"There are four locations…"）后面跟着「待插入的句子」和
        # 「Where would the sentence best fit?」两行说明，吞掉免得被当成新材料块；
        # 但**不能**吞选项行 —— 有的套把 A.[A] B.[B] 四个选项排在这两行之前。
        if t and pending_insert > 0:
            # 遇到任何结构行（模块头 / 题型头 / 题号 / 选项）就说明插入题那两行说明已经过去了，
            # 计数器必须清零 —— 留着它会把下一段正文（比如 module 2 的填词短文）吃掉。
            structural = (Q_HEAD.match(t) or OPT_HEAD.match(t) or MODULE_HEAD.match(t)
                          or CTW_HEAD.match(t) or RDL_HEAD.match(t) or AP_HEAD.match(t))
            if structural:
                pending_insert = 0
            else:
                pending_insert -= 1
                continue
        if p.images and cur is not None and not cur["questions"]:
            cur["images"].extend(p.images)
        if not t:
            continue

        m = MODULE_HEAD.match(t)
        if m and nwords(t) <= 4:
            close_block()
            module = int(m.group(1))
            pending_ctw = None
            continue

        if POOL_MODE:
            mz = POOL_READ_ZONE.search(t)
            if mz and nwords(t) <= 12:
                close_block()
                zone_base = pool_zone_base(mz.group(1))
                zone_explicit = int(mz.group(2)) if mz.group(2) else None
                zone_pending = True
                pending_ctw = None
                continue
            mf = POOL_FORM_HEAD.match(t)
            if mf and nwords(t) <= 14:
                close_block()
                module = int(mf.group(1))
                zone_base = 0
                pending_ctw = None
                continue
        m = CTW_HEAD.match(t)
        if m:
            close_block()
            title = ""
            rest = m.group(2) or ""
            if ":" in rest:
                title = rest.split(":", 1)[1].strip()
            pending_ctw = {"title": title, "module": module}
            continue

        # 题池模式：拼盘的填词段常常不带 `Fill-in-the-Blanks` 表头，直接就是正文
        # （7.11 的 `pre _ _ _ _, layer-by-layer …`），而且下划线是**分开写**的。
        # 判据：≥25 词的段落里出现 ≥3 处「字母后跟一串分离下划线」= C-test 版式。
        if POOL_MODE and pending_ctw is None and nwords(t) >= 25 and len(_CTEST_BLANK.findall(t)) >= 3:
            title = (cur["label"] if cur and cur.get("label") and not cur["questions"] else "")
            close_block()
            pending_ctw = {"title": title, "module": module}
        if POOL_MODE and pending_ctw is not None:
            # `pre _ _ _ _` → `pre____`：空位长度按下划线个数还原，build_ctw_item 才数得对。
            t = _CTEST_BLANK.sub(lambda m: m.group(1) + "_" * len(re.findall(r"_", m.group(2))), t)
            # 源里空位后面常常直接顶着下一个词（`prod _ _ _ _by coloniesof`）。不补这个空格，
            # 填完答案就粘成 "producedby"，整段 CTW 在 build_bank 里建不出空位被丢掉
            # （8.19/8.22 实测 15 段全废）。
            t = re.sub(r"_(?=[A-Za-z])", "_ ", t)
        if pending_ctw is not None and nwords(t) >= 25:
            order = ctw_seen.get(module, 0) + 1
            ctw_seen[module] = order
            key_ans = next((a for a in ak.reading_ctw
                            if a["module"] == pending_ctw["module"] and a["order"] == order), None)
            problems: list[str] = []
            item = None
            soft_only = False
            if key_ans is None:
                problems.append(f"答案页里找不到 module {module} 第 {order} 段填词的答案")
            else:
                if key_ans.get("malformed"):
                    problems.append(f"答案词形态可疑（可能被截断）：{key_ans['header']}")
                item, ps = build_ctw_item(t, key_ans["words"], pending_ctw["title"])
                # ps 里若已经建出了 item，剩下的就是软问题（记账不拦）
                soft_only = item is not None
                problems.extend(ps)
            q_start = 1 + 10 * (order - 1)
            if item:
                item["q_number"] = q_start
            results.append({
                "key": f"reading|{module}|ctw|{order}", "section": "reading", "module": module,
                "type": "ctw", "q_start": q_start, "q_end": q_start + (len(item["blanks"]) - 1 if item else 9),
                "tier": TIER, "status": "ok" if item and (soft_only or not problems) else "flagged",
                "problems": problems, "items": [item] if item else [],
            })
            pending_ctw = None
            continue

        m = OPT_HEAD.match(t)
        if m and cur and cur["questions"] and nwords(t) <= 45:
            cur["questions"][-1]["options"].append(m.group(2).strip())
            continue

        m = Q_HEAD.match(t)
        if m and (m.group(2) or "").strip():
            if cur is None:
                new_block("ap", "")
            stem = m.group(2).strip()
            cur["questions"].append({"q": int(m.group(1)), "stem": stem, "options": []})
            if INSERT_HINT.search(stem):
                pending_insert = 2      # 插入句 + "Where would the sentence best fit?" 两行
            continue

        if is_noise(t):
            continue

        m = RDL_HEAD.match(t)
        if m and nwords(t) <= 8:
            new_block("rdl", t.rstrip("."))
            continue

        m = AP_HEAD.match(t)
        if m:
            if cur and cur["kind"] == "ap" and not cur["questions"] and not cur["material"]:
                cur["label"] = (cur["label"] + " " + (m.group(1) or "")).strip()
            else:
                new_block("ap", (m.group(1) or "").strip())
            continue

        # 正文 / 标题
        if cur is not None and not cur["questions"]:
            cur["material"].append(t)
            continue
        if nwords(t) <= 12 and not t.endswith((".", "?", "!")):
            new_block("ap", t)          # 学术短文的标题行
            continue
        new_block("ap", "")
        cur["material"].append(t)

    close_block()

    # 题池的选择题分区（`DAILY-LIFE READING` / `ACADEMIC READING`）里每篇材料的题号都从
    # Q1 重来，而答案页按 `Academic Reading 3 | 标题` 分节 —— 所以给**真正带题的**材料块
    # 按分区重编 module（`分区码 + 第几篇`）。不这么做，一个分区里五篇文章的 Q1-Q5 全撞在
    # 同一个 (module, q) 上，只有最后一篇的答案留得下来（8.19/8.22 实测盲审一致率 33~40%，
    # 跟瞎猜一个量级）。编号只数「带题的块」，标题行造出来的空壳块不占号。
    if POOL_MODE:
        zseen: dict[int, int] = {}
        for b in blocks:
            z = b.get("zone") or 0
            if not z or not b["questions"]:
                continue
            # 表头写了篇号就用它（`Academic Reading 3:`），没写就在上一篇的基础上顺延 ——
            # 答案页那边没有篇号时也是顺着数的，两边这样才对得齐。
            zseen[z] = b["zone_no"] if b.get("zone_no") else zseen.get(z, 0) + 1
            b["module"] = z + zseen[z]

    # —— 材料块 → results ——
    for b in blocks:
        material = "\n\n".join(b["material"]).strip()
        problems: list[str] = []
        if not material and b["images"]:
            texts = [ocr_cache[i] for i in b["images"] if i in ocr_cache]
            if texts:
                material = "\n".join(texts).strip()
            else:
                problems.append(f"材料是截图且没有 OCR 缓存（img{b['images']}）")
        if not material:
            problems.append("材料为空（截图未转写 / 版式未覆盖），本块不落库")
        module_n = b["module"]
        items = []
        material_missing = not material
        for q in b["questions"]:
            qp: list[str] = []
            letter = ak.reading_mcq.get((module_n, q["q"]))
            opts = q["options"]
            if len(opts) < 3:
                qp.append(f"Q{q['q']} 只解析到 {len(opts)} 个选项"
                          + ("（插入题在这套源料里没有选项，无法作答）" if INSERT_HINT.search(q["stem"]) else ""))
            if letter is None:
                qp.append(f"Q{q['q']} 答案页里没有答案")
            elif LETTERS.find(letter) >= len(opts):
                qp.append(f"Q{q['q']} 答案 {letter} 越界（只有 {len(opts)} 个选项）")
            if qp or material_missing:
                problems.extend(qp)
                continue
            idx = LETTERS.index(letter)
            items.append({
                "q_number": module_n * 100 + q["q"],
                "q_number_raw": q["q"],
                "material": material,
                "material_kind": material_kind(b),
                "stem": q["stem"],
                "options": opts,
                "answer_index": idx,
                "answer_text": opts[idx],
                "answer_key": letter,
            })
        if not b["questions"]:
            continue
        qs = [q["q"] for q in b["questions"]]
        results.append({
            "key": f"reading|{module_n}|{b['kind']}|{qs[0]}", "section": "reading", "module": module_n,
            "type": b["kind"], "q_start": qs[0], "q_end": qs[-1], "tier": TIER,
            "status": "ok" if items and not problems else ("flagged" if not items else "ok"),
            "problems": problems, "items": items,
            "material_title": b["label"],
        })
    for r in results:
        r["problems"] = list(r["problems"]) + _ocr_note(origin, fn)
    return results


# ══ 写作解析 ══════════════════════════════════════════════════════════════
BS_HEAD = re.compile(r"^(?:Sentence Construction\s*(\d+)|Q(\d+))\s*$", re.I)
CONTEXT_RE = re.compile(r"^Context\s*[:：]\s*(.+)$", re.I)
RESPONSE_RE = re.compile(r"^Response\s*[:：]\s*(.+)$", re.I)
WORDBANK_RE = re.compile(r"^Word Bank\s*[:：]\s*(.+)$", re.I)
# 分节标题必须锚到行尾：`Write an email to Mr. Thompson. In your email, do the following:`
# 是**题面正文**（三条写作要求就跟在它后面），被当成分节标题会整行丢掉。
EMAIL_HEAD = re.compile(r"^Write an Email\s*[.:：]?\s*$", re.I)
DISC_HEAD = re.compile(r"^(Write for an )?Academic Discussion\s*[.:：]?\s*$", re.I)
TO_SUBJ = re.compile(r"^To\s*[:：]\s*(.+?)(?:\s{2,}|\s*)Subject\s*[:：]\s*(.+)$", re.I)
BULLET = re.compile(r"^[•\-·*]\s*(.+)$")
WRITE_EMAIL_TO = re.compile(r"^Write an email to\s+(.+?)\.\s*In your email", re.I)
PROF_CLASS = re.compile(r"class on\s+([^.]+)\.", re.I)


def parse_writing(folder: str, setkey: str) -> list[dict]:
    src_problems: list[str] = []
    paras, _origin, _fn = resolve_doc(folder, setkey, "writing", src_problems)
    if paras is None:
        return [{"key": "writing|missing", "section": "writing", "module": 1, "type": "unknown",
                 "q_start": 0, "q_end": 0, "tier": TIER, "status": "flagged",
                 "problems": src_problems or ["缺 Writing 文档"], "items": []}]
    results: list[dict] = []

    # —— 造句 ——
    bs_raw: list[dict] = []
    cur = None
    n_auto = 0
    zone = "bs"
    email_paras: list[Para] = []
    disc_paras: list[Para] = []
    for p in paras:
        t = p.text.strip()
        if EMAIL_HEAD.match(t):
            zone = "email"
            continue
        if DISC_HEAD.match(t):
            zone = "discussion"
            continue
        if zone == "email":
            email_paras.append(p)
            continue
        if zone == "discussion":
            disc_paras.append(p)
            continue
        m = BS_HEAD.match(t)
        if m:
            n_auto += 1
            cur = {"n": int(m.group(1) or m.group(2) or n_auto), "context": "", "template": "", "bank": []}
            bs_raw.append(cur)
            continue
        m = CONTEXT_RE.match(t)
        if m:
            if cur is None or cur["context"]:
                n_auto += 1
                cur = {"n": n_auto, "context": "", "template": "", "bank": []}
                bs_raw.append(cur)
            cur["context"] = m.group(1).strip()
            continue
        m = RESPONSE_RE.match(t)
        if m and cur is not None:
            cur["template"] = m.group(1).strip()
            continue
        m = WORDBANK_RE.match(t)
        if m and cur is not None:
            cur["bank"] = [x.strip() for x in m.group(1).split("|") if x.strip()]
            continue
    results.append({"__bs_raw": bs_raw, "__ocr_note": _ocr_note(_origin, _fn)})   # 交给 finalize_writing 与答案合并
    results.append({"__email_paras": email_paras, "__disc_paras": disc_paras})
    return results


def finalize_bs(bs_raw: list[dict], ak: AnswerKey, slug: str) -> dict:
    items = []
    problems: list[str] = []
    for q in bs_raw:
        n = q["n"]
        answer = ak.bs.get(n)
        if not answer:
            problems.append(f"造句 Q{n} 答案页里没有答案")
            continue
        if not q["template"]:
            problems.append(f"造句 Q{n} 缺 Response 模板")
            continue
        if not q["bank"]:
            problems.append(f"造句 Q{n} 缺 Word Bank")
            continue
        template = re.sub(r"_{2,}", "_____", q["template"])
        template = re.sub(r"\s+", " ", template).strip()
        ans_words = [norm_word(w) for w in words(answer)]
        # 模板里的固定词必须能对齐到答案（lib/realBank.deriveBsPrefilled 的同一份契约），
        # 对不上就是死题：屏幕上印着的给定词跟答案不一致，用户永远拼不出来。
        fixed_segments = [s for s in re.split(r"_{2,}", template) if s.strip()]
        cursor = 0
        aligned = True
        seen_fixed = set()
        for seg in fixed_segments:
            target = [norm_word(w) for w in words(seg) if norm_word(w)]
            if not target:
                continue
            key = " ".join(target)
            if key in seen_fixed:
                problems.append(f"造句 Q{n} 固定词「{key}」在模板里重复出现（runtime 会拒收）")
                aligned = False
                break
            seen_fixed.add(key)
            found = -1
            for i in range(cursor, len(ans_words) - len(target) + 1):
                if ans_words[i:i + len(target)] == target:
                    found = i
                    break
            if found < 0:
                problems.append(f"造句 Q{n} 固定词「{seg.strip()}」对不上答案「{answer}」")
                aligned = False
                break
            cursor = found + len(target)
        if not aligned:
            continue
        # 词块归属。三类：
        #   · 干扰项 —— 答案里根本没有这串词；
        #   · 「已给出词」—— 词库里重复列了模板已经印在屏幕上的固定词（这批源料常见，
        #     实测 7 题这样）。runtime 的契约是 `可拖词块 + 固定词 == 答案`，
        #     不剔掉就会多出一块永远放不下的词；
        #   · 其余 = 可拖词块。
        # 判据不是「长得像固定词就删」（答案里可能真的出现两次同一个词），而是**先按词数对账**：
        # 只有在不剔就对不上、剔了正好对上时才剔。对不上就整题作废，不猜。
        ans_blob = " " + " ".join(ans_words) + " "
        chunks = list(q["bank"])
        distractors = [c for c in chunks
                       if (seq := " ".join(norm_word(w) for w in words(c) if norm_word(w)))
                       and f" {seq} " not in ans_blob]
        fixed_words = sum(len([w for w in words(seg) if norm_word(w)]) for seg in fixed_segments)
        usable = [c for c in chunks if c not in distractors]

        def word_total(cs):
            return sum(len([w for w in words(c) if norm_word(w)]) for c in cs)

        if word_total(usable) + fixed_words != len(ans_words):
            fixed_seqs = [" ".join(norm_word(w) for w in words(seg) if norm_word(w))
                          for seg in fixed_segments]
            trimmed, pool = [], list(fixed_seqs)
            for c in usable:
                seq = " ".join(norm_word(w) for w in words(c) if norm_word(w))
                if seq in pool:
                    pool.remove(seq)          # 这块就是屏幕上已给出的那个词，不该再出现在词库里
                    continue
                trimmed.append(c)
            if word_total(trimmed) + fixed_words == len(ans_words):
                chunks = [c for c in chunks if c in trimmed or c in distractors]
                usable = trimmed
            else:
                problems.append(
                    f"造句 Q{n} 词块拼不满答案：可拖词块 {word_total(usable)} 词 + 固定词 {fixed_words} 词 "
                    f"≠ 答案 {len(ans_words)} 词")
                continue
        items.append({
            "n": n,
            "id": f"bs_{slug}_{n:02d}",
            "prompt": q["context"],
            "blanks": template,
            "chunks": chunks,
            "answer": answer,
            "distractors": distractors,
            "sentence": answer,          # 与旧链路 build 类型的 items 字段兼容
        })
    return {"key": "writing|1|build|1", "section": "writing", "module": 1, "type": "build",
            "q_start": 1, "q_end": len(bs_raw) or 10, "tier": TIER,
            "status": "ok" if items else "flagged", "problems": problems, "items": items}


def finalize_email(email_paras: list[Para], slug: str) -> dict:
    problems: list[str] = []
    lines = [p.text.strip() for p in email_paras if p.text.strip()]
    has_img_only = (not lines or sum(nwords(l) for l in lines) < 30) and any(p.images for p in email_paras)
    to = subject = ""
    direction = ""
    scenario_parts: list[str] = []
    goals: list[str] = []
    in_goals = False
    for t in lines:
        m = TO_SUBJ.match(t)
        if m:
            to, subject = m.group(1).strip(), m.group(2).strip()
            continue
        m = re.match(r"^To\s*[:：]\s*(.+)$", t, re.I)
        if m and not to:
            v = m.group(1).strip()
            mm = re.match(r"^(.+?)Subject\s*[:：]\s*(.+)$", v, re.I)
            if mm:
                to, subject = mm.group(1).strip(), mm.group(2).strip()
            else:
                to = v
            continue
        m = re.match(r"^Subject\s*[:：]\s*(.+)$", t, re.I)
        if m and not subject:
            subject = m.group(1).strip()
            continue
        m = WRITE_EMAIL_TO.match(t)
        if m:
            direction = t.split("In your email")[0].strip()
            # 三条要求有两种排法：跟在同一段里用 • 分隔（6.15），或各自独占一段（6.20/6.22/6.29）。
            # 同段的在这里就地切开；独占段的靠 in_goals 状态位在后面几行里收。
            rest = t.split("do the following:", 1)[1] if "do the following:" in t else ""
            for g in re.split(r"[•]|(?<=[.?!])\s+(?=[A-Z])", rest):
                g = g.strip(" -·*")
                if nwords(g) >= 4:
                    goals.append(g)
            in_goals = len(goals) < 3
            continue
        m = BULLET.match(t)
        if m:
            goals.append(m.group(1).strip())
            in_goals = len(goals) < 3
            continue
        if is_noise(t) or re.match(r"^(Write as much as you can|Your Response)", t, re.I):
            in_goals = False
            continue
        if in_goals and len(goals) < 3 and nwords(t) >= 4 and t.endswith((".", "?")):
            goals.append(t)
            in_goals = len(goals) < 3
            continue
        if nwords(t) >= 12 and not goals:
            scenario_parts.append(t)
    scenario = " ".join(scenario_parts).strip()
    goals = [g for g in goals if nwords(g) >= 4][:3]
    if has_img_only:
        problems.append("邮件题面整块是截图（本套源料没给文字），已跳过")
    if not scenario:
        problems.append("缺情境描述")
    if len(goals) < 3:
        problems.append(f"只解析到 {len(goals)} 条写作要求（真题固定 3 条）")
    item = {
        "id": f"email_{slug}",
        "to": to or "Professor",
        "subject": subject,
        "scenario": scenario,
        "direction": direction or (f"Write an email to {to}." if to else ""),
        "goals": goals,
    }
    ok = bool(scenario) and len(goals) >= 3
    return {"key": "writing|1|email|1", "section": "writing", "module": 1, "type": "email",
            "q_start": 1, "q_end": 1, "tier": TIER, "status": "ok" if ok else "flagged",
            "problems": problems, "items": [item] if ok else []}


def finalize_discussion(disc_paras: list[Para], slug: str) -> dict:
    problems: list[str] = []
    lines = [p.text.strip() for p in disc_paras if p.text.strip()]
    has_img_only = sum(nwords(l) for l in lines) < 40 and any(p.images for p in disc_paras)
    course = ""
    prof_name = ""
    prof_text = ""
    students: list[dict] = []
    pending_name = None
    in_class_discussion = False  # 只用于跳过那一行标题，不再参与归属判断
    for t in lines:
        if re.match(r"^Class Discussion", t, re.I):
            in_class_discussion = True
            continue
        m = PROF_CLASS.search(t)
        if m and not course:
            course = m.group(1).strip()
            continue
        if is_noise(t):
            continue
        # 人名行：`Dr. Gupta` / `Dr. GuptaProfessor` / `ClaireStudent` / `Kelly`
        m = re.match(r"^((?:Dr\.|Prof\.|Professor|Mr\.|Ms\.|Mrs\.)?\s*[A-Z][\w'.\-]*(?:\s+[A-Z][\w'.\-]*)?)"
                     r"\s*(Professor|Student)?\s*$", t)
        if m and nwords(t) <= 4 and not t.endswith((".", "?", "!")) or re.match(
                r"^(Dr\.|Prof\.)\s*[A-Z]\w+(Professor)?$", t):
            name = re.sub(r"(Professor|Student)$", "", m.group(1) if m else t).strip()
            role = (m.group(2) if m else None) or ("Professor" if re.match(r"^(Dr\.|Prof)", name) else None)
            if role == "Professor" or (not prof_name and re.match(r"^(Dr\.|Prof)", name)):
                prof_name = name
            else:
                pending_name = name
            continue
        # `Dr. Gupta | Professor; Claire | Student; Paul | Student` 这种花名册行
        if "|" in t and re.search(r"Professor|Student", t, re.I) and nwords(t) <= 14:
            for chunk in re.split(r"[;；]", t):
                mm = re.match(r"^\s*(.+?)\s*\|\s*(Professor|Student)\s*$", chunk, re.I)
                if not mm:
                    continue
                if mm.group(2).lower() == "professor":
                    prof_name = mm.group(1).strip()
                else:
                    students.append({"name": mm.group(1).strip(), "text": ""})
            continue
        if nwords(t) < 12:
            continue
        # 归属只看「上一行是不是人名」，不看 "Class Discussion" 这个分隔行 ——
        # 实测有的套把它排在教授贴**之前**（7.16），照它切会把教授贴整段丢掉。
        if pending_name:
            students.append({"name": pending_name, "text": t})
            pending_name = None
            continue
        if students and not students[-1]["text"]:
            students[-1]["text"] = t
            continue
        if not prof_text:
            prof_text = t
            continue
    students = [s for s in students if s["text"]]
    if has_img_only:
        problems.append("学术讨论题面整块是截图（本套源料没给文字），已跳过")
    if not prof_text:
        problems.append("缺教授贴正文")
    if len(students) < 2:
        problems.append(f"只解析到 {len(students)} 条学生贴（真题固定 2 条）")
    item = {
        "id": f"disc_{slug}",
        "course": course or "",
        "professor": {"name": prof_name or "Professor", "text": prof_text},
        "students": students[:2],
    }
    ok = bool(prof_text) and len(students) >= 2
    return {"key": "writing|1|discussion|1", "section": "writing", "module": 1, "type": "discussion",
            "q_start": 2, "q_end": 2, "tier": TIER, "status": "ok" if ok else "flagged",
            "problems": problems, "items": [item] if ok else []}


# ══ 听力 / 口语解析（只解析，不落库：status=deferred）════════════════════
AUDIO_RE = re.compile(r"^Audio\s*[:：]\s*(.+)$", re.I)


def audio_type(audio_path: str) -> str:
    p = str(audio_path or "").lower()
    if "choose_response" in p:
        return "lcr"
    if "conversation" in p:
        return "lc"
    if "announcement" in p:
        return "la"
    if "lecture" in p or "talk" in p or "discussion" in p:
        return "lat"
    return "listening_mcq"


def parse_listening(folder: str, ak: AnswerKey, setkey: str = "") -> list[dict]:
    src_problems: list[str] = []
    paras, origin, fn = resolve_doc(folder, setkey, "listening", src_problems)
    if paras is None:
        return [{"key": "listening|missing", "section": "listening", "module": 1, "type": "unknown",
                 "q_start": 0, "q_end": 0, "tier": TIER, "status": "flagged",
                 "problems": src_problems or ["缺 Listening 文档"], "items": []}]
    module = 1
    groups: list[dict] = []
    cur_group = None

    def open_group(header_group: bool):
        nonlocal cur_group
        cur_group = {"module": module, "audio": "", "questions": [], "header_group": header_group}
        groups.append(cur_group)

    # 听力 docx 有两种版式，同一份里混着用：
    #   A) LCR（第一题型）: `Q1. Choose the best response.` → `Audio: …` → 四个选项。
    #      音频在**题号之后**，且一题一条音频。
    #   B) 对话/公告/讲座: `Module 1 Q13-Q14` → `Audio: …` → Q13/Q14 各自题干+选项。
    #      音频在**题号之前**，且一条音频带 2~4 题。
    # 判据是「这一组是不是由 `Module N Qa-Qb` 表头开的」——是就继续收后面的题，
    # 不是（LCR）就每见一道新题另起一组。靠 Audio 行分组会把 LCR 的选项全丢掉。
    for p in paras:
        t = p.text.strip()
        if not t:
            continue
        m = MODULE_HEAD.match(t)
        if m:
            module = int(m.group(1))
            cur_group = None
            if re.search(r"Q\s*\d", t):
                open_group(True)
            continue
        if POOL_MODE:
            mf = POOL_LISTEN_HEAD.match(t)
            if mf and nwords(t) <= 14:
                module = int(mf.group(1))
                cur_group = None
                continue
        m = AUDIO_RE.match(t)
        if m:
            if cur_group is not None and not cur_group["audio"]:
                cur_group["audio"] = m.group(1).strip()
            else:
                open_group(False)
                cur_group["audio"] = m.group(1).strip()
            continue
        m = OPT_HEAD.match(t)
        if m and cur_group and cur_group["questions"] and nwords(t) <= 45:
            cur_group["questions"][-1]["options"].append(m.group(2).strip())
            continue
        m = Q_HEAD.match(t)
        if m and (m.group(2) or "").strip():
            if cur_group is None or (not cur_group["header_group"] and cur_group["questions"]
                                     and cur_group["questions"][-1]["options"]):
                open_group(False)
            cur_group["questions"].append({"q": int(m.group(1)), "stem": m.group(2).strip(), "options": []})
            continue

    tr_by_range = {}
    for tr in ak.transcripts:
        for q in range(tr["q_start"], tr["q_end"] + 1):
            tr_by_range[(tr["module"], q)] = tr

    results = []
    for g in [x for x in groups if x["questions"]]:
        items = []
        problems = []
        gkind = ""
        for q in g["questions"]:
            letter = ak.listening_mcq.get((g["module"], q["q"]))
            tr = tr_by_range.get((g["module"], q["q"]))
            if tr and not gkind:
                gkind = (tr.get("kind") or "").lower()
            transcript = "\n".join(tr["lines"]) if tr else ""
            if tr:
                kind = (tr.get("kind") or "").lower()
                tw = nwords(transcript)
                if "lecture" in kind and tw < 150:
                    problems.append(f"Q{q['q']} 讲座转写只有 {tw} 词（疑似节选）: transcript_abridged")
                elif "conversation" in kind and tw < 60:
                    problems.append(f"Q{q['q']} 对话转写只有 {tw} 词（疑似节选）: transcript_abridged")
            items.append({
                "q_number": g["module"] * 100 + q["q"],
                "q_number_raw": q["q"],
                "material": "",
                "material_kind": "none",
                "stem": q["stem"],
                "options": q["options"],
                "answer_index": LETTERS.index(letter) if letter and LETTERS.index(letter) < len(q["options"]) else None,
                "answer_key": letter,
                "audio_path": g["audio"],
                "transcript": transcript,
                "transcript_words": nwords(transcript),
            })
        qs = [q["q"] for q in g["questions"]]
        # 音频缺席时（题池里常见：只摘了讲座、LCR 音频没给）用答案页的转写体裁定题型；
        # 再按体裁门槛判「文档逐字稿够不够当逐字稿用」——够就记 transcript_from_doc，
        # 由 merge 阶段直接放行；不够记 no_audio_hold，扣下。
        ftype = audio_type(g["audio"]) if (g["audio"] or not POOL_MODE) else audio_type(gkind or "")
        if POOL_MODE and not g["audio"]:
            tw = max([nwords(i["transcript"]) for i in items] or [0])
            need = POOL_TRANSCRIPT_MIN.get(ftype, 60)
            if tw >= need:
                problems.append(f"transcript_from_doc: 无逐题音频，直接用文档逐字稿（{tw} 词 ≥ {need}）")
            else:
                problems.append(f"no_audio_hold: 无逐题音频，且文档逐字稿只有 {tw} 词（<{need}）")
        results.append({
            "key": f"listening|{g['module']}|{qs[0]}", "section": "listening", "module": g["module"],
            "type": ftype, "q_start": qs[0], "q_end": qs[-1], "tier": TIER,
            "status": "deferred",
            "problems": ["听力本期只解析不落库：题面依赖逐题音频，音频链路未验收"] + problems,
            "items": items,
        })
    for r in results:
        r["problems"] = list(r["problems"]) + _ocr_note(origin, fn)
    return results


def parse_speaking(folder: str, ak: AnswerKey, setkey: str = "") -> list[dict]:
    src_problems: list[str] = []
    paras, origin, fn = resolve_doc(folder, setkey, "speaking", src_problems)
    if paras is None:
        return [{"key": "speaking|missing", "section": "speaking", "module": 1, "type": "unknown",
                 "q_start": 0, "q_end": 0, "tier": TIER, "status": "flagged",
                 "problems": src_problems or ["缺 Speaking 文档"], "items": []}]
    zone = None
    context = {"repeat": "", "interview": ""}
    repeat_items: list[dict] = []
    interview_items: list[dict] = []
    cur_audio = ""
    # 题号一律以**音频文件名**为准（`speaking_listen_repeat_q03.mp3` → 3）。
    # 作答行的写法在 8 套里有四种：`3. Response: ___` / `Q3. Response: ___` /
    # `Q3: ________` / 干脆只有题干没有 Response —— 靠作答行认题号必漏，
    # 靠文件名认则 8 套完全统一（merge_vendor_asr 分组也是这个依据）。
    for p in paras:
        t = p.text.strip()
        if not t:
            continue
        if SPEAK_ZONE_REPEAT.match(t):          # `Task 1: Listen and Repeat - 场景名` 也算
            zone = "repeat"
            continue
        if SPEAK_ZONE_INTERVIEW.match(t):
            zone = "interview"
            continue
        if zone is None:
            continue
        m = AUDIO_RE.match(t)
        if m:
            cur_audio = m.group(1).strip()
            base = os.path.basename(cur_audio)
            # 题号交给 audio_names.speak_unit：第一波的 `speaking_listen_repeat_q03.mp3` 仍是 3，
            # 分组命名（`_s01_q03` / `S-R02_q3`）则给 set*100+q 的全局题号，两组不互相覆盖。
            unit = audio_names.speak_unit(base)
            if not unit or unit.get("setup"):
                continue
            n = unit["n"]
            if zone == "repeat" and not any(i["n"] == n for i in repeat_items):
                repeat_items.append({"n": n, "audio_path": cur_audio,
                                     "sentence": ak.repeat.get(n, ""), "q_number": n})
            if zone == "interview" and not any(i["n"] == n for i in interview_items):
                interview_items.append({"n": n, "audio_path": cur_audio,
                                        "stem": ak.interview_stem.get(n, ""),
                                        "reference_answer": ak.interview_answer.get(n, ""),
                                        "q_number": n})
            continue
        if _BLANK_LINE.match(t):                # `Response: ______` 是留白，不是内容
            continue
        if zone == "interview" and interview_items:
            mq = Q_HEAD.match(t)
            body = (mq.group(2) if mq else t).strip()
            last = interview_items[-1]
            # 题干以 Speaking.docx 为准；docx 只有占位符时才用答案页解出来的题干。
            if body and (not mq or int(mq.group(1)) == last["n"]) and _is_question_line(body):
                last["stem"] = body
                continue
            # 长题干换行续写：上一行没写完（不以 ? 收尾）就接上
            unfinished = bool(last["stem"]) and not last["stem"].rstrip().endswith("?")
            if body and unfinished and not mq and nwords(last["stem"]) < 60:
                last["stem"] = (last["stem"] + " " + body).strip()
                continue
        if nwords(t) >= 12 and not context[zone] and not is_noise(t):
            context[zone] = t

    out = []
    repeat_items.sort(key=lambda i: i["n"])
    interview_items.sort(key=lambda i: i["n"])
    if repeat_items:
        missing = [i["n"] for i in repeat_items if not i["sentence"]]
        out.append({"key": "speaking|1|repeat|1", "section": "speaking", "module": 1, "type": "repeat",
                    "q_start": 1, "q_end": len(repeat_items), "tier": TIER, "status": "deferred",
                    "problems": ["口语本期只解析不落库：题面依赖逐题音频"]
                                + ([f"复述原句缺失：{missing}"] if missing else []),
                    "items": repeat_items, "context": context["repeat"]})
    if interview_items:
        out.append({"key": "speaking|1|interview|1", "section": "speaking", "module": 1, "type": "interview",
                    "q_start": 1, "q_end": len(interview_items), "tier": TIER, "status": "deferred",
                    "problems": ["口语本期只解析不落库：题面依赖逐题音频"],
                    "items": interview_items, "context": context["interview"]})
    for r in out:
        r["problems"] = list(r["problems"]) + _ocr_note(origin, fn)
    return out


# ══ 组装 ══════════════════════════════════════════════════════════════════
def file_hash(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def set_slug(setkey: str) -> str:
    return setkey


def parse_set(folder: str, pool: bool = False) -> dict:
    global POOL_MODE
    POOL_MODE = pool
    folder = os.path.normpath(folder)
    setkey = ocr_images.setkey_for(folder, "rp" if pool else "rf")
    problems: list[str] = []
    ak = parse_answers_lines(load_answer_lines(folder, setkey, problems))
    problems.extend(ak.problems)

    results: list[dict] = []
    results.extend(parse_reading(folder, setkey, ak))

    wr = parse_writing(folder, setkey)
    if wr and "__bs_raw" in wr[0]:
        wnote = wr[0].get("__ocr_note") or []
        wres = [finalize_bs(wr[0]["__bs_raw"], ak, set_slug(setkey)),
                finalize_email(wr[1]["__email_paras"], set_slug(setkey)),
                finalize_discussion(wr[1]["__disc_paras"], set_slug(setkey))]
        for r in wres:
            r["problems"] = list(r["problems"]) + wnote
        results.extend(wres)
    else:
        results.extend(wr)

    results.extend(parse_listening(folder, ak, setkey))
    results.extend(parse_speaking(folder, ak, setkey))

    if problems:
        results.insert(0, {"key": "set|source", "section": "meta", "module": 0, "type": "source",
                           "q_start": 0, "q_end": 0, "tier": TIER, "status": "flagged",
                           "problems": problems, "items": []})

    tally: dict[str, int] = {}
    for r in results:
        tally[r["status"]] = tally.get(r["status"], 0) + 1
    return {"set": setkey, "model": PARSER_ID, "source_dir": folder, "tally": tally, "results": results}


def write_scan_stub(folder: str, setkey: str, out_dir: str = None) -> str:
    """给 build_bank 的跨卷去重用的最小 `<setkey>.json`。

    build_bank.readingSourceHashes 只要 files[] 里 role=questions 且 anchors.reading>0 的
    内容哈希；这批是文字原生 docx，哈希直接取 Reading.docx 的文件摘要 —— 同一份阅读被商家
    重复打包进两套时能被认出来（旧源实测有 5 组这种重复）。
    """
    files = []
    for fn in sorted(os.listdir(folder)):
        low = fn.lower()
        # 第二波起 Reading/Listening 也可能整份是 PDF（8.30 / 9.02 / 7.29），
        # 只哈希 docx 的话这些套在跨卷去重里等于没有指纹 —— 重复上线就查不出来。
        if not (low.endswith(".docx") or low.endswith(".pdf")) or fn.startswith("~$"):
            continue
        p = os.path.join(folder, fn)
        section = None
        for sec, keys in SECTION_ALIASES.items():
            if sec == "answer":
                continue
            if any(k in low for k in keys):
                section = sec
                break
        role = "answer-key" if any(k in low for k in SECTION_ALIASES["answer"]) else "questions"
        anchors = {"reading": 0, "listening": 0, "speaking": 0, "writing": 0}
        if section:
            anchors[section] = 1
        kind = "pdf" if low.endswith(".pdf") else "docx"
        files.append({"file": fn, "mb": round(os.path.getsize(p) / 1024 / 1024, 2), "kind": kind,
                      "origin": f"reformatted-{kind}", "section": section, "confidence": 1.0,
                      "anchors": anchors, "blocks": 0, "hash": file_hash(p), "role": role})
    audio_dir = os.path.join(folder, "audio", "item_level")
    audio = sorted(os.listdir(audio_dir)) if os.path.isdir(audio_dir) else []
    payload = {"set": setkey, "source_dir": folder, "generated_by": PARSER_ID,
               "files": files, "audio": {"item_level": audio}, "duplicate_files": [],
               "alignment": {}, "blockers": [], "blocks": []}
    out_dir = out_dir or OUT_DIR
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{setkey}.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="重排版真题 → structured.json（确定性，零 LLM）")
    ap.add_argument("folder", help="套题文件夹路径")
    ap.add_argument("--dry", action="store_true", help="只打印统计，不写盘")
    ap.add_argument("--verbose", action="store_true", help="打印每条 problem")
    ap.add_argument("--pool", action="store_true",
                    help="题池模式：不当整卷收，setkey 用 rp 前缀，能收多少收多少")
    ap.add_argument("--out-dir", default=OUT_DIR,
                    help="产物目录（默认 .codex-tmp/realbank；测试用临时目录跑，免得 fixture 混进真题库）")
    args = ap.parse_args()

    folder = os.path.normpath(args.folder)
    if not os.path.isdir(folder):
        print(f"找不到套题文件夹：{folder}", file=sys.stderr)
        return 2
    data = parse_set(folder, pool=args.pool)
    setkey = data["set"]

    print(f"■ {os.path.basename(folder)} → {setkey}")
    print(f"  状态分布: {data['tally']}")
    by_type: dict[str, int] = {}
    for r in data["results"]:
        if r["status"] != "ok":
            continue
        by_type[r["type"]] = by_type.get(r["type"], 0) + len(r["items"])
    print(f"  可落库条目（status=ok）: {by_type}")
    nprob = sum(len(r["problems"]) for r in data["results"])
    print(f"  problems 合计 {nprob}")
    if args.verbose:
        for r in data["results"]:
            for p in r["problems"]:
                print(f"    [{r['section']}/{r['type']}] {p}")
    if args.dry:
        print("（--dry，未写盘）")
        return 0

    out_dir = os.path.abspath(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{setkey}.structured.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    print(f"  → {os.path.relpath(out, REPO_ROOT)}")
    print(f"  → {os.path.relpath(write_scan_stub(folder, setkey, out_dir), REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
