"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { C, FONT, Btn, PageShell, SurfaceCard, TopBar, ChevronIcon } from "../shared/ui";
import { loadHist, deleteSession, clearAllSessions, SESSION_STORE_EVENTS, setCurrentUser } from "../../lib/sessionStore";
import { getSavedCode } from "../../lib/AuthContext";
import { formatLocalDateTime } from "../../lib/utils";

const ACCENT = { color: "#F59E0B", soft: "#FFFBEB" };

const P = {
  bg: "#f4f7f5", surface: "#ffffff", border: "#dde5df", borderSubtle: "#ebf0ed",
  text: "#1a2420", textSec: "#5a6b62", textDim: "#94a39a",
  primary: "#F59E0B", primarySoft: "#FFFBEB",
  shadow: "0 1px 3px rgba(10,40,25,0.04), 0 1px 2px rgba(10,40,25,0.02)",
};

const SUBTYPE_META = {
  repeat:    { label: "听后复述", short: "复述", color: "#F59E0B", soft: "#FFFBEB", icon: "🔁" },
  interview: { label: "模拟面试", short: "面试", color: "#EF4444", soft: "#FEF2F2", icon: "🎤" },
};

function getSubtypeInfo(subtype) {
  return SUBTYPE_META[subtype] || SUBTYPE_META.repeat;
}

// -- Trend Chart (SVG) --

function SpeakingTrendChart({ sessions, filter }) {
  const svgRef = useRef(null);

  const filtered = filter === "all" ? sessions : sessions.filter(s => s.details?.subtype === filter);
  const byDay = {};
  filtered.forEach(s => {
    const d = new Date(s.date).toISOString().slice(0, 10);
    if (!byDay[d]) byDay[d] = { scores: [], date: d };
    const avg = s.details?.averageScore;
    if (avg != null && avg > 0) byDay[d].scores.push(avg);
  });

  const pts = Object.values(byDay)
    .filter(g => g.scores.length > 0)
    .map(g => ({
      date: g.date,
      ts: new Date(g.date).getTime(),
      avg: g.scores.reduce((a, b) => a + b, 0) / g.scores.length,
    }))
    .sort((a, b) => a.ts - b.ts);

  if (pts.length < 2) return <div style={{ padding: "16px 0", textAlign: "center", fontSize: 11, color: P.textDim }}>练习 2 天以上后显示趋势</div>;

  const maxScore = 5;
  const W = 400, H = 120, ML = 30, MR = 10, MT = 10, MB = 22;
  const cW = W - ML - MR, cH = H - MT - MB;
  const minTs = Math.min(...pts.map(p => p.ts)), maxTs = Math.max(...pts.map(p => p.ts));
  const span = maxTs - minTs || 864e5;
  const toX = ts => ML + ((ts - minTs) / span) * cW;
  const toY = v => MT + (1 - v / maxScore) * cH;

  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.ts).toFixed(1)},${toY(p.avg).toFixed(1)}`).join(" ");

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {[0, 2.5, 5].map(y => (
        <g key={y}>
          <line x1={ML} y1={toY(y)} x2={ML + cW} y2={toY(y)} stroke="#edf2ef" strokeWidth={1} strokeDasharray="3,3" />
          <text x={ML - 4} y={toY(y) + 3} fontSize={8} fill={P.textDim} textAnchor="end">{y}</text>
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

// -- Stat Card --

function StatCard({ icon, short, count, avg, color, active, onClick }) {
  const [hov, setHov] = useState(false);
  const avgMatch = typeof avg === "string" ? avg.match(/(\d+(?:\.\d+)?)/) : null;
  const avgNum = avgMatch ? parseFloat(avgMatch[1]) : null;
  // For speaking, scores are out of 5, so normalize to percentage for the progress bar
  const progressPct = avgNum != null ? (avgNum / 5) * 100 : null;

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

// -- Session Row --

function SessionRow({ session, expanded, onToggle, onDelete }) {
  const s = session;
  const subtype = s.details?.subtype || "repeat";
  const m = getSubtypeInfo(subtype);
  const avgScore = s.details?.averageScore;
  const topic = s.details?.topic || "";
  const attempted = s.details?.attempted || 0;
  const total = s.details?.total || 0;

  const scoreDisplay = avgScore != null ? `${avgScore}/5` : `${attempted}/${total}`;
  const scoreColor = avgScore != null
    ? (avgScore >= 4 ? "#059669" : avgScore >= 3 ? "#D97706" : "#E11D48")
    : P.textSec;

  return (
    <div style={{ transition: "all 0.2s" }}>
      <button onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          padding: "13px 16px", background: expanded ? `${m.color}06` : "none",
          border: "none", cursor: "pointer", transition: "all 0.15s", borderRadius: 10,
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = "#f8faf9"; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = expanded ? `${m.color}06` : "transparent"; }}
      >
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: `${m.color}10`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: m.color }}>{m.icon}</div>
          {expanded && <div style={{ position: "absolute", left: -6, top: 8, bottom: 8, width: 3, borderRadius: 2, background: m.color }} />}
        </div>
        <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: expanded ? 700 : 580, color: P.text }}>{m.label}{topic && <span style={{ fontSize: 11, color: P.textDim, fontWeight: 400, marginLeft: 6 }}>{topic}</span>}</div>
          <div style={{ fontSize: 11, color: P.textDim, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{formatLocalDateTime(s.date)}</div>
        </div>
        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 750, color: scoreColor, background: `${scoreColor}0C`, padding: "3px 10px", borderRadius: 8 }}>{scoreDisplay}</span>
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
      {expanded && (
        <div style={{ padding: "0 16px 14px 62px", animation: "fadeUp 0.2s ease" }}>
          {subtype === "repeat" ? <RepeatDetail session={s} /> : <InterviewDetail session={s} />}
        </div>
      )}
    </div>
  );
}

// -- Repeat Detail --

function RepeatDetail({ session }) {
  const items = session.details?.items || [];
  const elapsed = session.details?.elapsed || 0;
  const attempted = session.details?.attempted || 0;
  const total = session.details?.total || items.length;

  if (items.length === 0) {
    return <div style={{ fontSize: 12, color: P.textDim, fontStyle: "italic" }}>暂无详细练习数据</div>;
  }

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Summary bar */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: P.textSec, marginBottom: 4 }}>
        <span>录制 {attempted}/{total} 句</span>
        {elapsed > 0 && <span>用时 {formatTime(elapsed)}</span>}
      </div>

      {items.map((item, i) => {
        const score = item.score;
        const accuracy = score?.accuracy;
        const accColor = accuracy != null ? (accuracy >= 80 ? "#059669" : accuracy >= 60 ? "#D97706" : "#DC2626") : P.textDim;

        return (
          <div key={i} style={{
            padding: "10px 12px", borderRadius: 10,
            background: accuracy != null ? (accuracy >= 80 ? "#F0FDF4" : accuracy >= 60 ? "#FFFBEB" : "#FEF2F2") : "#F9FAFB",
            border: `1px solid ${accuracy != null ? (accuracy >= 80 ? "#BBF7D0" : accuracy >= 60 ? "#FDE68A" : "#FECACA") : P.borderSubtle}`,
          }}>
            {/* Sentence number + text */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                background: item.recorded ? `${ACCENT.color}15` : "#F3F4F6",
                color: item.recorded ? ACCENT.color : P.textDim,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700,
              }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Word-level highlight if score available */}
                {score && score.matchedWords && score.missedWords ? (
                  <WordHighlight
                    originalSentence={item.sentence}
                    matchedWords={score.matchedWords}
                    missedWords={score.missedWords}
                  />
                ) : (
                  <div style={{ fontSize: 13, color: P.text, lineHeight: 1.6 }}>
                    {item.sentence || "（句子内容不可用）"}
                  </div>
                )}
              </div>
            </div>

            {/* Accuracy bar */}
            {accuracy != null && (
              <div style={{ marginLeft: 30 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <div style={{ flex: 1, height: 4, background: "#E5E7EB", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 2, background: accColor, width: `${accuracy}%`, transition: "width 0.5s" }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 750, color: accColor, minWidth: 40, textAlign: "right" }}>{accuracy}%</span>
                </div>
              </div>
            )}

            {/* Extra words if any */}
            {score?.extraWords && score.extraWords.length > 0 && (
              <div style={{ marginLeft: 30, marginTop: 4, fontSize: 11, color: P.textDim }}>
                多余词: {score.extraWords.map((w, j) => (
                  <span key={j} style={{ display: "inline-block", margin: "1px 3px", padding: "1px 5px", background: "#F3F4F6", borderRadius: 4 }}>{w}</span>
                ))}
              </div>
            )}

            {/* Transcript if no score but transcript exists */}
            {!score && item.transcript && (
              <div style={{ marginLeft: 30, marginTop: 4, padding: "6px 10px", background: "#F9FAFB", border: `1px solid ${P.borderSubtle}`, borderRadius: 6, fontSize: 12, color: P.textSec, fontStyle: "italic", lineHeight: 1.5 }}>
                {item.transcript}
              </div>
            )}

            {/* Not recorded indicator */}
            {!item.recorded && (
              <div style={{ marginLeft: 30, fontSize: 11, color: P.textDim, fontStyle: "italic" }}>未录制</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// -- Word Highlight (reused from RepeatTask pattern) --

function WordHighlight({ originalSentence, matchedWords, missedWords }) {
  const origWords = String(originalSentence || "").split(/\s+/).filter(Boolean);
  const normalizeWord = (w) => w.toLowerCase().replace(/[^\w]/g, "");

  const matchedPool = [...(matchedWords || [])];
  const missedPool = [...(missedWords || [])];

  const styled = origWords.map((word, idx) => {
    const norm = normalizeWord(word);
    const matchIdx = matchedPool.indexOf(norm);
    if (matchIdx !== -1) {
      matchedPool.splice(matchIdx, 1);
      return <span key={idx} style={{ color: "#16A34A", fontWeight: 600 }}>{word} </span>;
    }
    const missIdx = missedPool.indexOf(norm);
    if (missIdx !== -1) {
      missedPool.splice(missIdx, 1);
      return <span key={idx} style={{ color: "#DC2626", textDecoration: "line-through", textDecorationColor: "#DC2626" }}>{word} </span>;
    }
    return <span key={idx} style={{ color: "#DC2626", textDecoration: "line-through", textDecorationColor: "#DC2626" }}>{word} </span>;
  });

  return <div style={{ fontSize: 13, lineHeight: 1.8 }}>{styled}</div>;
}

// -- Interview Detail --

const DIM_LABELS = {
  fluency: { label: "流利度", en: "Fluency" },
  intelligibility: { label: "可理解度", en: "Intelligibility" },
  language: { label: "语言使用", en: "Language" },
  organization: { label: "组织结构", en: "Organization" },
};

const DIM_COLORS = {
  fluency: "#F59E0B",
  intelligibility: "#0891B2",
  language: "#7C3AED",
  organization: "#16A34A",
};

function InterviewDetail({ session }) {
  const items = session.details?.items || [];
  const elapsed = session.details?.totalElapsed || session.details?.elapsed || 0;
  const attempted = session.details?.attempted || 0;
  const total = session.details?.total || items.length;
  const [expandedQ, setExpandedQ] = useState(null);

  if (items.length === 0) {
    return <div style={{ fontSize: 12, color: P.textDim, fontStyle: "italic" }}>暂无详细练习数据</div>;
  }

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Summary bar */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: P.textSec, marginBottom: 4 }}>
        <span>回答 {attempted}/{total} 题</span>
        {elapsed > 0 && <span>用时 {formatTime(elapsed)}</span>}
      </div>

      {items.map((item, i) => {
        const sc = item.aiScore;
        const hasScore = sc && !sc.error;
        const scoreColor = hasScore ? (sc.score >= 4 ? "#059669" : sc.score >= 3 ? "#D97706" : "#DC2626") : P.textDim;
        const isExpanded = expandedQ === i;

        return (
          <div key={i} style={{
            padding: "10px 12px", borderRadius: 10,
            background: hasScore ? (sc.score >= 4 ? "#F0FDF4" : sc.score >= 3 ? "#FFFBEB" : "#FEF2F2") : "#F9FAFB",
            border: `1px solid ${hasScore ? (sc.score >= 4 ? "#BBF7D0" : sc.score >= 3 ? "#FDE68A" : "#FECACA") : P.borderSubtle}`,
            cursor: "pointer",
          }}
            onClick={() => setExpandedQ(isExpanded ? null : i)}
          >
            {/* Question header */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                background: item.recorded ? "#EF444415" : "#F3F4F6",
                color: item.recorded ? "#EF4444" : P.textDim,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700,
              }}>Q{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: P.text, lineHeight: 1.6, fontWeight: 500 }}>
                  {item.question || "（问题内容不可用）"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  {item.category && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#EDE9FE", color: "#5B21B6" }}>{item.category}</span>
                  )}
                  {hasScore && (
                    <span style={{ fontSize: 11, fontWeight: 750, color: scoreColor, background: `${scoreColor}0C`, padding: "2px 8px", borderRadius: 6 }}>{sc.score}/5</span>
                  )}
                  {!item.recorded && (
                    <span style={{ fontSize: 10, color: P.textDim, fontStyle: "italic" }}>已跳过</span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 10, color: P.textDim }}>{isExpanded ? "▼" : "▶"}</span>
                </div>
              </div>
            </div>

            {/* Expanded: dimension bars + transcript + feedback */}
            {isExpanded && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${P.borderSubtle}` }}
                onClick={e => e.stopPropagation()}>
                {/* Dimension bars */}
                {hasScore && sc.dimensions && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                    {Object.entries(DIM_LABELS).map(([key, { label, en }]) => {
                      const dim = sc.dimensions[key];
                      if (!dim) return null;
                      const pct = (dim.score / 5) * 100;
                      const dimColor = DIM_COLORS[key];
                      return (
                        <div key={key}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: P.text }}>
                              {label} <span style={{ color: P.textDim, fontWeight: 400 }}>{en}</span>
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 800, color: dimColor }}>{dim.score}</span>
                          </div>
                          <div style={{ height: 4, background: "#E5E7EB", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: 2, background: dimColor, width: `${pct}%`, transition: "width 0.5s" }} />
                          </div>
                          {dim.feedback && (
                            <div style={{ fontSize: 11, color: P.textSec, lineHeight: 1.4, marginTop: 2 }}>{dim.feedback}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* AI summary */}
                {hasScore && sc.summary && (
                  <div style={{ padding: "8px 10px", background: "#F9FAFB", border: `1px solid ${P.borderSubtle}`, borderRadius: 8, fontSize: 12, color: P.text, lineHeight: 1.6, marginBottom: 8 }}>
                    {sc.summary}
                  </div>
                )}

                {/* Suggestions */}
                {hasScore && sc.suggestions && sc.suggestions.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: P.textDim, textTransform: "uppercase", marginBottom: 4 }}>改进建议</div>
                    {sc.suggestions.map((sug, j) => (
                      <div key={j} style={{ display: "flex", gap: 6, marginBottom: 3, fontSize: 11, color: P.textSec, lineHeight: 1.4 }}>
                        <span style={{ color: ACCENT.color, fontWeight: 700, flexShrink: 0 }}>{j + 1}.</span>
                        <span>{sug}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Transcript */}
                {item.transcript && (
                  <div style={{ padding: "8px 10px", background: "#F9FAFB", border: `1px solid ${P.borderSubtle}`, borderRadius: 8, fontSize: 12, color: P.textSec, lineHeight: 1.5, fontStyle: "italic", maxHeight: 100, overflowY: "auto" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: P.textDim, fontStyle: "normal" }}>Transcript: </span>
                    {item.transcript}
                  </div>
                )}

                {/* No data fallback */}
                {!hasScore && !item.transcript && item.recorded && (
                  <div style={{ fontSize: 12, color: P.textDim, fontStyle: "italic" }}>评分数据不可用</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// -- Main View --

export function SpeakingProgressView({ onBack }) {
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
    return hist.sessions.filter(s => s.type === "speaking").sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [hist]);

  const filtered = useMemo(() => {
    if (filter === "all") return sessions;
    return sessions.filter(s => s.details?.subtype === filter);
  }, [sessions, filter]);

  const repeatSessions = sessions.filter(s => s.details?.subtype === "repeat");
  const interviewSessions = sessions.filter(s => s.details?.subtype === "interview");

  function avgScore(arr) {
    if (arr.length === 0) return null;
    const valid = arr.filter(s => s.details?.averageScore != null && s.details.averageScore > 0);
    if (valid.length === 0) return null;
    const sum = valid.reduce((a, s) => a + s.details.averageScore, 0);
    return Math.round((sum / valid.length) * 2) / 2;
  }

  const repeatAvg = avgScore(repeatSessions);
  const interviewAvg = avgScore(interviewSessions);
  const totalAvg = avgScore(sessions);

  const statItems = [
    { key: "all", icon: "📊", short: "全部", count: sessions.length, color: P.primary, avg: totalAvg !== null ? `平均 ${totalAvg}/5` : "" },
    { key: "repeat", icon: SUBTYPE_META.repeat.icon, short: SUBTYPE_META.repeat.short, count: repeatSessions.length, color: SUBTYPE_META.repeat.color, avg: repeatAvg !== null ? `平均 ${repeatAvg}/5` : "暂无" },
    { key: "interview", icon: SUBTYPE_META.interview.icon, short: SUBTYPE_META.interview.short, count: interviewSessions.length, color: SUBTYPE_META.interview.color, avg: interviewAvg !== null ? `平均 ${interviewAvg}/5` : "暂无" },
  ];

  function handleDelete(sourceIndex) {
    deleteSession(sourceIndex);
    setHist(loadHist());
    setExpandedIdx(null);
  }

  function confirmClearAll() {
    setShowClearConfirm(false);
    sessions.forEach((_, i) => {
      const idx = hist.sessions.findIndex(s => s === sessions[i]);
      if (idx >= 0) deleteSession(idx);
    });
    setHist(loadHist());
  }

  if (!hist) {
    return (
      <div style={{ minHeight: "100vh", background: P.bg, fontFamily: FONT }}>
        <TopBar title="口语练习记录" section="Speaking" onExit={onBack} accentColor={ACCENT.color} />
        <PageShell narrow><div style={{ textAlign: "center", padding: "60px 0", color: P.textDim }}>加载中...</div></PageShell>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: P.bg, fontFamily: FONT }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      <TopBar title="口语练习记录" section="Speaking" onExit={onBack} accentColor={ACCENT.color} />

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 20px 60px" }}>
        {sessions.length === 0 ? (
          <SurfaceCard style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 8 }}>暂无口语练习记录</div>
            <div style={{ fontSize: 12, color: P.textDim }}>完成口语练习后，记录会自动保存在这里。</div>
          </SurfaceCard>
        ) : (
          <>
            {/* Stats row: cards + trend chart */}
            <div style={{ display: "flex", gap: 14, marginBottom: 18, alignItems: "stretch", animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 80ms both" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flex: "0 0 48%" }}>
                {statItems.slice(0, 2).map(item => (
                  <StatCard key={item.key} {...item} active={filter === item.key} onClick={() => setFilter(item.key)} />
                ))}
                {/* Third stat card spans full width below */}
                <div style={{ gridColumn: "1 / -1" }}>
                  <StatCard {...statItems[2]} active={filter === statItems[2].key} onClick={() => setFilter(statItems[2].key)} />
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                {/* Trend chart */}
                <div style={{ flex: 1, minWidth: 0, padding: "12px 14px 8px", background: P.surface, borderRadius: 14, border: `1px solid ${P.borderSubtle}`, display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: P.textSec, marginBottom: 4 }}>分数趋势</div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <SpeakingTrendChart sessions={sessions} filter={filter} />
                  </div>
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
                >清空全部口语记录</button>
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
