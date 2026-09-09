#!/usr/bin/env python
"""Audio -> text transcription. Two interchangeable backends, one return shape.

  local   (default)  faster-whisper on this machine. CUDA (RTX 5070) first, CPU fallback.
                     Zero API cost; needs the faster_whisper + torch stack installed.
  openai             OpenAI `whisper-1` over HTTP. Picked by REALBANK_ASR_BACKEND=openai.
                     This is what GitHub Actions uses: the runner has no GPU and we are
                     not shipping a 2 GB torch wheel into every ingest run.

Both return the SAME triple `(segs, info, dev)` so every caller
(scripts/realbank/asr_cache.py, merge_vendor_asr.py, slice_audio.py) is backend-agnostic:
  segs : list[(start_sec: float, end_sec: float, text: str)]
  info : object with `.duration` (seconds) and `.language`
  dev  : "cuda" / "cpu" / "openai-api"

These exam audios are clean studio English (TOEFL listening/speaking), so a
small/medium Whisper model is highly accurate.

Usage:
  python audio_transcribe.py <audio_file> [model_size] [--cpu]
    -> prints the transcript (timestamps stripped, segments joined).
  REALBANK_ASR_BACKEND=openai python audio_transcribe.py <audio_file>
"""
import json
import os
import subprocess
import sys
import tempfile
import time

# ── 共用 ────────────────────────────────────────────────────────────────────
# 本文件在 <repo>/scripts/ops/ 下 —— 三层 dirname 才到仓库根（少一层会把台账写到
# scripts/.codex-tmp/ 去，实测踩过）。
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
COST_LOG = os.path.join(REPO_ROOT, ".codex-tmp", "realbank", "logs", "asr-cost.jsonl")

# Whisper API 计价：$0.006/分钟 ≈ ¥0.043/分钟（7.2 汇率，与项目其它口径同一档）。
CNY_PER_MINUTE = 0.043
# OpenAI 的上传上限是 25MB；留一点余量按 24MB 判，超了就 ffmpeg 切片。
# 两个 env 覆盖只为**可测**：真题音频要 25MB 以上才走切片，拿真文件验证一次要花几块钱，
# 调小阈值就能用一段几十秒的片子把切片+时间偏移这条路走通（验证过一次，见提交说明）。
MAX_UPLOAD_BYTES = int(os.environ.get("REALBANK_ASR_MAX_BYTES") or 24 * 1024 * 1024)
# 切片长度：10 分钟（契约 §8）。听力整块 Module 通常 15~25 分钟，切 2~3 片。
CHUNK_SECONDS = int(os.environ.get("REALBANK_ASR_CHUNK_SECONDS") or 600)


def active_backend():
    """当前生效的后端名（"local" / "openai"）。缓存文件要把它记下来。"""
    return (os.environ.get("REALBANK_ASR_BACKEND") or "local").strip().lower()


class _Info:
    """faster-whisper 的 info 对象只被调用方用到 .duration / .language，这里给同形替身。"""

    def __init__(self, duration, language="en"):
        self.duration = duration
        self.language = language


# ── local 后端（faster-whisper） ─────────────────────────────────────────────
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


def _transcribe_local(path, size="small", force_cpu=False):
    model, dev = get_model(size, force_cpu)
    segments, info = model.transcribe(
        path, language="en", vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
        beam_size=5,
    )
    segs = [(s.start, s.end, s.text.strip()) for s in segments]
    return segs, info, dev


# ── openai 后端（whisper-1 / verbose_json） ─────────────────────────────────
def _ffmpeg():
    return os.environ.get("FFMPEG_BIN") or "ffmpeg"


def _probe_duration(path):
    """时长（秒）。ffprobe 拿不到就返回 None —— 只影响记账，不影响转写。"""
    exe = os.environ.get("FFPROBE_BIN") or "ffprobe"
    try:
        r = subprocess.run(
            [exe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", path],
            capture_output=True, text=True, timeout=120)
        return float(r.stdout.strip())
    except Exception:
        return None


def _split_audio(path, out_dir, chunk_seconds=CHUNK_SECONDS):
    """用 ffmpeg 把长音频切成 ≤chunk_seconds 的 mp3 片段，返回 [(片段路径, 起始秒)]。

    切成 mp3 而不是照抄原容器：原文件可能是 24 MB 的 m4a/mp4（口语源多是屏幕录制），
    直接 -c copy 切出来的片段仍可能单片超 25MB；重编码成 64k 单声道 mp3 之后
    10 分钟约 4.8 MB，稳稳在上限内，且 whisper-1 对这个码率的识别没有可测差异。
    """
    pattern = os.path.join(out_dir, "chunk_%04d.mp3")
    cmd = [_ffmpeg(), "-nostdin", "-v", "error", "-i", path,
           "-f", "segment", "-segment_time", str(chunk_seconds),
           "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k",
           "-reset_timestamps", "1", pattern]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg 切片失败: {r.stderr.strip()[:300]}")
    parts = sorted(f for f in os.listdir(out_dir) if f.startswith("chunk_"))
    if not parts:
        raise RuntimeError("ffmpeg 切片没产出任何片段")
    return [(os.path.join(out_dir, f), i * chunk_seconds) for i, f in enumerate(parts)]


def _post_whisper(path, api_key, base_url, timeout=900):
    """一次 whisper-1 调用，返回 verbose_json 解析结果。

    走 requests 而不是 urllib：它自带 multipart 编码，并且**自动认 HTTPS_PROXY**
    （本机调试必须走代理才能到 api.openai.com；Vercel/Actions 美区直连不设这个变量）。
    """
    import requests  # 懒加载：local 后端不该因为少了 requests 而崩

    url = base_url.rstrip("/") + "/audio/transcriptions"
    with open(path, "rb") as fh:
        files = {"file": (os.path.basename(path), fh, "application/octet-stream")}
        data = {"model": "whisper-1", "response_format": "verbose_json", "language": "en"}
        resp = requests.post(url, headers={"Authorization": f"Bearer {api_key}"},
                             files=files, data=data, timeout=timeout)
    if resp.status_code != 200:
        raise RuntimeError(f"whisper-1 HTTP {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def _log_cost(path, minutes, cny, chunks, elapsed):
    """把这次转写的花费追加进 .codex-tmp/realbank/logs/asr-cost.jsonl。

    记账失败绝不能拖垮转写本身（磁盘只读 / 目录被删都可能），所以整段吞异常。
    """
    try:
        os.makedirs(os.path.dirname(COST_LOG), exist_ok=True)
        row = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "backend": "openai", "model": "whisper-1",
            "file": os.path.basename(path),
            "minutes": round(minutes, 2), "cny": round(cny, 4),
            "chunks": chunks, "elapsed_sec": round(elapsed, 1),
            "job": os.environ.get("REALBANK_JOB_ID") or None,
        }
        with open(COST_LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _transcribe_openai(path):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("REALBANK_ASR_BACKEND=openai 但没有 OPENAI_API_KEY")
    base_url = os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1"

    t0 = time.time()
    size = os.path.getsize(path)
    tmpdir = None
    try:
        if size > MAX_UPLOAD_BYTES:
            tmpdir = tempfile.mkdtemp(prefix="asr-chunk-")
            pieces = _split_audio(path, tmpdir)
        else:
            pieces = [(path, 0.0)]

        segs = []
        duration = 0.0
        for piece_path, offset in pieces:
            data = _post_whisper(piece_path, api_key, base_url)
            piece_dur = float(data.get("duration") or 0.0)
            for s in data.get("segments") or []:
                text = str(s.get("text") or "").strip()
                if not text:
                    continue
                segs.append((float(s.get("start") or 0.0) + offset,
                             float(s.get("end") or 0.0) + offset,
                             text))
            # 片段自己报的时长最准（最后一片往往不满 10 分钟）；报不出就退回切片长度。
            duration = max(duration, offset + (piece_dur or CHUNK_SECONDS))
    finally:
        if tmpdir:
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)

    # 计费按真实音频时长（ffprobe 优先，退回各片段累加）。
    probed = _probe_duration(path)
    billed = probed if probed else duration
    minutes = (billed or 0.0) / 60.0
    _log_cost(path, minutes, minutes * CNY_PER_MINUTE, len(pieces), time.time() - t0)

    return segs, _Info(billed or duration, "en"), "openai-api"


# ── 统一入口 ────────────────────────────────────────────────────────────────
def transcribe(path, size="small", force_cpu=False):
    """按 REALBANK_ASR_BACKEND 分派。默认 local，行为与改动前逐字相同。

    `size` 只对 local 后端有意义（whisper-1 是固定模型）；保留在签名里是为了让
    asr_cache.py / slice_audio.py 这些调用方一个字都不用改。
    """
    if active_backend() == "openai":
        return _transcribe_openai(path)
    return _transcribe_local(path, size, force_cpu)


def main():
    args = [a for a in sys.argv[1:] if a != "--cpu"]
    force_cpu = "--cpu" in sys.argv
    if not args:
        print("usage: audio_transcribe.py <audio> [model_size] [--cpu]", file=sys.stderr)
        sys.exit(2)
    path = args[0]
    size = args[1] if len(args) > 1 else "small"
    segs, info, dev = transcribe(path, size, force_cpu)
    print(f"# backend={active_backend()} device={dev} model={size} "
          f"lang={info.language} dur={(info.duration or 0):.0f}s segs={len(segs)}", file=sys.stderr)
    # print with light timestamps so passage boundaries (long gaps) are visible
    for start, end, text in segs:
        print(f"[{int(start//60):02d}:{int(start%60):02d}] {text}")


if __name__ == "__main__":
    main()
