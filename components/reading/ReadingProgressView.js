"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { C, FONT, Btn, PageShell, SurfaceCard, TopBar, ChevronIcon, ModeChip, NEUTRAL } from "../shared/ui";
import { loadHist, deleteSession, clearAllSessions, SESSION_STORE_EVENTS, setCurrentUser } from "../../lib/sessionStore";
import { getSavedCode } from "../../lib/AuthContext";
import { formatLocalDateTime } from "../../lib/utils";
import { buildDailyAveragePoints, getAccuracyPercent } from "../../lib/history/scoreMetrics";
import { relativeDateLabel } from "../../lib/history/dateGroup";
import { getBandColor } from "../../lib/history/bandColor";
import { StatCard } from "../shared/StatCard";
import { AccuracyTrendChart } from "../shared/AccuracyTrendChart";
import { MockSessionDetail } from "./MockSessionDetail";

const ACCENT = { color: "#3B82F6", soft: "#EFF6FF" };

const P = {
  ...NEUTRAL,
  primary: "#3B82F6", primarySoft: "#EFF6FF",
  ctw:  { color: "#D97706", soft: "#FFFBEB", icon: "Aa", label: "单词补全", short: "补全" },
  rdl:  { color: "#059669", soft: "#ECFDF5", icon: "📄", label: "日常阅读", short: "日常" },
  ap:   { color: "#6366F1", soft: "#EEF2FF", icon: "📚", label: "学术文章", short: "学术" },
  mock: { color: "#DC2626", soft: "#FEF2F2", icon: "🎯", label: "阅读模考", short: "模考" },
};

function getSubtypeInfo(subtype) {
  return P[subtype] || P.rdl;
}

// Older mock-exam sessions were saved with type "adaptive-reading" and a
// flat shape. Re-shape them inline so legacy history records still surface
// alongside new mock-exam records (which now save with the unified shape).
function normalizeReadingSession(s) {
  if (s?.type === "adaptive-reading") {
    const m1c = s.m1?.correct || 0, m1t = s.m1?.total || 0;
    const m2c = s.m2?.correct || 0, m2t = s.m2?.total || 0;
    return {
      ...s,
      type: "reading",
      mode: "mock",
      correct: m1c + m2c,
      total: m1t + m2t,
      band: s.band,
      details: {
        subtype: "mock",
        path: s.path,
        band: s.band,
        cefr: s.cefr,
        m1: s.m1,
        m2: s.m2,
        rawScore: s.rawScore,
      },
    };
  }
  return s;
}

// ── Trend Chart (SVG) ──

function ReadingTrendChart({ sessions, filter }) {
  const filtered = filter === "all" ? sessions : sessions.filter(s => s.details?.subtype === filter);
  const pts = buildDailyAveragePoints(filtered, getAccuracyPercent);
  return <AccuracyTrendChart pts={pts} accentColor={ACCENT.color} ticks={[0, 50, 100]} maxValue={100} tickSuffix="%" />;
}

// ── Session Row ──

function SessionRow({ session, expanded, onToggle, onDelete }) {
  const s = session;
  const subtype = s.details?.subtype || "rdl";
  const m = getSubtypeInfo(subtype);
  // Score fallback hierarchy:
  //   1. Top-level correct/total (set by normalizeReadingSession or fresh saves)
  //   2. For mock: sum of m1/m2 from details (covers old type=reading saves
  //      that pre-date the top-level correct/total fix)
  //   3. For practice: count from details.results[] (CTW/RDL/AP shape)
  let t, c;
  if (subtype === "mock") {
    const m1 = s.details?.m1 || {};
    const m2 = s.details?.m2 || {};
    t = Number(s.total) || (Number(m1.total) || 0) + (Number(m2.total) || 0);
    c = Number(s.correct) || (Number(m1.correct) || 0) + (Number(m2.correct) || 0);
  } else {
    const resultsArr = s.details?.results || [];
    t = Number(s.total || 0) || resultsArr.length;
    c = Number(s.correct || 0) || resultsArr.filter(r => r.isCorrect).length;
  }
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
          <div style={{ fontSize: 13, fontWeight: expanded ? 700 : 580, color: P.text, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span>{m.label}</span>
            {topic && <span style={{ fontSize: 11, color: P.textDim, fontWeight: 400 }}>{topic}</span>}
            <ModeChip mode={s.mode} />
          </div>
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
      {/* Practice list only — mock entries are rendered via the sidebar →
          right-pane MockSessionDetail flow, so no mock branch here anymore. */}
      {expanded && s.details?.results && (
        <div style={{ padding: "0 16px 14px 62px", animation: "fadeUp 0.2s ease" }}>
          {subtype === "ctw" ? <CTWDetail session={s} /> : <RDLDetail session={s} />}
        </div>
      )}
    </div>
  );
}

// Old simplified MockDetail removed — see MockSessionDetail.js for the full
// post-exam review (band cells + per-task drill-down with AI explanations).

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

// ── Band → color (for sidebar latest-mock + list dot) ──

// ── Latest Mock Card (sidebar) ──

function LatestMockCard({ session }) {
  if (!session) return null;
  const band = Number.isFinite(session.band) ? session.band : session.details?.band;
  const cefr = session.details?.cefr || session.cefr || "";
  const bc = getBandColor(band);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        background: `linear-gradient(135deg, ${P.primarySoft} 0%, #f0f9ff 100%)`,
        borderRadius: 14,
        border: `1px solid ${P.primary}18`,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          width: 50,
          height: 50,
          borderRadius: "50%",
          background: "#fff",
          border: `3px solid ${bc}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 800, color: bc, fontVariantNumeric: "tabular-nums" }}>
          {Number.isFinite(band) ? band.toFixed(1) : "—"}
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: P.textDim,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 4,
          }}
        >
          最新模考
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {cefr && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: 4,
                background: P.bg,
                border: `1px solid ${P.borderSubtle}`,
                color: P.textSec,
              }}
            >
              CEFR {cefr}
            </span>
          )}
          <span style={{ fontSize: 10, color: P.textDim }}>
            {new Date(session.date).toLocaleDateString("zh-CN")}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Mock list (sidebar) ──

function MockListSidebar({ entries, activeIdx, onSelect }) {
  const [open, setOpen] = useState(true);
  return (
    <div
      style={{
        background: P.surface,
        borderRadius: 12,
        border: `1px solid ${P.border}`,
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "12px 14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: P.bg,
          border: "none",
          borderBottom: open ? `1px solid ${P.borderSubtle}` : "none",
          cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: P.text }}>
          🎯 模考记录 ({entries.length})
        </span>
        <span style={{ fontSize: 11, color: P.textDim }}>{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div
          style={{
            maxHeight: 360,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            animation: "expandDown 0.3s cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          {entries.length === 0 ? (
            <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 12, color: P.textDim }}>
              暂无模考记录。
            </div>
          ) : (
            entries.map((entry, i) => {
              const s = entry.session;
              const band = Number.isFinite(s.band) ? s.band : s.details?.band;
              const bc = getBandColor(band);
              const path = s.details?.path || "";
              const isActive = activeIdx === entry.sourceIndex;
              const date = new Date(s.date);
              const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
              return (
                <button
                  key={entry.sourceIndex}
                  onClick={() => onSelect(isActive ? null : entry.sourceIndex)}
                  style={{
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: isActive ? `${bc}10` : "transparent",
                    border: "none",
                    borderLeft: `3px solid ${isActive ? bc : "transparent"}`,
                    borderBottom: i < entries.length - 1 ? `1px solid ${P.borderSubtle}` : "none",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = `${P.textDim}08`;
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      background: `${bc}15`,
                      border: `1.5px solid ${bc}40`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: bc,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {Number.isFinite(band) ? band.toFixed(1) : "—"}
                    </span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: P.text, lineHeight: 1.3 }}>
                      {dateStr}
                      <span style={{ fontSize: 10, color: P.textDim, fontWeight: 500, marginLeft: 6 }}>
                        {date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: P.textDim, marginTop: 2 }}>
                      {path ? (path === "upper" ? "Upper 路径" : path === "lower" ? "Lower 路径" : path) : "—"}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: P.textDim, flexShrink: 0 }}>{isActive ? "◀" : "▸"}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Mock Report Panel (right column when a mock is selected) ──

// MockReportPanel removed — MockSessionDetail now renders its own header
// (back button + title + CEFR/path tags + Overall Band + delete) to match
// the writing FullMockReport layout 1:1.

// ── Main View ──

export function ReadingProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
  const [filter, setFilter] = useState("all");
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [activeMockSrcIdx, setActiveMockSrcIdx] = useState(null);
  // Consume a `?mock=latest` deep link exactly once (from the post-exam
  // ResultsCard "查看本次逐题解析" button) so re-renders don't re-open it.
  const mockDeepLinkConsumed = useRef(false);

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

  // Build entries up-front so sourceIndex survives normalization (legacy
  // adaptive-reading records produce a new object ref, breaking indexOf
  // lookups later). Prefer cloud row id when present.
  const entries = useMemo(() => {
    if (!hist?.sessions) return [];
    return hist.sessions
      .map((s, i) => ({
        original: s,
        sourceIndex: Number.isFinite(Number(s?.id)) ? Number(s.id) : i,
      }))
      .filter((e) => e.original.type === "reading" || e.original.type === "adaptive-reading")
      .map((e) => ({ session: normalizeReadingSession(e.original), sourceIndex: e.sourceIndex }))
      .sort((a, b) => new Date(b.session.date) - new Date(a.session.date));
  }, [hist]);

  const sessions = useMemo(() => entries.map((e) => e.session), [entries]);
  const mockEntries = useMemo(
    () => entries.filter((e) => e.session.details?.subtype === "mock"),
    [entries],
  );

  // Deep link: when arriving via `?mock=latest`, auto-open the newest mock
  // (mockEntries is date-desc, so [0] is latest) and strip the param from the
  // URL so closing/re-rendering doesn't reopen it. Read window once (no
  // useSearchParams — the page has no Suspense boundary and it would break build).
  useEffect(() => {
    if (mockDeepLinkConsumed.current || typeof window === "undefined") return;
    if (mockEntries.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    mockDeepLinkConsumed.current = true;
    if (params.get("mock") !== "latest") return;
    setActiveMockSrcIdx(mockEntries[0].sourceIndex);
    try {
      params.delete("mock");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    } catch {}
  }, [mockEntries]);
  const practiceEntries = useMemo(
    () => entries.filter((e) => e.session.details?.subtype !== "mock"),
    [entries],
  );

  const filteredPractice = useMemo(() => {
    if (filter === "all") return practiceEntries;
    return practiceEntries.filter((e) => e.session.details?.subtype === filter);
  }, [practiceEntries, filter]);

  const ctwSessions = practiceEntries.filter((e) => e.session.details?.subtype === "ctw").map((e) => e.session);
  const rdlSessions = practiceEntries.filter((e) => e.session.details?.subtype === "rdl").map((e) => e.session);
  const apSessions = practiceEntries.filter((e) => e.session.details?.subtype === "ap").map((e) => e.session);
  const practiceSessions = practiceEntries.map((e) => e.session);

  function avgPct(arr) {
    if (arr.length === 0) return null;
    const scores = arr.map(getAccuracyPercent).filter(Number.isFinite);
    if (scores.length === 0) return null;
    const sum = scores.reduce((a, b) => a + b, 0);
    return Math.round(sum / scores.length);
  }

  const ctwAvg = avgPct(ctwSessions);
  const rdlAvg = avgPct(rdlSessions);
  const apAvg = avgPct(apSessions);
  const totalAvg = avgPct(practiceSessions);

  // Stats: only practice subtypes (mock has its own sidebar treatment +
  // mock band is on a different scale, doesn't share the % chart axis).
  const statItems = [
    { key: "all",  icon: "📊", short: "全部", count: practiceSessions.length, color: P.primary, avg: totalAvg !== null ? `平均 ${totalAvg}%` : "" },
    { key: "ctw",  icon: P.ctw.icon, short: P.ctw.short, count: ctwSessions.length, color: P.ctw.color, avg: ctwAvg !== null ? `平均 ${ctwAvg}%` : "暂无" },
    { key: "rdl",  icon: P.rdl.icon, short: P.rdl.short, count: rdlSessions.length, color: P.rdl.color, avg: rdlAvg !== null ? `平均 ${rdlAvg}%` : "暂无" },
    { key: "ap",   icon: P.ap.icon,  short: P.ap.short,  count: apSessions.length,  color: P.ap.color,  avg: apAvg !== null ? `平均 ${apAvg}%` : "暂无" },
  ];

  const activeMockEntry = mockEntries.find((e) => e.sourceIndex === activeMockSrcIdx) || null;

  function handleDelete(sourceIndex) {
    deleteSession(sourceIndex);
    setHist(loadHist());
    setExpandedIdx(null);
    if (activeMockSrcIdx === sourceIndex) setActiveMockSrcIdx(null);
  }

  function confirmClearAll() {
    setShowClearConfirm(false);
    // Delete reading entries one-by-one to avoid wiping non-reading history
    entries.forEach((e) => deleteSession(e.sourceIndex));
    setHist(loadHist());
    setActiveMockSrcIdx(null);
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
        @keyframes fadeUpReading { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes slideInRight { from { opacity:0; transform:translateX(24px) scale(0.99); } to { opacity:1; transform:translateX(0) scale(1); } }
        @keyframes slideInLeft { from { opacity:0; transform:translateX(-16px); } to { opacity:1; transform:translateX(0); } }
        @keyframes expandDown { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes tabFade { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
        @media (max-width: 960px) {
          .rp-layout { flex-direction: column !important; gap: 16px !important; }
          .rp-sidebar { width: 100% !important; position: static !important; }
        }
      `}</style>

      <TopBar title="阅读练习记录" section="Reading" onExit={onBack} accentColor={ACCENT.color} />

      {sessions.length === 0 ? (
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
          <SurfaceCard style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 8 }}>还没有阅读练习记录</div>
            <div style={{ fontSize: 12, color: P.textDim }}>完成阅读练习后，记录会自动保存在这里。</div>
          </SurfaceCard>
        </div>
      ) : (
        <div
          className="rp-layout"
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            padding: "24px 24px 60px",
            display: "flex",
            gap: 24,
            alignItems: "flex-start",
          }}
        >
          {/* Left sidebar: title + latest mock + mock list */}
          <aside
            className="rp-sidebar"
            style={{
              width: 320,
              flexShrink: 0,
              position: "sticky",
              top: 68,
              animation: "fadeUpReading 0.5s cubic-bezier(0.25,1,0.5,1) 60ms both",
            }}
          >
            <div style={{ marginBottom: 16 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: P.text, letterSpacing: "-0.03em", lineHeight: 1.2, margin: "0 0 6px" }}>
                阅读练习记录
              </h1>
              <p style={{ fontSize: 12, color: P.textDim, lineHeight: 1.6, margin: 0 }}>
                点击模考查看完整报告
              </p>
            </div>
            {mockEntries.length > 0 && <LatestMockCard session={mockEntries[0].session} />}
            <MockListSidebar
              entries={mockEntries}
              activeIdx={activeMockSrcIdx}
              onSelect={(idx) => setActiveMockSrcIdx(idx)}
            />
          </aside>

          {/* Right main: mock detail OR practice overview */}
          <main style={{ flex: 1, minWidth: 0, animation: "fadeUpReading 0.5s cubic-bezier(0.25,1,0.5,1) 120ms both" }}>
            {activeMockEntry ? (
              <MockSessionDetail
                key={activeMockEntry.sourceIndex}
                session={activeMockEntry.session}
                accent={ACCENT.color}
                onClose={() => setActiveMockSrcIdx(null)}
                onDelete={() => handleDelete(activeMockEntry.sourceIndex)}
              />
            ) : (
              <div key="overview" style={{ animation: "slideInLeft 0.35s cubic-bezier(0.16,1,0.3,1)" }}>
                {/* Stats row: 4 cards + trend chart (practice only) */}
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    marginBottom: 18,
                    alignItems: "stretch",
                    animation: "fadeUpReading 0.5s cubic-bezier(0.25,1,0.5,1) 80ms both",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flex: "0 0 52%" }}>
                    {statItems.map(({ key, ...rest }) => (
                      <StatCard key={key} {...rest} active={filter === key} onClick={() => setFilter(key)} />
                    ))}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "12px 14px 8px",
                      background: P.surface,
                      borderRadius: 14,
                      border: `1px solid ${P.borderSubtle}`,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: P.textSec, marginBottom: 4 }}>
                      正确率趋势
                    </div>
                    <div style={{ flex: 1, minHeight: 0 }}>
                      <ReadingTrendChart sessions={practiceSessions} filter={filter} />
                    </div>
                  </div>
                </div>

                {/* Practice list (no mocks — those are in the sidebar) */}
                <div
                  style={{
                    background: P.surface,
                    borderRadius: 16,
                    border: `1px solid ${P.borderSubtle}`,
                    overflow: "hidden",
                    animation: "fadeUpReading 0.5s cubic-bezier(0.25,1,0.5,1) 200ms both",
                  }}
                >
                  <div
                    style={{
                      padding: "14px 18px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 750, color: P.text, letterSpacing: "-0.02em" }}>
                      练习明细
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 550,
                        color: ACCENT.color,
                        background: `${ACCENT.color}08`,
                        padding: "3px 10px",
                        borderRadius: 999,
                      }}
                    >
                      {filteredPractice.length} 条记录
                    </span>
                  </div>
                  <div style={{ padding: "4px 14px 14px" }}>
                    {filteredPractice.length === 0 ? (
                      <div style={{ padding: "24px 0", textAlign: "center", fontSize: 12, color: P.textDim }}>
                        该分类暂无记录
                      </div>
                    ) : (() => {
                      let lastLabel = "";
                      return filteredPractice.map((entry, i) => {
                        const s = entry.session;
                        const d = new Date(s.date);
                        const label = relativeDateLabel(d);
                        const showHeader = label !== lastLabel;
                        lastLabel = label;
                        return (
                          <React.Fragment key={entry.sourceIndex}>
                            {showHeader && (
                              <div
                                style={{
                                  padding: "10px 6px 4px",
                                  fontSize: 11,
                                  fontWeight: 650,
                                  color: P.textDim,
                                  letterSpacing: "0.02em",
                                  borderTop: i === 0 ? "none" : `1px solid ${P.borderSubtle}`,
                                  marginTop: i === 0 ? 0 : 4,
                                }}
                              >
                                {label}
                              </div>
                            )}
                            <SessionRow
                              session={s}
                              expanded={expandedIdx === entry.sourceIndex}
                              onToggle={() =>
                                setExpandedIdx(expandedIdx === entry.sourceIndex ? null : entry.sourceIndex)
                              }
                              onDelete={() => handleDelete(entry.sourceIndex)}
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
                    <button
                      onClick={() => setShowClearConfirm(true)}
                      style={{
                        background: "none",
                        border: `1px solid ${P.borderSubtle}`,
                        color: P.textDim,
                        padding: "8px 18px",
                        borderRadius: 9,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 600,
                        transition: "all 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "#dc2626";
                        e.currentTarget.style.color = "#dc2626";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = P.borderSubtle;
                        e.currentTarget.style.color = P.textDim;
                      }}
                    >
                      清空全部阅读记录
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>确认清空？</span>
                      <button
                        onClick={confirmClearAll}
                        style={{
                          background: "#dc2626",
                          color: "#fff",
                          border: "none",
                          padding: "6px 14px",
                          borderRadius: 8,
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        确认
                      </button>
                      <button
                        onClick={() => setShowClearConfirm(false)}
                        style={{
                          background: P.surface,
                          border: `1px solid ${P.border}`,
                          color: P.textSec,
                          padding: "6px 14px",
                          borderRadius: 8,
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
