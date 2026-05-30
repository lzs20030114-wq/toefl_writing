#!/usr/bin/env python
"""Local audio -> text transcription (faster-whisper, zero LLM tokens).

Same philosophy as the OCR pipeline: a local model does the heavy lifting; we
only parse the resulting text. Tries CUDA (RTX 5070) first, falls back to CPU.

These exam audios are clean studio English (TOEFL listening/speaking), so a
small/medium Whisper model is highly accurate.

Usage:
  python audio_transcribe.py <audio_file> [model_size] [--cpu]
    -> prints the transcript (timestamps stripped, segments joined).
"""
import sys, os

_model = None
_device = None
def get_model(size="small", force_cpu=False):
    global _model, _device
    if _model is not None:
        return _model, _device
    from faster_whisper import WhisperModel
    attempts = [] if force_cpu else [("cuda", "float16"), ("cuda", "int8_float16")]
    attempts.append(("cpu", "int8"))
    last = None
    for dev, ct in attempts:
        try:
            _model = WhisperModel(size, device=dev, compute_type=ct)
            _device = dev
            return _model, dev
        except Exception as e:
            last = e
    raise last

def transcribe(path, size="small", force_cpu=False):
    model, dev = get_model(size, force_cpu)
    segments, info = model.transcribe(
        path, language="en", vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
        beam_size=5,
    )
    segs = [(s.start, s.end, s.text.strip()) for s in segments]
    return segs, info, dev

def main():
    args = [a for a in sys.argv[1:] if a != "--cpu"]
    force_cpu = "--cpu" in sys.argv
    if not args:
        print("usage: audio_transcribe.py <audio> [model_size] [--cpu]", file=sys.stderr)
        sys.exit(2)
    path = args[0]
    size = args[1] if len(args) > 1 else "small"
    segs, info, dev = transcribe(path, size, force_cpu)
    print(f"# device={dev} model={size} lang={info.language} dur={info.duration:.0f}s segs={len(segs)}", file=sys.stderr)
    # print with light timestamps so passage boundaries (long gaps) are visible
    for start, end, text in segs:
        print(f"[{int(start//60):02d}:{int(start%60):02d}] {text}")

if __name__ == "__main__":
    main()
