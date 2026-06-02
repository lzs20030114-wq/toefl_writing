"use client";

import { useState, useEffect } from "react";
import { HOME_TOKENS as T, HOME_FONT } from "./theme";

// Bumped per major bank release so each big update can re-announce once.
const SEEN_KEY = "toefl-bank-update-2026-06-02";

/**
 * One-time celebratory popup shown the first time a logged-in user lands on the
 * home page after the 2026-06-02 full-bank refresh. Self-manages via localStorage
 * (shows once, then never again). Mount once in HomePageClient.
 */
export function BankUpdateModal({ isLoggedIn }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) return;
    try {
      if (localStorage.getItem(SEEN_KEY) !== "1") setOpen(true);
    } catch {}
  }, [isLoggedIn]);

  function dismiss() {
    try { localStorage.setItem(SEEN_KEY, "1"); } catch {}
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      onClick={dismiss}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(15,23,42,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, fontFamily: HOME_FONT,
        animation: "bankUpdFade 0.25s ease",
      }}
    >
      <style>{`
        @keyframes bankUpdFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes bankUpdPop { from { opacity: 0; transform: translateY(12px) scale(0.97) } to { opacity: 1; transform: none } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: "100%", maxWidth: 420,
          background: "#fff", borderRadius: 18,
          boxShadow: "0 24px 64px rgba(0,0,0,0.28)",
          border: `1px solid ${T.bdr}`,
          padding: "32px 28px 24px",
          textAlign: "center",
          animation: "bankUpdPop 0.32s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <div style={{ fontSize: 44, lineHeight: 1, marginBottom: 14 }}>🎉</div>
        <h2 style={{ margin: "0 0 10px", fontSize: 21, fontWeight: 800, color: T.t1 }}>
          全新题库已上线
        </h2>
        <p style={{ margin: "0 0 8px", fontSize: 14.5, lineHeight: 1.7, color: T.t2 }}>
          全部题目已按 <b style={{ color: T.t1 }}>2026 改革后真考风格</b>重新生成与校准，
          覆盖全部 12 个题型，听力 / 口语全部配备新音频。
        </p>
        <p style={{ margin: "0 0 22px", fontSize: 13, lineHeight: 1.6, color: T.t2, opacity: 0.85 }}>
          做题体验更贴近最新真考 —— 现在就开始练习吧。
        </p>
        <button
          onClick={dismiss}
          style={{
            width: "100%", padding: "13px 0",
            background: T.primary, color: "#fff",
            border: "none", borderRadius: 10,
            fontSize: 15, fontWeight: 700, cursor: "pointer",
            fontFamily: HOME_FONT,
            transition: "filter 150ms",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(0.93)")}
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
        >
          开始练习 →
        </button>
      </div>
    </div>
  );
}
