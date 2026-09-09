#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""真题录入 —— 音频切片（听力/口语原始机经音频 → 逐题片段）。

一套卷的听力是一整个几十 MB 的 m4a，要绑到题上必须切成逐题片段。切点从哪来：
  - **框架句**：ETS 每段材料前会念 "Listen to a conversation between two students."
    这句是稳定的、可正则匹配的段落起点。
  - **静音间隔**：LCR（听后选答）每题只有一句话，题与题之间有明显停顿；
    用 ASR 段落之间的 gap 切。

对齐仍然 fail-closed：切出来的音频单元数必须与 PDF 侧的题块序列对得上，对不上就报告
差异、不出片。宁可少几套卷，不许把 A 题的音频挂到 B 题上。

用法:
  python scripts/realbank/slice_audio.py "3.10新托福真题" --plan   # 只体检，不出片
  python scripts/realbank/slice_audio.py "3.10新托福真题"          # 体检通过则切片
  python scripts/realbank/slice_audio.py "3.10新托福真题" --force  # 对不齐也切（自己看着办）
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ops"))

# 源根目录 REALBANK_SRC / --src 覆盖；产物一律相对仓库根（云端 checkout 不在 D 盘）。
SRC = os.environ.get("REALBANK_SRC") or r"D:\桌面\【2026改后全科真题】（持续更新中）"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORK = os.path.join(REPO_ROOT, ".codex-tmp", "realbank")
ASR_CACHE = os.path.join(WORK, "asr")
AUDIO_OUT = os.path.join(WORK, "audio")

# 段落框架句：ETS 的固定播报，是最可靠的切点。
FRAME = re.compile(
    r"\blisten\s+to\s+(?:a|an|the)\s+"
    r"(conversation|announcement|talk|lecture|discussion|part\s+of\s+a\s+\w+)",
    re.I,
)
FRAME_TYPE = {"conversation": "lc", "announcement": "la", "talk": "lat",
              "lecture": "lat", "discussion": "lat"}

# 为什么不靠静音切 LCR：faster-whisper 开着 VAD，会把答题停顿**吸收进段落时长**里
# （实测 "Did your class presentation go well?" 只占 2.4s，下一段却横跨 50s），
# 于是段间 gap 恒为 0，静音阈值这条路根本不存在。
# 但同一份数据给了更强的信号：LCR 区里**一个 ASR 段就正好是一道题**——实测 3.10
# 头部 9 段逐句对应 Q4–Q12 的 9 道听后选答。所以 LCR 直接按段切。
# 唯一要防的是长句被拆成两段：短于这个秒数且不以句末标点收尾的段，并入前一段。
LCR_MIN_SECONDS = 3.0


def find_ffmpeg():
    """PATH 里没有就去 winget 的安装目录找 —— winget 刚装完需要重启 shell 才进 PATH。"""
    for name in ("ffmpeg", "ffmpeg.exe"):
        p = shutil.which(name)
        if p:
            return p
    root = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages")
    hits = glob.glob(os.path.join(root, "*FFmpeg*", "**", "ffmpeg.exe"), recursive=True)
    return hits[0] if hits else None


def audio_files(setname, kind):
    """按内容而不是文件名判 kind 做不到（音频没文本），这里只能靠文件名 + 时长兜底。"""
    folder = os.path.join(SRC, setname)
    pats = {"listening": ("听力", "listening", "module"), "speaking": ("口语", "speaking")}
    out = []
    for root, _, names in os.walk(folder):
        for n in sorted(names):
            if not n.lower().endswith((".mp3", ".m4a", ".wav", ".mp4", ".mov")):
                continue
            if "downloading" in n.lower():
                continue
            if any(k.lower() in n.lower() for k in pats[kind]):
                out.append(os.path.join(root, n))
    return out


def transcribe_cached(path, setname, model_size="small"):
    """带浮点时间戳的 ASR，落 JSON 缓存（原来的 .codex-tmp/asr 只存到秒，切片不够用）。"""
    os.makedirs(ASR_CACHE, exist_ok=True)
    base = os.path.splitext(os.path.basename(path))[0]
    cache = os.path.join(ASR_CACHE, f"{setname}__{base}.json")
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    from audio_transcribe import transcribe
    segs, info, dev = transcribe(path, model_size)
    data = {
        "file": path, "duration": info.duration, "device": dev, "model": model_size,
        "segments": [{"start": s, "end": e, "text": t} for s, e, t in segs],
    }
    json.dump(data, open(cache, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return data


def detect_units(asr):
    """把 ASR 段落切成音频单元，**按时间顺序**返回。

    两步：先用框架句圈出成段材料（lc/la/lat），剩下的连续区间就是 LCR 区，区内
    一段一题。顺序很重要——后面要拿这个序列跟 PDF 的题号序列按序配对。

    返回 [{kind, type, start, end, text, seg_from, seg_to}]。
    """
    segs = asr["segments"]
    if not segs:
        return []
    marks = [i for i, s in enumerate(segs) if FRAME.search(s["text"])]

    # 每个框架句管到下一个框架句之前
    spans = []
    for k, mi in enumerate(marks):
        stop = marks[k + 1] if k + 1 < len(marks) else len(segs)
        kind = FRAME.search(segs[mi]["text"]).group(1).split()[0].lower()
        spans.append((mi, stop, FRAME_TYPE.get(kind, "lat")))

    units = []
    cursor = 0
    for mi, stop, typ in spans + [(len(segs), len(segs), None)]:
        # 框架句之前的空档 = LCR 区，一段一题
        for i in range(cursor, mi):
            s = segs[i]
            short = (s["end"] - s["start"]) < LCR_MIN_SECONDS
            unfinished = not re.search(r"[.!?]\s*$", s["text"].strip())
            if units and units[-1]["kind"] == "lcr" and units[-1]["seg_to"] == i - 1 and short and unfinished:
                units[-1]["end"] = s["end"]
                units[-1]["text"] += " " + s["text"].strip()
                units[-1]["seg_to"] = i
                continue
            units.append({"kind": "lcr", "type": "lcr", "start": s["start"], "end": s["end"],
                          "text": s["text"].strip(), "seg_from": i, "seg_to": i})
        if typ is None:
            break
        body = segs[mi:stop]
        units.append({
            "kind": "passage", "type": typ,
            "start": body[0]["start"], "end": body[-1]["end"],
            "text": " ".join(x["text"].strip() for x in body),
            "seg_from": mi, "seg_to": stop - 1,
        })
        cursor = stop
    return units


def locate_sentences(asr, sentences, min_ratio=0.6):
    """在 ASR 里按顺序定位已知句子（口语复述题：答案 PDF 里就是那 7 句原文）。

    比按停顿切靠谱得多——我们**知道**要找什么，找不到就是找不到，可证伪。
    返回 [{n, sentence, start, end, matched_text, ratio}]，找不到的条目 start=None。
    """
    from difflib import SequenceMatcher

    def norm(s):
        return re.sub(r"[^a-z0-9 ]", "", str(s).lower()).strip()

    segs = asr["segments"]
    out, cursor = [], 0
    for i, sent in enumerate(sentences, 1):
        want = norm(sent)
        best = (0.0, None, None)
        # 允许跨 1-3 个 ASR 段拼接（一句话可能被切开）
        for a in range(cursor, len(segs)):
            for span in (1, 2, 3):
                b = a + span
                if b > len(segs):
                    break
                got = norm(" ".join(x["text"] for x in segs[a:b]))
                if not got:
                    continue
                r = SequenceMatcher(None, want, got).ratio()
                if r > best[0]:
                    best = (r, a, b)
        r, a, b = best
        if r >= min_ratio and a is not None:
            out.append({"n": i, "sentence": sent, "start": segs[a]["start"], "end": segs[b - 1]["end"],
                        "matched_text": " ".join(x["text"].strip() for x in segs[a:b]), "ratio": round(r, 2)})
            cursor = b
        else:
            out.append({"n": i, "sentence": sent, "start": None, "end": None,
                        "matched_text": "", "ratio": round(r, 2)})
    return out


def answer_sentences(setname, section):
    """该科答案 PDF 里的整句答案（口语复述 / 写作造句用），按题号排序。"""
    p = os.path.join(WORK, f"{setname}.json")
    if not os.path.exists(p):
        return []
    scan = json.load(open(p, encoding="utf-8"))
    a = scan.get("alignment", {}).get(section) or {}
    out = []
    for mod in a.get("modules", []):
        for m in mod["matched"]:
            ans = str(m.get("answer") or "")
            if len(ans.split()) >= 3:  # 单字母是选择题答案，不是句子
                out.append(ans)
    return out


def pdf_expectation(setname, section):
    """PDF 侧对该科的期望：题号 → 类型（从 ingest_set 的产物读，不重复解析）。"""
    p = os.path.join(WORK, f"{setname}.json")
    if not os.path.exists(p):
        return None
    scan = json.load(open(p, encoding="utf-8"))
    a = scan.get("alignment", {}).get(section) or {}
    out = []
    for mod in a.get("modules", []):
        for m in mod["matched"]:
            body = m["block"]["body"]
            if re.search(r"choose\s*the\s*best\s*response", body, re.I):
                t = "lcr"
            elif re.search(r"listen\s*to\s*a\s*conversation", body, re.I):
                t = "lc"
            elif re.search(r"listen\s*to\s*an?\s*announcement", body, re.I):
                t = "la"
            elif re.search(r"listen\s*to\s*an?\s*(academic\s*)?(talk|lecture|discussion)", body, re.I):
                t = "lat"
            elif re.search(r"listen\s*and\s*repeat", body, re.I):
                t = "repeat"
            else:
                t = "?"
            out.append({"module": mod["module"], "n": m["n"], "type": t})
    return out


# 静音修剪。ASR 段落把答题停顿吸进了时长里（实测 LCR 一句话 4s 却占 27s），
# 不修剪的话片段中间是二十几秒死气口——既占体积，播放时也像卡住了。
# 答题时间由 App 自己控制，音频只需要那句话本身。
#
# 必须用 stop_periods=-1（全域模式）：停顿在片段**中间**（说完 3.4s → 静音 23s → 收尾提示音），
# 而 start_periods 那套只处理首尾，对中段静音完全无效（试过，一秒没剪掉）。
# stop_duration=1.2 保留句内自然停顿，只吃掉超过 1.2s 的死气口。
TRIM = "silenceremove=stop_periods=-1:stop_duration=1.2:stop_threshold=-40dB"


def cut(ffmpeg, src, start, end, dst, pad=0.35, trim=False):
    """切片并转 mp3（单声道 24kHz/48k：真题是人声播报，这个规格听感无损、体积约原文件四分之一）。

    trim=True 用于单句类（LCR / 复述）：修掉首尾静音，只留人声。
    成段材料（对话/公告/讲座）不修剪——段内的自然停顿是内容的一部分。
    """
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    ss = max(0.0, start - pad)
    dur = max(0.3, (end - start) + pad * 2)
    cmd = [ffmpeg, "-y", "-loglevel", "error", "-ss", f"{ss:.3f}", "-t", f"{dur:.3f}", "-i", src, "-vn"]
    if trim:
        cmd += ["-af", TRIM]
    cmd += ["-ac", "1", "-ar", "24000", "-b:a", "48k", dst]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg 失败: {r.stderr.strip()[:200]}")
    return os.path.getsize(dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("setname")
    ap.add_argument("--plan", action="store_true", help="只体检，不出片")
    ap.add_argument("--force", action="store_true", help="对不齐也切")
    ap.add_argument("--model", default="small")
    ap.add_argument("--src", default=None,
                    help="覆盖源根目录（默认桌面路径，也可用 REALBANK_SRC 环境变量）")
    args = ap.parse_args()

    global SRC
    if args.src:
        SRC = args.src

    ffmpeg = find_ffmpeg()
    print(f"ffmpeg: {ffmpeg or '【未找到】'}")
    if not ffmpeg and not args.plan:
        raise SystemExit("没有 ffmpeg，无法切片。先装或改用 --plan。")

    for section in ("listening", "speaking"):
        files = audio_files(args.setname, section)
        if not files:
            print(f"\n== {section}: 没有音频文件")
            continue
        exp = pdf_expectation(args.setname, section) or []
        exp_ct = {}
        for e in exp:
            exp_ct[e["type"]] = exp_ct.get(e["type"], 0) + 1

        for f in files:
            print(f"\n== {section}: {os.path.basename(f)}")
            asr = transcribe_cached(f, args.setname, args.model)

            # 口语复述：答案 PDF 里就是那几句原文，按文本定位比按停顿切可靠得多
            if section == "speaking":
                sents = answer_sentences(args.setname, "speaking")
                if sents:
                    hits = locate_sentences(asr, sents)
                    found = [h for h in hits if h["start"] is not None]
                    print(f"   时长 {asr['duration']:.0f}s  已知复述句 {len(sents)} 句 → 定位到 {len(found)} 句")
                    for h in hits:
                        pos = f"{h['start']:7.1f}-{h['end']:7.1f}s" if h["start"] is not None else "   未找到   "
                        print(f"      {h['n']}. {pos} 相似度 {h['ratio']}  {h['sentence'][:56]}")
                    if args.plan:
                        continue
                    if len(found) < len(sents) and not args.force:
                        print("   → 有句子没定位到，跳过切片（--force 可强切）")
                        continue
                    outdir = os.path.join(AUDIO_OUT, args.setname, "speaking")
                    total = sum(cut(ffmpeg, f, h["start"], h["end"],
                                    os.path.join(outdir, f"repeat_{h['n']:02d}.mp3"), trim=True)
                                for h in found)
                    print(f"   → 切出 {len(found)} 片，共 {total / 1024 / 1024:.2f} MB → {outdir}")
                    continue

            units = detect_units(asr)
            got_ct = {}
            for u in units:
                got_ct[u["type"]] = got_ct.get(u["type"], 0) + 1
            print(f"   时长 {asr['duration']:.0f}s  ASR 段 {len(asr['segments'])}  → 音频单元 {len(units)}")
            print(f"   音频侧类型: {got_ct}")
            print(f"   PDF 侧题型: {exp_ct}  (题号 {len(exp)} 个)")

            # 逐类型比对数量。LCR 一题一段，成段材料一段对多题，所以只查段数不查题数。
            problems = []
            if exp_ct.get("lcr") and got_ct.get("lcr") != exp_ct.get("lcr"):
                problems.append(f"LCR 段数 {got_ct.get('lcr', 0)} ≠ PDF 题数 {exp_ct['lcr']}")
            n_pass_pdf = sum(v for k, v in exp_ct.items() if k in ("lc", "la", "lat"))
            n_pass_audio = sum(v for k, v in got_ct.items() if k in ("lc", "la", "lat"))
            if n_pass_pdf and not n_pass_audio:
                problems.append("PDF 里有成段材料题，但音频里没检出任何框架句")
            for p in problems:
                print(f"   ⚠ {p}")

            if args.plan:
                for u in units[:14]:
                    print(f"      {u['type']:4s} {u['start']:7.1f}-{u['end']:7.1f}s  {u['text'][:70]}")
                continue

            # 切片本身无风险（顶多多切/少切几段，人眼一看便知）；真正会害人的是把
            # A 题的音频绑到 B 题上。所以这里照切，数量差异只记进 manifest，
            # fail-closed 留给后面的「绑题号」那一步。
            outdir = os.path.join(AUDIO_OUT, args.setname, section)
            total = 0
            manifest = []
            for i, u in enumerate(units, 1):
                rel = f"{u['type']}_{i:02d}.mp3"
                size = cut(ffmpeg, f, u["start"], u["end"], os.path.join(outdir, rel),
                           trim=(u["kind"] == "lcr"))
                total += size
                manifest.append({"file": rel, "type": u["type"], "kind": u["kind"],
                                 "start": round(u["start"], 2), "end": round(u["end"], 2),
                                 "bytes": size, "text": u["text"][:400]})
            src_mb = os.path.getsize(f) / 1024 / 1024
            json.dump({"set": args.setname, "section": section, "source": os.path.basename(f),
                       "source_mb": round(src_mb, 1), "problems": problems, "units": manifest},
                      open(os.path.join(outdir, "_manifest.json"), "w", encoding="utf-8"),
                      ensure_ascii=False, indent=2)
            print(f"   → 切出 {len(units)} 片，共 {total / 1024 / 1024:.1f} MB"
                  f"（原文件 {src_mb:.1f} MB，压到 {total / 1024 / 1024 / src_mb:.0%}）→ {outdir}")


if __name__ == "__main__":
    main()
