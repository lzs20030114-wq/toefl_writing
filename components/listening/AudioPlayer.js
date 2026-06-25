"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { C, FONT } from "../shared/ui";
import { sameOriginAudio } from "../../lib/listening/audioSrc";

const ACCENT = { color: "#8B5CF6", soft: "#F3E8FF" };

// Only one AudioPlayer should sound at a time. Each instance owns an
// independent <audio> element, and speechSynthesis is global, so without a
// shared coordinator two clips overlap (the listening history page renders one
// player per question). Holds the currently-sounding instance's stop fn.
let activePlayerStop = null;

/**
 * Reusable audio player with Web Speech API fallback.
 *
 * Props:
 *  - src: audio URL (optional, uses TTS fallback if null)
 *  - text: text to speak via TTS when src is absent
 *  - onEnded: callback when playback finishes
 *  - maxReplays: replays allowed after the first full listen (exam mode: 0 = play once).
 *               isPractice overrides this to unlimited.
 *  - isPractice: if true, unlimited replays
 *  - autoPlay: if true, starts playback when mounted or when content changes
 *  - compact: if true, render a single inline replay pill (for review / results pages)
 */
export function AudioPlayer({ src, text, onEnded, maxReplays = 2, isPractice = false, autoPlay = false, compact = false }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [replays, setReplays] = useState(0);
  // `completed` flips true only when a clip actually finishes (audio 'ended' or
  // TTS onend) — NOT when playback merely starts. This keeps the manual play
  // button enabled through a blocked/stalled autoplay (so it stays recoverable)
  // while still enforcing the play-once rule once a real listen has finished.
  const [completed, setCompleted] = useState(false);
  const [hover, setHover] = useState(null); // "play" | "replay" | null
  const [buffering, setBuffering] = useState(false); // mp3 fetched but not yet audible

  const audioRef = useRef(null);
  const ttsTimerRef = useRef(null);
  const ttsStartRef = useRef(0);
  const ttsDurationRef = useRef(0);
  const animFrameRef = useRef(null);
  const autoPlayKeyRef = useRef("");
  // Lets the <audio> 'error' listener reach the latest startTTS without making
  // the progress effect depend on it (avoids a TDZ on the dep array).
  const startTTSRef = useRef(null);

  const replayLimit = isPractice ? Infinity : maxReplays;
  const canReplay = replays < replayLimit;
  // Serve audio over our own origin (reachable where supabase.co is blocked).
  // Only the <audio src> is rewritten; play/reset logic keys on the raw `src`.
  const audioSrc = sameOriginAudio(src);

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

  // Stop this instance and reset its button. Called directly, or by another
  // instance taking over the single playback slot.
  const stopSelf = useCallback(() => {
    stopPlayback();
    setPlaying(false);
  }, [stopPlayback]);

  // Clean up on unmount. Also release the shared slot so no other instance
  // calls our (now-unmounted) stop fn and sets state on an unmounted component.
  useEffect(() => {
    return () => {
      stopPlayback();
      if (activePlayerStop === stopSelf) activePlayerStop = null;
    };
  }, [stopPlayback, stopSelf]);

  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    setReplays(0);
    setCompleted(false);
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
      setBuffering(false);
      setProgress(1);
      setCompleted(true);
      if (onEnded) onEnded();
    };
    // A media error (unreachable CDN file, decode failure, CORS) must NOT
    // dead-end the listen phase. Clear the spinner and rescue with TTS off the
    // `text` prop so the consumer's onEnded still fires and the exam advances.
    const onError = () => {
      setPlaying(false);
      setBuffering(false);
      if (startTTSRef.current) startTTSRef.current();
    };
    // Distinguish "fetching/buffering" from "audible": show a spinner while the
    // mp3 hasn't started/has stalled so the animated waveform never implies sound.
    const onWaiting = () => setBuffering(true);
    const onResume = () => setBuffering(false);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("error", onError);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onWaiting);
    audio.addEventListener("playing", onResume);
    audio.addEventListener("canplay", onResume);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onWaiting);
      audio.removeEventListener("playing", onResume);
      audio.removeEventListener("canplay", onResume);
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

  // Speak `text` via the Web Speech API. Used when there is no audio src, and
  // also as a rescue when the <audio> element errors (e.g. an unreachable CDN
  // file) so the listen phase still completes instead of dead-ending. Returns
  // false when TTS is unavailable / there is no text to speak.
  const startTTS = useCallback(() => {
    if (typeof speechSynthesis === "undefined" || !text) return false;
    // Claim the single playback slot, stopping whoever held it.
    if (activePlayerStop && activePlayerStop !== stopSelf) activePlayerStop();
    activePlayerStop = stopSelf;

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
        setBuffering(false);
        animFrameRef.current = requestAnimationFrame(animateTTSProgress);
      };
      utterance.onend = () => {
        setPlaying(false);
        setProgress(1);
        setCompleted(true);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (onEnded) onEnded();
      };
      utterance.onerror = () => {
        setPlaying(false);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      };

      speechSynthesis.speak(utterance);
    }

    const initial = speechSynthesis.getVoices();
    if (initial && initial.length > 0) { speak(initial); return true; }
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
    return true;
  }, [text, onEnded, animateTTSProgress, stopSelf]);
  // Expose the latest startTTS to the <audio> 'error' listener (see above).
  startTTSRef.current = startTTS;

  const playAudio = useCallback(() => {
    // Claim the single playback slot, stopping whoever held it so two players
    // can't sound at once.
    if (activePlayerStop && activePlayerStop !== stopSelf) activePlayerStop();
    activePlayerStop = stopSelf;
    if (src && audioRef.current) {
      audioRef.current.currentTime = 0;
      setPlaying(true);
      setBuffering(true);
      const playPromise = audioRef.current.play();
      if (playPromise && typeof playPromise.then === "function") {
        // Swallow autoplay rejections quietly. We deliberately do NOT mark the
        // clip completed, so the manual play button stays enabled and a blocked
        // autoplay is recoverable with a single tap (the tap is a fresh user
        // gesture the browser accepts). A genuine load failure is handled by the
        // <audio> 'error' listener, which rescues via TTS — don't TTS here or a
        // merely-needs-a-gesture clip would lose its real audio.
        playPromise.catch(() => {
          setPlaying(false);
          setBuffering(false);
        });
      }
      return;
    }
    // No audio src — speak the text directly.
    startTTS();
  }, [src, startTTS, stopSelf]);

  useEffect(() => {
    if (!autoPlay) return;
    const key = `${src || ""}::${text || ""}`;
    if (autoPlayKeyRef.current === key) return;
    autoPlayKeyRef.current = key;
    // Call play() synchronously (no setTimeout) so when autoPlay rides in on the
    // start-exam click it stays inside the user-gesture stack and the browser
    // accepts it. If it's still blocked, the manual play button recovers it.
    setProgress(0);
    playAudio();
  }, [autoPlay, src, text, playAudio]);

  const handlePlay = useCallback(() => {
    if (playing) return;
    if (completed) {
      if (!canReplay) return;
      setReplays((r) => r + 1);
    }
    setProgress(0);
    playAudio();
  }, [playing, completed, canReplay, playAudio]);

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
              background: (playing && !buffering) ? ACCENT.color : C.bdr,
              height: (playing && !buffering) ? undefined : 4,
              animation: (playing && !buffering) ? `waveBar 0.8s ease-in-out ${i * 0.05}s infinite alternate` : "none",
              transition: "background 0.2s ease",
              ...((playing && !buffering) ? { minHeight: 4, maxHeight: 28 } : {}),
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
        {src && <audio ref={audioRef} src={audioSrc} preload="none" />}
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
          {buffering ? "缓冲中…" : playing ? "Playing…" : "Replay"}
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

      {src && <audio ref={audioRef} src={audioSrc} preload="auto" />}

      {/* Play button */}
      <button
        onClick={handlePlay}
        disabled={playing || (completed && !canReplay)}
        onMouseEnter={() => setHover("play")}
        onMouseLeave={() => setHover(null)}
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          border: "none",
          background: playing
            ? ACCENT.soft
            : hover === "play" && !(completed && !canReplay)
              ? ACCENT.color
              : (completed && !canReplay)
                ? "#E5E7EB"
                : ACCENT.color,
          color: playing ? ACCENT.color : "#fff",
          fontSize: 28,
          cursor: playing || (completed && !canReplay) ? "default" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.15s ease",
          boxShadow: playing ? "none" : `0 4px 14px ${ACCENT.color}33`,
          transform: hover === "play" && !playing ? "scale(1.05)" : "scale(1)",
          fontFamily: FONT,
          opacity: (completed && !canReplay) ? 0.5 : 1,
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
      {buffering && (
        <div style={{ marginTop: 6, fontSize: 12, color: C.t2, fontFamily: FONT }}>缓冲中…</div>
      )}

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
