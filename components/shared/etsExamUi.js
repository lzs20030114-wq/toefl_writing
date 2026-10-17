"use client";

// 真题模考做题页的「ETS 机考」外观，对照 5.6 真题 PDF（阅读 / 听力 / 写作 / 口语）里截下的考试界面：
//   最上面一条深青色的考试头（右侧放 Back / Next 这类导航按钮），下面一条白色细栏
//   （左「Reading | Question 29 of 35」、右计时 + Hide Time），再往下白底、居中粗体指令标题、圆圈单选。
// 截图宽 1152px，字号按「1152 宽时多少 px」量出来，用 etsSize(px) 随视口等比放大（封顶 1.35 倍），
// 所以在常见的 1280–1440 笔记本屏上和真题截图的比例一致。
// 只给 ?source=real-bank 的模考做题页用；开始卡 / 结果页 / 练习记录仍是站内样式。

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { READING_FONT } from "./ui";

export const ETS = {
  font: READING_FONT,
  ink: "#222222",
  text: "#333333",
  sub: "#4b4b4b",
  muted: "#767676",
  rule: "#a3a3a3",
  line: "#d4d4d4",
  teal: "#00737a",
  tealSoft: "#e3f1f1",
  header: "#2c6b6a",
  canvas: "#ffffff",
  page: "#fafafa",
  blank: "#dcdcdc",
  correct: "#15803d",
  wrong: "#b91c1c",
};

/** 真题截图里 1152px 宽时的 px → 随视口放大的 CSS 长度（最小原值，最大 1.35 倍）。 */
export function etsSize(px, maxScale = 1.35) {
  return `clamp(${px}px, ${((px / 1152) * 100).toFixed(3)}vw, ${Math.round(px * maxScale * 10) / 10}px)`;
}
/** etsSize 的短名（做题组件里常有一个叫 ets 的布尔 prop，那种文件请用 etsSize）。 */
export const ets = etsSize;

/** 考试界面的时钟写法：00:05:25。 */
export function etsClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 「Question 3 of 35」/「Questions 1-10 of 35」（填词一篇占一段题号）。 */
export function etsProgressLabel(from, to, total) {
  if (!total) return "";
  return from === to ? `Question ${from} of ${total}` : `Questions ${from}-${to} of ${total}`;
}

function EyeOffIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      <line x1="3" y1="21" x2="21" y2="3" />
    </svg>
  );
}

// 做题组件往顶栏里「借位」：听力播音时细栏不显示题号和计时、作答时计时换成这道题的作答时间
// （真题界面就是这样）。同一时刻只有一场考试在屏幕上，所以用一个模块级的小 store 就够了。
let barOverride = null;
const barListeners = new Set();
function setBarOverride(next) {
  barOverride = next;
  barListeners.forEach((fn) => fn());
}
function subscribeBar(fn) {
  barListeners.add(fn);
  return () => barListeners.delete(fn);
}
const readBar = () => barOverride;

/** 做题组件调用：override = { hideProgress?, timeLeft? }；卸载时自动撤销。 */
export function useEtsBarOverride(override) {
  const key = override ? JSON.stringify(override) : "";
  useEffect(() => {
    if (!key) return undefined;
    setBarOverride(JSON.parse(key));
    return () => setBarOverride(null);
  }, [key]);
}

export const ETS_HEADER_HEIGHT = 44;
export const ETS_SUBBAR_HEIGHT = 34;
/** 两条顶栏合计高度 —— 阅读两栏 / 写作两栏的 calc(100vh - N) 按它算。 */
export const ETS_BAR_HEIGHT = ETS_HEADER_HEIGHT + ETS_SUBBAR_HEIGHT;
const NAV_SLOT_ID = "ets-nav-slot";

/**
 * 顶栏：深青考试头（左「返回」、右导航按钮位）+ 白色细栏（科目 | 题号，计时 + Hide Time）。
 * 整体 sticky 贴顶。timeLeft 为 undefined 时不显示计时。
 */
export function EtsTopBar({ section, progress, timeLeft, onExit, exitLabel = "返回", right = null, clockTestId = "ets-clock" }) {
  const [hidden, setHidden] = useState(false);
  const override = useSyncExternalStore(subscribeBar, readBar, () => null);
  const shownProgress = override?.hideProgress ? null : progress;
  const clock = override && "timeLeft" in override ? override.timeLeft : timeLeft;
  const hasClock = Number.isFinite(clock);
  const low = hasClock && clock <= (override && "timeLeft" in override ? 10 : 60);
  return (
    <div data-testid="ets-top-bar" className="tp-ets-bar" style={{ position: "sticky", top: 0, zIndex: 100, fontFamily: ETS.font }}>
      <div style={{
        height: ETS_HEADER_HEIGHT, boxSizing: "border-box", background: ETS.header,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 16px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {onExit && (
            <button type="button" onClick={onExit} style={{
              padding: "4px 12px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.55)", background: "transparent",
              color: "#fff", fontFamily: ETS.font, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}>{exitLabel}</button>
          )}
        </div>
        <div id={NAV_SLOT_ID} data-testid="ets-nav" style={{ display: "flex", alignItems: "center", gap: 10 }}>{right}</div>
      </div>
      <div style={{
        height: ETS_SUBBAR_HEIGHT, boxSizing: "border-box", background: ETS.canvas,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        padding: "0 3.4%", borderBottom: `1.5px solid ${ETS.rule}`, color: ETS.sub,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, whiteSpace: "nowrap" }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#464646" }}>{section}</span>
          {shownProgress && <>
            <span aria-hidden="true" style={{ width: 1, height: 16, background: "#bdbdbd" }} />
            <span data-testid="ets-progress" style={{ fontSize: 13.5, fontWeight: 700, color: "#525252", overflow: "hidden", textOverflow: "ellipsis" }}>{shownProgress}</span>
          </>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexShrink: 0 }}>
          {hasClock && !hidden && (
            <span data-testid={clockTestId} style={{ fontSize: 14, fontWeight: 600, color: low ? ETS.wrong : "#444", fontVariantNumeric: "tabular-nums" }}>
              {etsClock(clock)}
            </span>
          )}
          {hasClock && (
            <button
              type="button"
              aria-label={hidden ? "Show Time" : "Hide Time"}
              onClick={() => setHidden((v) => !v)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, padding: 0, border: "none", background: "none",
                color: ETS.teal, fontFamily: ETS.font, fontSize: 14, fontWeight: 700, cursor: "pointer",
              }}
            >
              <EyeOffIcon /><span className="tp-ets-hide-label">{hidden ? "Show Time" : "Hide Time"}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 导航按钮（Back / Next / Submit…）送到考试头右侧；顶栏不在页面上时（单测里单独渲染做题组件）原地显示。
 */
export function EtsNav({ children }) {
  const [slot, setSlot] = useState(null);
  useEffect(() => { setSlot(document.getElementById(NAV_SLOT_ID)); }, []);
  if (slot) return createPortal(children, slot);
  return <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "16px 3.4%" }}>{children}</div>;
}

/** 考试头上的白色圆角按钮。 */
export function EtsNavButton({ children, onClick, disabled, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minWidth: 76, padding: "5px 18px", borderRadius: 999, border: "1px solid #fff",
        background: disabled ? "rgba(255,255,255,0.45)" : "#fff", color: ETS.header,
        fontFamily: ETS.font, fontSize: 14, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 居中粗体指令标题：「Fill in the missing letters in the paragraph.」/ 文章标题。 */
export function EtsDirection({ children, style }) {
  return (
    <h2
      data-testid="ets-direction"
      style={{
        margin: 0, padding: `${etsSize(30)} 16px ${etsSize(22)}`, textAlign: "center",
        fontFamily: ETS.font, fontSize: etsSize(25), fontWeight: 700, lineHeight: 1.3, color: "#111",
        ...style,
      }}
    >
      {children}
    </h2>
  );
}

/**
 * 圆圈单选项。tone: null（作答中）| "correct" | "wrong"（揭晓答案时）。
 * 选中 = 圆圈内实心点；整行可点，不画外框、不铺底色（真题界面就是一行文字 + 圆圈）。
 */
export function EtsChoice({ checked, onClick, disabled, tone = null, children, ...rest }) {
  const color = tone === "correct" ? ETS.correct : tone === "wrong" ? ETS.wrong : ETS.text;
  const ring = tone ? color : checked ? "#333" : "#7a7a7a";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={!!checked}
      data-ets-choice=""
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "flex-start", gap: etsSize(16), width: "100%", padding: `${etsSize(6)} 0`, margin: `0 0 ${etsSize(11)}`,
        border: "none", background: "transparent",
        cursor: disabled ? "default" : "pointer", textAlign: "left",
        fontFamily: ETS.font, fontSize: etsSize(15), lineHeight: 1.45, color,
      }}
      {...rest}
    >
      <span aria-hidden="true" style={{
        width: etsSize(19), height: etsSize(19), marginTop: 1, flexShrink: 0, borderRadius: "50%", boxSizing: "border-box",
        border: `1.5px solid ${ring}`, background: ETS.canvas,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {(checked || tone === "correct") && <span style={{ width: "52%", height: "52%", borderRadius: "50%", background: ring }} />}
      </span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </button>
  );
}

/** 做题页里的 Next / Back / Submit 按钮（考试界面的扁平青色按钮）。 */
export function EtsButton({ children, onClick, variant = "primary", disabled, style, ...rest }) {
  const primary = variant === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minWidth: 84, padding: "7px 18px", borderRadius: 4,
        border: `1px solid ${primary ? ETS.teal : ETS.line}`,
        background: primary ? ETS.teal : ETS.canvas, color: primary ? "#fff" : ETS.sub,
        fontFamily: ETS.font, fontSize: 14, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1, ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 「Read an advertisement.」/「Read a schedule.」—— 按真题材料的体裁拼指令（缺体裁时退回 text）。 */
export function rdlDirection(genre) {
  const raw = String(genre || "").trim().toLowerCase();
  const g = !raw || raw === "passage" ? "text" : raw;
  return `Read ${/^[aeiou]/.test(g) ? "an" : "a"} ${g}.`;
}

/**
 * 学术文章正文首段是一行标题（如「Green Roof Benefits」）时拆出来做居中大标题，
 * 和真题界面一致；判断不出就不拆，原文照旧整段显示。
 */
export function splitPassageTitle(passage) {
  const text = String(passage || "");
  const m = text.match(/^([^\n]{2,90})\n\s*\n([\s\S]+)$/);
  if (!m) return { title: null, body: text };
  const first = m[1].trim();
  if (/[.?!:;,]$/.test(first) || /^\[[A-Z■]\]/.test(first) || first.split(/\s+/).length > 12) return { title: null, body: text };
  return { title: first, body: m[2] };
}

// ── 人物插图 ──
// 真题界面在听力（说话人全身照）、造句（对话双方头像）、写作讨论（教授 / 同学头像）里都放人物照片。
// 我们没有照片，用同一风格的扁平人物插图占位：只表达「谁在说话、几个人」，不承载题目信息。
const FIGURE_LOOKS = [
  { skin: "#e9c19b", hair: "#3b2a20", top: "#5f8f8a", bottom: "#2f3b4a" },
  { skin: "#c98f63", hair: "#1f1712", top: "#c9725a", bottom: "#3a3a3a" },
  { skin: "#f1d0b0", hair: "#7a5233", top: "#6f7fb8", bottom: "#4a4237" },
  { skin: "#a8724c", hair: "#16110d", top: "#8a6aa8", bottom: "#2d3340" },
];
export function etsLook(seed) {
  const s = String(seed || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return FIGURE_LOOKS[h % FIGURE_LOOKS.length];
}

function Person({ x, look, female, facing = 0 }) {
  const { skin, hair, top, bottom } = look;
  const turn = facing * 3;
  return (
    <g transform={`translate(${x} 0)`}>
      {/* 腿 / 裙 */}
      {female ? <>
        <path d="M-15 146 L15 146 L19 206 L-19 206 Z" fill={bottom} />
        <path d="M-11 206 h7 l-1 54 h-6 Z M4 206 h7 l-1 54 h-6 Z" fill={skin} />
      </> : <path d="M-15 146 L-1 146 L-3 260 L-14 260 Z M1 146 L15 146 L14 260 L3 260 Z" fill={bottom} />}
      <path d="M-17 260 h14 v6 h-18 Z M3 260 h14 l3 6 h-17 Z" fill="#2a2a2a" />
      {/* 手臂（和身体分开，自然下垂） */}
      <path d="M-21 74 Q-29 78 -30 92 L-31 140 Q-31 146 -26 146 Q-22 146 -22 140 L-21 98 Z" fill={top} />
      <path d="M21 74 Q29 78 30 92 L31 140 Q31 146 26 146 Q22 146 22 140 L21 98 Z" fill={top} />
      <ellipse cx="-26.5" cy="150" rx="4.5" ry="5.5" fill={skin} />
      <ellipse cx="26.5" cy="150" rx="4.5" ry="5.5" fill={skin} />
      {/* 身体 */}
      <path d="M-21 72 Q0 64 21 72 Q23 110 18 148 L-18 148 Q-23 110 -21 72 Z" fill={top} />
      <path d="M-6 66 L0 76 L6 66 Z" fill={skin} />
      {/* 脖子 + 头 */}
      <rect x="-5.5" y="54" width="11" height="14" rx="3" fill={skin} />
      <ellipse cx={turn} cy="39" rx="14.5" ry="17.5" fill={skin} />
      {female
        ? <path d={`M${turn - 16} 40 Q${turn - 18} 14 ${turn} 18 Q${turn + 18} 14 ${turn + 16} 40 Q${turn + 18} 62 ${turn + 11} 68 L${turn + 11} 38 Q${turn} 26 ${turn - 11} 38 L${turn - 11} 68 Q${turn - 18} 62 ${turn - 16} 40 Z`} fill={hair} />
        : <path d={`M${turn - 15} 36 Q${turn - 16} 18 ${turn} 19 Q${turn + 16} 18 ${turn + 15} 36 Q${turn + 7} 27 ${turn - 15} 36 Z`} fill={hair} />}
    </g>
  );
}

/**
 * 听力说话人插图：count=1 一人居中，count=2 两人相对（对话）。
 * speakers 可带 gender（真题题库 lc 的 speakers[]），seed 决定配色（同一道题始终同一个样子）。
 */
export function EtsFigure({ count = 1, speakers = [], seed = "", style }) {
  const two = count >= 2;
  const isFemale = (i) => String(speakers[i]?.gender || "").toLowerCase() === "female" || (!speakers[i] && i === 1);
  return (
    <svg data-testid="ets-figure" viewBox={two ? "-80 0 260 272" : "-50 0 100 272"} role="img" aria-label={two ? "Two speakers" : "Speaker"}
      style={{ height: "100%", maxWidth: "100%", display: "block", margin: "0 auto", ...style }}>
      {two ? <>
        <Person x={0} look={etsLook(seed + "a")} female={isFemale(0)} facing={1} />
        <Person x={100} look={etsLook(seed + "b")} female={isFemale(1)} facing={-1} />
      </> : <Person x={0} look={etsLook(seed)} female={String(speakers[0]?.gender || "").toLowerCase() === "female"} />}
    </svg>
  );
}

/** 造句 / 讨论里的圆形头像。 */
export function EtsAvatar({ seed = "", size = 44, female = false, label }) {
  const look = etsLook(seed);
  return (
    <svg data-testid="ets-avatar" width={size} height={size} viewBox="-30 -30 60 60" role="img" aria-label={label || "avatar"}
      style={{ flexShrink: 0, display: "block", borderRadius: "50%", boxShadow: "0 0 0 1.5px #c9c9c9" }}>
      <circle r="30" fill="#e9eef0" />
      <path d="M-24 30 Q-22 10 0 8 Q22 10 24 30 Z" fill={look.top} />
      <ellipse cx="0" cy="-6" rx="12" ry="14" fill={look.skin} />
      {female
        ? <path d="M-14 -4 Q-16 -26 0 -24 Q16 -26 14 -4 Q15 10 10 14 L10 -6 Q0 -16 -10 -6 L-10 14 Q-15 10 -14 -4 Z" fill={look.hair} />
        : <path d="M-12 -8 Q-13 -24 0 -23 Q13 -24 12 -8 Q6 -17 -12 -8 Z" fill={look.hair} />}
    </svg>
  );
}
