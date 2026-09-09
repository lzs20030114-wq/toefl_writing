#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""第一来源真题音频的本地 Whisper 转写缓存。

第一来源每套只有整块的 ListeningModule1/Module2.mp3 + Speaking.mp3（不像第二来源
是逐题切好的）。这里把整块音频转成带时间戳的逐段文本，缓存到
`.codex-tmp/realbank/asr/<套名>/<文件名>.json`，供 merge_first_source_asr.py 拿去
和「听力原文 PDF」做序列对齐核对。

转写是本地 faster-whisper（CUDA），零 API 费用。已有缓存直接跳过。

用法：
  python scripts/realbank/asr_cache.py "3.14新托福真题"
  python scripts/realbank/asr_cache.py --all
"""
import os
import re
import sys
import json
import time
import argparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ops"))
import audio_transcribe  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_DIR = os.path.join(ROOT, ".codex-tmp", "realbank")
ASR_DIR = os.path.join(OUT_DIR, "asr")
# 源根目录：统一成 REALBANK_SRC（云端 Worker 只设这一个），REALBANK_SRC_ROOT 保留为
# 历史别名（本机脚本/笔记里还在用），默认仍是桌面路径 —— 都不设时行为与改动前相同。
SRC_ROOT = (os.environ.get("REALBANK_SRC")
            or os.environ.get("REALBANK_SRC_ROOT")
            or r"D:\桌面\【2026改后全科真题】（持续更新中）")

MODEL_SIZE = os.environ.get("REALBANK_WHISPER_MODEL", "small")


def audio_roles(setdir):
    """返回 {'listening_m1': path, 'listening_m2': path, 'speaking': path}（缺的就没有键）。

    第一来源 14 套的文件命名各不相同（`Listening-Module1` / `听力音频-Module1` /
    `ListeningModule1`…），所以按**语义特征**认而不是按固定名字：
    先认口语（speak / 口语），再在剩下的里按 module 号认听力，
    并排除「（全）」这种把两个 module 拼起来的合集文件。
    """
    roles = {}
    for dirpath, _dirs, files in os.walk(setdir):
        for fn in files:
            if not fn.lower().endswith(".mp3"):
                continue
            full = os.path.join(dirpath, fn)
            if re.search(r"speak|口语", fn, re.I):
                roles.setdefault("speaking", full)
                continue
            if "全" in fn:
                continue                      # Module1+2 的合集，跳过
            m = re.search(r"module\s*([12])", fn, re.I)
            if m:
                roles.setdefault("listening_m%s" % m.group(1), full)
    return roles


def cache_path(setkey, role):
    return os.path.join(ASR_DIR, setkey, "%s.json" % role)


def transcribe_role(setkey, role, path, force=False):
    out = cache_path(setkey, role)
    if os.path.exists(out) and not force:
        with open(out, encoding="utf-8") as fh:
            return json.load(fh), True
    os.makedirs(os.path.dirname(out), exist_ok=True)
    t0 = time.time()
    segs, info, dev = audio_transcribe.transcribe(path, MODEL_SIZE)
    data = {
        "set": setkey, "role": role, "file": os.path.basename(path),
        # backend 记进缓存：同一份 .codex-tmp 会被本机(faster-whisper)和云端(Whisper API)
        # 交替写，出问题时得能一眼看出这份逐字稿是谁转的。
        "backend": audio_transcribe.active_backend(),
        "model": MODEL_SIZE, "device": dev,
        "duration": getattr(info, "duration", None),
        "elapsed_sec": round(time.time() - t0, 1),
        "segments": [{"start": round(s, 2), "end": round(e, 2), "text": t} for s, e, t in segs],
    }
    data["text"] = " ".join(s["text"] for s in data["segments"]).strip()
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    return data, False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sets", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--src", default=None,
                    help="覆盖源根目录（默认桌面路径，也可用 REALBANK_SRC 环境变量）")
    args = ap.parse_args()

    global SRC_ROOT
    if args.src:
        SRC_ROOT = args.src

    sets = list(args.sets)
    if args.all:
        sets = sorted(d for d in os.listdir(SRC_ROOT)
                      if os.path.isdir(os.path.join(SRC_ROOT, d)))
    if not sets:
        print("用法: asr_cache.py <套名> [<套名>…] | --all")
        return 2

    for setkey in sets:
        setdir = os.path.join(SRC_ROOT, setkey)
        if not os.path.isdir(setdir):
            print("× %s：找不到源目录" % setkey)
            continue
        roles = audio_roles(setdir)
        if not roles:
            print("× %s：目录里没有可识别的音频" % setkey)
            continue
        for role in ("listening_m1", "listening_m2", "speaking"):
            if role not in roles:
                print("  %s/%s：缺音频" % (setkey, role))
                continue
            data, cached = transcribe_role(setkey, role, roles[role], args.force)
            print("  %s/%s %s %d 段 / %.0fs%s" % (
                setkey, role, os.path.basename(roles[role]),
                len(data["segments"]), data.get("duration") or 0,
                "（缓存）" if cached else "（用时 %ss，%s）" % (data["elapsed_sec"], data["device"])))
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
