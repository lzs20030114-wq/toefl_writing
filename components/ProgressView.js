"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadHist, deleteSession, clearAllSessions, SESSION_STORE_EVENTS } from "../lib/sessionStore";
import { buildHistoryEntries, buildHistoryStats, buildPracticeGroups } from "../lib/history/viewModel";
import { C, FONT, Btn, TopBar } from "./shared/ui";
import { HistoryRow } from "./history/HistoryRow";

/* helpers */

function getBandColor(band) {
  if (band >= 5.5) return "#16a34a";
  if (band >= 4.5) return "#2563eb";
  if (band >= 3.5) return "#d97706";
  if (band >= 2.5) return "#ea580c";
  return "#dc2626";
}

function getBandLabel(band) {
  if (band >= 5.5) return "C1+";
  if (band >= 4.5) return "B2\u2013C1";
  if (band >= 3.5) return "B1\u2013B2";
  if (band >= 2.5) return "A2\u2013B1";
  return "A1\u2013A2";
}

function fmtDate(d) {
  try {
    const dt = new Date(d);
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  } catch {
    return String(d || "");
  }
}

function getTaskScoreFromMock(s, taskId) {
  const t = Array.isArray(s?.details?.tasks) ? s.details.tasks.find((x) => x?.taskId === taskId) : null;
  if (!t || !Number.isFinite(t.score)) return null;
  return `${t.score}/${t.maxScore}`;
}

/* SVG components */

function BandRing({ band, size = 88 }) {
  const color = getBandColor(band);
  const pct = Math.max(0, Math.min(100, ((band - 1) / 5) * 100));
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={6} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size * 0.3, fontWeight: 800, color, lineHeight: 1 }}>{band.toFixed(1)}</span>
        <span style={{ fontSize: size * 0.12, color: "#9ca3af", marginTop: 1 }}>/ 6.0</span>
      </div>
    </div>
  );
}

function MockTrend({ mocks }) {
  const sorted = [...mocks].sort((a, b) => new Date(a.date) - new Date(b.date));
  const bands = sorted.map((m) => m.band);
  const min = Math.min(...bands, 1);
  const max = Math.max(...bands, 6);
  const range = max - min || 1;
  const w = 120;
  const h = 32;
  const pts = bands.map((b, i) => {
    const x = (i / (bands.length - 1)) * w;
    const y = h - ((b - min) / range) * h;
    return { x, y, b };
  });

  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={getBandColor(p.b)} />
      ))}
    </svg>
  );
}

/* ===== trend-chart helpers ===== */

function aggregateByDay(sessions, getScore) {
  const map = {};
  sessions.forEach((s) => {
    const d = new Date(s.date);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!map[key])
      map[key] = { date: key, ts: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), vals: [] };
    const v = getScore(s);
    if (v !== null && Number.isFinite(v)) map[key].vals.push(v);
  });
  return Object.values(map)
    .filter((x) => x.vals.length > 0)
    .map((x) => ({ date: x.date, ts: x.ts, avg: x.vals.reduce((a, b) => a + b, 0) / x.vals.length }))
    .sort((a, b) => a.ts - b.ts);
}

/* ===== ScoreTrendChart ===== */

function ScoreTrendChart({ bs, email, discussion }) {
  const [hidden, setHidden] = useState({ bs: false, email: false, discussion: false });
  const [tooltip, setTooltip] = useState(null);
  const svgRef = useRef(null);

  const VW = 560, VH = 175;
  const ML = 36, MT = 12, MR = 12, MB = 28;
  const CW = VW - ML - MR;
  const CH = VH - MT - MB;

  const wrScore = (s) => (Number.isFinite(s.score) ? (s.score / 5) * 100 : null);
  const bsScore = (s) => { const t = Number(s.total || 0), c = Number(s.correct || 0); return t > 0 ? (c / t) * 100 : null; };

  const LINES = [
    { key: "email", label: "Email", color: "#3b82f6", pts: aggregateByDay(email, wrScore) },
    { key: "discussion", label: "Discussion", color: "#16a34a", pts: aggregateByDay(discussion, wrScore) },
    { key: "bs", label: "Build a Sentence", color: "#f97316", pts: aggregateByDay(bs, bsScore) },
  ];

  const allPts = LINES.flatMap((l) => l.pts);
  if (allPts.length === 0) return null;

  const minTs = Math.min(...allPts.map((p) => p.ts));
  const maxTs = Math.max(...allPts.map((p) => p.ts));
  const tsSpan = maxTs - minTs || 864e5;

  const toX = (ts) => ML + ((ts - minTs) / tsSpan) * CW;
  const toY = (pct) => MT + (1 - pct / 100) * CH;

  function handleMouseMove(e) {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const svgX = (px / rect.width) * VW;
    let bestDist = 22, bestTs = null;
    LINES.forEach((l) => {
      if (hidden[l.key]) return;
      l.pts.forEach((p) => {
        const d = Math.abs(toX(p.ts) - svgX);
        if (d < bestDist) { bestDist = d; bestTs = p.ts; }
      });
    });
    if (bestTs === null) { setTooltip(null); return; }
    const near = LINES
      .filter((l) => !hidden[l.key])
      .flatMap((l) => l.pts.filter((p) => p.ts === bestTs).map((p) => ({ key: l.key, label: l.label, color: l.color, avg: p.avg, date: p.date })));
    setTooltip({ px, py: e.clientY - rect.top, svgX: toX(bestTs), near });
  }

  const allDates = [...new Set(allPts.map((p) => p.date))].sort();
  const showDates = allDates.length <= 5 ? allDates : [allDates[0], allDates[Math.floor(allDates.length / 2)], allDates[allDates.length - 1]];
  const yGrid = [0, 25, 50, 75, 100];

  return (
    <div style={{ padding: "14px 16px 4px", borderTop: "1px solid #f0f0f0" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.t2, marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
        Score Trend
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
        {LINES.map((l) => (
          <button
            key={l.key}
            onClick={() => setHidden((h) => ({ ...h, [l.key]: !h[l.key] }))}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              border: "1px solid " + (hidden[l.key] ? "#d1d5db" : l.color),
              background: hidden[l.key] ? "#f3f4f6" : l.color + "18",
              borderRadius: 20, padding: "2px 9px",
              fontSize: 12, fontWeight: 600, color: hidden[l.key] ? C.t2 : l.color,
              cursor: "pointer", fontFamily: FONT,
            }}
          >
            <span style={{ width: 18, height: 2, background: hidden[l.key] ? "#d1d5db" : l.color, borderRadius: 2, display: "inline-block" }} />
            {l.label}
          </button>
        ))}
        <span style={{ fontSize: 10, color: C.t2, marginLeft: 2 }}>（Y轴均标准化为%；Email / Discussion实际分÷5×100）</span>
      </div>
      <div style={{ position: "relative" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VW} ${VH}`}
          width="100%"
          style={{ display: "block", overflow: "visible" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
        >
          {yGrid.map((y) => (
            <g key={y}>
              <line x1={ML} y1={toY(y)} x2={ML + CW} y2={toY(y)} stroke={y === 0 ? "#e5e7eb" : "#f3f4f6"} strokeWidth={1} />
              <text x={ML - 5} y={toY(y) + 3.5} fontSize={9} fill="#9ca3af" textAnchor="end">{y}%</text>
            </g>
          ))}
          <line x1={ML} y1={MT} x2={ML} y2={MT + CH} stroke="#e5e7eb" strokeWidth={1} />
          {showDates.map((d) => {
            const pt = allPts.find((p) => p.date === d);
            if (!pt) return null;
            const [, m, dd] = d.split("-");
            return (
              <text key={d} x={toX(pt.ts)} y={VH - 3} fontSize={9} fill="#9ca3af" textAnchor="middle">
                {m}/{dd}
              </text>
            );
          })}
          {LINES.map((l) => {
            if (hidden[l.key] || l.pts.length === 0) return null;
            return (
              <g key={l.key}>
                {l.pts.length > 1 && (
                  <polyline
                    points={l.pts.map((p) => `${toX(p.ts).toFixed(1)},${toY(p.avg).toFixed(1)}`).join(" ")}
                    fill="none" stroke={l.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                  />
                )}
                {l.pts.map((p, i) => (
                  <circle key={i} cx={toX(p.ts).toFixed(1)} cy={toY(p.avg).toFixed(1)}
                    r={l.pts.length === 1 ? 5 : 3.5} fill={l.color} stroke="#fff" strokeWidth={1.5}
                  />
                ))}
              </g>
            );
          })}
          {tooltip && (
            <line x1={tooltip.svgX} y1={MT} x2={tooltip.svgX} y2={MT + CH}
              stroke="#9ca3af" strokeWidth={1} strokeDasharray="3,2" />
          )}
        </svg>
        {tooltip && tooltip.near.length > 0 && (
          <div style={{
            position: "absolute",
            left: tooltip.px > 220 ? tooltip.px - 140 : tooltip.px + 14,
            top: Math.max(0, tooltip.py - 44),
            background: "#1f2937", color: "#fff", borderRadius: 6,
            padding: "6px 10px", fontSize: 12, pointerEvents: "none",
            zIndex: 10, whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}>
            <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4 }}>{tooltip.near[0].date}</div>
            {tooltip.near.map((pt) => (
              <div key={pt.key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 1 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: pt.color, display: "inline-block", flexShrink: 0 }} />
                <span style={{ color: pt.color, fontWeight: 600 }}>{pt.label}</span>
                <span>{pt.key === "bs" ? `${Math.round(pt.avg)}%` : `${(pt.avg * 0.05).toFixed(1)}/5`}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== ProgressComparison ===== */

function ProgressComparison({ bs, email, discussion }) {
  function halfStats(sessions, getScore) {
    const valid = sessions
      .map((s) => ({ s, v: getScore(s) }))
      .filter((x) => x.v !== null && Number.isFinite(x.v))
      .sort((a, b) => new Date(a.s.date) - new Date(b.s.date));
    if (valid.length < 4) return null;
    const mid = Math.floor(valid.length / 2);
    const earlyAvg = valid.slice(0, mid).reduce((a, x) => a + x.v, 0) / mid;
    const lateAvg = valid.slice(mid).reduce((a, x) => a + x.v, 0) / (valid.length - mid);
    return { earlyAvg, lateAvg, diff: lateAvg - earlyAvg };
  }

  const bsScoreF = (s) => { const t = Number(s.total || 0), c = Number(s.correct || 0); return t > 0 ? (c / t) * 100 : null; };
  const wrScoreF = (s) => (Number.isFinite(s.score) ? s.score : null);

  const types = [
    {
      icon: "\u{1F9E9}", label: "Build a Sentence", stats: halfStats(bs, bsScoreF),
      fmt: (v) => `${Math.round(v)}%`, diffFmt: (d) => `${d >= 0 ? "+" : ""}${Math.round(d)}%`,
    },
    {
      icon: "\u{1F4E7}", label: "Email", stats: halfStats(email, wrScoreF),
      fmt: (v) => `${v.toFixed(1)}/5`, diffFmt: (d) => `${d >= 0 ? "+" : ""}${d.toFixed(1)}分`,
    },
    {
      icon: "\u{1F4AC}", label: "Discussion", stats: halfStats(discussion, wrScoreF),
      fmt: (v) => `${v.toFixed(1)}/5`, diffFmt: (d) => `${d >= 0 ? "+" : ""}${d.toFixed(1)}分`,
    },
  ];

  return (
    <div style={{ padding: "12px 16px 4px", borderTop: "1px solid #f0f0f0" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.t2, marginBottom: 10, letterSpacing: 0.5, textTransform: "uppercase" }}>
        进步对比（早期 vs 近期）
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {types.map(({ icon, label, stats, fmt, diffFmt }) => (
          <div key={label} style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: C.t2, marginBottom: 6 }}>{icon} {label}</div>
            {!stats ? (
              <div style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic", lineHeight: 1.6 }}>
                数据不足<br />继续练习
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: C.t2 }}>早期</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>{fmt(stats.earlyAvg)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.t2 }}>近期</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>{fmt(stats.lateAvg)}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: stats.diff >= 0 ? "#16a34a" : "#9ca3af" }}>
                  {stats.diff >= 0 ? "↑" : "↓"} {diffFmt(stats.diff)}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===== RecurringIssues ===== */

function RecurringIssues({ email, discussion }) {
  const allSessions = [...email, ...discussion]
    .filter((s) => s.details?.feedback)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (allSessions.length < 2) return null;

  function getWeaknessTags(s) {
    const fb = s.details?.feedback;
    if (!fb) return [];
    if (Array.isArray(fb.weaknesses) && fb.weaknesses.length > 0) {
      return fb.weaknesses.map((w) => {
        const tag = String(w || "").split(":")[0].trim();
        return { tag, text: String(w || "").trim() };
      }).filter((x) => x.tag);
    }
    if (Array.isArray(fb.patterns)) {
      return fb.patterns
        .filter((p) => Number(p?.count || 0) > 0)
        .map((p) => ({ tag: String(p.tag || "").trim(), text: `${p.tag}: ${p.summary || ""}`.trim() }))
        .filter((x) => x.tag);
    }
    return [];
  }

  const tagFreq = {}, tagText = {};
  allSessions.forEach((s) => {
    getWeaknessTags(s).forEach(({ tag, text }) => {
      tagFreq[tag] = (tagFreq[tag] || 0) + 1;
      tagText[tag] = text;
    });
  });

  const recurring = Object.entries(tagFreq)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  if (recurring.length === 0) return null;

  const last5 = allSessions.slice(-5);
  const last5TagSets = last5.map((s) => new Set(getWeaknessTags(s).map((x) => x.tag)));

  return (
    <div style={{ padding: "12px 16px 8px", borderTop: "1px solid #f0f0f0" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.t2, marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
        Recurring Issues
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {recurring.map(([tag, n]) => {
          const inLast5 = last5TagSets.filter((ts) => ts.has(tag)).length;
          const improved = inLast5 === 0;
          const persistent = last5.length >= 3 && inLast5 >= Math.ceil(last5.length * 0.6);
          return (
            <div key={tag} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
              <span style={{
                fontSize: 12, flex: 1, minWidth: 0,
                color: improved ? "#9ca3af" : C.t1,
                textDecoration: improved ? "line-through" : "none",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {tagText[tag] || tag}
              </span>
              <span style={{ fontSize: 11, color: C.t2, flexShrink: 0 }}>×{n}</span>
              {improved && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", flexShrink: 0, whiteSpace: "nowrap" }}>已改善 ✓</span>
              )}
              {!improved && persistent && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", flexShrink: 0, whiteSpace: "nowrap" }}>仍需注意</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* section bar */

function SectionBar({ color, label, count }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid " + C.bdr }}>
      <div style={{ width: 4, height: 18, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: C.t1, letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</span>
      {Number.isFinite(count) && (
        <span style={{ fontSize: 11, fontWeight: 700, background: "#f0f4ff", color: "#3b82f6", borderRadius: 10, padding: "1px 8px" }}>{count}</span>
      )}
    </div>
  );
}

/* tab filter */

const PRACTICE_TABS = [
  { key: "all", label: "All" },
  { key: "build", label: "\u{1F9E9} Build", type: "bs" },
  { key: "email", label: "\u{1F4E7} Email", type: "email" },
  { key: "discussion", label: "\u{1F4AC} Disc.", type: "discussion" },
];

function TabBar({ active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 0, borderBottom: "1px solid " + C.bdr }}>
      {PRACTICE_TABS.map((t) => {
        const sel = active === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              flex: 1,
              padding: "10px 0",
              background: sel ? "#f0f4ff" : "transparent",
              border: "none",
              borderBottom: sel ? "2px solid #3b82f6" : "2px solid transparent",
              fontSize: 13,
              fontWeight: sel ? 700 : 500,
              color: sel ? "#3b82f6" : C.t2,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* type icon helper */

function typeIcon(type) {
  if (type === "bs") return "\u{1F9E9}";
  if (type === "email") return "\u{1F4E7}";
  if (type === "discussion") return "\u{1F4AC}";
  return "";
}

/* main component */

export function ProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
  const [expandedMock, setExpandedMock] = useState(null);
  const [expandedPractice, setExpandedPractice] = useState(null);
  const [expandedPracticeRetryGroups, setExpandedPracticeRetryGroups] = useState({});
  const [expandedPracticeRetryRows, setExpandedPracticeRetryRows] = useState({});
  const [tab, setTab] = useState("all");

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
  const hasPendingMock = stats.hasPendingMock;

  // Split entries into mock vs practice
  const mockEntries = useMemo(
    () => entries.filter((e) => e.session.type === "mock").sort((a, b) => new Date(b.session.date) - new Date(a.session.date)),
    [entries],
  );
  const practiceEntries = useMemo(
    () => entries.filter((e) => e.session.type !== "mock").sort((a, b) => new Date(b.session.date) - new Date(a.session.date)),
    [entries],
  );

  // Practice type stats
  const bs = stats.byType.bs;
  const em = stats.byType.email;
  const di = stats.byType.discussion;

  // Per-type averages for ⬆/⬇ arrows in history rows
  const typeAvgs = useMemo(() => {
    let bsValid = 0, bsSum = 0;
    bs.forEach((s) => {
      const t = Number(s.total || 0), c = Number(s.correct || 0);
      if (t > 0) { bsSum += (c / t) * 100; bsValid++; }
    });
    const bsAvg = bsValid > 0 ? bsSum / bsValid : null;
    const emAvg = em.length > 0 ? em.reduce((a, s) => a + s.score, 0) / em.length : null;
    const diAvgVal = di.length > 0 ? di.reduce((a, s) => a + s.score, 0) / di.length : null;
    return { bs: bsAvg, email: emAvg, discussion: diAvgVal };
  }, [bs, em, di]);

  // Mock band stats
  const mockBands = useMemo(() => mockEntries.map((e) => e.session).filter((s) => Number.isFinite(s.band)), [mockEntries]);
  const latestMock = mockEntries.length > 0 ? mockEntries[0].session : null;
  const bestBand = mockBands.length > 0 ? Math.max(...mockBands.map((m) => m.band)) : null;
  const avgBand = mockBands.length > 0 ? mockBands.reduce((a, m) => a + m.band, 0) / mockBands.length : null;

  // Filtered practice list
  const filteredPractice = useMemo(() => {
    if (tab === "all") return practiceEntries;
    const t = PRACTICE_TABS.find((x) => x.key === tab);
    return t?.type ? practiceEntries.filter((e) => e.session.type === t.type) : practiceEntries;
  }, [practiceEntries, tab]);
  const filteredPracticeGroups = useMemo(() => buildPracticeGroups(filteredPractice), [filteredPractice]);

  // Auto-poll for pending mock scoring
  useEffect(() => {
    if (!hist || !hasPendingMock) return;
    const timer = setInterval(() => setHist(loadHist()), 3000);
    return () => clearInterval(timer);
  }, [hist, hasPendingMock]);

  if (!hist) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center" }}>
        Loading...
      </div>
    );
  }

  function handleDelete(sourceIndex) {
    if (!window.confirm("Delete this record?")) return;
    const newHist = deleteSession(sourceIndex);
    setHist({ ...newHist });
    if (expandedMock === sourceIndex) setExpandedMock(null);
    if (expandedPractice === sourceIndex) setExpandedPractice(null);
  }

  function handleTogglePracticeRetryGroup(parentSourceIndex) {
    setExpandedPracticeRetryGroups((prev) => ({
      ...prev,
      [parentSourceIndex]: !prev[parentSourceIndex],
    }));
  }

  function handleTogglePracticeRetryRow(parentSourceIndex, childSourceIndex) {
    setExpandedPracticeRetryRows((prev) => ({
      ...prev,
      [parentSourceIndex]: prev[parentSourceIndex] === childSourceIndex ? null : childSourceIndex,
    }));
  }

  function handleClearAll() {
    if (!window.confirm("Delete all history records?")) return;
    const newHist = clearAllSessions();
    setHist({ ...newHist });
    setExpandedMock(null);
    setExpandedPractice(null);
  }

  const isEmpty = entries.length === 0;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title="Practice History" section="Progress" onExit={onBack} />
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>

        {isEmpty && (
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, padding: 40, textAlign: "center", color: C.t2 }}>
            No history records yet.
          </div>
        )}

        {!isEmpty && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* MOCK EXAMS SECTION */}
            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, overflow: "hidden" }}>
              <SectionBar color={C.nav} label="Mock Exams" count={mockEntries.length} />

              {mockEntries.length === 0 ? (
                <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 13, color: C.t2 }}>
                  No mock exams yet. Take your first mock exam to see your Band score here.
                </div>
              ) : (
                <>
                  {/* Latest result hero */}
                  {latestMock && Number.isFinite(latestMock.band) && (
                    <div style={{ padding: "20px 20px 16px", display: "flex", gap: 20, alignItems: "center", borderBottom: "1px solid #f0f0f0" }}>
                      <BandRing band={latestMock.band} size={88} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: C.t2, letterSpacing: 0.5, marginBottom: 4 }}>LATEST RESULT</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 20, fontWeight: 800, color: getBandColor(latestMock.band) }}>
                            Band {latestMock.band.toFixed(1)}
                          </span>
                          <span style={{ fontSize: 12, color: C.t2, fontWeight: 600 }}>{getBandLabel(latestMock.band)}</span>
                        </div>
                        <div style={{ fontSize: 13, color: C.t1, marginBottom: 6 }}>
                          Scaled {latestMock.scaledScore ?? "--"}/30
                        </div>
                        <div style={{ fontSize: 12, color: C.t2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <span>{"\u{1F9E9}"} {getTaskScoreFromMock(latestMock, "build-sentence") || "--"}</span>
                          <span>{"\u{1F4E7}"} {getTaskScoreFromMock(latestMock, "email-writing") || "--"}</span>
                          <span>{"\u{1F4AC}"} {getTaskScoreFromMock(latestMock, "academic-writing") || "--"}</span>
                        </div>
                        {mockBands.length >= 2 && (
                          <div style={{ marginTop: 8 }}>
                            <MockTrend mocks={mockBands} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Mock history list */}
                  <div style={{ padding: "0 16px" }}>
                    {mockEntries.map((entry, i) => (
                      <HistoryRow
                        key={entry.sourceIndex}
                        entry={entry}
                        isExpanded={expandedMock === entry.sourceIndex}
                        isLast={i === mockEntries.length - 1}
                        onToggle={() => setExpandedMock(expandedMock === entry.sourceIndex ? null : entry.sourceIndex)}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>

                  {/* Mock stats footer */}
                  {mockBands.length > 1 && (
                    <div style={{ padding: "10px 16px", borderTop: "1px solid #f0f0f0", display: "flex", gap: 20, fontSize: 12, color: C.t2 }}>
                      <span>{"\u{1F3C6}"} Best: <b style={{ color: getBandColor(bestBand) }}>{bestBand.toFixed(1)}</b></span>
                      <span>Avg: <b style={{ color: C.t1 }}>{avgBand.toFixed(1)}</b></span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* PRACTICE SECTION */}
            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, overflow: "hidden" }}>
              <SectionBar color="#3b82f6" label="Practice" count={practiceEntries.length} />

              {/* Stats cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, padding: "16px 16px 12px" }}>
                {[
                  {
                    icon: "\u{1F9E9}",
                    label: "Build",
                    n: bs.length,
                    stat: (() => {
                      if (!bs.length) return "-";
                      let valid = 0;
                      const sum = bs.reduce((a, s) => {
                        const total = Number(s?.total || 0);
                        const correct = Number(s?.correct || 0);
                        if (total <= 0) return a;
                        valid += 1;
                        return a + (correct / total) * 100;
                      }, 0);
                      if (!valid) return "-";
                      return `${Math.round(sum / valid)}%`;
                    })(),
                  },
                  {
                    icon: "\u{1F4E7}",
                    label: "Email",
                    n: em.length,
                    stat: em.length ? (em.reduce((a, s) => a + s.score, 0) / em.length).toFixed(1) + "/5" : "-",
                  },
                  {
                    icon: "\u{1F4AC}",
                    label: "Discussion",
                    n: di.length,
                    stat: di.length ? (di.reduce((a, s) => a + s.score, 0) / di.length).toFixed(1) + "/5" : "-",
                  },
                ].map((c, i) => (
                  <div key={i} style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: C.t2, marginBottom: 4 }}>{c.icon} {c.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: C.nav }}>{c.n}</div>
                    <div style={{ fontSize: 12, color: C.t2 }}>{c.stat}</div>
                  </div>
                ))}
              </div>

              {/* Score Trend Chart */}
              <ScoreTrendChart bs={bs} email={em} discussion={di} />

              {/* Progress Comparison */}
              <ProgressComparison bs={bs} email={em} discussion={di} />

              {/* Recurring Issues */}
              <RecurringIssues email={em} discussion={di} />

              {/* Tab filter */}
              <TabBar active={tab} onChange={setTab} />

              {/* Practice list */}
              <div style={{ padding: "0 16px" }}>
                {filteredPractice.length === 0 ? (
                  <div style={{ padding: "20px 0", textAlign: "center", fontSize: 13, color: C.t2 }}>
                    {practiceEntries.length === 0
                      ? "No practice sessions yet."
                      : "No records for this filter."}
                  </div>
                ) : (
                  filteredPracticeGroups.map((group, i) => {
                    const parent = group.parent;
                    const parentId = parent?.sourceIndex;
                    const hasRetries = Array.isArray(group.children) && group.children.length > 0;
                    const retryListOpen = !!expandedPracticeRetryGroups[parentId];
                    const expandedChildId = expandedPracticeRetryRows[parentId] || null;
                    return (
                      <div key={group.groupKey}>
                        <HistoryRow
                          entry={parent}
                          isExpanded={expandedPractice === parentId}
                          isLast={i === filteredPracticeGroups.length - 1 && (!hasRetries || !retryListOpen)}
                          onToggle={() => setExpandedPractice(expandedPractice === parentId ? null : parentId)}
                          onDelete={handleDelete}
                          showIcon
                          typeAvgs={typeAvgs}
                        />
                        {hasRetries && (
                          <div style={{ margin: "-2px 0 8px 22px", borderLeft: "2px solid #e5e7eb", paddingLeft: 10 }}>
                            <button
                              onClick={() => handleTogglePracticeRetryGroup(parentId)}
                              style={{
                                border: "1px solid #d1d5db",
                                background: "#fff",
                                borderRadius: 6,
                                fontSize: 12,
                                padding: "4px 8px",
                                cursor: "pointer",
                                color: C.blue,
                                fontWeight: 700,
                                marginBottom: retryListOpen ? 6 : 0,
                              }}
                            >
                              {retryListOpen ? "收起附加练习" : "展开附加练习"} ({group.children.length})
                            </button>
                            {retryListOpen && group.children.map((child, childIdx) => (
                              <HistoryRow
                                key={child.sourceIndex}
                                entry={child}
                                isExpanded={expandedChildId === child.sourceIndex}
                                isLast={childIdx === group.children.length - 1}
                                onToggle={() => handleTogglePracticeRetryRow(parentId, child.sourceIndex)}
                                onDelete={handleDelete}
                                showIcon={false}
                                compact
                                typeAvgs={typeAvgs}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* BOTTOM BUTTONS */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Btn onClick={onBack}>Back to Menu</Btn>
              <button
                onClick={handleClearAll}
                style={{
                  background: "#fff",
                  color: C.red,
                  border: "1px solid " + C.red,
                  borderRadius: 4,
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                Clear All
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
