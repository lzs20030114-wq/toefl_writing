"use client";

import { useState, useEffect, useRef } from "react";
import announcements from "../../data/announcements.json";
import { HOME_TOKENS as T, CHALLENGE_TOKENS as CH, HOME_FONT } from "./theme";

const DISMISS_KEY = "toefl-announcement-dismissed";

export function AnnouncementButton({ isChallenge }) {
  const [open, setOpen] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    try {
      const latest = announcements[0]?.id;
      if (latest && localStorage.getItem(DISMISS_KEY) !== latest) setHasNew(true);
    } catch {}
  }, []);

  /* 点击外部关闭 */
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleToggle() {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen) {
      setHasNew(false);
      try { localStorage.setItem(DISMISS_KEY, announcements[0]?.id); } catch {}
    }
  }

  const btnColor = isChallenge ? "#fff" : T.t2;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        onClick={handleToggle}
        title="更新公告"
        style={{
          position: "relative",
          background: "none", border: "none", cursor: "pointer",
          padding: "4px 8px", display: "flex", alignItems: "center", gap: 4,
          fontSize: 13, color: btnColor, fontFamily: HOME_FONT,
          borderRadius: 6,
          transition: "background 150ms",
        }}
        onMouseEnter={e => e.currentTarget.style.background = isChallenge ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)"}
        onMouseLeave={e => e.currentTarget.style.background = "none"}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={btnColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <span className="home-nav-ai">公告</span>
        {hasNew && (
          <span style={{
            position: "absolute", top: 2, right: 4,
            width: 7, height: 7, borderRadius: "50%",
            background: "#EF4444",
          }} />
        )}
      </button>

      {open && <AnnouncementDropdown isChallenge={isChallenge} />}
    </div>
  );
}

function AnnouncementDropdown({ isChallenge }) {
  const bg = isChallenge ? CH.card : "#fff";
  const t1 = isChallenge ? CH.t1 : T.t1;
  const t2 = isChallenge ? CH.t2 : T.t2;
  const bdr = isChallenge ? CH.cardBorder : T.bdr;
  const accent = isChallenge ? CH.accent : T.primary;

  return (
    <div style={{
      position: "absolute", top: "calc(100% + 8px)", right: 0,
      width: 340, maxHeight: 420, overflowY: "auto",
      background: bg, borderRadius: 12,
      boxShadow: "0 6px 24px rgba(0,0,0,0.15)",
      border: `1px solid ${bdr}`,
      fontFamily: HOME_FONT, zIndex: 100,
    }}>
      {/* 小三角 */}
      <div style={{
        position: "absolute", top: -6, right: 16,
        width: 12, height: 12, background: bg,
        border: `1px solid ${bdr}`,
        borderRight: "none", borderBottom: "none",
        transform: "rotate(45deg)",
      }} />

      {/* header */}
      <div style={{
        padding: "14px 18px 10px",
        borderBottom: `1px solid ${bdr}`,
        fontSize: 15, fontWeight: 700, color: t1,
        position: "relative", /* cover triangle seam */
        background: bg, borderRadius: "12px 12px 0 0",
      }}>更新公告</div>

      {/* body */}
      <div style={{ padding: "12px 18px 16px" }}>
        {announcements.map((a, i) => (
          <div key={a.id} style={{ marginBottom: i < announcements.length - 1 ? 18 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: t1 }}>{a.title}</span>
              <span style={{
                fontSize: 10, color: t2,
                background: isChallenge ? "rgba(255,255,255,0.06)" : "#F3F4F6",
                borderRadius: 4, padding: "1px 6px",
              }}>{a.date}</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, listStyle: "none" }}>
              {a.items.map((item, j) => (
                <li key={j} style={{
                  fontSize: 12.5, color: t2, lineHeight: 1.75,
                  position: "relative", paddingLeft: 4,
                }}>
                  <span style={{
                    position: "absolute", left: -12, top: "0.6em",
                    width: 4, height: 4, borderRadius: "50%",
                    background: accent, opacity: 0.7,
                  }} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
