"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { C, FONT } from "../shared/ui";

const ACCENT = { color: "#8B5CF6", soft: "#F3E8FF" };

/**
 * Reusable audio player with Web Speech API fallback.
 *
 * Props:
 *  - src: audio URL (optional, uses TTS fallback if null)
 *  - text: text to speak via TTS when src is absent
 *  - onEnded: callback when playback finishes
 *  - maxReplays: max replay count (0 = unlimited)
 *  - isPractice: if true, unlimited replays
 *  - autoPlay: if true, starts playback when mounted or when content changes
 *  - compact: if true, render a single inline replay pill (for review / results pages)
 */
export function AudioPlayer({ src, text, onEnded, maxReplays = 2, isPractice = false, autoPlay = false, compact = false }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [replays, setReplays] = useState(0);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [hover, setHover] = useState(null); // "play" | "replay" | null

  const audioRef = useRef(null);
  const ttsTimerRef = useRef(null);
  const ttsStartRef = useRef(0);
  const ttsDurationRef = useRef(0);
  const animFrameRef = useRef(null);
  const autoPlayKeyRef = useRef("");

  const replayLimit = isPractice ? Infinity : maxReplays;
  const canReplay = replays < replayLimit;

  const stopPlayback = useCallback(() => {
    if (ttsTimerRef.current) clearTimeout(ttsTimerRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.cancel();
    }
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => stopPlayback();
  }, [stopPlayback]);

  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    setReplays(0);
    setHasPlayed(false);
    stopPlayback();
  }, [src, text, stopPlayback]);

  // HTML5 audio progress tracking
  useEffect(() => {
    if (!src || !audioRef.current) return;
    const audio = audioRef.current;

    const onTimeUpdate = () => {
      if (audio.duration > 0) {
        setProgress(audio.currentTime / audio.duration);
      }
    };
    const onEnd = () => {
      setPlaying(false);
      setProgress(1);
      if (onEnded) onEnded();
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnd);
    };
  }, [src, onEnded]);

  const animateTTSProgress = useCallback(() => {
    const elapsed = Date.now() - ttsStartRef.current;
    const dur = ttsDurationRef.current;
    if (dur > 0) {
      setProgress(Math.min(elapsed / dur, 1));
    }
    if (elapsed < dur) {
      animFrameRef.current = requestAnimationFrame(animateTTSProgress);
    }
  }, []);

  const playAudio = useCallback(() => {
    if (src && audioRef.current) {
      audioRef.current.currentTime = 0;
      setPlaying(true);
      const playPromise = audioRef.current.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise
          .then(() => setHasPlayed(true))
          .catch(() => {
            setPlaying(false);
            setHasPlayed(false);
          });
      } else {
        setHasPlayed(true);
      }
      return;
    }

    // Web Speech API fallback
    if (typeof speechSynthesis === "undefined" || !text) return;

    // Build the utterance once; we may delay speaking until Safari finishes
    // populating its voice list (getVoices() returns [] on first call).
    function speak(voices) {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 0.9;
      // Pick a known-good English voice when available. Safari without an
      // explicit voice will fall back to the system default — which on
      // macOS-CN is often a Chinese voice that mispronounces English.
      const enVoice = voices.find((v) => v.lang.startsWith("en-") && /Samantha|Aria|Google US English|Alex|Karen/i.test(v.name))
        || voices.find((v) => v.lang.startsWith("en-"));
      if (enVoice) utterance.voice = enVoice;

      // Estimate duration: ~130 words/min at 0.9 rate
      const wordCount = text.split(/\s+/).length;
      const estimatedMs = (wordCount / (130 * 0.9)) * 60 * 1000;
      ttsDurationRef.current = estimatedMs;
      ttsStartRef.current = Date.now();

      utterance.onstart = () => {
        setPlaying(true);
        setHasPlayed(true);
        animFrameRef.current = requestAnimationFrame(animateTTSProgress);
      };
      utterance.onend = () => {
        setPlaying(false);
        setProgress(1);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (onEnded) onEnded();
      };
      utterance.onerror = () => {
        setPlaying(false);
        setHasPlayed(false);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      };

      speechSynthesis.speak(utterance);
    }

    const initial = speechSynthesis.getVoices();
    if (initial && initial.length > 0) { speak(initial); return; }
    // Safari: wait for voiceschanged (with 600ms hard timeout) before speaking.
    let fired = false;
    const onVoicesChanged = () => {
      if (fired) return;
      fired = true;
      speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
      speak(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    setTimeout(() => {
      if (fired) return;
      fired = true;
      speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
      speak(speechSynthesis.getVoices());
    }, 600);
  }, [src, text, onEnded, animateTTSProgress]);

  useEffect(() => {
    if (!autoPlay) return;
    const key = `${src || ""}::${text || ""}`;
    if (autoPlayKeyRef.current === key) return;
    autoPlayKeyRef.current = key;
    const timer = setTimeout(() => {
      setProgress(0);
      playAudio();
    }, 120);
    return () => clearTimeout(timer);
  }, [autoPlay, src, text, playAudio]);

  const handlePlay = useCallback(() => {
    if (playing) return;
    if (hasPlayed) {
      if (!canReplay) return;
      setReplays((r) => r + 1);
    }
    setProgress(0);
    playAudio();
  }, [playing, hasPlayed, canReplay, playAudio]);

  // Compact pill toggles play/stop in one button (no separate replay control).
  const handleCompactToggle = useCallback(() => {
    if (playing) {
      stopPlayback();
      setPlaying(false);
      return;
    }
    handlePlay();
  }, [playing, stopPlayback, handlePlay]);

  // Waveform bars animation
  const WaveformBars = () => {
    const barCount = 24;
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2, height: 32, marginTop: 16 }}>
        {Array.from({ length: barCount }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 3,
              borderRadius: 2,
              background: playing ? ACCENT.color : C.bdr,
              height: playing ? undefined : 4,
              animation: playing ? `waveBar 0.8s ease-in-out ${i * 0.05}s infinite alternate` : "none",
              transition: "background 0.2s ease",
              ...(playing ? { minHeight: 4, maxHeight: 28 } : {}),
            }}
          />
        ))}
      </div>
    );
  };

  // ── Compact mode: a single inline replay pill (review / results pages) ──
  if (compact) {
    return (
      <span style={{ display: "inline-flex" }}>
        {src && <audio ref={audioRef} src={src} preload="none" />}
        <button
          onClick={handleCompactToggle}
          onMouseEnter={() => setHover("compact")}
          onMouseLeave={() => setHover(null)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 999,
            border: `1px solid ${ACCENT.color}`,
            background: playing ? ACCENT.color : hover === "compact" ? ACCENT.soft : "#fff",
            color: playing ? "#fff" : ACCENT.color,
            fontSize: 12, fontWeight: 700, cursor: "pointer",
            fontFamily: FONT, transition: "all 0.15s ease",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            {playing ? (
              <>
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </>
            ) : (
              <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86A1 1 0 008 5.14z" />
            )}
          </svg>
          {playing ? "Playing…" : "Replay"}
        </button>
      </span>
    );
  }

  return (
    <div style={{ textAlign: "center" }}>
      <style>{`
        @keyframes waveBar {
          0% { height: 4px; }
          100% { height: 28px; }
        }
      `}</style>

      {src && <audio ref={audioRef} src={src} preload="auto" />}

      {/* Play button */}
      <button
        onClick={handlePlay}
        disabled={playing || (hasPlayed && !canReplay)}
        onMouseEnter={() => setHover("play")}
        onMouseLeave={() => setHover(null)}
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          border: "none",
          background: playing
            ? ACCENT.soft
            : hover === "play" && !(hasPlayed && !canReplay)
              ? ACCENT.color
              : (hasPlayed && !canReplay)
                ? "#E5E7EB"
                : ACCENT.color,
          color: playing ? ACCENT.color : "#fff",
          fontSize: 28,
          cursor: playing || (hasPlayed && !canReplay) ? "default" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.15s ease",
          boxShadow: playing ? "none" : `0 4px 14px ${ACCENT.color}33`,
          transform: hover === "play" && !playing ? "scale(1.05)" : "scale(1)",
          fontFamily: FONT,
          opacity: (hasPlayed && !canReplay) ? 0.5 : 1,
        }}
      >
        {playing ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86A1 1 0 008 5.14z" />
          </svg>
        )}
      </button>

      {/* Waveform */}
      <WaveformBars />

      {/* Progress bar */}
      <div style={{ margin: "12px auto 0", maxWidth: 260, height: 4, background: C.bdr, borderRadius: 2, overflow: "hidden" }}>
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            background: ACCENT.color,
            borderRadius: 2,
            transition: playing ? "none" : "width 0.3s ease",
          }}
        />
      </div>

      {/* Practice-only reminder: the real exam plays the audio only once */}
      {isPractice && (
        <div style={{ marginTop: 12, fontSize: 12, color: C.t3, fontFamily: FONT }}>
          提示：真实考试音频仅播放一遍
        </div>
      )}
    </div>
  );
}
