"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { clearAllSessions, deleteSession, loadHist, SESSION_STORE_EVENTS, setCurrentUser } from "../lib/sessionStore";
import { getSavedCode } from "../lib/AuthContext";
import { buildHistoryEntries, buildHistoryStats } from "../lib/history/viewModel";
import { formatLocalDateTime, translateGrammarPoint } from "../lib/utils";
import { ChevronIcon, FONT } from "./shared/ui";
import { HistoryRow } from "./history/HistoryRow";
import { WritingFeedbackPanel } from "./writing/WritingFeedbackPanel";

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
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const clampedVal = Math.min(Math.max(Number(value) || 0, 0), max);
  const strokeDashoffset = circumference - (clampedVal / max) * circumference;
  return (
    <div style={{ position: "relative", width: 84, height: 84, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width="84" height="84" style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx="42" cy="42" r={radius} stroke={P.borderSubtle} strokeWidth="7" fill="transparent" />
        <circle cx="42" cy="42" r={radius} stroke={color} strokeWidth="7" fill="transparent"
          strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 22, fontWeight: 900, color: P.text, lineHeight: 1 }}>{clampedVal.toFixed(1)}</span>
      </div>
    </div>
  );
}

// — Trend chart —

function TrendChart({ bs, email, discussion }) {
  const [hidden, setHidden] = useState({ bs: false, email: false, discussion: false });
  const [tooltip, setTooltip] = useState(null);
  const svgRef = useRef(null);
  const W = 440, H = 156, ML = 30, MT = 10, MR = 10, MB = 24;
  const cW = W - ML - MR, cH = H - MT - MB;
  const emailVal = (s) => Number.isFinite(s.score) ? s.score : null;
  const bsVal = (s) => { const t = Number(s.total || 0), c = Number(s.correct || 0); return t > 0 ? (c / t) * 5 : null; };
  const lines = [
    { key: "email", label: "邮件写作", color: P.teal, pts: aggregateByDay(email, emailVal) },
    { key: "discussion", label: "学术讨论", color: P.indigo, pts: aggregateByDay(discussion, emailVal) },
    { key: "bs", label: "拼句练习", color: P.amber, pts: aggregateByDay(bs, bsVal) },
  ];
  const allPts = lines.flatMap((l) => l.pts);
  if (!allPts.length) return <div style={{ padding: "18px", fontSize: 12, color: P.textDim, textAlign: "center" }}>暂无趋势数据。</div>;
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
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {lines.map((l) => (
          <button key={l.key} onClick={() => setHidden((prev) => ({ ...prev, [l.key]: !prev[l.key] }))}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid " + (hidden[l.key] ? P.border : l.color), background: hidden[l.key] ? P.surface : `${l.color}12`, color: hidden[l.key] ? P.textDim : l.color, borderRadius: 999, padding: "3px 8px", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: hidden[l.key] ? P.border : l.color }} />{l.label}
          </button>
        ))}
      </div>
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
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 10, cursor: "pointer", textAlign: "left", background: selected ? P.primarySoft : P.surface, border: `1.5px solid ${selected ? `${P.primary}40` : P.borderSubtle}`, transform: hov && !selected ? "translateY(-1px)" : "none", boxShadow: hov && !selected ? P.shadowMd : "none", transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)" }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: selected ? 700 : 600, color: selected ? P.primaryDeep : P.text }}>{weakness}</div>
        <div style={{ fontSize: 10, color: selected ? P.primary : P.textDim, marginTop: 1 }}>出现 {count} 次</div>
      </div>
    </button>
  );
}

// — Overview: stat card —

function StatCard({ icon, short, count, avg, color, active, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ padding: "14px 12px", borderRadius: 12, textAlign: "left", cursor: "pointer", border: `1.5px solid ${active ? `${color}55` : P.borderSubtle}`, background: active ? `${color}06` : P.surface, transform: (active || hov) ? "translateY(-2px)" : "none", boxShadow: (active || hov) ? P.shadowMd : "none", transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)" }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 6 }}>{icon} {short}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: P.text, lineHeight: 1.1 }}>{count}</div>
      {avg ? <div style={{ fontSize: 10.5, color: P.textDim, marginTop: 3 }}>{avg}</div> : null}
    </button>
  );
}

// — Overview: session row —

function SessionRow({ entry, expanded, onToggle, onDelete, typeAvgs, isActive, onSelect }) {
  const s = entry.session;
  const m = TYPE[s.type] || TYPE.email;
  const isWriting = s.type === "email" || s.type === "discussion";
  let scoreStr, pct;
  if (s.type === "bs") {
    const t = Number(s.total || 0), c = Number(s.correct || 0);
    scoreStr = t > 0 ? `${c}/${t}` : "--";
    pct = t > 0 ? c / t : 0;
  } else {
    scoreStr = Number.isFinite(s.score) ? `${s.score}/5` : "--";
    pct = Number.isFinite(s.score) ? s.score / 5 : 0;
  }
  const scoreColor = pct >= 0.8 ? P.primary : pct >= 0.6 ? P.amber : P.rose;
  const weaknesses = getWeaknesses(s);

  function handleClick() {
    if (isWriting && onSelect) onSelect(isActive ? null : entry.sourceIndex);
    else onToggle();
  }

  return (
    <div style={{ borderBottom: `1px solid ${P.borderSubtle}`, borderLeft: isActive ? `3px solid ${m.color}` : "3px solid transparent", transition: "border-color 0.2s" }}>
      <button
        onClick={handleClick}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 10px", background: isActive ? `${m.color}06` : "none", border: "none", cursor: "pointer", transition: "background 0.15s" }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = P.bg; }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
      >
        <div style={{ width: 30, height: 30, borderRadius: 8, background: m.soft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{m.icon}</div>
        <div style={{ flex: 1, textAlign: "left" }}>
          <div style={{ fontSize: 13, fontWeight: isActive ? 700 : 640, color: P.text }}>{m.label}</div>
          <div style={{ fontSize: 11, color: P.textDim, marginTop: 1 }}>{formatLocalDateTime(s.date)}</div>
        </div>
        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 720, color: scoreColor }}>{scoreStr}</span>
        {isWriting
          ? <span style={{ fontSize: 18, fontWeight: 400, color: isActive ? m.color : P.border, transition: "color 0.2s, transform 0.2s", display: "inline-block", transform: isActive ? "rotate(45deg)" : "none" }}>+</span>
          : <ChevronIcon open={expanded} color={P.textDim} />}
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

function levelToCategory(level) {
  if (level === "red") return "语法错误";
  if (level === "orange") return "表达建议";
  return "拔高建议";
}

function segmentsToTokens(segments) {
  return segments.map((seg, idx) => {
    if (seg.type !== "mark") return { id: `t${idx}`, type: "normal", text: seg.text };
    return { id: `err${idx}`, type: "error", level: seg.level, category: levelToCategory(seg.level), text: seg.text, suggestion: seg.fix || "", note: seg.note || "" };
  });
}

function FullMockReport({ entry, onClose }) {
  const s = entry.session;
  const [primaryTab, setPrimaryTab] = useState(MOCK_IDS.EMAIL);
  const [secondaryTab, setSecondaryTab] = useState("macro");
  const [activeErrorId, setActiveErrorId] = useState(null);
  const leftPanelRef = useRef(null);

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
    const band = Number.isFinite(Number(feedback?.band)) ? Number(feedback.band) : null;
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
              {band != null ? <span style={{ padding: "3px 10px", background: "rgba(52,211,153,0.15)", color: "#34d399", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>Band {band}</span> : null}
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
    entries.filter((e) => e.session.type !== "mock").sort((a, b) => new Date(b.session.date) - new Date(a.session.date)),
    [entries]
  );

  const bs = stats.byType.bs;
  const email = stats.byType.email;
  const discussion = stats.byType.discussion;

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
      <div style={{ background: "rgba(255,255,255,0.92)", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, borderBottom: `1px solid ${P.borderSubtle}`, backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 100, animation: "fadeUp 0.4s cubic-bezier(0.25,1,0.5,1) 0ms both" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: "linear-gradient(135deg,#087355,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "#fff", fontSize: 12, fontWeight: 800 }}>T</span>
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, color: P.text }}>TOEFL Writing</span>
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
        <div style={{ maxWidth: 1520, margin: "0 auto", padding: "24px 24px 60px", display: "flex", gap: 24, alignItems: "flex-start" }}>

          {/* Left sidebar */}
          <div style={{ width: 320, flexShrink: 0, position: "sticky", top: 68, animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 60ms both" }}>
            <div style={{ marginBottom: 16 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: P.text, marginBottom: 4 }}>练习记录</h1>
              <p style={{ fontSize: 11, color: P.textDim }}>点击模考条目，在右侧展开详情报告</p>
            </div>
            <CompactMockList
              mockEntries={mockEntries}
              activeSrcIdx={activeMockSrcIdx}
              onSelect={(idx) => { setActiveMockSrcIdx(idx); setSelectedWeak(null); }}
            />
            {topWeaknesses.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: P.textSec, marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                  <span>🔍</span> 薄弱点分析
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

                {/* Collapsible stats section */}
                <div style={{ background: P.surface, borderRadius: 16, border: `1px solid ${P.border}`, overflow: "hidden", marginBottom: 16, boxShadow: P.shadow }}>
                  <button
                    onClick={() => setShowStats(v => !v)}
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", background: "none", border: "none", cursor: "pointer", borderBottom: showStats ? `1px solid ${P.borderSubtle}` : "none", transition: "border-color 0.2s" }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: P.text }}>📊 数据概览</span>
                    <ChevronIcon open={showStats} color={P.textDim} />
                  </button>
                  <div style={{ maxHeight: showStats ? "500px" : "0px", overflow: "hidden", transition: "max-height 0.45s cubic-bezier(0.16,1,0.3,1)" }}>
                    <div style={{ display: "flex", borderTop: `1px solid ${P.borderSubtle}` }}>
                      {/* Left: latest mock score ring */}
                      <div style={{ width: "32%", flexShrink: 0, padding: "24px 20px", background: "#fafbfa", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", position: "relative", borderRight: `1px solid ${P.borderSubtle}` }}>
                        <div style={{ position: "absolute", top: 12, left: 16, fontSize: 10, fontWeight: 700, color: P.textDim, textTransform: "uppercase", letterSpacing: "0.08em" }}>最新模考</div>
                        {mockEntries.length > 0 ? (() => {
                          const lm = mockEntries[0].session;
                          const bc = Number.isFinite(lm.band) ? getBandColor(lm.band) : P.textDim;
                          return (
                            <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 10 }}>
                              <CircularProgress value={Number.isFinite(lm.band) ? lm.band : 0} max={5} color={bc} />
                              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                                {lm.cefr && <Tag color={P.textSec} style={{ fontSize: 11, fontWeight: 700, border: `1px solid ${P.border}`, background: P.bg }}>CEFR {lm.cefr}</Tag>}
                                <Tag color={P.primary} bg={P.primarySoft} style={{ border: `1px solid ${P.primary}22`, fontSize: 11, fontWeight: 700 }}>换算 {lm.scaledScore ?? "--"}/30</Tag>
                                <Tag color={P.textDim} style={{ fontSize: 10.5, background: "transparent" }}>{new Date(lm.date).toLocaleDateString("zh-CN")}</Tag>
                              </div>
                            </div>
                          );
                        })() : (
                          <div style={{ fontSize: 12, color: P.textDim, marginTop: 10 }}>暂无模考数据</div>
                        )}
                      </div>
                      {/* Right: trend chart */}
                      <div style={{ flex: 1, minWidth: 0, padding: "16px 20px 18px" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: P.text, marginBottom: 10 }}>📈 进步趋势</div>
                        {(bs.length > 0 || email.length > 0 || discussion.length > 0) ? (
                          <TrendChart bs={bs} email={email} discussion={discussion} />
                        ) : (
                          <div style={{ padding: "28px 0", textAlign: "center", fontSize: 12, color: P.textDim }}>完成练习后，这里会显示你的进步曲线。</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stat cards — always visible, filter both chart and session list */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16, animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 200ms both" }}>
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

                {/* Session list */}
                <div style={{ background: P.surface, borderRadius: 14, border: `1px solid ${P.border}`, overflow: "hidden", boxShadow: P.shadow, animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 280ms both" }}>
                  <div style={{ padding: "12px 16px", background: P.bg, borderBottom: `1px solid ${P.borderSubtle}`, fontSize: 13, fontWeight: 700, color: P.text }}>
                    日常练习明细 ({filteredPractice.length})
                  </div>
                  <div style={{ padding: "8px 14px 14px" }}>
                    {filteredPractice.length === 0 ? (
                      <div style={{ padding: "24px 0", textAlign: "center", fontSize: 12, color: P.textDim }}>
                        {selectedWeak ? `没有包含「${selectedWeak}」薄弱点的记录。` : "当前筛选下暂无练习记录。"}
                      </div>
                    ) : filteredPractice.map((entry) => {
                      const isExpanded = activePracticeSrcIdx === entry.sourceIndex;
                      const s = entry.session;
                      const isWritingEntry = s.type === "email" || s.type === "discussion";
                      const fb = s.details?.feedback || null;
                      const pd = s.details?.promptData || null;
                      const userText = s.details?.userText || "";
                      const promptId = String(s.details?.promptId || pd?.id || "").trim();
                      const retryHref = promptId ? `/${s.type === "email" ? "email-writing" : "academic-writing"}?retryPromptId=${promptId}` : null;
                      const mc = TYPE[s.type]?.color || P.border;
                      return (
                        <React.Fragment key={entry.sourceIndex}>
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
                    })}
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
