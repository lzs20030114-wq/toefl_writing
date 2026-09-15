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
CUE_MAX_WORDS = 16      # 旁白句的最长词数
MAT_JOIN_GAP = 8.0      # 材料被一次长停顿劈开：无旁白长岛紧跟材料、间隔不到这个数 → 同一段的后半截

DUP_MIN_SIM = 0.9
DUP_LEN_RATIO = (0.8, 1.25)
LCR_DUP_STIM_SIM = 0.75
LCR_DUP_OPT_SIM = 0.9

# 开场 / 换 module 的操作提示。刻意不收单个 "volume"：3.16 的 LCR 真有一句 "Can you turn down the volume?"
INTRO_RE = re.compile(
    r"(?i)(select the volume|volume (icon|control)|listening section|you will (answer|now hear|hear|listen)"
    r"|types of tasks|return to previous|\bmodule\s*\d|\bdirections\b|in this (part|section)"
    r"|now (begin|start)|this is the end)")
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
    return [{"start": s[0]["start"], "end": s[-1]["end"],
             "text": " ".join(x["w"] for x in s).strip()} for s in out]


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
        if len(sents) >= 2 and parse_cue(sents[-1:])[0]:
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
    return [ws for ws in out if ws]


def tag_islands(words):
    """整条录音的词 → 岛 [{tag: intro|lcr|mat|odd, start, end, words, sents, cue_type, cue, body}]。"""
    raw = []
    for ws in reattach_cues(split_islands(words)):
        sents = sentences(ws)
        text = " ".join(w["w"] for w in ws)
        rec = {"start": ws[0]["start"], "end": ws[-1]["end"], "words": list(ws), "sents": sents,
               "n": len(ws), "text": text, "cue_type": None, "cue": "", "body": []}
        typ, cue = parse_cue(sents)
        if typ:
            rec.update(tag="mat" if len(sents) > 1 else "cue_only", cue_type=typ, cue=cue, body=sents[1:])
        elif INTRO_RE.search(text) and len(ws) <= 60:
            rec["tag"] = "intro"
        elif len(ws) >= MAT_MIN_WORDS:
            rec.update(tag="mat", body=sents)
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
        # 材料被一次长停顿劈成两截
        if (prev and prev["tag"] == "mat" and rec["tag"] == "mat" and not rec["cue_type"]
                and rec["start"] - prev["end"] < MAT_JOIN_GAP):
            prev.update(body=prev["body"] + rec["sents"], end=rec["end"], words=prev["words"] + rec["words"],
                        n=prev["n"] + rec["n"])
            continue
        out.append(rec)
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


def resolve_module(mod_no, mod, module_total):
    """一个录音 module ↔ 蓝图：→ (逐段题材 list 或 None, 蓝图版式名 或 None, problems)。"""
    problems = []
    if mod["odd"]:
        problems.append("recording_odd_island:%s" % " / ".join(
            "%.0fs「%s」" % (x["start"], x["text"][:40]) for x in mod["odd"][:3]))
    n_lcr = len(mod["lcr"])
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


def load_bank(bank_dir=LISTENING_BANK):
    out = {}
    for typ in ("lcr", "lc", "la", "lat"):
        p = os.path.join(bank_dir, "%s.json" % typ)
        try:
            with open(p, encoding="utf-8") as fh:
                items = json.load(fh).get("items") or []
        except (OSError, ValueError):
            items = []
        out[typ] = [{"id": it.get("id"), "words": V.norm(spoken_text(typ, it)).split(),
                     "options": option_key(it.get("options")) if typ == "lcr" else ""} for it in items]
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


def transcribe_recording(setkey, audio):
    """整条录音 → {file, path, model, vad, words, segments}（缓存命中零成本）。"""
    out = os.path.join(REC_DIR, setkey, "listening.json")
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


def write_module_caches(setkey, rec, mod_no, words, segments):
    """按 module 切开的段级 / 词级缓存（bind_original_audio 第一来源分支的输入形状）。"""
    base = {"set": setkey, "role": "listening_m%d" % mod_no, "file": rec["file"], "path": rec["path"],
            "model": rec["model"], "device": rec.get("device"), "from": MERGER_ID,
            "window_sec": [words[0]["start"], words[-1]["end"]] if words else None}
    for d, payload in ((ASR_DIR, {**base, "segments": segments,
                                  "text": " ".join(s["text"] for s in segments)}),
                       (WORDS_DIR, {**base, "vad": True, "words": words, "segments": segments,
                                    "text": " ".join(w["w"] for w in words)})):
        p = os.path.join(d, setkey, "listening_m%d.json" % mod_no)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False)


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


def process_set(setkey, args, totals, bank=None):
    scan_path = os.path.join(OUT_DIR, "%s.json" % setkey)
    st_path = os.path.join(OUT_DIR, "%s.structured.json" % setkey)
    fs_path = os.path.join(OUT_DIR, "%s.structured.fs_parsed.json" % setkey)
    for p in (scan_path, st_path):
        if not os.path.exists(p):
            print("  跳过 %s：缺 %s" % (setkey, os.path.basename(p)))
            return None
    setdir = os.path.join(asr_cache.SRC_ROOT, setkey)
    if not os.path.isdir(setdir):
        print("  跳过 %s：找不到源目录 %s" % (setkey, setdir))
        return None
    with open(scan_path, encoding="utf-8") as fh:
        scan = json.load(fh)
    with open(st_path, encoding="utf-8") as fh:
        current = json.load(fh)
    if current.get("merged_asr") and (current["merged_asr"].get("merger") or "") != MERGER_ID:
        print("  跳过 %s：已被 %s 合流过，不是这条管线的卷" % (setkey, current["merged_asr"].get("merger")))
        return None
    parsed = current
    if os.path.exists(fs_path):
        with open(fs_path, encoding="utf-8") as fh:
            parsed = json.load(fh)
    if not any(r.get("section") == "listening" for r in parsed.get("results", [])):
        print("  跳过 %s：structured 里没有听力产物（先跑 structure_set --sections listening --merge）" % setkey)
        return None
    if F.load_pdf_text(setdir):
        print("  跳过 %s：这卷有「听力原文」PDF，该走 merge_first_source_asr.py" % setkey)
        return None
    recs = listening_recordings(setdir)
    if len(recs) != 1:
        print("  跳过 %s：听力录音 %d 条（%s）—— 这条管线只认一整条录音"
              % (setkey, len(recs), ", ".join(os.path.basename(r) for r in recs) or "无"))
        return None
    audio = recs[0]
    # 转写是本机 faster-whisper、零 API 费用，--dry-run 也照转（只落 asr-recording 缓存，不写产物）
    rec, cached = transcribe_recording(setkey, audio)
    if not getattr(V.decode_pcm, "cache_info", None):
        V.decode_pcm = functools.lru_cache(maxsize=2)(V.decode_pcm)   # 每段对话都要解同一条录音，缓存住

    islands = tag_islands(rec["words"])
    mods = parse_modules(islands)
    la = (scan.get("alignment") or {}).get("listening") or {}
    totals_by_mod = {m["module"]: m.get("total") for m in la.get("modules", [])}
    # 收尾噪声：最后一个 module 之后只剩零星短岛、没有材料（考试结束提示、VAD 漏过的杂音）→ 丢掉并记一笔
    tail_noise = []
    while len(mods) > len(totals_by_mod) and not mods[-1]["mats"] and len(mods[-1]["lcr"]) + len(mods[-1]["odd"]) <= 2:
        tail_noise.append(mods.pop())
    by_q = F.collect_items(parsed)
    slug = set_slug(setkey)
    bank = bank if bank is not None else load_bank()

    stats = F.new_stats()
    stats.update({"recording": os.path.basename(audio), "islands": len(islands),
                  "modules_found": len(mods), "dup_of": 0, "diarization_failed": 0,
                  "tail_noise": [x["text"][:60] for m in tail_noise for x in (m["lcr"] + m["odd"])]})
    mod_problems, pdf_mods, asr, apaths, forms, lc_notes, cues = {}, {}, {}, {}, {}, {}, {}
    if len(mods) != len(totals_by_mod):
        for m in totals_by_mod:
            mod_problems.setdefault(m, []).append(
                "recording_module_count:录音分出 %d 个 module、屏幕 %d 个" % (len(mods), len(totals_by_mod)))
    for i, mod in enumerate(mods[:2]):
        mod_no = i + 1
        mwords = [w for isl in (mod["lcr"] + mod["mats"] + mod["odd"]) for w in isl["words"]]
        mwords.sort(key=lambda w: w["start"])
        msents = [s for isl in sorted(mod["lcr"] + mod["mats"] + mod["odd"], key=lambda x: x["start"])
                  for s in isl["sents"]]
        types, form, problems = resolve_module(mod_no, mod, totals_by_mod.get(mod_no))
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
        pdf_mods[mod_no] = doc

    listening = F.build_listening(scan, parsed, pdf_mods, asr, apaths, stats, F.load_lc_overrides(setkey))

    # ── 回写本管线自己的判据：module 级问题、对话角色原因、旁白原句、近似重复 ──────────
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
            note = lc_notes.get((mod_no, k))
            if note:
                r["problems"] = [p for p in r["problems"] if not p.startswith("diarization_failed:no_turns")]
                extra.append(note)
                if note.startswith("diarization_failed"):
                    stats["diarization_failed"] += 1
        if r["type"] == "lc" and r.get("turns"):
            extra.extend(quote_speaker_problems(r["turns"], r.get("items")))
        r["problems"] = extra + r["problems"]
        if extra and any(p.startswith(("recording_", "speaker_quote_mismatch")) for p in extra):
            r["status"] = "flagged"
        # 近似重复：只在 module 结构自证过（没有 recording_* 问题）时才认 —— 结构坏了题号就不可信，别名会挂错槽
        structural = [p for p in r["problems"] if p.startswith(F.BLOCKING_PREFIX + ("recording_",))
                      and not p.startswith(DIARIZE_PREFIX + ("speaker_quote_mismatch",))]
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
    check("问句里的 listen 不挪", " ".join(w["w"] for w in fixed[0]) == "Did you listen", fixed)

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
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    if not args.set:
        print("用法: merge_recording_asr.py --set <卷名> [--set …] [--dry-run] [--dump-islands]")
        return 2
    print("■ 数字卷整块录音听力合流%s" % ("（--dry-run）" if args.dry_run else ""))
    totals = []
    bank = load_bank()
    for s in args.set:
        process_set(s, args, totals, bank)
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
