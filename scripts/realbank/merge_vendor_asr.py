#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""真题录入 —— 听力/口语「音频转写合流」。

把第二来源（商家重排版）8 套真题的听力/口语从 `status: "deferred"` 推进到可落库状态。

要解决的三件事：

1. **分组是坏的。** 解析器按 docx 段落分组，只有 6.10 那套的 docx 带
   `Module 1 Q13-Q14` 表头；其余 7 套没有表头，于是「一条音频带 2~4 题」被拆成
   逐题一组，第一题挂着音频、后面几题落进 `listening_mcq` 且 audio 为空。
   本脚本**不改解析器**（禁区），而是拿**音频文件名**当权威分组依据重建分组 ——
   `listening_m1_q13_q14_conversation_x.mp3` 自带 (module=1, q13..q14, 题材=conversation)，
   8 套 38 个文件命名完全统一，比 docx 版式可靠得多。

2. **文本源要择优。** 文档转写在 6 月几套是**节选摘要**（讲座只有 63 词，validator 的
   下限是 100），在 6.20 那套干脆是空的；而 Whisper 逐字稿是完整的。规则：
   文档是全文（词数 ≥ 0.7×ASR）就以文档为准、ASR 只做核对；否则以 ASR 为准。

3. **对话要分角色。** LC 落库要 `speakers[2] + conversation[{speaker,text}]`。
   文档带 `Man:/Woman:/Speaker A:` 标签时直接用；没有标签（6.20）时退到
   ffmpeg 解 PCM + 自相关基频估计做二分聚类，并要求「两簇中位差 ≥50Hz」且「轮流交替」——
   两条都过才算分离成功，否则打 `diarization_failed` 不落库。
   （实测基频在部分对话里并不可分，所以宁可丢题也不许瞎标角色。）

产物：就地改写 `.codex-tmp/realbank/<setkey>.structured.json` 的 listening/speaking 段，
并留两代备份：`.structured.parsed.json`（解析器原始产物，只在第一次写入，永不覆盖）
与 `.structured.prev.json`（上一次的一代备份）。

用法：
  python scripts/realbank/merge_vendor_asr.py --dry-run          # 只报数，不写文件、不调 API
  python scripts/realbank/merge_vendor_asr.py                    # 真跑（含 DeepSeek 校对）
  python scripts/realbank/merge_vendor_asr.py --no-proofread     # 真跑但跳过校对
  python scripts/realbank/merge_vendor_asr.py --set rf0610       # 只跑一套
"""
import os
import re
import sys
import json
import time
import shutil
import difflib
import argparse
import subprocess
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ops"))
import audio_names  # noqa: E402  （逐题音频文件名的读法，与解析器共用一份）
import _usage_ledger as ledger  # noqa: E402

ROOT = ledger.repo_root()
OUT_DIR = os.path.join(ROOT, ".codex-tmp", "realbank")
ASR_DIR = os.path.join(OUT_DIR, "asr-vendor")
MERGER_ID = "merge_vendor_asr-v1"

LETTERS = "ABCDEFGH"

# 文档转写要被认成「全文」的最低词数比（相对 ASR）。低于此值 = 节选摘要，改用 ASR。
DOC_FULL_RATIO = 0.7
# 归一化相似度下限：低于此值判定「文档句与音频对不上」。
SIM_MIN = 0.6
# 基频二分聚类的两簇中位差下限（Hz）。低于此值判定分不开。
F0_CLUSTER_MIN_GAP = 50.0
# DeepSeek 校对的字符级改动上限（超过 = 模型在改写而不是纠错，回退原 ASR）。
PROOFREAD_MAX_EDIT_RATIO = 0.05

# 考场提示句（音频开头的 framing）。
FRAMING_RE = re.compile(
    r"^\s*(now\s+)?listen\s+to\s+(a|an|the)\b|^\s*listen\s+again\b|^\s*narrator\s*[:：]", re.I)
# 面试音频开头的引导语。
INTERVIEW_INTRO_RE = re.compile(
    r"^\s*(thank(s| you)\b|thanks in advance\b|i'?d like to ask\b|i would like to ask\b"
    r"|as part of\b|you have agreed\b|i'?m going to ask\b|the researcher\b|this (survey|interview|study)\b"
    r"|today (i|we)\b|in this (interview|survey|study)\b|welcome\b)", re.I)
# 面试题干前的序数词。
INTERVIEW_LEAD_RE = re.compile(r"^\s*(first|next|now|then|finally|lastly|second|third)\s*[,，]?\s*", re.I)
# 文档转写里的说话人标签。
SPEAKER_LINE_RE = re.compile(r"^\s*([A-Za-z][A-Za-z .'\-]{0,24}?)\s*[:：]\s*(.+)$")
# 音频文件名 → (module, q_start, q_end, slug)
LISTEN_FILE_RE = re.compile(r"^listening_m(\d+)_q(\d+)(?:_q(\d+))?_(.+)\.mp3$", re.I)
REPEAT_FILE_RE = re.compile(r"^speaking_listen_repeat_q(\d+)\.mp3$", re.I)
INTERVIEW_FILE_RE = re.compile(r"^speaking_take_interview_q(\d+)\.mp3$", re.I)

MALE_LABELS = {"man", "male", "m", "speaker a", "student a", "boy"}
FEMALE_LABELS = {"woman", "female", "f", "speaker b", "student b", "girl"}
NARRATOR_LABELS = {"narrator", "announcer"}


# ══ 通用小工具 ═══════════════════════════════════════════════════════════
def words(s):
    return [w for w in re.split(r"\s+", str(s or "").strip()) if w]


def nwords(s):
    return len(words(s))


def norm(s):
    """归一化：小写、只留字母数字与空格、压空白。相似度全部在这个空间里比。"""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", str(s or "").lower())).strip()


def sim(a, b):
    """两段文本的归一化**词级**相似度（0~1）。空串返回 0。

    刻意按词比而不是按字符比：difflib 的 autojunk 会把出现率 >1% 的元素当噪声丢掉，
    在 >200 字符的英文串上等于把空格和 e/t/a 全丢了，相似度会塌到 0.0x
    （实测一段逐字相同的 184 词讲座被算成 0.028）。词级 + autojunk=False 没有这个坑。
    """
    na, nb = norm(a).split(), norm(b).split()
    if not na or not nb:
        return 0.0
    return difflib.SequenceMatcher(None, na, nb, autojunk=False).ratio()


def edit_ratio(a, b):
    """字符级改动比例：1 - 相似度。autojunk=False 同上。"""
    if not a:
        return 1.0
    return 1.0 - difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


def strip_framing(segments):
    """去掉开头的考场提示句 / Narrator 行；返回 (framing 文本, 剩下的 segments)。

    只剥**开头**、且只剥「短句 + 陈述句 + 以 listen to 开头」的段：真题正文里出现
    "Did you listen to the entire lecture?" 这种句子，剥错了会把整题清空。
    """
    framing = []
    rest = list(segments)
    while rest:
        t = rest[0]["text"].strip()
        if nwords(t) > 14 or "?" in t or not FRAMING_RE.match(t):
            break
        framing.append(rest.pop(0)["text"].strip())
    return " ".join(framing).strip(), rest


def sentence_case(s):
    """ASR 句子偶尔首字母小写、末尾缺句点 —— 补上，不改词。"""
    t = str(s or "").strip()
    if not t:
        return t
    t = t[0].upper() + t[1:]
    if t[-1] not in ".!?":
        t += "."
    return t


# ══ ASR 读取 ════════════════════════════════════════════════════════════
def asr_dir_for(structured):
    return os.path.join(ASR_DIR, os.path.basename(os.path.normpath(structured["source_dir"])))


def load_asr(dirpath):
    """<mp3名> → asr dict。目录不存在返回 {}。"""
    out = {}
    if not os.path.isdir(dirpath):
        return out
    for fn in sorted(os.listdir(dirpath)):
        if not fn.endswith(".json") or fn.startswith("_"):
            continue
        with open(os.path.join(dirpath, fn), encoding="utf-8") as fh:
            j = json.load(fh)
        out[j["file"]] = j
        # item_level 有子目录时逐字稿名字是 `listening__L01_x.mp3`（run_asr 扁平化过），
        # 而分组用的是裸文件名 —— 两个 key 都挂上，查得到就行。
        bare = j["file"].split("__")[-1]
        out.setdefault(bare, j)
    return out


class AudioIndex(dict):
    """裸文件名 → 绝对路径；`.rel` 记相对 item_level 的路径（带子目录）。

    分组正则、ASR 缓存都按裸文件名认，但 audio_path 要写相对路径 —— 两者分开放，
    不往同一个 dict 里塞 `__rel__` 前缀的假 key（那会让「音频条数」之类的统计翻倍）。
    """

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.rel = {}


def audio_index(source_dir):
    """套题目录下的 item_level 音频清单（文件名 → 绝对路径）。"""
    d = os.path.join(source_dir, "audio", "item_level")
    if not os.path.isdir(d):
        return {}
    # 第二波起 item_level 下面可能还有 listening/ speaking/ 一层（8.19 / 8.22）。
    # key 仍用**裸文件名**（正则和 ASR 缓存都按它认），值记相对 item_level 的路径，
    # 好让 audio_path 指得准。同名文件跨子目录冲突时保留先见到的并不静默——记在 _dupes。
    out = AudioIndex()
    for dirpath, _dirs, files in os.walk(d):
        rel = os.path.relpath(dirpath, d)
        for fn in sorted(files):
            if not fn.lower().endswith(".mp3"):
                continue
            relpath = fn if rel in (".", "") else (rel.replace(os.sep, "/") + "/" + fn)
            if fn in out:
                continue
            out[fn] = os.path.join(dirpath, fn)
            out.rel[fn] = relpath
    return out


def unit_type(slug, nq):
    """音频文件名的题材 slug + 题数 → 库里的题型。

    命名不总是带题材词（6.20 有 `q29_q32_physics_ice_skating`、`q08_q11_science_podcast_*`），
    所以先认关键词，认不出就按题数兜底：1 题 = LCR，≥3 题 = 讲座，其余按对话。
    """
    s = slug.lower()
    if "choose_response" in s:
        return "lcr"
    if "conversation" in s:
        return "lc"
    if "announcement" in s:
        return "la"
    if "lecture" in s or "talk" in s or "podcast" in s or "discussion" in s:
        return "lat"
    if nq == 1:
        return "lcr"
    return "lat" if nq >= 3 else "lc"


# ══ 基频分离（LC 兜底） ═════════════════════════════════════════════════
def decode_pcm(path):
    """mp3 → 16k mono float32。ffmpeg 不可用或失败返回 None。"""
    try:
        import numpy as np
    except ImportError:
        return None
    try:
        p = subprocess.run(["ffmpeg", "-v", "quiet", "-i", path, "-ac", "1", "-ar", "16000",
                            "-f", "s16le", "-"], capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0 or not p.stdout:
        return None
    return np.frombuffer(p.stdout, dtype="<i2").astype(np.float32) / 32768.0


def f0_median(x, sr=16000, fmin=70, fmax=320):
    """一段波形的基频中位数（自相关法）。有声帧不足 3 帧返回 None。"""
    import numpy as np
    fl, hop = int(0.040 * sr), int(0.020 * sr)
    vals = []
    for i in range(0, max(0, len(x) - fl), hop):
        fr = x[i:i + fl]
        if float(np.sqrt((fr ** 2).mean())) < 0.01:
            continue
        fr = fr - fr.mean()
        ac = np.correlate(fr, fr, "full")[fl - 1:]
        if ac[0] <= 0:
            continue
        lo, hi = int(sr / fmax), min(int(sr / fmin), len(ac) - 1)
        if hi <= lo:
            continue
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] / ac[0] < 0.3:
            continue
        vals.append(sr / k)
    if len(vals) < 3:
        return None
    return float(np.median(vals))


def diarize(audio_path, segments):
    """按基频把 segments 二分成男/女两簇。

    返回 (genders, detail)：genders 是与 segments 等长的 "male"/"female" 列表；
    分不开时 genders 为 None，detail 里说明原因。

    两道闸：
      · 两簇中位基频差 < 50Hz  → 判定分不开（同性别或估计失败）。
      · 分完之后不是「轮流交替」（同一角色连续 3 段以上，或只有一个角色说话）→ 判定不可信。
    """
    try:
        import numpy as np
    except ImportError:
        return None, "numpy 不可用"
    x = decode_pcm(audio_path)
    if x is None:
        return None, "ffmpeg 解码失败"
    f0s = []
    for s in segments:
        a, b = int(s["start"] * 16000), int(s["end"] * 16000)
        f0s.append(f0_median(x[a:b]))
    known = [f for f in f0s if f]
    if len(known) < 3:
        return None, "有效基频段不足"
    # 一维二分：按中点切，迭代到稳定（等价于 1D k-means，k=2）
    lo, hi = min(known), max(known)
    c0, c1 = lo, hi
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
    if abs(c1 - c0) < F0_CLUSTER_MIN_GAP:
        return None, "两簇中位基频差 %.0fHz < %.0fHz" % (abs(c1 - c0), F0_CLUSTER_MIN_GAP)
    male_c, female_c = (c0, c1) if c0 < c1 else (c1, c0)
    genders = []
    last = None
    for f in f0s:
        if f is None:
            genders.append(last or "male")     # 无声段跟上一段走
        else:
            genders.append("male" if abs(f - male_c) <= abs(f - female_c) else "female")
        last = genders[-1]
    if len(set(genders)) < 2:
        return None, "只聚出一个说话人"
    # 轮流交替检查：把连续同性别压成 run，最长 run 不许超过 3 段，且至少 3 个 run。
    runs = []
    for g in genders:
        if runs and runs[-1][0] == g:
            runs[-1][1] += 1
        else:
            runs.append([g, 1])
    if len(runs) < 3:
        return None, "说话人切换次数太少（%d 段）" % len(runs)
    if max(r[1] for r in runs) > 3:
        return None, "同一说话人连续 %d 段，不像对话轮替" % max(r[1] for r in runs)
    return genders, "两簇 %.0fHz / %.0fHz" % (male_c, female_c)


# ══ 文档转写解析 ════════════════════════════════════════════════════════
def doc_lines(transcript):
    """文档转写 → [(label|None, text)]。"""
    out = []
    for raw in str(transcript or "").split("\n"):
        t = raw.strip()
        if not t:
            continue
        m = SPEAKER_LINE_RE.match(t)
        if m:
            out.append((m.group(1).strip(), m.group(2).strip()))
        else:
            out.append((None, t))
    return out


def lcr_stimulus_from_doc(transcript, q_raw):
    """LCR 的文档转写是整块 Q1-Q12 题干列表 —— 按题号取那一行。

    取到的行还要过一道**形状闸**：6.20 那套的转写块里混进了目录行
    （`-Q5 | Conversation: Health`），那不是刺激句。目录行进来会被当成
    「文档有刺激句、但和音频对不上」，把本来能救的题误判成源料错位。
    """
    for raw in str(transcript or "").split("\n"):
        m = re.match(r"^\s*[-–—]?\s*Q\s*%d\s*[.、:：]?\s*(.+)$" % q_raw, raw.strip(), re.I)
        if m:
            s = m.group(1).strip()
            if "|" in s or s.startswith("-") or nwords(s) < 4:
                return ""
            return s
    return ""


def doc_turns(transcript):
    """文档转写 → (turns, ok, note)。turns = [{speaker: "Man"/"Woman", text}]。

    去掉 Narrator 后必须恰好两个标签 —— **谁说哪句**由文档确定，这是内容事实。
    至于这两个人是男是女：标签写 Man/Woman/Speaker A/B 时按标签走；写的是人名或
    Student/Friend 这类不含性别的词时，按出场顺序指派（先出场=Man）并打标 ——
    因为我们本来就要用自家 TTS 重新配音，原音频的音色不会被保留，
    「谁是男谁是女」在这里是**选角**而不是内容，不需要为它丢题。
    """
    lines = doc_lines(transcript)
    labeled = [(l, t) for (l, t) in lines if l and l.strip().lower() not in NARRATOR_LABELS]
    if len(labeled) < 4:
        return [], False, "文档里带标签的行不足 4 行"
    labels = []
    for l, _ in labeled:
        if l not in labels:
            labels.append(l)
    if len(labels) != 2:
        return [], False, "文档里的说话人标签有 %d 个（需要恰好 2 个）" % len(labels)
    low = [l.strip().lower() for l in labels]
    if low[0] in MALE_LABELS and low[1] in FEMALE_LABELS:
        mapping, note = {labels[0]: "Man", labels[1]: "Woman"}, "labels"
    elif low[0] in FEMALE_LABELS and low[1] in MALE_LABELS:
        mapping, note = {labels[0]: "Woman", labels[1]: "Man"}, "labels"
    else:
        mapping = {labels[0]: "Man", labels[1]: "Woman"}
        note = "gender_assigned_by_order:%s→Man,%s→Woman" % (labels[0], labels[1])
    return [{"speaker": mapping[l], "text": t} for l, t in labeled], True, note


def merge_same_speaker(turns):
    """把连续同一说话人的行并成一轮（validator 数的是「轮」不是「句」）。"""
    out = []
    for t in turns:
        if out and out[-1]["speaker"] == t["speaker"]:
            out[-1]["text"] = (out[-1]["text"].rstrip() + " " + t["text"].lstrip()).strip()
        else:
            out.append({"speaker": t["speaker"], "text": t["text"].strip()})
    return out


# ══ DeepSeek 校对 ═══════════════════════════════════════════════════════
MODEL = "deepseek-v4-flash"
API_URL = "https://api.deepseek.com/chat/completions"
PROOFREAD_SYS = (
    "You are proofreading an automatic speech-recognition transcript of a TOEFL listening "
    "passage. Fix ONLY misheard words, obvious typos, and missing sentence punctuation or "
    "capitalization. Do NOT rephrase, do NOT change sentence structure, do NOT add or delete "
    "sentences, do NOT add commentary. Keep every sentence and its order exactly as given. "
    "Output ONLY the corrected transcript as plain text."
)


def load_env():
    env = {}
    for name in (".env.local", ".env"):
        p = os.path.join(ROOT, name)
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as fh:
            for line in fh:
                m = re.match(r"\s*([A-Z_]+)\s*=\s*(.+?)\s*$", line)
                if m and m.group(1) not in env:
                    env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
        break
    return env


ENV = load_env()
KEY = os.environ.get("DEEPSEEK_API_KEY") or ENV.get("DEEPSEEK_API_KEY", "")
PROXY = os.environ.get("DEEPSEEK_PROXY_URL") or ENV.get("DEEPSEEK_PROXY_URL", "")


def proofread(text, label):
    """调 DeepSeek 纠错。返回 (文本, 说明)。任何失败/越界都回退原文，绝不抛错。"""
    if not KEY:
        return text, "proofread_skipped:no_api_key"
    body = {"model": MODEL, "temperature": 0, "stream": False,
            "messages": [{"role": "system", "content": PROOFREAD_SYS},
                         {"role": "user", "content": text[:12000]}]}
    t0 = time.time()
    try:
        req = urllib.request.Request(API_URL, data=json.dumps(body).encode("utf-8"),
                                     headers={"Authorization": "Bearer %s" % KEY,
                                              "Content-Type": "application/json"})
        if PROXY:
            host = re.sub(r"^https?://", "", PROXY)
            req.set_proxy(host, "http")
            req.set_proxy(host, "https")
        with urllib.request.urlopen(req, timeout=120) as r:
            resp = json.loads(r.read().decode("utf-8"))
        out = (resp["choices"][0]["message"]["content"] or "").strip()
        ledger.record(script="merge_vendor_asr.py", label=label, model=MODEL,
                      usage=resp.get("usage") or {}, ms=(time.time() - t0) * 1000, ok=True)
    except Exception as e:                                   # noqa: BLE001
        ledger.record(script="merge_vendor_asr.py", label=label, model=MODEL, usage=None,
                      ms=(time.time() - t0) * 1000, ok=False, error=e)
        return text, "proofread_failed:%s" % str(e)[:60]
    if not out:
        return text, "proofread_rejected:empty"
    ratio = edit_ratio(text, out)
    if ratio > PROOFREAD_MAX_EDIT_RATIO:
        return text, "proofread_rejected:edit_ratio=%.3f" % ratio
    return out, "proofread_ok:edit_ratio=%.3f" % ratio


# ══ 分组重建 ════════════════════════════════════════════════════════════
def collect_listening_items(structured):
    """把解析器散落在多个 result 里的听力题收成 {(module, q_raw): item}。"""
    by_q = {}
    for r in structured.get("results", []):
        if r.get("section") != "listening":
            continue
        for it in r.get("items", []):
            q = it.get("q_number_raw")
            if q is None:
                continue
            k = (r.get("module", 1), q)
            prev = by_q.get(k)
            # 同题号出现多次时取「选项最全」的那条（解析器的重复组通常有一条是空壳）
            if prev is None or len(it.get("options") or []) > len(prev.get("options") or []):
                by_q[k] = it
    return by_q


def collect_speaking(structured):
    out = {"repeat": {}, "interview": {}, "context": {"repeat": "", "interview": ""}}
    for r in structured.get("results", []):
        if r.get("section") != "speaking":
            continue
        t = r.get("type")
        if t not in ("repeat", "interview"):
            continue
        out["context"][t] = r.get("context") or out["context"][t]
        for it in r.get("items", []):
            n = it.get("n") or it.get("q_number")
            if n:
                out[t][int(n)] = it
    return out


def build_listening(setkey, structured, asr, audio, stats):
    """按音频文件重建听力分组。返回新的 results 列表。"""
    by_q = collect_listening_items(structured)
    units = []
    for fn in sorted(audio):
        u = audio_names.listen_unit(fn)
        if not u:
            continue
        units.append({"file": fn, "path": audio[fn], "module": u["module"],
                      "q_start": u["q_start"], "q_end": u["q_end"], "slug": u["slug"],
                      "rel": getattr(audio, "rel", {}).get(fn, fn)})

    results = []
    for u in units:
        qs = list(range(u["q_start"], u["q_end"] + 1))
        items = [by_q.get((u["module"], q)) for q in qs]
        got = [(q, it) for q, it in zip(qs, items) if it]
        typ = unit_type(u["slug"], len(qs))
        problems = []
        missing = [q for q, it in zip(qs, items) if not it]
        if missing:
            problems.append("docx 里缺题：M%dQ%s" % (u["module"], ",".join(map(str, missing))))
        a = asr.get(u["file"])
        if not a:
            problems.append("asr_missing:%s" % u["file"])
        segs = list(a["segments"]) if a else []
        framing, body = strip_framing(segs)
        asr_text = " ".join(s["text"].strip() for s in body).strip()

        # ── 逐题型定 transcript_final / turns ──────────────────────────
        turns = None
        speakers = None
        transcript_final = ""
        similarity = None
        doc_tr = ""
        for _, it in got:
            if it.get("transcript"):
                doc_tr = it["transcript"]
                break
        doc_body = "\n".join(t for (l, t) in doc_lines(doc_tr)
                             if not (l and l.strip().lower() in NARRATOR_LABELS))
        doc_is_full = bool(doc_body) and nwords(doc_body) >= DOC_FULL_RATIO * max(1, nwords(asr_text))

        if typ == "lcr":
            q_raw = u["q_start"]
            stim = lcr_stimulus_from_doc(doc_tr, q_raw)
            if stim and asr_text:
                similarity = round(sim(stim, asr_text), 3)
                if similarity < SIM_MIN:
                    problems.append("stimulus_mismatch:sim=%.3f" % similarity)
                transcript_final = stim
            elif stim:
                # 商家音频里有一批 LCR 的 mp3 转写为空（VAD 认为整条无人声）——
                # 我们本来就要重新配音，所以不算硬伤，只是这一条没法交叉核对。
                problems.append("asr_empty_no_crosscheck")
                transcript_final = stim
            elif asr_text:
                problems.append("stimulus_from_asr")
                transcript_final = sentence_case(asr_text)
            else:
                problems.append("lcr_no_stimulus")
        elif typ == "lc":
            dt, ok, note = doc_turns(doc_tr) if doc_is_full else ([], False, "文档转写不是全文")
            if ok:
                turns = merge_same_speaker(dt)
                if note != "labels":
                    problems.append(note)
                if asr_text:
                    similarity = round(sim(" ".join(t["text"] for t in turns), asr_text), 3)
                    if similarity < SIM_MIN:
                        problems.append("transcript_mismatch:sim=%.3f" % similarity)
                else:
                    problems.append("asr_empty_no_crosscheck")
            else:
                genders, why = diarize(u["path"], body) if body else (None, "无 ASR 分段")
                if not genders:
                    problems.append("diarization_failed:%s / %s" % (note, why))
                else:
                    raw = [{"speaker": "Man" if g == "male" else "Woman",
                            "text": sentence_case(s["text"])}
                           for g, s in zip(genders, body)]
                    turns = merge_same_speaker(raw)
                    similarity = round(sim(doc_body, asr_text), 3) if doc_body else None
                    problems.append("turns_from_asr_diarization:%s" % why)
            if turns:
                names = []
                for t in turns:
                    if t["speaker"] not in names:
                        names.append(t["speaker"])
                if len(names) < 2:
                    problems.append("diarization_failed:只有一个说话人")
                    turns = None
                else:
                    speakers = [{"name": n, "role": "student",
                                 "gender": "male" if n == "Man" else "female"} for n in ("Man", "Woman")]
                    transcript_final = "\n".join("%s: %s" % (t["speaker"], t["text"]) for t in turns)
        else:  # la / lat
            if doc_is_full:
                transcript_final = " ".join(t for (l, t) in doc_lines(doc_tr)
                                            if not (l and l.strip().lower() in NARRATOR_LABELS)).strip()
                similarity = round(sim(transcript_final, asr_text), 3)
                if similarity < SIM_MIN:
                    problems.append("transcript_mismatch:sim=%.3f" % similarity)
            else:
                transcript_final = asr_text
                similarity = round(sim(doc_body, asr_text), 3) if doc_body else None
                problems.append("transcript_from_asr")

        # ── 题目本身的硬闸 ──────────────────────────────────────────────
        out_items = []
        for q, it in got:
            ip = []
            opts = it.get("options") or []
            if len(opts) != 4:
                ip.append("options_%d" % len(opts))
            if it.get("answer_index") is None:
                ip.append("no_answer")
            out_items.append({
                "q_number": it.get("q_number"), "q_number_raw": q,
                "material": "", "material_kind": "audio",
                "stem": it.get("stem", ""), "options": opts,
                "answer_index": it.get("answer_index"), "answer_key": it.get("answer_key"),
                "audio_path": "audio/item_level/%s" % u.get("rel", u["file"]),
                "transcript": it.get("transcript", ""),
                "transcript_final": transcript_final,
                "turns": turns, "framing": framing,
                "asr_similarity": similarity,
                "problems": ip,
            })
        bad = [x for x in out_items if x["problems"]]
        if bad:
            problems.append("题目字段不全：%s" % ",".join("Q%d(%s)" % (x["q_number_raw"], "/".join(x["problems"])) for x in bad))

        blocking = [p for p in problems
                    if p.startswith(("stimulus_mismatch", "diarization_failed", "asr_missing",
                                     "transcript_mismatch", "lcr_no_stimulus"))]
        if not out_items:
            blocking.append("no_items")
        if not transcript_final and typ != "lc":
            blocking.append("empty_transcript")
        if typ == "lc" and not turns:
            blocking.append("empty_turns")

        results.append({
            "key": "listening|%d|%d" % (u["module"], u["q_start"]),
            "section": "listening", "module": u["module"], "type": typ,
            "q_start": u["q_start"], "q_end": u["q_end"], "tier": "recalled",
            "status": "flagged" if blocking else "ok",
            "problems": problems,
            "merged_by": MERGER_ID,
            "audio_file": u["file"],
            "framing": framing,
            "asr_text": asr_text,
            "asr_similarity": similarity,
            "transcript_final": transcript_final,
            "turns": turns,
            "speakers": speakers,
            "items": out_items,
        })
        stats["units"] += 1
        stats["blocked" if blocking else "ok"] += 1
        for b in blocking:
            stats["reasons"][b.split(":")[0]] = stats["reasons"].get(b.split(":")[0], 0) + 1
    return results


def interview_stem_from_asr(a):
    """面试音频 ASR → 题干。

    音频开头是研究者的引导语（"Thank you for agreeing to participate…"、
    "The researcher will ask you some questions about…"），题干是它后面的全部内容。

    做法是**只剥引导语**，剩下的整段都算题干 —— 不能改成「从第一个问号开始截」：
    Whisper 会把长问句切在句中（"…would you prefer sharing your work publicly or
    keeping" / "you fit?"），按问号截会只剩 "You fit?" 这种残句（实测 6.15/6.22 各中两条）。
    """
    segs = [s["text"].strip() for s in a["segments"]] if a else []
    sents = []
    for t in segs:
        sents.extend([x.strip() for x in re.split(r"(?<=[.!?])\s+", t) if x.strip()])
    if not sents:
        return ""
    start = 0
    while start < len(sents) and INTERVIEW_INTRO_RE.match(sents[start]):
        start += 1
    if start >= len(sents):
        start = 0                                  # 整段都像引导语 → 宁可全留，交给词数闸
    # 剥完只剩残句时退一句：宁可多带一句引导，也别把题干截没了。
    while start > 0 and nwords(" ".join(sents[start:])) < 5:
        start -= 1
    body = INTERVIEW_LEAD_RE.sub("", " ".join(sents[start:]).strip()).strip()
    # 去掉 "First," 之后首字母会残留小写（"first, do you feel…" → "do you feel…"）
    return sentence_case(body)


def build_speaking(setkey, structured, asr, audio, stats):
    sp = collect_speaking(structured)
    results = []

    def _speak_files(kind):
        got = []
        for fn in audio:
            u = audio_names.speak_unit(fn)
            if u and u["kind"] == kind and not u["setup"]:
                got.append((u["n"], fn))
        return [x[1] for x in sorted(got)], dict((fn, n) for n, fn in got)

    rep_files, rep_n = _speak_files("repeat")
    if rep_files:
        items, problems = [], []
        for fn in rep_files:
            n = rep_n[fn]
            a = asr.get(fn)
            asr_text = (a or {}).get("text", "").strip()
            doc = (sp["repeat"].get(n) or {}).get("sentence", "").strip()
            ip = []
            usable = True
            if doc and asr_text:
                s = round(sim(doc, asr_text), 3)
                if s < SIM_MIN:
                    ip.append("sentence_mismatch:sim=%.3f" % s)
                    usable = False
                text = doc
            elif doc:
                s = None
                text = doc
                ip.append("asr_empty_no_crosscheck")
            else:
                # 复述句一律以文档为准。ASR 会把两三句粘成一句、把 materials 听成 metals，
                # 而这句是要念给用户跟读的原句 —— 文档没有就 hold，不拿 ASR 顶上。
                s = None
                text = ""
                usable = False
                ip.append("no_sentence_in_doc" if asr_text else "no_sentence")
            # validator 的绝对区间是 3~25 词；越界的单句剔掉就好，不该整套报废
            # （实测 6.29 的第 7 句被 ASR 连读成 29 词）。
            if usable and text and not (3 <= nwords(text) <= 25):
                usable = False
                ip.append("sentence_word_count:%d" % nwords(text))
            items.append({"n": n, "q_number": n,
                          "audio_path": "audio/item_level/%s" % getattr(audio, "rel", {}).get(fn, fn),
                          "sentence": doc, "sentence_final": text, "usable": usable,
                          "transcript_final": text, "asr_similarity": s, "problems": ip})
        bad = [it for it in items if not it["usable"]]
        if bad:
            problems.append("不可用句 %d 条（%s）" % (len(bad), ",".join("Q%d" % it["n"] for it in bad)))
        # 一整套 7 句里坏几句不该整套报废：validator 认 5 句起（<5 才是硬错）。
        ok_n = len(items) - len(bad)
        results.append({
            "key": "speaking|1|repeat|1", "section": "speaking", "module": 1, "type": "repeat",
            "q_start": 1, "q_end": len(items), "tier": "recalled",
            "status": "ok" if ok_n >= 5 else "flagged",
            "problems": problems, "merged_by": MERGER_ID,
            "context": sp["context"]["repeat"], "items": items,
        })
        stats["repeat_sets"] += 1
        stats["repeat_sentences"] += len(items)

    iv_files, iv_n = _speak_files("interview")
    if iv_files:
        items, problems = [], []
        for fn in iv_files:
            n = iv_n[fn]
            a = asr.get(fn)
            asr_stem = interview_stem_from_asr(a)
            doc_raw = (sp["interview"].get(n) or {}).get("stem", "").strip()
            # "Response: ______" 这类占位符不是题干
            doc = "" if (not doc_raw or re.match(r"^response\s*[:：]?\s*_*$", doc_raw, re.I)
                         or nwords(doc_raw) < 8) else doc_raw
            ip = []
            usable = True
            if doc and asr_stem:
                s = round(sim(doc, asr_stem), 3)
                if s < SIM_MIN:
                    ip.append("stem_mismatch:sim=%.3f" % s)
                    usable = False
                text = doc
            elif doc:
                s = None
                text = doc
                ip.append("asr_empty_no_crosscheck")
            else:
                # 题干同理：文档没有就 hold，不用 ASR 顶（同上）。
                s = None
                text = ""
                usable = False
                ip.append("no_stem_in_doc" if asr_stem else "no_stem")
            # validator 的绝对区间是 10~60 词；越界的单题剔掉，别拖垮整套。
            if usable and text and not (10 <= nwords(text) <= 60):
                usable = False
                ip.append("stem_word_count:%d" % nwords(text))
            items.append({"n": n, "q_number": n,
                          "audio_path": "audio/item_level/%s" % getattr(audio, "rel", {}).get(fn, fn),
                          "stem": doc, "stem_final": text, "transcript_final": text, "usable": usable,
                          "reference_answer": (sp["interview"].get(n) or {}).get("reference_answer", ""),
                          "asr_similarity": s, "problems": ip})
        bad = [it for it in items if not it["usable"]]
        if bad:
            problems.append("不可用题 %d 条（%s）" % (len(bad), ",".join("Q%d" % it["n"] for it in bad)))
        ok_n = len(items) - len(bad)
        results.append({
            "key": "speaking|1|interview|1", "section": "speaking", "module": 1, "type": "interview",
            "q_start": 1, "q_end": len(items), "tier": "recalled",
            "status": "ok" if ok_n >= 3 else "flagged",
            "problems": problems, "merged_by": MERGER_ID,
            "context": sp["context"]["interview"], "items": items,
        })
        stats["interview_sets"] += 1
        stats["interview_questions"] += len(items)
    return results


# ══ 主流程 ══════════════════════════════════════════════════════════════
def proofread_targets(results):
    """要送校对的组：文本来自 ASR 的 LA/LAT/LC（文档全文的不动）。"""
    out = []
    for r in results:
        if r["section"] != "listening" or r["status"] != "ok":
            continue
        from_asr = any(p.startswith(("transcript_from_asr", "turns_from_asr")) for p in r["problems"])
        if from_asr and r["type"] in ("la", "lat", "lc"):
            out.append(r)
    return out


def apply_proofread(r, note_list):
    if r["type"] == "lc":
        for t in r["turns"]:
            new, note = proofread(t["text"], "%s/%s" % (r["key"], r["type"]))
            note_list.append(note)
            if note.startswith("proofread_ok"):
                t["text"] = new
        r["transcript_final"] = "\n".join("%s: %s" % (t["speaker"], t["text"]) for t in r["turns"])
        for it in r["items"]:
            it["turns"] = r["turns"]
            it["transcript_final"] = r["transcript_final"]
    else:
        new, note = proofread(r["transcript_final"], "%s/%s" % (r["key"], r["type"]))
        note_list.append(note)
        if note.startswith("proofread_ok"):
            r["transcript_final"] = new
            for it in r["items"]:
                it["transcript_final"] = new
    r["problems"].append("proofread:%s" % ";".join(note_list[-3:]))


def process_set(path, args, totals):
    # 永远从**解析器原始产物**出发：第一次跑时它就是 structured.json 本身，之后是
    # 备份下来的 .structured.parsed.json。这样重跑合流是幂等的 —— 不会在上一次的
    # 合流结果（已改写过的分组、已校对过的文本）上再合一次，越滚越偏。
    parsed = path.replace(".structured.json", ".structured.parsed.json")
    src = parsed if os.path.exists(parsed) else path
    with open(src, encoding="utf-8") as fh:
        st = json.load(fh)
    setkey = st["set"]
    asr = load_asr(asr_dir_for(st))
    audio = audio_index(st["source_dir"])
    if not audio:
        print("  跳过 %s：找不到 audio/item_level" % setkey)
        return None
    expected = len([f for f in audio])
    if len(asr) < expected:
        print("  跳过 %s：ASR 还没转完（%d/%d）" % (setkey, len(asr), expected))
        return None

    stats = {"units": 0, "ok": 0, "blocked": 0, "reasons": {},
             "repeat_sets": 0, "repeat_sentences": 0,
             "interview_sets": 0, "interview_questions": 0}
    if args.speaking_only:
        # 只重建口语：听力沿用 structured.json 里已合流 + 已校对的结果，
        # 免得为了改一句复述句就把整套听力重跑一遍（要重花 DeepSeek 校对钱，
        # 而且校对是 LLM，重跑出来的文本不保证与已配好音的那版逐字一致）。
        with open(path, encoding="utf-8") as fh:
            cur = json.load(fh)
        listening = [r for r in cur["results"] if r.get("section") == "listening"]
        stats["units"] = len(listening)
        stats["ok"] = sum(1 for r in listening if r.get("status") == "ok")
        stats["blocked"] = stats["units"] - stats["ok"]
    else:
        listening = build_listening(setkey, st, asr, audio, stats)
    speaking = build_speaking(setkey, st, asr, audio, stats)

    targets = [] if args.speaking_only else proofread_targets(listening)
    ncalls = sum(len(r["turns"]) if r["type"] == "lc" else 1 for r in targets)
    stats["proofread_calls"] = ncalls
    if args.dry_run:
        print("  %s：听力 %d 组（可落库 %d / 扣下 %d）；口语 repeat %d 句 / interview %d 题；"
              "校对将调用 DeepSeek %d 次"
              % (setkey, stats["units"], stats["ok"], stats["blocked"],
                 stats["repeat_sentences"], stats["interview_questions"], ncalls))
        if stats["reasons"]:
            print("     扣下原因：%s" % stats["reasons"])
        totals.append((setkey, stats))
        return stats

    if not args.no_proofread:
        for r in targets:
            apply_proofread(r, [])

    # 备份：解析器原始产物只存一次，永不覆盖；另留一代上次产物。
    prev = path.replace(".structured.json", ".structured.prev.json")
    if not os.path.exists(parsed):
        shutil.copyfile(path, parsed)
    shutil.copyfile(path, prev)

    st["results"] = [r for r in st["results"] if r.get("section") not in ("listening", "speaking")]
    st["results"].extend(listening)
    st["results"].extend(speaking)
    st["merged_asr"] = {"merger": MERGER_ID, "asr_files": len(asr),
                        "proofread": (not args.no_proofread), "stats": stats}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(st, fh, ensure_ascii=False, indent=1)
    print("  %s：听力 %d 组（可落库 %d / 扣下 %d）；口语 repeat %d 句 / interview %d 题 → 已写回"
          % (setkey, stats["units"], stats["ok"], stats["blocked"],
             stats["repeat_sentences"], stats["interview_questions"]))
    if stats["reasons"]:
        print("     扣下原因：%s" % stats["reasons"])
    totals.append((setkey, stats))
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", action="append", default=None, help="只跑指定套（可重复）")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-proofread", action="store_true")
    ap.add_argument("--speaking-only", action="store_true",
                    help="只重建口语（听力沿用 structured.json 现有结果，零 DeepSeek 调用）")
    args = ap.parse_args()

    files = sorted(f for f in os.listdir(OUT_DIR)
                   if re.match(r"^r[fp]\d{4}\.structured\.json$", f))
    if args.set:
        want = set(args.set)
        files = [f for f in files if f.split(".")[0] in want]
    if not files:
        print("没有可处理的 rf*.structured.json")
        return 2

    print("■ 听力/口语音频转写合流%s" % ("（--dry-run）" if args.dry_run else ""))
    totals = []
    for f in files:
        process_set(os.path.join(OUT_DIR, f), args, totals)

    if totals:
        u = sum(s["units"] for _, s in totals)
        ok = sum(s["ok"] for _, s in totals)
        calls = sum(s.get("proofread_calls", 0) for _, s in totals)
        print("\n合计：听力 %d 组，可落库 %d，扣下 %d；repeat %d 句，interview %d 题"
              % (u, ok, u - ok,
                 sum(s["repeat_sentences"] for _, s in totals),
                 sum(s["interview_questions"] for _, s in totals)))
        # 校对 prompt+正文约 400~900 tokens/次，按台账均价 5.24 ¥/M 估。
        print("DeepSeek 校对调用 %d 次，预估 ≈ %.2f 元" % (calls, calls * 900 / 1e6 * ledger.cny_per_mtok()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
