"use client";
import React, { useState } from "react";

// 真题练习记录「逐题回顾」里的 AI 讲解外观（设计稿「真题练习记录 优化版」）：
//   待点：靛蓝按钮「AI 讲解」+ PRO 角标 → 分析中提示 → 靛蓝浅底卡片（可收起）。
// 只是外观：状态（loading / text / error）、Pro 门、缓存回填、计费时机全部仍由各 useXxxAiExplain
// hook 与对应的 XxxAiExplainBlock 管（它们在 variant="review" 时把 ex / 回调交给这里渲染）。
// 其它历史页不传 variant，仍是各自原来的蓝色按钮样式，互不影响。

const INDIGO = { text: "#4338CA", bd: "#C7D2FE", bg: "#EEF2FF", hover: "#E0E7FF", solid: "#6366F1", cardBg: "#F7F7FE", cardBd: "#E0E7FF" };

export function AiExplainView({ ex, onRun, loadingText = "AI 正在结合原文分析…", testId }) {
  // 收起只是本地视图状态；再点「AI 讲解」会回到已有结果（hook 里有缓存 / 已有文本，不会重复计费）。
  const [hidden, setHidden] = useState(false);

  if (ex?.text && !hidden) {
    return (
      <div data-testid={testId} style={{ padding: "10px 12px", borderRadius: 10, background: INDIGO.cardBg, border: `1px solid ${INDIGO.cardBd}`, display: "flex", flexDirection: "column", gap: 7, animation: "fadeUp 0.25s ease both" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: INDIGO.text, letterSpacing: "0.04em" }}>AI 讲解</span>
          <button type="button" onClick={() => setHidden(true)} style={{ border: "none", background: "none", color: "#94a39a", fontSize: 11, cursor: "pointer" }}>收起</button>
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.7, color: "#1a2420", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{ex.text}</div>
      </div>
    );
  }

  if (ex?.loading) {
    return <div style={{ fontSize: 12, color: INDIGO.solid }}>{loadingText}</div>;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={() => { if (ex?.text) setHidden(false); else onRun(); }}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, border: `1px solid ${INDIGO.bd}`, background: INDIGO.bg, color: INDIGO.text, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = INDIGO.hover; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = INDIGO.bg; }}
      >
        AI 讲解
        <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: INDIGO.solid, borderRadius: 4, padding: "1px 5px" }}>PRO</span>
      </button>
      {ex?.error ? <span style={{ fontSize: 12, color: "#E11D48" }}>{ex.error}</span> : null}
    </div>
  );
}
