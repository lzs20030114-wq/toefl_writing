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
 */
export function AudioPlayer({ src, text, onEnded, maxReplays = 2, isPractice = false }) {
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

  const replayLimit = isPractice ? Infinity : maxReplays;
  const canReplay = replays < replayLimit;

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (ttsTimerRef.current) clearTimeout(ttsTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (typeof speechSynthesis !== "undefined") {
        speechSynthesis.cancel();
      }
    };
  }, []);

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
      audioRef.current.play().catch(() => {});
      setPlaying(true);
      setHasPlayed(true);
      return;
    }

    // Web Speech API fallback
    if (typeof speechSynthesis === "undefined" || !text) return;

    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.9;

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
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };

    speechSynthesis.speak(utterance);
  }, [src, text, onEnded, animateTTSProgress]);

  const handlePlay = useCallback(() => {
    if (playing) return;
    if (hasPlayed) {
      if (!canReplay) return;
      setReplays((r) => r + 1);
    }
    setProgress(0);
    playAudio();
  }, [playing, hasPlayed, canReplay, playAudio]);

  const handleReplay = useCallback(() => {
    if (playing || !canReplay) return;
    setReplays((r) => r + 1);
    setProgress(0);
    playAudio();
  }, [playing, canReplay, playAudio]);

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

  const replayText = isPractice
    ? "Replay"
    : `Replay (${Math.max(replayLimit - replays, 0)} left)`;

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

      {/* Replay button */}
      {hasPlayed && !playing && (
        <button
          onClick={handleReplay}
          disabled={!canReplay}
          onMouseEnter={() => setHover("replay")}
          onMouseLeave={() => setHover(null)}
          style={{
            marginTop: 14,
            padding: "8px 20px",
            borderRadius: 8,
            border: `1px solid ${canReplay ? ACCENT.color : C.bdr}`,
            background: canReplay ? (hover === "replay" ? ACCENT.soft : "#fff") : "#F3F4F6",
            color: canReplay ? ACCENT.color : C.t3,
            fontSize: 13,
            fontWeight: 600,
            cursor: canReplay ? "pointer" : "not-allowed",
            fontFamily: FONT,
            transition: "all 0.15s ease",
          }}
        >
          {replayText}
        </button>
      )}
    </div>
  );
}
