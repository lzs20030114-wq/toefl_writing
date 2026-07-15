"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { C, FONT } from "./ui";
import { createExamAudioController } from "../../lib/audio/examAudioController";
import { trackAudioEvent } from "../../lib/analytics/audio";

/**
 * ExamAudioProvider — mounts ONE persistent exam audio controller for a whole
 * exam session (intro → modules → results) and owns the recovery overlay.
 *
 * Only the exam shells mount this Provider. Practice pages never do, so
 * useExamAudio() returns null there and every component falls back to its
 * pre-existing per-element audio path — practice behavior is untouched.
 *
 * Kill switch: NEXT_PUBLIC_EXAM_AUDIO_DISABLED=1 renders children without a
 * context, reverting the exam flows to the old behavior with no code change
 * (same pattern as NEXT_PUBLIC_AUDIO_PROXY_DISABLED in lib/listening/audioSrc.js).
 */

const ExamAudioContext = createContext(null);

export function useExamAudio() {
  return useContext(ExamAudioContext);
}

// Map controller events to telemetry event names (see lib/analytics/audio.js).
function reportTelemetry(event) {
  const meta = event.meta || {};
  const base = {
    section: meta.section || null,
    taskType: meta.taskType || null,
    itemId: meta.itemId || null,
    audioPath: event.src || null,
  };
  switch (event.type) {
    case "unlocked":
      trackAudioEvent("unlock_ok", base);
      break;
    case "unlock-blocked":
      trackAudioEvent("unlock_blocked", { ...base, errorName: event.errorName || null });
      break;
    case "playing":
      trackAudioEvent("play_ok", { ...base, firstFrameMs: event.firstFrameMs });
      break;
    case "blocked":
      if (event.reason === "interrupted") {
        trackAudioEvent("interrupted", { ...base, reason: event.reason });
      } else if (event.reason === "silent-timeout") {
        trackAudioEvent("stall_timeout", { ...base, reason: event.reason });
      } else {
        trackAudioEvent("play_blocked", { ...base, reason: event.reason });
      }
      break;
    case "error":
      trackAudioEvent("play_error", {
        ...base,
        errorName: event.errorName || null,
        mediaErrorCode: event.mediaErrorCode,
        readyState: event.readyState,
        networkState: event.networkState,
      });
      break;
    default:
      break; // loading/buffering/progress are too chatty to ship
  }
}

export function ExamAudioProvider({ children }) {
  const disabled = process.env.NEXT_PUBLIC_EXAM_AUDIO_DISABLED === "1";

  // Overlay state: null | { reason } — shown on any blocked event, closed on
  // playing. holdTimers additionally covers buffering (listening shell uses
  // it to freeze the module countdown while nothing is audible).
  const [overlay, setOverlay] = useState(null);
  const [holdTimers, setHoldTimers] = useState(false);
  const [portalReady, setPortalReady] = useState(false);

  // Lazily create the controller once, client-only (the factory itself is
  // SSR-guarded). Render-time creation means the very first child render
  // already sees a non-null controller through context — exam tasks can rely
  // on it from their first effect.
  const controllerRef = useRef(null);
  if (!disabled && controllerRef.current === null && typeof window !== "undefined") {
    controllerRef.current = createExamAudioController({ onTelemetry: reportTelemetry });
  }
  const controller = controllerRef.current;
  // Deferred-teardown timer: StrictMode (dev) runs mount→cleanup→mount — the
  // immediate remount cancels the pending destroy so the same controller
  // survives; a real unmount lets the destroy run one tick later.
  const destroyTimerRef = useRef(null);

  // Context value identity kept stable per (controller, holdTimers) pair so
  // consumers don't re-render on unrelated Provider state (overlay text).
  const ctxRef = useRef(null);
  if (!ctxRef.current || ctxRef.current.controller !== controller || ctxRef.current.holdTimers !== holdTimers) {
    ctxRef.current = { controller, holdTimers };
  }

  useEffect(() => {
    if (disabled) return undefined;
    setPortalReady(true); // portal target (document.body) only exists client-side
    if (destroyTimerRef.current) {
      clearTimeout(destroyTimerRef.current);
      destroyTimerRef.current = null;
    }
    const c = controllerRef.current;
    if (!c) return undefined;
    const unsub = c.subscribe((event) => {
      if (event.type === "blocked") {
        setOverlay({ reason: event.reason });
        setHoldTimers(true);
        trackAudioEvent("overlay_shown", { reason: event.reason, audioPath: event.src || null });
      } else if (event.type === "buffering") {
        setHoldTimers(true);
      } else if (event.type === "playing") {
        setOverlay(null);
        setHoldTimers(false);
      } else if (event.type === "ended") {
        setHoldTimers(false);
      }
    });

    // First-interaction global unlock. Practice pages have no explicit
    // "start exam" button, so the user's first tap anywhere on the page (pick
    // a topic, choose an answer, hit play) is what completes the WebKit
    // per-element autoplay unlock. Capture phase runs before any React bubble
    // handler, and unlock() is idempotent, so the exam shells' own explicit
    // unlock() calls (inside their start buttons) keep working unchanged.
    const onFirstInteraction = () => {
      const cc = controllerRef.current;
      if (cc) cc.unlock();
    };
    document.addEventListener("click", onFirstInteraction, { capture: true, once: true });
    document.addEventListener("touchend", onFirstInteraction, { capture: true, once: true });

    return () => {
      unsub();
      // once:true auto-removes a listener after it fires, but an unmount before
      // the first interaction still has to clean these up explicitly.
      document.removeEventListener("click", onFirstInteraction, { capture: true });
      document.removeEventListener("touchend", onFirstInteraction, { capture: true });
      // Defer one tick: a StrictMode remount cancels this; a real unmount
      // lets it tear down the element + document listeners.
      destroyTimerRef.current = setTimeout(() => {
        c.destroy();
        if (controllerRef.current === c) controllerRef.current = null;
      }, 0);
    };
  }, [disabled]);

  // Overlay button — MUST call retry() synchronously in the click handler so
  // the play() lands inside the fresh user-gesture stack.
  const handleResume = useCallback(() => {
    trackAudioEvent("overlay_resume", { reason: overlay ? overlay.reason : null });
    const c = controllerRef.current;
    if (c) c.retry();
  }, [overlay]);

  // Kill switch: no context at all → every consumer takes its legacy path.
  if (disabled) return children;

  const isInterrupted = overlay && overlay.reason === "interrupted";

  return (
    <ExamAudioContext.Provider value={ctxRef.current}>
      {children}
      {overlay && portalReady && createPortal(
        // Mask deliberately has no onClick — mid-exam the overlay must not be
        // dismissable by tapping outside (the exam can't proceed silently).
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            WebkitBackdropFilter: "blur(4px)", backdropFilter: "blur(4px)",
            display: "flex", justifyContent: "center", alignItems: "center",
            zIndex: 10000, fontFamily: FONT, padding: 20,
          }}
        >
          <div style={{
            background: "#fff", borderRadius: 16, padding: "28px 24px",
            maxWidth: 400, width: "90%", textAlign: "center",
            boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔊</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.t1, marginBottom: 8 }}>
              {isInterrupted ? "考试被打断（切出页面/来电）" : "音频播放被浏览器暂停"}
            </div>
            <div style={{ fontSize: 14, color: C.t2, lineHeight: 1.7, marginBottom: 20 }}>
              点击下方按钮继续考试，播放将立即恢复
            </div>
            <button
              onClick={handleResume}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 10,
                border: "none", background: C.blue, color: "#fff",
                fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
              }}
            >
              继续考试
            </button>
          </div>
        </div>,
        document.body
      )}
    </ExamAudioContext.Provider>
  );
}
