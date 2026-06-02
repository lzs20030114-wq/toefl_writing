"use client";
import React, { useState } from "react";
import { NEUTRAL as P } from "./ui";

// Compact stat tile shared by the Listening / Reading / Speaking progress views.
// Those three definitions were byte-identical except for how the micro-progress
// bar reads `avg`:
//   - Listening / Reading: `avg` is already a percentage (e.g. "85%") → use as-is.
//   - Speaking: `avg` is a /5 score (e.g. "3.5") → pass avgMax={5} to scale to %.
//
// NOTE: ProgressView intentionally keeps its own richer variant (radius 16,
// gradient background, larger corner glow, bigger type). Do not fold that one in
// here without reproducing those styles exactly — it renders on the main page.
export function StatCard({ icon, short, count, avg, color, active, onClick, avgMax }) {
  const [hov, setHov] = useState(false);
  const avgMatch = typeof avg === "string" ? avg.match(/(\d+(?:\.\d+)?)/) : null;
  const avgNum = avgMatch ? parseFloat(avgMatch[1]) : null;
  const progressPct = avgNum != null ? (avgMax ? (avgNum / avgMax) * 100 : avgNum) : null;

  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        padding: "14px 14px 12px", borderRadius: 14, textAlign: "left", cursor: "pointer",
        border: active ? `1.5px solid ${color}40` : `1px solid ${hov ? P.border : P.borderSubtle}`,
        background: active ? `${color}08` : hov ? "#fafbfa" : P.surface,
        transform: (active || hov) ? "translateY(-2px)" : "none",
        boxShadow: active ? `0 6px 20px ${color}14` : hov ? P.shadow : "none",
        transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)", position: "relative", overflow: "hidden",
      }}>
      {active && <div style={{ position: "absolute", top: -20, right: -20, width: 50, height: 50, borderRadius: "50%", background: `${color}12`, filter: "blur(14px)", pointerEvents: "none" }} />}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, position: "relative" }}>
        <span style={{ fontSize: 11, fontWeight: 650, color: active ? color : P.textSec }}>{short}</span>
        <span style={{ width: 24, height: 24, borderRadius: 8, background: `${color}10`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: active ? color : P.text, lineHeight: 1, letterSpacing: "-0.03em", marginBottom: progressPct != null ? 8 : 2, position: "relative" }}>{count}</div>
      {progressPct != null && (
        <div>
          <div style={{ height: 3, borderRadius: 2, background: `${color}12`, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 2, width: `${Math.min(progressPct, 100)}%`, background: active ? color : `${color}60`, transition: "width 0.5s" }} />
          </div>
          <div style={{ fontSize: 10, color: active ? color : P.textDim, marginTop: 4, fontWeight: 550 }}>{avg}</div>
        </div>
      )}
      {progressPct == null && avg ? <div style={{ fontSize: 10, color: P.textDim, fontWeight: 500, position: "relative" }}>{avg}</div> : null}
    </button>
  );
}
