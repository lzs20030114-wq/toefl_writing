#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""真题录入 —— 数字卷「整块录音、没有听力原文」的听力合流。

现有两条合流各认一种源料形状，都认不了这一批：
  merge_vendor_asr.py        第二来源 rf/rp：商家逐题切好的 mp3，拿**文件名**当分组依据；
  merge_first_source_asr.py  第一来源 14 套：ListeningModule1/2.mp3 +「听力原文」PDF，拿**逐字稿分段**当依据。
2026-09-16 体检：3.2A~5.29 这 38 套听力（1656 题，全库缺口最大的一桶）每套只有一条「听力.m4a」——
考场视角的整场录音，两个 module 连在一起，**没有逐字稿、没有逐题音频**。build_bank 只收带 merged_asr 的卷，
于是这 38 套一题都进不了库。

这条合流补的就是缺的那份「逐字稿分段」，来源换成录音本身，分段靠 ETS 考试流程自证：

  1. **静音切岛**：本机 faster-whisper（medium.en，词级时间戳，零 API 费用）转写整条录音，按 ≥4 秒静音切成
     「岛」。考场流程天然留白：LCR 每句后 15~25s 作答、每段材料后 15~30s 做题、两个 module 之间 ~90s；
     材料内部换人 / 换句的停顿不到 2 秒。
  2. **旁白定题材**：材料岛以 ETS 旁白开头（"Listen to a conversation." / "Listen to an announcement at …" /
     "Listen to a talk in a biology class."），题材 = 旁白里最先出现的 conversation / announcement /
     talk|lecture|discussion|podcast|class。短岛（≤25 词、无旁白）= LCR 刺激句；音量调试之类的操作提示丢掉。
  3. **蓝图 + 总题数双校验**：岛序列按「LCR 若干 → 材料若干」切成 module，与 2026 蓝图
     （lib/realExam/blueprint.mjs：M1 = 12 LCR + 3 LC + 3 LA + 2 LAT；M2 A 型 = 3 + 2 LC + 2 LAT，
     B 型 = 7 + 1 LAT + 2 段 la|lc）逐段比题材，再用屏幕侧该 module 的总题数当校验和。
     旁白被 VAD 吃掉的材料按蓝图位置补题材；旁白认出的题材与蓝图矛盾 → 整个 module 扣下。

分完段以后**完全复用** merge_first_source_asr.build_listening（屏幕 ↔ 分段的条数 / 起始题号闸、题目字段闸、
截断闸、对话角色闸一个不少），只是把「逐字稿 PDF 的分段」换成「录音的分段」。对话没有 Man/Woman 标签：
逐句算基频二分（merge_vendor_asr.diarize：两簇中位差 ≥50Hz、必须轮流交替），判不出就扣下。

**跨卷近似重复**：机经大量共题（source-flags 的 duplicate_cluster：「按题内容去重，不要按套丢弃」）。
ASR 文本与库里文档来源的同一段材料不会逐字相同，build_bank 的逐字去重拦不住，会把同一段对话以两个 id
收两遍。所以这里拿库里同题型的现有条目比一遍，命中就在记录上写 `dup_of` —— build_bank 见到它只记别名
（槽位照样算这套卷的），不再收一份 ASR 版：
  · 对话 / 通知 / 讲座：词级相似度 ≥0.9 且长度比在 0.8~1.25；
  · LCR：归一化后逐字相同；或刺激句相似度 ≥0.75 **且**四个选项与库里那条一致（选项是屏幕 OCR 来的，
    ASR 听错一个词的同一道题靠选项认得出来，只差一个词的两道不同题则选项对不上）。

产物（全部在 .codex-tmp，不进 git）：
  · `<卷>.structured.json` 的 listening 段就地改写 + `merged_asr` 标记；
    `<卷>.structured.fs_parsed.json` = structure_set 的原始产物快照（只存一次，之后永远从它重建，幂等；
    structure_set 事后重扫听力会经 structured_io 同步进这份快照）。
  · `asr-recording/<卷>/listening.json`：整条录音的词级转写缓存（重跑零成本）。
  · `asr/<卷>/listening_m{1,2}.json` + `asr-words/<卷>/listening_m{1,2}.json`：按 module 切开的段级 / 词级转写
    （时间戳仍是整条录音的绝对时间，file 指向那条录音）。bind_original_audio.mjs 的第一来源分支直接拿它们
    从这条录音里切真人原声 —— 不需要任何 TTS。

用法：
  python scripts/realbank/merge_recording_asr.py --set "3.16新托福真题" --dry-run
  python scripts/realbank/merge_recording_asr.py --set "3.16新托福真题"
  python scripts/realbank/merge_recording_asr.py --self-test
"""
import os
import re
import sys
import json
import time
import shutil
import argparse
import difflib
import functools

# scripts/ops/__pycache__ 里有被 git 跟踪的 .pyc，导入 audio_transcribe 时别去改写它们
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import merge_vendor_asr as V  # noqa: E402  （norm/nwords/diarize/sentence_case/merge_same_speaker）
import merge_first_source_asr as F  # noqa: E402  （build_listening/derive_groups/QS_PER_TYPE）
import asr_cache  # noqa: E402  （SRC_ROOT 口径统一）

ROOT = V.ROOT
OUT_DIR = V.OUT_DIR
MERGER_ID = "merge_recording_asr-v1"
REC_DIR = os.path.join(OUT_DIR, "asr-recording")
ASR_DIR = os.path.join(OUT_DIR, "asr")
WORDS_DIR = os.path.join(OUT_DIR, "asr-words")
LISTENING_BANK = os.path.join(ROOT, "data", "realBank", "listening")

WHISPER_MODEL = os.environ.get("REALBANK_WORDS_MODEL", "medium.en")
# speech_pad_ms 放大到 1 秒：默认值下 VAD 会削掉句首弱读词（3.16 M2 Q1 "Are you attending…" 只剩
# "you attending…"），甚至把一整句旁白吞掉（同卷艺术课讲座的 "Listen to a talk in an art … class."）。
VAD_PARAMS = dict(min_silence_duration_ms=500, speech_pad_ms=1000)

AUDIO_EXT = (".m4a", ".mp3", ".wav", ".aac", ".flac")
ISLAND_GAP = 4.0        # 岛与岛之间的最短静音（秒）
MAT_MIN_WORDS = 40      # 没认出旁白时，够这么长才当材料
LCR_MAX_WORDS = 25      # LCR 刺激句的最长词数
NOISE_MAX_WORDS = 2     # 一两个词的孤岛 = ASR 残片（真题最短刺激句 3 词）
CUE_MAX_WORDS = 16      # 旁白句的最长词数
# 开场音量说明的最长词数：2.25 那段「To adjust the volume, select the volume icon…」71 词，旧上限 60 把它当成了材料，
# 整个 M1 平白多出一段。真材料里不会出现音量调试的说法，放宽不会误吞材料。
INTRO_MAX_WORDS = 120

DUP_MIN_SIM = 0.9
DUP_LEN_RATIO = (0.8, 1.25)
LCR_DUP_STIM_SIM = 0.75
LCR_DUP_OPT_SIM = 0.9

# 开场 / 换 module 的操作提示。刻意不收单个 "volume"：3.16 的 LCR 真有一句 "Can you turn down the volume?"
INTRO_RE = re.compile(
    r"(?i)(select the volume|volume (icon|control)|listening section|you will (answer|now hear|hear|listen)"
    r"|types of tasks|return to previous|\bmodule\s*\d|\bdirections\b|in this (part|section)"
    r"|now (begin|start)|this is the end"
    # 另一种音量调试的说法（4.8 "You'll be able to change the volume during the test…"；
    # 3.20 同一句被转写成 "You now have the option to adjust all."）——漏认会被当成第 13 句 LCR，整个 M1 对不上蓝图
    r"|change the volume|adjust the volume|option to adjust|during the test if you need)")
CUE_HEAD_RE = re.compile(r"(?i)^\s*(?:now\s*,?\s*)?(?:listen\b|to\s+(?:a|an|the|part)\b)")
KIND_WORDS = (("conversation", "lc"), ("announcement", "la"), ("talk", "lat"), ("lecture", "lat"),
              ("discussion", "lat"), ("podcast", "lat"), ("presentation", "lat"), ("class", "lat"))

# 2026 蓝图的听力段序（lib/realExam/blueprint.mjs 的 LISTENING；mcq2 = la 或 lc 都行）。
# 改蓝图要同步这里 —— self-test 钉着总题数 32 / 15。
BLUEPRINT = {
    1: ({"form": "A", "lcr": 12, "mats": ("lc", "lc", "lc", "la", "la", "la", "lat", "lat")},),
    2: ({"form": "A", "lcr": 3, "mats": ("lc", "lc", "lat", "lat")},
        {"form": "B", "lcr": 7, "mats": ("lat", "mcq2", "mcq2")}),
}

ABBREV = {"mr.", "mrs.", "ms.", "dr.", "st.", "prof.", "a.m.", "p.m.", "e.g.", "i.e.", "vs.", "jr.", "sr."}
END_RE = re.compile(r"[.?!][\"'”’)\]]*$")
DIARIZE_PREFIX = ("diarization_failed", "empty_turns")


# ══ 纯函数：切句 / 切岛 / 认旁白 / 分 module ══════════════════════════════
def is_sentence_end(tok):
    t = str(tok or "").strip().lower()
    if t in ABBREV or re.fullmatch(r"(?:[a-z]\.){2,}", t):
        return False
    return bool(END_RE.search(t))


GLUE_RE = re.compile(r"^(?:[-.,%?!:;)\]]|'(?:s|re|ve|ll|d|t|m)\b)", re.I)


def join_words(ws):
    """词级 token 拼回文本。转写缓存里的 token 去掉了前导空格，续写片段（"-hop"、".m."、"'s"）
    再用空格一拼就成了 "Hip -hop" / "7 a .m."；这几类前面不加空格。"""
    out = ""
    for w in ws:
        t = w["w"]
        if out and not GLUE_RE.match(t) and not out.endswith(("-", "(", "$", "/")):
            out += " "
        out += t
    return out.strip()


def sentences(words):
    """词序列 → 句 [{start, end, text}]（按词尾标点断句）。"""
    out, cur = [], []
    for w in words:
        cur.append(w)
        if is_sentence_end(w["w"]):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return [{"start": s[0]["start"], "end": s[-1]["end"], "text": join_words(s)} for s in out]


def split_islands(words, gap=ISLAND_GAP):
    out = []
    for w in words:
        if out and w["start"] - out[-1][-1]["end"] < gap:
            out[-1].append(w)
        else:
            out.append([w])
    return out


def parse_cue(sents):
    """岛的首句是不是 ETS 旁白 → (题材, 旁白原句)；不是返回 (None, "")。"""
    if not sents:
        return None, ""
    first = sents[0]["text"]
    if V.nwords(first) > CUE_MAX_WORDS or "?" in first or not CUE_HEAD_RE.match(first):
        return None, ""
    low = first.lower()
    hits = []
    for word, typ in KIND_WORDS:
        m = re.search(r"\b%ss?\b" % word, low)
        if m:
            hits.append((m.start(), typ))
    if not hits:
        return None, ""
    typ = min(hits)[1]
    cue = first.strip()
    if not re.match(r"(?i)^\s*(?:now\s*,?\s*)?listen\b", cue):
        cue = "Listen " + cue          # VAD 削掉了 "Listen"，只剩 "to a talk in …"
    return typ, cue


LISTEN_FRAG_RE = re.compile(r"(?i)^(?:now,?\s+)?listen[.,]?$")


def reattach_cues(islands):
    """词级时间戳跨长静音错位的补救：旁白（或旁白的头一个词）被挂到了**上一岛**的尾巴上。

    实测 3.16 生物课讲座末尾多出一个 "Listen"，下一岛只剩 "to a talk in an … class." ——
    不挪回去，讲座的截断闸（结尾必须是句末标点）先报错，下一段的旁白也认不全。
    两种形状都挪：尾句本身就是完整旁白；或尾巴只是孤零零的 "Listen" 而下一岛以 "to a/an/the" 开头。
    """
    out = [list(ws) for ws in islands]
    for i in range(len(out) - 1):
        cur, nxt = out[i], out[i + 1]
        if not cur or not nxt:
            continue
        sents = sentences(cur)
        # 下一岛自己就以旁白开头 → 上一岛的尾句只是正文里恰好像旁白的一句
        # （通知结尾 "Listen to the lecture recording before class."），不挪，否则通知丢了末句
        nxt_has_cue = bool(parse_cue(sentences(nxt))[0]) or bool(split_unpunctuated_cue(nxt))
        if len(sents) >= 2 and not nxt_has_cue and parse_cue(sents[-1:])[0]:
            k = len(cur) - len([w for w in cur if w["start"] >= sents[-1]["start"]])
            out[i + 1] = cur[k:] + nxt
            out[i] = cur[:k]
            continue
        tail = cur[-1]["w"]
        if (len(cur) >= 2 and LISTEN_FRAG_RE.match(tail) and is_sentence_end(cur[-2]["w"])
                and re.match(r"(?i)^to$", nxt[0]["w"]) and len(nxt) > 1
                and re.match(r"(?i)^(a|an|the|part)$", nxt[1]["w"])):
            out[i + 1] = [cur[-1]] + nxt
            out[i] = cur[:-1]
    return reattach_fragments([ws for ws in out if ws])


def reattach_fragments(islands):
    """句子没说完的尾巴被词级时间戳挂到了上一岛：挪到下一岛开头。

    实测 4.29 第 1 句 LCR「The garden has been beautifully landscaped.」首词 "The" 自成一岛（多出一句 LCR，
    整个 M1 对不上蓝图）；5.3 「What's your favorite way to spend a day off? Does」+「this campus have a grocery store?」。
    判据：上一岛最后一句没有句末标点、只有 ≤3 个词，且下一岛以小写词开头（接着说的证据）。
    """
    out = [list(ws) for ws in islands]
    for i in range(len(out) - 1):
        cur, nxt = out[i], out[i + 1]
        if not cur or not nxt or is_sentence_end(cur[-1]["w"]):
            continue
        if not re.match(r"^[a-z]", nxt[0]["w"]):
            continue
        k = len(cur)
        while k > 0 and not is_sentence_end(cur[k - 1]["w"]):
            k -= 1
        if len(cur) - k > 3:
            continue
        # 挪过来的首词打标记：半句断开更像录音断流，这一岛不许再被当成「暂停切开」并回上一段（见 tag_islands）
        moved = [dict(w, frag=True) for w in cur[k:]]
        out[i + 1] = moved + nxt
        out[i] = cur[:k]
    return [ws for ws in out if ws]


CUE_GAP_SEC = 0.5
MAT_JOIN_GAP = 8.0      # 录音暂停把一段材料切开的最长停顿（再长就是做题留白）
GARBLED_MIN_WORDS = 20  # 材料正文（去旁白）少于这么多词 = 录音里正文丢了


# 按题材的「正文疑似缺失」下限：data/realExam2026 文档来源的真题里通知最短 46 词、讲座最短 193 词、对话最短 54 词
# （2026-09-16 统计，库里现有条目同分布）。低于这条线的录音分段多半是录音缺头 / 缺尾 —— 4.11 M1 第三条通知只剩
# 最后三句 33 词，validator 的硬下限（通知 30 词）拦不住，会落出一条前半截没了的题。
TYPE_MIN_WORDS = {"la": 40, "lat": 150, "lc": 45}


def material_problem(typ, mat):
    """这一段材料能不能用：→ 扣下原因 或 None（录音缺失 / 幻觉循环 / 远短于真题下限）。"""
    if mat.get("garbled"):
        return mat["garbled"]
    n = sum(len(V.norm(s["text"]).split()) for s in mat.get("body") or [])
    if n < TYPE_MIN_WORDS.get(typ, 0):
        return "正文 %d 词，远低于真题 %s 下限 %d 词（录音缺头/缺尾）" % (n, typ, TYPE_MIN_WORDS[typ])
    return None


def garbled_body(body):
    """材料正文是不是录音缺失 / Whisper 幻觉：→ 原因 或 None。

    实测 4.11 M1 第三条通知只剩「Listen to an announcement at a school event.」重复几遍 ——
    商家录音这一段断了，Whisper 在静音上把旁白幻觉成循环。这种组要单独扣下（其余题照常），
    否则会拿几句重复旁白去结构化、盲审，白花钱还可能落出一条空壳题。
    """
    sents = [V.norm(s["text"]) for s in body if V.norm(s["text"])]
    n = sum(len(s.split()) for s in sents)
    if n < GARBLED_MIN_WORDS:
        return "正文只有 %d 词" % n
    if len(sents) >= 3 and len(set(sents)) / float(len(sents)) < 0.5:
        return "正文 %d 句里只有 %d 句不重复（ASR 幻觉循环）" % (len(sents), len(set(sents)))
    if sum(1 for s in sents if parse_cue([{"text": s + "."}])[0]) >= max(2, len(sents) // 2):
        return "正文大半是旁白句（ASR 幻觉循环）"
    return None


def split_unpunctuated_cue(ws):
    """旁白和正文之间没转写出句号（4.8 "Listen to a talk on a science podcast When you think of Siberia, …"）：
    按停顿切 —— 播音员念完旁白换人开讲，中间总有一口气。只在前 CUE_MAX_WORDS 个词里找
    「停顿 ≥0.5s 且停顿之前的那几个词本身就是一句完整旁白（认得出题材）」的切点，找不到就不切。
    不切的代价是这一段没有旁白题材（按蓝图位置补），切错的代价是讲座首句被剥掉 —— 所以宁可不切。
    → (旁白词数, 题材, 旁白原句) 或 None。
    """
    if len(ws) < 4 or not CUE_HEAD_RE.match(join_words(ws[:3])):
        return None
    for i in range(min(len(ws) - 1, CUE_MAX_WORDS)):
        if ws[i + 1]["start"] - ws[i]["end"] < CUE_GAP_SEC:
            continue
        typ, cue = parse_cue([{"text": join_words(ws[:i + 1]).rstrip(",;:") + "."}])
        if typ:
            return i + 1, typ, cue
    return None


INTRO_TAIL_MIN_GAP = 1.5      # 开场提示与紧跟的第一句 LCR 之间至少这么久的停顿才算两段


def split_intro_islands(islands):
    """把「开场提示 + 第一句 LCR」粘在一起的岛切成两个（见 split_intro_tail）。"""
    out = []
    for ws in islands:
        sents = sentences(ws)
        text = join_words(ws)
        intro = INTRO_RE.search(text) and len(ws) <= INTRO_MAX_WORDS and not parse_cue(sents)[0]
        i = split_intro_tail(ws, sents) if intro else None
        if i:
            out.append(ws[:i])
            out.append(ws[i:])
        else:
            out.append(ws)
    return out


def split_intro_tail(ws, sents):
    """开场提示后面紧跟着第一句短应答、中间的停顿又不到 4s（粘成一个岛）→ 按句切开的下标。

    实测 3.2A：音量提示 12.1s 说完，2.9s 后就是第 1 句 LCR「Did you find the lecture
    interesting?」，切岛看不见这条缝，于是 M1 只数出 11 句 LCR、整个 module 对不上蓝图、
    32 道题全丢。fail-closed 的部分：只在**前半截每一句都是开场提示、后半截短得像 LCR**
    时切，切点取句边界（不猜词），切不出就照旧整岛当 intro。
    """
    if len(sents) < 2:
        return None
    k = 0
    while k < len(sents) and INTRO_RE.search(sents[k]["text"]):
        k += 1
    if not k or k >= len(sents):
        return None
    tail = sents[k:]
    if any(INTRO_RE.search(s["text"]) for s in tail):
        return None
    text = " ".join(s["text"] for s in tail).strip()
    # 尾巴必须是**说完的一句**：开场提示常被 ASR 截半句（"You now have the…" / "Move the
    # volume indicator to…"），那种残片切出来会多一句 LCR，反而把本来认得出来的 M1 顶坏
    # （实测 3.30 / 4.15 / 4.27 / 5.23 四套都这么栽）。省略号结尾就是没说完。
    if text.endswith("...") or text.endswith("…") or not re.search(r"[.?!]$", text):
        return None
    i = next(i for i, w in enumerate(ws) if w["start"] >= tail[0]["start"])
    if not (NOISE_MAX_WORDS < len(ws) - i <= LCR_MAX_WORDS):
        return None
    if ws[i]["start"] - ws[i - 1]["end"] < INTRO_TAIL_MIN_GAP:
        return None                        # 紧接着说下去的不是下一题，是同一段话
    return i


def tag_islands(words):
    """整条录音的词 → 岛 [{tag: intro|lcr|mat|odd, start, end, words, sents, cue_type, cue, body}]。"""
    raw = []
    for ws in split_intro_islands(reattach_cues(split_islands(words))):
        sents = sentences(ws)
        text = join_words(ws)
        rec = {"start": ws[0]["start"], "end": ws[-1]["end"], "words": list(ws), "sents": sents,
               "n": len(ws), "text": text, "cue_type": None, "cue": "", "body": []}
        typ, cue = parse_cue(sents)
        unp = None if typ else split_unpunctuated_cue(ws)
        if unp:
            k, utyp, ucue = unp
            rest = sentences(ws[k:])
            rec.update(tag="mat" if rest else "cue_only", cue_type=utyp, cue=ucue, body=rest)
        elif typ:
            rec.update(tag="mat" if len(sents) > 1 else "cue_only", cue_type=typ, cue=cue, body=sents[1:])
        elif INTRO_RE.search(text) and len(ws) <= INTRO_MAX_WORDS:
            rec["tag"] = "intro"
        elif len(ws) >= MAT_MIN_WORDS:
            rec.update(tag="mat", body=sents)
        elif len(ws) <= NOISE_MAX_WORDS:
            # 一两个词的孤岛是 ASR 在开场提示 / 静音上掉出来的残片（5.10_v2 开头的 "green."），
            # 真题最短刺激句也有 3 个词（data/realExam2026：The classroom's cold.）—— 当噪声丢掉，
            # 否则会被当成多出来的一句 LCR，整个 M1 对不上蓝图。
            rec["tag"] = "noise"
        elif len(ws) <= LCR_MAX_WORDS:
            rec["tag"] = "lcr"
        else:
            rec["tag"] = "odd"
        raw.append(rec)

    out = []
    for rec in raw:
        prev = out[-1] if out else None
        # 旁白自成一岛（旁白后停顿 ≥4s）：后面紧跟的那个无旁白岛就是它的正文
        if prev and prev["tag"] == "cue_only" and not rec["cue_type"] and rec["tag"] in ("mat", "lcr", "odd"):
            prev.update(tag="mat", body=rec["sents"], end=rec["end"], words=prev["words"] + rec["words"],
                        n=prev["n"] + rec["n"])
            continue
        # 材料被录音暂停切成两截：只在「前一截以句末标点收尾、后一截大写开头」时并回，并记一笔 pause_joined。
        # 4.11 M1 的 art exhibit 通知停了 6.9s，与 4.8 同一条逐字比对一个词不缺 —— 该并；
        # 4.11 M2 录音断流是半句断开（"Yes, you've be" / "of our current students…"，中间缺词）—— 不许并，
        # 合起来就是一段缺句的讲座，宁可让整个 module 对不上蓝图被扣下。
        if (prev and prev["tag"] == "mat" and rec["tag"] == "mat" and not rec["cue_type"]
                and rec["start"] - prev["end"] < MAT_JOIN_GAP
                and prev["words"] and is_sentence_end(prev["words"][-1]["w"])
                and rec["words"] and re.match(r"^[A-Z]", rec["words"][0]["w"]) and not rec["words"][0].get("frag")):
            prev.setdefault("joins", []).append(round(rec["start"] - prev["end"], 1))
            prev.update(body=prev["body"] + rec["sents"], end=rec["end"], words=prev["words"] + rec["words"],
                        n=prev["n"] + rec["n"])
            continue
        out.append(rec)
    for rec in out:
        if rec["tag"] == "mat":
            rec["garbled"] = garbled_body(rec["body"])
    for rec in out:
        if rec["tag"] == "cue_only":
            rec["tag"] = "odd"
    return out


def parse_modules(islands):
    """岛序列 → [{lcr: [岛], mats: [岛], odd: [岛], start, end}]，按「LCR 若干 → 材料若干」切 module。"""
    mods, cur = [], None

    def close():
        nonlocal cur
        if cur and (cur["lcr"] or cur["mats"] or cur["odd"]):
            mods.append(cur)
        cur = None

    for isl in islands:
        t = isl["tag"]
        if t == "noise":
            continue
        if t == "intro":
            if cur and cur["mats"]:
                close()
            continue
        if t == "lcr" and cur and cur["mats"]:
            close()
        if cur is None:
            cur = {"lcr": [], "mats": [], "odd": [], "start": isl["start"], "end": isl["end"]}
        cur["end"] = isl["end"]
        {"lcr": cur["lcr"], "mat": cur["mats"]}.get(t, cur["odd"]).append(isl)
    close()
    return mods


MISSING_GAP_SEC = 60.0   # 对话 / 通知 / LCR 之后的留白超过这个数 = 中间整段材料没录上


def insert_missing_material(mod, n_lcr, forms):
    """录音里整段缺了一条材料：在唯一的异常空档处插占位，让其余材料按蓝图对上题号。→ 插了没有。

    判据（2026-09-16 用 19 套录音校准）：LCR / 对话 / 通知之后的正常做题留白最长 40s，
    5.3 M1 三段对话后空了 96.8s、全卷只少一段 —— 缺的正是那里。讲座之后的留白本来就长（最长 117s），
    不拿它判。只在「蓝图恰好比录音多一段、恰好只有一处异常空档」时插，且插完仍要过题材 + 校验和；
    占位那组在 material_problem 里扣下（正文 0 词），其余组照常结构化、盲审、落库。
    """
    if not any(f["lcr"] == n_lcr and len(f["mats"]) == len(mod["mats"]) + 1 for f in forms):
        return False
    seq = ([("lcr", mod["lcr"][-1])] if mod["lcr"] else []) + [(m.get("cue_type"), m) for m in mod["mats"]]
    offset = 1 if mod["lcr"] else 0
    spots = []
    for j in range(1, len(seq)):
        (ptype, prev), (_, nxt) = seq[j - 1], seq[j]
        if ptype in ("lcr", "lc", "la") and nxt["start"] - prev["end"] > MISSING_GAP_SEC:
            spots.append((j - offset, prev["end"], nxt["start"]))
    if len(spots) != 1:
        return False
    idx, t0, t1 = spots[0]
    mod["mats"].insert(idx, {"tag": "mat", "missing": True, "cue_type": None, "cue": "", "body": [], "sents": [],
                             "words": [], "n": 0, "text": "", "start": t0, "end": t1,
                             "garbled": "录音里缺这一段（前一段之后空了 %.0fs）" % (t1 - t0)})
    mod.setdefault("notes", []).append("recording_material_missing_at:%d" % (idx + 1))
    return True


def pad_leading_lcr(mod, mod_no, screen_first_q):
    """录音与屏幕都从第 N 题才开始（3.10「听力（q4开始）」、3.6「(q8开始)」）：前面补 N-1 句空位 LCR。→ 补了没有。

    只在两边**恰好对得上**时补：屏幕侧这个 module 最小题号是 N，录音的 LCR 句数正好比蓝图少 N-1 句，
    材料段数与蓝图一致。空位 LCR 在屏幕上本来就没有题，合流时自然扣下（lcr_no_stimulus），不会落库；
    补上只是为了让后面的题号按蓝图对齐，校验和照样按屏幕总题数算。
    """
    lead = int(screen_first_q or 1) - 1
    if lead <= 0 or mod.get("lcr_padded"):
        return False
    n_lcr = len(mod["lcr"])
    if not any(f["lcr"] == n_lcr + lead and lead < f["lcr"] and len(f["mats"]) == len(mod["mats"])
               for f in BLUEPRINT.get(mod_no, ())):
        return False
    mod["lcr"] = [{"missing": True, "sents": [], "words": [], "start": 0.0, "end": 0.0, "text": "", "n": 0}
                  for _ in range(lead)] + mod["lcr"]
    mod["lcr_padded"] = lead
    mod.setdefault("notes", []).append("recording_starts_at_q%d" % screen_first_q)
    return True


def screen_first_q(scan, mod_no):
    """屏幕侧这个听力 module 配上答案的最小题号（默认 1）。"""
    for m in ((scan.get("alignment") or {}).get("listening") or {}).get("modules", []):
        if m.get("module") == mod_no and m.get("matched"):
            return min(int(mm["n"]) for mm in m["matched"])
    return 1


def resolve_module(mod_no, mod, module_total, first_q=1):
    """一个录音 module ↔ 蓝图：→ (逐段题材 list 或 None, 蓝图版式名 或 None, problems)。"""
    problems = []
    if mod["odd"]:
        problems.append("recording_odd_island:%s" % " / ".join(
            "%.0fs「%s」" % (x["start"], x["text"][:40]) for x in mod["odd"][:3]))
    if not mod["odd"]:
        pad_leading_lcr(mod, mod_no, first_q)
    n_lcr = len(mod["lcr"])
    cands = [f for f in BLUEPRINT.get(mod_no, ()) if f["lcr"] == n_lcr and len(f["mats"]) == len(mod["mats"])]
    if not cands and not mod["odd"] and insert_missing_material(mod, n_lcr, BLUEPRINT.get(mod_no, ())):
        cands = [f for f in BLUEPRINT.get(mod_no, ()) if f["lcr"] == n_lcr and len(f["mats"]) == len(mod["mats"])]
    if len(cands) != 1:
        problems.append("recording_form_mismatch:M%d 录音分出 LCR %d 句 + 材料 %d 段，蓝图里没有这种版式"
                        % (mod_no, n_lcr, len(mod["mats"])))
        return None, None, problems
    form = cands[0]
    types = []
    for i, (exp, mat) in enumerate(zip(form["mats"], mod["mats"])):
        cue = mat.get("cue_type")
        if exp == "mcq2":
            if cue not in ("la", "lc"):
                problems.append("recording_kind_unknown:M%d 第 %d 段旁白没认出题材（蓝图此处 la|lc 都可能）"
                                % (mod_no, i + 1))
                return None, form["form"], problems
            types.append(cue)
        elif cue and cue != exp:
            problems.append("recording_kind_conflict:M%d 第 %d 段旁白是 %s、蓝图是 %s" % (mod_no, i + 1, cue, exp))
            return None, form["form"], problems
        else:
            types.append(exp)
    need = n_lcr + sum(F.QS_PER_TYPE[t] for t in types)
    if module_total and need != module_total:
        problems.append("recording_checksum:M%d 录音推出 %d 题、屏幕总题数 %d" % (mod_no, need, module_total))
        return None, form["form"], problems
    if problems:
        return None, form["form"], problems
    return types, form["form"], problems


def set_slug(setname):
    """与 build_bank.mjs setSlug 同规则。"""
    if re.match(r"^r[fp]\d{4}$", setname):
        return setname
    m = re.match(r"^(\d{1,2})[.．](\d{1,2})", setname)
    base = ("%s%s" % (m.group(1), m.group(2))) if m else "x"
    v = re.search(r"([ABC])卷", setname)
    rev = re.search(r"_v(\d+)$", setname)
    return base + (v.group(1).lower() if v else "") + (("v" + rev.group(1)) if rev else "")


# ══ 跨卷近似重复 ═════════════════════════════════════════════════════════
def spoken_text(typ, it):
    if typ == "lcr":
        return it.get("speaker") or ""
    if typ == "lc":
        return " ".join(x.get("text", "") for x in (it.get("conversation") or []))
    if typ == "la":
        return it.get("announcement") or ""
    return it.get("transcript") or ""


def option_key(opts):
    vals = opts.values() if isinstance(opts, dict) else (opts or [])
    return " | ".join(sorted(V.norm(o) for o in vals))


LISTENING_TYPES = ("lcr", "lc", "la", "lat")


def recording_sets(out_dir=OUT_DIR):
    """已被本管线合流过的卷 → {卷名: structured}。"""
    out = {}
    for fn in sorted(os.listdir(out_dir)):
        if not fn.endswith(".structured.json"):
            continue
        try:
            with open(os.path.join(out_dir, fn), encoding="utf-8") as fh:
                st = json.load(fh)
        except (OSError, ValueError):
            continue
        if (st.get("merged_asr") or {}).get("merger") == MERGER_ID:
            out[fn[:-len(".structured.json")]] = st
    return out


def may_keep(cand_set, cand_is_recording, current_set):
    """谁有资格当「保留方」（与处理顺序无关，重跑结果稳定）。

    文档 / 商家逐题音频来源的条目永远可以；整块录音来源的只有**卷名排在本卷之前**才可以 ——
    否则两套互为重复的录音卷（4.20 与 5.10 的听力 PDF 哈希都一样）会互相记别名，两边都没了。
    """
    if not cand_set or cand_set == current_set:
        return False
    return (not cand_is_recording) or cand_set < current_set


def load_bank(bank_dir=LISTENING_BANK, current_set=None, rec_sets=None):
    """可当保留方的候选 {题型: [{id, set, words, options}]}。

    两路：库里已有的条目；以及同一批里**先合流、还没落库**的录音卷（id 按 build_bank 的规则推）。
    后者万一落库时没过闸（盲审 / 原声），这条别名会被 apply_review 当「保留方不在库里」摘掉 —— 只丢槽位，不串题。
    """
    rec_sets = recording_sets() if rec_sets is None else rec_sets
    out = {t: [] for t in LISTENING_TYPES}
    seen = set()
    for typ in LISTENING_TYPES:
        p = os.path.join(bank_dir, "%s.json" % typ)
        try:
            with open(p, encoding="utf-8") as fh:
                items = json.load(fh).get("items") or []
        except (OSError, ValueError):
            items = []
        for it in items:
            src = str(it.get("source") or "").strip()
            if current_set is not None and not may_keep(src, src in rec_sets, current_set):
                continue
            seen.add(it.get("id"))
            out[typ].append({"id": it.get("id"), "set": src, "words": V.norm(spoken_text(typ, it)).split(),
                             "options": option_key(it.get("options")) if typ == "lcr" else ""})
    for name, st in sorted(rec_sets.items()):
        if current_set is None or not may_keep(name, True, current_set):
            continue
        slug = set_slug(name)
        for r in st.get("results") or []:
            if r.get("section") != "listening" or r.get("status") != "ok" or r.get("dup_of"):
                continue
            if r.get("type") not in out:
                continue
            rid = "real_%s_%s_%d_%02d" % (r["type"], slug, int(r.get("module") or 1), int(r["q_start"]))
            if rid in seen:
                continue
            if r["type"] == "lc" and r.get("turns"):
                text = " ".join(t.get("text", "") for t in r["turns"])
            else:
                text = r.get("transcript_final") or ""
            opts = ((r.get("items") or [{}])[0] or {}).get("options") if r["type"] == "lcr" else None
            out[r["type"]].append({"id": rid, "set": name, "words": V.norm(text).split(),
                                   "options": option_key(opts) if opts else "", "pending": True})
    return out


def find_dup(typ, text, bank, own_prefix, options=None):
    """→ (相似度, 库里 id) 或 None。own_prefix 开头的是本卷自己上一次落库的条目，不算重复。"""
    w = V.norm(text).split()
    if not w:
        return None
    best = None
    for b in bank.get(typ, []):
        if not b["id"] or b["id"].startswith(own_prefix) or not b["words"]:
            continue
        if typ == "lcr":
            if b["words"] == w:
                return (1.0, b["id"])
            if not options or not b["options"]:
                continue
            s = difflib.SequenceMatcher(None, w, b["words"], autojunk=False).ratio()
            if s < LCR_DUP_STIM_SIM:
                continue
            o = difflib.SequenceMatcher(None, option_key(options), b["options"], autojunk=False).ratio()
            if o >= LCR_DUP_OPT_SIM and (best is None or s > best[0]):
                best = (round(s, 3), b["id"])
            continue
        r = len(b["words"]) / float(len(w))
        if not (DUP_LEN_RATIO[0] <= r <= DUP_LEN_RATIO[1]):
            continue
        s = difflib.SequenceMatcher(None, w, b["words"], autojunk=False).ratio()
        if s >= DUP_MIN_SIM and (best is None or s > best[0]):
            best = (round(s, 3), b["id"])
    return best


# ══ IO：找录音 / 转写 / 写缓存 ═══════════════════════════════════════════
PART_RE = re.compile(r"(?i)part\s*(\d+)")
JOINED_DIR = os.path.join(OUT_DIR, "src-joined")


# 口语这半段还认 .mp4：商家有八套卷的口语是录屏（2.8 / 3.6 / 3.11 …），ffmpeg 一样能读，
# 切片与词级时间戳都不受影响。听力那半段不动 —— 那批已经跑完，不在这一轮里重算。
SPEAKING_EXT = AUDIO_EXT + (".mp4", ".m4v", ".mov")


def speaking_recordings(setdir):
    """口语整段录音（复述 7 句 + 面试 4 问在同一条里，与听力那条完全分开）。"""
    hits = []
    for dirpath, _dirs, files in os.walk(setdir):
        for fn in files:
            low = fn.lower()
            if not low.endswith(SPEAKING_EXT) or fn.startswith("~$"):
                continue
            if "口语" in fn or "speak" in low:
                hits.append(os.path.join(dirpath, fn))
    return sorted(hits)


def listening_recordings(setdir):
    hits = []
    for dirpath, _dirs, files in os.walk(setdir):
        for fn in files:
            low = fn.lower()
            if not low.endswith(AUDIO_EXT) or fn.startswith("~$"):
                continue
            if "口语" in fn or "speak" in low:
                continue
            if "听力" in fn or "listen" in low:
                hits.append(os.path.join(dirpath, fn))
    return sorted(hits)


def join_parts(setkey, files, role="listening"):
    """商家把一场录音切成 part1 / part2 两条（5.29）：按 part 号拼成一条缓存文件，时间轴连续。

    只在**每条都带 part 号、号码连续从 1 开始**时拼 —— 少一截或号码对不上就不拼（宁可这卷不跑）。
    ffmpeg concat 直接拷流不重编码；拼出来的文件进 .codex-tmp/src-joined/，
    合流与 bind_original_audio 都用它（词级时间戳与切片是同一条时间轴）。
    """
    parts = []
    for f in files:
        m = PART_RE.search(os.path.basename(f))
        if not m:
            return None
        parts.append((int(m.group(1)), f))
    parts.sort()
    if [n for n, _ in parts] != list(range(1, len(parts) + 1)):
        return None
    out = os.path.join(JOINED_DIR, setkey, role + os.path.splitext(parts[0][1])[1])
    if os.path.exists(out) and os.path.getmtime(out) >= max(os.path.getmtime(f) for _, f in parts):
        return out
    os.makedirs(os.path.dirname(out), exist_ok=True)
    listing = out + ".txt"
    with open(listing, "w", encoding="utf-8") as fh:
        for _, f in parts:
            fh.write("file '%s'\n" % f.replace("\\", "/").replace("'", "'\\''"))
    import subprocess
    r = subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                        "-i", listing, "-c", "copy", out], capture_output=True)
    os.remove(listing)
    if r.returncode != 0 or not os.path.exists(out):
        print("  ✗ 拼接失败：%s" % (r.stderr or b"").decode("utf-8", "replace")[:200])
        return None
    print("  · %s：录音分 %d 段，已拼成一条 → %s" % (setkey, len(parts), os.path.relpath(out, ROOT)))
    return out


def transcribe_recording(setkey, audio, role="listening"):
    """整条录音 → {file, path, model, vad, words, segments}（缓存命中零成本）。"""
    out = os.path.join(REC_DIR, setkey, "%s.json" % role)
    if os.path.exists(out):
        with open(out, encoding="utf-8") as fh:
            data = json.load(fh)
        if data.get("file") == os.path.basename(audio) and data.get("vad_params") == VAD_PARAMS:
            return data, True
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ops"))
    import audio_transcribe  # noqa: E402
    model, dev = audio_transcribe.get_model(WHISPER_MODEL, False)
    t0 = time.time()
    segs, info = model.transcribe(audio, language="en", beam_size=5, word_timestamps=True,
                                  vad_filter=True, vad_parameters=VAD_PARAMS)
    words, seg_list = [], []
    for s in segs:
        seg_list.append({"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip()})
        for w in (s.words or []):
            t = w.word.strip()
            if t:
                words.append({"w": t, "start": round(w.start, 3), "end": round(w.end, 3)})
    data = {"set": setkey, "file": os.path.basename(audio), "path": audio, "model": WHISPER_MODEL,
            "device": dev, "vad_params": VAD_PARAMS, "duration": getattr(info, "duration", None),
            "elapsed_sec": round(time.time() - t0, 1), "words": words, "segments": seg_list}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    os.replace(tmp, out)
    return data, False


def merge_glue(words):
    """续写片段并回前一个词（"Hip" + "-hop" → "Hip-hop"，"5" + ",800" → "5,800"）。

    bind_original_audio 拿每个词的 normTokens 首个 token 与题库口播文本对齐；题库文本是 join_words 拼的
    （"Hip-hop" 归一化成 "hiphop"），词级缓存要是还拆成两个词，就对不上了。
    """
    out = []
    for w in words:
        if out and GLUE_RE.match(w["w"]):
            p = out[-1]
            out[-1] = {"w": p["w"] + w["w"], "start": p["start"], "end": w["end"]}
        else:
            out.append(dict(w))
    return out


def write_role_caches(setkey, rec, role, words, segments):
    """某一角色（listening_m1 / listening_m2 / speaking）的段级 + 词级缓存。

    bind_original_audio 的第一来源分支就吃这两份：`asr/<卷>/<role>.json` 认源音频
    （`path` 是绝对路径，因为整块录音常躺在 src-converted/ 而不是桌面源根目录），
    `asr-words/<卷>/<role>.json` 给词级定位切片。
    """
    words = merge_glue(words)
    base = {"set": setkey, "role": role, "file": rec["file"], "path": rec["path"],
            "model": rec["model"], "device": rec.get("device"), "from": MERGER_ID,
            "window_sec": [words[0]["start"], words[-1]["end"]] if words else None}
    for d, payload in ((ASR_DIR, {**base, "segments": segments,
                                  "text": " ".join(s["text"] for s in segments)}),
                       (WORDS_DIR, {**base, "vad": True, "words": words, "segments": segments,
                                    "text": join_words(words)})):
        p = os.path.join(d, setkey, "%s.json" % role)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False)


def write_module_caches(setkey, rec, mod_no, words, segments):
    """按 module 切开的段级 / 词级缓存（bind_original_audio 第一来源分支的输入形状）。"""
    write_role_caches(setkey, rec, "listening_m%d" % mod_no, words, segments)


# ══ 组装 ═════════════════════════════════════════════════════════════════
SENT_MAX_RUN = 8        # 句级单位：同一人连续这么多句以上才判「不像对话」
NONE_F0_MAX_SHARE = 1 / 3.0


def diarize_sentences(pcm, units):
    """逐**句**按基频二分男女 —— merge_vendor_asr.diarize 的句级版本，返回 (genders, 说明)。

    为什么不直接用 V.diarize：它的「同一人最多连续 3 段」是给 Whisper **段**（常含多句）定的；
    换成句级单位，师生对话里教授一口气说 7 句（3.16 M2 Q6，逐句基频 124~152Hz 全在男声簇、语义也对）
    会被整段误杀。句级更细、换人边界更准，所以连续上限放宽到 SENT_MAX_RUN，
    其余闸不变：两簇中位差 ≥50Hz、至少 3 次轮替、测不出基频的句不超过三分之一。
    """
    import numpy as np
    f0s = [V.f0_median(pcm[int(u["start"] * 16000):int(u["end"] * 16000)]) for u in units]
    known = [f for f in f0s if f]
    if len(known) < 3:
        return None, "有效基频句不足"
    if (len(f0s) - len(known)) / float(len(f0s)) > NONE_F0_MAX_SHARE:
        return None, "测不出基频的句 %d/%d 太多" % (len(f0s) - len(known), len(f0s))
    c0, c1 = min(known), max(known)
    for _ in range(30):
        g0 = [f for f in known if abs(f - c0) <= abs(f - c1)]
        g1 = [f for f in known if abs(f - c0) > abs(f - c1)]
        if not g0 or not g1:
            return None, "聚类退化成一簇"
        n0, n1 = float(np.median(g0)), float(np.median(g1))
        if abs(n0 - c0) < 0.5 and abs(n1 - c1) < 0.5:
            c0, c1 = n0, n1
            break
        c0, c1 = n0, n1
    if abs(c1 - c0) < V.F0_CLUSTER_MIN_GAP:
        return None, "两簇中位基频差 %.0fHz < %.0fHz" % (abs(c1 - c0), V.F0_CLUSTER_MIN_GAP)
    male_c, female_c = (c0, c1) if c0 < c1 else (c1, c0)
    genders, last = [], None
    for f in f0s:
        g = (last or "male") if f is None else ("male" if abs(f - male_c) <= abs(f - female_c) else "female")
        genders.append(g)
        last = g
    runs = []
    for g in genders:
        if runs and runs[-1][0] == g:
            runs[-1][1] += 1
        else:
            runs.append([g, 1])
    if len(runs) < 3:
        return None, "说话人切换次数太少（%d 段）" % len(runs)
    if max(r[1] for r in runs) > SENT_MAX_RUN:
        return None, "同一说话人连续 %d 句，不像对话轮替" % max(r[1] for r in runs)
    return genders, "逐句两簇 %.0fHz / %.0fHz" % (male_c, female_c)


QUOTE_STEM_RE = re.compile(
    r"(?i)\bthe (man|woman)\b[^\"“”]*?\b(?:say|says|said|mean|means|imply|implies)\b[^\"“”]*[\"“]([^\"”]{3,})[\"”]")


def quote_speaker_problems(turns, items):
    """题干引了原话（What does the man imply when he says, "…"?）→ 原话必须出现在**那个性别**的轮次里。

    基频分角色偶尔把一句归错人（3.16 M1 Q13 那段，第一句 170Hz 落进了男声簇，题干却说是 the woman 要去度假）。
    这类题恰好是最依赖角色的，拿题干反查是零成本的语义闸：原话在另一个人的轮次里 → 角色标错了 → 扣下。
    原话在谁的轮次里都找不到（ASR 听错、题干 OCR 残缺）不判，交给盲审。
    """
    out = []
    for it in items or []:
        m = QUOTE_STEM_RE.search(str(it.get("stem") or ""))
        if not m:
            continue
        want = "Man" if m.group(1).lower() == "man" else "Woman"
        quote = V.norm(m.group(2))
        if len(quote.split()) < 2:
            continue
        owners = {t["speaker"] for t in turns or [] if quote in V.norm(t["text"])}
        if owners and want not in owners:
            out.append("speaker_quote_mismatch:Q%s 题干说「%s」是 %s 说的，录音分角色却在 %s 那一轮"
                       % (it.get("q_number"), m.group(2)[:40], want, "/".join(sorted(owners))))
    return out


STEM_STOP = set("""what which why when where who whom whose how does did do is are was were will would can could should
the and that this with from about into their there they them than then have has had been being for not but his her
him she he its it's man woman speaker speakers professor student students talk lecture conversation announcement
mention mentions mentioned say says said imply implies implied mean means suggest suggests main purpose most likely
probably according point points discuss discusses discussed next doing something someone people""".split())


def stem_keywords(stem):
    return {w for w in V.norm(stem).split() if len(w) >= 4 and w not in STEM_STOP}


def stem_problems(listening, repaired=frozenset()):
    """structure_set 把邻题题干串错位的两种形状 → {(module, q_start): [(q, 原因)]}。

    repaired = 修复轮（合并邻块重切）救回来的题 {(module, q)}。2026-09-16 六套逐题对过盲审：成对重复里总是
    「修复过的 Qn 盲审一致、紧挨着没修复的 Qn+1 不一致」—— 首轮 OCR 把 Qn 的题干串进了 Qn+1 那一块，
    Qn 那块读坏了才进修复轮、反倒被救对。所以：
      · **同一组**里题干逐字相同：剔没修复的那份（都修复过 / 都没修复就都剔 —— 分不清哪份才是真的）；
        跨组相同不管（两段讲座都问「What is the main topic of the talk?」是正常的）；
      · 修复过的题，题干关键词在本组材料里一个都没有、却出现在同 module 别的组里：配错了材料，剔掉
        （3.2B M2 Q6 拿到了晚宴对话的「Why does the woman mention her guests?」却配着木工课的转写）。
        只查修复过的题：没修复的题用泛化的题干词（describe / reason / focus…）会大量误报。
    盲审仍是主闸；这里剔的是「题干配错材料时模型等于瞎选、有 1/4 机会恰好等于答案页」的那部分漏网风险。
    """
    out = {}
    by_mod = {}
    for r in listening:
        if r["type"] == "lcr" or not r.get("items"):
            continue
        text = r.get("transcript_final") or ""
        if r["type"] == "lc" and r.get("turns"):
            text = " ".join(t.get("text", "") for t in r["turns"])
        by_mod.setdefault(r["module"], []).append((r, set(V.norm(text).split())))
    for mod, groups in by_mod.items():
        for r, words in groups:
            seen = {}
            for it in r["items"]:
                k = V.norm(it.get("stem"))
                if k:
                    seen.setdefault(k, []).append(it)
            for k, its in seen.items():
                if len(its) < 2:
                    continue
                fixed = [it for it in its if (mod, it.get("q_number")) in repaired]
                drop = [it for it in its if it not in fixed] if len(fixed) == 1 else its
                qs = "/".join("Q%s" % it.get("q_number") for it in its)
                for it in drop:
                    out.setdefault((mod, r["q_start"]), []).append(
                        (it.get("q_number"), "stem_duplicate:%s 同组题干逐字相同（剔 Q%s）" % (qs, it.get("q_number"))))
            others = [(o, ow) for o, ow in groups if o is not r]
            for it in r["items"]:
                if (mod, it.get("q_number")) not in repaired:
                    continue
                kw = stem_keywords(it.get("stem"))
                if not kw or kw & words:
                    continue
                elsewhere = [o for o, ow in others if kw & ow]
                if elsewhere:
                    out.setdefault((mod, r["q_start"]), []).append((it.get("q_number"),
                        "stem_mismatch:Q%s 题干关键词「%s」不在本组材料里、在 M%d Q%s 那组里" % (
                            it.get("q_number"), "/".join(sorted(kw))[:40], mod, elsewhere[0]["q_start"])))
    return out


def lc_body(audio_path, sents):
    """对话正文句 → ("Man: …\\nWoman: …", 备注) 或 (None, 扣下原因)。"""
    units = [s for s in sents if s["text"]]
    if len(units) < 3:
        return None, "diarization_failed:对话只有 %d 句" % len(units)
    pcm = V.decode_pcm(audio_path)
    if pcm is None:
        return None, "diarization_failed:ffmpeg 解码失败"
    genders, why = diarize_sentences(pcm, units)
    if not genders:
        return None, "diarization_failed:%s" % why
    turns = V.merge_same_speaker([{"speaker": "Man" if g == "male" else "Woman",
                                   "text": V.sentence_case(s["text"])} for g, s in zip(genders, units)])
    if len({t["speaker"] for t in turns}) < 2:
        return None, "diarization_failed:只有一个说话人"
    return "\n".join("%s: %s" % (t["speaker"], t["text"]) for t in turns), "turns_from_asr_diarization:%s" % why


CONVERTED_DIR = os.path.join(OUT_DIR, "src-converted")


def source_dir(setkey):
    """源目录：第一来源在桌面根目录；5 月第二来源的 docx 卷在 convert_docx_set.py 转出来的 src-converted 下。"""
    for d in (os.path.join(asr_cache.SRC_ROOT, setkey), os.path.join(CONVERTED_DIR, setkey)):
        if os.path.isdir(d):
            return d
    return None


def plan_path(setkey):
    return os.path.join(REC_DIR, setkey, "structure-plan.json")


def prepare(setkey):
    """公共前半段：找录音 → 转写（缓存）→ 切岛 → 分 module。→ (ctx, None) 或 (None, 跳过原因)。"""
    scan_path = os.path.join(OUT_DIR, "%s.json" % setkey)
    st_path = os.path.join(OUT_DIR, "%s.structured.json" % setkey)
    for p in (scan_path, st_path):
        if not os.path.exists(p):
            return None, "缺 %s" % os.path.basename(p)
    setdir = source_dir(setkey)
    if not setdir:
        return None, "找不到源目录"
    with open(scan_path, encoding="utf-8") as fh:
        scan = json.load(fh)
    with open(st_path, encoding="utf-8") as fh:
        current = json.load(fh)
    if current.get("merged_asr") and (current["merged_asr"].get("merger") or "") != MERGER_ID:
        return None, "已被 %s 合流过，不是这条管线的卷" % current["merged_asr"].get("merger")
    if F.load_pdf_text(setdir):
        return None, "这卷有「听力原文」PDF，该走 merge_first_source_asr.py"
    recs = listening_recordings(setdir)
    if len(recs) > 1:
        joined = join_parts(setkey, recs)
        if joined:
            recs = [joined]
    if len(recs) != 1:
        return None, "听力录音 %d 条（%s）—— 这条管线只认一整条录音（带 part 号且连续的会自动拼接）" % (
            len(recs), ", ".join(os.path.basename(r) for r in recs) or "无")
    audio = recs[0]
    rec, cached = transcribe_recording(setkey, audio)      # 本机 faster-whisper，零 API 费用
    islands = tag_islands(rec["words"])
    mods = parse_modules(islands)
    la = (scan.get("alignment") or {}).get("listening") or {}
    totals_by_mod = {m["module"]: m.get("total") for m in la.get("modules", [])}
    # 收尾噪声：最后一个 module 之后只剩零星短岛、没有材料（考试结束提示、VAD 漏过的杂音）→ 丢掉并记一笔
    tail_noise = []
    while len(mods) > len(totals_by_mod) and not mods[-1]["mats"] and len(mods[-1]["lcr"]) + len(mods[-1]["odd"]) <= 2:
        tail_noise.append(mods.pop())
    return {"scan": scan, "current": current, "setdir": setdir, "audio": audio, "rec": rec, "cached": cached,
            "islands": islands, "mods": mods, "totals_by_mod": totals_by_mod, "tail_noise": tail_noise}, None


def screen_keys_by_q(scan):
    """屏幕侧每道听力题 → structure_set 的块 key（`listening|module|起-止|总题数`，与 collectUnits 同口径）。"""
    out = {}
    for m in ((scan.get("alignment") or {}).get("listening") or {}).get("modules", []):
        for mm in m.get("matched", []):
            b = mm["block"]
            key = "listening|%d|%d-%d|%d" % (m["module"], b["start"], b["end"], b["total"])
            for q in range(int(b["start"]), int(b["end"]) + 1):
                out[(m["module"], q)] = key
    return out


def plan_structure(setkey, write=True):
    """先转写后结构化：只把「值得花钱结构化」的题块 key 列出来，写 asr-recording/<卷>/structure-plan.json。

    不送 DeepSeek 的两类（按 3.16 实测约省一半结构化 + 盲审费用）：
      · 录音结构没自证通过的 module（版式 / 题材 / 校验和不对）—— 没有分段就没有材料，结构化出题面也落不了库；
      · 已判定为跨卷重复的题组：对话 / 通知 / 讲座按录音全文与保留方比词级相似度；LCR 只认逐字相同
        （听错一词的 LCR 要靠选项认，选项得先结构化，所以照送）。
    重复组落库只记别名、用不到本卷的题面，合流时照样认得出来（见 process_set 的 dup 判据）。
    """
    ctx, why = prepare(setkey)
    if not ctx:
        print("  跳过 %s：%s" % (setkey, why))
        return None
    bank = load_bank(current_set=setkey)
    keys_by_q = screen_keys_by_q(ctx["scan"])
    want, dup_groups, bad_mods = set(), [], []
    scan, mods, totals_by_mod = ctx["scan"], ctx["mods"], ctx["totals_by_mod"]
    for i, mod in enumerate(mods[:2]):
        mod_no = i + 1
        # 逐 module 独立校验（蓝图版式 + 题材 + 屏幕总题数校验和），不再因为「录音分出的 module 数 ≠ 屏幕」一刀切：
        # 4.11 的 M2 录音断流被切成好几截，M1 完好 —— 一刀切会连 M1 的 32 题一起扣掉。校验和足够严，错位的 module 过不了。
        types, form, problems = resolve_module(mod_no, mod, totals_by_mod.get(mod_no), screen_first_q(scan, mod_no))
        if types is None:
            bad_mods.append({"module": mod_no, "problems": problems})
            continue
        q = 1
        for isl in mod["lcr"]:
            text = " ".join(s["text"] for s in isl["sents"])
            hit = find_dup("lcr", text, bank, "\0")
            if hit and hit[0] >= 1.0:
                dup_groups.append({"module": mod_no, "q_start": q, "type": "lcr", "dup_of": hit[1]})
            elif keys_by_q.get((mod_no, q)):
                want.add(keys_by_q[(mod_no, q)])
            q += 1
        for typ, mat in zip(types, mod["mats"]):
            k = F.QS_PER_TYPE[typ]
            why = material_problem(typ, mat)
            if why:                         # 录音里这段正文丢了：不送结构化（合流时单独扣下这一组）
                bad_mods.append({"module": mod_no, "group_q_start": q, "problems": ["asr_garbled:%s" % why]})
                q += k
                continue
            hit = find_dup(typ, " ".join(s["text"] for s in mat["body"]), bank, "\0")
            if hit:
                dup_groups.append({"module": mod_no, "q_start": q, "type": typ, "dup_of": hit[1], "sim": hit[0]})
            else:
                want.update(keys_by_q[(mod_no, x)] for x in range(q, q + k) if keys_by_q.get((mod_no, x)))
            q += k
    for mod_no in sorted(totals_by_mod):
        if mod_no > len(mods[:2]):
            bad_mods.append({"module": mod_no, "problems": ["recording_module_missing:录音里没分出这个 module"]})
    all_keys = sorted(set(keys_by_q.values()))
    plan = {"set": setkey, "merger": MERGER_ID, "recording": os.path.basename(ctx["audio"]),
            "keys": sorted(want), "screen_keys": len(all_keys), "dup_groups": dup_groups, "bad_modules": bad_mods}
    if write:
        os.makedirs(os.path.dirname(plan_path(setkey)), exist_ok=True)
        with open(plan_path(setkey), "w", encoding="utf-8") as fh:
            json.dump(plan, fh, ensure_ascii=False, indent=1)
    print("  %s：屏幕 %d 块 → 要结构化 %d 块（跨卷重复 %d 组不送；结构没自证的 module %s）"
          % (setkey, len(all_keys), len(want), len(dup_groups),
             "、".join("M%d" % b["module"] for b in bad_mods) or "无"))
    for b in bad_mods:
        for p in b["problems"]:
            print("     M%d %s" % (b["module"], p))
    return plan


def process_set(setkey, args, totals, bank=None):
    st_path = os.path.join(OUT_DIR, "%s.structured.json" % setkey)
    fs_path = os.path.join(OUT_DIR, "%s.structured.fs_parsed.json" % setkey)
    ctx, why = prepare(setkey)
    if not ctx:
        print("  跳过 %s：%s" % (setkey, why))
        return None
    scan, current, audio, rec, cached = ctx["scan"], ctx["current"], ctx["audio"], ctx["rec"], ctx["cached"]
    islands, mods, totals_by_mod, tail_noise = ctx["islands"], ctx["mods"], ctx["totals_by_mod"], ctx["tail_noise"]
    parsed = current
    if os.path.exists(fs_path):
        with open(fs_path, encoding="utf-8") as fh:
            parsed = json.load(fh)
    # 全卷都是跨卷重复（plan 一块都没送结构化）时 structured 里本来就没有听力 —— 有 plan 就照样合流记别名
    if not any(r.get("section") == "listening" for r in parsed.get("results", [])) and not os.path.exists(plan_path(setkey)):
        print("  跳过 %s：structured 里没有听力产物（先跑 --plan-structure 再 structure_set --keys）" % setkey)
        return None
    if not getattr(V.decode_pcm, "cache_info", None):
        V.decode_pcm = functools.lru_cache(maxsize=2)(V.decode_pcm)   # 每段对话都要解同一条录音，缓存住
    by_q = F.collect_items(parsed)
    slug = set_slug(setkey)
    bank = load_bank(current_set=setkey) if bank is None else bank

    stats = F.new_stats()
    stats.update({"recording": os.path.basename(audio), "islands": len(islands),
                  "modules_found": len(mods), "dup_of": 0, "diarization_failed": 0,
                  "tail_noise": [x["text"][:60] for m in tail_noise for x in (m["lcr"] + m["odd"])]})
    mod_problems, pdf_mods, asr, apaths, forms, lc_notes, cues = {}, {}, {}, {}, {}, {}, {}
    garbled, joins = {}, {}
    # module 数与屏幕不符只记一笔，逐 module 独立校验（见 plan_structure 同处注释）；录音里整个缺掉的 module 由下面标扣
    if len(mods) != len(totals_by_mod):
        stats["module_count_note"] = "录音分出 %d 个 module、屏幕 %d 个" % (len(mods), len(totals_by_mod))
    for mod_no in totals_by_mod:
        if mod_no > len(mods):
            mod_problems.setdefault(mod_no, []).append("recording_module_missing:录音里没分出这个 module")
    for i, mod in enumerate(mods[:2]):
        mod_no = i + 1
        mwords = [w for isl in (mod["lcr"] + mod["mats"] + mod["odd"]) for w in isl["words"]]
        mwords.sort(key=lambda w: w["start"])
        msents = [s for isl in sorted(mod["lcr"] + mod["mats"] + mod["odd"], key=lambda x: x["start"])
                  for s in isl["sents"]]
        types, form, problems = resolve_module(mod_no, mod, totals_by_mod.get(mod_no), screen_first_q(scan, mod_no))
        forms[mod_no] = form
        if problems:
            mod_problems.setdefault(mod_no, []).extend(problems)
        asr["listening_m%d" % mod_no] = {"segments": msents}
        apaths["listening_m%d" % mod_no] = audio
        if not args.dry_run:
            write_module_caches(setkey, rec, mod_no, mwords, msents)
        if types is None:
            continue
        doc = {"lcr": {}, "sections": []}
        for n, isl in enumerate(mod["lcr"], 1):
            doc["lcr"][n] = " ".join(s["text"] for s in isl["sents"]).strip()
        for k, (typ, mat) in enumerate(zip(types, mod["mats"])):
            body = " ".join(s["text"] for s in mat["body"]).strip()
            if typ == "lc":
                labeled, note = lc_body(audio, mat["body"])
                lc_notes[(mod_no, k)] = note
                body = labeled or body
            kind = {"lc": "conversation", "la": "announcement", "lat": "talk"}[typ]
            doc["sections"].append({"kind": kind, "type": typ, "ordinal": k + 1, "body": body})
            cues[(mod_no, k)] = mat.get("cue") or ""
            why = material_problem(typ, mat)
            if why:
                garbled[(mod_no, k)] = why
            if mat.get("joins"):
                joins[(mod_no, k)] = mat["joins"]
        pdf_mods[mod_no] = doc

    listening = F.build_listening(scan, parsed, pdf_mods, asr, apaths, stats, F.load_lc_overrides(setkey))

    # ── 回写本管线自己的判据：module 级问题、对话角色原因、旁白原句、近似重复 ──────────
    repaired_q = {(int(r.get("module") or 1), it.get("q_number")) for r in parsed.get("results", [])
                  if r.get("section") == "listening" and r.get("repaired") for it in (r.get("items") or [])}
    bad_stems = stem_problems(listening, repaired_q)
    for r in listening:
        drops = bad_stems.get((r["module"], r["q_start"])) or []
        if not drops:
            continue
        gone = {q for q, _ in drops}
        r["items"] = [it for it in r["items"] if it.get("q_number") not in gone]
        r["problems"] = r["problems"] + sorted({why for _, why in drops})
        stats["stem_dropped"] = stats.get("stem_dropped", 0) + len(gone)
    groups_by_mod = {}
    for mod_no, doc in pdf_mods.items():
        g = F.derive_groups(doc["sections"], len(doc["lcr"]), totals_by_mod.get(mod_no)) or []
        groups_by_mod[mod_no] = {x["q_start"]: k for k, x in enumerate(g)}
    for r in listening:
        mod_no, q0 = r["module"], r["q_start"]
        extra = list(mod_problems.get(mod_no, []))
        k = groups_by_mod.get(mod_no, {}).get(q0)
        if r["type"] != "lcr" and k is not None:
            if cues.get((mod_no, k)):
                r["framing"] = cues[(mod_no, k)]
            if joins.get((mod_no, k)):
                extra.append("pause_joined:%s" % "/".join("%ss" % g for g in joins[(mod_no, k)]))
            if garbled.get((mod_no, k)):
                extra.append("asr_garbled:%s" % garbled[(mod_no, k)])
            note = lc_notes.get((mod_no, k))
            if note:
                r["problems"] = [p for p in r["problems"] if not p.startswith("diarization_failed:no_turns")]
                extra.append(note)
                if note.startswith("diarization_failed"):
                    stats["diarization_failed"] += 1
        if r["type"] == "lc" and r.get("turns"):
            extra.extend(quote_speaker_problems(r["turns"], r.get("items")))
        r["problems"] = extra + r["problems"]
        if extra and any(p.startswith(("recording_", "speaker_quote_mismatch", "asr_garbled")) for p in extra):
            r["status"] = "flagged"
        # 近似重复：只在 module 结构自证过（没有 recording_* 问题）时才认 —— 结构坏了题号就不可信，别名会挂错槽。
        # 角色判不出 / 原话对不上角色 / 题面没结构化（plan 判重复后没送）都不妨碍记别名：落库用的是保留方那条。
        structural = [p for p in r["problems"] if p.startswith(F.BLOCKING_PREFIX + ("recording_", "asr_garbled"))
                      and not p.startswith(DIARIZE_PREFIX + ("speaker_quote_mismatch", "screen_items_missing"))]
        if not structural:
            opts = None
            if r["type"] == "lcr" and r.get("items"):
                opts = r["items"][0].get("options")
            text = r.get("transcript_final") or ""
            if r["type"] == "lc" and r.get("turns"):
                text = " ".join(t["text"] for t in r["turns"])
            elif r["type"] == "lc" and k is not None and pdf_mods.get(mod_no):
                text = re.sub(r"(?m)^(Man|Woman):\s*", "", pdf_mods[mod_no]["sections"][k]["body"])
            hit = find_dup(r["type"], text, bank, "real_%s_%s_" % (r["type"], slug), options=opts)
            if hit:
                r["dup_of"], r["dup_sim"] = hit[1], hit[0]
                r["problems"].append("dup_of:%s:sim=%.3f" % (hit[1], hit[0]))
                if r["status"] != "ok":
                    r["status"] = "ok"     # 角色判不出的对话照样能记别名：落库用的是库里那条
                stats["dup_of"] += 1

    tally_ok = sum(1 for r in listening if r["status"] == "ok")
    line = ("  %s：录音 %s（%s）· 岛 %d · module %d（%s）· 听力 %d 组可落库 %d（其中近似重复→别名 %d）· 对话角色判不出 %d"
            % (setkey, os.path.basename(audio), "缓存" if cached else "新转写", len(islands), len(mods),
               "/".join("M%d=%s" % (m, forms.get(m) or "?") for m in sorted(forms)) or "-",
               len(listening), tally_ok, stats["dup_of"], stats["diarization_failed"]))
    reasons = {}
    for r in listening:
        if r["status"] == "ok":
            continue
        for p in r["problems"]:
            if p.startswith(F.BLOCKING_PREFIX + ("recording_",)) or p.startswith("题目字段不全"):
                reasons[p.split(":")[0]] = reasons.get(p.split(":")[0], 0) + 1
    if args.dry_run:
        print(line + "（--dry-run，未写盘）")
        if reasons:
            print("     扣下原因：%s" % reasons)
        for mod_no, ps in sorted(mod_problems.items()):
            for p in ps:
                print("     M%d %s" % (mod_no, p))
        totals.append((setkey, stats, listening))
        return stats

    if not os.path.exists(fs_path):
        shutil.copyfile(st_path, fs_path)       # 原始产物快照：只存一次（见头注）
    results = [r for r in current.get("results", []) if r.get("section") != "listening"]
    results.extend(listening)
    tally = {}
    for r in results:
        tally[r.get("status")] = tally.get(r.get("status"), 0) + 1
    out = {**current, "tally": tally, "results": results,
           "merged_asr": {"merger": MERGER_ID, "recording": os.path.basename(audio), "asr_model": rec["model"],
                          "forms": {str(k): v for k, v in forms.items()}, "proofread": False,
                          "stats": {k: v for k, v in stats.items() if k != "reasons"}, "reasons": reasons}}
    shutil.copyfile(st_path, os.path.join(OUT_DIR, "%s.structured.prev.json" % setkey))
    with open(st_path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(line + " → 已写回")
    if reasons:
        print("     扣下原因：%s" % reasons)
    for mod_no, ps in sorted(mod_problems.items()):
        for p in ps:
            print("     M%d %s" % (mod_no, p))
    totals.append((setkey, stats, listening))
    return stats


# ══ 口语：整段口语录音 + 答案页复述句 ═══════════════════════════════════
def word_tokens(words):
    """词对象列表 → (归一化 token 列表, 每个 token 属于第几个词)。"""
    toks, owner = [], []
    for i, w in enumerate(words):
        for t in V.norm(w["w"]).split():
            toks.append(t)
            owner.append(i)
    return toks, owner


REPEAT_PICK_SIM_MIN = 0.6     # 在录音里挑「就是这一句」的相似度下限（低于此判没找到）
def repeat_diff_budget(n):
    """允许答案页与录音差几个词：短句只许差 1 个，长句 2 个。

    差异词数比相似度稳：5 词的句子错 1 个词相似度就掉到 0.8，13 词的句子错 2 个还有 0.92，
    一条相似度线要么放走长句里的整片胡说，要么卡死短句里的一个错字（实测 3.18 两种都撞上了）。
    """
    return 1 if n <= 6 else 2


def token_diff(doc, asr):
    """两串归一化 token 的差异：(答案页多出的词数, 录音多出的词数, 对上的词数)。"""
    ta, tb = V.norm(doc).split(), V.norm(asr).split()
    m = sum(b.size for b in difflib.SequenceMatcher(None, ta, tb, autojunk=False).get_matching_blocks())
    return len(ta) - m, len(tb) - m, m


TAIL_SLACK = 1                # 句尾允许差几个词（最后一个词听错很常见）
END_PUNCT_RE = re.compile(r"""[.?!"'”’)]$""")


def covers_tail(doc, unit_text):
    """答案页这一句是不是**说到了录音这一句的结尾**（用来分辨「换行截半句」和「本来就没标点」）。

    第一来源那道 `sentence_truncated:no_end_punct` 闸拦的是答案 PDF 换行把长句砍半
    （"…call us on the helpline and we will"，后面还有 "get back to you"）。
    数字卷的答案页是**通篇没有句末标点**的手打转写，拿同一条闸去卡就整批误杀 ——
    所以改成直接查尾巴：答案页这句最后对上的词已经在录音这句的末尾，就是完整句。
    """
    ta, tb = V.norm(doc).split(), V.norm(unit_text).split()
    if not ta or not tb:
        return False
    sm = difflib.SequenceMatcher(None, ta, tb, autojunk=False)
    last = max((b + size - 1 for _a, b, size in sm.get_matching_blocks() if size), default=-1)
    return last >= len(tb) - 1 - TAIL_SLACK


def fix_orthography(s):
    """只补书写形态：首字母大写 + 句末补句号。一个词都不改。"""
    s = (s or "").strip()
    if not s:
        return s
    if s[0].islower():
        s = s[0].upper() + s[1:]
    return s if END_PUNCT_RE.search(s) else s + "."


def repeat_from_audio(sents, units):
    """复述句以**录音里那一句**定稿，答案页只当锚（证明是这一句、在这个位置）。

    为什么不是「文档优先」：跟读题的刺激物就是那段音频，考生听到什么就该复述什么，
    判分是拿考生的 STT 逐词比这句话 —— 句子与音频不一致，说对的人反而被扣分。
    而数字卷的答案页是商家手打的转写，实测 3.18 七句里错三句：
    tire 打成 tier（两处）、pen 打成 pin、"reattach the wheel tightly back on" 漏成
    "reattach the wheel back to"，而且整批全小写无句末标点。

    fail-closed 的部分在「锚」上：逐句按**单调游标**在录音里找相似度最高的一句，
    低于 REPEAT_DOC_SIM_MIN 就认作没找到 → 这句不换、按老规矩被下游的闸扣下。
    也就是说 ASR 只能改**已经被文档证明存在的那一句**的字面，不能凭空加一句。

    返回 ({n: 定稿句子}, {n: 与答案页有出入的那些的 sim})。
    """
    ns = sorted(sents)
    out, diffs, cur = {}, {}, 0
    for n in ns:
        best = None
        for j in range(cur, len(units)):
            s = V.sim(units[j]["text"], sents[n])
            if best is None or s > best[0]:
                best = (s, j)
        if not best or best[0] < REPEAT_PICK_SIM_MIN:
            continue
        text = (units[best[1]]["text"] or "").strip()
        da, db, m = token_diff(sents[n], text)
        if max(da, db) > repeat_diff_budget(min(da + m, db + m)):
            # 差太多 = 两边有一边听/打错了。答案页这句说到了录音这句的结尾就算完整句，
            # 只补大小写与句号照旧上线（内容仍是文档的）；没说到结尾就是真截断，不动，等下游扣下。
            if covers_tail(sents[n], text):
                cur = best[1] + 1
                fixed = fix_orthography(sents[n])
                if fixed != sents[n]:
                    out[n] = fixed
            continue
        cur = best[1] + 1
        text = fix_orthography(text)
        if not text or text == sents[n]:
            continue
        out[n] = text
        if da or db:
            diffs[n] = "差%d词 sim=%.3f" % (max(da, db), best[0])
    return out, diffs


# ── 面试题：题干只在音频里（屏幕只印场景、答案页只抄复述句）─────────────────
# 2026-09-16 用户拍板收 ASR 题干，条件是四道机械闸（见下）。收的理由：这批卷的听力
# lc/la/lat 正文本来就是 ASR 转的（整块录音卷没有逐字稿），口径上已经开过口子；面试是
# 开放题、没有客观答案，一个词转错的代价远小于选择题；而且每道题都要能从同一条录音里
# 切出真人原声，bind 的覆盖率 / 锚点 / 语速三道闸会机械验证「这段文字确实是这个位置说的」。
INTERVIEW_CUE_RE = re.compile(r"(?i)take an interview|an interviewer will ask you")
# ETS 的固定指令 + 场景屏（考生听到的是屏幕上那段的朗读，不是题干）
IV_DIRECTIONS_RE = re.compile(
    r"(?i)^(take an interview|an interviewer will ask|i'?ll ask you question"
    r"|answer the questions and be sure|(the|a) (clock|block) will indicate"
    r"|no (time|type) (for|of) preparation|as part of an? [a-z ]{0,20}(project|study|research)"
    r"|a graduate student"
    r"|(you'?ll|you will) have a short|(the |a )?researcher (will ask|is studying)"
    r"|you have (volunteered|signed up|agreed|been (invited|asked))|you are participating"
    r"|(no time for preparation |interview |preparation )?will be provided"
    r"|you received an email|you'?ve been (invited|asked)|volunteer for a research study)")
# 面试官的应答词（「好的」「有意思」「谢谢」）—— 只在**没有问号且不超过 8 词**时剥
IV_ACK_RE = re.compile(
    r"(?i)^(thanks?|great|interesting|okay|ok|noted|fair enough|good points?|i see|understood"
    r"|alright|all right|got it|wonderful|nice|sure|right|excellent|perfect|makes sense"
    r"|very good|mm|uh|yeah|yes|cool|good|that'?s (interesting|helpful|great|good))\b")
# 「谢谢你参加本研究 / 谢谢你今天来」这类整句寒暄可以长一些，单独一条（仍只剥没有问号的整句）
IV_GREETING_RE = re.compile(
    r"(?i)^(thanks?|thank you)\b.*\b(participat|take part|joining|speaking with me|for (your )?time"
    r"|agreeing|for coming|for a great talk|being here|being involved|your involvement)")
# 面试官的转场铺垫（同样只剥没有问号的整句）
IV_FRAMING_RE = re.compile(
    r"(?i)^(i'?d like to (ask|talk|discuss|hear|know)|i would like to (ask|talk|discuss)"
    r"|today,? i'?d like|let'?s (start|begin)"
    r"|next question|final question|and finally|one (more|last) question|moving on"
    r"|i'?m going to ask|we'?ll (start|begin) with)")
IV_MIN_WORDS, IV_MAX_WORDS = 5, 60      # validator 的绝对区间；库里 174 道真题实测 6~51 词
IV_ACK_MAX_WORDS = 8


def trim_interview_stem(sents):
    """剥掉题干前面的指令 / 场景 / 应答词，剥到第一句「不是这三类」的为止。

    只从**前面**剥、且只剥**没有问号**的整句 —— 带问号的句子和「Some people believe that …」
    这种前提句一律留着（前提剥掉题就残了）。剥到哪停由句子本身决定，不猜边界。
    """
    i = 0
    while i < len(sents):
        t = sents[i]["text"].strip()
        if "?" in t:
            break
        if IV_DIRECTIONS_RE.match(t) or IV_FRAMING_RE.match(t) or IV_GREETING_RE.match(t):
            i += 1
            continue
        if len(t.split()) <= IV_ACK_MAX_WORDS and IV_ACK_RE.match(t):
            i += 1
            continue
        break
    return sents[i:]


CJK_RE = F.CJK_RE


IV_SCENARIO_RE = re.compile(r"(?i)\b(you (have|'ve|received)\b[^.]*\.)")


def interview_intro(scan):
    """面试的场景屏（"You have volunteered for a research study…"）——**文档来源**，取自屏幕块。

    不能用 merge_first_source_asr.speaking_context：它整块跳过带「Listen and repeat」的块，
    而数字卷的场景屏常与复述指令同在一块（3.18 实测），跳过后只剩「Listenand repeatonlyonce.」这种糊字。
    """
    best = ""
    for b in scan.get("blocks", []):
        if b.get("section") != "speaking":
            continue
        body = " ".join(l.strip() for l in (b.get("body") or "").split("\n")
                        if l.strip() and not CJK_RE.search(l))
        body = re.sub(r"=+\s*PAGE\s*\d+\s*=+", " ", body)
        body = re.sub(r"(?i)\b(speaking|listen ?and ?repeat ?only ?once\.?)\b", " ", body)
        body = re.sub(r"\s+", " ", body).strip()
        m = IV_SCENARIO_RE.search(body)
        if not m:
            continue
        run = body[m.start():]
        if V.nwords(run) >= 12 and V.nwords(run) > V.nwords(best):
            best = run
    return fix_orthography(best[:300]) if best else ""


def build_interview(rec, ctx, stats):
    """整段口语录音 → 面试 4 道题干。→ (results 条目 或 None, 扣下原因 或 None)。

    闸一：录音里认得出「Take an interview / An interviewer will ask you」这段旁白；
    闸二：旁白之后**恰好 4 段带问号的内容**（按 ≥4s 静音切段 —— 每道题后面都有考生的作答时间，
          所以停顿天然把 4 道题分开；第 1 题常与旁白同段，按句从第一句带问号处起算）；
    闸三：每道题剥完应答词后仍带问号、5~60 词、以句末标点收尾；
    闸四（在 build_bank）：每道题都要能切出真人原声，切不出的不上线。
    """
    islands = split_islands(merge_glue(rec["words"]))
    ci = next((i for i, w in enumerate(islands) if INTERVIEW_CUE_RE.search(join_words(w))), None)
    if ci is None:
        return None, "interview_cue_missing:录音里没有面试旁白"
    # 场景屏抓不到（屏幕这一块被 OCR 糊了）就退到录音里那段朗读 —— 场景只用于展示、不判分
    if not ctx or V.nwords(ctx) < 8 or re.search(r"(?i)listen ?and ?repeat", ctx):
        say = [x["text"] for x in sentences(islands[ci])
               if IV_DIRECTIONS_RE.match(x["text"].strip())]
        k = next((j for j, t in enumerate(say) if IV_SCENARIO_RE.search(t)), None)
        ctx = " ".join(say[k:])[:300] if k is not None else ctx
    cands = []
    for k, w in enumerate(islands[ci:]):
        ss = trim_interview_stem(sentences(w))
        if ss and any("?" in x["text"] for x in ss):
            cands.append(ss)
    if len(cands) != 4:
        return None, "interview_count:旁白后分出 %d 道题（应为 4）" % len(cands)
    items = []
    for n, ss in enumerate(cands, 1):
        text = " ".join(x["text"] for x in ss).strip()
        probs, usable = ["stem_from_asr"], True
        nw = V.nwords(text)
        if not (IV_MIN_WORDS <= nw <= IV_MAX_WORDS):
            usable = False
            probs.append("stem_word_count:%d" % nw)
        if not END_PUNCT_RE.search(text):
            usable = False
            probs.append("stem_truncated:no_end_punct")
        items.append({"n": n, "q_number": n, "stem": text, "stem_final": text if usable else "",
                      "usable": usable, "problems": probs})
    ok = sum(1 for it in items if it["usable"])
    stats["interview_from_asr"] = stats.get("interview_from_asr", 0) + ok
    return {"key": "speaking|1|interview|1", "section": "speaking", "module": 1, "type": "interview",
            "q_start": 1, "q_end": len(items), "tier": "recalled",
            "status": "ok" if ok >= 3 else "flagged", "merged_by": MERGER_ID,
            "problems": ([] if ok == len(items) else
                         ["不可用题 %d 道（%s）" % (len(items) - ok,
                          ",".join("Q%d" % it["n"] for it in items if not it["usable"]))]),
            "context": ctx, "items": items}, None


def _build_repeat(scan, parsed, setdir, rec, asr, stats):
    """复述那一半：答案页续行拼回 → 以录音那一句定稿 → build_speaking。→ (results, repeat 条目, 出入记录)。"""
    sents, _ctx = F.collect_repeat(parsed)
    for n, full in (F.answer_pdf_repeat(setdir) or {}).items():
        cur = sents.get(n)
        if cur and full and full != cur and V.norm(full).startswith(V.norm(cur)):
            sents[n] = full
            stats["repeat_unwrapped"] += 1
        elif not cur and full:
            sents[n] = full
            stats["repeat_from_answer_pdf"] += 1
    fixed, diffs = repeat_from_audio(sents, sentences(merge_glue(rec["words"])))
    stats["repeat_retyped_from_audio"] = len(fixed)
    stats["repeat_doc_disagreed"] = len(diffs)
    sents.update(fixed)
    patched = dict(parsed)
    patched["results"] = [
        r if not (r.get("section") == "speaking" and r.get("type") == "repeat")
        else {**r, "items": [{**it, "sentence": sents.get(int(it.get("n") or it.get("q_number") or 0),
                                                          it.get("sentence"))}
                             for it in (r.get("items") or [])]}
        for r in parsed.get("results", [])]
    speaking = F.build_speaking(scan, patched, asr, stats, None)
    rep = next((r for r in speaking if r["type"] == "repeat"), None)
    for it in (rep or {}).get("items", []):        # 与答案页有出入的留痕（定稿取的是录音那一句）
        if it["n"] in diffs:
            it["problems"] = list(it["problems"]) + ["repeat_text_from_audio:答案页有出入（%s）" % diffs[it["n"]]]

    return speaking, rep, diffs


def process_speaking(setkey, args, totals):
    """数字卷的口语合流 —— 与听力那半段互不相干（两条录音、两套缓存），所以单独一条路。

    为什么不并进 process_set：听力那半段最贵的是逐句基频判角色（每段对话都要解一遍 PCM），
    而听力早就合完了；口语只需要「口语录音转写一遍 + 复述句对齐」，重跑听力纯属白烧几分钟。

    ground truth 与第一来源完全一致，所以直接复用 `merge_first_source_asr.build_speaking`：
      · 复述句 = 答案 PDF 的编号句（**文档来源**，不是 ASR），逐句与口语录音做词级对齐核对；
      · 面试题干只在音频里、没有任何文档来源 → 按既定口径整组扣下（不拿 ASR 顶）。
    """
    scan_path = os.path.join(OUT_DIR, "%s.json" % setkey)
    st_path = os.path.join(OUT_DIR, "%s.structured.json" % setkey)
    for p in (scan_path, st_path):
        if not os.path.exists(p):
            print("  跳过 %s：缺 %s" % (setkey, os.path.basename(p)))
            return None
    setdir = source_dir(setkey)
    if not setdir:
        print("  跳过 %s：找不到源目录" % setkey)
        return None
    with open(scan_path, encoding="utf-8") as fh:
        scan = json.load(fh)
    with open(st_path, encoding="utf-8") as fh:
        current = json.load(fh)
    merger = (current.get("merged_asr") or {}).get("merger") or ""
    if merger and merger != MERGER_ID:
        print("  跳过 %s：已被 %s 合流过，不是这条管线的卷" % (setkey, merger))
        return None
    if F.load_pdf_text(setdir):
        print("  跳过 %s：这卷有「听力原文」PDF，该走 merge_first_source_asr.py" % setkey)
        return None
    recs = speaking_recordings(setdir)
    if len(recs) > 1:
        joined = join_parts(setkey, recs, role="speaking")
        if joined:
            recs = [joined]
    if len(recs) != 1:
        print("  跳过 %s：口语录音 %d 条（%s）—— 只认一整条" % (
            setkey, len(recs), ", ".join(os.path.basename(r) for r in recs) or "无"))
        return None
    audio = recs[0]

    # 复述句的来源是 structure_set 的原始产物：优先 fs_parsed 快照（幂等），
    # 快照里还没有口语（听力先合的那批）时退回现产物 —— 合流只加字段不改 sentence，重跑仍幂等。
    fs_path = os.path.join(OUT_DIR, "%s.structured.fs_parsed.json" % setkey)
    parsed = current
    if os.path.exists(fs_path):
        with open(fs_path, encoding="utf-8") as fh:
            snap = json.load(fh)
        if any(r.get("section") == "speaking" for r in snap.get("results", [])):
            parsed = snap
    # 答案页没有复述句的卷（section_no_stems / 整张答案页缺失）照样跑：复述做不了，
    # 但面试题干本来就只在音频里，不靠答案页 —— 这些卷的 4 道面试题一样能收。
    has_doc = any(r.get("section") == "speaking" for r in parsed.get("results", []))

    rec, cached = transcribe_recording(setkey, audio, role="speaking")   # 本机 faster-whisper，零 API 费用
    stats = F.new_stats()
    asr = {"speaking": {"segments": rec["segments"]}}

    # 复述句定稿：答案页续行拼回 → 逐词一致时取回录音里的书写形态。两步都做完再交给
    # build_speaking（所以那边的 answer_sents 传 None，否则它会拿小写原文把形态又换回去）。
    speaking, rep, diffs = [], None, {}
    if has_doc:
        speaking, rep, diffs = _build_repeat(scan, parsed, setdir, rec, asr, stats)

    # 面试题：build_speaking 按第一来源口径整组扣下（没有文档来源），这条管线改收 ASR 题干 + 四道机械闸
    iv, iv_why = build_interview(rec, interview_intro(scan) or F.speaking_context(scan), stats)
    if iv:
        speaking = [r for r in speaking if r["type"] != "interview"] + [iv]
    else:
        for r in speaking:
            if r["type"] == "interview":
                r["problems"] = [p for p in r["problems"] if not p.startswith("no_stem_in_doc")] + [iv_why]
    if not speaking:
        print("  跳过 %s：复述没有答案页、面试也没收下（%s）" % (setkey, iv_why or "-"))
        return None
    ok_n = sum(1 for it in (rep or {}).get("items", []) if it.get("usable"))
    line = ("  %s：口语录音 %s（%s）· 复述 %d 句可落库 %d · 面试 %s"
            % (setkey, os.path.basename(audio), "缓存" if cached else "新转写",
               len((rep or {}).get("items", [])), ok_n,
               ("%d 道可落库 %d" % (len(iv["items"]), sum(1 for x in iv["items"] if x["usable"])))
               if iv else ("扣下（%s）" % iv_why.split(":")[0])))
    bad = [it for it in (rep or {}).get("items", []) if not it.get("usable")]
    bad += [it for it in (iv or {}).get("items", []) if not it.get("usable")]
    if args.dry_run:
        print(line + "（--dry-run，未写盘）")
        for it in bad:
            print("     Q%d 扣下：%s" % (it["n"], ",".join(it["problems"])))
        if not iv:
            print("     面试：%s" % iv_why)
        totals.append((setkey, stats, speaking))
        return stats

    write_role_caches(setkey, rec, "speaking", rec["words"], rec["segments"])
    if os.path.exists(fs_path) and parsed is current:
        # 听力先合的那批：快照里缺口语，把**合流前**的口语原始产物补进去（下次重跑就从快照出发）
        with open(fs_path, encoding="utf-8") as fh:
            snap = json.load(fh)
        snap["results"] = [r for r in snap.get("results", []) if r.get("section") != "speaking"] + \
                          [r for r in current.get("results", []) if r.get("section") == "speaking"]
        with open(fs_path, "w", encoding="utf-8") as fh:
            json.dump(snap, fh, ensure_ascii=False, indent=1)
    results = [r for r in current.get("results", []) if r.get("section") != "speaking"] + speaking
    tally = {}
    for r in results:
        tally[r.get("status")] = tally.get(r.get("status"), 0) + 1
    merged = dict(current.get("merged_asr") or {})
    merged["merger"] = MERGER_ID
    merged["speaking"] = {"recording": os.path.basename(audio), "asr_model": rec["model"],
                          "repeat_sentences": len((rep or {}).get("items", [])), "repeat_ok": ok_n,
                          "interview_held": stats.get("interview_held", 0)}
    out = {**current, "tally": tally, "results": results, "merged_asr": merged}
    shutil.copyfile(st_path, os.path.join(OUT_DIR, "%s.structured.prev.json" % setkey))
    with open(st_path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(line + " → 已写回")
    for it in bad:
        print("     Q%d 扣下：%s" % (it["n"], ",".join(it["problems"])))
    if not iv:
        print("     面试：%s" % iv_why)
    totals.append((setkey, stats, speaking))
    return stats


# ══ 自检（__tests__/realbank-recording-merge.test.js 调这个） ════════════
def _w(text, t0, step=0.3):
    out = []
    for i, tok in enumerate(text.split()):
        out.append({"w": tok, "start": round(t0 + i * step, 3), "end": round(t0 + i * step + 0.25, 3)})
    return out


def self_test():
    fails = []

    def check(name, cond, extra=""):
        if not cond:
            fails.append("%s -> %r" % (name, extra))

    check("蓝图 M1 总题数 32", 12 + sum(F.QS_PER_TYPE[t] for t in BLUEPRINT[1][0]["mats"]) == 32)
    check("蓝图 M2 A 型 15", 3 + sum(F.QS_PER_TYPE[t] for t in BLUEPRINT[2][0]["mats"]) == 15)
    check("蓝图 M2 B 型 15", 7 + F.QS_PER_TYPE["lat"] + 2 * 2 == 15)

    # 断句：缩写不断、问号断
    ss = sentences(_w("Dr. Smith said hello. Are you there? Yes", 0))
    check("断句", [s["text"] for s in ss] == ["Dr. Smith said hello.", "Are you there?", "Yes"], ss)
    # 续写片段不加空格
    check("拼词", join_words(_w("Hip -hop starts at 7 a .m. with 5 ,800 fans ' s", 0))
          == "Hip-hop starts at 7 a.m. with 5,800 fans ' s", join_words(_w("Hip -hop starts at 7 a .m. with 5 ,800 fans", 0)))
    check("并词", [w["w"] for w in merge_glue(_w("Hip -hop at 5 ,800", 0))] == ["Hip-hop", "at", "5,800"])
    # 音量调试的另一种说法也是开场提示
    check("开场提示变体", bool(INTRO_RE.search("You'll be able to change the volume during the test if you need to."))
          and bool(INTRO_RE.search("You now have the option to adjust all."))
          and not INTRO_RE.search("Can you turn down the volume?"))
    # 旁白与正文之间没有句号：按停顿切，停顿前那几个词得是完整旁白
    ws = _w("Listen to a talk on a science podcast", 0) + _w("When you think of Siberia, you picture a cold place.", 3.5)
    cut = split_unpunctuated_cue(ws)
    check("无句号旁白按停顿切", cut and cut[0] == 8 and cut[1] == "lat", cut)
    ws = _w("Listen to the students talk about when you think of Siberia", 0)
    check("没有停顿不切", split_unpunctuated_cue(ws) is None)

    # 旁白：题材取最先出现的关键词；VAD 削掉 Listen 也认；问句不认
    check("旁白 conversation", parse_cue([{"text": "Listen to a conversation."}])[0] == "lc")
    check("旁白 通知在课上", parse_cue([{"text": "Listen to an announcement in a biology class."}])[0] == "la")
    t, cue = parse_cue([{"text": "to a talk in an art history class."}])
    check("旁白缺 Listen", t == "lat" and cue.startswith("Listen to a talk"), (t, cue))
    check("旁白问句不认", parse_cue([{"text": "Did you listen to the conversation?"}])[0] is None)
    check("长句不当旁白", parse_cue([{"text": "Listen to a conversation " + "word " * 20}])[0] is None)

    # 造一条迷你录音：开场提示 → 2 句 LCR → 对话 → 讲座 → 90s → 1 句 LCR → 通知
    words = []
    words += _w("Select the volume icon at the top of the screen.", 0)
    words += _w("When is the meeting with the exchange students?", 12)
    words += _w("Can you turn down the volume?", 35)
    words += _w("Listen to a conversation. " + "I think we should go now. " * 10, 60)
    words += _w("Listen to a talk in a biology class. " + "Frogs are important animals. " * 12, 110)
    words += _w("Are you attending the seminar?", 260)
    words += _w("Listen to an announcement. " + "The library will close early today. " * 8, 290)
    isl = tag_islands(words)
    check("切岛标签", [x["tag"] for x in isl] == ["intro", "lcr", "lcr", "mat", "mat", "lcr", "mat"],
          [x["tag"] for x in isl])

    # 旁白被词级时间戳错挂到上一岛尾巴 → 挪回下一岛
    fixed = reattach_cues([_w("Frogs are important animals. Listen", 0),
                           _w("to a talk in an art class. Last week we talked about realism.", 100)])
    check("孤零零的 Listen 挪回下一岛", fixed[0][-1]["w"] == "animals." and fixed[1][0]["w"] == "Listen",
          [" ".join(w["w"] for w in x) for x in fixed])
    fixed = reattach_cues([_w("Moving is always a lot of work. Listen to a conversation.", 0),
                           _w("I have a question for you. Sure, professor.", 100)])
    check("整句旁白挪回下一岛", " ".join(w["w"] for w in fixed[0]) == "Moving is always a lot of work."
          and " ".join(w["w"] for w in fixed[1]).startswith("Listen to a conversation. I have"),
          [" ".join(w["w"] for w in x) for x in fixed])
    fixed = reattach_cues([_w("Did you listen", 0), _w("to the radio yesterday?", 100)])
    check("问句里的 listen 不当旁白挪，被切断的问句整句接回",
          [join_words(x) for x in fixed] == ["Did you listen to the radio yesterday?"], [join_words(x) for x in fixed])
    fixed = reattach_cues([_w("The library closes early. Listen to the lecture recording before class.", 0),
                           _w("Listen to a conversation. I have a question for you.", 100)])
    check("下一岛自带旁白时，上一岛像旁白的尾句不挪",
          " ".join(w["w"] for w in fixed[0]).endswith("recording before class."), fixed)

    # 没说完的尾巴挪到下一岛（下一岛小写开头为证）
    fixed = reattach_fragments([_w("The", 0), _w("garden has been beautifully landscaped.", 5)])
    check("首词自成一岛并回下一句", len(fixed) == 1 and fixed[0][0]["w"] == "The", [join_words(x) for x in fixed])
    fixed = reattach_fragments([_w("What's your favorite way to spend a day off? Does", 0),
                                _w("this campus have a grocery store?", 13)])
    check("上一句尾巴 Does 挪到下一句", join_words(fixed[0]).endswith("day off?")
          and join_words(fixed[1]).startswith("Does this campus"), [join_words(x) for x in fixed])
    fixed = reattach_fragments([_w("I think so", 0), _w("Maybe later.", 13)])
    check("下一岛大写开头不挪", join_words(fixed[0]) == "I think so", [join_words(x) for x in fixed])
    # 录音暂停切开（前一截句末收尾、后一截大写开头、停顿 <8s）→ 并回并留痕；半句断开（断流）→ 不并
    pw = _w("Listen to an announcement at a school art exhibit. " + "Thank you for touring this special collection. " * 6, 0)
    pw += _w("We will then proceed to the next room and finish upstairs. " * 5, pw[-1]["end"] + 6.9)
    pisl = [x for x in tag_islands(pw) if x["tag"] == "mat"]
    check("暂停切开并回", len(pisl) == 1 and pisl[0].get("joins") == [6.9], [(x["tag"], x.get("joins")) for x in pisl])
    pw = _w("Listen to a conversation. " + "This bakery has been here for years. " * 6 + "Yes, you've be", 0)
    pw += _w("of our current students were customers there when young. " * 5, pw[-1]["end"] + 6.0)
    pisl = [x for x in tag_islands(pw) if x["tag"] == "mat"]
    check("半句断开（断流）不并", len(pisl) == 2, [(x["text"][:30], x.get("joins")) for x in pisl])
    # 正文丢了、只剩幻觉旁白
    check("正文缺失认得出", garbled_body(sentences(_w("Listen to an announcement at a school event. " * 4, 0))) is not None)
    check("通知只剩后半截（33 词）扣下", material_problem("la", {"body": sentences(_w(
        "Your tickets are available at the gate for five dollars. We hope you'll stay all day each day for a fun "
        "and educational experience. Contact the event organizers with any questions.", 0))}) is not None)
    check("正常长度的讲座不扣", material_problem("lat", {"body": sentences(_w("word " * 180 + "end.", 0))}) is None)
    check("正常正文不误判", garbled_body(sentences(_w(
        "The library will close early today for maintenance. Students can use the study rooms in the student center. "
        "Regular hours resume tomorrow morning at eight.", 0))) is None)

    # 句级基频分离（合成正弦：120Hz 男 / 220Hz 女）
    import numpy as np
    sr = 16000

    def tone(freq, sec=1.0):
        t = np.arange(int(sec * sr)) / float(sr)
        return (0.3 * np.sin(2 * np.pi * freq * t)).astype(np.float32)

    seq = [120, 220, 220, 120, 120, 120, 120, 120, 120, 120, 220]    # 教授一口气 7 句
    units = [{"start": float(i), "end": float(i) + 1.0} for i in range(len(seq))]
    g, why = diarize_sentences(np.concatenate([tone(f) for f in seq]), units)
    check("同一人连说 7 句不误杀", g == ["male" if f == 120 else "female" for f in seq], (g, why))
    g, why = diarize_sentences(np.concatenate([tone(150) for _ in range(6)]), units[:6])
    check("只有一个人判不出", g is None, why)
    g, why = diarize_sentences(np.concatenate([tone(120)] * 10 + [tone(220)]), units)
    check("连说 10 句判不像对话", g is None, why)
    check("音量句不是开场提示", isl[2]["tag"] == "lcr", isl[2]["text"])
    mods = parse_modules(isl)
    check("分 module", [(len(m["lcr"]), len(m["mats"])) for m in mods] == [(2, 2), (1, 1)],
          [(len(m["lcr"]), len(m["mats"])) for m in mods])
    check("旁白题材", [m.get("cue_type") for m in mods[0]["mats"]] == ["lc", "lat"])

    # 蓝图对照：M1 标准版式通过；题材矛盾 / LCR 数不对 / 校验和不对各自扣下
    def fake(n_lcr, cues):
        return {"lcr": [{}] * n_lcr, "mats": [{"cue_type": c} for c in cues], "odd": []}
    types, form, p = resolve_module(1, fake(12, ["lc", None, "lc", "la", "la", "la", "lat", None]), 32)
    check("M1 标准版式（缺旁白按蓝图补）", types == ["lc", "lc", "lc", "la", "la", "la", "lat", "lat"] and not p, (types, p))
    types, form, p = resolve_module(1, fake(12, ["lc", "la", "lc", "la", "la", "la", "lat", "lat"]), 32)
    check("旁白与蓝图矛盾扣下", types is None and p and p[0].startswith("recording_kind_conflict"), p)
    types, form, p = resolve_module(1, fake(11, ["lc"] * 3 + ["la"] * 3 + ["lat"] * 2), 32)
    check("LCR 少一句扣下", types is None and p[0].startswith("recording_form_mismatch"), p)
    types, form, p = resolve_module(2, fake(7, ["lat", "la", None]), 15)
    check("B 型 mcq2 缺旁白扣下", types is None and p[0].startswith("recording_kind_unknown"), p)
    types, form, p = resolve_module(2, fake(7, ["lat", "la", "lc"]), 15)
    check("B 型 mcq2 有旁白", types == ["lat", "la", "lc"] and form == "B", (types, form, p))
    types, form, p = resolve_module(2, fake(3, ["lc", "lc", "lat", "lat"]), 17)
    check("校验和不符扣下", types is None and p[0].startswith("recording_checksum"), p)
    # 录音与屏幕都从第 N 题开始：前面补空位 LCR
    m = fake(9, ["lc"] * 3 + ["la"] * 3 + ["lat"] * 2)
    types, form, p = resolve_module(1, m, 32, first_q=4)
    check("从 Q4 开始的录音补 3 句空位", types and m["lcr_padded"] == 3 and len(m["lcr"]) == 12, (types, p))
    m = fake(9, ["lc"] * 3 + ["la"] * 3 + ["lat"] * 2)
    check("屏幕没缺前几题就不补", resolve_module(1, m, 32)[0] is None and not m.get("lcr_padded"))

    # 录音整段缺一条材料：唯一异常空档处插占位
    def timed(n_lcr, spec):
        t, lcrs, mats = 0.0, [], []
        for _ in range(n_lcr):
            lcrs.append({"start": t, "end": t + 3}); t += 18
        for cue, dur, gap in spec:
            mats.append({"cue_type": cue, "start": t, "end": t + dur, "body": [{"text": "x " * 60}]}); t += dur + gap
        return {"lcr": lcrs, "mats": mats, "odd": []}
    m = timed(12, [("lc", 30, 28), ("lc", 30, 28), ("lc", 30, 97), ("la", 30, 30), ("la", 30, 30), ("lat", 100, 60), ("lat", 100, 0)])
    types, form, p = resolve_module(1, m, 32)
    check("缺一段通知 → 插占位对上蓝图", types == ["lc", "lc", "lc", "la", "la", "la", "lat", "lat"]
          and m["mats"][3].get("missing") and material_problem("la", m["mats"][3]), (types, p))
    m = timed(12, [("lc", 30, 97), ("lc", 30, 28), ("lc", 30, 97), ("la", 30, 30), ("la", 30, 30), ("lat", 100, 60), ("lat", 100, 0)])
    check("两处异常空档不猜", resolve_module(1, m, 32)[0] is None)
    m = timed(12, [("lc", 30, 28), ("lc", 30, 28), ("lc", 30, 28), ("la", 30, 30), ("la", 30, 30), ("lat", 100, 110), ("lat", 100, 0)])
    check("讲座后的长留白不当缺段", resolve_module(1, m, 32)[0] is None)

    m = fake(3, ["lc", "lc", "lat", "lat"])
    m["odd"] = [{"start": 5.0, "text": "something odd"}]
    types, form, p = resolve_module(2, m, 15)
    check("有怪岛扣下", types is None and p[0].startswith("recording_odd_island"), p)

    # 题干引原话反查角色
    turns = [{"speaker": "Woman", "text": "I'm so grateful to you for looking after my dog."},
             {"speaker": "Man", "text": "Wow, my vacations are so boring. I really envy you."}]
    items = [{"q_number": 14, "stem": 'What does the man imply when he says, "My vacations are so boring"?'}]
    check("原话在对的人那一轮", quote_speaker_problems(turns, items) == [])
    items = [{"q_number": 14, "stem": 'What does the woman mean when she says, "my vacations are so boring"?'}]
    p = quote_speaker_problems(turns, items)
    check("原话在另一个人那一轮扣下", p and p[0].startswith("speaker_quote_mismatch:Q14"), p)
    items = [{"q_number": 14, "stem": 'What does the woman mean when she says, "something never said"?'}]
    check("原话找不到不判", quote_speaker_problems(turns, items) == [])

    # 修复轮抄错位的题干
    lst = [{"type": "lc", "module": 2, "q_start": 4, "turns": [{"text": "I'm planning a dinner party for my guests. "
                                                                       "The chocolate mousse cake was made by a new chef."}],
            "items": [{"q_number": 4, "stem": "What does the man say about the chocolate mousse cake?"},
                      {"q_number": 5, "stem": "What does the man say about the chocolate mousse cake?"}]},
           {"type": "lc", "module": 2, "q_start": 6, "turns": [{"text": "You're taking a woodworking class with Professor Williams."}],
            "items": [{"q_number": 6, "stem": "Why does the woman mention her guests?"},
                      {"q_number": 7, "stem": "What is the man's attitude toward his woodworking class?"}]}]
    sp = stem_problems(lst, repaired={(2, 4), (2, 6)})
    check("同组题干重复剔没修复的那份", [q for q, _ in sp.get((2, 4), [])] == [5], sp)
    check("修复过的题配错材料剔掉", [q for q, _ in sp.get((2, 6), [])] == [6]
          and sp[(2, 6)][0][1].startswith("stem_mismatch"), sp)
    check("没修复的题不查配错（泛化题干词误报多）", not stem_problems(lst, repaired={(2, 4)}).get((2, 6)))
    check("两份都没修复就都剔", sorted(q for q, _ in stem_problems(lst).get((2, 4), [])) == [4, 5])

    # 近似重复
    bank = {"lcr": [{"id": "real_lcr_121b_1_11", "words": V.norm("Can you turn down the volume?").split(),
                     "options": option_key(["Yes, I think it is.", "A very noisy concert.",
                                            "Sure, sorry about that.", "No."])},
                    {"id": "real_lcr_316_1_02", "words": V.norm("Who is handling the fundraiser?").split(),
                     "options": ""}],
            "lc": [{"id": "real_lc_21a_1_15", "words": V.norm("I am so grateful to you for looking after "
                                                            "my dog while I am away " * 3).split(), "options": ""}]}
    check("LCR 逐字相同", find_dup("lcr", "Can you turn down the volume?", bank, "real_lcr_316_") ==
          (1.0, "real_lcr_121b_1_11"))
    check("LCR 本卷自己的不算", find_dup("lcr", "Who is handling the fundraiser?", bank, "real_lcr_316_") is None)
    hit = find_dup("lcr", "Can you turn down the volumes please?", bank, "real_lcr_316_",
                   options=["Sure, sorry about that.", "A very noisy concert.", "Yes, I think it is.", "No."])
    check("LCR 听错词但选项相同", hit and hit[1] == "real_lcr_121b_1_11", hit)
    check("LCR 听错词且选项不同不认", find_dup("lcr", "Can you turn down the volumes please?", bank,
                                          "real_lcr_316_", options=["A", "B", "C", "D"]) is None)
    hit = find_dup("lc", "I'm so grateful to you for looking after my dog while I am away " * 3, bank, "real_lc_316_")
    check("对话近似重复", hit and hit[1] == "real_lc_21a_1_15" and hit[0] >= 0.9, hit)
    check("对话长度差太多不认", find_dup("lc", "I am so grateful to you", bank, "real_lc_316_") is None)
    check("卷名 slug", [set_slug(x) for x in ("3.16新托福真题", "3.2新托福真题A卷", "5.6新托福真题_v2", "rf0610")]
          == ["316", "32a", "56v2", "rf0610"])

    # 保留方先后：文档来源永远可当；录音来源只认卷名在前的；自己不算
    check("文档来源可当保留方", may_keep("rf0610", False, "3.16新托福真题"))
    check("卷名在前的录音卷可当", may_keep("4.20新托福真题", True, "5.10新托福真题"))
    check("卷名在后的录音卷不可当（防互相记别名）", not may_keep("5.10新托福真题", True, "4.20新托福真题"))
    check("自己不算", not may_keep("3.16新托福真题", False, "3.16新托福真题"))

    # ── 口语复述定稿 ────────────────────────────────────────────────────
    U = lambda *ts: [{"text": t} for t in ts]        # noqa: E731（自检内的小构造器）
    # ① 商家答案页错字（tier/tire）：差 1 个词在预算内 → 以录音那一句定稿，并留痕
    got, diffs = repeat_from_audio({1: "next, deflate the tier completely"},
                                   U("Next, deflate the tire completely."))
    check("错字按录音定稿", got.get(1) == "Next, deflate the tire completely." and 1 in diffs, (got, diffs))
    # ② 两边逐词一致：只补大小写与句号，内容一个字不动
    got, diffs = repeat_from_audio({1: "first, select the right tool"},
                                   U("First, select the right tool."))
    check("一致时只补形态", got.get(1) == "First, select the right tool." and not diffs, (got, diffs))
    # ③ 录音听错但答案页说到了这句的结尾 → 内容留答案页的，只补形态
    got, diffs = repeat_from_audio({1: "be sure to reserve a court in advance to play tennis"},
                                   U("Be sure to record in advance to play tennis."))
    check("录音听错时留答案页", got.get(1) == "Be sure to reserve a court in advance to play tennis."
          and not diffs, (got, diffs))
    # ④ 答案页换行截半句（后面还有 4 个词）→ 不动，交给下游的 no_end_punct 扣下
    got, _ = repeat_from_audio({1: "call us on the helpline and we will"},
                               U("Call us on the helpline and we will get back to you."))
    check("真截断不补句号", 1 not in got, got)
    # ⑤ 找不到对应的那一句（旁白 / 别的题）→ 不动
    got, _ = repeat_from_audio({1: "the library closes at nine on weekdays"},
                               U("Listen to the manager and repeat what the manager says."))
    check("对不上就不换", 1 not in got, got)
    # ⑥ 单调游标：第二句只在第一句之后找，不许回头
    got, _ = repeat_from_audio({1: "open the door", 2: "open the door"},
                               U("Open the door.", "Open the door."))
    check("游标单调", got.get(1) == "Open the door." and got.get(2) == "Open the door.", got)
    check("尾巴判据", covers_tail("a b c d", "a b c d e f") is False        # 后面还有两个词 = 截断
          and covers_tail("a b c d", "a b c d e") is True               # 只差一个词 = 听错最后一个词
          and covers_tail("a b c d", "a b c x") is True)
    check("形态补全", fix_orthography("first, go") == "First, go." and fix_orthography("Go!") == "Go!")

    # ── 开场提示后面粘着第一句 LCR（3.2A）────────────────────────────────
    pw = _w("Select the volume icon at the top of the screen.", 0) + _w("Did you find the lecture interesting?", 15.6)
    check("粘着的第一句 LCR 切得出来", split_intro_tail(pw, sentences(pw)) == 10, split_intro_tail(pw, sentences(pw)))
    # 截半的开场提示残片不切（否则多一句 LCR，把本来认得出的 M1 顶坏 —— 3.30/4.15/4.27/5.23）
    pw = _w("Select the volume icon at the top of the screen.", 0) + _w("You now have the...", 15.6)
    check("截半的提示不切", split_intro_tail(pw, sentences(pw)) is None)
    # 没停顿的接着说不切
    pw = _w("Select the volume icon at the top of the screen.", 0) + _w("Did you find the lecture interesting?", 3.0)
    check("没停顿不切", split_intro_tail(pw, sentences(pw)) is None)

    # ── 面试题干（ASR + 四道机械闸）──────────────────────────────────────
    st = lambda t: [x["text"] for x in trim_interview_stem(sentences(_w(t, 0)))]   # noqa: E731
    check("剥指令与场景", st("Take an interview. An interviewer will ask you questions. "
                             "You have volunteered for a research study about music. "
                             "First, how important is music in your life?")
          == ["First, how important is music in your life?"], st("Take an interview. An interviewer will ask you questions. "
              "You have volunteered for a research study about music. First, how important is music in your life?"))
    check("剥应答词与铺垫", st("Great. That's interesting. Now, would you rather create music or listen to it?")
          == ["Now, would you rather create music or listen to it?"])
    # 前提句一个字都不许剥 —— 剥掉题就残了
    check("留前提句", st("Great. Some people say a healthy diet is hard to keep. What do you think about that?")
          == ["Some people say a healthy diet is hard to keep.", "What do you think about that?"])
    check("没有可剥的就原样", st("Tell me about a time you changed your diet. What motivated you?")
          == ["Tell me about a time you changed your diet.", "What motivated you?"])
    # 闸一：认不出旁白整组不收
    iv, why = build_interview({"words": _w("Hello there. How are you today?", 0)}, "", {})
    check("没有面试旁白不收", iv is None and why.startswith("interview_cue_missing"), why)
    # 闸二：旁白后不是恰好 4 段带问号的内容 → 整组不收
    ws = _w("Take an interview. An interviewer will ask you questions.", 0) + _w("Do you like music?", 20)
    iv, why = build_interview({"words": ws}, "", {})
    check("题数不是 4 不收", iv is None and why.startswith("interview_count"), why)

    if fails:
        print("SELF-TEST FAILED:")
        for f in fails:
            print("  ✗ " + f)
        return 1
    print("SELF-TEST OK")
    return 0


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", action="append", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--dump-islands", action="store_true", help="打印切岛结果（排查用）")
    ap.add_argument("--plan-structure", action="store_true",
                    help="只转写 + 查重，列出值得送结构化的题块 key（写 asr-recording/<卷>/structure-plan.json）")
    ap.add_argument("--speaking", action="store_true",
                    help="只合口语（整段口语录音 + 答案页复述句），不碰听力")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    if not args.set:
        print("用法: merge_recording_asr.py --set <卷名> [--set …] [--plan-structure | --dry-run] [--dump-islands]")
        return 2
    if args.plan_structure:
        print("■ 数字卷整块录音：结构化计划（只转写 + 查重，不调 API）")
        for s in args.set:
            plan_structure(s)
        return 0
    if args.speaking:
        print("■ 数字卷整段口语录音合流%s" % ("（--dry-run）" if args.dry_run else ""))
        totals = []
        for s in args.set:
            process_speaking(s, args, totals)
        if totals:
            sents = sum(len(next((r for r in rs if r["type"] == "repeat"), {}).get("items", []))
                        for _, _, rs in totals)
            ok = sum(1 for _, _, rs in totals for r in rs if r["type"] == "repeat"
                     for it in r.get("items", []) if it.get("usable"))
            print("\n合计：%d 套 · 复述 %d 句可落库 %d · 面试 %d 组按口径扣下 · DeepSeek 调用 0 次 · TTS 0 次"
                  % (len(totals), sents, ok, sum(x.get("interview_held", 0) for _, x, _ in totals)))
        return 0
    print("■ 数字卷整块录音听力合流%s" % ("（--dry-run）" if args.dry_run else ""))
    totals = []
    for s in args.set:
        process_set(s, args, totals)
        if args.dump_islands:
            p = os.path.join(REC_DIR, s, "listening.json")
            if os.path.exists(p):
                with open(p, encoding="utf-8") as fh:
                    rec = json.load(fh)
                for x in tag_islands(rec["words"]):
                    print("     %7.1fs %-5s %-4s %s" % (x["start"], x["tag"], x.get("cue_type") or "",
                                                     x["text"][:90]))
    if totals:
        units = sum(x["units"] for _, x, _ in totals)
        ok = sum(1 for _, _, rs in totals for r in rs if r["status"] == "ok")
        print("\n合计：%d 套 · 听力 %d 组可落库 %d（近似重复→别名 %d）· DeepSeek 调用 0 次 · TTS 0 次"
              % (len(totals), units, ok, sum(x["dup_of"] for _, x, _ in totals)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
