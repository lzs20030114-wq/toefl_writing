"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { C, FONT } from "../shared/ui";

const SPK = { color: "#F59E0B", soft: "#FFFBEB" };

// Safari prefers audio/mp4 (AAC); Chrome/Firefox use webm/opus. We try the
// modern formats first and fall back to whatever the platform supports so
// the playback <audio> element actually plays the resulting blob.
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
  "audio/ogg;codecs=opus",
];

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      // some browsers throw on unsupported types; skip
    }
  }
  return ""; // let MediaRecorder pick its own default
}

function isMacOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  // Modern Safari reports "MacIntel" platform; iOS Safari includes "iPad"/"iPhone".
  return /Mac(?!.*iPad|.*iPhone)/i.test(platform) || /Macintosh/i.test(ua);
}

function isSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Safari/i.test(ua) && !/Chrome|Chromium|Edg\//i.test(ua);
}

function describePermissionError(err) {
  const name = err?.name || "";
  const msg = String(err?.message || "");
  const mac = isMacOS();

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    if (mac) {
      return [
        "麦克风权限被拒绝。",
        "macOS 用户请检查：",
        "1) 浏览器地址栏右侧的麦克风图标，点击「允许」",
        "2) 系统设置 → 隐私与安全性 → 麦克风，确认勾选了当前浏览器（Chrome / Safari / Edge）",
        "3) 重新刷新本页面",
      ].join("\n");
    }
    return "麦克风权限被拒绝，请在浏览器地址栏左侧/右侧点击麦克风图标并允许。";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "未检测到麦克风设备，请连接麦克风后重试。";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return mac
      ? "麦克风被其他程序占用（例如 Zoom / 腾讯会议 / 飞书）。关闭它们后再试。"
      : "麦克风正被其他程序使用，请关闭后重试。";
  }
  if (name === "SecurityError" || name === "NotSupportedError") {
    return "当前页面不支持麦克风访问（需要 HTTPS 或 localhost）。";
  }
  if (/insecure/i.test(msg)) {
    return "当前页面不支持麦克风访问（需要 HTTPS）。";
  }
  return "无法访问麦克风：" + (msg || "未知错误");
}

/**
 * Reusable voice recorder component.
 *
 * States: idle -> recording -> playback
 * Uses MediaRecorder API with graceful permission handling.
 *
 * Props:
 *   onRecordingComplete(blobUrl)  — called with blob URL when recording stops
 *   onRecordingStart()            — called when recording actually starts (after mic permission)
 *   maxDuration                   — auto-stop after N seconds (0 = no limit)
 *   autoStart                     — start recording on mount (best-effort; Safari may require a manual tap)
 *   disabled                      — prevent interaction
 */
export function VoiceRecorder({ onRecordingComplete, onRecordingStart, maxDuration = 0, autoStart = false, disabled = false }) {
  const [state, setState] = useState("idle"); // idle | recording | playback
  const [blobUrl, setBlobUrl] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [permError, setPermError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoStartBlocked, setAutoStartBlocked] = useState(false);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const audioRef = useRef(null);
  const mountedRef = useRef(true);
  const actualMimeRef = useRef("");

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => { return cleanup; }, [cleanup]);

  const startRecording = useCallback(async () => {
    if (disabled) return;
    setPermError(null);
    setBlobUrl(null);
    setElapsed(0);
    chunksRef.current = [];

    // Pre-flight: confirm the API exists at all. On http:// (non-localhost)
    // Safari blocks getUserMedia even before showing the prompt.
    if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPermError("当前浏览器不支持麦克风访问，请使用最新版 Chrome / Safari / Edge，并通过 HTTPS 打开本站。");
      setState("idle");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setPermError("当前浏览器不支持录音（MediaRecorder API 缺失）。建议使用 Chrome 或最新版 Safari。");
      setState("idle");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      // The recorder may have negotiated a different mime — use the actual
      // one for the Blob so Safari can play it back via the <audio> element.
      actualMimeRef.current = recorder.mimeType || mimeType || "audio/webm";

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        if (!mountedRef.current) return;
        const blob = new Blob(chunksRef.current, { type: actualMimeRef.current });
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setState("playback");
        if (onRecordingComplete) onRecordingComplete(url);
        // Stop mic
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250); // collect in 250ms chunks
      setState("recording");
      setAutoStartBlocked(false);
      if (onRecordingStart) onRecordingStart();

      // Elapsed timer
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        if (!mountedRef.current) return;
        const sec = Math.floor((Date.now() - startTime) / 1000);
        setElapsed(sec);
        if (maxDuration > 0 && sec >= maxDuration) {
          stopRecording();
        }
      }, 250);
    } catch (err) {
      if (!mountedRef.current) return;
      setPermError(describePermissionError(err));
      setState("idle");
    }
  }, [disabled, maxDuration, onRecordingComplete, onRecordingStart]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
  }, []);

  // Auto-start (best effort). Safari is stricter about user-gesture timing —
  // if we don't have a real gesture context, the start may fail. We probe
  // the Permissions API (when available) to skip the call entirely on
  // already-denied state, and surface a clearer "tap to start" prompt when
  // the browser blocks the auto path.
  useEffect(() => {
    if (!autoStart) return;
    if (state !== "idle" || disabled) return;
    let cancelled = false;

    (async () => {
      // If the Permissions API reports a definitive "denied", don't bother
      // trying — show the manual button so the user can re-grant.
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const status = await navigator.permissions.query({ name: "microphone" });
          if (!cancelled && status.state === "denied") {
            setAutoStartBlocked(true);
            setPermError(describePermissionError({ name: "NotAllowedError" }));
            return;
          }
        }
      } catch {
        // Permissions API not supported or threw — fall through and just try.
      }
      if (cancelled) return;
      // Kick the start immediately (no 300ms delay) to stay inside the
      // user-gesture window on Safari where possible.
      startRecording();
    })();

    return () => { cancelled = true; };
  }, [autoStart, disabled]); // intentionally minimal deps — only fire once on mount

  const togglePlayback = useCallback(() => {
    if (!audioRef.current || !blobUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [isPlaying, blobUrl]);

  const resetRecorder = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }
    setState("idle");
    setElapsed(0);
  }, [blobUrl]);

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  // Pulsing keyframes injected once
  const pulseCSS = `
    @keyframes spk-pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.15); opacity: 0.85; }
    }
    @keyframes spk-wave {
      0% { height: 8px; }
      50% { height: 22px; }
      100% { height: 8px; }
    }
  `;

  return (
    <div style={{ fontFamily: FONT }}>
      <style>{pulseCSS}</style>

      {/* Permission error */}
      {permError && (
        <div style={{
          background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10,
          padding: "12px 16px", fontSize: 13, color: "#991B1B", marginBottom: 16, lineHeight: 1.6,
          whiteSpace: "pre-line",
        }}>
          {permError}
        </div>
      )}

      {/* === IDLE state === */}
      {state === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <button
            onClick={startRecording}
            disabled={disabled}
            style={{
              width: 72, height: 72, borderRadius: "50%",
              background: disabled ? "#D1D5DB" : SPK.color,
              border: "none", cursor: disabled ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: disabled ? "none" : "0 4px 14px rgba(245,158,11,0.35)",
              transition: "transform 150ms ease, box-shadow 150ms ease",
            }}
            onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.transform = "scale(1.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          >
            <span style={{ fontSize: 28 }} role="img" aria-label="microphone">🎙️</span>
          </button>
          <span style={{ fontSize: 13, color: C.t3, fontWeight: 600 }}>
            {disabled ? "Waiting..." : (autoStartBlocked ? "点击开始录音" : "点击录音")}
          </span>
        </div>
      )}

      {/* === RECORDING state === */}
      {state === "recording" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <button
            onClick={stopRecording}
            style={{
              width: 72, height: 72, borderRadius: "50%",
              background: C.red, border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 14px rgba(220,38,38,0.35)",
              animation: "spk-pulse 1.2s ease-in-out infinite",
            }}
          >
            <div style={{ width: 24, height: 24, borderRadius: 4, background: "#fff" }} />
          </button>

          {/* Waveform animation */}
          <div style={{ display: "flex", alignItems: "center", gap: 3, height: 28 }}>
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <div
                key={i}
                style={{
                  width: 4, borderRadius: 2, background: C.red,
                  animation: `spk-wave 0.8s ease-in-out ${i * 0.1}s infinite`,
                }}
              />
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%", background: C.red,
              animation: "spk-pulse 1s ease-in-out infinite",
            }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: C.red, fontFamily: "Consolas, Menlo, 'Courier New', monospace" }}>
              {formatTime(elapsed)}
            </span>
            {maxDuration > 0 && (
              <span style={{ fontSize: 12, color: C.t3 }}>/ {formatTime(maxDuration)}</span>
            )}
          </div>

          <span style={{ fontSize: 12, color: C.t3 }}>录音中…点击停止</span>
        </div>
      )}

      {/* === PLAYBACK state === */}
      {state === "playback" && blobUrl && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <audio
            ref={audioRef}
            src={blobUrl}
            onEnded={() => setIsPlaying(false)}
            preload="auto"
            playsInline
            style={{ display: "none" }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Play / Pause */}
            <button
              onClick={togglePlayback}
              style={{
                width: 52, height: 52, borderRadius: "50%",
                background: SPK.color, border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 2px 8px rgba(245,158,11,0.25)",
              }}
            >
              {isPlaying ? (
                <div style={{ display: "flex", gap: 4 }}>
                  <div style={{ width: 4, height: 18, background: "#fff", borderRadius: 2 }} />
                  <div style={{ width: 4, height: 18, background: "#fff", borderRadius: 2 }} />
                </div>
              ) : (
                <div style={{
                  width: 0, height: 0,
                  borderTop: "10px solid transparent",
                  borderBottom: "10px solid transparent",
                  borderLeft: "16px solid #fff",
                  marginLeft: 3,
                }} />
              )}
            </button>

            {/* Re-record */}
            <button
              onClick={resetRecorder}
              disabled={disabled}
              style={{
                width: 42, height: 42, borderRadius: "50%",
                background: "#F3F4F6", border: "1px solid " + C.bdr, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16,
              }}
              title="重新录音"
            >
              🔄
            </button>
          </div>

          <span style={{ fontSize: 12, color: C.t3 }}>
            已录制 {formatTime(elapsed)} {isPlaying ? " · 播放中…" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
