"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { C, FONT, Btn, PageShell, SurfaceCard, TopBar, ChevronIcon, ModeChip, NEUTRAL } from "../shared/ui";
import { StatCard } from "../shared/StatCard";
import { AccuracyTrendChart } from "../shared/AccuracyTrendChart";
import { loadHist, deleteSession, clearAllSessions, SESSION_STORE_EVENTS, setCurrentUser } from "../../lib/sessionStore";
import { getSavedCode } from "../../lib/AuthContext";
import { formatLocalDateTime } from "../../lib/utils";
import { buildDailyAveragePoints, getAccuracyPercent } from "../../lib/history/scoreMetrics";
import { relativeDateLabel } from "../../lib/history/dateGroup";

const ACCENT = { color: "#8B5CF6", soft: "#F5F3FF" };

const P = {
  ...NEUTRAL,
  primary: "#8B5CF6", primarySoft: "#F5F3FF",
};

const SUBTYPE_META = {
  lcr:  { label: "选择回应", short: "LCR",  color: "#8B5CF6", soft: "#F3E8FF", icon: "💬" },
  la:   { label: "听公告",   short: "LA",   color: "#F59E0B", soft: "#FFFBEB", icon: "📢" },
  lc:   { label: "听对话",   short: "LC",   color: "#0891B2", soft: "#ECFEFF", icon: "🗣" },
  lat:  { label: "听讲座",   short: "LAT",  color: "#6366F1", soft: "#EEF2FF", icon: "🎓" },
  mock: { label: "听力模考", short: "模考", color: "#DC2626", soft: "#FEF2F2", icon: "🎯" },
};

function getSubtypeInfo(subtype) {
  return SUBTYPE_META[subtype] || SUBTYPE_META.lcr;
}

// Older mock-exam sessions were stored with type "adaptive-listening" and a
// flat shape (band/m1/m2 at top level) that no view ever filtered for.
// Re-shape them to the unified format on read so legacy history records
// still surface in the list.
function normalizeListeningSession(s) {
  if (s?.type === "adaptive-listening") {
    const m1c = s.m1?.correct || 0, m1t = s.m1?.total || 0;
    const m2c = s.m2?.correct || 0, m2t = s.m2?.total || 0;
    return {
      ...s,
      type: "listening",
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

// -- Trend Chart (SVG) --

function ListeningTrendChart({ sessions, filter }) {
  const filtered = filter === "all" ? sessions : sessions.filter(s => s.details?.subtype === filter);
  const pts = buildDailyAveragePoints(filtered, getAccuracyPercent);
  return <AccuracyTrendChart pts={pts} accentColor={ACCENT.color} ticks={[0, 50, 100]} maxValue={100} tickSuffix="%" />;
}

// -- Session Row --

function SessionRow({ session, expanded, onToggle, onDelete }) {
  const s = session;
  const subtype = s.details?.subtype || "lcr";
  const m = getSubtypeInfo(subtype);
  const resultsArr = s.details?.results || [];
  let t, c;
  if (subtype === "mock") {
    const m1 = s.details?.m1 || {};
    const m2 = s.details?.m2 || {};
    t = Number(s.total) || (Number(m1.total) || 0) + (Number(m2.total) || 0);
    c = Number(s.correct) || (Number(m1.correct) || 0) + (Number(m2.correct) || 0);
  } else {
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
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = expanded ? `${m.color}06` : "transparent"; }}
      >
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: `${m.color}10`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: m.color }}>{m.icon}</div>
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
      {expanded && (s.details?.results || subtype === "mock") && (
        <div style={{ padding: "0 16px 14px 62px", animation: "fadeUp 0.2s ease" }}>
          {subtype === "mock"
            ? <MockDetail session={s} />
            : subtype === "lcr" ? <LCRDetail session={s} />
            : subtype === "lc" ? <LCDetail session={s} />
            : <LADetail session={s} />}
        </div>
      )}
    </div>
  );
}

// -- Mock Detail (adaptive M1/M2 breakdown) --

function MockDetail({ session }) {
  const d = session.details || {};
  const m1 = d.m1 || { correct: 0, total: 0 };
  const m2 = d.m2 || { correct: 0, total: 0 };
  const band = d.band || session.band || "—";
  const cefr = d.cefr || "";
  const path = d.path || "";
  const m1Pct = m1.total > 0 ? Math.round((m1.correct / m1.total) * 100) : null;
  const m2Pct = m2.total > 0 ? Math.round((m2.correct / m2.total) * 100) : null;

  // Per-task snapshots saved by buildTaskSnapshots (AdaptiveExamShell): new
  // mocks carry them so every question can be replayed; older mocks only kept
  // the score summary.
  const tasks = [
    ...(Array.isArray(m1.tasks) ? m1.tasks : []).map((t) => ({ ...t, module: 1 })),
    ...(Array.isArray(m2.tasks) ? m2.tasks : []).map((t) => ({ ...t, module: 2 })),
  ];

  const cell = (label, value, hint) => (
    <div style={{ flex: 1, padding: "10px 12px", background: "#f8faf9", border: `1px solid ${P.borderSubtle}`, borderRadius: 8, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: P.textDim, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: P.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: P.textDim, marginTop: 1 }}>{hint}</div>}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {cell("Band", String(band), cefr ? `CEFR ${cefr}` : null)}
        {cell("Module 1", `${m1.correct}/${m1.total}`, m1Pct != null ? `${m1Pct}%` : null)}
        {cell("Module 2", `${m2.correct}/${m2.total}`, m2Pct != null ? `${m2Pct}%` : null)}
      </div>
      {path && (
        <div style={{ fontSize: 11, color: P.textSec, padding: "8px 12px", background: `${ACCENT.color}08`, borderRadius: 8, borderLeft: `3px solid ${ACCENT.color}` }}>
          <span style={{ fontWeight: 700, color: ACCENT.color, marginRight: 6 }}>路径</span>{path}
        </div>
      )}
      {tasks.length > 0 ? (
        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: P.textSec, letterSpacing: "0.02em" }}>题目回顾 ({tasks.length})</div>
          {tasks.map((task, i) => (
            <MockTaskCard key={`${task.itemId || "t"}-${task.module}-${i}`} task={task} index={i} />
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: P.textDim, fontStyle: "italic", marginTop: 2 }}>
          这条模考记录只保存了分数概览；完成新的模考后即可逐题回顾。
        </div>
      )}
    </div>
  );
}

// Adapt a mock per-task snapshot (buildTaskSnapshots) into the details shape the
// per-subtype review renderers (LCRDetail / LADetail / LCDetail) expect. Each
// result is normalized so `.correct` is always present — older snapshots may
// omit it, and without it the correct option wouldn't be highlighted.
function taskToReviewDetails(task) {
  const subtype = task.taskType;
  if (subtype === "lcr") {
    return {
      subtype,
      results: (task.results || []).map((r) => ({ ...r, correct: r.correct ?? task.answer ?? null })),
      items: [{
        id: task.itemId,
        speaker: task.speaker,
        options: task.options,
        answer: task.answer,
        explanation: task.explanation,
      }],
    };
  }
  const questions = Array.isArray(task.questions) ? task.questions : [];
  return {
    subtype,
    results: (task.results || []).map((r, i) => ({ ...r, correct: r.correct ?? questions[i]?.answer ?? null })),
    questions,
    transcript: task.transcript || task.announcement || task.lecture || task.text || task.passage || "",
    conversation: task.conversation || null,
  };
}

// One collapsible card per mock task, reusing the practice-review renderers.
function MockTaskCard({ task, index }) {
  const [open, setOpen] = useState(false);
  const m = getSubtypeInfo(task.taskType);
  const t = Number(task.total) || (Array.isArray(task.results) ? task.results.length : 0);
  const c = Number(task.correct) || 0;
  const statusColor = t > 0 && c === t ? "#059669" : "#E11D48";
  const adapted = { details: taskToReviewDetails(task) };

  return (
    <div style={{ border: `1px solid ${P.borderSubtle}`, borderRadius: 10, overflow: "hidden", background: P.surface }}>
      <button onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: open ? `${m.color}06` : "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
        <span style={{ width: 24, height: 24, borderRadius: 7, background: `${m.color}14`, color: m.color, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{m.icon}</span>
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: P.text, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {m.label}
          <span style={{ fontSize: 10, color: P.textDim, fontWeight: 500 }}>#{index + 1}</span>
          {task.module ? <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: `${ACCENT.color}12`, color: ACCENT.color }}>M{task.module}</span> : null}
          {task.topic ? <span style={{ fontSize: 10, color: P.textDim, fontWeight: 400 }}>{task.topic}</span> : null}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, background: `${statusColor}12`, padding: "2px 8px", borderRadius: 999, fontVariantNumeric: "tabular-nums" }}>{c}/{t}</span>
        <ChevronIcon open={open} color={P.textDim} />
      </button>
      {open && (
        <div style={{ padding: "10px 12px 12px", borderTop: `1px solid ${P.borderSubtle}`, background: "#fbfcfb" }}>
          {task.taskType === "lcr" ? <LCRDetail session={adapted} />
            : task.taskType === "lc" ? <LCDetail session={adapted} />
            : <LADetail session={adapted} />}
        </div>
      )}
    </div>
  );
}

// -- LCR Detail (Choose a Response) --

function LCRDetail({ session }) {
  const results = session.details?.results || [];
  // LCR persists its per-item snapshot under details.items (parallel to
  // results) — see saveListeningSession in app/listening/page.js and the
  // matching reader in lib/listeningMistakes.js. Fall back to details.questions
  // for any legacy/alternate shape.
  const items = session.details?.items || session.details?.questions || [];

  if (results.length === 0 && items.length === 0) {
    return <div style={{ fontSize: 12, color: P.textDim, fontStyle: "italic" }}>暂无详细题目数据</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {results.map((r, i) => {
        const q = items[i] || {};
        const speakerText = q.speaker || q.stem || r.stem || "";
        const options = q.options || r.options || {};
        const explanation = q.explanation || r.explanation || "";
        const correctKey = r.correct || q.answer || "";

        return (
          <div key={i} style={{ padding: "10px 12px", borderRadius: 10, background: r.isCorrect ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${r.isCorrect ? "#BBF7D0" : "#FECACA"}` }}>
            {/* Speaker text */}
            {speakerText && (
              <div style={{ fontSize: 13, color: P.text, lineHeight: 1.6, padding: "8px 12px", background: "#f8faf9", borderRadius: 8, marginBottom: 8, borderLeft: `3px solid ${ACCENT.color}`, fontStyle: "italic" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT.color, marginRight: 6 }}>Speaker:</span>
                {speakerText}
              </div>
            )}
            {/* Options A/B/C/D */}
            {Object.keys(options).length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: explanation ? 8 : 0 }}>
                {["A", "B", "C", "D"].map(key => {
                  if (!options[key]) return null;
                  const isUserChoice = r.selected === key;
                  const isCorrectOpt = correctKey === key;
                  let bg = "transparent";
                  let color = P.textDim;
                  let fontW = 400;
                  let marker = "";
                  if (isCorrectOpt) { bg = "#D1FAE520"; color = "#059669"; fontW = 600; marker = " \u2713"; }
                  if (isUserChoice && !isCorrectOpt) { bg = "#FEE2E220"; color = "#DC2626"; fontW = 600; marker = " \u2717"; }
                  return (
                    <div key={key} style={{ fontSize: 12, color, fontWeight: fontW, padding: "4px 8px", borderRadius: 6, background: bg }}>
                      {key}. {options[key]}{marker}
                      {isUserChoice && !isCorrectOpt && <span style={{ fontSize: 10, marginLeft: 4, color: "#DC2626" }}>← 你的选择</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {/* Fallback when no options saved */}
            {Object.keys(options).length === 0 && (
              <div style={{ fontSize: 12, color: P.textSec, marginBottom: explanation ? 8 : 0 }}>
                <span style={{ fontWeight: 700, color: r.isCorrect ? "#059669" : "#DC2626", marginRight: 4 }}>{r.isCorrect ? "\u2713" : "\u2717"}</span>
                选择: {r.selected}{!r.isCorrect && <span style={{ color: "#DC2626" }}> (正确: {correctKey})</span>}
              </div>
            )}
            {/* Explanation */}
            {explanation && (
              <div style={{ fontSize: 11, color: "#92400E", lineHeight: 1.5, padding: "6px 10px", background: "#FFFBEB", borderRadius: 6, border: "1px solid #FDE68A" }}>
                {explanation}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// -- LA/LAT Detail (Announcement / Academic Talk) --

function LADetail({ session }) {
  const results = session.details?.results || [];
  const questions = session.details?.questions || [];
  const transcript = session.details?.transcript || session.details?.passage || "";

  return (
    <div>
      {/* Transcript / announcement text */}
      {transcript && (
        <div style={{ fontSize: 13, color: P.text, lineHeight: 1.7, padding: "10px 14px", background: "#f8faf9", borderRadius: 10, marginBottom: 10, whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto", fontStyle: "italic", borderLeft: `3px solid ${P.textDim}` }}>
          {transcript}
        </div>
      )}
      {/* Per-question detail */}
      {results.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {results.map((r, i) => {
            const q = questions[i] || {};
            const stem = q.stem || r.stem || "";
            const options = q.options || r.options || {};
            const explanation = q.explanation || r.explanation || "";
            return (
              <div key={i} style={{ padding: "10px 12px", borderRadius: 10, background: r.isCorrect ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${r.isCorrect ? "#BBF7D0" : "#FECACA"}` }}>
                {/* Question stem */}
                <div style={{ fontSize: 13, fontWeight: 600, color: P.text, marginBottom: 6, display: "flex", alignItems: "flex-start", gap: 6 }}>
                  <span style={{ fontWeight: 700, color: r.isCorrect ? "#059669" : "#DC2626", flexShrink: 0 }}>{r.isCorrect ? "\u2713" : "\u2717"}</span>
                  <span>{stem || `第 ${i + 1} 题`}</span>
                </div>
                {/* Options */}
                {Object.keys(options).length > 0 && (
                  <div style={{ marginLeft: 20, display: "flex", flexDirection: "column", gap: 3 }}>
                    {["A", "B", "C", "D"].map(key => {
                      if (!options[key]) return null;
                      const isUserChoice = r.selected === key;
                      const isCorrectOpt = r.correct === key;
                      let color = P.textDim;
                      let fontW = 400;
                      if (isCorrectOpt) { color = "#059669"; fontW = 600; }
                      if (isUserChoice && !r.isCorrect) { color = "#DC2626"; fontW = 600; }
                      return (
                        <div key={key} style={{ fontSize: 12, color, fontWeight: fontW }}>
                          {key}. {options[key]}
                          {isCorrectOpt && " \u2713"}
                          {isUserChoice && !isCorrectOpt && " \u2190 你的选择"}
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* Explanation */}
                {explanation && (
                  <div style={{ marginTop: 6, marginLeft: 20, fontSize: 11, color: "#92400E", lineHeight: 1.5, padding: "6px 10px", background: "#FFFBEB", borderRadius: 6, border: "1px solid #FDE68A" }}>
                    {explanation}
                  </div>
                )}
                {/* Fallback */}
                {Object.keys(options).length === 0 && !stem && (
                  <div style={{ marginLeft: 20, fontSize: 12, color: P.textSec }}>
                    选择: {r.selected}{!r.isCorrect && <span style={{ color: "#DC2626" }}> (正确: {r.correct})</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: P.textDim, fontStyle: "italic" }}>暂无详细题目数据</div>
      )}
    </div>
  );
}

// -- LC Detail (Conversation) --

function LCDetail({ session }) {
  const results = session.details?.results || [];
  const questions = session.details?.questions || [];
  const conversation = session.details?.conversation || session.details?.turns || [];
  const transcript = session.details?.transcript || session.details?.passage || "";

  return (
    <div>
      {/* Conversation turns as chat bubbles */}
      {conversation.length > 0 ? (
        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {conversation.map((turn, i) => {
            const isLeft = i % 2 === 0;
            const speaker = turn.speaker || turn.name || (isLeft ? "Speaker A" : "Speaker B");
            const text = turn.text || turn.content || "";
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: isLeft ? "flex-start" : "flex-end" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: isLeft ? "#6366F1" : "#0891B2", marginBottom: 2, paddingLeft: isLeft ? 8 : 0, paddingRight: isLeft ? 0 : 8 }}>
                  {speaker}
                </div>
                <div style={{
                  maxWidth: "85%", fontSize: 12, lineHeight: 1.6, color: P.text,
                  padding: "8px 12px", borderRadius: 12,
                  borderTopLeftRadius: isLeft ? 4 : 12,
                  borderTopRightRadius: isLeft ? 12 : 4,
                  background: isLeft ? "#F3E8FF" : "#ECFEFF",
                  border: `1px solid ${isLeft ? "#DDD6FE" : "#CFFAFE"}`,
                }}>
                  {text}
                </div>
              </div>
            );
          })}
        </div>
      ) : transcript ? (
        /* Fallback: show transcript as plain text block */
        <div style={{ fontSize: 13, color: P.text, lineHeight: 1.7, padding: "10px 14px", background: "#f8faf9", borderRadius: 10, marginBottom: 10, whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto", fontStyle: "italic", borderLeft: `3px solid ${P.textDim}` }}>
          {transcript}
        </div>
      ) : null}

      {/* Questions (same pattern as LA/LAT) */}
      {results.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {results.map((r, i) => {
            const q = questions[i] || {};
            const stem = q.stem || r.stem || "";
            const options = q.options || r.options || {};
            const explanation = q.explanation || r.explanation || "";
            return (
              <div key={i} style={{ padding: "10px 12px", borderRadius: 10, background: r.isCorrect ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${r.isCorrect ? "#BBF7D0" : "#FECACA"}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: P.text, marginBottom: 6, display: "flex", alignItems: "flex-start", gap: 6 }}>
                  <span style={{ fontWeight: 700, color: r.isCorrect ? "#059669" : "#DC2626", flexShrink: 0 }}>{r.isCorrect ? "\u2713" : "\u2717"}</span>
                  <span>{stem || `第 ${i + 1} 题`}</span>
                </div>
                {Object.keys(options).length > 0 && (
                  <div style={{ marginLeft: 20, display: "flex", flexDirection: "column", gap: 3 }}>
                    {["A", "B", "C", "D"].map(key => {
                      if (!options[key]) return null;
                      const isUserChoice = r.selected === key;
                      const isCorrectOpt = r.correct === key;
                      let color = P.textDim;
                      let fontW = 400;
                      if (isCorrectOpt) { color = "#059669"; fontW = 600; }
                      if (isUserChoice && !r.isCorrect) { color = "#DC2626"; fontW = 600; }
                      return (
                        <div key={key} style={{ fontSize: 12, color, fontWeight: fontW }}>
                          {key}. {options[key]}
                          {isCorrectOpt && " \u2713"}
                          {isUserChoice && !isCorrectOpt && " \u2190 你的选择"}
                        </div>
                      );
                    })}
                  </div>
                )}
                {explanation && (
                  <div style={{ marginTop: 6, marginLeft: 20, fontSize: 11, color: "#92400E", lineHeight: 1.5, padding: "6px 10px", background: "#FFFBEB", borderRadius: 6, border: "1px solid #FDE68A" }}>
                    {explanation}
                  </div>
                )}
                {Object.keys(options).length === 0 && !stem && (
                  <div style={{ marginLeft: 20, fontSize: 12, color: P.textSec }}>
                    选择: {r.selected}{!r.isCorrect && <span style={{ color: "#DC2626" }}> (正确: {r.correct})</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: P.textDim, fontStyle: "italic" }}>暂无详细题目数据</div>
      )}
    </div>
  );
}

// -- Main View --

export function ListeningProgressView({ onBack }) {
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
    return hist.sessions
      .filter(s => s.type === "listening" || s.type === "adaptive-listening")
      .map(normalizeListeningSession)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [hist]);

  const filtered = useMemo(() => {
    if (filter === "all") return sessions;
    return sessions.filter(s => s.details?.subtype === filter);
  }, [sessions, filter]);

  const lcrSessions = sessions.filter(s => s.details?.subtype === "lcr");
  const laSessions = sessions.filter(s => s.details?.subtype === "la");
  const lcSessions = sessions.filter(s => s.details?.subtype === "lc");
  const latSessions = sessions.filter(s => s.details?.subtype === "lat");
  const mockSessions = sessions.filter(s => s.details?.subtype === "mock");

  function avgPct(arr) {
    if (arr.length === 0) return null;
    const scores = arr.map(getAccuracyPercent).filter(Number.isFinite);
    if (scores.length === 0) return null;
    const sum = scores.reduce((a, b) => a + b, 0);
    return Math.round(sum / scores.length);
  }

  const lcrAvg = avgPct(lcrSessions);
  const laAvg = avgPct(laSessions);
  const lcAvg = avgPct(lcSessions);
  const latAvg = avgPct(latSessions);
  const mockAvg = avgPct(mockSessions);
  const totalAvg = avgPct(sessions);

  const statItems = [
    { key: "all",  icon: "📊", short: "全部", count: sessions.length, color: P.primary, avg: totalAvg !== null ? `平均 ${totalAvg}%` : "" },
    { key: "lcr",  icon: SUBTYPE_META.lcr.icon,  short: SUBTYPE_META.lcr.short,  count: lcrSessions.length,  color: SUBTYPE_META.lcr.color,  avg: lcrAvg !== null ? `平均 ${lcrAvg}%` : "暂无" },
    { key: "la",   icon: SUBTYPE_META.la.icon,   short: SUBTYPE_META.la.short,   count: laSessions.length,   color: SUBTYPE_META.la.color,   avg: laAvg !== null ? `平均 ${laAvg}%` : "暂无" },
    { key: "lc",   icon: SUBTYPE_META.lc.icon,   short: SUBTYPE_META.lc.short,   count: lcSessions.length,   color: SUBTYPE_META.lc.color,   avg: lcAvg !== null ? `平均 ${lcAvg}%` : "暂无" },
    { key: "lat",  icon: SUBTYPE_META.lat.icon,  short: SUBTYPE_META.lat.short,  count: latSessions.length,  color: SUBTYPE_META.lat.color,  avg: latAvg !== null ? `平均 ${latAvg}%` : "暂无" },
    { key: "mock", icon: SUBTYPE_META.mock.icon, short: SUBTYPE_META.mock.short, count: mockSessions.length, color: SUBTYPE_META.mock.color, avg: mockAvg !== null ? `平均 ${mockAvg}%` : "暂无" },
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
        <TopBar title="听力练习记录" section="Listening" onExit={onBack} accentColor={ACCENT.color} />
        <PageShell narrow><div style={{ textAlign: "center", padding: "60px 0", color: P.textDim }}>加载中...</div></PageShell>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: P.bg, fontFamily: FONT }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      <TopBar title="听力练习记录" section="Listening" onExit={onBack} accentColor={ACCENT.color} />

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 20px 60px" }}>
        {sessions.length === 0 ? (
          <SurfaceCard style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 8 }}>暂无听力练习记录</div>
            <div style={{ fontSize: 12, color: P.textDim }}>完成听力练习后，记录会自动保存在这里。</div>
          </SurfaceCard>
        ) : (
          <>
            {/* Stats row: cards + trend chart */}
            <div style={{ display: "flex", gap: 14, marginBottom: 18, alignItems: "stretch", animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 80ms both" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flex: "0 0 52%" }}>
                {statItems.slice(0, 4).map(item => (
                  <StatCard key={item.key} {...item} active={filter === item.key} onClick={() => setFilter(item.key)} />
                ))}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {/* LAT + Mock (5th & 6th) side-by-side */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <StatCard {...statItems[4]} active={filter === statItems[4].key} onClick={() => setFilter(statItems[4].key)} />
                  {statItems[5] && (
                    <StatCard {...statItems[5]} active={filter === statItems[5].key} onClick={() => setFilter(statItems[5].key)} />
                  )}
                </div>
                {/* Trend chart */}
                <div style={{ flex: 1, minWidth: 0, padding: "12px 14px 8px", background: P.surface, borderRadius: 14, border: `1px solid ${P.borderSubtle}`, display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: P.textSec, marginBottom: 4 }}>正确率趋势</div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <ListeningTrendChart sessions={sessions} filter={filter} />
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
                    const label = relativeDateLabel(d);
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
                >清空全部听力记录</button>
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
