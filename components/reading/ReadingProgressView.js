"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { C, FONT, Btn, PageShell, SurfaceCard, TopBar, ChevronIcon } from "../shared/ui";
import { loadHist, deleteSession, clearAllSessions, SESSION_STORE_EVENTS, setCurrentUser } from "../../lib/sessionStore";
import { getSavedCode } from "../../lib/AuthContext";
import { formatLocalDateTime } from "../../lib/utils";

const ACCENT = { color: "#3B82F6", soft: "#EFF6FF" };

const P = {
  bg: "#f4f7f5", surface: "#ffffff", border: "#dde5df", borderSubtle: "#ebf0ed",
  text: "#1a2420", textSec: "#5a6b62", textDim: "#94a39a",
  primary: "#3B82F6", primarySoft: "#EFF6FF",
  ctw: { color: "#D97706", soft: "#FFFBEB", icon: "Aa", label: "单词补全", short: "补全" },
  rdl: { color: "#059669", soft: "#ECFDF5", icon: "📄", label: "日常阅读", short: "阅读" },
  shadow: "0 1px 3px rgba(10,40,25,0.04), 0 1px 2px rgba(10,40,25,0.02)",
};

function getSubtypeInfo(subtype) {
  return subtype === "ctw" ? P.ctw : P.rdl;
}

// ── Trend Chart (SVG) ──

function ReadingTrendChart({ sessions, filter }) {
  const svgRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const filtered = filter === "all" ? sessions : sessions.filter(s => s.details?.subtype === filter);
  const byDay = {};
  filtered.forEach(s => {
    const d = new Date(s.date).toISOString().slice(0, 10);
    if (!byDay[d]) byDay[d] = { scores: [], date: d };
    const t = Number(s.total || 0), c = Number(s.correct || 0);
    if (t > 0) byDay[d].scores.push(c / t * 100);
  });

  const pts = Object.values(byDay).map(g => ({
    date: g.date,
    ts: new Date(g.date).getTime(),
    avg: g.scores.reduce((a, b) => a + b, 0) / g.scores.length,
  })).sort((a, b) => a.ts - b.ts);

  if (pts.length < 2) return <div style={{ padding: "16px 0", textAlign: "center", fontSize: 11, color: P.textDim }}>练习 2 天以上后显示趋势</div>;

  const W = 400, H = 120, ML = 30, MR = 10, MT = 10, MB = 22;
  const cW = W - ML - MR, cH = H - MT - MB;
  const minTs = Math.min(...pts.map(p => p.ts)), maxTs = Math.max(...pts.map(p => p.ts));
  const span = maxTs - minTs || 864e5;
  const toX = ts => ML + ((ts - minTs) / span) * cW;
  const toY = v => MT + (1 - v / 100) * cH;

  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.ts).toFixed(1)},${toY(p.avg).toFixed(1)}`).join(" ");

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {[0, 50, 100].map(y => (
        <g key={y}>
          <line x1={ML} y1={toY(y)} x2={ML + cW} y2={toY(y)} stroke="#edf2ef" strokeWidth={1} strokeDasharray="3,3" />
          <text x={ML - 4} y={toY(y) + 3} fontSize={8} fill={P.textDim} textAnchor="end">{y}%</text>
        </g>
      ))}
      <path d={pathD} fill="none" stroke={ACCENT.color} strokeWidth={2} strokeLinecap="round" />
      {pts.map((p, i) => <circle key={i} cx={toX(p.ts).toFixed(1)} cy={toY(p.avg).toFixed(1)} r={3} fill="#fff" stroke={ACCENT.color} strokeWidth={1.5} />)}
      {pts.length > 0 && (() => {
        const dates = [pts[0], pts[pts.length - 1]];
        return dates.map((p, i) => {
          const [, m, d] = p.date.split("-");
          return <text key={i} x={toX(p.ts)} y={H - 4} fontSize={8} fill={P.textDim} textAnchor={i === 0 ? "start" : "end"}>{m}/{d}</text>;
        });
      })()}
    </svg>
  );
}

// ── Stat Card ──

function StatCard({ icon, short, count, avg, color, active, onClick }) {
  const [hov, setHov] = useState(false);
  const avgMatch = typeof avg === "string" ? avg.match(/(\d+(?:\.\d+)?)/) : null;
  const avgNum = avgMatch ? parseFloat(avgMatch[1]) : null;
  const progressPct = avgNum != null ? avgNum : null;

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

// ── Session Row ──

function SessionRow({ session, expanded, onToggle, onDelete }) {
  const s = session;
  const subtype = s.details?.subtype || "rdl";
  const m = getSubtypeInfo(subtype);
  const t = Number(s.total || 0), c = Number(s.correct || 0);
  const pct = t > 0 ? c / t : 0;
  const scoreColor = pct >= 0.8 ? "#059669" : pct >= 0.6 ? "#D97706" : "#E11D48";
  const topic = s.details?.topic || "";

  return (
    <div style={{ transition: "all 0.2s" }}>
      <button onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          padding: "13px 16px", background: expanded ? `${m.color}06` : "none",
          border: "none", cursor: "pointer", transition: "all 0.15s", borderRadius: 10,
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = "#f8faf9"; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = "transparent"; }}
      >
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: `${m.color}10`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: subtype === "ctw" ? 13 : 14, fontWeight: 700, color: m.color }}>{m.icon}</div>
          {expanded && <div style={{ position: "absolute", left: -6, top: 8, bottom: 8, width: 3, borderRadius: 2, background: m.color }} />}
        </div>
        <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: expanded ? 700 : 580, color: P.text }}>{m.label}{topic && <span style={{ fontSize: 11, color: P.textDim, fontWeight: 400, marginLeft: 6 }}>{topic}</span>}</div>
          <div style={{ fontSize: 11, color: P.textDim, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{formatLocalDateTime(s.date)}</div>
        </div>
        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 750, color: scoreColor, background: `${scoreColor}0C`, padding: "3px 10px", borderRadius: 8 }}>{c}/{t}</span>
        <ChevronIcon open={expanded} color={P.textDim} />
        <span role="button" tabIndex={0} title="删除"
          onClick={e => { e.stopPropagation(); if (onDelete) onDelete(); }}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 6, color: P.textDim, cursor: "pointer", transition: "all 0.15s", flexShrink: 0 }}
          onMouseEnter={e => { e.currentTarget.style.color = "#dc2626"; e.currentTarget.style.background = "#dc262612"; }}
          onMouseLeave={e => { e.currentTarget.style.color = P.textDim; e.currentTarget.style.background = "transparent"; }}
        >
          <svg viewBox="0 0 16 16" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M2.5 4.5h11M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M6.5 7v4.5M9.5 7v4.5M3.5 4.5l.5 8.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l.5-8.5" />
          </svg>
        </span>
      </button>
      {expanded && s.details?.results && (
        <div style={{ padding: "0 16px 14px 62px", animation: "fadeUp 0.2s ease" }}>
          {subtype === "ctw" ? <CTWDetail session={s} /> : <RDLDetail session={s} />}
        </div>
      )}
    </div>
  );
}

function CTWDetail({ session }) {
  const results = session.details?.results || [];
  const passage = session.details?.passage;
  const blanks = session.details?.blanks || [];

  // Map blank positions for quick lookup
  const blankByPos = {};
  blanks.forEach((b, i) => { blankByPos[b.position] = { blank: b, result: results[i], index: i }; });

  function renderMarkedPassage() {
    if (!passage) return null;
    const words = passage.split(/\s+/);

    return words.map((word, wi) => {
      const entry = blankByPos[wi];
      if (!entry) return <span key={wi}>{word} </span>;

      const { blank, result } = entry;
      const isCorrect = result?.isCorrect;
      const color = isCorrect ? "#059669" : "#DC2626";
      const bg = isCorrect ? "#D1FAE5" : "#FEE2E2";

      return (
        <span key={wi}>
          <span style={{
            background: bg, color, fontWeight: 700,
            borderRadius: 4, padding: "1px 4px",
            borderBottom: `2px solid ${color}`,
            fontFamily: "'Courier New', monospace", fontSize: 13,
          }}>
            {blank.original_word}
          </span>
          {/* Preserve trailing punctuation + space */}
          {word.match(/[.,;:!?]+$/)?.[0] || ""}{" "}
        </span>
      );
    });
  }

  return (
    <div>
      {/* Passage with blanks highlighted as colored inline tags */}
      {passage && (
        <div style={{ fontSize: 13, color: P.text, lineHeight: 2.2, padding: "14px 18px", background: "#fafbfa", borderRadius: 12, marginBottom: 12, border: `1px solid ${P.borderSubtle}` }}>
          {renderMarkedPassage()}
        </div>
      )}
      {/* Summary: correct vs total */}
      <div style={{ fontSize: 12, color: P.textSec, marginBottom: 8 }}>
        填空结果（<span style={{ color: "#059669", fontWeight: 600 }}>绿色</span> = 正确，<span style={{ color: "#DC2626", fontWeight: 600 }}>红色</span> = 错误）
      </div>
      {/* Compact blank pills in a table-like layout */}
      {results.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 6 }}>
          {results.map((r, i) => {
            const blank = r.blank || blanks[i] || {};
            const frag = blank.displayed_fragment || "";
            const full = blank.original_word || "";
            const missing = full.slice(frag.length);
            return (
              <div key={i} style={{
                fontSize: 12, padding: "5px 10px", borderRadius: 8,
                background: r.isCorrect ? "#F0FDF4" : "#FEF2F2",
                border: `1px solid ${r.isCorrect ? "#BBF7D0" : "#FECACA"}`,
                fontFamily: "'Courier New', monospace", fontWeight: 600,
                display: "flex", alignItems: "center", gap: 4,
              }}>
                <span style={{ color: r.isCorrect ? "#059669" : "#DC2626", fontSize: 11 }}>{r.isCorrect ? "✓" : "✗"}</span>
                <span style={{ color: P.textDim }}>{frag}</span>
                <span style={{ color: r.isCorrect ? "#059669" : "#DC2626" }}>{missing}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RDLDetail({ session }) {
  const results = session.details?.results;
  const passage = session.details?.passage;
  const questions = session.details?.questions;

  return (
    <div>
      {/* Original passage */}
      {passage && (
        <div style={{ fontSize: 13, color: P.text, lineHeight: 1.7, padding: "10px 14px", background: "#f8faf9", borderRadius: 10, marginBottom: 10, whiteSpace: "pre-wrap", maxHeight: 150, overflow: "auto" }}>
          {passage}
        </div>
      )}
      {/* Per-question detail with full stem + options */}
      {Array.isArray(results) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {results.map((r, i) => {
            const q = questions && questions[i];
            return (
              <div key={i} style={{ padding: "10px 12px", borderRadius: 10, background: r.isCorrect ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${r.isCorrect ? "#BBF7D0" : "#FECACA"}` }}>
                {/* Question stem */}
                <div style={{ fontSize: 13, fontWeight: 600, color: P.text, marginBottom: 6, display: "flex", alignItems: "flex-start", gap: 6 }}>
                  <span style={{ fontWeight: 700, color: r.isCorrect ? "#059669" : "#DC2626", flexShrink: 0 }}>{r.isCorrect ? "✓" : "✗"}</span>
                  <span>{q ? q.stem : `第 ${i + 1} 题`}</span>
                </div>
                {/* Options (if available) */}
                {q && q.options && (
                  <div style={{ marginLeft: 20, display: "flex", flexDirection: "column", gap: 3 }}>
                    {["A", "B", "C", "D"].map(key => {
                      if (!q.options[key]) return null;
                      const isUserChoice = r.selected === key;
                      const isCorrectOpt = r.correct === key;
                      let color = P.textDim;
                      let fontW = 400;
                      if (isCorrectOpt) { color = "#059669"; fontW = 600; }
                      if (isUserChoice && !r.isCorrect) { color = "#DC2626"; fontW = 600; }
                      return (
                        <div key={key} style={{ fontSize: 12, color, fontWeight: fontW }}>
                          {key}. {q.options[key]}
                          {isCorrectOpt && " ✓"}
                          {isUserChoice && !isCorrectOpt && " ← 你的选择"}
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* Explanation */}
                {q && q.explanation && (
                  <div style={{ marginTop: 6, marginLeft: 20, fontSize: 11, color: P.textSec, lineHeight: 1.5, fontStyle: "italic" }}>
                    {q.explanation}
                  </div>
                )}
                {/* Fallback if no question data saved */}
                {!q && (
                  <div style={{ marginLeft: 20, fontSize: 12, color: P.textSec }}>
                    选择: {r.selected}{!r.isCorrect && <span style={{ color: "#DC2626" }}> (正确: {r.correct})</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main View ──

export function ReadingProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
  const [filter, setFilter] = useState("all");
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    try { setCurrentUser(getSavedCode() || ""); } catch {}
    const refresh = () => setHist(loadHist());
    refresh();
    window.addEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const sessions = useMemo(() => {
    if (!hist?.sessions) return [];
    return hist.sessions.filter(s => s.type === "reading").sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [hist]);

  const filtered = useMemo(() => {
    if (filter === "all") return sessions;
    return sessions.filter(s => s.details?.subtype === filter);
  }, [sessions, filter]);

  const ctwSessions = sessions.filter(s => s.details?.subtype === "ctw");
  const rdlSessions = sessions.filter(s => s.details?.subtype === "rdl");

  function avgPct(arr) {
    if (arr.length === 0) return null;
    const sum = arr.reduce((s, sess) => { const t = Number(sess.total || 0), c = Number(sess.correct || 0); return t > 0 ? s + (c / t) * 100 : s; }, 0);
    return Math.round(sum / arr.length);
  }

  const ctwAvg = avgPct(ctwSessions);
  const rdlAvg = avgPct(rdlSessions);
  const totalAvg = avgPct(sessions);

  const statItems = [
    { key: "all", icon: "📊", short: "全部", count: sessions.length, color: P.primary, avg: totalAvg !== null ? `平均 ${totalAvg}%` : "" },
    { key: "ctw", icon: P.ctw.icon, short: P.ctw.short, count: ctwSessions.length, color: P.ctw.color, avg: ctwAvg !== null ? `平均 ${ctwAvg}%` : "暂无" },
    { key: "rdl", icon: P.rdl.icon, short: P.rdl.short, count: rdlSessions.length, color: P.rdl.color, avg: rdlAvg !== null ? `平均 ${rdlAvg}%` : "暂无" },
  ];

  function handleDelete(sourceIndex) {
    deleteSession(sourceIndex);
    setHist(loadHist());
    setExpandedIdx(null);
  }

  function confirmClearAll() {
    setShowClearConfirm(false);
    // Only clears reading sessions — clearAllSessions clears everything,
    // so we delete reading ones individually
    sessions.forEach((_, i) => {
      const idx = hist.sessions.findIndex(s => s === sessions[i]);
      if (idx >= 0) deleteSession(idx);
    });
    setHist(loadHist());
  }

  if (!hist) {
    return (
      <div style={{ minHeight: "100vh", background: P.bg, fontFamily: FONT }}>
        <TopBar title="阅读练习记录" section="Reading" onExit={onBack} accentColor={ACCENT.color} />
        <PageShell narrow><div style={{ textAlign: "center", padding: "60px 0", color: P.textDim }}>加载中...</div></PageShell>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: P.bg, fontFamily: FONT }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      <TopBar title="阅读练习记录" section="Reading" onExit={onBack} accentColor={ACCENT.color} />

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 20px 60px" }}>
        {sessions.length === 0 ? (
          <SurfaceCard style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 8 }}>还没有阅读练习记录</div>
            <div style={{ fontSize: 12, color: P.textDim }}>完成阅读练习后，记录会自动保存在这里。</div>
          </SurfaceCard>
        ) : (
          <>
            {/* Stats row: cards + trend chart */}
            <div style={{ display: "flex", gap: 14, marginBottom: 18, alignItems: "stretch", animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 80ms both" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, flex: "0 0 52%" }}>
                {statItems.map(item => (
                  <StatCard key={item.key} {...item} active={filter === item.key} onClick={() => setFilter(item.key)} />
                ))}
              </div>
              <div style={{ flex: 1, minWidth: 0, padding: "12px 14px 8px", background: P.surface, borderRadius: 14, border: `1px solid ${P.borderSubtle}`, display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: P.textSec, marginBottom: 4 }}>正确率趋势</div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <ReadingTrendChart sessions={sessions} filter={filter} />
                </div>
              </div>
            </div>

            {/* Session list with date grouping */}
            <div style={{ background: P.surface, borderRadius: 16, border: `1px solid ${P.borderSubtle}`, overflow: "hidden", animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 200ms both" }}>
              <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, fontWeight: 750, color: P.text, letterSpacing: "-0.02em" }}>练习明细</span>
                <span style={{ fontSize: 11, fontWeight: 550, color: ACCENT.color, background: `${ACCENT.color}08`, padding: "3px 10px", borderRadius: 999 }}>{filtered.length} 条记录</span>
              </div>
              <div style={{ padding: "4px 14px 14px" }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: "24px 0", textAlign: "center", fontSize: 12, color: P.textDim }}>该分类暂无记录</div>
                ) : (() => {
                  let lastLabel = "";
                  return filtered.map((s, i) => {
                    const d = new Date(s.date);
                    const today = new Date();
                    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
                    const label = d.toDateString() === today.toDateString() ? "今天" : d.toDateString() === yesterday.toDateString() ? "昨天" : `${d.getMonth() + 1}月${d.getDate()}日`;
                    const showHeader = label !== lastLabel;
                    lastLabel = label;
                    const sourceIdx = hist.sessions.indexOf(s);
                    return (
                      <React.Fragment key={i}>
                        {showHeader && (
                          <div style={{ padding: "10px 6px 4px", fontSize: 11, fontWeight: 650, color: P.textDim, letterSpacing: "0.02em", borderTop: i === 0 ? "none" : `1px solid ${P.borderSubtle}`, marginTop: i === 0 ? 0 : 4 }}>
                            {label}
                          </div>
                        )}
                        <SessionRow
                          session={s}
                          expanded={expandedIdx === i}
                          onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
                          onDelete={() => handleDelete(sourceIdx)}
                        />
                      </React.Fragment>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Clear all */}
            <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
              {!showClearConfirm ? (
                <button onClick={() => setShowClearConfirm(true)}
                  style={{ background: "none", border: `1px solid ${P.borderSubtle}`, color: P.textDim, padding: "8px 18px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#dc2626"; e.currentTarget.style.color = "#dc2626"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = P.borderSubtle; e.currentTarget.style.color = P.textDim; }}
                >清空全部阅读记录</button>
              ) : (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>确认清空？</span>
                  <button onClick={confirmClearAll} style={{ background: "#dc2626", color: "#fff", border: "none", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>确认</button>
                  <button onClick={() => setShowClearConfirm(false)} style={{ background: P.surface, border: `1px solid ${P.border}`, color: P.textSec, padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>取消</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
