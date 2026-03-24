"use client";

import { useState, useEffect } from "react";
import announcements from "../../data/announcements.json";
import { HOME_TOKENS as T, CHALLENGE_TOKENS as CH, HOME_FONT } from "./theme";

const DISMISS_KEY = "toefl-announcement-dismissed";

export function AnnouncementButton({ isChallenge }) {
  const [open, setOpen] = useState(false);
  const [hasNew, setHasNew] = useState(false);

  useEffect(() => {
    try {
      const latest = announcements[0]?.id;
      if (latest && localStorage.getItem(DISMISS_KEY) !== latest) setHasNew(true);
    } catch {}
  }, []);

  function handleOpen() {
    setOpen(true);
    setHasNew(false);
    try { localStorage.setItem(DISMISS_KEY, announcements[0]?.id); } catch {}
  }

  const btnColor = isChallenge ? "#fff" : T.t2;

  return (
    <>
      <button
        onClick={handleOpen}
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

      {open && <AnnouncementModal onClose={() => setOpen(false)} isChallenge={isChallenge} />}
    </>
  );
}

function AnnouncementModal({ onClose, isChallenge }) {
  const bg = isChallenge ? CH.card : "#fff";
  const t1 = isChallenge ? CH.t1 : T.t1;
  const t2 = isChallenge ? CH.t2 : T.t2;
  const bdr = isChallenge ? CH.cardBorder : T.bdr;
  const accent = isChallenge ? CH.accent : T.primary;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
        fontFamily: HOME_FONT,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: bg, borderRadius: 16,
          maxWidth: 440, width: "92%", maxHeight: "80vh",
          overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          border: `1px solid ${bdr}`,
        }}
      >
        {/* header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 22px 14px", borderBottom: `1px solid ${bdr}`,
        }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: t1 }}>更新公告</div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 20, color: t2, padding: "2px 6px", lineHeight: 1,
            }}
          >&times;</button>
        </div>

        {/* body */}
        <div style={{ padding: "16px 22px 22px", overflowY: "auto", flex: 1 }}>
          {announcements.map((a, i) => (
            <div key={a.id} style={{ marginBottom: i < announcements.length - 1 ? 22 : 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: t1 }}>{a.title}</span>
                <span style={{
                  fontSize: 11, color: t2, background: isChallenge ? "rgba(255,255,255,0.06)" : "#F3F4F6",
                  borderRadius: 4, padding: "1px 7px",
                }}>{a.date}</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, listStyle: "none" }}>
                {a.items.map((item, j) => (
                  <li key={j} style={{
                    fontSize: 13, color: t2, lineHeight: 1.7,
                    position: "relative", paddingLeft: 4,
                  }}>
                    <span style={{
                      position: "absolute", left: -14, top: "0.55em",
                      width: 5, height: 5, borderRadius: "50%",
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
    </div>
  );
}
