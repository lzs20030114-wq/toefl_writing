"use client";

import { useState, useEffect, useRef } from "react";
import announcements from "../../data/announcements.json";
import { HOME_TOKENS as T, CHALLENGE_TOKENS as CH, HOME_FONT } from "./theme";

const DISMISS_KEY = "toefl-announcement-dismissed";
const SIZE_KEY = "toefl-announcement-size";
const DEFAULT_SIZE = { w: 340, h: 420 };
const MIN_W = 280;
const MIN_H = 240;

function clampNum(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/* 视口内允许的最大尺寸 (留出页面边距) */
function getMaxSize() {
  return {
    w: Math.max(MIN_W, Math.min(640, window.innerWidth - 32)),
    h: Math.max(MIN_H, Math.min(760, window.innerHeight - 100)),
  };
}

function loadSavedSize() {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (Number.isFinite(saved?.w) && Number.isFinite(saved?.h)) {
        const max = getMaxSize();
        return {
          w: clampNum(saved.w, MIN_W, max.w),
          h: clampNum(saved.h, MIN_H, max.h),
        };
      }
    }
  } catch {}
  return DEFAULT_SIZE;
}

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

  /* 只在点开后才渲染, 此处一定在浏览器环境 */
  const [size, setSize] = useState(loadSavedSize);
  const [resizing, setResizing] = useState(false);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  /* 面板右侧锚定: 手柄在左下角, 向左拖变宽、向下拖变高 */
  function startResize(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const { w: startW, h: startH } = sizeRef.current;
    setResizing(true);
    function onMove(ev) {
      const max = getMaxSize();
      setSize({
        w: clampNum(startW + (startX - ev.clientX), MIN_W, max.w),
        h: clampNum(startH + (ev.clientY - startY), MIN_H, max.h),
      });
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      setResizing(false);
      try { localStorage.setItem(SIZE_KEY, JSON.stringify(sizeRef.current)); } catch {}
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  function resetSize() {
    setSize(DEFAULT_SIZE);
    try { localStorage.removeItem(SIZE_KEY); } catch {}
  }

  return (
    <div style={{
      position: "absolute", top: "calc(100% + 8px)", right: 0,
      width: size.w, height: size.h,
      display: "flex", flexDirection: "column",
      background: bg, borderRadius: 12,
      boxShadow: "0 6px 24px rgba(0,0,0,0.15)",
      border: `1px solid ${bdr}`,
      fontFamily: HOME_FONT, zIndex: 100,
      userSelect: resizing ? "none" : undefined,
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
        flexShrink: 0,
      }}>更新公告</div>

      {/* body */}
      <div style={{
        padding: "12px 18px 16px",
        flex: 1, minHeight: 0, overflowY: "auto",
      }}>
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

      {/* 左下角拖拽手柄 (双击恢复默认大小) */}
      <div
        onPointerDown={startResize}
        onDoubleClick={resetSize}
        title="拖拽调整大小，双击恢复默认"
        style={{
          position: "absolute", left: 0, bottom: 0,
          width: 18, height: 18,
          cursor: "sw-resize", touchAction: "none",
          display: "flex", alignItems: "flex-end",
          padding: 4, zIndex: 1,
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ display: "block" }}>
          <path
            d="M1 9 L9 1 M1 5 L5 1"
            stroke={t2} strokeWidth="1.2" strokeLinecap="round"
            opacity={resizing ? 0.9 : 0.5}
          />
        </svg>
      </div>
    </div>
  );
}
