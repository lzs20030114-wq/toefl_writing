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

/**
 * Speak `text` once on mount; cancel it on unmount / text change.
 *
 * iOS/WebKit（以及 Chrome 的 autoplay 策略）会静默丢弃「本文档还没发生过任何
 * 用户手势」时的 speak() 调用——从首页任务卡直接跳进 /speaking 正是这种情况
 * （那次点击落在上一个文档上）。所以 mount 先照常尝试；~600ms 后若引擎并没有
 * 真的开口（speaking 仍为 false），就挂一次性的捕获监听，在用户下一次触屏的
 * 手势内重读一遍（speakNarration 自带 cancel()，顺带清掉被卡住的队列）。
 * 引擎正常开口的平台（桌面、已有手势的页面）探测不命中，行为不变。
 */
export function useNarration(text) {
  useEffect(() => {
    speakNarration(text);
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;

    const removeListeners = () => {
      document.removeEventListener("click", onGesture, true);
      document.removeEventListener("touchend", onGesture, true);
    };
    const onGesture = () => {
      removeListeners();
      if (window.speechSynthesis.speaking) return; // 探测后自己开口了，别打断
      speakNarration(text);
    };
    const probe = setTimeout(() => {
      if (window.speechSynthesis.speaking) return; // 正常开口 → 不需要兜底
      document.addEventListener("click", onGesture, true);
      document.addEventListener("touchend", onGesture, true);
    }, 600);

    return () => {
      clearTimeout(probe);
      removeListeners();
      stopNarration();
    };
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
