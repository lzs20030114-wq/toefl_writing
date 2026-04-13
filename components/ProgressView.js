"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { clearAllSessions, deleteSession, loadHist, SESSION_STORE_EVENTS, setCurrentUser } from "../lib/sessionStore";
import { getSavedCode } from "../lib/AuthContext";
import { buildHistoryEntries, buildHistoryStats } from "../lib/history/viewModel";
import { formatLocalDateTime, translateGrammarPoint } from "../lib/utils";
import { ChevronIcon, FONT } from "./shared/ui";
import { HistoryRow } from "./history/HistoryRow";
import { useBsAiExplain, BsAiExplainBlock } from "./buildSentence/useBsAiExplain";
import { WritingFeedbackPanel } from "./writing/WritingFeedbackPanel";
import { useIsMobile } from "../hooks/useIsMobile";
import MobileProgressView from "./history/MobileProgressView";

// — Extended color palette —
const P = {
  bg: "#f4f7f5", surface: "#ffffff", border: "#dde5df", borderSubtle: "#ebf0ed",
  text: "#1a2420", textSec: "#5a6b62", textDim: "#94a39a",
  primary: "#0d9668", primaryDeep: "#087355", primarySoft: "#ecfdf5",
  teal: "#0891B2", tealSoft: "#ecfeff",
  amber: "#d97706", amberSoft: "#fffbeb",
  indigo: "#6366F1", indigoSoft: "#eef2ff",
  rose: "#E11D48", roseSoft: "#fff1f2",
  purple: "#7C3AED", purpleSoft: "#f5f3ff",
  shadow: "0 1px 3px rgba(10,40,25,0.04), 0 1px 2px rgba(10,40,25,0.02)",
  shadowMd: "0 4px 14px rgba(10,40,25,0.06), 0 1px 3px rgba(10,40,25,0.03)",
  shadowLg: "0 10px 40px rgba(10,40,25,0.08), 0 2px 10px rgba(10,40,25,0.04)",
};

const TYPE = {
  bs: { label: "拼句练习", short: "拼句", color: P.amber, soft: P.amberSoft, icon: "🧩" },
  email: { label: "邮件写作", short: "邮件", color: P.teal, soft: P.tealSoft, icon: "📧" },
  discussion: { label: "学术讨论", short: "讨论", color: P.indigo, soft: P.indigoSoft, icon: "💬" },
  mock: { label: "模考", short: "模考", color: P.purple, soft: P.purpleSoft, icon: "🎯" },
};

const MOCK_IDS = { BUILD: "build-sentence", EMAIL: "email-writing", DISC: "academic-writing" };

// — Helpers —

function getBandColor(band) {
  if (band >= 5.5) return "#16a34a";
  if (band >= 4.5) return "#2563eb";
  if (band >= 3.5) return "#d97706";
  if (band >= 2.5) return "#ea580c";
  return "#dc2626";
}

function getWeaknesses(session) {
  const fb = session?.details?.feedback;
  if (!fb) return [];
  if (Array.isArray(fb.weaknesses) && fb.weaknesses.length > 0) {
    return fb.weaknesses.map((w) => String(w || "").split(":")[0].trim()).filter(Boolean);
  }
  if (Array.isArray(fb.patterns)) {
    return fb.patterns.filter((p) => Number(p?.count || 0) > 0).map((p) => String(p.tag || "").trim()).filter(Boolean);
  }
  return [];
}

function smoothPath(points) {
  if (!points || points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}

function aggregateByDay(sessions, getValue) {
  const map = {};
  sessions.forEach((session) => {
    const date = new Date(session.date);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (!map[key]) map[key] = { date: key, ts: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(), values: [] };
    const value = getValue(session);
    if (value !== null && Number.isFinite(value)) map[key].values.push(value);
  });
  return Object.values(map)
    .filter((item) => item.values.length > 0)
    .map((item) => ({ date: item.date, ts: item.ts, avg: item.values.reduce((s, v) => s + v, 0) / item.values.length }))
    .sort((a, b) => a.ts - b.ts);
}

function getBuildAvgPercent(sessions) {
  let valid = 0, sum = 0;
  sessions.forEach((s) => {
    const total = Number(s.total || 0), correct = Number(s.correct || 0);
    if (total > 0) { sum += (correct / total) * 100; valid++; }
  });
  return valid > 0 ? sum / valid : null;
}

function getWritingAvg(sessions) {
  const values = sessions.map((s) => Number(s.score)).filter((v) => Number.isFinite(v));
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// — Shared small components —

function Tag({ children, color, bg, style }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, color: color || P.textSec, background: bg || `${color || P.textSec}18`, lineHeight: "18px", whiteSpace: "nowrap", ...style }}>
      {children}
    </span>
  );
}

// — Circular progress ring —

function CircularProgress({ value, max = 5, color = P.amber }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const clampedVal = Math.min(Math.max(Number(value) || 0, 0), max);
  const strokeDashoffset = circumference - (clampedVal / max) * circumference;
  return (
    <div style={{ position: "relative", width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width="64" height="64" style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx="32" cy="32" r={radius} stroke={P.borderSubtle} strokeWidth="6" fill="transparent" />
        <circle cx="32" cy="32" r={radius} stroke={color} strokeWidth="6" fill="transparent"
          strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 17, fontWeight: 900, color: P.text, lineHeight: 1 }}>{clampedVal.toFixed(1)}</span>
      </div>
    </div>
  );
}

// — Trend chart —

function formatRangeLabel(days) {
  if (days <= 0) return "全部";
  if (days < 30) return `近 ${days} 天`;
  if (days < 365) return `近 ${Math.round(days / 30)} 个月`;
  return `近 ${(days / 365).toFixed(1)} 年`;
}

function TrendChart({ bs, email, discussion, filter }) {
  const [hidden, setHidden] = useState({ bs: false, email: false, discussion: false });
  // sliderVal: 0 = show all, 100 = show only last day
  const [sliderVal, setSliderVal] = useState(0);

  useEffect(() => {
    if (!filter || filter === "all" || filter === "mock") {
      setHidden({ bs: false, email: false, discussion: false });
    } else {
      setHidden({ bs: filter !== "bs", email: filter !== "email", discussion: filter !== "discussion" });
    }
  }, [filter]);
  const [tooltip, setTooltip] = useState(null);
  const svgRef = useRef(null);
  const W = 440, H = 156, ML = 30, MT = 10, MR = 10, MB = 24;
  const cW = W - ML - MR, cH = H - MT - MB;
  const emailVal = (s) => Number.isFinite(s.score) ? s.score : null;
  const bsVal = (s) => { const t = Number(s.total || 0), c = Number(s.correct || 0); return t > 0 ? (c / t) * 5 : null; };

  const rawLines = [
    { key: "email", label: "邮件写作", color: P.teal, pts: aggregateByDay(email, emailVal) },
    { key: "discussion", label: "学术讨论", color: P.indigo, pts: aggregateByDay(discussion, emailVal) },
    { key: "bs", label: "拼句练习", color: P.amber, pts: aggregateByDay(bs, bsVal) },
  ];

  // Compute the full time span, then derive cutoff from slider
  const allRawPts = rawLines.flatMap((l) => l.pts);
  const globalMin = allRawPts.length ? Math.min(...allRawPts.map((p) => p.ts)) : Date.now();
  const globalMax = allRawPts.length ? Math.max(...allRawPts.map((p) => p.ts)) : Date.now();
  const totalSpan = globalMax - globalMin || 864e5;
  // slider 0 → cutoff = globalMin (show all), slider 100 → cutoff = globalMax (show ~1 day)
  const cutoff = sliderVal > 0 ? globalMin + (sliderVal / 100) * totalSpan : 0;
  const cutoffDays = cutoff > 0 ? Math.round((Date.now() - cutoff) / 864e5) : 0;

  const lines = rawLines.map((l) => ({
    ...l,
    pts: cutoff > 0 ? l.pts.filter((p) => p.ts >= cutoff) : l.pts,
  }));

  const allPts = lines.flatMap((l) => l.pts);
  if (!allPts.length) return (
    <div style={{ padding: "18px", textAlign: "center" }}>
      <div style={{ fontSize: 12, color: P.textDim, marginBottom: 8 }}>该范围内暂无数据</div>
      {sliderVal > 0 && (
        <button onClick={() => setSliderVal(0)} style={{ fontSize: 11, color: P.primary, background: "none", border: "none", cursor: "pointer", fontWeight: 600, textDecoration: "underline" }}>
          重置为全部
        </button>
      )}
    </div>
  );

  const minTs = Math.min(...allPts.map((p) => p.ts));
  const maxTs = Math.max(...allPts.map((p) => p.ts));
  const span = maxTs - minTs || 864e5;
  const toX = (ts) => ML + ((ts - minTs) / span) * cW;
  const toY = (v) => MT + (1 - v / 5) * cH;
  const yGrid = [0, 1, 2, 3, 4, 5];
  const allDates = [...new Set(allPts.map((p) => p.date))].sort();
  const shownDates = allDates.length <= 5 ? allDates : [allDates[0], allDates[Math.floor(allDates.length / 2)], allDates[allDates.length - 1]];

  function handleMouseMove(e) {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const svgX = (px / rect.width) * W;
    let bestDist = 18, bestTs = null;
    lines.forEach((l) => {
      if (hidden[l.key]) return;
      l.pts.forEach((p) => { const d = Math.abs(toX(p.ts) - svgX); if (d < bestDist) { bestDist = d; bestTs = p.ts; } });
    });
    if (bestTs === null) { setTooltip(null); return; }
    const near = lines.filter((l) => !hidden[l.key]).flatMap((l) => l.pts.filter((p) => p.ts === bestTs).map((p) => ({ key: l.key, label: l.label, color: l.color, avg: p.avg, date: p.date })));
    setTooltip({ left: px > rect.width * 0.6 ? px - 140 : px + 16, top: 8, svgX: toX(bestTs), near });
  }

  return (
    <div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {lines.map((l) => (
          <button key={l.key} onClick={() => setHidden((prev) => ({ ...prev, [l.key]: !prev[l.key] }))}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid " + (hidden[l.key] ? P.border : l.color), background: hidden[l.key] ? P.surface : `${l.color}12`, color: hidden[l.key] ? P.textDim : l.color, borderRadius: 999, padding: "3px 8px", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: hidden[l.key] ? P.border : l.color }} />{l.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div style={{ position: "relative" }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }} onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>
          {yGrid.map((y) => (
            <g key={y}>
              <line x1={ML} y1={toY(y)} x2={ML + cW} y2={toY(y)} stroke={y === 0 ? P.border : "#edf2ef"} strokeWidth={1} strokeDasharray={y === 0 ? "none" : "3,3"} />
              <text x={ML - 5} y={toY(y) + 3.5} fontSize={9} fill={P.textDim} textAnchor="end">{y}</text>
            </g>
          ))}
          <line x1={ML} y1={MT} x2={ML} y2={MT + cH} stroke={P.border} strokeWidth={1} />
          {shownDates.map((date) => {
            const p = allPts.find((item) => item.date === date);
            if (!p) return null;
            const [, month, day] = date.split("-");
            return <text key={date} x={toX(p.ts)} y={H - 4} fontSize={9} fill={P.textDim} textAnchor="middle">{month}/{day}</text>;
          })}
          {tooltip ? <rect x={tooltip.svgX - 16} y={MT} width={32} height={cH} fill={P.primarySoft} opacity={0.65} rx={4} /> : null}
          {lines.map((l) => {
            if (hidden[l.key] || !l.pts.length) return null;
            const coords = l.pts.map((p) => ({ x: toX(p.ts), y: toY(p.avg) }));
            return (
              <g key={l.key}>
                {l.pts.length > 1 ? <path d={smoothPath(coords)} fill="none" stroke={l.color} strokeWidth={2} strokeLinecap="round" /> : null}
                {coords.map((p, i) => <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r={l.pts.length === 1 ? 5 : 3.5} fill="#fff" stroke={l.color} strokeWidth={1.5} />)}
              </g>
            );
          })}
          {tooltip ? <line x1={tooltip.svgX} y1={MT} x2={tooltip.svgX} y2={MT + cH} stroke={P.primary} strokeWidth={1} strokeDasharray="2,2" opacity={0.45} /> : null}
        </svg>
        {tooltip && tooltip.near.length ? (
          <div style={{ position: "absolute", left: tooltip.left, top: tooltip.top, background: "#fff", border: "1px solid " + P.border, borderRadius: 12, padding: "6px 9px", fontSize: 10.5, pointerEvents: "none", zIndex: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.08)", minWidth: 108 }}>
            <div style={{ fontSize: 10, color: P.textDim, marginBottom: 6, fontWeight: 700 }}>{tooltip.near[0].date}</div>
            {tooltip.near.map((item) => (
              <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: item.color }} />
                <span style={{ color: item.color, fontWeight: 700 }}>{item.label}</span>
                <span style={{ color: P.text }}>{item.avg.toFixed(1)}/5</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Time range slider */}
      {allRawPts.length > 1 && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, color: P.textDim, whiteSpace: "nowrap", minWidth: 52 }}>
            {sliderVal === 0 ? "全部" : formatRangeLabel(cutoffDays)}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={sliderVal}
            onChange={(e) => setSliderVal(Number(e.target.value))}
            style={{ flex: 1, height: 3, accentColor: P.primary, cursor: "pointer" }}
          />
          <span style={{ fontSize: 10, color: P.textDim, whiteSpace: "nowrap", minWidth: 30, textAlign: "right" }}>
            {allPts.length} 条
          </span>
        </div>
      )}
    </div>
  );
}

// — Left panel: compact mock list —

function CompactMockList({ mockEntries, activeSrcIdx, onSelect }) {
  const [isExpanded, setIsExpanded] = useState(true);
  return (
    <div style={{ background: P.surface, borderRadius: 12, border: `1px solid ${P.border}`, overflow: "hidden", marginBottom: 16 }}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ width: "100%", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", background: P.bg, border: "none", borderBottom: isExpanded ? `1px solid ${P.borderSubtle}` : "none", cursor: "pointer", transition: "background 0.15s" }}
        onMouseEnter={(e) => e.currentTarget.style.background = P.borderSubtle}
        onMouseLeave={(e) => e.currentTarget.style.background = P.bg}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: P.text }}>🎯 模考记录 ({mockEntries.length})</span>
        <span style={{ fontSize: 11, color: P.textDim }}>{isExpanded ? "收起" : "展开"}</span>
      </button>
      {isExpanded && (
        <div style={{ maxHeight: 270, overflowY: "auto", display: "flex", flexDirection: "column", animation: "expandDown 0.35s cubic-bezier(0.16,1,0.3,1)" }}>
          {mockEntries.length === 0 ? (
            <div style={{ padding: "16px", textAlign: "center", fontSize: 12, color: P.textDim }}>暂无模考记录。</div>
          ) : mockEntries.map((entry, i) => {
            const s = entry.session;
            const isActive = activeSrcIdx === entry.sourceIndex;
            const bc = Number.isFinite(s.band) ? getBandColor(s.band) : P.textDim;
            const bandStr = Number.isFinite(s.band) ? s.band.toFixed(1) : "--";
            return (
              <button
                key={entry.sourceIndex}
                onClick={() => onSelect(isActive ? null : entry.sourceIndex)}
                style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, background: isActive ? `${bc}08` : "transparent", border: "none", borderLeft: `3px solid ${isActive ? bc : "transparent"}`, borderBottom: i < mockEntries.length - 1 ? `1px solid ${P.borderSubtle}` : "none", cursor: "pointer", textAlign: "left", transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)" }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = `${P.textDim}08`; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ width: 34, height: 34, borderRadius: 8, background: isActive ? P.surface : P.bg, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${isActive ? `${bc}30` : P.borderSubtle}`, flexShrink: 0, transition: "all 0.25s", transform: isActive ? "scale(1.05)" : "scale(1)" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: bc }}>{bandStr}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: isActive ? 700 : 600, color: P.text }}>{new Date(s.date).toLocaleDateString("zh-CN")}</div>
                  <div style={{ fontSize: 10.5, color: P.textDim, marginTop: 1 }}>
                    {s.cefr ? `${s.cefr} · ` : ""}换算 {s.scaledScore ?? "--"}/30
                  </div>
                </div>
                <span style={{ fontSize: 16, color: isActive ? bc : P.border, opacity: isActive ? 1 : 0, transition: "opacity 0.25s, color 0.25s" }}>→</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// — Left panel: weakness filter card —

function WeaknessCard({ weakness, count, selected, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px", borderRadius: 10, cursor: "pointer", textAlign: "left",
        background: selected ? P.primarySoft : hov ? "#f8faf9" : P.surface,
        border: `1.5px solid ${selected ? `${P.primary}40` : hov ? P.border : P.borderSubtle}`,
        transform: hov && !selected ? "translateY(-1px)" : "none",
        boxShadow: hov && !selected ? "0 2px 8px rgba(0,0,0,0.04)" : "none",
        transition: "all 0.2s ease",
      }}
    >
      {/* Left accent dot */}
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: selected ? P.primary : P.amber, flexShrink: 0, opacity: selected ? 1 : 0.5 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: selected ? 700 : 550, color: selected ? P.primaryDeep : P.text, lineHeight: 1.3 }}>{weakness}</div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: selected ? P.primary : P.textDim, background: selected ? `${P.primary}12` : `${P.textDim}10`, padding: "2px 8px", borderRadius: 999, flexShrink: 0 }}>{count}次</span>
    </button>
  );
}

// — Overview: stat card —

function StatCard({ icon, short, count, avg, color, active, onClick }) {
  const [hov, setHov] = useState(false);
  // Parse avg percentage for micro-progress bar
  const avgMatch = typeof avg === "string" ? avg.match(/(\d+(?:\.\d+)?)/) : null;
  const avgNum = avgMatch ? parseFloat(avgMatch[1]) : null;
  // Normalize: if "/5" format, scale to 100; if "%" format, use directly
  const progressPct = avg && avg.includes("/5") && avgNum != null ? (avgNum / 5) * 100
    : avg && avg.includes("%") && avgNum != null ? avgNum : null;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: "16px 16px 14px", borderRadius: 16, textAlign: "left", cursor: "pointer",
        border: active ? `1.5px solid ${color}40` : `1px solid ${hov ? P.border : P.borderSubtle}`,
        background: active
          ? `linear-gradient(135deg, ${color}08 0%, ${color}03 100%)`
          : hov ? "#fafbfa" : P.surface,
        transform: (active || hov) ? "translateY(-2px)" : "none",
        boxShadow: active
          ? `0 8px 24px ${color}14, inset 0 1px 0 ${color}10`
          : hov ? "0 4px 12px rgba(10,40,25,0.06)" : "none",
        transition: "all 0.3s cubic-bezier(0.16,1,0.3,1)",
        position: "relative", overflow: "hidden",
      }}
    >
      {/* Decorative corner glow */}
      {active && <div style={{ position: "absolute", top: -20, right: -20, width: 60, height: 60, borderRadius: "50%", background: `${color}12`, filter: "blur(16px)", pointerEvents: "none" }} />}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, position: "relative" }}>
        <span style={{ fontSize: 11.5, fontWeight: 650, color: active ? color : P.textSec, letterSpacing: "0.01em" }}>{short}</span>
        <span style={{
          width: 26, height: 26, borderRadius: 9,
          background: active ? `${color}18` : `${color}0C`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12.5, transition: "background 0.2s",
        }}>{icon}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: active ? color : P.text, lineHeight: 1, letterSpacing: "-0.03em", marginBottom: progressPct != null ? 10 : 4, position: "relative" }}>{count}</div>

      {/* Micro progress bar */}
      {progressPct != null && (
        <div style={{ position: "relative" }}>
          <div style={{ height: 4, borderRadius: 2, background: `${color}12`, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 2, width: `${Math.min(progressPct, 100)}%`, background: active ? color : `${color}60`, transition: "width 0.6s cubic-bezier(0.16,1,0.3,1)" }} />
          </div>
          <div style={{ fontSize: 10, color: active ? color : P.textDim, marginTop: 5, fontWeight: 550 }}>{avg}</div>
        </div>
      )}
      {progressPct == null && avg ? <div style={{ fontSize: 10, color: P.textDim, fontWeight: 500, position: "relative" }}>{avg}</div> : null}
    </button>
  );
}

// — Overview: session row —

function SessionRow({ entry, expanded, onToggle, onDelete, typeAvgs, isActive, onSelect }) {
  const s = entry.session;
  const m = TYPE[s.type] || TYPE.email;
  const isWriting = s.type === "email" || s.type === "discussion";
  let scoreStr, pct, bandStr;
  if (s.type === "bs") {
    const t = Number(s.total || 0), c = Number(s.correct || 0);
    scoreStr = t > 0 ? `${c}/${t}` : "--";
    pct = t > 0 ? c / t : 0;
    bandStr = Number.isFinite(s.band) ? s.band.toFixed(1) : null;
  } else {
    scoreStr = Number.isFinite(s.score) ? `${s.score}/5` : "--";
    pct = Number.isFinite(s.score) ? s.score / 5 : 0;
    bandStr = null;
  }
  const scoreColor = pct >= 0.8 ? P.primary : pct >= 0.6 ? P.amber : P.rose;
  const weaknesses = getWeaknesses(s);

  function handleClick() {
    if (isWriting && onSelect) onSelect(isActive ? null : entry.sourceIndex);
    else onToggle();
  }

  return (
    <div style={{ transition: "all 0.2s" }}>
      <button
        onClick={handleClick}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 14,
          padding: "14px 18px",
          background: isActive ? `${m.color}06` : "none",
          border: "none", cursor: "pointer", transition: "all 0.2s ease",
          borderRadius: 12, margin: "2px 0",
        }}
        onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = "#f6f8f7"; e.currentTarget.style.transform = "translateX(2px)"; } }}
        onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.transform = "none"; } }}
      >
        {/* Icon with color strip */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 11,
            background: `linear-gradient(135deg, ${m.color}14 0%, ${m.color}08 100%)`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
          }}>{m.icon}</div>
          {isActive && <div style={{ position: "absolute", left: -8, top: 8, bottom: 8, width: 3, borderRadius: 2, background: m.color }} />}
        </div>
        {/* Label + date */}
        <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: isActive ? 700 : 580, color: P.text, lineHeight: 1.3 }}>{m.label}</div>
          <div style={{ fontSize: 11, color: P.textDim, marginTop: 3, fontVariantNumeric: "tabular-nums", letterSpacing: "0.01em" }}>{formatLocalDateTime(s.date)}</div>
        </div>
        {/* Score pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{
            fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 750, color: scoreColor,
            background: `${scoreColor}0C`, padding: "4px 12px", borderRadius: 10,
            letterSpacing: "-0.01em",
          }}>{scoreStr}</span>
          {bandStr && <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: `${scoreColor}0C`, color: scoreColor, letterSpacing: "0.02em" }}>Band {bandStr}</span>}
        </div>
        <ChevronIcon open={isWriting ? isActive : expanded} color={P.textDim} />
        <span
          role="button"
          tabIndex={0}
          title="删除记录"
          onClick={(e) => { e.stopPropagation(); if (onDelete) onDelete(entry.sourceIndex); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); if (onDelete) onDelete(entry.sourceIndex); } }}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 6, color: P.textDim, cursor: "pointer", transition: "all 0.15s", marginLeft: 2, flexShrink: 0 }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#dc2626"; e.currentTarget.style.background = "#dc262612"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = P.textDim; e.currentTarget.style.background = "transparent"; }}
        >
          <svg viewBox="0 0 16 16" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 4.5h11M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M6.5 7v4.5M9.5 7v4.5M3.5 4.5l.5 8.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l.5-8.5" />
          </svg>
        </span>
      </button>
      {!isWriting && expanded && (
        <div style={{ padding: "0 10px 12px", animation: "expandDown 0.35s cubic-bezier(0.16,1,0.3,1)" }}>
          {weaknesses.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
              {weaknesses.map((w, i) => <Tag key={i} color={P.amber} bg={P.amberSoft}>{w}</Tag>)}
            </div>
          )}
          <HistoryRow entry={entry} isExpanded={true} isLast={true} onToggle={() => {}} onDelete={onDelete} typeAvgs={typeAvgs} detailOnly={true} />
        </div>
      )}
    </div>
  );
}

// — Full mock report panel —

function levelToCategory(level, errorType) {
  if (level === "red") {
    if (String(errorType || "").toLowerCase() === "spelling") return "拼写错误";
    return "语法错误";
  }
  if (level === "orange") return "表达建议";
  return "拔高建议";
}

function segmentsToTokens(segments) {
  return segments.map((seg, idx) => {
    if (seg.type !== "mark") return { id: `t${idx}`, type: "normal", text: seg.text };
    return { id: `err${idx}`, type: "error", level: seg.level, errorType: seg.errorType || "", category: levelToCategory(seg.level, seg.errorType), text: seg.text, suggestion: seg.fix || "", note: seg.note || "" };
  });
}

function FullMockReport({ entry, onClose }) {
  const s = entry.session;
  const [primaryTab, setPrimaryTab] = useState(MOCK_IDS.EMAIL);
  const [secondaryTab, setSecondaryTab] = useState("macro");
  const [activeErrorId, setActiveErrorId] = useState(null);
  const leftPanelRef = useRef(null);
  const progressBsAi = useBsAiExplain();

  // Close tooltip on outside click
  useEffect(() => {
    function handleOutside(e) {
      if (!e.target.closest("[data-error-token]")) setActiveErrorId(null);
    }
    document.addEventListener("click", handleOutside);
    return () => document.removeEventListener("click", handleOutside);
  }, []);

  const tasks = Array.isArray(s?.details?.tasks) ? s.details.tasks : [];
  const byId = useMemo(() => {
    const m = {};
    tasks.forEach((t) => { if (t?.taskId) m[t.taskId] = t; });
    return m;
  }, [tasks]);

  const emailTask = byId[MOCK_IDS.EMAIL] || null;
  const discTask = byId[MOCK_IDS.DISC] || null;
  const bsTask = byId[MOCK_IDS.BUILD] || null;
  const bsDetails = Array.isArray(bsTask?.meta?.details) ? bsTask.meta.details : [];
  const bsCorrect = bsDetails.filter((d) => d?.isCorrect).length;

  const bc = Number.isFinite(s.band) ? getBandColor(s.band) : P.textDim;
  const bandStr = Number.isFinite(s.band) ? s.band.toFixed(1) : "--";

  const primaryTabs = [
    { key: MOCK_IDS.EMAIL, label: "邮件写作", score: emailTask ? `${emailTask.score ?? "--"}/${emailTask.maxScore}` : "--", color: P.teal },
    { key: MOCK_IDS.DISC, label: "学术讨论", score: discTask ? `${discTask.score ?? "--"}/${discTask.maxScore}` : "--", color: P.indigo },
    { key: MOCK_IDS.BUILD, label: "拼句练习", score: `${bsCorrect}/${bsDetails.length}`, color: P.amber },
  ];

  function switchPrimary(tab) {
    setPrimaryTab(tab);
    setSecondaryTab("macro");
    setActiveErrorId(null);
  }

  // — BS tab —
  function renderBs() {
    if (bsDetails.length === 0) return <div style={{ padding: "48px 28px", textAlign: "center", color: P.textDim, fontSize: 13 }}>暂无拼句详情数据。</div>;
    const correct = bsDetails.filter((d) => d?.isCorrect).length;
    return (
      <div style={{ padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ background: "#0f2318", borderRadius: 12, padding: "14px 20px", display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 32, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{correct}</span>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>/ {bsDetails.length} 题正确</span>
          </div>
          <div style={{ fontSize: 13, color: P.textSec }}>正确率 {bsDetails.length > 0 ? Math.round((correct / bsDetails.length) * 100) : 0}%</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
          {bsDetails.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "12px 14px", background: P.surface, borderRadius: 10, border: `1px solid ${P.borderSubtle}`, borderLeft: `3px solid ${d.isCorrect ? P.primary : P.rose}` }}>
              <span style={{ color: d.isCorrect ? P.primary : P.rose, fontWeight: 800, fontSize: 15, flexShrink: 0, marginTop: 1 }}>{d.isCorrect ? "✓" : "✗"}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: P.text, marginBottom: 4, wordBreak: "break-word", lineHeight: 1.5 }}>{d.correctAnswer || d.prompt || `第 ${i + 1} 题`}</div>
                {!d.isCorrect && d.userAnswer ? <div style={{ fontSize: 11, color: P.rose, marginBottom: 5 }}>你的答案：{d.userAnswer}</div> : null}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {(Array.isArray(d.grammar_points) ? d.grammar_points : []).map((g, gi) => (
                    <Tag key={gi} color={P.teal} bg={P.tealSoft}>{translateGrammarPoint(g)}</Tag>
                  ))}
                </div>
                <BsAiExplainBlock explainKey={`pv-${i}`} detail={d} aiExplains={progressBsAi.aiExplains} isLegacy={progressBsAi.isLegacy} handleAiExplain={progressBsAi.handleAiExplain} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // — Writing tab: 45/55 two-panel —
  function renderWriting(task) {
    if (!task) return <div style={{ padding: "48px 0", textAlign: "center", color: P.textDim, fontSize: 13 }}>暂无数据。</div>;
    const response = task?.meta?.response || null;
    const feedback = task?.meta?.feedback || null;
    const reportType = task?.taskId === MOCK_IDS.EMAIL ? "email" : "discussion";

    const promptText = response?.promptData?.summary
      || response?.promptData?.body
      || response?.promptData?.instructions
      || task?.meta?.promptSummary
      || null;
    const userText = response?.userText || null;

    const score = Number.isFinite(Number(feedback?.score)) ? Number(feedback.score) : null;
    const band = feedback?.band != null ? String(feedback.band) : null;
    const summary = String(feedback?.summary || "").trim();
    const goals = Array.isArray(feedback?.goals) ? feedback.goals : [];
    const actions = Array.isArray(feedback?.actions) ? feedback.actions : [];
    const patterns = Array.isArray(feedback?.patterns) ? feedback.patterns : [];
    const marks = Array.isArray(feedback?.annotationSegments) ? feedback.annotationSegments : [];
    const comparison = feedback?.comparison || { modelEssay: "", points: [] };

    const tokens = segmentsToTokens(marks);
    const errorTokens = tokens.filter((t) => t.type === "error");

    const WRITING_TABS = [
      { id: "macro", label: "宏观评价与建议" },
      { id: "linebyline", label: "逐句批注大纲" },
      { id: "sample", label: "范文对比分析" },
    ];

    // Right panel renderers
    function renderMacro() {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Score card */}
          <div style={{ background: "#0f2318", borderRadius: 16, padding: "22px 24px", color: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                <span style={{ fontSize: 48, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{score ?? "--"}</span>
                <span style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", fontWeight: 700, marginBottom: 8 }}>/ 5</span>
              </div>
              {band != null ? <span style={{ padding: "3px 10px", background: "rgba(52,211,153,0.15)", color: "#34d399", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{band}</span> : null}
            </div>
            {summary ? <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.75, margin: 0, marginBottom: goals.length ? 18 : 0 }}>{summary}</p> : null}
            {reportType === "email" && goals.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {goals.map((g) => {
                  const statusMap = {
                    OK: { label: "已达成", color: "#4ade80", bg: "rgba(74,222,128,0.15)" },
                    PARTIAL: { label: "部分达成", color: "#fb923c", bg: "rgba(251,146,60,0.15)" },
                    MISSING: { label: "未覆盖", color: "#f87171", bg: "rgba(248,113,113,0.15)" },
                  };
                  const ui = statusMap[String(g.status || "").toUpperCase()] || statusMap.PARTIAL;
                  return (
                    <div key={g.index} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 999, background: ui.bg, color: ui.color, fontSize: 10, fontWeight: 800, whiteSpace: "nowrap", flexShrink: 0 }}>{ui.label}</span>
                      <span style={{ fontSize: 12, lineHeight: 1.6, color: "rgba(255,255,255,0.82)" }}>目标 {g.index}：{g.reason || "无说明"}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* Action suggestions */}
          {actions.length > 0 ? (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>✨ 结构与语域优化建议</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {actions.map((a, i) => (
                  <div key={i} style={{ background: P.surface, borderRadius: 12, border: `1px solid ${P.borderSubtle}`, borderLeft: `4px solid ${i === 0 ? P.rose : P.amber}`, padding: "14px 16px" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: P.text, marginBottom: 10 }}>{a.title || `短板 ${i + 1}`}</div>
                    <div style={{ fontSize: 13, color: P.textSec, lineHeight: 1.7, marginBottom: 8 }}>
                      <b style={{ color: P.text, background: P.roseSoft, padding: "0 3px", borderRadius: 3 }}>为什么重要：</b> {a.importance || "未提供"}
                    </div>
                    <div style={{ fontSize: 13, color: P.textSec, lineHeight: 1.7 }}>
                      <b style={{ color: P.primaryDeep, background: P.primarySoft, padding: "0 3px", borderRadius: 3 }}>现在可做的：</b> {a.action || "未提供"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Patterns */}
          {patterns.length > 0 ? (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>🔄 错误规律总结</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[...patterns].sort((a, b) => Number(b?.count || 0) - Number(a?.count || 0)).map((p, i) => (
                  <div key={i} style={{ background: P.surface, borderRadius: 10, border: `1px solid ${P.border}`, padding: "11px 13px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: P.text }}>{p.tag || "未分类"}</span>
                      <span style={{ fontSize: 11, color: P.textDim }}>出现 {Number(p.count || 0)} 次</span>
                    </div>
                    <div style={{ fontSize: 12, color: P.textSec, lineHeight: 1.6 }}>{p.summary || ""}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    function renderLineByLine() {
      if (!errorTokens.length) return (
        <div style={{ padding: "40px", textAlign: "center", color: P.textDim, fontSize: 13, background: P.bg, borderRadius: 12, border: `1px dashed ${P.borderSubtle}` }}>暂无逐句批注数据。</div>
      );
      return (
        <div>
          <p style={{ fontSize: 13, color: P.textSec, marginBottom: 16 }}>
            共发现 <b style={{ color: P.text }}>{errorTokens.length}</b> 处表达问题。点击下方卡片，左侧原文会自动定位并弹出批注详情。
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {errorTokens.map((err) => {
              const isActive = activeErrorId === err.id;
              const catColor = err.level === "red" ? P.rose : err.level === "orange" ? P.amber : P.teal;
              return (
                <button
                  key={err.id}
                  onClick={() => {
                    const next = isActive ? null : err.id;
                    setActiveErrorId(next);
                    if (!isActive) {
                      const el = document.getElementById(`mark-${err.id}`);
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                  }}
                  style={{ width: "100%", textAlign: "left", padding: "14px 16px", borderRadius: 12, border: `1.5px solid ${isActive ? P.amber : P.borderSubtle}`, background: isActive ? P.amberSoft : P.surface, boxShadow: isActive ? `0 0 0 3px ${P.amber}20, ${P.shadowMd}` : P.shadow, transform: isActive ? "scale(1.01)" : "none", transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)", cursor: "pointer" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: `${catColor}15`, color: catColor }}>{err.category}</span>
                    {isActive ? <span style={{ fontSize: 11, fontWeight: 700, color: P.amber }}>正在左侧查看 👀</span> : null}
                  </div>
                  <div style={{ fontSize: 13, color: P.textDim, textDecoration: "line-through", textDecorationColor: P.rose, marginBottom: 6 }}>{err.text}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: P.primary }}>{err.suggestion || "（暂无建议）"}</div>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    function renderSample() {
      const modelEssay = String(comparison.modelEssay || "").trim();
      const points = Array.isArray(comparison.points) ? comparison.points : [];
      if (!modelEssay && !points.length) return <div style={{ padding: "40px 0", textAlign: "center", color: P.textDim, fontSize: 13 }}>暂无范文对比数据。</div>;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {modelEssay ? (
            <div style={{ background: P.primarySoft, borderRadius: 16, padding: "20px 22px", border: `1px solid ${P.primary}25` }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: P.primaryDeep, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 14 }}>Official Band 5.0 Sample</div>
              <div style={{ fontSize: 14, color: "#052e16", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>{modelEssay}</div>
            </div>
          ) : null}
          {points.length > 0 ? (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>⚖️ 核心差异分析</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {points.map((pt, i) => (
                  <div key={i} style={{ background: P.surface, borderRadius: 12, border: `1px solid ${P.border}`, padding: "14px 16px" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 8 }}>{pt.index ? `${pt.index}. ` : ""}{pt.title}</div>
                    {pt.yours ? <div style={{ background: P.bg, borderRadius: 7, padding: "8px 10px", fontSize: 12, marginBottom: 6 }}><b>你的：</b>{pt.yours}</div> : null}
                    {pt.model ? <div style={{ background: P.primarySoft, borderRadius: 7, padding: "8px 10px", fontSize: 12, marginBottom: 6 }}><b>范文：</b>{pt.model}</div> : null}
                    <div style={{ fontSize: 13, color: P.textSec, lineHeight: 1.65 }}><b>差异：</b>{pt.difference || ""}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    // Left panel: inline annotated text with floating tooltip
    function renderTokenizedText() {
      if (!tokens.length) {
        return <div style={{ fontSize: 14, lineHeight: 1.85, color: P.text, whiteSpace: "pre-wrap" }}>{userText || "未保存作答文本。"}</div>;
      }
      return (
        <div style={{ fontSize: 14, lineHeight: 1.9, color: P.text, whiteSpace: "pre-wrap" }}>
          {tokens.map((token) => {
            if (token.type === "normal") return <React.Fragment key={token.id}>{token.text}</React.Fragment>;
            const isActive = activeErrorId === token.id;
            const catColor = token.level === "red" ? P.rose : token.level === "orange" ? P.amber : P.teal;
            const catBg = token.level === "red" ? P.roseSoft : token.level === "orange" ? P.amberSoft : P.tealSoft;
            return (
              <span key={token.id} style={{ position: "relative", display: "inline-block" }} data-error-token="true">
                <button
                  id={`mark-${token.id}`}
                  data-error-token="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = isActive ? null : token.id;
                    setActiveErrorId(next);
                    if (!isActive) setSecondaryTab("linebyline");
                  }}
                  style={{ border: "none", cursor: "pointer", background: isActive ? catBg : `${catColor}18`, color: catColor, borderBottom: `2px solid ${catColor}`, borderRadius: "2px 2px 0 0", padding: "0 2px", margin: "0 1px", font: "inherit", fontSize: 14, lineHeight: "inherit", fontWeight: isActive ? 700 : 400, transition: "all 0.15s" }}
                >
                  {token.text}
                </button>
                {isActive ? (
                  <span
                    data-error-token="true"
                    style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, width: 292, background: P.surface, borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)", border: `1px solid ${P.border}`, zIndex: 50, display: "flex", flexDirection: "column", overflow: "hidden", animation: "tabFade 0.2s ease" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ background: catBg, padding: "8px 12px", borderBottom: `1px solid ${catColor}20`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: catColor, textTransform: "uppercase", letterSpacing: 0.5 }}>{token.category}</span>
                      <button data-error-token="true" onClick={(e) => { e.stopPropagation(); setActiveErrorId(null); }} style={{ background: "none", border: "none", color: P.textDim, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "0 2px" }}>✕</button>
                    </div>
                    <div style={{ padding: "12px 14px" }}>
                      <div style={{ fontSize: 12, color: P.textDim, textDecoration: "line-through", textDecorationColor: P.rose, marginBottom: 6 }}>{token.text}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: P.primary, marginBottom: 10 }}>{token.suggestion || "（暂无建议）"}</div>
                      <div style={{ fontSize: 12, color: P.textSec, lineHeight: 1.65, background: P.bg, padding: "8px 10px", borderRadius: 8, border: `1px solid ${P.borderSubtle}` }}>
                        <b style={{ color: P.text }}>📝 解析：</b>{token.note || "暂无说明"}
                      </div>
                    </div>
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
      );
    }

    const tabContent = { macro: renderMacro, linebyline: renderLineByLine, sample: renderSample };

    return (
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left (45%): scrollable */}
        <div ref={leftPanelRef} style={{ width: "45%", flexShrink: 0, height: "100%", overflowY: "auto", padding: "24px 22px 24px 28px", borderRight: `1px solid ${P.borderSubtle}` }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: P.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "#34d399", flexShrink: 0 }} />
            Your Response
            <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 400, color: P.textDim, textTransform: "none", letterSpacing: 0 }}>💡 点击高亮处查看批注</span>
          </div>
          <div style={{ background: P.surface, borderRadius: 12, padding: "20px 22px", border: `1px solid ${P.border}`, boxShadow: P.shadow, marginBottom: 24 }}>
            {renderTokenizedText()}
          </div>
          {promptText ? (
            <details>
              <summary style={{ fontSize: 11, fontWeight: 700, color: P.textDim, textTransform: "uppercase", letterSpacing: 0.5, cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 6, userSelect: "none" }}>
                <span>▶</span> 展开查看原题目 (The Prompt)
              </summary>
              <div style={{ marginTop: 10, padding: "14px 16px", background: P.bg, borderRadius: 10, border: `1px solid ${P.borderSubtle}`, fontSize: 13, color: P.textSec, lineHeight: 1.7 }}>
                {promptText}
              </div>
            </details>
          ) : null}
        </div>

        {/* Right (55%): fixed tab bar + scrollable content */}
        <div style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", background: P.surface }}>
          <div style={{ flexShrink: 0, padding: "12px 24px", borderBottom: `1px solid ${P.borderSubtle}`, display: "flex", gap: 6 }}>
            {WRITING_TABS.map((t) => {
              const isA = secondaryTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => { setSecondaryTab(t.id); setActiveErrorId(null); }}
                  style={{ padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: isA ? 700 : 500, background: isA ? P.text : "transparent", color: isA ? "#fff" : P.textSec, boxShadow: isA ? "0 2px 8px rgba(0,0,0,0.15)" : "none", transition: "all 0.18s" }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div key={secondaryTab} style={{ flex: 1, overflowY: "auto", padding: "22px 28px 24px 22px", animation: "tabFade 0.3s cubic-bezier(0.16,1,0.3,1)" }}>
            <div>
              {(tabContent[secondaryTab] || tabContent.macro)()}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ animation: "slideInRight 0.5s cubic-bezier(0.16,1,0.3,1)", background: P.surface, borderRadius: 16, border: `1px solid ${P.border}`, boxShadow: P.shadowLg, overflow: "hidden", display: "flex", flexDirection: "column", height: "calc(100vh - 90px)" }}>

      {/* Header */}
      <div style={{ flexShrink: 0, padding: "18px 28px", borderBottom: `1px solid ${P.borderSubtle}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: `${P.bg}90` }}>
        <div>
          <button
            onClick={onClose}
            style={{ fontSize: 12, color: P.textDim, background: "none", border: "none", cursor: "pointer", marginBottom: 10, display: "flex", alignItems: "center", gap: 4, transition: "color 0.15s", padding: 0 }}
            onMouseEnter={(e) => e.currentTarget.style.color = P.text}
            onMouseLeave={(e) => e.currentTarget.style.color = P.textDim}
          >
            ← 收起详情，返回大盘
          </button>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 19, fontWeight: 800, color: P.text, margin: 0, letterSpacing: "-0.3px" }}>写作详细诊断报告</h2>
            <span style={{ fontSize: 12, color: P.textDim }}>{formatLocalDateTime(s.date)}</span>
          </div>
          <div style={{ marginTop: 5, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {s.cefr ? <Tag color={P.purple} bg={P.purpleSoft}>CEFR {s.cefr}</Tag> : null}
            {s.scaledScore != null ? <Tag color={P.textSec}>换算分 {s.scaledScore}/30</Tag> : null}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: P.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Overall Band</div>
          <div style={{ fontSize: 34, fontWeight: 800, color: bc, lineHeight: 1 }}>{bandStr}</div>
        </div>
      </div>

      {/* Primary tabs */}
      <div style={{ flexShrink: 0, padding: "0 28px", display: "flex", gap: 24, borderBottom: `1px solid ${P.borderSubtle}`, background: P.surface }}>
        {primaryTabs.map((t) => {
          const isA = primaryTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => switchPrimary(t.key)}
              style={{ padding: "13px 0", background: "none", border: "none", borderBottom: `2.5px solid ${isA ? t.color : "transparent"}`, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, transition: "border-color 0.2s, opacity 0.2s", opacity: isA ? 1 : 0.55 }}
            >
              <span style={{ fontSize: 13, fontWeight: isA ? 700 : 500, color: isA ? P.text : P.textSec }}>{t.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: isA ? `${t.color}18` : P.bg, color: isA ? t.color : P.textDim, transition: "all 0.2s" }}>{t.score}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div key={primaryTab} style={{ flex: 1, overflow: "hidden", display: "flex", animation: "tabFade 0.3s cubic-bezier(0.16,1,0.3,1)", background: "#fafafa" }}>
        {primaryTab === MOCK_IDS.BUILD
          ? <div style={{ flex: 1, overflowY: "auto" }}>{renderBs()}</div>
          : primaryTab === MOCK_IDS.EMAIL
            ? renderWriting(emailTask)
            : renderWriting(discTask)}
      </div>
    </div>
  );
}

// — Main component —

export function ProgressView({ onBack }) {
  const isMobile = useIsMobile();
  const [hist, setHist] = useState(null);
  const [activeMockSrcIdx, setActiveMockSrcIdx] = useState(null);
  const [activePracticeSrcIdx, setActivePracticeSrcIdx] = useState(null);
  const [filter, setFilter] = useState("all");
  const [selectedWeak, setSelectedWeak] = useState(null);
  const [expandedSrcIdx, setExpandedSrcIdx] = useState(null);
  const [showStats, setShowStats] = useState(true);

  useEffect(() => {
    // Re-initialize user context in case this page was loaded directly (e.g. refresh),
    // bypassing the home page where setCurrentUser is normally called.
    setCurrentUser(getSavedCode());
    const refresh = () => setHist(loadHist());
    refresh();
    window.addEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // Linkage: expanding a writing detail auto-collapses the chart panel
  useEffect(() => {
    setShowStats(activePracticeSrcIdx === null);
  }, [activePracticeSrcIdx]);

  const entries = useMemo(() => buildHistoryEntries(hist), [hist]);
  const stats = useMemo(() => buildHistoryStats(entries), [entries]);

  const mockEntries = useMemo(() =>
    entries.filter((e) => e.session.type === "mock").sort((a, b) => new Date(b.session.date) - new Date(a.session.date)),
    [entries]
  );
  const practiceEntries = useMemo(() =>
    entries.filter((e) => e.session.type !== "mock" && e.session.type !== "reading").sort((a, b) => new Date(b.session.date) - new Date(a.session.date)),
    [entries]
  );

  const bs = stats.byType.bs;
  const email = stats.byType.email;
  const discussion = stats.byType.discussion;
  // reading has its own dedicated page at /reading/progress — not shown here

  const weaknessMap = useMemo(() => {
    const map = {};
    [...email, ...discussion].forEach((s) => {
      getWeaknesses(s).forEach((w) => { map[w] = (map[w] || 0) + 1; });
    });
    return map;
  }, [email, discussion]);
  const topWeaknesses = Object.entries(weaknessMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const typeAvgs = useMemo(() => ({
    bs: getBuildAvgPercent(bs),
    email: getWritingAvg(email),
    discussion: getWritingAvg(discussion),
  }), [bs, email, discussion]);

  const activeMockEntry = mockEntries.find((e) => e.sourceIndex === activeMockSrcIdx) || null;

  const filteredPractice = useMemo(() => {
    let list = practiceEntries;
    if (filter !== "all") list = list.filter((e) => e.session.type === filter);
    if (selectedWeak) list = list.filter((e) => getWeaknesses(e.session).includes(selectedWeak));
    return list;
  }, [practiceEntries, filter, selectedWeak]);

  useEffect(() => {
    if (!hist || !stats.hasPendingMock) return;
    const timer = setInterval(() => setHist(loadHist()), 3000);
    return () => clearInterval(timer);
  }, [hist, stats.hasPendingMock]);

  function handleDelete(sourceIndex) {
    if (!window.confirm("删除这条记录？")) return;
    setHist({ ...deleteSession(sourceIndex) });
  }

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  function handleClearAll() {
    setShowClearConfirm(true);
  }

  function confirmClearAll() {
    setShowClearConfirm(false);
    setHist({ ...clearAllSessions() });
  }

  const buildAvg = getBuildAvgPercent(bs);
  const emailAvg = getWritingAvg(email);
  const discussionAvg = getWritingAvg(discussion);

  const statItems = [
    { key: "all", icon: "📊", short: "全部", count: practiceEntries.length, color: P.primary, avg: "" },
    { key: "bs", ...TYPE.bs, count: bs.length, avg: buildAvg !== null ? `平均 ${Math.round(buildAvg)}%` : "暂无数据" },
    { key: "email", ...TYPE.email, count: email.length, avg: emailAvg !== null ? `平均 ${emailAvg.toFixed(1)}/5` : "暂无数据" },
    { key: "discussion", ...TYPE.discussion, count: discussion.length, avg: discussionAvg !== null ? `平均 ${discussionAvg.toFixed(1)}/5` : "暂无数据" },
  ];

  if (isMobile) {
    return (
      <MobileProgressView vm={{
        entries, mockEntries, practiceEntries, filteredPractice,
        filter, setFilter, selectedWeak, setSelectedWeak,
        activeMockSrcIdx, setActiveMockSrcIdx,
        activePracticeSrcIdx, setActivePracticeSrcIdx,
        expandedSrcIdx, setExpandedSrcIdx,
        statItems, typeAvgs, topWeaknesses,
        handleDelete, onBack,
        showClearConfirm, setShowClearConfirm, confirmClearAll,
      }} />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: P.bg, fontFamily: FONT }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; }
        button { font-family: inherit; }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(24px) scale(0.99); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-16px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes expandDown {
          from { opacity: 0; transform: translateY(-6px) scaleY(0.97); transform-origin: top; }
          to { opacity: 1; transform: translateY(0) scaleY(1); transform-origin: top; }
        }
        @keyframes tabFade {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Top bar */}
      <div style={{ background: "rgba(255,255,255,0.85)", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 54, borderBottom: `1px solid ${P.borderSubtle}`, backdropFilter: "blur(16px) saturate(1.4)", WebkitBackdropFilter: "blur(16px) saturate(1.4)", position: "sticky", top: 0, zIndex: 100, animation: "fadeUp 0.4s cubic-bezier(0.25,1,0.3,1) 0ms both" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: "linear-gradient(135deg,#087355,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "#fff", fontSize: 12, fontWeight: 800 }}>T</span>
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, color: P.text }}>TreePractice</span>
          <span style={{ opacity: 0.3 }}>|</span>
          <span style={{ fontSize: 12, color: P.textSec }}>练习记录</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onBack} style={{ background: P.surface, border: `1px solid ${P.border}`, color: P.textSec, padding: "7px 12px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>返回</button>
        </div>
      </div>

      {!hist ? (
        <div style={{ maxWidth: 1520, margin: "0 auto", padding: "32px" }}>
          <div style={{ background: P.surface, borderRadius: 14, border: `1px solid ${P.border}`, padding: 32, textAlign: "center", color: P.textDim, fontSize: 13 }}>加载中…</div>
        </div>
      ) : entries.length === 0 ? (
        <div style={{ maxWidth: 1520, margin: "0 auto", padding: "32px" }}>
          <div style={{ background: P.surface, borderRadius: 14, border: `1px solid ${P.border}`, padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 8 }}>还没有练习记录</div>
            <div style={{ fontSize: 12, color: P.textDim }}>从主页开始一次练习后，这里会自动记录你的成绩、反馈与历史详情。</div>
          </div>
        </div>
      ) : (
        <div className="tp-progress-layout" style={{ maxWidth: 1520, margin: "0 auto", padding: "24px 24px 60px", display: "flex", gap: 24, alignItems: "flex-start" }}>

          {/* Left sidebar */}
          <div className="tp-progress-sidebar" style={{ width: 320, flexShrink: 0, position: "sticky", top: 68, animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 60ms both" }}>
            <div style={{ marginBottom: 24 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: P.text, marginBottom: 6, letterSpacing: "-0.03em", lineHeight: 1.2 }}>练习记录</h1>
              <p style={{ fontSize: 12, color: P.textDim, lineHeight: 1.6 }}>点击模考条目查看详情报告</p>
            </div>
            {/* Latest mock score — integrated into sidebar */}
            {mockEntries.length > 0 && (() => {
              const lm = mockEntries[0].session;
              const bc = Number.isFinite(lm.band) ? getBandColor(lm.band) : P.textDim;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: `linear-gradient(135deg, ${P.primarySoft} 0%, #f0fdf8 100%)`, borderRadius: 14, border: `1px solid ${P.primary}15`, marginBottom: 16 }}>
                  <CircularProgress value={Number.isFinite(lm.band) ? lm.band : 0} max={5} color={bc} />
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: P.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>最新模考</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {lm.cefr && <Tag color={P.textSec} style={{ fontSize: 10, fontWeight: 700, border: `1px solid ${P.border}`, background: P.bg }}>CEFR {lm.cefr}</Tag>}
                      <Tag color={P.primary} bg={P.primarySoft} style={{ border: `1px solid ${P.primary}22`, fontSize: 10, fontWeight: 700 }}>{lm.scaledScore ?? "--"}/30</Tag>
                      <span style={{ fontSize: 10, color: P.textDim }}>{new Date(lm.date).toLocaleDateString("zh-CN")}</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            <CompactMockList
              mockEntries={mockEntries}
              activeSrcIdx={activeMockSrcIdx}
              onSelect={(idx) => { setActiveMockSrcIdx(idx); setSelectedWeak(null); }}
            />
            {topWeaknesses.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: P.textSec, marginBottom: 10, display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={P.textSec} strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  薄弱点分析
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {topWeaknesses.map(([w, count]) => (
                    <WeaknessCard
                      key={w}
                      weakness={w}
                      count={count}
                      selected={selectedWeak === w}
                      onClick={() => { setSelectedWeak(selectedWeak === w ? null : w); setActiveMockSrcIdx(null); }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right content */}
          <div style={{ flex: 1, minWidth: 0, animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 120ms both" }}>
            {activeMockEntry ? (
              <FullMockReport key={activeMockEntry.sourceIndex} entry={activeMockEntry} onClose={() => setActiveMockSrcIdx(null)} />
            ) : (
              <div key="overview" style={{ animation: "slideInLeft 0.4s cubic-bezier(0.16,1,0.3,1)" }}>

                {/* 1. Stats row: stat cards (left) + mini trend chart (right) */}
                <div className="tp-stats-row" style={{ display: "flex", gap: 14, marginBottom: 16, animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 80ms both", alignItems: "stretch" }}>
                  {/* Stat cards — 2x2 grid */}
                  <div className="tp-stat-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flex: "0 0 52%" }}>
                    {statItems.map((item) => (
                      <StatCard
                        key={item.key}
                        icon={item.icon}
                        short={item.short}
                        count={item.count}
                        avg={item.avg}
                        color={item.color}
                        active={filter === item.key}
                        onClick={() => { setFilter(item.key); setSelectedWeak(null); }}
                      />
                    ))}
                  </div>
                  {/* Mini trend chart — compact companion */}
                  {(bs.length > 0 || email.length > 0 || discussion.length > 0) && (
                    <div style={{ flex: 1, minWidth: 0, padding: "14px 16px 10px", background: P.surface, borderRadius: 16, border: `1px solid ${P.borderSubtle}`, display: "flex", flexDirection: "column" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: P.textSec, marginBottom: 6, letterSpacing: "-0.01em" }}>进步趋势</div>
                      <div style={{ flex: 1, minHeight: 0 }}>
                        <TrendChart bs={bs} email={email} discussion={discussion} filter={filter} />
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Session list — with date grouping */}
                <div style={{ background: P.surface, borderRadius: 18, border: `1px solid ${P.borderSubtle}`, overflow: "hidden", boxShadow: "0 1px 4px rgba(10,40,25,0.03)", animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 280ms both" }}>
                  <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 14, fontWeight: 750, color: P.text, letterSpacing: "-0.02em" }}>练习明细</span>
                    <span style={{ fontSize: 11, color: P.textDim, fontWeight: 550, background: `${P.primary}08`, color: P.primary, padding: "3px 10px", borderRadius: 999 }}>{filteredPractice.length} 条记录</span>
                  </div>
                  <div style={{ padding: "4px 14px 14px" }}>
                    {filteredPractice.length === 0 ? (
                      <div style={{ padding: "24px 0", textAlign: "center", fontSize: 12, color: P.textDim }}>
                        {selectedWeak ? `没有包含「${selectedWeak}」薄弱点的记录。` : "当前筛选下暂无练习记录。"}
                      </div>
                    ) : (() => {
                      let lastDateLabel = "";
                      return filteredPractice.map((entry) => {
                        const s = entry.session;
                        const d = new Date(s.date);
                        const today = new Date();
                        const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
                        const isToday = d.toDateString() === today.toDateString();
                        const isYesterday = d.toDateString() === yesterday.toDateString();
                        const dateLabel = isToday ? "今天" : isYesterday ? "昨天" : `${d.getMonth() + 1}月${d.getDate()}日`;
                        const showDateHeader = dateLabel !== lastDateLabel;
                        lastDateLabel = dateLabel;

                        const isExpanded = activePracticeSrcIdx === entry.sourceIndex;
                        const isWritingEntry = s.type === "email" || s.type === "discussion";
                        const fb = s.details?.feedback || null;
                        const pd = s.details?.promptData || null;
                        const userText = s.details?.userText || "";
                        const promptId = String(s.details?.promptId || pd?.id || "").trim();
                        const retryHref = promptId ? `/${s.type === "email" ? "email-writing" : "academic-writing"}?retryPromptId=${promptId}` : null;
                        const mc = TYPE[s.type]?.color || P.border;
                        return (
                          <React.Fragment key={entry.sourceIndex}>
                            {showDateHeader && (
                              <div style={{ padding: "12px 6px 5px", fontSize: 11, fontWeight: 650, color: P.textDim, letterSpacing: "0.02em", borderTop: entry === filteredPractice[0] ? "none" : `1px solid ${P.borderSubtle}`, marginTop: entry === filteredPractice[0] ? 0 : 6 }}>
                                {dateLabel}
                              </div>
                            )}
                            <SessionRow
                              entry={entry}
                              expanded={expandedSrcIdx === entry.sourceIndex}
                              isActive={isExpanded}
                              onToggle={() => setExpandedSrcIdx(expandedSrcIdx === entry.sourceIndex ? null : entry.sourceIndex)}
                              onSelect={(idx) => { setActivePracticeSrcIdx(idx); setActiveMockSrcIdx(null); setSelectedWeak(null); }}
                              onDelete={handleDelete}
                              typeAvgs={typeAvgs}
                            />
                            {isWritingEntry && (
                              <div style={{ maxHeight: isExpanded ? "760px" : "0px", overflow: "hidden", transition: "max-height 0.45s cubic-bezier(0.16,1,0.3,1)", borderLeft: isExpanded ? `3px solid ${mc}` : "none" }}>
                                <WritingFeedbackPanel
                                  key={entry.sourceIndex}
                                  fb={fb}
                                  type={s.type}
                                  pd={pd}
                                  userText={userText}
                                  containerHeight="720px"
                                  onRetry={retryHref ? () => { window.location.href = retryHref; } : null}
                                  onNext={null}
                                  onExit={() => setActivePracticeSrcIdx(null)}
                                />
                              </div>
                            )}
                          </React.Fragment>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* Danger zone at bottom */}
      {hist && entries.length > 0 && (
        <div style={{ maxWidth: 1520, margin: "0 auto", padding: "0 32px 40px", display: "flex", justifyContent: "center" }}>
          <button
            onClick={handleClearAll}
            style={{ background: "none", border: `1px solid ${P.borderSubtle}`, color: P.textDim, padding: "8px 18px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "all 0.2s" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#dc2626"; e.currentTarget.style.color = "#dc2626"; e.currentTarget.style.background = "#fef2f2"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = P.borderSubtle; e.currentTarget.style.color = P.textDim; e.currentTarget.style.background = "none"; }}
          >
            清除全部记录
          </button>
        </div>
      )}

      {/* Clear all confirm modal */}
      {showClearConfirm && (
        <div
          onClick={() => setShowClearConfirm(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeUp 0.2s cubic-bezier(0.25,1,0.5,1) both" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: P.surface, borderRadius: 16, padding: "28px 28px 24px", width: 320, boxShadow: P.shadowLg, display: "flex", flexDirection: "column", gap: 16 }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: P.text }}>清除全部记录？</div>
              <div style={{ fontSize: 13, color: P.textSec, lineHeight: 1.6 }}>所有练习记录和模考数据将被永久删除，无法恢复。</div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowClearConfirm(false)}
                style={{ padding: "8px 18px", borderRadius: 9, border: `1px solid ${P.border}`, background: P.surface, color: P.textSec, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                取消
              </button>
              <button
                onClick={confirmClearAll}
                style={{ padding: "8px 18px", borderRadius: 9, border: "none", background: "#dc2626", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                确认清除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
