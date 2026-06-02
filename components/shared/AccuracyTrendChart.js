"use client";
import React from "react";
import { NEUTRAL as P } from "./ui";
import { formatMonthDayFromDateKey } from "../../lib/history/scoreMetrics";

// Single-line trend chart shared by the Listening / Reading / Speaking progress
// views. The SVG body below was byte-identical across the three; only the data
// (filter + score accessor) and the Y axis differed. Each caller computes `pts`
// itself and passes the axis config, so the genuinely per-skill logic stays put.
//   pts:        [{ ts, avg, date }] from buildDailyAveragePoints
//   ticks:      Y gridline values, e.g. [0, 50, 100] (accuracy) or [0, 2.5, 5] (score)
//   maxValue:   top of the Y scale (100 for %, 5 or 6 for score/band)
//   tickSuffix: appended to each tick label ("%" for accuracy, "" for scores)
export function AccuracyTrendChart({ pts, accentColor, ticks, maxValue, tickSuffix = "" }) {
  if (pts.length < 2) return <div style={{ padding: "16px 0", textAlign: "center", fontSize: 11, color: P.textDim }}>练习 2 天以上后显示趋势</div>;

  const W = 400, H = 120, ML = 30, MR = 10, MT = 10, MB = 22;
  const cW = W - ML - MR, cH = H - MT - MB;
  const minTs = Math.min(...pts.map(p => p.ts)), maxTs = Math.max(...pts.map(p => p.ts));
  const span = maxTs - minTs || 864e5;
  const toX = ts => ML + ((ts - minTs) / span) * cW;
  const toY = v => MT + (1 - v / maxValue) * cH;

  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.ts).toFixed(1)},${toY(p.avg).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {ticks.map(y => (
        <g key={y}>
          <line x1={ML} y1={toY(y)} x2={ML + cW} y2={toY(y)} stroke="#edf2ef" strokeWidth={1} strokeDasharray="3,3" />
          <text x={ML - 4} y={toY(y) + 3} fontSize={8} fill={P.textDim} textAnchor="end">{y}{tickSuffix}</text>
        </g>
      ))}
      <path d={pathD} fill="none" stroke={accentColor} strokeWidth={2} strokeLinecap="round" />
      {pts.map((p, i) => <circle key={i} cx={toX(p.ts).toFixed(1)} cy={toY(p.avg).toFixed(1)} r={3} fill="#fff" stroke={accentColor} strokeWidth={1.5} />)}
      {pts.length > 0 && (() => {
        const dates = [pts[0], pts[pts.length - 1]];
        return dates.map((p, i) => {
          return <text key={i} x={toX(p.ts)} y={H - 4} fontSize={8} fill={P.textDim} textAnchor={i === 0 ? "start" : "end"}>{formatMonthDayFromDateKey(p.date)}</text>;
        });
      })()}
    </svg>
  );
}
