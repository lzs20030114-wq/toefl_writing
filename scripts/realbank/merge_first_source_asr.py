#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""真题录入 —— 第一来源（自带「听力原文」逐字稿）的听力/口语合流。

与第二来源（`merge_vendor_asr.py`）的区别只有一处：**分组的权威来源不同**。

  第二来源：商家把音频按题切好了，文件名 `listening_m1_q13_q14_conversation_x.mp3`
            自带 (module, 题号区间, 题材)，所以拿**文件名**当分组 ground truth。
  第一来源：音频只有整块的 `ListeningModule1/2.mp3`，但每套自带一份
            「听力原文-….pdf」逐字稿，按 `Module / Choose the best response /
            Conversation1 / Announcement2 / Lecture1` 排得整整齐齐 ——
            所以拿**逐字稿 PDF 的分段**当 ground truth。

三层交叉核对，任一层不过就 fail-closed 扣下（宁可少题，不许上错题）：

  1. **屏幕 ↔ 逐字稿**：屏幕侧（`<卷>.json` 的 blocks + alignment）能数出每个 module
     有几道 LCR、几组材料、每组材料是 conversation/announcement/lecture、各占哪几题号；
     逐字稿侧能数出同样的东西。两边条数或题材序列对不上 → 对应部分整体扣下。
  2. **逐字稿 ↔ 音频**：把该 module 逐字稿各段按顺序拼成一条词序列，与 Whisper 的
     整块转写做一次序列对齐（difflib 最长公共子序列，词级），得到每段的命中率与它在
     音频里的词区间（进而是时间区间）。命中率 < SIM_MIN、区间缺失、塌陷或倒序 → 该段扣下。
  3. **对话要分角色**：LC 落库要 `speakers[2] + conversation[{speaker,text}]`。
     逐字稿只有少数组带 Man/Woman 标签，多数是 A/B、还有一批完全无标签。
     A/B 组用音频基频二分（复用 merge_vendor_asr.diarize）判「先开口的是男是女」，
     判不出就扣下；无标签组直接扣下 —— 角色标反了，题干里的 "the man" 就问空气。

音频**不切片**：真题上线的音频一律由 `render_real_audio.mjs` 用自家 TTS 重配
（见该脚本头注：商家/考场原音不是我们能分发的素材），原始 mp3 从不进产物，
所以对齐出来的时间区间只用于核对与判性别，不落盘成切片文件。

产物：就地改写 `.codex-tmp/realbank/<卷>.structured.json` 的 listening/speaking 段，
形状与 `merge_vendor_asr.py` 完全一致（`merged_asr` 标记 + transcript_final / turns /
speakers / asr_similarity），后续 audit_answers / build_bank / render_real_audio 零改动。

幂等：永远从 `<卷>.structured.fs_parsed.json`（structure_set 的 listening/speaking 原始产物）
与 `<卷>.structured.rw.json`（阅读/写作基线）出发重建，不在上一次合流结果上再合一次。

用法：
  python scripts/realbank/merge_first_source_asr.py --dry-run --set 3.14新托福真题
  python scripts/realbank/merge_first_source_asr.py --set 3.14新托福真题
  python scripts/realbank/merge_first_source_asr.py --all
  python scripts/realbank/merge_first_source_asr.py --self-test
"""
import os
import re
import sys
import json
import shutil
import difflib
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import merge_vendor_asr as V  # noqa: E402  （sim/norm/diarize/strip_framing 等全部复用）
import asr_cache  # noqa: E402

ROOT = V.ROOT
OUT_DIR = V.OUT_DIR
MERGER_ID = "merge_first_source_asr-v1"

# 逐字稿段 ↔ 音频的词级命中率下限。低于此值 = 这段稿子与音频对不上。
SIM_MIN = 0.60
# 区间倒序容忍度（词）。Whisper 偶尔把上一段的尾巴并进下一段，允许一点点回退。
SPAN_BACK_TOL = 8

TYPE_BY_KIND = {"conversation": "lc", "announcement": "la",
                "lecture": "lat", "talk": "lat", "discussion": "lat"}

# 逐字稿 PDF 的分段表头。整行只有表头才算（正文里出现 "conversation" 不算）。
HDR_RE = re.compile(
    r"(?im)^[ \t]*(Module\s*[12]|Choose\s+the\s+best\s+response[^\n]*|"
    r"Conversation\s*\d*|Announcement\s*\d*|Lecture\s*\d*|Talk\s*\d*|Discussion\s*\d*)"
    r"[ \t]*[:：]?[ \t]*$")
MODULE_RE = re.compile(r"(?i)^module\s*([12])$")
LCR_HDR_RE = re.compile(r"(?i)^choose\s+the\s+best\s+response")
KIND_RE = re.compile(r"(?i)^(conversation|announcement|lecture|talk|discussion)\s*(\d*)$")
CJK_RE = re.compile(r"[一-鿿]")
NUMBERED_RE = re.compile(r"^\s*(\d{1,2})\s*[.、．]\s*(.*)$")
# 屏幕侧的材料屏（"Listen to a conversation" / "Listen to a talk in a biology class."）
SCREEN_MAT_RE = re.compile(r"(?i)listen\s+to\s+(?:a|an|the)\s+([a-z]+)")
SCREEN_LCR_RE = re.compile(r"(?i)choose\s*the\s*best\s*response")
# 逐字稿正文里的说话人标签（行首或空白后）。
TURN_RE = re.compile(
    r"(?:(?<=^)|(?<=[\s]))((?:Speaker\s+|Student\s+)?[A-D]|Man|Woman|Male|Female|Narrator)"
    r"\s*[:：;；]\s*")
# 逐字稿里残留的播放器时间戳（"{ 1:52 }" / "{0:58}"）。抄进 transcript 会被 TTS 念出来。
TIMESTAMP_RE = re.compile(r"[{（(]\s*\d{1,2}\s*[:：]\s*\d{2}\s*[})）]")
# 材料尾巴串进来的下一题题干（真题题干一律是这几个疑问词开头的问句）。
QSTEM_TAIL_RE = re.compile(
    r"(?i)(?:^|(?<=[.!?]))\s*((?:What|Why|How|Where|When|Who|Which)\b[^.?!]{5,120}\?)\s*$")
MALE_LAB = {"man", "male", "m"}
FEMALE_LAB = {"woman", "female", "f"}
FRAMING_SENT_RE = re.compile(r"(?i)^\s*(?:now\s+)?listen\s+(?:to|again)\b[^.?!]*[.?!]?\s*")


# ══ 逐字稿 PDF 解析 ══════════════════════════════════════════════════════
def clean_lines(body):
    """丢水印/中文行；遇到「13. Why is the man…」这种附在正文后的题号行就截断。

    1.21A 那批逐字稿把每组材料的题干也抄在材料后面。抄进 transcript 会让 TTS 把题干
    也念出来、也会让盲审直接看到题面 —— 题号行一出现，后面的都不要。
    """
    out = []
    for ln in body.split("\n"):
        s = re.sub(r"\s{2,}", " ", TIMESTAMP_RE.sub(" ", ln)).strip()
        if not s:
            continue
        if CJK_RE.search(s):
            continue
        if NUMBERED_RE.match(s):
            break
        out.append(s)
    return out


def strip_question_tail(text, stems):
    """材料结尾串进来的下一题题干 → 剪掉。

    逐字稿 PDF 的分页把下一屏的题干（"What is the main topic of the talk?"）拼进了上一段
    正文。判据不是「看起来像问句」——讲座里本来就有反问句——而是**这句话逐字等于本组
    某道题的题干**（归一化后比）。等于题干才剪，剪一句就停。
    """
    keys = {V.norm(s) for s in stems if s}
    t = str(text or "").strip()
    for _ in range(3):
        m = QSTEM_TAIL_RE.search(t)
        if not m or V.norm(m.group(1)) not in keys:
            break
        t = t[:m.start(1)].strip()
    return t


def parse_lcr_block(body):
    """"Choose the best response" 之后的编号句 → {n: sentence}。"""
    out = {}
    cur = None
    for ln in body.split("\n"):
        s = ln.strip()
        if not s or CJK_RE.search(s):
            continue
        m = NUMBERED_RE.match(s)
        if m:
            cur = int(m.group(1))
            out[cur] = m.group(2).strip()
        elif cur is not None:
            out[cur] = (out[cur] + " " + s).strip()
    # 句首的 "Man:" / "Woman:" 只是提示谁在说，不是刺激句本身
    for n in list(out):
        out[n] = TURN_RE.sub("", out[n], count=1).strip()
    return {n: t for n, t in out.items() if t}


def parse_transcript_pdf(text):
    """逐字稿全文 → {module: {"lcr": {n: sent}, "sections": [{kind, type, ordinal, body}]}}。"""
    mods = {1: {"lcr": {}, "sections": []}, 2: {"lcr": {}, "sections": []}}
    parts = HDR_RE.split(text)
    module = 1
    for i in range(1, len(parts), 2):
        hdr = parts[i].strip()
        body = parts[i + 1] if i + 1 < len(parts) else ""
        m = MODULE_RE.match(hdr)
        if m:
            module = int(m.group(1))
            continue
        if LCR_HDR_RE.match(hdr):
            mods[module]["lcr"].update(parse_lcr_block(body))
            continue
        k = KIND_RE.match(hdr)
        if k:
            kind = k.group(1).lower()
            mods[module]["sections"].append({
                "kind": kind, "type": TYPE_BY_KIND[kind],
                "ordinal": int(k.group(2)) if k.group(2) else 0,
                "body": " ".join(clean_lines(body)),
            })
    return mods


def strip_framing_text(s):
    """去掉正文开头的 "Listen to a conversation." 这类考场提示句。"""
    return FRAMING_SENT_RE.sub("", str(s or "").strip(), count=1).strip()


def parse_turns(body):
    """逐字稿正文 → ([{label,text}], 标签风格)。

    风格：'gender'（Man/Woman）/ 'ab'（A/B、Speaker A/B）/ 'none'（没有标签）。
    """
    hits = list(TURN_RE.finditer(body))
    if not hits:
        return [], "none"
    turns = []
    for i, h in enumerate(hits):
        lab = re.sub(r"\s+", " ", h.group(1)).strip().lower()
        end = hits[i + 1].start() if i + 1 < len(hits) else len(body)
        txt = strip_framing_text(body[h.end():end].strip())
        if not txt:
            continue
        turns.append({"label": lab, "text": txt})
    if not turns:
        return [], "none"
    labs = {t["label"] for t in turns}
    style = "gender" if (labs & (MALE_LAB | FEMALE_LAB)) else "ab"
    return turns, style


# ══ 屏幕侧分组 ═══════════════════════════════════════════════════════════
def screen_groups(scan):
    """`<卷>.json` → {module: {"lcr": [题号…], "groups": [{type, kind, q_start, q_end, framing}]}}。

    权威判据是「这一屏有没有答案」：材料屏在答案页上没有对应答案，所以它不会出现在
    alignment.matched 里；题目屏一定在。靠这一条把材料屏与题目屏分开，比看正文长度稳。
    """
    la = (scan.get("alignment") or {}).get("listening") or {}
    tot2mod, matched_bodies, qnum = {}, {}, {}
    for m in la.get("modules", []):
        tot2mod[m.get("total")] = m["module"]
        for mm in m.get("matched", []):
            b = mm["block"]
            matched_bodies.setdefault(m["module"], set()).add(b.get("body"))
            qnum.setdefault(m["module"], {})[b.get("body")] = mm["n"]

    totals = {m["module"]: m.get("total") for m in la.get("modules", [])}
    out = {}
    seen = set()
    for b in scan.get("blocks", []):
        if b.get("section") != "listening":
            continue
        mod = tot2mod.get(b.get("total"))
        if mod is None:
            continue
        body = b.get("body") or ""
        st = out.setdefault(mod, {"lcr": [], "groups": [], "orphan": []})
        if body in matched_bodies.get(mod, ()):
            q = qnum[mod][body]
            if (mod, q) in seen:
                continue
            seen.add((mod, q))
            if SCREEN_LCR_RE.search(body):
                st["lcr"].append(q)
            elif st["groups"]:
                g = st["groups"][-1]
                g["q_start"] = q if g["q_start"] is None else min(g["q_start"], q)
                g["q_end"] = q if g["q_end"] is None else max(g["q_end"], q)
            else:
                st["orphan"].append(q)
            continue
        m = SCREEN_MAT_RE.search(body)
        if m and V.nwords(body) < 60:
            kind = m.group(1).lower()
            if kind == "academic":
                kind = "talk"
            st["groups"].append({
                "type": TYPE_BY_KIND.get(kind, "lat"), "kind": kind,
                "q_start": None, "q_end": None,
                "framing": re.sub(r"\s+", " ", body.split("\n")[0]).strip(),
            })
    for mod in out:
        out[mod]["lcr"].sort()
        out[mod]["groups"] = [g for g in out[mod]["groups"] if g["q_start"] is not None]
        out[mod]["total"] = totals.get(mod)
    return out


# ETS 每种材料固定带几题（真题 28 个 module 逐个验过，无一例外）。
QS_PER_TYPE = {"lc": 2, "la": 2, "lat": 4}


def derive_groups(sections, n_lcr, module_total):
    """按「LCR 若干题 + 各材料固定题量」推每组的题号区间，并用**总题数**当校验和。

    为什么不能只靠屏幕上的「Listen to a conversation」材料屏认组：那一屏在
    3.14 那种版式里是独立一屏（认得出），但在 1.21A 那种合集卷里被 OCR 与题目屏糊成
    一块、甚至把 "Listen to an announcement" 劈成 "Listen to an al" + "nnouncement…"，
    认不全。而逐字稿的段序是干净的，ETS 的题量又是固定的（对话/通知 2 题、讲座 4 题），
    于是「LCR 数 + Σ 各段题量 == 该 module 的总题数」就是一条**自带校验和**的推导：
    稿子少一段、多一段、LCR 数错了，总数立刻对不上，整个 module 扣下。

    对不上返回 None（交给调用方退回屏幕材料屏那条路或整体扣下）。
    """
    if not module_total:
        return None
    need = n_lcr + sum(QS_PER_TYPE.get(s["type"], 0) for s in sections)
    if need != module_total:
        return None
    q = n_lcr + 1
    groups = []
    for s in sections:
        k = QS_PER_TYPE[s["type"]]
        groups.append({"type": s["type"], "kind": s["kind"], "q_start": q, "q_end": q + k - 1,
                       "framing": ""})
        q += k
    return groups


# ══ 序列对齐 ═════════════════════════════════════════════════════════════
def align_sections(section_texts, asr_words):
    """逐字稿各段（按顺序） ↔ 音频整块转写 的词级序列对齐。

    返回逐段 {"sim", "span": (词起, 词止) 或 None, "problems": [...]}。
    对齐用 difflib 的最长公共子序列（一次动态规划），映射**天然单调**；
    余下要查的是「这一段是不是真被命中」与「区间有没有塌陷/倒退」。
    """
    pdf_words, owner = [], []
    for i, t in enumerate(section_texts):
        w = V.norm(t).split()
        pdf_words.extend(w)
        owner.extend([i] * len(w))
    n = len(section_texts)
    hit = [0] * n
    span = [[None, None] for _ in range(n)]
    total = [0] * n
    for i in owner:
        total[i] += 1
    if pdf_words and asr_words:
        sm = difflib.SequenceMatcher(None, pdf_words, asr_words, autojunk=False)
        for a, b, size in sm.get_matching_blocks():
            for k in range(size):
                i = owner[a + k]
                hit[i] += 1
                j = b + k
                if span[i][0] is None or j < span[i][0]:
                    span[i][0] = j
                if span[i][1] is None or j > span[i][1]:
                    span[i][1] = j

    spans = [tuple(span[i]) if span[i][0] is not None else None for i in range(n)]
    order_p = span_order_problems(spans)
    out = []
    for i in range(n):
        p = []
        s = round(hit[i] / total[i], 3) if total[i] else 0.0
        if total[i] == 0:
            p.append("empty_section")
        elif s < SIM_MIN:
            p.append("transcript_mismatch:sim=%.3f" % s)
        p.extend(order_p[i])
        out.append({"sim": s, "span": spans[i], "problems": p})
    return out


def span_order_problems(spans):
    """区间序列的单调性检查（抽出来是为了能单独测）。

    difflib 的最长公共子序列本身保证单调，所以正常路径上这一条永远不触发 ——
    它是**防御性**的：将来若把对齐换成别的实现（分段贪心、窗口滑动…），倒序/重叠
    会立刻被这里拦住，而不是悄悄产出错位的时间区间。
    """
    out = []
    prev_end = -1
    for sp in spans:
        p = []
        if sp is None:
            p.append("no_audio_span")
        else:
            if sp[1] <= sp[0]:
                p.append("span_degenerate")
            if sp[0] < prev_end - SPAN_BACK_TOL:
                p.append("span_out_of_order")
            prev_end = max(prev_end, sp[1])
        out.append(p)
    return out


def asr_word_index(segments):
    """ASR 分段 → (词列表, 每个词属于第几段)。"""
    words, owner = [], []
    for i, s in enumerate(segments or []):
        w = V.norm(s.get("text")).split()
        words.extend(w)
        owner.extend([i] * len(w))
    return words, owner


def span_time(span, seg_owner, segments):
    if not span or not segments or not seg_owner:
        return None
    a = seg_owner[min(span[0], len(seg_owner) - 1)]
    b = seg_owner[min(span[1], len(seg_owner) - 1)]
    return [segments[a]["start"], segments[b]["end"]]


# ══ 角色判定 ═════════════════════════════════════════════════════════════
def genders_for_turns(turns, style, audio_path, segments):
    """返回 ({label: 'male'|'female'}, note)；判不出返回 (None, 原因)。"""
    labs = []
    for t in turns:
        if t["label"] not in labs:
            labs.append(t["label"])
    if len(labs) != 2:
        return None, "speaker_count:%d" % len(labs)
    if style == "gender":
        g = {}
        for l in labs:
            if l in MALE_LAB:
                g[l] = "male"
            elif l in FEMALE_LAB:
                g[l] = "female"
            else:
                return None, "unknown_label:%s" % l
        if len(set(g.values())) != 2:
            return None, "same_gender_labels"
        return g, "labels"
    if style != "ab":
        return None, "no_speaker_labels"
    if not audio_path or not segments:
        return None, "no_audio_for_diarization"
    _framing, body = V.strip_framing(segments)
    if len(body) < 3:
        body = segments
    got, why = V.diarize(audio_path, body)
    if not got:
        return None, why
    first = got[0]
    return ({labs[0]: first, labs[1]: ("female" if first == "male" else "male")},
            "diarization:%s" % why)


# ══ 组装 ═════════════════════════════════════════════════════════════════
def collect_items(structured):
    """structure_set 的听力产物 → {(module, q): item}。"""
    by_q = {}
    for r in structured.get("results", []):
        if r.get("section") != "listening":
            continue
        for it in r.get("items", []):
            q = it.get("q_number")
            if q is None:
                continue
            k = (r.get("module", 1), int(q))
            prev = by_q.get(k)
            if prev is None or len(it.get("options") or []) > len(prev.get("options") or []):
                by_q[k] = it
    return by_q


def collect_repeat(structured):
    out, ctx = {}, ""
    for r in structured.get("results", []):
        if r.get("section") != "speaking" or r.get("type") != "repeat":
            continue
        ctx = ctx or (r.get("context") or "")
        for it in r.get("items", []):
            n = it.get("n") or it.get("q_number")
            if n and it.get("sentence"):
                out[int(n)] = str(it["sentence"]).strip()
    return out, ctx


REPEAT_HDR_RE = re.compile(r"(?i)listen\s+and\s+repeat")


def answer_pdf_repeat(setdir):
    """答案 PDF 的「Speaking / Listen and repeat」编号句 → {n: sentence}。

    为什么要在这里再解析一遍：上游 ingest 是按**行**取答案的，答案 PDF 里换行的长句
    会被砍成半句（实测 3.14 第 7 句只剩「…call us on the helpline and we will」）。
    截断是前缀，与音频的词级命中率照样 1.0，对齐那关查不出来。
    这里把续行拼回去 —— 仍然是**文档来源**，没有拿 ASR 顶。
    """
    import fitz
    cands = [f for f in os.listdir(setdir)
             if "答案" in f and f.lower().endswith(".pdf")]
    if not cands:
        return {}
    text = "\n".join(p.get_text() for p in fitz.open(os.path.join(setdir, cands[0])))
    m = REPEAT_HDR_RE.search(text)
    if not m:
        return {}
    out, cur = {}, None
    for ln in text[m.end():].split("\n"):
        s = ln.strip()
        if not s:
            continue
        if CJK_RE.search(s):
            break                      # 水印行 = 这一节结束
        mm = NUMBERED_RE.match(s)
        if mm:
            n = int(mm.group(1))
            if cur is not None and n != cur + 1:
                break                  # 编号不连续 = 已经串到别的小节
            cur = n
            out[cur] = mm.group(2).strip()
        elif cur is not None:
            out[cur] = (out[cur] + " " + s).strip()
        else:
            break
    return out


def speaking_context(scan):
    """口语复述前的场景屏（"You are learning how to give a tutorial on …"）。"""
    best = ""
    for b in scan.get("blocks", []):
        if b.get("section") != "speaking":
            continue
        body = " ".join(l.strip() for l in (b.get("body") or "").split("\n")
                        if l.strip() and not CJK_RE.search(l))
        body = re.sub(r"=+\s*PAGE\s*\d+\s*=+", " ", body)
        body = re.sub(r"\s+", " ", body).strip()
        if re.search(r"(?i)listen and repeat|answer the interviewer", body):
            continue
        if V.nwords(body) >= 8 and re.search(r"(?i)^you (are|have)", body):
            return body[:300]
        if V.nwords(body) > V.nwords(best):
            best = body
    return best[:300]


BLOCKING_PREFIX = ("transcript_mismatch", "stimulus_mismatch", "diarization_failed",
                   "lcr_no_stimulus", "no_audio_span", "span_degenerate",
                   "span_out_of_order", "empty_section", "lcr_count_mismatch",
                   "group_count_mismatch", "group_kind_mismatch", "group_start_mismatch",
                   "screen_items_missing",
                   "transcript_truncated")


def _seg_slice(info, aowner, segments):
    if not info or not info.get("span") or not aowner:
        return segments
    a = aowner[min(info["span"][0], len(aowner) - 1)]
    b = aowner[min(info["span"][1], len(aowner) - 1)]
    return segments[a:b + 1] or segments


def _pack(mod, typ, q_start, q_end, got, transcript, turns, speakers,
          info, segments, aowner, problems, stats, framing=""):
    out_items = []
    for q, it in got:
        ip = []
        opts = it.get("options") or []
        if len(opts) != 4:
            ip.append("options_%d" % len(opts))
        if it.get("answer_index") is None:
            ip.append("no_answer")
        out_items.append({
            "q_number": it.get("q_number", q), "q_number_raw": q,
            "material": "", "material_kind": "audio",
            "stem": it.get("stem", ""), "options": opts,
            "answer_index": it.get("answer_index"), "answer_key": it.get("answer_key"),
            "transcript": "", "transcript_final": transcript,
            "turns": turns, "framing": framing,
            "asr_similarity": (info or {}).get("sim"),
            "problems": ip,
        })
    bad = [x for x in out_items if x["problems"]]
    if bad:
        problems = problems + ["题目字段不全：%s" % ",".join(
            "Q%s(%s)" % (x["q_number_raw"], "/".join(x["problems"])) for x in bad)]
    # 材料截断闸：逐字稿 PDF 的换行/分页会把结尾整句砍掉，而截断是**前缀**，
    # 与音频的词级命中率照样接近 1.0 —— 对齐那一关查不出来，只能靠句末标点这条形态闸。
    tail = str(transcript or "").strip()
    if tail and not re.search(r"[.?!\"'”’)]$", tail):
        problems = problems + ["transcript_truncated:%s" % tail[-40:]]
    blocking = [p for p in problems if p.startswith(BLOCKING_PREFIX)]
    if not out_items:
        blocking.append("no_items")
    if typ == "lc" and not turns:
        blocking.append("empty_turns")
    if typ != "lc" and not str(transcript or "").strip():
        blocking.append("empty_transcript")

    stats["units"] += 1
    stats["ok" if not blocking else "blocked"] += 1
    for b in blocking:
        k = b.split(":")[0]
        stats["reasons"][k] = stats["reasons"].get(k, 0) + 1
    return {
        "key": "listening|%d|%s" % (mod, q_start),
        "section": "listening", "module": mod, "type": typ,
        "q_start": q_start, "q_end": q_end if q_end is not None else q_start,
        "tier": "recalled",
        "status": "flagged" if blocking else "ok",
        "problems": problems, "merged_by": MERGER_ID,
        "framing": framing,
        "audio_span_sec": span_time((info or {}).get("span"), aowner, segments),
        "asr_similarity": (info or {}).get("sim"),
        "transcript_final": transcript, "turns": turns, "speakers": speakers,
        "items": out_items,
    }


def build_listening(scan, structured, pdf_mods, asr, audio_paths, stats):
    by_q = collect_items(structured)
    screens = screen_groups(scan)
    results = []

    for mod in sorted(screens):
        sc = screens[mod]
        doc = pdf_mods.get(mod) or {"lcr": {}, "sections": []}
        role = "listening_m%d" % mod
        a = asr.get(role) or {}
        segments = a.get("segments") or []
        awords, aowner = asr_word_index(segments)
        apath = audio_paths.get(role)

        # ── 闸 1：屏幕侧与逐字稿侧的条数/题材序列必须一致 ──────────────
        doc_lcr = doc["lcr"]
        doc_lcr_ns = sorted(doc_lcr)
        secs = doc["sections"]
        screen_g = sc["groups"]
        grp_gate = None
        groups = derive_groups(secs, len(doc_lcr), sc.get("total"))
        if groups is None:
            # 校验和对不上 → 退回「屏幕材料屏」那条路，条数/题材必须逐一对上才认
            groups = screen_g
            if len(groups) != len(secs):
                grp_gate = "group_count_mismatch:screen=%d/doc=%d/总题数校验和不符" % (
                    len(groups), len(secs))
            elif [g["type"] for g in groups] != [s["type"] for s in secs]:
                grp_gate = "group_kind_mismatch:%s vs %s" % (
                    ",".join(g["type"] for g in groups), ",".join(s["type"] for s in secs))
        elif len(screen_g) == len(groups) and \
                [g["q_start"] for g in screen_g] != [g["q_start"] for g in groups]:
            # 屏幕上材料屏认全了的卷（3.14 那种版式）再对一次起始题号，两条路必须同解
            grp_gate = "group_start_mismatch:screen=%s/derived=%s" % (
                [g["q_start"] for g in screen_g], [g["q_start"] for g in groups])

        # LCR 的题号：校验和过了就是确定的 1..n（真题 LCR 永远排在 module 最前面）。
        # 不能拿「屏幕上认出来的 LCR 题号」按序号去配稿子里的第 i 句 —— 2.1C 的 OCR 只在
        # 12 屏里认出 2 屏带 "Choose the best response"（Q1 与 Q12），按序号配就成了
        # 「Q12 配第 2 句」，刺激句与选项对不上，盲审一致率当场掉到 72%。
        lcr_gate = None
        if groups is not None and not grp_gate:
            lcr_qs = list(range(1, len(doc_lcr) + 1))
            stray = [q for q in sc["lcr"] if q not in lcr_qs]
            if stray:
                lcr_gate = "lcr_count_mismatch:屏幕上的 LCR 题号 %s 不在 1..%d 内" % (
                    stray, len(doc_lcr))
        else:
            lcr_qs = sc["lcr"]
            if len(lcr_qs) != len(doc_lcr):
                lcr_gate = "lcr_count_mismatch:screen=%d/doc=%d" % (len(lcr_qs), len(doc_lcr))

        # ── 闸 2：逐字稿各段 ↔ 音频 的序列对齐 ────────────────────────
        order = [("lcr", n, doc_lcr[n]) for n in doc_lcr_ns]
        order += [("sec", i, s["body"]) for i, s in enumerate(secs)]
        al = align_sections([t for _, _, t in order], awords)
        al_by = {(kind, key): r for (kind, key, _), r in zip(order, al)}
        stats["align_total"] += len(order)
        stats["align_ok"] += sum(1 for r in al if not r["problems"])

        # ── LCR ────────────────────────────────────────────────────────
        for idx, q in enumerate(lcr_qs):
            n = doc_lcr_ns[idx] if idx < len(doc_lcr_ns) else None
            it = by_q.get((mod, q))
            problems = [lcr_gate] if lcr_gate else []
            stim = doc_lcr.get(n, "") if n is not None else ""
            info = al_by.get(("lcr", n)) if n is not None else None
            if info:
                problems += [p.replace("transcript_mismatch", "stimulus_mismatch")
                             for p in info["problems"]]
            if not stim:
                problems.append("lcr_no_stimulus")
            results.append(_pack(mod, "lcr", q, q, [(q, it)] if it else [], stim, None, None,
                                 info, segments, aowner, problems, stats))

        # ── 材料组 ─────────────────────────────────────────────────────
        for i, g in enumerate(groups):
            sec = secs[i] if (not grp_gate and i < len(secs)) else None
            problems = [grp_gate] if grp_gate else []
            info = al_by.get(("sec", i)) if sec else None
            if info:
                problems += list(info["problems"])
            qs = list(range(g["q_start"], (g["q_end"] if g["q_end"] is not None else g["q_start"]) + 1))
            got = [(q, by_q.get((mod, q))) for q in qs]
            missing = [q for q, it in got if not it]
            if missing:
                problems.append("screen_items_missing:M%dQ%s" % (mod, ",".join(map(str, missing))))
            got = [(q, it) for q, it in got if it]

            turns = speakers = None
            transcript = ""
            if sec:
                if g["type"] == "lc":
                    raw, style = parse_turns(sec["body"])
                    seg_slice = _seg_slice(info, aowner, segments)
                    gmap, note = (None, "no_turns")
                    if raw:
                        gmap, note = genders_for_turns(raw, style, apath, seg_slice)
                    if not gmap:
                        problems.append("diarization_failed:%s" % note)
                    else:
                        problems.append(note)
                        turns = V.merge_same_speaker([
                            {"speaker": "Man" if gmap[t["label"]] == "male" else "Woman",
                             "text": V.sentence_case(t["text"])} for t in raw])
                        names = []
                        for t in turns:
                            if t["speaker"] not in names:
                                names.append(t["speaker"])
                        if len(names) < 2:
                            problems.append("diarization_failed:只有一个说话人")
                            turns = None
                        else:
                            speakers = [{"name": nm, "role": "student",
                                         "gender": "male" if nm == "Man" else "female"}
                                        for nm in ("Man", "Woman")]
                            transcript = "\n".join("%s: %s" % (t["speaker"], t["text"])
                                                   for t in turns)
                else:
                    transcript = strip_question_tail(
                        strip_framing_text(sec["body"]),
                        [it.get("stem") for _, it in got])
            results.append(_pack(mod, g["type"], g["q_start"], g["q_end"], got,
                                 transcript, turns, speakers, info, segments, aowner,
                                 problems, stats, framing=g.get("framing", "")))
    return results


def build_speaking(scan, structured, asr, stats, answer_sents=None):
    sents, ctx = collect_repeat(structured)
    # 答案 PDF 重解析出来的整句优先（只在它是当前这句的**延长**时才换，防止串号）
    for n, full in (answer_sents or {}).items():
        cur = sents.get(n)
        if cur and full and full != cur and V.norm(full).startswith(V.norm(cur)):
            sents[n] = full
            stats["repeat_unwrapped"] += 1
        elif not cur and full:
            sents[n] = full
            stats["repeat_from_answer_pdf"] += 1
    ctx = speaking_context(scan) or ctx
    results = []
    a = asr.get("speaking") or {}
    awords, _ = asr_word_index(a.get("segments") or [])
    ns = sorted(sents)
    al = align_sections([sents[n] for n in ns], awords) if ns else []

    items, problems = [], []
    for i, n in enumerate(ns):
        text = sents[n]
        info = al[i] if i < len(al) else {"sim": None, "problems": ["no_audio_span"]}
        ip = [p.replace("transcript_mismatch", "sentence_mismatch") for p in info["problems"]]
        usable = not any(p.startswith(("sentence_mismatch", "no_audio_span", "span_degenerate",
                                       "span_out_of_order", "empty_section")) for p in ip)
        if usable and not (3 <= V.nwords(text) <= 25):
            usable = False
            ip.append("sentence_word_count:%d" % V.nwords(text))
        # 复述句必须有句末标点。答案 PDF 的换行会把长句截半（实测 3.14 第 7 句只剩
        # "…call us on the helpline and we will"），而截断是**前缀**，与 ASR 的
        # 命中率照样 1.0 —— 对齐这一关查不出来，只能靠这条形态闸。
        if usable and not re.search(r"[.?!\"'”’)]$", text.strip()):
            usable = False
            ip.append("sentence_truncated:no_end_punct")
        items.append({"n": n, "q_number": n, "sentence": text,
                      "sentence_final": text if usable else "", "usable": usable,
                      "transcript_final": text if usable else "",
                      "asr_similarity": info.get("sim"), "problems": ip})
    if items:
        bad = [it for it in items if not it["usable"]]
        if bad:
            problems.append("不可用句 %d 条（%s）"
                            % (len(bad), ",".join("Q%d" % it["n"] for it in bad)))
        ok_n = len(items) - len(bad)
        results.append({
            "key": "speaking|1|repeat|1", "section": "speaking", "module": 1, "type": "repeat",
            "q_start": 1, "q_end": len(items), "tier": "recalled",
            "status": "ok" if ok_n >= 5 else "flagged",
            "problems": problems, "merged_by": MERGER_ID,
            "context": ctx, "items": items,
        })
        stats["repeat_sets"] += 1
        stats["repeat_sentences"] += len(items)
        stats["repeat_ok"] += ok_n

    # 面试题：第一来源的题干只在音频里，**没有任何文档 ground truth**
    #（答案 PDF 只抄了复述句，逐字稿 PDF 只有听力两个 module）。
    # 第二来源的口径是「文档没有就 hold，不拿 ASR 顶」——这里照办，整组扣下。
    iv = [r for r in structured.get("results", []) if r.get("section") == "speaking"
          and r.get("type") == "interview"]
    if iv:
        results.append({
            "key": "speaking|1|interview|1", "section": "speaking", "module": 1,
            "type": "interview", "q_start": 1, "q_end": len(iv), "tier": "recalled",
            "status": "flagged", "merged_by": MERGER_ID,
            "problems": ["no_stem_in_doc:第一来源没有面试题干的文档来源，按第二来源口径整组扣下"],
            "context": ctx, "items": [],
        })
        stats["interview_held"] += len(iv)
    return results


# ══ 主流程 ═══════════════════════════════════════════════════════════════
def load_pdf_text(setdir):
    import fitz
    cands = [f for f in os.listdir(setdir) if "听力原文" in f and f.lower().endswith(".pdf")]
    if not cands:
        return None
    doc = fitz.open(os.path.join(setdir, cands[0]))
    return "\n".join(p.get_text() for p in doc)


def new_stats():
    return {"units": 0, "ok": 0, "blocked": 0, "reasons": {},
            "align_total": 0, "align_ok": 0,
            "repeat_sets": 0, "repeat_sentences": 0, "repeat_ok": 0,
            "repeat_unwrapped": 0, "repeat_from_answer_pdf": 0,
            "interview_held": 0}


def process_set(setkey, args, totals):
    scan_path = os.path.join(OUT_DIR, "%s.json" % setkey)
    st_path = os.path.join(OUT_DIR, "%s.structured.json" % setkey)
    rw_path = os.path.join(OUT_DIR, "%s.structured.rw.json" % setkey)
    fs_path = os.path.join(OUT_DIR, "%s.structured.fs_parsed.json" % setkey)
    for p in (scan_path, st_path):
        if not os.path.exists(p):
            print("  跳过 %s：缺 %s" % (setkey, os.path.basename(p)))
            return None
    setdir = os.path.join(asr_cache.SRC_ROOT, setkey)
    if not os.path.isdir(setdir):
        print("  跳过 %s：找不到源目录" % setkey)
        return None

    with open(scan_path, encoding="utf-8") as fh:
        scan = json.load(fh)
    # 幂等：听力/口语原始产物只存一次，之后永远从它出发
    if not os.path.exists(fs_path):
        shutil.copyfile(st_path, fs_path)
    with open(fs_path, encoding="utf-8") as fh:
        parsed = json.load(fh)
    if not any(r.get("section") in ("listening", "speaking") for r in parsed.get("results", [])):
        print("  跳过 %s：structured 里没有听力/口语产物"
              "（先跑 structure_set --sections listening,speaking）" % setkey)
        return None

    text = load_pdf_text(setdir)
    if not text:
        print("  跳过 %s：找不到「听力原文」PDF" % setkey)
        return None
    pdf_mods = parse_transcript_pdf(text)

    roles = asr_cache.audio_roles(setdir)
    asr = {}
    for role in ("listening_m1", "listening_m2", "speaking"):
        p = asr_cache.cache_path(setkey, role)
        if os.path.exists(p):
            with open(p, encoding="utf-8") as fh:
                asr[role] = json.load(fh)
    if "listening_m1" not in asr:
        print("  跳过 %s：还没转写（先跑 asr_cache.py）" % setkey)
        return None

    stats = new_stats()
    listening = build_listening(scan, parsed, pdf_mods, asr, roles, stats)
    speaking = build_speaking(scan, parsed, asr, stats, answer_pdf_repeat(setdir))

    ar = (stats["align_ok"] / stats["align_total"]) if stats["align_total"] else 0.0
    line = ("  %s：对齐 %d/%d（%.0f%%）；听力 %d 组（可落库 %d / 扣下 %d）；"
            "复述 %d 句（可用 %d）；面试 %d 题扣下"
            % (setkey, stats["align_ok"], stats["align_total"], ar * 100,
               stats["units"], stats["ok"], stats["blocked"],
               stats["repeat_sentences"], stats["repeat_ok"], stats["interview_held"]))
    if args.dry_run:
        print(line + "（--dry-run，未写盘）")
        if stats["reasons"]:
            print("     扣下原因：%s" % stats["reasons"])
        totals.append((setkey, stats))
        return stats

    with open(rw_path if os.path.exists(rw_path) else fs_path, encoding="utf-8") as fh:
        base = json.load(fh)
    results = [r for r in base.get("results", []) if r.get("section") in ("reading", "writing")]
    results.extend(listening)
    results.extend(speaking)
    tally = {}
    for r in results:
        tally[r.get("status")] = tally.get(r.get("status"), 0) + 1
    out = {"set": setkey, "model": base.get("model"), "tally": tally, "results": results,
           "merged_asr": {"merger": MERGER_ID, "asr_files": len(asr),
                          "proofread": False, "stats": stats}}
    shutil.copyfile(st_path, os.path.join(OUT_DIR, "%s.structured.prev.json" % setkey))
    with open(st_path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(line + " → 已写回")
    if stats["reasons"]:
        print("     扣下原因：%s" % stats["reasons"])
    totals.append((setkey, stats))
    return stats


FIRST_SOURCE_SETS = [
    "1.21新托福真题A卷", "1.21新托福真题B卷", "1.21新托福真题C卷",
    "1.27新托福真题A卷", "1.27新托福真题B卷",
    "1.28新托福真题A卷", "1.28新托福真题B卷",
    "2.1新托福真题A卷", "2.1新托福真题B卷", "2.1新托福真题C卷",
    "2.2新托福真题", "2.10新托福真题", "2.28新托福真题", "3.14新托福真题",
]


# ══ 自检（__tests__/realbank-first-source-merge.test.js 调这个） ══════════
def self_test():
    fails = []

    def check(name, cond, extra=""):
        if not cond:
            fails.append("%s -> %r" % (name, extra))

    words = "alpha bravo charlie delta echo foxtrot golf hotel india juliet".split()
    r = align_sections([" ".join(words[:5]), " ".join(words[5:])], words)
    check("对齐正确", all(not x["problems"] for x in r) and r[0]["sim"] == 1.0, r)
    check("区间单调", r[0]["span"][1] < r[1]["span"][0], r)

    r = align_sections([" ".join(words[:5]), "zulu yankee xray whiskey victor"], words)
    check("相似度低扣下",
          any(p.startswith("transcript_mismatch") or p == "no_audio_span"
              for p in r[1]["problems"]), r[1])

    # 顺序颠倒的稿子：LCS 只能命中其中一段，另一段直接对不上 → 扣下
    r = align_sections([" ".join(words[5:]), " ".join(words[:5])], words)
    check("顺序颠倒扣下", bool(r[1]["problems"]), r[1])
    # 区间倒序/重叠/塌陷的独立闸（防御性，直接测纯函数）
    op = span_order_problems([(0, 10), (30, 40), (5, 9), (50, 50)])
    check("区间倒序扣下", "span_out_of_order" in op[2], op)
    check("区间塌陷扣下", "span_degenerate" in op[3], op)
    check("区间缺失扣下", "no_audio_span" in span_order_problems([None])[0], op)

    scan = {"alignment": {"listening": {"modules": [{"module": 1, "total": 2, "matched": [
        {"n": 1, "answer": "a", "block": {"section": "listening", "start": 1, "end": 1,
                                          "total": 2, "body": "Q1 stem\nopt"}},
        {"n": 2, "answer": "b", "block": {"section": "listening", "start": 2, "end": 2,
                                          "total": 2, "body": "Q2 stem\nopt"}}]}]}},
            "blocks": [
                {"section": "listening", "total": 2, "start": 1, "end": 1,
                 "body": "Listen to a conversation"},
                {"section": "listening", "total": 2, "start": 1, "end": 1, "body": "Q1 stem\nopt"},
                {"section": "listening", "total": 2, "start": 2, "end": 2, "body": "Q2 stem\nopt"}]}
    sg = screen_groups(scan)
    check("屏幕分组", len(sg[1]["groups"]) == 1 and sg[1]["groups"][0]["q_start"] == 1
          and sg[1]["groups"][0]["q_end"] == 2, sg)

    structured = {"results": [{"section": "listening", "module": 1, "items": [
        {"q_number": 1, "stem": "s1", "options": ["a", "b", "c", "d"], "answer_index": 0},
        {"q_number": 2, "stem": "s2", "options": ["a", "b", "c", "d"], "answer_index": 1}]}]}
    pdf = {1: {"lcr": {}, "sections": [
        {"kind": "conversation", "type": "lc", "ordinal": 1, "body": "Man: hi. Woman: hello."},
        {"kind": "lecture", "type": "lat", "ordinal": 1, "body": "extra section"}]}}
    stats = new_stats()
    res = build_listening(scan, structured, pdf, {"listening_m1": {"segments": []}}, {}, stats)
    check("段数不符扣下", res and res[0]["status"] == "flagged"
          and any(p.startswith("group_count_mismatch") for p in res[0]["problems"]), res)

    # 题号区间推导 + 总题数校验和
    secs3 = [{"type": "lc", "kind": "conversation"}, {"type": "la", "kind": "announcement"},
             {"type": "lat", "kind": "lecture"}]
    g = derive_groups(secs3, 12, 20)          # 12 + 2 + 2 + 4 = 20
    check("题号区间推导", g and [(x["q_start"], x["q_end"]) for x in g]
          == [(13, 14), (15, 16), (17, 20)], g)
    check("校验和不符返回 None", derive_groups(secs3, 12, 21) is None,
          derive_groups(secs3, 12, 21))
    check("缺一段就对不上", derive_groups(secs3[:2], 12, 20) is None, "")

    # 材料截断闸：结尾没有句末标点 → 扣下（截断是前缀，对齐那关查不出来）
    stats = new_stats()
    r = _pack(1, "la", 1, 1, [(1, {"q_number": 1, "stem": "s", "options": list("abcd"),
                                   "answer_index": 0})],
              "Attention residents. The work will be", None, None,
              {"sim": 1.0, "span": (0, 5)}, [], [], [], stats)
    check("材料截断扣下", r["status"] == "flagged"
          and any(p.startswith("transcript_truncated") for p in r["problems"]), r["problems"])

    turns, style = parse_turns("Listen to a conversation. hello there how are you")
    check("无标签识别", style == "none", (turns, style))
    g, why = genders_for_turns([{"label": "a", "text": "x"}, {"label": "b", "text": "y"}],
                               "none", None, [])
    check("无标签扣下", g is None, why)
    g, why = genders_for_turns([{"label": "a", "text": "x"}, {"label": "b", "text": "y"}],
                               "ab", None, [])
    check("A/B 无音频扣下", g is None and why == "no_audio_for_diarization", why)

    t = ("Module1\nChoose the best response.\n1. Where are you?\n2. Man: Who is it?\n"
         "Conversation1\nA: hi. B: hello.\n13. What?\nLecture1\nListen to a talk. Body here.\n"
         "Module2\nChoose the best response.\n1. Only one.\nConversation1\nMan: a b c. Woman: d e f.\n")
    m = parse_transcript_pdf(t)
    check("LCR 解析", m[1]["lcr"] == {1: "Where are you?", 2: "Who is it?"}, m[1]["lcr"])
    check("题号行截断", m[1]["sections"][0]["body"] == "A: hi. B: hello.", m[1]["sections"][0])
    check("时间戳标记剥离",
          parse_transcript_pdf("Lecture1\nBody one. { 1:52 } Body two.\n")[1]["sections"][0]["body"]
          == "Body one. Body two.",
          parse_transcript_pdf("Lecture1\nBody one. { 1:52 } Body two.\n")[1]["sections"][0])
    check("串进来的题干剪掉",
          strip_question_tail("Body text here. What is the main topic of the talk?",
                              ["What is the main topic of the talk?"]) == "Body text here.",
          strip_question_tail("Body text here. What is the main topic of the talk?",
                              ["What is the main topic of the talk?"]))
    check("讲座自己的反问句不剪",
          strip_question_tail("So why does it matter? Because it does.", ["What is the topic?"])
          == "So why does it matter? Because it does.", "")
    check("分号说话人标签", parse_turns("B; hello there. A; hi back.")[1] == "ab",
          parse_turns("B; hello there. A; hi back."))
    check("框架句剥离", m[1]["sections"][1]["body"] == "Listen to a talk. Body here."
          and strip_framing_text(m[1]["sections"][1]["body"]) == "Body here.",
          m[1]["sections"][1])
    check("module2 分开", len(m[2]["sections"]) == 1 and m[2]["lcr"] == {1: "Only one."}, m[2])
    tr, sty = parse_turns(m[2]["sections"][0]["body"])
    check("Man/Woman 标签", sty == "gender" and len(tr) == 2, (tr, sty))
    gm, why = genders_for_turns(tr, sty, None, [])
    check("按标签定性别", gm == {"man": "male", "woman": "female"}, (gm, why))

    if fails:
        print("SELF-TEST FAILED:")
        for f in fails:
            print(" -", f)
        return 1
    print("SELF-TEST OK")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", action="append", default=None)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    sets = args.set or (FIRST_SOURCE_SETS if args.all else None)
    if not sets:
        print("用法: merge_first_source_asr.py --set <卷名> | --all [--dry-run]")
        return 2
    print("■ 第一来源听力/口语合流%s" % ("（--dry-run）" if args.dry_run else ""))
    totals = []
    for s in sets:
        process_set(s, args, totals)
    if totals:
        at = sum(x["align_total"] for _, x in totals)
        ao = sum(x["align_ok"] for _, x in totals)
        print("\n合计：对齐 %d/%d（%.0f%%）；听力 %d 组可落库 %d；复述 %d 句可用 %d；面试扣下 %d"
              % (ao, at, (ao / at * 100 if at else 0),
                 sum(x["units"] for _, x in totals), sum(x["ok"] for _, x in totals),
                 sum(x["repeat_sentences"] for _, x in totals),
                 sum(x["repeat_ok"] for _, x in totals),
                 sum(x["interview_held"] for _, x in totals)))
        print("DeepSeek 校对调用 0 次（第一来源逐字稿是全文，不需要 ASR 校对）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
