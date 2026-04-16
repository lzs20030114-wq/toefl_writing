"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { C, FONT } from "../shared/ui";

const SPK = { color: "#F59E0B", soft: "#FFFBEB" };

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
 *   autoStart                     — start recording on mount
 *   disabled                      — prevent interaction
 */
export function VoiceRecorder({ onRecordingComplete, onRecordingStart, maxDuration = 0, autoStart = false, disabled = false }) {
  const [state, setState] = useState("idle"); // idle | recording | playback
  const [blobUrl, setBlobUrl] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [permError, setPermError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const audioRef = useRef(null);
  const mountedRef = useRef(true);

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

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        if (!mountedRef.current) return;
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
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
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setPermError("Microphone access denied. Please allow microphone permission in your browser settings.");
      } else if (err.name === "NotFoundError") {
        setPermError("No microphone found. Please connect a microphone and try again.");
      } else {
        setPermError("Could not access microphone: " + (err.message || "Unknown error"));
      }
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

  // Auto-start
  useEffect(() => {
    if (autoStart && state === "idle" && !disabled) {
      const delay = setTimeout(() => startRecording(), 300);
      return () => clearTimeout(delay);
    }
  }, [autoStart]); // intentionally minimal deps — only fire once on mount

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
          padding: "12px 16px", fontSize: 13, color: "#991B1B", marginBottom: 16, lineHeight: 1.5,
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
            {disabled ? "Waiting..." : "Tap to Record"}
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
            <span style={{ fontSize: 14, fontWeight: 700, color: C.red, fontFamily: "Consolas, monospace" }}>
              {formatTime(elapsed)}
            </span>
            {maxDuration > 0 && (
              <span style={{ fontSize: 12, color: C.t3 }}>/ {formatTime(maxDuration)}</span>
            )}
          </div>

          <span style={{ fontSize: 12, color: C.t3 }}>Recording... tap to stop</span>
        </div>
      )}

      {/* === PLAYBACK state === */}
      {state === "playback" && blobUrl && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <audio
            ref={audioRef}
            src={blobUrl}
            onEnded={() => setIsPlaying(false)}
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
              title="Re-record"
            >
              🔄
            </button>
          </div>

          <span style={{ fontSize: 12, color: C.t3 }}>
            Recorded {formatTime(elapsed)} {isPlaying ? " — Playing..." : ""}
          </span>
        </div>
      )}
    </div>
  );
}
