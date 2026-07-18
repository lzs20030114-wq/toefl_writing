"use client";

import { useEffect } from "react";
import { C, FONT, Btn, TopBar, PageShell, SurfaceCard } from "../shared/ui";

const SPK = { color: "#F59E0B", soft: "#FFFBEB" };

/**
 * Speak `text` aloud via the browser's Web Speech API. Best-effort only: if
 * there's no speech engine (or it throws), stay silent — the same text is
 * already on screen, so no fallback chain is needed (the real exam reads the
 * setting aloud while the scenario is on screen, so text display is authentic).
 */
export function speakNarration(text) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text == null ? "" : text));
    u.lang = "en-US";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch {
    /* best-effort */
  }
}

export function stopNarration() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* best-effort */
  }
}

/** Speak `text` once on mount; cancel it on unmount / text change. */
export function useNarration(text) {
  useEffect(() => {
    speakNarration(text);
    return () => stopNarration();
  }, [text]);
}

/**
 * Full-screen intro / setting screen shown before a speaking task begins.
 *
 * Reads the setting narration aloud (best-effort TTS) while the same lines are
 * displayed, then gates task start behind an explicit "开始" gesture. That
 * gesture is where the caller unlocks the shared exam audio element — giving the
 * practice pages a real user gesture and rooting out the zero-click autoplay
 * unlock race.
 *
 * @param {string[]} lines — narration lines (e.g. [settingText, instructionText]).
 */
export function SpeakingIntroScreen({
  title,
  section,
  qInfo,
  lines = [],
  buttonLabel = "开始",
  onStart,
  onExit,
}) {
  const shown = lines.filter(Boolean);
  useNarration(shown.join(" "));

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title={title} section={section} qInfo={qInfo} onExit={onExit} />
      <PageShell narrow>
        <SurfaceCard style={{ padding: "32px 28px", textAlign: "center" }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              margin: "0 auto 20px",
              background: SPK.soft,
              border: "2px solid #FDE68A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 32 }}>🔊</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 26 }}>
            {shown.map((line, i) => (
              <div key={i} style={{ fontSize: 16, color: C.t1, lineHeight: 1.7 }}>
                {line}
              </div>
            ))}
          </div>
          <Btn
            onClick={onStart}
            style={{ background: SPK.color, borderColor: SPK.color, padding: "12px 40px", fontSize: 15 }}
          >
            {buttonLabel}
          </Btn>
        </SurfaceCard>
      </PageShell>
    </div>
  );
}
