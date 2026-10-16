"use client";

// 真题模考做题页的「ETS 机考」外观：对照 reports/realbank-source-count-2026-10-01/ 里
// 真题 PDF 截下的考试界面——顶部一条细栏（左「Reading | Question 29 of 35」、右计时 +
// Hide Time）、深色细分隔线、居中粗体指令标题、白底无卡片、圆圈单选。
// 只给 ?source=real-bank 的模考做题页用（阅读/听力壳、造句、口语）；开始卡 / 结果页 / 练习记录仍是站内样式。

import React, { useState } from "react";
import { READING_FONT } from "./ui";

export const ETS = {
  font: READING_FONT,
  ink: "#222222",
  sub: "#4b4b4b",
  muted: "#767676",
  rule: "#3f3f3f",
  line: "#cfcfcf",
  teal: "#00737a",
  tealSoft: "#e3f1f1",
  canvas: "#ffffff",
  page: "#fafafa",
  blank: "#dcdcdc",
  correct: "#15803d",
  wrong: "#b91c1c",
};

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
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      <line x1="3" y1="21" x2="21" y2="3" />
    </svg>
  );
}

/**
 * 顶部细栏。sticky 贴顶，高度固定 ETS_BAR_HEIGHT —— 阅读两栏的 calc(100vh - N) 按它算。
 * timeLeft 为 undefined 时不显示计时（口语等没有分节时钟的页面）。
 */
export const ETS_BAR_HEIGHT = 44;
export function EtsTopBar({ section, progress, timeLeft, onExit, exitLabel = "返回", right = null, clockTestId = "ets-clock" }) {
  const [hidden, setHidden] = useState(false);
  const hasClock = Number.isFinite(timeLeft);
  const low = hasClock && timeLeft <= 60;
  return (
    <div
      data-testid="ets-top-bar"
      className="tp-ets-bar"
      style={{
        position: "sticky", top: 0, zIndex: 100, height: ETS_BAR_HEIGHT, boxSizing: "border-box",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        padding: "0 20px", background: ETS.canvas, borderBottom: `1.5px solid ${ETS.rule}`,
        fontFamily: ETS.font, color: ETS.ink,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, whiteSpace: "nowrap" }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{section}</span>
        {progress && <>
          <span aria-hidden="true" style={{ width: 1, height: 16, background: ETS.muted }} />
          <span data-testid="ets-progress" style={{ fontSize: 13, fontWeight: 600, color: ETS.sub, overflow: "hidden", textOverflow: "ellipsis" }}>{progress}</span>
        </>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        {hasClock && !hidden && (
          <span data-testid={clockTestId} style={{ fontSize: 14, fontWeight: 600, color: low ? ETS.wrong : ETS.ink, fontVariantNumeric: "tabular-nums" }}>
            {etsClock(timeLeft)}
          </span>
        )}
        {hasClock && (
          <button
            type="button"
            aria-label={hidden ? "Show Time" : "Hide Time"}
            onClick={() => setHidden((v) => !v)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5, padding: 0, border: "none", background: "none",
              color: ETS.teal, fontFamily: ETS.font, fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            <EyeOffIcon /><span className="tp-ets-hide-label">{hidden ? "Show Time" : "Hide Time"}</span>
          </button>
        )}
        {right}
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            style={{
              marginLeft: 4, padding: "4px 12px", borderRadius: 4, border: `1px solid ${ETS.line}`, background: ETS.canvas,
              color: ETS.sub, fontFamily: ETS.font, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}
          >
            {exitLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/** 居中粗体指令标题：「Fill in the missing letters in the paragraph.」/ 文章标题。 */
export function EtsDirection({ children, style }) {
  return (
    <h2
      data-testid="ets-direction"
      style={{
        margin: 0, padding: "26px 16px 22px", textAlign: "center",
        fontFamily: ETS.font, fontSize: 22, fontWeight: 700, lineHeight: 1.35, color: ETS.ink,
        ...style,
      }}
    >
      {children}
    </h2>
  );
}

/**
 * 圆圈单选项。tone: null（作答中）| "correct" | "wrong"（揭晓答案时）。
 * 选中 = 圆圈内实心点；整行可点，不画外框（真题界面就是一行文字 + 圆圈）。
 */
export function EtsChoice({ checked, onClick, disabled, tone = null, children, ...rest }) {
  const color = tone === "correct" ? ETS.correct : tone === "wrong" ? ETS.wrong : ETS.ink;
  const ring = tone ? color : checked ? ETS.teal : "#5a5a5a";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={!!checked}
      data-ets-choice=""
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "flex-start", gap: 12, width: "100%", padding: "7px 8px", margin: "0 0 6px -8px",
        border: "none", borderRadius: 4, background: checked && !tone ? ETS.tealSoft : "transparent",
        cursor: disabled ? "default" : "pointer", textAlign: "left",
        fontFamily: ETS.font, fontSize: 15, lineHeight: 1.5, color,
      }}
      {...rest}
    >
      <span aria-hidden="true" style={{
        width: 18, height: 18, marginTop: 2, flexShrink: 0, borderRadius: "50%", boxSizing: "border-box",
        border: `1.5px solid ${ring}`, background: ETS.canvas,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {(checked || tone === "correct") && <span style={{ width: 9, height: 9, borderRadius: "50%", background: ring }} />}
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

/** 「Read the following notice.」—— 按真题材料的体裁拼指令（缺体裁时退回 text）。 */
export function rdlDirection(genre) {
  const g = String(genre || "").trim().toLowerCase() || "text";
  return `Read the following ${g === "passage" ? "text" : g}.`;
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
