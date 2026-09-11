#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""真题原声切片用的**词级**时间戳转写（本地 faster-whisper，零 API 费用）。

`asr_cache.py` / `asr-vendor/` 里现成的转写只有**段级**时间戳，一段动辄十几秒、
还常把「Listen to a conversation.」这句 ETS 旁白和正文第一句并在同一段里 ——
拿它当切点就必然带旁白、或者把正文头一个词削掉。原声切片要求「旁白之后第一个
正文词」和「最后一个正文词」这两个精确到词的时刻，所以这里单独跑一遍
`word_timestamps=True`。

产物缓存到 JSON，`bind_original_audio.mjs` 只读缓存不重跑：
  {file, model, device, duration, elapsed_sec, words:[{w,start,end}], text}

用法：
  # 单个文件
  python scripts/realbank/asr_words.py --audio <mp3> --out <json>
  # 批量（一次加载模型跑多个；stdin 或 --jobs 给 [{audio,out}, …]）
  python scripts/realbank/asr_words.py --jobs jobs.json
"""
import os
import sys
import json
import time
import argparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ops"))
import audio_transcribe  # noqa: E402  （复用同一套 CUDA→CPU 回退的模型加载）

DEFAULT_MODEL = os.environ.get("REALBANK_WORDS_MODEL", "medium.en")


def transcribe_words(path, model_size, force_cpu=False, use_vad=True):
    model, dev = audio_transcribe.get_model(model_size, force_cpu)
    # 关掉 VAD 是补救用法：短 mp3（逐题 lcr 前后各有好几秒静音 + 计时音）开着 VAD 时
    # 偶尔会把词级时间戳错位到静音里，一句七个词被摊成 8 秒。
    kw = dict(vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500)) if use_vad \
        else dict(vad_filter=False)
    segments, info = model.transcribe(
        path, language="en", beam_size=5, word_timestamps=True, **kw)
    words = []
    seg_list = []
    for s in segments:
        seg_list.append({"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip()})
        for w in (s.words or []):
            t = w.word.strip()
            if not t:
                continue
            words.append({"w": t, "start": round(w.start, 3), "end": round(w.end, 3)})
    return words, seg_list, info, dev


def run_job(job, model_size, force_cpu, force):
    out = job["out"]
    if os.path.exists(out) and not force:
        return "cached"
    audio = job["audio"]
    if not os.path.exists(audio):
        return "missing"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    t0 = time.time()
    use_vad = not job.get("no_vad")
    words, segs, info, dev = transcribe_words(audio, model_size, force_cpu, use_vad)
    data = {
        "file": os.path.basename(audio),
        "path": audio,
        "model": model_size,
        "device": dev,
        "vad": use_vad,
        "duration": getattr(info, "duration", None),
        "elapsed_sec": round(time.time() - t0, 1),
        "words": words,
        "segments": segs,
    }
    data["text"] = " ".join(w["w"] for w in words)
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    os.replace(tmp, out)
    return "%.1fs/%s" % (data["elapsed_sec"], dev)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio")
    ap.add_argument("--out")
    ap.add_argument("--jobs", help="JSON 文件：[{audio,out}, …]；给 '-' 从 stdin 读")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if args.jobs:
        raw = sys.stdin.read() if args.jobs == "-" else open(args.jobs, encoding="utf-8").read()
        jobs = json.loads(raw)
    elif args.audio and args.out:
        jobs = [{"audio": args.audio, "out": args.out}]
    else:
        print("用法: asr_words.py --audio <mp3> --out <json> | --jobs <json|->", file=sys.stderr)
        return 2

    t0 = time.time()
    done = cached = failed = 0
    for i, job in enumerate(jobs, 1):
        try:
            st = run_job(job, args.model, args.cpu, args.force)
        except Exception as e:                                  # noqa: BLE001
            st = "ERR %s" % str(e)[:160]
        if st == "cached":
            cached += 1
        elif st.startswith("ERR") or st == "missing":
            failed += 1
            print("  × %s: %s" % (os.path.basename(job.get("audio", "?")), st), file=sys.stderr)
        else:
            done += 1
        if i % 20 == 0 or i == len(jobs):
            print("  词级转写 %d/%d（新跑 %d / 缓存 %d / 失败 %d，累计 %.0fs）"
                  % (i, len(jobs), done, cached, failed, time.time() - t0), file=sys.stderr)
            sys.stderr.flush()
    print(json.dumps({"total": len(jobs), "done": done, "cached": cached,
                      "failed": failed, "elapsed_sec": round(time.time() - t0, 1)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
