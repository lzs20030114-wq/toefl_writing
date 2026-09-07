# -*- coding: utf-8 -*-
"""逐题音频文件名 → 题型 / 模块 / 题号。

第一波 8 套的商家用的是一套统一命名（`listening_m1_q13_q14_conversation_x.mp3` /
`speaking_listen_repeat_q03.mp3`），解析器与合流脚本各自写死了一条正则就够用。
第二波把 16 个文件夹摊开一看，同一个商家至少用过 5 种听力命名、5 种口语命名：

    listening_m1_q13_q14_conversation_x.mp3          ← 第一波（8.08 / 8.26 / 8.12 / 9.02 / 7.05 / 7.19）
    listening_q13_q14_lecture_x.mp3                  ← 没有 module（7.18）
    listening_1_set2_m1_q05-q08_lecture_x.mp3        ← 带 set 编号、题号用连字符（7.25 / 7.29）
    listening_form2_q05_q08_lecture_x.mp3            ← module 写成 form（8.30）
    L07_Delayed_Rewards.mp3                          ← 纯题池，文件名里没有题号（8.19 / 8.22）

    speaking_listen_repeat_q03.mp3                   ← 第一波
    speaking_listen_repeat_s01_q03.mp3               ← 分组（7.05）
    speaking_listen_repeat_set1_q3.mp3               ← 分组（7.11）
    speaking_1_set2_repeat_q3_bicycle_tire.mp3       ← 分组 + 题材（7.25 / 7.29）
    S-R01_q3.mp3 / S-I01_setup.mp3                   ← 纯题池（8.19 / 8.22）

与其在两个脚本里各堆一坨正则，不如把「文件名怎么读」收敛成这一份，两边都 import。

**第一波必须逐字不变**：所有分支都是「先认第一波的写法，认不出再退到宽松规则」，
且分组编号在没有 set 记号时退回裸题号（`speaking_listen_repeat_q03` → 3，与旧版一致）。
有 set 记号时用 `set*100 + q` 做全局题号 —— 这样 S-R01_q3 与 S-R02_q3 不再互相盖。
"""
from __future__ import annotations

import re

# ── 听力 ────────────────────────────────────────────────────────────────
# 第一波原样保留（合流脚本的 LISTEN_FILE_RE 就是这条），认不出才走宽松分支。
CANONICAL_LISTEN = re.compile(r"^listening_m(\d+)_q(\d+)(?:_q(\d+))?_(.+)\.mp3$", re.I)
_MODULE_TOKEN = re.compile(r"(?:^|_)(?:m|module|form)(\d+)(?=_|$)", re.I)
_QRANGE_TOKEN = re.compile(r"(?:^|_)q(\d+)(?:\s*[-_]\s*q?(\d+))?(?=_|$)", re.I)


def listen_unit(fn: str):
    """听力音频文件名 → {module, q_start, q_end, slug}；认不出题号返回 None。

    认不出题号的（`L07_Delayed_Rewards.mp3` 这种纯题池命名）返回 None —— 它的题号只能
    由文档里的 `Audio:` 行反查，不该在这里瞎猜。
    """
    m = CANONICAL_LISTEN.match(fn)
    if m:
        return {"module": int(m.group(1)), "q_start": int(m.group(2)),
                "q_end": int(m.group(3) or m.group(2)), "slug": m.group(4)}
    if not re.match(r"^listening[_\-]", fn, re.I) or not fn.lower().endswith(".mp3"):
        return None
    base = fn[:-4]
    qm = _QRANGE_TOKEN.search(base)
    if not qm:
        return None
    mm = _MODULE_TOKEN.search(base)
    slug = base[qm.end():].strip("_-") or base[:qm.start()].strip("_-")
    return {"module": int(mm.group(1)) if mm else 1,
            "q_start": int(qm.group(1)), "q_end": int(qm.group(2) or qm.group(1)),
            "slug": slug}


# ── 口语 ────────────────────────────────────────────────────────────────
CANONICAL_REPEAT = re.compile(r"^speaking_listen_repeat_q(\d+)\.mp3$", re.I)
CANONICAL_INTERVIEW = re.compile(r"^speaking_take_interview_q(\d+)\.mp3$", re.I)
_POOL_SPEAK = re.compile(r"^S-(R|I)(\d+)_(q(\d+)|setup)\.mp3$", re.I)
_SET_TOKEN = re.compile(r"(?:^|_)(?:set|form|s)(\d+)(?=_|$)", re.I)
_Q_TOKEN = re.compile(r"(?:^|_)q(\d+)(?=_|$)", re.I)


def speak_unit(fn: str):
    """口语音频文件名 → {kind: repeat|interview, n, q, set, setup}；认不出返回 None。

    `n` 是**全局题号**：没有 set 记号时就是裸题号（第一波逐字不变），
    有 set 记号时是 `set*100 + q`，保证同一套里多组复述/面试的题号不互相覆盖。
    `q` 是**组内序号**：答案页那边分组也是按组内序号编的，对位时用它。
    """
    m = CANONICAL_REPEAT.match(fn)
    if m:
        return {"kind": "repeat", "n": int(m.group(1)), "q": int(m.group(1)), "set": None, "setup": False}
    m = CANONICAL_INTERVIEW.match(fn)
    if m:
        return {"kind": "interview", "n": int(m.group(1)), "q": int(m.group(1)), "set": None, "setup": False}
    m = _POOL_SPEAK.match(fn)
    if m:
        kind = "repeat" if m.group(1).upper() == "R" else "interview"
        s = int(m.group(2))
        if m.group(3).lower() == "setup":
            return {"kind": kind, "n": s * 100, "q": 0, "set": s, "setup": True}
        return {"kind": kind, "n": s * 100 + int(m.group(4)), "q": int(m.group(4)),
                "set": s, "setup": False}
    low = fn.lower()
    if not low.startswith("speaking") or not low.endswith(".mp3"):
        return None
    base = fn[:-4]
    if re.search(r"(?:^|_)repeat(?:$|_)", base, re.I):
        kind = "repeat"
    elif re.search(r"(?:^|_)interview(?:$|_)", base, re.I):
        kind = "interview"
    else:
        return None
    setup = bool(re.search(r"(?:^|_)setup(?:$|_)", base, re.I))
    sm = _SET_TOKEN.search(base)
    s = int(sm.group(1)) if sm else None
    qs = _Q_TOKEN.findall(base)
    if not qs:
        if setup and s:
            return {"kind": kind, "n": s * 100, "q": 0, "set": s, "setup": True}
        return None
    q = int(qs[-1])
    return {"kind": kind, "n": (s * 100 + q) if s else q, "q": q, "set": s, "setup": setup}


def align_speaking_groups(units, groups):
    """音频单元 ↔ 答案页分组对位。返回 (｛n: 内容｝, ｛n: 候选列表｝)。

    三级：① 文件名带组号（`_s01_q03` / `S-R02_q3`）就按组号 + 题号直取；
    ② 只有一组（第一波）按题号直取；③ 都不成但「文档条数 == 音频条数」就按顺序对位
    （7.04/7.18 这类「文档分组、音频却是拉通编号」的排法）。
    仍对不上的给出「同一组内序号相同」的候选，交给 merge 用 ASR 逐句裁决。
    """
    # 走过 JSON 的分组（merge 从 structured.json 读回来）题号会变成字符串
    groups = [{"set": g.get("set"),
               "map": dict((int(k), v) for k, v in (g.get("map") or {}).items())}
              for g in groups]
    byset: dict = {}
    for i, g in enumerate(groups, 1):
        byset[g["set"] if g["set"] is not None else i] = g["map"]
    flat = [g["map"][q] for g in groups for q in sorted(g["map"])]
    res: dict = {}
    for u in units:
        v = None
        if u["set"] is not None:
            v = byset.get(u["set"], {}).get(u["q"])
        elif len(groups) == 1:
            v = groups[0]["map"].get(u["q"])
        res[u["n"]] = v
    if any(res[u["n"]] is None for u in units) and len(flat) == len(units) and flat:
        for u, v in zip(units, flat):
            res[u["n"]] = v
        return res, {u["n"]: [] for u in units}
    cands = {}
    for u in units:
        cands[u["n"]] = ([] if res[u["n"]] is not None
                         else [g["map"][u["q"]] for g in groups if u["q"] in g["map"]])
    return res, cands
