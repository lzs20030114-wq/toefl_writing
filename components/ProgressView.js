"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { clearAllSessions, deleteSession, loadHist, SESSION_STORE_EVENTS } from "../lib/sessionStore";
import { buildHistoryEntries, buildHistoryStats } from "../lib/history/viewModel";
import { formatLocalDateTime, translateGrammarPoint } from "../lib/utils";
import { ChevronIcon, FONT } from "./shared/ui";
import { ScoringReport } from "./writing/ScoringReport";
import { HistoryRow } from "./history/HistoryRow";

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
        <div style={{ display: "flex", flexDirection: "column", animation: "expandDown 0.35s cubic-bezier(0.16,1,0.3,1)" }}>
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

function SessionRow({ entry, expanded, onToggle, onDelete, typeAvgs }) {
  const s = entry.session;
  const m = TYPE[s.type] || TYPE.email;
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

  return (
    <div style={{ borderBottom: `1px solid ${P.borderSubtle}` }}>
      <button
        onClick={onToggle}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 10px", background: "none", border: "none", cursor: "pointer", transition: "background 0.15s" }}
        onMouseEnter={(e) => e.currentTarget.style.background = P.bg}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
      >
        <div style={{ width: 30, height: 30, borderRadius: 8, background: m.soft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{m.icon}</div>
        <div style={{ flex: 1, textAlign: "left" }}>
          <div style={{ fontSize: 13, fontWeight: 640, color: P.text }}>{m.label}</div>
          <div style={{ fontSize: 11, color: P.textDim, marginTop: 1 }}>{formatLocalDateTime(s.date)}</div>
        </div>
        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 720, color: scoreColor }}>{scoreStr}</span>
        <ChevronIcon open={expanded} color={P.textDim} />
      </button>
      {expanded && (
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

function FullMockReport({ entry, onClose }) {
  const s = entry.session;
  const [activeTab, setActiveTab] = useState(MOCK_IDS.EMAIL);

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

  const tabs = [
    { key: MOCK_IDS.EMAIL, label: "邮件写作", score: emailTask ? `${emailTask.score ?? "--"}/${emailTask.maxScore}` : "--", color: P.teal },
    { key: MOCK_IDS.DISC, label: "学术讨论", score: discTask ? `${discTask.score ?? "--"}/${discTask.maxScore}` : "--", color: P.indigo },
    { key: MOCK_IDS.BUILD, label: "拼句练习", score: `${bsCorrect}/${bsDetails.length}`, color: P.amber },
  ];

  function renderBs() {
    if (bsDetails.length === 0) {
      return <div style={{ padding: "40px 0", textAlign: "center", color: P.textDim, fontSize: 13 }}>暂无拼句详情数据。</div>;
    }
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
        {bsDetails.map((d, i) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: 12, background: P.bg, borderRadius: 10, border: `1px solid ${P.borderSubtle}` }}>
            <span style={{ color: d.isCorrect ? P.primary : P.rose, fontWeight: 800, fontSize: 15, flexShrink: 0 }}>{d.isCorrect ? "✓" : "✗"}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: P.text, marginBottom: 4, wordBreak: "break-word" }}>{d.correctAnswer || d.prompt || `第 ${i + 1} 题`}</div>
              {!d.isCorrect && d.userAnswer ? <div style={{ fontSize: 11, color: P.rose, marginBottom: 4 }}>你的答案：{d.userAnswer}</div> : null}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {(Array.isArray(d.grammar_points) ? d.grammar_points : []).map((g, gi) => (
                  <Tag key={gi} color={P.teal} bg={P.tealSoft}>{translateGrammarPoint(g)}</Tag>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderWriting(task) {
    if (!task) return <div style={{ padding: "40px 0", textAlign: "center", color: P.textDim, fontSize: 13 }}>暂无数据。</div>;
    const response = task?.meta?.response || null;
    const feedback = task?.meta?.feedback || null;
    const reportType = task?.taskId === MOCK_IDS.EMAIL ? "email" : "discussion";
    return (
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "3 1 320px", background: P.bg, borderRadius: 12, padding: 18, border: `1px solid ${P.borderSubtle}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: P.textDim, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Your Response</div>
          {response?.userText ? (
            <div style={{ fontSize: 13, lineHeight: 1.8, color: P.text, whiteSpace: "pre-wrap" }}>{response.userText}</div>
          ) : (
            <div style={{ fontSize: 12, color: P.textDim, fontStyle: "italic" }}>未保存作答文本。</div>
          )}
        </div>
        <div style={{ flex: "2 1 240px" }}>
          {feedback ? (
            <ScoringReport result={feedback} type={reportType} uiLang={feedback?.reportLanguage || "zh"} />
          ) : (
            <div style={{ padding: "24px", textAlign: "center", color: P.textDim, fontSize: 13, background: P.bg, borderRadius: 12, border: `1px solid ${P.borderSubtle}` }}>暂无 AI 反馈。</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ animation: "slideInRight 0.5s cubic-bezier(0.16,1,0.3,1)", background: P.surface, borderRadius: 16, border: `1px solid ${P.border}`, boxShadow: P.shadowLg, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "20px 28px", borderBottom: `1px solid ${P.borderSubtle}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
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
            <h2 style={{ fontSize: 20, fontWeight: 800, color: P.text, margin: 0 }}>模考详细报告</h2>
            <span style={{ fontSize: 12, color: P.textDim }}>{formatLocalDateTime(s.date)}</span>
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {s.cefr ? <Tag color={P.purple} bg={P.purpleSoft}>CEFR {s.cefr}</Tag> : null}
            {s.scaledScore != null ? <Tag color={P.textSec}>换算分 {s.scaledScore}/30</Tag> : null}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: P.textDim, marginBottom: 4 }}>Overall Band</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: bc, lineHeight: 1 }}>{bandStr}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ padding: "0 28px", display: "flex", gap: 20, borderBottom: `1px solid ${P.borderSubtle}`, background: P.bg }}>
        {tabs.map((t) => {
          const isA = activeTab === t.key;
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{ padding: "14px 0", background: "none", border: "none", borderBottom: `3px solid ${isA ? t.color : "transparent"}`, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, transition: "border-color 0.25s" }}>
              <span style={{ fontSize: 13, fontWeight: isA ? 700 : 500, color: isA ? P.text : P.textSec }}>{t.label}</span>
              <Tag color={isA ? t.color : P.textDim}>{t.score}</Tag>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div key={activeTab} style={{ padding: 28, animation: "tabFade 0.35s cubic-bezier(0.16,1,0.3,1)", flex: 1, minHeight: 400, overflowY: "auto" }}>
        {activeTab === MOCK_IDS.BUILD ? renderBs() : activeTab === MOCK_IDS.EMAIL ? renderWriting(emailTask) : renderWriting(discTask)}
      </div>
    </div>
  );
}

// — Main component —

export function ProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
  const [activeMockSrcIdx, setActiveMockSrcIdx] = useState(null);
  const [filter, setFilter] = useState("all");
  const [selectedWeak, setSelectedWeak] = useState(null);
  const [expandedSrcIdx, setExpandedSrcIdx] = useState(null);

  useEffect(() => {
    const refresh = () => setHist(loadHist());
    refresh();
    window.addEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

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

  function handleClearAll() {
    if (!window.confirm("删除全部练习记录？")) return;
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
      `}</style>

      {/* Top bar */}
      <div style={{ background: "rgba(255,255,255,0.92)", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, borderBottom: `1px solid ${P.borderSubtle}`, backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: "linear-gradient(135deg,#087355,#0891B2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "#fff", fontSize: 12, fontWeight: 800 }}>T</span>
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, color: P.text }}>TOEFL Writing</span>
          <span style={{ opacity: 0.3 }}>|</span>
          <span style={{ fontSize: 12, color: P.textSec }}>练习记录</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleClearAll} style={{ background: P.surface, border: `1px solid ${P.border}`, color: "#dc2626", padding: "7px 12px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>清除全部</button>
          <button onClick={onBack} style={{ background: P.surface, border: `1px solid ${P.border}`, color: P.textSec, padding: "7px 12px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>返回</button>
        </div>
      </div>

      {!hist ? (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px" }}>
          <div style={{ background: P.surface, borderRadius: 14, border: `1px solid ${P.border}`, padding: 32, textAlign: "center", color: P.textDim, fontSize: 13 }}>加载中…</div>
        </div>
      ) : entries.length === 0 ? (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px" }}>
          <div style={{ background: P.surface, borderRadius: 14, border: `1px solid ${P.border}`, padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 8 }}>还没有练习记录</div>
            <div style={{ fontSize: 12, color: P.textDim }}>从主页开始一次练习后，这里会自动记录你的成绩、反馈与历史详情。</div>
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 32px 60px", display: "flex", gap: 28, alignItems: "flex-start" }}>

          {/* Left sidebar */}
          <div style={{ width: 296, flexShrink: 0, position: "sticky", top: 68 }}>
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
          <div style={{ flex: 1, minWidth: 0 }}>
            {activeMockEntry ? (
              <FullMockReport key={activeMockEntry.sourceIndex} entry={activeMockEntry} onClose={() => setActiveMockSrcIdx(null)} />
            ) : (
              <div key="overview" style={{ animation: "slideInLeft 0.4s cubic-bezier(0.16,1,0.3,1)" }}>
                {/* Stat cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
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

                {/* Trend chart */}
                {(bs.length > 0 || email.length > 0 || discussion.length > 0) && (
                  <div style={{ background: P.surface, borderRadius: 14, border: `1px solid ${P.border}`, padding: "16px 18px", marginBottom: 16, boxShadow: P.shadow }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: P.text, marginBottom: 12 }}>📈 进步趋势</div>
                    <TrendChart bs={bs} email={email} discussion={discussion} />
                  </div>
                )}

                {/* Session list */}
                <div style={{ background: P.surface, borderRadius: 14, border: `1px solid ${P.border}`, overflow: "hidden", boxShadow: P.shadow }}>
                  <div style={{ padding: "12px 16px", background: P.bg, borderBottom: `1px solid ${P.borderSubtle}`, fontSize: 13, fontWeight: 700, color: P.text }}>
                    日常练习明细 ({filteredPractice.length})
                  </div>
                  <div style={{ padding: "8px 14px 14px", maxHeight: 520, overflowY: "auto" }}>
                    {filteredPractice.length === 0 ? (
                      <div style={{ padding: "24px 0", textAlign: "center", fontSize: 12, color: P.textDim }}>
                        {selectedWeak ? `没有包含「${selectedWeak}」薄弱点的记录。` : "当前筛选下暂无练习记录。"}
                      </div>
                    ) : filteredPractice.map((entry) => (
                      <SessionRow
                        key={entry.sourceIndex}
                        entry={entry}
                        expanded={expandedSrcIdx === entry.sourceIndex}
                        onToggle={() => setExpandedSrcIdx(expandedSrcIdx === entry.sourceIndex ? null : entry.sourceIndex)}
                        onDelete={handleDelete}
                        typeAvgs={typeAvgs}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
