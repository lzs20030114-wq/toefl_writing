"use client";
// 逐题回顾各题型共用的小件：滚动定位、折叠卡外壳、题目朗读条。
import React from "react";
import { AudioPlayer } from "../../listening/AudioPlayer";
import { LV } from "../realBankUi";

/** 滚到带 data-q={key} 的那张卡（留出顶栏 56 + 吸顶筛选条的高度）。 */
export function scrollToKey(key) {
  if (typeof window === "undefined") return;
  setTimeout(() => {
    const el = document.querySelector(`[data-q="${String(key).replace(/["\\]/g, "\\$&")}"]`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 124, behavior: "smooth" });
  }, 60);
}

/** 对 / 错小圆标（22px）。 */
export function Mark({ lv, size = 22, children }) {
  const L = LV[lv] || LV.none;
  const text = children != null ? children : lv === "ok" ? "✓" : lv === "bad" ? "✗" : "–";
  return (
    <span style={{ width: size, height: size, borderRadius: "50%", background: L.bg, color: L.c, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{text}</span>
  );
}

/** 折叠卡：外壳按对错档位着色，头部 / 正文由调用方给。 */
export function ReviewCard({ dataKey, open, lv, head, children, overflow = "hidden", bodyPadding }) {
  const L = LV[lv] || LV.none;
  return (
    <div data-q={dataKey} style={{ border: `1px solid ${open ? L.bd : "#ebf0ed"}`, borderRadius: 12, background: "#fff", overflow, transition: "border-color .2s" }}>
      {head({ headBg: open ? L.soft : "#fff", L })}
      {open ? <div style={{ padding: bodyPadding || "4px 14px 14px 46px", display: "flex", flexDirection: "column", gap: 10, animation: "rbFadeUp .2s ease both" }}>{children}</div> : null}
    </div>
  );
}

/** 「题目朗读」「原句朗读」一行：标签 + 紧凑播放器（有真实音频放音频，否则浏览器 / TTS 朗读文本）。 */
export function ReadAloud({ label, text, src, labelWidth }) {
  return (
    <div data-no-dict style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "#5a6b62", width: labelWidth }}>{label}</span>
      <AudioPlayer compact playbackRateControl src={src || null} text={text} isPractice />
    </div>
  );
}

export function EmptyNote({ children }) {
  return <div style={{ padding: "20px 0", textAlign: "center", fontSize: 12, color: "#94a39a" }}>{children}</div>;
}

export function Ghost({ children }) {
  return <div style={{ fontSize: 12, color: "#94a39a", fontStyle: "italic" }}>{children}</div>;
}
