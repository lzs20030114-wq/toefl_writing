"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadHist, deleteSession, clearAllSessions, SESSION_STORE_EVENTS } from "../lib/sessionStore";
import { buildHistoryEntries, buildHistoryStats } from "../lib/history/viewModel";
import { TopBar } from "./shared/ui";
import { HistoryRow } from "./history/HistoryRow";

/* ─── Design Tokens ─────────────────────────────────────── */
const T = {
  bg: "#F6F5F1",
  card: "#FFFFFF",
  bdr: "#E8E6E1",
  shadow: "0 1px 3px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.02)",
  t1: "#1A1A1E",
  t2: "#6B6B76",
  t3: "#A0A0AC",
  email: "#0EA5E9",
  emailSoft: "#F0F9FF",
  disc: "#10B981",
  discSoft: "#ECFDF5",
  build: "#F59E0B",
  buildSoft: "#FFFBEB",
  accent: "#4F46E5",
  accentSoft: "#EEF2FF",
  red: "#EF4444",
  redSoft: "#FEF2F2",
  green: "#10B981",
  greenSoft: "#ECFDF5",
};
const JFONT = "'Plus Jakarta Sans','Noto Sans SC','Segoe UI',sans-serif";

/* ─── Helpers ────────────────────────────────────────────── */
function getBandColor(b) {
  if (b >= 5.5) return "#10B981";
  if (b >= 4.5) return "#4F46E5";
  if (b >= 3.5) return "#F59E0B";
  if (b >= 2.5) return "#F97316";
  return "#EF4444";
}
function fmtDate(d) {
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d || "");
    const p = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}/${p(dt.getMonth() + 1)}/${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
  } catch { return String(d || ""); }
}
function typeColor(t) { return { email: T.email, discussion: T.disc, bs: T.build }[t] || T.accent; }
function typeSoft(t) { return { email: T.emailSoft, discussion: T.discSoft, bs: T.buildSoft }[t] || T.accentSoft; }
function typeEmoji(t) { return { bs: "🧩", email: "📧", discussion: "💬" }[t] || ""; }
function typeLabel(t) { return { bs: "Build a Sentence", email: "Email", discussion: "Discussion" }[t] || t; }
function getScorePct(s) {
  if (!s) return null;
  if (s.type === "bs") { const t = Number(s.total || 0), c = Number(s.correct || 0); return t > 0 ? (c / t) * 100 : null; }
  if (s.type === "email" || s.type === "discussion") return Number.isFinite(s.score) ? (s.score / 5) * 100 : null;
  return null;
}
function getScoreLabel(s) {
  if (!s) return "--";
  if (s.type === "bs") { const t = Number(s.total || 0), c = Number(s.correct || 0); return t <= 0 ? "--" : `${c}/${t}`; }
  if (s.type === "email" || s.type === "discussion") return Number.isFinite(s.score) ? `${s.score}/5` : "--";
  return "--";
}
function scorePctColor(pct) {
  if (pct === null) return T.t3;
  if (pct >= 80) return T.green;
  if (pct >= 60) return "#F59E0B";
  return T.red;
}
function aggregateByDay(sessions, getV) {
  const map = {};
  sessions.forEach((s) => {
    const d = new Date(s.date);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!map[key]) map[key] = { date: key, ts: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), vals: [] };
    const v = getV(s);
    if (v !== null && Number.isFinite(v)) map[key].vals.push(v);
  });
  return Object.values(map)
    .filter((x) => x.vals.length > 0)
    .map((x) => ({ date: x.date, ts: x.ts, avg: x.vals.reduce((a, b) => a + b, 0) / x.vals.length }))
    .sort((a, b) => a.ts - b.ts);
}
/* Cardinal spline: smooth bezier curve through points */
function smoothPath(pts) {
  if (!pts || pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/* ─── Sparkline ──────────────────────────────────────────── */
function Sparkline({ data, color, uid }) {
  if (!data || data.length === 0) return <svg width={80} height={24} style={{ display: "block" }} />;
  const W = 80, H = 24, PAD = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => ({
    x: PAD + (i / Math.max(data.length - 1, 1)) * (W - PAD * 2),
    y: PAD + (1 - (v - min) / range) * (H - PAD * 2),
  }));
  const linePath = smoothPath(pts);
  const areaPath = pts.length > 1 ? linePath + ` L ${pts[pts.length - 1].x.toFixed(1)} ${H} L ${pts[0].x.toFixed(1)} ${H} Z` : "";
  const gid = `spk-${uid}`;
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.16} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {areaPath && <path d={areaPath} fill={`url(#${gid})`} />}
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1].x.toFixed(1)} cy={pts[pts.length - 1].y.toFixed(1)} r={2.5} fill="#fff" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

/* ─── Stat Card ──────────────────────────────────────────── */
function StatCard({ icon, label, color, n, stat, sparkData, uid }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 14, padding: "14px 14px 10px", boxShadow: T.shadow }}>
      <div style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 2 }}>{icon} {label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: T.t1, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{n}</div>
      <div style={{ fontSize: 11, color: T.t2, marginBottom: 4 }}>{stat}</div>
      <Sparkline data={sparkData} color={color} uid={uid} />
    </div>
  );
}

/* ─── Collapsible Card ───────────────────────────────────── */
function CollapsibleCard({ emoji, title, badge, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 14, boxShadow: T.shadow, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", background: "none", border: "none", cursor: "pointer", fontFamily: JFONT }}
      >
        <span style={{ fontSize: 16 }}>{emoji}</span>
        <span style={{ fontSize: 13, fontWeight: 650, color: T.t1, flex: 1, textAlign: "left" }}>{title}</span>
        {badge != null && (
          <span style={{ fontSize: 11, fontWeight: 700, background: T.accentSoft, color: T.accent, borderRadius: 6, padding: "1px 7px", marginRight: 4 }}>{badge}</span>
        )}
        <span style={{
          fontSize: 10, color: T.t3, flexShrink: 0,
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1)",
          display: "inline-block",
        }}>▼</span>
      </button>
      <div style={{ maxHeight: open ? 3000 : 0, overflow: "hidden", transition: "max-height 0.4s cubic-bezier(0.25,1,0.5,1)" }}>
        <div style={{ borderTop: `1px solid ${T.bdr}` }}>{children}</div>
      </div>
    </div>
  );
}

/* ─── Band Ring ──────────────────────────────────────────── */
function BandRing({ band, size = 56 }) {
  const color = getBandColor(band);
  const r = (size - 7) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, Math.min(1, (band - 1) / 5)));
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={4} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size * 0.28, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{band.toFixed(1)}</span>
      </div>
    </div>
  );
}

/* ─── Mock Section ───────────────────────────────────────── */
function MockSection({ mockEntries }) {
  const [expanded, setExpanded] = useState(null);
  if (mockEntries.length === 0) {
    return <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 13, color: T.t2 }}>还没有模考记录</div>;
  }
  const latest = mockEntries[0].session;
  const scored = mockEntries.map((e) => e.session).filter((s) => Number.isFinite(s.band));
  const bestBand = scored.length > 1 ? Math.max(...scored.map((s) => s.band)) : null;
  function getTask(s, id) {
    return Array.isArray(s?.details?.tasks) ? s.details.tasks.find((t) => t?.taskId === id) : null;
  }
  return (
    <div style={{ padding: "14px 16px 16px" }}>
      {Number.isFinite(latest?.band) && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", background: T.accentSoft, borderRadius: 10, marginBottom: 14 }}>
          <BandRing band={latest.band} size={56} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.t2, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 3 }}>最近一次</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: getBandColor(latest.band), fontVariantNumeric: "tabular-nums" }}>Band {latest.band.toFixed(1)}</span>
              {latest.cefr && <span style={{ fontSize: 10, fontWeight: 700, background: T.accent, color: "#fff", borderRadius: 5, padding: "1px 6px" }}>{latest.cefr}</span>}
              <span style={{ fontSize: 11, color: T.t2 }}>Scaled {latest.scaledScore ?? "--"}/30</span>
            </div>
          </div>
          {bestBand && (
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.t2, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 2 }}>历史最佳</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: getBandColor(bestBand), fontVariantNumeric: "tabular-nums" }}>{bestBand.toFixed(1)}</div>
            </div>
          )}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {mockEntries.map((entry) => {
          const s = entry.session;
          const open = expanded === entry.sourceIndex;
          const emT = getTask(s, "email-writing");
          const diT = getTask(s, "academic-writing");
          const bsT = getTask(s, "build-sentence");
          return (
            <div key={entry.sourceIndex} style={{ borderRadius: 8, overflow: "hidden", background: open ? T.bg : "transparent" }}>
              <div
                onClick={() => setExpanded(open ? null : entry.sourceIndex)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", cursor: "pointer" }}
              >
                {Number.isFinite(s.band) && (
                  <span style={{ fontSize: 11, fontWeight: 700, background: getBandColor(s.band) + "20", color: getBandColor(s.band), borderRadius: 5, padding: "2px 7px", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                    {s.band.toFixed(1)}
                  </span>
                )}
                <span style={{ fontSize: 11, color: T.t2, flex: 1 }}>{fmtDate(s.date)}</span>
                <span style={{ fontSize: 11, color: T.t2 }}>
                  📧 {Number.isFinite(emT?.score) ? `${emT.score}/${emT.maxScore}` : "--"} · 💬 {Number.isFinite(diT?.score) ? `${diT.score}/${diT.maxScore}` : "--"}
                </span>
                <span style={{ fontSize: 9, color: T.t3, transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s", display: "inline-block" }}>▼</span>
              </div>
              {open && (
                <div style={{ padding: "0 10px 12px", animation: "slideDown 0.2s ease" }}>
                  {/* Score overview */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                    {[
                      { emoji: "🧩", label: "Build", color: T.build, task: bsT },
                      { emoji: "📧", label: "Email", color: T.email, task: emT },
                      { emoji: "💬", label: "Discussion", color: T.disc, task: diT },
                    ].map(({ emoji, label, color, task }) => (
                      <div key={label} style={{ background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 8, padding: "10px", textAlign: "center" }}>
                        <div style={{ fontSize: 14, marginBottom: 2 }}>{emoji}</div>
                        <div style={{ fontSize: 10, color: T.t2, marginBottom: 3 }}>{label}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>
                          {Number.isFinite(task?.score) ? `${task.score}/${task.maxScore}` : "pending"}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Full details: tabbed Build/Email/Discussion with AI feedback */}
                  <HistoryRow
                    entry={entry}
                    isExpanded={true}
                    isLast={true}
                    onToggle={() => {}}
                    onDelete={() => {}}
                    detailOnly={true}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Trend Chart ──────────────────────────────────────────── */
function TrendChart({ bs, email, discussion }) {
  const [hidden, setHidden] = useState({ bs: false, email: false, discussion: false });
  const [tooltip, setTooltip] = useState(null);
  const svgRef = useRef(null);
  const VW = 440, VH = 180, ML = 34, MT = 12, MR = 10, MB = 26;
  const CW = VW - ML - MR, CH = VH - MT - MB;
  const wrV = (s) => Number.isFinite(s.score) ? s.score : null;
  const bsV = (s) => { const t = Number(s.total || 0), c = Number(s.correct || 0); return t > 0 ? (c / t) * 5 : null; };
  const LINES = [
    { key: "email", label: "Email", color: T.email, pts: aggregateByDay(email, wrV) },
    { key: "discussion", label: "Discussion", color: T.disc, pts: aggregateByDay(discussion, wrV) },
    { key: "bs", label: "Build", color: T.build, pts: aggregateByDay(bs, bsV) },
  ];
  const allPts = LINES.flatMap((l) => l.pts);
  if (allPts.length === 0) return <div style={{ padding: "20px", fontSize: 12, color: T.t2, textAlign: "center" }}>暂无数据</div>;
  const minTs = Math.min(...allPts.map((p) => p.ts));
  const maxTs = Math.max(...allPts.map((p) => p.ts));
  const tsSpan = maxTs - minTs || 864e5;
  const toX = (ts) => ML + ((ts - minTs) / tsSpan) * CW;
  const toY = (v) => MT + (1 - v / 5) * CH;

  function handleMouseMove(e) {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const svgX = (px / rect.width) * VW;
    let bestDist = 22, bestTs = null;
    LINES.forEach((l) => {
      if (hidden[l.key]) return;
      l.pts.forEach((p) => { const d = Math.abs(toX(p.ts) - svgX); if (d < bestDist) { bestDist = d; bestTs = p.ts; } });
    });
    if (bestTs === null) { setTooltip(null); return; }
    const near = LINES.filter((l) => !hidden[l.key])
      .flatMap((l) => l.pts.filter((p) => p.ts === bestTs).map((p) => ({ key: l.key, label: l.label, color: l.color, avg: p.avg, date: p.date })));
    const svgXPos = toX(bestTs);
    setTooltip({ px: px > rect.width * 0.6 ? px - 135 : px + 14, py: 6, svgX: svgXPos, near });
  }

  const allDates = [...new Set(allPts.map((p) => p.date))].sort();
  const showDates = allDates.length <= 5 ? allDates : [allDates[0], allDates[Math.floor(allDates.length / 2)], allDates[allDates.length - 1]];
  const yGrid = [0, 1, 2, 3, 4, 5];

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {LINES.map((l) => (
          <button key={l.key} onClick={() => setHidden((h) => ({ ...h, [l.key]: !h[l.key] }))}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              border: `1px solid ${hidden[l.key] ? T.bdr : l.color}`,
              background: hidden[l.key] ? T.bg : l.color + "15",
              borderRadius: 20, padding: "2px 10px",
              fontSize: 11, fontWeight: 600, color: hidden[l.key] ? T.t3 : l.color,
              cursor: "pointer", fontFamily: JFONT,
            }}
          >
            <span style={{ width: 14, height: 2, background: hidden[l.key] ? T.bdr : l.color, borderRadius: 1, display: "inline-block" }} />
            {l.label}
          </button>
        ))}
      </div>
      <div style={{ position: "relative" }}>
        <svg ref={svgRef} viewBox={`0 0 ${VW} ${VH}`} width="100%" style={{ display: "block", overflow: "visible" }}
          onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>
          {yGrid.map((y) => (
            <g key={y}>
              <line x1={ML} y1={toY(y)} x2={ML + CW} y2={toY(y)}
                stroke={y === 0 ? T.bdr : "#ece9e3"} strokeWidth={1}
                strokeDasharray={y === 0 ? "none" : "3,3"} />
              <text x={ML - 5} y={toY(y) + 3.5} fontSize={9} fill={T.t3} textAnchor="end" fontFamily={JFONT}>{y}</text>
            </g>
          ))}
          <line x1={ML} y1={MT} x2={ML} y2={MT + CH} stroke={T.bdr} strokeWidth={1} />
          {showDates.map((d) => {
            const pt = allPts.find((p) => p.date === d);
            if (!pt) return null;
            const [, m, dd] = d.split("-");
            return <text key={d} x={toX(pt.ts)} y={VH - 2} fontSize={9} fill={T.t3} textAnchor="middle" fontFamily={JFONT}>{m}/{dd}</text>;
          })}
          {tooltip && (
            <rect x={tooltip.svgX - 16} y={MT} width={32} height={CH} fill={T.accentSoft} opacity={0.55} rx={4} />
          )}
          {LINES.map((l) => {
            if (hidden[l.key] || l.pts.length === 0) return null;
            const coords = l.pts.map((p) => ({ x: toX(p.ts), y: toY(p.avg) }));
            return (
              <g key={l.key}>
                {l.pts.length > 1 && <path d={smoothPath(coords)} fill="none" stroke={l.color} strokeWidth={2} strokeLinecap="round" />}
                {coords.map((c, i) => (
                  <circle key={i} cx={c.x.toFixed(1)} cy={c.y.toFixed(1)}
                    r={l.pts.length === 1 ? 5 : 3.5} fill="#fff" stroke={l.color} strokeWidth={1.5} />
                ))}
              </g>
            );
          })}
          {tooltip && <line x1={tooltip.svgX} y1={MT} x2={tooltip.svgX} y2={MT + CH} stroke={T.accent} strokeWidth={1} strokeDasharray="2,2" opacity={0.4} />}
        </svg>
        {tooltip && tooltip.near.length > 0 && (
          <div style={{
            position: "absolute", left: tooltip.px, top: tooltip.py,
            background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 10,
            padding: "8px 12px", fontSize: 12, pointerEvents: "none", zIndex: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,0.10)", minWidth: 110,
            animation: "tooltipIn 0.12s ease",
          }}>
            <div style={{ fontSize: 10, color: T.t3, marginBottom: 5, fontWeight: 600 }}>{tooltip.near[0].date}</div>
            {tooltip.near.map((pt) => (
              <div key={pt.key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: pt.color, display: "inline-block", border: "1.5px solid #fff", boxShadow: `0 0 0 1.5px ${pt.color}`, flexShrink: 0 }} />
                <span style={{ color: pt.color, fontWeight: 600 }}>{pt.label}</span>
                <span style={{ color: T.t1, fontVariantNumeric: "tabular-nums" }}>{pt.avg.toFixed(1)}/5</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Progress Section ───────────────────────────────────── */
function ProgressSection({ bs, email, discussion }) {
  function halfStats(sessions, getV) {
    const valid = sessions.map((s) => ({ s, v: getV(s) })).filter((x) => x.v !== null && Number.isFinite(x.v))
      .sort((a, b) => new Date(a.s.date) - new Date(b.s.date));
    if (valid.length < 4) return null;
    const mid = Math.floor(valid.length / 2);
    const earlyAvg = valid.slice(0, mid).reduce((a, x) => a + x.v, 0) / mid;
    const lateAvg = valid.slice(mid).reduce((a, x) => a + x.v, 0) / (valid.length - mid);
    return { earlyAvg, lateAvg, diff: lateAvg - earlyAvg };
  }
  const bsV = (s) => { const t = Number(s.total || 0), c = Number(s.correct || 0); return t > 0 ? (c / t) * 5 : null; };
  const wrV = (s) => Number.isFinite(s.score) ? s.score : null;
  const comparisons = [
    { key: "email", icon: "📧", label: "Email", color: T.email, stats: halfStats(email, wrV) },
    { key: "disc", icon: "💬", label: "Discussion", color: T.disc, stats: halfStats(discussion, wrV) },
    { key: "bs", icon: "🧩", label: "Build", color: T.build, stats: halfStats(bs, bsV) },
  ];
  return (
    <div style={{ padding: "16px" }}>
      <TrendChart bs={bs} email={email} discussion={discussion} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
        {comparisons.map(({ key, icon, label, color, stats }) => (
          <div key={key} style={{ background: T.bg, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: T.t2, marginBottom: 6 }}>{icon} {label}</div>
            {!stats ? (
              <div style={{ fontSize: 11, color: T.t3, fontStyle: "italic" }}>数据不足</div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: T.t2, fontVariantNumeric: "tabular-nums" }}>{stats.earlyAvg.toFixed(1)}</span>
                <span style={{ fontSize: 11, color: T.t3 }}>→</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.t1, fontVariantNumeric: "tabular-nums" }}>{stats.lateAvg.toFixed(1)}/5</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                  background: stats.diff >= 0 ? T.greenSoft : T.redSoft,
                  color: stats.diff >= 0 ? T.green : T.red,
                }}>
                  {stats.diff >= 0 ? "↑" : "↓"} {Math.abs(stats.diff).toFixed(1)}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Weakness Section ───────────────────────────────────── */
function WeaknessSection({ email, discussion }) {
  const allSessions = [...email, ...discussion]
    .filter((s) => s.details?.feedback)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (allSessions.length < 2)
    return <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12, color: T.t2 }}>继续练习，系统将分析你的薄弱点</div>;
  function getTags(s) {
    const fb = s.details?.feedback;
    if (!fb) return [];
    if (Array.isArray(fb.weaknesses) && fb.weaknesses.length > 0)
      return fb.weaknesses.map((w) => ({ tag: String(w || "").split(":")[0].trim(), text: String(w || "").trim() })).filter((x) => x.tag);
    if (Array.isArray(fb.patterns))
      return fb.patterns.filter((p) => Number(p?.count || 0) > 0)
        .map((p) => ({ tag: String(p.tag || "").trim(), text: `${p.tag}: ${p.summary || ""}`.trim() })).filter((x) => x.tag);
    return [];
  }
  const tagFreq = {}, tagText = {};
  allSessions.forEach((s) => getTags(s).forEach(({ tag, text }) => { tagFreq[tag] = (tagFreq[tag] || 0) + 1; tagText[tag] = text; }));
  const recurring = Object.entries(tagFreq).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (recurring.length === 0)
    return <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12, color: T.t2 }}>继续练习，系统将分析你的薄弱点</div>;
  const last5 = allSessions.slice(-5);
  const last5Sets = last5.map((s) => new Set(getTags(s).map((x) => x.tag)));
  return (
    <div style={{ padding: "12px 16px 16px" }}>
      {recurring.map(([tag, n], ri) => {
        const inLast5 = last5Sets.filter((ts) => ts.has(tag)).length;
        const improved = inLast5 === 0;
        const persistent = last5.length >= 3 && inLast5 >= Math.ceil(last5.length * 0.6);
        return (
          <div key={tag} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: ri < recurring.length - 1 ? `1px solid ${T.bdr}` : "none" }}>
            <span style={{
              fontSize: 12, flex: 1, minWidth: 0, color: improved ? T.t3 : T.t1,
              textDecoration: improved ? "line-through" : "none", opacity: improved ? 0.6 : 1,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{tagText[tag] || tag}</span>
            <span style={{ fontSize: 11, color: T.t3, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>×{n}</span>
            {improved && <span style={{ fontSize: 10, fontWeight: 700, background: T.greenSoft, color: T.green, borderRadius: 5, padding: "1px 6px", flexShrink: 0, whiteSpace: "nowrap" }}>已改善 ✓</span>}
            {!improved && persistent && <span style={{ fontSize: 10, fontWeight: 700, background: T.redSoft, color: T.red, borderRadius: 5, padding: "1px 6px", flexShrink: 0, whiteSpace: "nowrap" }}>需关注</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Practice Row ───────────────────────────────────────── */
function PracticeRow({ entry, isExpanded, onToggle, onDelete, typeAvgs }) {
  const s = entry.session;
  const pct = getScorePct(s);
  const sColor = scorePctColor(pct);
  const rawAvg = typeAvgs?.[s.type] ?? null;
  const avgPct = s.type === "bs" ? rawAvg : (rawAvg !== null ? (rawAvg / 5) * 100 : null);
  const showTrend = pct !== null && avgPct !== null;
  const isAbove = showTrend && pct > avgPct;
  const attempt = Number(s?.details?.practiceAttempt || 1);
  return (
    <div>
      <div
        onClick={() => onToggle?.()}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", borderRadius: 8, transition: "background 0.12s" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = T.bg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <div style={{ width: 32, height: 32, borderRadius: 8, background: typeSoft(s.type), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
          {typeEmoji(s.type)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: T.t1, display: "flex", alignItems: "center", gap: 5 }}>
            {typeLabel(s.type)}
            {attempt > 1 && <span style={{ fontSize: 9, fontWeight: 700, background: T.discSoft, color: T.disc, borderRadius: 4, padding: "0 4px" }}>第{attempt}次</span>}
          </div>
          <div style={{ fontSize: 11, color: T.t2, marginTop: 1 }}>{fmtDate(s.date)}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: sColor, fontVariantNumeric: "tabular-nums" }}>{getScoreLabel(s)}</span>
          {showTrend && <span style={{ fontSize: 10, color: isAbove ? T.green : T.t3 }}>{isAbove ? "⬆" : "⬇"}</span>}
        </div>
        <button onClick={(e) => { e.stopPropagation(); onDelete?.(entry.sourceIndex); }}
          style={{ background: "none", border: "none", color: T.t3, cursor: "pointer", fontSize: 14, padding: "2px 4px", flexShrink: 0, lineHeight: 1 }}>×</button>
        <span style={{ fontSize: 9, color: T.t3, transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.22s", display: "inline-block", flexShrink: 0 }}>▼</span>
      </div>
      {isExpanded && (
        <div style={{ margin: "0 8px 8px", background: T.bg, borderRadius: 8, overflow: "hidden", animation: "slideDown 0.18s ease" }}>
          <HistoryRow
            entry={entry}
            isExpanded={true}
            isLast={true}
            onToggle={() => {}}
            onDelete={onDelete}
            detailOnly={true}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Practice Section ───────────────────────────────────── */
function PracticeSection({ practiceEntries, typeAvgs, onDelete }) {
  const [tab, setTab] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const TABS = [
    { key: "all", label: "全部" },
    { key: "bs", label: "🧩 Build" },
    { key: "email", label: "📧 Email" },
    { key: "discussion", label: "💬 Discussion" },
  ];
  const filtered = useMemo(() => {
    if (tab === "all") return practiceEntries;
    return practiceEntries.filter((e) => e.session.type === tab);
  }, [practiceEntries, tab]);
  return (
    <div>
      <div style={{ display: "flex", gap: 6, padding: "12px 14px 8px", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              border: `1px solid ${tab === t.key ? T.accent : T.bdr}`,
              background: tab === t.key ? T.accentSoft : "transparent",
              color: tab === t.key ? T.accent : T.t2,
              borderRadius: 8, padding: "4px 12px", fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: JFONT,
            }}
          >{t.label}</button>
        ))}
      </div>
      <div style={{ maxHeight: 440, overflowY: "auto", padding: "0 4px 8px" }}>
        {filtered.length === 0
          ? <div style={{ padding: "20px", textAlign: "center", fontSize: 12, color: T.t2 }}>暂无记录</div>
          : filtered.map((entry) => (
            <PracticeRow
              key={entry.sourceIndex}
              entry={entry}
              isExpanded={expandedId === entry.sourceIndex}
              onToggle={() => setExpandedId(expandedId === entry.sourceIndex ? null : entry.sourceIndex)}
              onDelete={onDelete}
              typeAvgs={typeAvgs}
            />
          ))
        }
      </div>
    </div>
  );
}

/* ─── Main ProgressView ──────────────────────────────────── */
export function ProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
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
  const mockEntries = useMemo(
    () => entries.filter((e) => e.session.type === "mock").sort((a, b) => new Date(b.session.date) - new Date(a.session.date)),
    [entries],
  );
  const practiceEntries = useMemo(
    () => entries.filter((e) => e.session.type !== "mock").sort((a, b) => new Date(b.session.date) - new Date(a.session.date)),
    [entries],
  );
  const bs = stats.byType.bs;
  const em = stats.byType.email;
  const di = stats.byType.discussion;

  const sparkData = useMemo(() => {
    const srt = (arr, getV) => [...arr].sort((a, b) => new Date(a.date) - new Date(b.date)).map(getV).filter((v) => v !== null && Number.isFinite(v));
    const bsV = (s) => { const t = Number(s.total || 0), c = Number(s.correct || 0); return t > 0 ? (c / t) * 5 : null; };
    return {
      bs: srt(bs, bsV),
      email: srt(em, (s) => Number.isFinite(s.score) ? s.score : null),
      discussion: srt(di, (s) => Number.isFinite(s.score) ? s.score : null),
    };
  }, [bs, em, di]);

  const typeAvgs = useMemo(() => {
    let bsValid = 0, bsSum = 0;
    bs.forEach((s) => { const t = Number(s.total || 0), c = Number(s.correct || 0); if (t > 0) { bsSum += (c / t) * 100; bsValid++; } });
    return {
      bs: bsValid > 0 ? bsSum / bsValid : null,
      email: em.length > 0 ? em.reduce((a, s) => a + s.score, 0) / em.length : null,
      discussion: di.length > 0 ? di.reduce((a, s) => a + s.score, 0) / di.length : null,
    };
  }, [bs, em, di]);

  useEffect(() => {
    if (!hist || !stats.hasPendingMock) return;
    const t = setInterval(() => setHist(loadHist()), 3000);
    return () => clearInterval(t);
  }, [hist, stats.hasPendingMock]);

  function handleDelete(sourceIndex) {
    if (!window.confirm("删除这条记录？")) return;
    setHist({ ...deleteSession(sourceIndex) });
  }
  function handleClearAll() {
    if (!window.confirm("删除所有练习记录？")) return;
    setHist({ ...clearAllSessions() });
  }

  // Stats for stat cards
  const bsAvgStat = (() => {
    let v = 0, s = 0;
    bs.forEach((x) => { const t = Number(x.total || 0), c = Number(x.correct || 0); if (t > 0) { s += (c / t) * 100; v++; } });
    return v ? `均 ${Math.round(s / v)}%` : "—";
  })();
  const emAvgStat = em.length ? `均 ${(em.reduce((a, s) => a + s.score, 0) / em.length).toFixed(1)}/5` : "—";
  const diAvgStat = di.length ? `均 ${(di.reduce((a, s) => a + s.score, 0) / di.length).toFixed(1)}/5` : "—";

  if (!hist) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, fontFamily: JFONT, display: "flex", alignItems: "center", justifyContent: "center", color: T.t2 }}>
        加载中…
      </div>
    );
  }

  const isEmpty = entries.length === 0;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: JFONT }}>
      <style>{`
        @keyframes slideDown { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes tooltipIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      `}</style>
      <TopBar title="练习记录" section="Progress" onExit={onBack} />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 16px 48px" }}>
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: T.t1, margin: 0, lineHeight: 1.2, fontFamily: JFONT }}>练习记录</h1>
          <p style={{ fontSize: 13, color: T.t2, margin: "4px 0 0", fontFamily: JFONT }}>
            {practiceEntries.length} 次练习 · {mockEntries.length} 次模考
          </p>
        </div>

        {isEmpty ? (
          <div style={{ background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 14, padding: 48, textAlign: "center", color: T.t2, fontSize: 13 }}>
            还没有任何记录，开始你的第一次练习吧
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Stat Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <StatCard icon="🧩" label="Build" color={T.build} n={bs.length} stat={bsAvgStat} sparkData={sparkData.bs} uid="bs" />
              <StatCard icon="📧" label="Email" color={T.email} n={em.length} stat={emAvgStat} sparkData={sparkData.email} uid="email" />
              <StatCard icon="💬" label="Discussion" color={T.disc} n={di.length} stat={diAvgStat} sparkData={sparkData.discussion} uid="disc" />
            </div>

            {/* Mock Exams */}
            <CollapsibleCard emoji="🎯" title="模考成绩" badge={mockEntries.length || null}>
              <MockSection mockEntries={mockEntries} />
            </CollapsibleCard>

            {/* Progress Tracking */}
            <CollapsibleCard emoji="📈" title="进步追踪">
              <ProgressSection bs={bs} email={em} discussion={di} />
            </CollapsibleCard>

            {/* Weakness Analysis */}
            <CollapsibleCard emoji="🔍" title="薄弱点分析">
              <WeaknessSection email={em} discussion={di} />
            </CollapsibleCard>

            {/* Practice Details */}
            <CollapsibleCard emoji="📋" title="练习详情" badge={practiceEntries.length} defaultOpen={true}>
              <PracticeSection practiceEntries={practiceEntries} typeAvgs={typeAvgs} onDelete={handleDelete} />
            </CollapsibleCard>

            {/* Footer */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
              <button onClick={onBack}
                style={{ background: T.card, color: T.accent, border: `1px solid ${T.bdr}`, borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: JFONT }}>
                ← 返回
              </button>
              <button onClick={handleClearAll}
                style={{ background: "none", color: T.red, border: `1px solid ${T.red}30`, borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: JFONT }}>
                清除全部
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
