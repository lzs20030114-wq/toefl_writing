#!/usr/bin/env python
"""Batch-transcribe complete (non-.downloading) exam audio -> text cache.
Usage: python transcribe_audio_batch.py [speaking|listening|all] [model_size]
Output: .codex-tmp/asr/<set>__<base>.txt  (timestamped lines). Resumable.

NOTE: complete listening audio is all combined-set (already have 原文 text);
the net-new gap is SPEAKING interview prompts (audio-only). Split-set listening
audio is mostly .downloading and skipped until complete.
"""
import sys, os, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audio_transcribe import transcribe

SRC = r"D:\桌面\【2026改后全科真题】（持续更新中）"
CACHE = r"D:\toefl_writing\.codex-tmp\asr"
os.makedirs(CACHE, exist_ok=True)

KIND = sys.argv[1] if len(sys.argv) > 1 else "speaking"
SIZE = sys.argv[2] if len(sys.argv) > 2 else "small"
PAT = {"speaking": ("speaking", "口语"), "listening": ("listening", "听力", "module")}

audios = []
for f in glob.glob(os.path.join(SRC, "*", "*.mp3")):
    if "downloading" in f.lower():
        continue
    base = os.path.basename(f)
    if KIND == "all" or any(k.lower() in base.lower() for k in PAT.get(KIND, ())):
        audios.append(f)
audios.sort()
print(f"{KIND}: {len(audios)} complete audio files", flush=True)

for i, f in enumerate(audios, 1):
    setname = os.path.basename(os.path.dirname(f))
    base = os.path.splitext(os.path.basename(f))[0]
    out = os.path.join(CACHE, f"{setname}__{base}.txt")
    if os.path.exists(out) and os.path.getsize(out) > 50:
        print(f"[{i}/{len(audios)}] skip(done) {setname}", flush=True); continue
    try:
        segs, info, dev = transcribe(f, SIZE)
        lines = [f"# {setname} / {base}  device={dev} dur={info.duration:.0f}s"]
        for start, end, text in segs:
            lines.append(f"[{int(start//60):02d}:{int(start%60):02d}] {text}")
        open(out, "w", encoding="utf-8").write("\n".join(lines))
        print(f"[{i}/{len(audios)}] {setname} ({info.duration:.0f}s, {len(segs)} segs, {dev})", flush=True)
    except Exception as e:
        print(f"[{i}/{len(audios)}] ERR {setname}: {e}", flush=True)
print("DONE", flush=True)
