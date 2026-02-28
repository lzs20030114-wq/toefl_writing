"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { clearAllSessions, deleteSession, loadHist, SESSION_STORE_EVENTS } from "../lib/sessionStore";
import { buildHistoryEntries, buildHistoryStats } from "../lib/history/viewModel";
import { Btn, C, PageShell, SurfaceCard, TopBar } from "./shared/ui";
import { HistoryRow } from "./history/HistoryRow";

const TASK_UI = {
  bs: { label: "拼句练习", short: "拼句", color: "#d97706", soft: "#fffbeb", icon: "🧩" },
  email: { label: "邮件写作", short: "邮件", color: "#0891b2", soft: "#ecfeff", icon: "📧" },
  discussion: { label: "学术讨论", short: "讨论", color: "#0d9668", soft: "#ecfdf5", icon: "💬" },
};

function fmtDate(value) {
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value || "");
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  } catch {
    return String(value || "");
  }
}

function smoothPath(points) {
  if (!points || points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
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
    .map((item) => ({ date: item.date, ts: item.ts, avg: item.values.reduce((sum, value) => sum + value, 0) / item.values.length }))
    .sort((a, b) => a.ts - b.ts);
}

function getBandColor(band) {
  if (band >= 5.5) return "#16a34a";
  if (band >= 4.5) return "#2563eb";
  if (band >= 3.5) return "#d97706";
  if (band >= 2.5) return "#ea580c";
  return "#dc2626";
}

function getBuildAvgPercent(sessions) {
  let valid = 0;
  let sum = 0;
  sessions.forEach((session) => {
    const total = Number(session.total || 0);
    const correct = Number(session.correct || 0);
    if (total > 0) {
      sum += (correct / total) * 100;
      valid += 1;
    }
  });
  return valid > 0 ? sum / valid : null;
}

function getWritingAvg(sessions) {
  if (!sessions.length) return null;
  const values = sessions.map((session) => Number(session.score)).filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function StatCard({ icon, title, value, hint, color, soft }) {
  return (
    <SurfaceCard style={{ padding: "14px 14px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
        <div style={{ width: 34, height: 34, borderRadius: 11, background: soft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{icon}</div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color }}>{title}</div>
          <div style={{ fontSize: 11, color: C.t3 }}>{hint}</div>
        </div>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: C.t1, lineHeight: 1.05 }}>{value}</div>
    </SurfaceCard>
  );
}

function SectionCard({ icon, title, badge, open, onToggle, children }) {
  return (
    <SurfaceCard style={{ overflow: "hidden" }}>
      <button onClick={onToggle} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "13px 15px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: C.ltB, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.t1 }}>{title}</div>
        </div>
        {badge != null ? <span style={{ fontSize: 11, fontWeight: 700, color: C.blue, background: C.softBlue, borderRadius: 999, padding: "3px 9px" }}>{badge}</span> : null}
        <span style={{ fontSize: 11, color: C.t3 }}>{open ? "收起" : "展开"}</span>
      </button>
      {open ? <div style={{ borderTop: "1px solid " + C.bdrSubtle }}>{children}</div> : null}
    </SurfaceCard>
  );
}

function SkeletonView() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SurfaceCard style={{ padding: 18 }}>
        <div style={{ height: 20, width: 168, background: "#e5e7eb", borderRadius: 999, marginBottom: 8 }} />
        <div style={{ height: 14, width: 240, background: "#eef2f7", borderRadius: 999 }} />
      </SurfaceCard>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {[1, 2, 3].map((i) => <SurfaceCard key={i} style={{ padding: 16, minHeight: 108, background: "#ffffff" }} />)}
      </div>
      {[1, 2, 3, 4].map((i) => <SurfaceCard key={i} style={{ minHeight: 80 }} />)}
    </div>
  );
}

function MockSection({ mockEntries }) {
  const [expanded, setExpanded] = useState(null);
  if (mockEntries.length === 0) {
    return <div style={{ padding: "22px 16px", textAlign: "center", color: C.t2, fontSize: 12 }}>暂无模考记录。</div>;
  }

  const latest = mockEntries[0].session;
  const scored = mockEntries.map((entry) => entry.session).filter((session) => Number.isFinite(session.band));
  const bestBand = scored.length ? Math.max(...scored.map((session) => session.band)) : null;

  function getTask(session, taskId) {
    return Array.isArray(session?.details?.tasks) ? session.details.tasks.find((task) => task?.taskId === taskId) : null;
  }

  return (
    <div style={{ padding: "14px 15px 16px" }}>
      {Number.isFinite(latest?.band) ? (
        <SurfaceCard style={{ padding: 14, marginBottom: 12, background: C.softBlue, borderColor: "#bfdbfe", boxShadow: "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.t2, marginBottom: 6 }}>最近一次模考</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 24, fontWeight: 800, color: getBandColor(latest.band) }}>段位 {latest.band.toFixed(1)}</span>
                <span style={{ fontSize: 12, color: C.t2 }}>换算分 {latest.scaledScore ?? "--"}/30</span>
                {latest.cefr ? <span style={{ fontSize: 12, color: C.t2 }}>CEFR {latest.cefr}</span> : null}
              </div>
            </div>
            {bestBand !== null ? <div style={{ fontSize: 13, color: C.t2 }}>历史最好：<b style={{ color: getBandColor(bestBand) }}>{bestBand.toFixed(1)}</b></div> : null}
          </div>
        </SurfaceCard>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {mockEntries.map((entry) => {
          const session = entry.session;
          const open = expanded === entry.sourceIndex;
          const emailTask = getTask(session, "email-writing");
          const discTask = getTask(session, "academic-writing");
          const buildTask = getTask(session, "build-sentence");
          return (
            <SurfaceCard key={entry.sourceIndex} style={{ padding: 0, overflow: "hidden", boxShadow: "none" }}>
              <button onClick={() => setExpanded(open ? null : entry.sourceIndex)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}>
                {Number.isFinite(session.band) ? <span style={{ fontSize: 11, fontWeight: 700, background: getBandColor(session.band) + "20", color: getBandColor(session.band), borderRadius: 999, padding: "3px 7px" }}>{session.band.toFixed(1)}</span> : <span style={{ fontSize: 11, color: C.t3 }}>待评分</span>}
                <span style={{ fontSize: 12, color: C.t2, flex: 1 }}>{fmtDate(session.date)}</span>
                <span style={{ fontSize: 11, color: C.t2, whiteSpace: "nowrap" }}>拼句 {Number.isFinite(buildTask?.score) ? `${buildTask.score}/${buildTask.maxScore}` : "待定"} / 邮件 {Number.isFinite(emailTask?.score) ? `${emailTask.score}/${emailTask.maxScore}` : "待定"} / 讨论 {Number.isFinite(discTask?.score) ? `${discTask.score}/${discTask.maxScore}` : "待定"}</span>
                <span style={{ fontSize: 11, color: C.t3 }}>{open ? "收起" : "展开"}</span>
              </button>
              {open ? <div style={{ padding: "0 13px 13px" }}><HistoryRow entry={entry} isExpanded={true} isLast={true} onToggle={() => {}} onDelete={() => {}} detailOnly={true} /></div> : null}
            </SurfaceCard>
          );
        })}
      </div>
    </div>
  );
}

function TrendChart({ bs, email, discussion }) {
  const [hidden, setHidden] = useState({ bs: false, email: false, discussion: false });
  const [tooltip, setTooltip] = useState(null);
  const svgRef = useRef(null);
  const width = 520;
  const height = 200;
  const marginLeft = 34;
  const marginTop = 12;
  const marginRight = 12;
  const marginBottom = 28;
  const chartWidth = width - marginLeft - marginRight;
  const chartHeight = height - marginTop - marginBottom;
  const emailValue = (session) => Number.isFinite(session.score) ? session.score : null;
  const buildValue = (session) => {
    const total = Number(session.total || 0);
    const correct = Number(session.correct || 0);
    return total > 0 ? (correct / total) * 5 : null;
  };
  const lines = [
    { key: "email", label: "邮件写作", color: TASK_UI.email.color, pts: aggregateByDay(email, emailValue) },
    { key: "discussion", label: "学术讨论", color: TASK_UI.discussion.color, pts: aggregateByDay(discussion, emailValue) },
    { key: "bs", label: "拼句练习", color: TASK_UI.bs.color, pts: aggregateByDay(bs, buildValue) },
  ];
  const allPoints = lines.flatMap((line) => line.pts);
  if (!allPoints.length) return <div style={{ padding: "18px", fontSize: 12, color: C.t2, textAlign: "center" }}>暂无趋势数据。</div>;
  const minTs = Math.min(...allPoints.map((point) => point.ts));
  const maxTs = Math.max(...allPoints.map((point) => point.ts));
  const span = maxTs - minTs || 864e5;
  const toX = (ts) => marginLeft + ((ts - minTs) / span) * chartWidth;
  const toY = (value) => marginTop + (1 - value / 5) * chartHeight;
  const yGrid = [0, 1, 2, 3, 4, 5];
  const allDates = [...new Set(allPoints.map((point) => point.date))].sort();
  const shownDates = allDates.length <= 5 ? allDates : [allDates[0], allDates[Math.floor(allDates.length / 2)], allDates[allDates.length - 1]];

  function handleMouseMove(event) {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const svgX = (px / rect.width) * width;
    let bestDist = 22;
    let bestTs = null;
    lines.forEach((line) => {
      if (hidden[line.key]) return;
      line.pts.forEach((point) => {
        const dist = Math.abs(toX(point.ts) - svgX);
        if (dist < bestDist) {
          bestDist = dist;
          bestTs = point.ts;
        }
      });
    });
    if (bestTs === null) {
      setTooltip(null);
      return;
    }
    const near = lines.filter((line) => !hidden[line.key]).flatMap((line) => line.pts.filter((point) => point.ts === bestTs).map((point) => ({ key: line.key, label: line.label, color: line.color, avg: point.avg, date: point.date })));
    setTooltip({ left: px > rect.width * 0.6 ? px - 140 : px + 16, top: 8, svgX: toX(bestTs), near });
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {lines.map((line) => <button key={line.key} onClick={() => setHidden((prev) => ({ ...prev, [line.key]: !prev[line.key] }))} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid " + (hidden[line.key] ? C.bdr : line.color), background: hidden[line.key] ? "#fff" : line.color + "12", color: hidden[line.key] ? C.t3 : line.color, borderRadius: 999, padding: "4px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}><span style={{ width: 9, height: 9, borderRadius: 999, background: hidden[line.key] ? C.bdr : line.color }} />{line.label}</button>)}
      </div>
      <div style={{ position: "relative" }}>
        <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block", overflow: "visible" }} onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>
          {yGrid.map((y) => (
            <g key={y}>
              <line x1={marginLeft} y1={toY(y)} x2={marginLeft + chartWidth} y2={toY(y)} stroke={y === 0 ? C.bdr : "#edf2ef"} strokeWidth={1} strokeDasharray={y === 0 ? "none" : "3,3"} />
              <text x={marginLeft - 5} y={toY(y) + 3.5} fontSize={9} fill={C.t3} textAnchor="end">{y}</text>
            </g>
          ))}
          <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={marginTop + chartHeight} stroke={C.bdr} strokeWidth={1} />
          {shownDates.map((date) => {
            const point = allPoints.find((item) => item.date === date);
            if (!point) return null;
            const [, month, day] = date.split("-");
            return <text key={date} x={toX(point.ts)} y={height - 4} fontSize={9} fill={C.t3} textAnchor="middle">{month}/{day}</text>;
          })}
          {tooltip ? <rect x={tooltip.svgX - 16} y={marginTop} width={32} height={chartHeight} fill={C.softBlue} opacity={0.65} rx={4} /> : null}
          {lines.map((line) => {
            if (hidden[line.key] || !line.pts.length) return null;
            const coords = line.pts.map((point) => ({ x: toX(point.ts), y: toY(point.avg) }));
            return (
              <g key={line.key}>
                {line.pts.length > 1 ? <path d={smoothPath(coords)} fill="none" stroke={line.color} strokeWidth={2} strokeLinecap="round" /> : null}
                {coords.map((point, index) => <circle key={index} cx={point.x.toFixed(1)} cy={point.y.toFixed(1)} r={line.pts.length === 1 ? 5 : 3.5} fill="#fff" stroke={line.color} strokeWidth={1.5} />)}
              </g>
            );
          })}
          {tooltip ? <line x1={tooltip.svgX} y1={marginTop} x2={tooltip.svgX} y2={marginTop + chartHeight} stroke={C.blue} strokeWidth={1} strokeDasharray="2,2" opacity={0.45} /> : null}
        </svg>
        {tooltip && tooltip.near.length ? (
          <div style={{ position: "absolute", left: tooltip.left, top: tooltip.top, background: "#fff", border: "1px solid " + C.bdr, borderRadius: 12, padding: "7px 10px", fontSize: 11, pointerEvents: "none", zIndex: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.08)", minWidth: 118 }}>
            <div style={{ fontSize: 10, color: C.t3, marginBottom: 6, fontWeight: 700 }}>{tooltip.near[0].date}</div>
            {tooltip.near.map((point) => <div key={point.key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><span style={{ width: 7, height: 7, borderRadius: 999, background: point.color }} /><span style={{ color: point.color, fontWeight: 700 }}>{point.label}</span><span style={{ color: C.t1 }}>{point.avg.toFixed(1)}/5</span></div>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProgressSection({ bs, email, discussion }) {
  function halfStats(sessions, getValue) {
    const valid = sessions.map((session) => ({ session, value: getValue(session) })).filter((item) => item.value !== null && Number.isFinite(item.value)).sort((a, b) => new Date(a.session.date) - new Date(b.session.date));
    if (valid.length < 4) return null;
    const mid = Math.floor(valid.length / 2);
    const earlyAvg = valid.slice(0, mid).reduce((sum, item) => sum + item.value, 0) / mid;
    const lateAvg = valid.slice(mid).reduce((sum, item) => sum + item.value, 0) / (valid.length - mid);
    return { earlyAvg, lateAvg, diff: lateAvg - earlyAvg };
  }
  const buildValue = (session) => {
    const total = Number(session.total || 0);
    const correct = Number(session.correct || 0);
    return total > 0 ? (correct / total) * 5 : null;
  };
  const writeValue = (session) => Number.isFinite(session.score) ? session.score : null;
  const comparisons = [
    { key: "email", icon: TASK_UI.email.icon, label: TASK_UI.email.label, color: TASK_UI.email.color, stats: halfStats(email, writeValue) },
    { key: "discussion", icon: TASK_UI.discussion.icon, label: TASK_UI.discussion.label, color: TASK_UI.discussion.color, stats: halfStats(discussion, writeValue) },
    { key: "bs", icon: TASK_UI.bs.icon, label: TASK_UI.bs.label, color: TASK_UI.bs.color, stats: halfStats(bs, buildValue) },
  ];
  return (
    <div style={{ padding: "14px 15px 16px" }}>
      <TrendChart bs={bs} email={email} discussion={discussion} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 12 }}>
        {comparisons.map((item) => (
          <SurfaceCard key={item.key} style={{ padding: "11px 12px", background: item.stats ? "#fff" : "#fafafa", boxShadow: "none" }}>
            <div style={{ fontSize: 12, color: C.t2, marginBottom: 8 }}>{item.icon} {item.label}</div>
            {!item.stats ? <div style={{ fontSize: 12, color: C.t3 }}>数据不足，暂时无法判断趋势。</div> : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: C.t2 }}>{item.stats.earlyAvg.toFixed(1)}</span>
                <span style={{ fontSize: 12, color: C.t3 }}>→</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: C.t1 }}>{item.stats.lateAvg.toFixed(1)}/5</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 999, background: item.stats.diff >= 0 ? "#dcfce7" : "#fee2e2", color: item.stats.diff >= 0 ? C.green : C.red }}>{item.stats.diff >= 0 ? "提升" : "回落"} {Math.abs(item.stats.diff).toFixed(1)}</span>
              </div>
            )}
          </SurfaceCard>
        ))}
      </div>
    </div>
  );
}

function WeaknessSection({ email, discussion }) {
  const allSessions = [...email, ...discussion].filter((session) => session.details?.feedback).sort((a, b) => new Date(a.date) - new Date(b.date));
  if (allSessions.length < 2) {
    return <div style={{ padding: "22px 16px", textAlign: "center", fontSize: 12, color: C.t2 }}>继续练习后，系统会逐步总结你的高频薄弱点。</div>;
  }

  function getTags(session) {
    const feedback = session.details?.feedback;
    if (!feedback) return [];
    if (Array.isArray(feedback.weaknesses) && feedback.weaknesses.length > 0) {
      return feedback.weaknesses.map((item) => ({ tag: String(item || "").split(":")[0].trim(), text: String(item || "").trim() })).filter((item) => item.tag);
    }
    if (Array.isArray(feedback.patterns)) {
      return feedback.patterns.filter((item) => Number(item?.count || 0) > 0).map((item) => ({ tag: String(item.tag || "").trim(), text: `${item.tag}: ${item.summary || ""}`.trim() })).filter((item) => item.tag);
    }
    return [];
  }

  const tagFreq = {};
  const tagText = {};
  allSessions.forEach((session) => {
    getTags(session).forEach(({ tag, text }) => {
      tagFreq[tag] = (tagFreq[tag] || 0) + 1;
      tagText[tag] = text;
    });
  });
  const recurring = Object.entries(tagFreq).filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!recurring.length) {
    return <div style={{ padding: "22px 16px", textAlign: "center", fontSize: 12, color: C.t2 }}>继续练习后，系统会逐步总结你的高频薄弱点。</div>;
  }

  const lastFive = allSessions.slice(-5);
  const lastFiveSets = lastFive.map((session) => new Set(getTags(session).map((item) => item.tag)));

  return (
    <div style={{ padding: "12px 15px 15px", display: "flex", flexDirection: "column", gap: 8 }}>
      {recurring.map(([tag, count]) => {
        const inLastFive = lastFiveSets.filter((set) => set.has(tag)).length;
        const improved = inLastFive === 0;
        const persistent = lastFive.length >= 3 && inLastFive >= Math.ceil(lastFive.length * 0.6);
        return (
          <SurfaceCard key={tag} style={{ padding: "11px 12px", boxShadow: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240, fontSize: 13, color: improved ? C.t3 : C.t1, textDecoration: improved ? "line-through" : "none", opacity: improved ? 0.7 : 1 }}>{tagText[tag] || tag}</div>
              <span style={{ fontSize: 11, color: C.t3 }}>出现 {count} 次</span>
              {improved ? <span style={{ fontSize: 11, fontWeight: 700, background: "#dcfce7", color: C.green, borderRadius: 999, padding: "3px 8px" }}>近期已改善</span> : null}
              {!improved && persistent ? <span style={{ fontSize: 11, fontWeight: 700, background: "#fee2e2", color: C.red, borderRadius: 999, padding: "3px 8px" }}>近期仍高频</span> : null}
            </div>
          </SurfaceCard>
        );
      })}
    </div>
  );
}

function PracticeSection({ practiceEntries, typeAvgs, onDelete }) {
  const [tab, setTab] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const tabs = [
    { key: "all", label: "全部" },
    { key: "bs", label: "拼句" },
    { key: "email", label: "邮件" },
    { key: "discussion", label: "讨论" },
  ];
  const filtered = useMemo(() => {
    if (tab === "all") return practiceEntries;
    return practiceEntries.filter((entry) => entry.session.type === tab);
  }, [practiceEntries, tab]);

  return (
    <div style={{ padding: "14px 15px 16px" }}>
      <div style={{ display: "flex", gap: 8, paddingBottom: 10, flexWrap: "wrap" }}>
        {tabs.map((item) => <button key={item.key} onClick={() => setTab(item.key)} style={{ border: "1px solid " + (tab === item.key ? C.blue : C.bdr), background: tab === item.key ? C.softBlue : "#fff", color: tab === item.key ? C.blue : C.t2, borderRadius: 999, padding: "5px 11px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{item.label}</button>)}
      </div>
      <div style={{ maxHeight: 520, overflowY: "auto", paddingRight: 4 }}>
        {!filtered.length ? <div style={{ padding: "22px 0", textAlign: "center", fontSize: 12, color: C.t2 }}>当前筛选下暂无练习记录。</div> : filtered.map((entry, index) => <HistoryRow key={entry.sourceIndex} entry={entry} isExpanded={expandedId === entry.sourceIndex} isLast={index === filtered.length - 1} onToggle={() => setExpandedId(expandedId === entry.sourceIndex ? null : entry.sourceIndex)} onDelete={onDelete} typeAvgs={typeAvgs} />)}
      </div>
    </div>
  );
}

export function ProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
  const [openSections, setOpenSections] = useState({ mock: true, progress: true, weakness: true, practice: true });

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
  const mockEntries = useMemo(() => entries.filter((entry) => entry.session.type === "mock").sort((a, b) => new Date(b.session.date) - new Date(a.session.date)), [entries]);
  const practiceEntries = useMemo(() => entries.filter((entry) => entry.session.type !== "mock").sort((a, b) => new Date(b.session.date) - new Date(a.session.date)), [entries]);
  const bs = stats.byType.bs;
  const email = stats.byType.email;
  const discussion = stats.byType.discussion;

  const typeAvgs = useMemo(() => ({ bs: getBuildAvgPercent(bs), email: getWritingAvg(email), discussion: getWritingAvg(discussion) }), [bs, email, discussion]);

  useEffect(() => {
    if (!hist || !stats.hasPendingMock) return;
    const timer = setInterval(() => setHist(loadHist()), 3000);
    return () => clearInterval(timer);
  }, [hist, stats.hasPendingMock]);

  function toggleSection(key) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleDelete(sourceIndex) {
    if (!window.confirm("删除这条记录？")) return;
    setHist({ ...deleteSession(sourceIndex) });
  }

  function handleClearAll() {
    if (!window.confirm("删除全部练习记录？")) return;
    setHist({ ...clearAllSessions() });
  }

  const totalSessions = practiceEntries.length + mockEntries.length;
  const buildAvg = getBuildAvgPercent(bs);
  const emailAvg = getWritingAvg(email);
  const discussionAvg = getWritingAvg(discussion);

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      <TopBar title="练习记录" section="练习记录" onExit={onBack} />
      <PageShell>
        {!hist ? <SkeletonView /> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SurfaceCard style={{ padding: "18px 18px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <h1 style={{ fontSize: 24, fontWeight: 800, color: C.t1, margin: 0, lineHeight: 1.2 }}>练习记录</h1>
                  <p style={{ fontSize: 12, color: C.t2, margin: "5px 0 0" }}>{practiceEntries.length} 次练习，{mockEntries.length} 次模考，按时间倒序展示。</p>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <Btn onClick={onBack} variant="secondary">返回</Btn>
                  <Btn onClick={handleClearAll} variant="danger">清除全部</Btn>
                </div>
              </div>
            </SurfaceCard>

            {!entries.length ? (
              <SurfaceCard style={{ padding: 40, textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 8 }}>还没有练习记录</div>
                <div style={{ fontSize: 12, color: C.t2 }}>从主页开始一次练习后，这里会自动记录你的成绩、反馈与历史详情。</div>
              </SurfaceCard>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                  <StatCard icon={TASK_UI.bs.icon} title="拼句练习" value={String(bs.length)} hint={buildAvg !== null ? `平均正确率 ${Math.round(buildAvg)}%` : "暂无平均值"} color={TASK_UI.bs.color} soft={TASK_UI.bs.soft} />
                  <StatCard icon={TASK_UI.email.icon} title="邮件写作" value={String(email.length)} hint={emailAvg !== null ? `平均 ${emailAvg.toFixed(1)}/5` : "暂无平均值"} color={TASK_UI.email.color} soft={TASK_UI.email.soft} />
                  <StatCard icon={TASK_UI.discussion.icon} title="学术讨论" value={String(discussion.length)} hint={discussionAvg !== null ? `平均 ${discussionAvg.toFixed(1)}/5` : "暂无平均值"} color={TASK_UI.discussion.color} soft={TASK_UI.discussion.soft} />
                </div>

                <SectionCard icon="🎯" title="模考成绩" badge={mockEntries.length || null} open={openSections.mock} onToggle={() => toggleSection("mock")}>
                  <MockSection mockEntries={mockEntries} />
                </SectionCard>

                <SectionCard icon="📈" title="进步追踪" open={openSections.progress} onToggle={() => toggleSection("progress")}>
                  <ProgressSection bs={bs} email={email} discussion={discussion} />
                </SectionCard>

                <SectionCard icon="🔍" title="薄弱点分析" open={openSections.weakness} onToggle={() => toggleSection("weakness")}>
                  <WeaknessSection email={email} discussion={discussion} />
                </SectionCard>

                <SectionCard icon="📋" title="练习详情" badge={practiceEntries.length} open={openSections.practice} onToggle={() => toggleSection("practice")}>
                  <PracticeSection practiceEntries={practiceEntries} typeAvgs={typeAvgs} onDelete={handleDelete} />
                </SectionCard>

                <div style={{ fontSize: 12, color: C.t3, textAlign: "center" }}>共 {totalSessions} 条记录。展开详情可查看作答内容、评分反馈与历史操作入口。</div>
              </>
            )}
          </div>
        )}
      </PageShell>
    </div>
  );
}
