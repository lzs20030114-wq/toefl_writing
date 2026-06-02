"use client";

import React, { useState, useMemo } from "react";
import { useReadingAiExplain, ReadingAiExplainBlock } from "./useReadingAiExplain";
import { formatLocalDateTime } from "../../lib/utils";
import { getBandColor } from "../../lib/history/bandColor";

// — Color tokens (kept local so the component is reusable from listening etc.) —
const C = {
  text: "#1a2420",
  textSec: "#5a6b62",
  textDim: "#94a39a",
  border: "#dde5df",
  borderSubtle: "#ebf0ed",
  surface: "#ffffff",
  bg: "#f8faf9",
  bgSoft: "#f4f7f5",
  correct: "#059669",
  correctSoft: "#d1fae5",
  wrong: "#dc2626",
  wrongSoft: "#fee2e2",
  blue: "#2563eb",
  blueSoft: "#dbeafe",
  purple: "#7C3AED",
  purpleSoft: "#f5f3ff",
  amber: "#d97706",
  amberSoft: "#fffbeb",
  shadow: "0 1px 3px rgba(10,40,25,0.04), 0 1px 2px rgba(10,40,25,0.02)",
  shadowLg: "0 10px 40px rgba(10,40,25,0.08), 0 2px 10px rgba(10,40,25,0.04)",
};

const TASK_META = {
  ctw: { label: "Complete the Words", short: "CTW", icon: "Aa", color: "#D97706", soft: "#FFFBEB" },
  rdl: { label: "Read in Daily Life",  short: "RDL", icon: "📄", color: "#059669", soft: "#ECFDF5" },
  ap:  { label: "Academic Passage",    short: "AP",  icon: "📚", color: "#6366F1", soft: "#EEF2FF" },
  lcr: { label: "Choose a Response",   short: "LCR", icon: "💬", color: "#8B5CF6", soft: "#F3E8FF" },
  la:  { label: "Announcement",        short: "LA",  icon: "📢", color: "#F59E0B", soft: "#FFFBEB" },
  lc:  { label: "Conversation",        short: "LC",  icon: "🗣",  color: "#0891B2", soft: "#ECFEFF" },
  lat: { label: "Academic Talk",       short: "LAT", icon: "🎓", color: "#6366F1", soft: "#EEF2FF" },
};

function getTaskMeta(taskType) {
  return TASK_META[taskType] || { label: taskType || "Unknown", short: "?", icon: "•", color: C.textSec, soft: C.bg };
}

function pct(c, t) {
  return t > 0 ? Math.round((c / t) * 100) : 0;
}

// ─────────────────────────── Task body renderers ───────────────────────────

function CtwTaskBody({ task }) {
  const passage = task.passage || "";
  const blanks = Array.isArray(task.blanks) ? task.blanks : [];
  const results = Array.isArray(task.results) ? task.results : [];

  const blankByPos = {};
  blanks.forEach((b, i) => {
    blankByPos[b.position] = { blank: b, result: results[i], index: i };
  });

  const words = passage.split(/\s+/);
  const rendered = words.map((word, wi) => {
    const entry = blankByPos[wi];
    if (!entry) return <span key={wi}>{word} </span>;
    const { blank, result } = entry;
    const isCorrect = result?.isCorrect;
    const userTyped = result?.userAnswer || `${blank.displayed_fragment}…`;
    const color = isCorrect ? C.correct : C.wrong;
    const bg = isCorrect ? C.correctSoft : C.wrongSoft;
    return (
      <span key={wi}>
        <span
          title={isCorrect ? `✓ ${blank.original_word}` : `你输入: ${userTyped} · 正确: ${blank.original_word}`}
          style={{
            background: bg,
            color,
            fontWeight: 700,
            borderRadius: 4,
            padding: "1px 5px",
            borderBottom: `2px solid ${color}`,
            fontFamily: "'Courier New', monospace",
            fontSize: 13,
            cursor: "help",
          }}
        >
          {blank.original_word}
        </span>
        {word.match(/[.,;:!?]+$/)?.[0] || ""}{" "}
      </span>
    );
  });

  const mistakes = results
    .map((r, i) => ({ r, blank: blanks[i] }))
    .filter((x) => x.blank && !x.r?.isCorrect);

  return (
    <div>
      <div
        style={{
          fontSize: 14,
          lineHeight: 2.1,
          padding: "16px 18px",
          background: C.surface,
          borderRadius: 12,
          border: `1px solid ${C.borderSubtle}`,
          marginBottom: 14,
        }}
      >
        {rendered}
      </div>
      {mistakes.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
            错题对照 ({mistakes.length})
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
            {mistakes.map(({ r, blank }, i) => (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: C.wrongSoft,
                  border: `1px solid ${C.wrong}25`,
                  fontFamily: "'Courier New', monospace",
                }}
              >
                <span style={{ color: C.wrong, textDecoration: "line-through" }}>
                  {r?.userAnswer || "(未填)"}
                </span>
                <span style={{ color: C.textDim, margin: "0 6px" }}>→</span>
                <span style={{ color: C.correct, fontWeight: 700 }}>{blank.original_word}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function McqTaskBody({ task, explainHook }) {
  const questions = Array.isArray(task.questions) ? task.questions : [];
  const results = Array.isArray(task.results) ? task.results : [];

  const renderable = questions.length
    ? questions
    : task.options
    ? [{ stem: task.speaker || "Listen and choose a response.", options: task.options, correct_answer: task.answer }]
    : [];

  const passage = task.passage || task.text || "";
  const [passageOpen, setPassageOpen] = useState(true);

  return (
    <div>
      {passage && (
        <div style={{ marginBottom: 14 }}>
          <button
            onClick={() => setPassageOpen(!passageOpen)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              color: C.textSec,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span style={{ fontSize: 10 }}>{passageOpen ? "▾" : "▸"}</span>
            原文 {!passageOpen && `(${passage.length} 字)`}
          </button>
          {passageOpen && (
            <div
              style={{
                fontSize: 13.5,
                lineHeight: 1.8,
                padding: "14px 18px",
                background: C.surface,
                borderRadius: 12,
                border: `1px solid ${C.borderSubtle}`,
                whiteSpace: "pre-wrap",
                maxHeight: 280,
                overflowY: "auto",
                color: C.text,
              }}
            >
              {passage}
            </div>
          )}
        </div>
      )}
      {task.audio_url && (
        <div
          style={{
            fontSize: 11,
            color: C.textSec,
            marginBottom: 12,
            padding: "6px 12px",
            background: C.blueSoft,
            border: `1px solid ${C.blue}25`,
            borderRadius: 6,
            display: "inline-block",
          }}
        >
          🎧 原音频已记录
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {renderable.map((q, i) => {
          const r = results[i];
          const correctKey = q.correct_answer || q.answer;
          const selected = r?.selected ?? null;
          const isCorrect = !!r?.isCorrect;
          return (
            <div
              key={i}
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: isCorrect ? C.correctSoft : C.wrongSoft,
                border: `1px solid ${isCorrect ? C.correct : C.wrong}30`,
              }}
            >
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: C.text,
                  marginBottom: 10,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  lineHeight: 1.55,
                }}
              >
                <span
                  style={{
                    fontWeight: 800,
                    color: isCorrect ? C.correct : C.wrong,
                    flexShrink: 0,
                    fontSize: 15,
                  }}
                >
                  {isCorrect ? "✓" : "✗"}
                </span>
                <span style={{ flex: 1 }}>{q.stem || q.question || `第 ${i + 1} 题`}</span>
              </div>
              {q.options && (
                <div style={{ marginLeft: 25, display: "flex", flexDirection: "column", gap: 5 }}>
                  {["A", "B", "C", "D"].map((key) => {
                    if (!q.options[key]) return null;
                    const isUser = selected === key;
                    const isAns = correctKey === key;
                    let color = C.textSec;
                    let bg = "transparent";
                    let weight = 400;
                    let suffix = null;
                    if (isAns) {
                      color = C.correct;
                      bg = "rgba(5,150,105,0.08)";
                      weight = 600;
                      suffix = " ✓";
                    }
                    if (isUser && !isAns) {
                      color = C.wrong;
                      bg = "rgba(220,38,38,0.08)";
                      weight = 600;
                      suffix = " ← 你的选择";
                    }
                    return (
                      <div
                        key={key}
                        style={{
                          fontSize: 12.5,
                          color,
                          fontWeight: weight,
                          padding: "5px 10px",
                          background: bg,
                          borderRadius: 6,
                          lineHeight: 1.55,
                        }}
                      >
                        <span style={{ fontFamily: "monospace", marginRight: 6, opacity: 0.7 }}>{key}.</span>
                        {q.options[key]}
                        {suffix}
                      </div>
                    );
                  })}
                </div>
              )}
              {q.explanation && (
                <div
                  style={{
                    marginTop: 10,
                    marginLeft: 25,
                    fontSize: 12.5,
                    color: C.textSec,
                    lineHeight: 1.65,
                    padding: "9px 12px",
                    background: C.surface,
                    border: `1px solid ${C.borderSubtle}`,
                    borderRadius: 8,
                  }}
                >
                  <span style={{ fontWeight: 700, color: C.text, marginRight: 4 }}>💡 解析:</span>
                  {q.explanation}
                </div>
              )}
              {!isCorrect && (
                <div style={{ marginLeft: 25 }}>
                  <ReadingAiExplainBlock
                    explainKey={`${task.itemId || "task"}-${task.module || ""}-q${i}`}
                    detail={{
                      qid: q.qid,
                      stem: q.stem || q.question,
                      options: q.options,
                      selected,
                      correct: correctKey,
                      passage,
                      isCorrect,
                    }}
                    {...explainHook}
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

// ─────────────────────────── Item card (one task instance) ───────────────────────────

function TaskItemCard({ task, index, defaultOpen, explainHook }) {
  const meta = getTaskMeta(task.taskType);
  const [open, setOpen] = useState(defaultOpen);
  const allCorrect = task.correct === task.total && task.total > 0;
  const statusColor = allCorrect ? C.correct : C.wrong;
  const moduleBadge = task.module === 1 ? "M1" : task.module === 2 ? "M2" : null;

  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.borderSubtle}`,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: C.shadow,
        transition: "box-shadow 0.2s",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "13px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: open ? `${meta.color}06` : "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          transition: "background 0.15s",
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: `${meta.color}14`,
            color: meta.color,
            fontSize: 13,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {meta.icon}
        </span>
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {meta.label}
          <span style={{ fontSize: 11, color: C.textDim, fontWeight: 500 }}>
            #{index + 1}
          </span>
          {moduleBadge && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "1px 7px",
                borderRadius: 999,
                background: task.module === 1 ? C.blueSoft : C.purpleSoft,
                color: task.module === 1 ? C.blue : C.purple,
                border: `1px solid ${task.module === 1 ? C.blue : C.purple}25`,
              }}
            >
              {moduleBadge}
            </span>
          )}
          {task.topic && (
            <span style={{ fontSize: 11, color: C.textDim, fontWeight: 400 }}>
              {task.topic}
            </span>
          )}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: statusColor,
            background: `${statusColor}14`,
            padding: "3px 10px",
            borderRadius: 999,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {task.correct}/{task.total}
        </span>
        <span style={{ fontSize: 10, color: C.textDim, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ padding: "14px 16px 16px", borderTop: `1px solid ${C.borderSubtle}`, background: C.bg }}>
          {task.taskType === "ctw" ? (
            <CtwTaskBody task={task} />
          ) : (
            <McqTaskBody task={task} explainHook={explainHook} />
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Overview tab content ───────────────────────────

function OverviewContent({ allTasks, m1, m2 }) {
  const wrong = allTasks.reduce((s, t) => s + ((t.total || 0) - (t.correct || 0)), 0);

  const byType = {};
  for (const t of allTasks) {
    if (!t.taskType) continue;
    if (!byType[t.taskType]) byType[t.taskType] = { c: 0, t: 0 };
    byType[t.taskType].c += t.correct || 0;
    byType[t.taskType].t += t.total || 0;
  }
  const ranked = Object.entries(byType)
    .filter(([, v]) => v.t > 0)
    .map(([k, v]) => ({ type: k, pct: v.c / v.t, total: v.t, correct: v.c }))
    .sort((a, b) => b.pct - a.pct);

  const strong = ranked[0];
  const weak = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Module breakdown */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
          模块对比
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <ModuleSummaryCard label="Module 1 · 路由阶段" m={m1} color={C.blue} />
          <ModuleSummaryCard label="Module 2 · 自适应阶段" m={m2} color={C.purple} />
        </div>
      </div>

      {/* Subtype breakdown */}
      {ranked.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            分项表现
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ranked.map((r) => {
              const meta = getTaskMeta(r.type);
              const p = Math.round(r.pct * 100);
              return (
                <div
                  key={r.type}
                  style={{
                    padding: "12px 14px",
                    background: C.surface,
                    border: `1px solid ${C.borderSubtle}`,
                    borderRadius: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 9,
                      background: `${meta.color}14`,
                      color: meta.color,
                      fontSize: 14,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {meta.icon}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{meta.label}</div>
                    <div
                      style={{
                        height: 5,
                        marginTop: 5,
                        background: `${meta.color}15`,
                        borderRadius: 3,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${p}%`,
                          height: "100%",
                          background: meta.color,
                          borderRadius: 3,
                          transition: "width 0.8s cubic-bezier(0.16,1,0.3,1)",
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: meta.color, fontVariantNumeric: "tabular-nums" }}>
                      {r.correct}/{r.total}
                    </div>
                    <div style={{ fontSize: 10, color: C.textDim, marginTop: 1 }}>{p}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <SummaryChip label="错题" value={`${wrong} 道`} color={wrong > 0 ? C.wrong : C.correct} />
        {strong && weak && (
          <>
            <SummaryChip label="强项" value={getTaskMeta(strong.type).short} color={getTaskMeta(strong.type).color} />
            <SummaryChip label="弱项" value={getTaskMeta(weak.type).short} color={getTaskMeta(weak.type).color} />
          </>
        )}
      </div>
    </div>
  );
}

function ModuleSummaryCard({ label, m, color }) {
  const c = m?.correct ?? 0;
  const t = m?.total ?? 0;
  const p = pct(c, t);
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${color}25`,
        borderRadius: 14,
        padding: "16px 18px",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 800, color: C.text, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {c}
        </span>
        <span style={{ fontSize: 14, color: C.textDim, fontWeight: 600 }}>/ {t}</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 12,
            fontWeight: 700,
            color,
            background: `${color}12`,
            padding: "3px 10px",
            borderRadius: 999,
          }}
        >
          {p}%
        </span>
      </div>
      <div style={{ height: 5, background: `${color}15`, borderRadius: 3, overflow: "hidden" }}>
        <div
          style={{
            width: `${p}%`,
            height: "100%",
            background: color,
            borderRadius: 3,
            transition: "width 0.8s cubic-bezier(0.16,1,0.3,1)",
          }}
        />
      </div>
    </div>
  );
}

function SummaryChip({ label, value, color }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        background: `${color}10`,
        border: `1px solid ${color}25`,
        borderRadius: 999,
        fontSize: 12,
      }}
    >
      <span style={{ color: C.textSec, fontWeight: 500 }}>{label}</span>
      <span style={{ color, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

// ─────────────────────────── Main panel ───────────────────────────

export function MockSessionDetail({ session, onClose, onDelete, accent = "#3B82F6" }) {
  const d = session?.details || {};
  const m1 = d.m1 || { correct: 0, total: 0 };
  const m2 = d.m2 || { correct: 0, total: 0 };
  const band = Number.isFinite(session?.band) ? session.band : Number.isFinite(d.band) ? d.band : null;
  const cefr = d.cefr || "";
  const path = d.path || "";
  // Approximate scaled score from band (band 0-6 → 0-30 TOEFL scale, linear).
  // Not an ETS lookup, just a coarse indicator parallel to the writing report.
  const scaledScore = Number.isFinite(band) ? Math.round(band * 5) : null;

  // Flatten all task snapshots, tagging which module each came from.
  const allTasks = useMemo(() => {
    const a = (Array.isArray(m1.tasks) ? m1.tasks : []).map((t) => ({ ...t, module: 1 }));
    const b = (Array.isArray(m2.tasks) ? m2.tasks : []).map((t) => ({ ...t, module: 2 }));
    return [...a, ...b];
  }, [m1.tasks, m2.tasks]);

  // Group tasks by taskType for primary tabs.
  const tasksByType = useMemo(() => {
    const groups = {};
    for (const t of allTasks) {
      if (!t.taskType) continue;
      if (!groups[t.taskType]) groups[t.taskType] = [];
      groups[t.taskType].push(t);
    }
    return groups;
  }, [allTasks]);

  const taskTypes = useMemo(() => Object.keys(tasksByType), [tasksByType]);

  const [primaryTab, setPrimaryTab] = useState("overview");
  const explainHook = useReadingAiExplain();

  const bc = getBandColor(band);
  const bandStr = Number.isFinite(band) ? band.toFixed(1) : "—";
  const hasTasks = allTasks.length > 0;

  // Build primary tabs: overview + one per task type (in fixed order)
  const taskTypeOrder = ["ctw", "rdl", "ap", "lcr", "la", "lc", "lat"];
  const primaryTabs = [
    { key: "overview", label: "概览 · 总体", color: accent, score: null, icon: null },
    ...taskTypeOrder
      .filter((tt) => tasksByType[tt])
      .map((tt) => {
        const meta = getTaskMeta(tt);
        const items = tasksByType[tt];
        const c = items.reduce((s, t) => s + (t.correct || 0), 0);
        const total = items.reduce((s, t) => s + (t.total || 0), 0);
        return {
          key: tt,
          label: meta.label,
          color: meta.color,
          icon: meta.icon,
          score: `${c}/${total}`,
        };
      }),
  ];

  function renderTabContent() {
    if (primaryTab === "overview") {
      if (!hasTasks) {
        return (
          <div
            style={{
              padding: "40px 24px",
              textAlign: "center",
              color: C.textDim,
              fontSize: 13,
              background: C.bg,
              borderRadius: 12,
              border: `1px dashed ${C.borderSubtle}`,
            }}
          >
            这是旧版本的模考记录，仅保存了分数概览。完成新模考后可看到题目级回放。
          </div>
        );
      }
      return <OverviewContent allTasks={allTasks} m1={m1} m2={m2} />;
    }
    const items = tasksByType[primaryTab] || [];
    if (items.length === 0) {
      return (
        <div style={{ padding: "40px 24px", textAlign: "center", color: C.textDim, fontSize: 13 }}>
          此 task type 没有保存详细数据。
        </div>
      );
    }
    // Auto-open first wrong item in the list
    const firstWrongIdx = items.findIndex((t) => (t.correct || 0) < (t.total || 0));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((t, i) => (
          <TaskItemCard
            key={`${t.itemId || i}-${t.module}`}
            task={t}
            index={i}
            defaultOpen={i === (firstWrongIdx >= 0 ? firstWrongIdx : 0)}
            explainHook={explainHook}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        animation: "slideInRight 0.5s cubic-bezier(0.16,1,0.3,1)",
        background: C.surface,
        borderRadius: 16,
        border: `1px solid ${C.border}`,
        boxShadow: C.shadowLg,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 110px)",
        minHeight: 500,
      }}
    >
      {/* Header — mirrors writing FullMockReport */}
      <div
        style={{
          flexShrink: 0,
          padding: "18px 28px",
          borderBottom: `1px solid ${C.borderSubtle}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          background: `${C.bg}90`,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                fontSize: 12,
                color: C.textDim,
                background: "none",
                border: "none",
                cursor: "pointer",
                marginBottom: 10,
                display: "flex",
                alignItems: "center",
                gap: 4,
                transition: "color 0.15s",
                padding: 0,
                fontFamily: "inherit",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = C.text)}
              onMouseLeave={(e) => (e.currentTarget.style.color = C.textDim)}
            >
              ← 收起详情，返回大盘
            </button>
          )}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 19, fontWeight: 800, color: C.text, margin: 0, letterSpacing: "-0.3px" }}>
              阅读详细诊断报告
            </h2>
            <span style={{ fontSize: 12, color: C.textDim }}>{formatLocalDateTime(session?.date)}</span>
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {cefr && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 9px",
                  borderRadius: 999,
                  background: C.purpleSoft,
                  color: C.purple,
                  border: `1px solid ${C.purple}25`,
                }}
              >
                CEFR {cefr}
              </span>
            )}
            {scaledScore != null && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 9px",
                  borderRadius: 999,
                  background: C.bg,
                  color: C.textSec,
                  border: `1px solid ${C.border}`,
                }}
              >
                换算分 {scaledScore}/30
              </span>
            )}
            {path && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 9px",
                  borderRadius: 999,
                  background: path === "upper" ? C.blueSoft : C.amberSoft,
                  color: path === "upper" ? C.blue : C.amber,
                  border: `1px solid ${path === "upper" ? C.blue : C.amber}25`,
                }}
              >
                {path === "upper" ? "Upper 路径" : path === "lower" ? "Lower 路径" : path}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexShrink: 0 }}>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: C.textDim,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 4,
              }}
            >
              Overall Band
            </div>
            <div style={{ fontSize: 34, fontWeight: 800, color: bc, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {bandStr}
            </div>
          </div>
          {onDelete && (
            <button
              onClick={() => {
                if (typeof window !== "undefined" && window.confirm("删除这条模考记录？")) onDelete();
              }}
              title="删除"
              style={{
                background: "none",
                border: `1px solid ${C.borderSubtle}`,
                color: C.textDim,
                width: 28,
                height: 28,
                borderRadius: 8,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.15s",
                marginTop: 2,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#dc2626";
                e.currentTarget.style.color = "#dc2626";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = C.borderSubtle;
                e.currentTarget.style.color = C.textDim;
              }}
            >
              <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M2.5 4.5h11M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M6.5 7v4.5M9.5 7v4.5M3.5 4.5l.5 8.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l.5-8.5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Primary tabs — mirrors writing FullMockReport's primaryTabs */}
      <div
        style={{
          flexShrink: 0,
          padding: "0 28px",
          display: "flex",
          gap: 24,
          borderBottom: `1px solid ${C.borderSubtle}`,
          background: C.surface,
          overflowX: "auto",
        }}
      >
        {primaryTabs.map((t) => {
          const isA = primaryTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setPrimaryTab(t.key)}
              style={{
                padding: "13px 0",
                background: "none",
                border: "none",
                borderBottom: `2.5px solid ${isA ? t.color : "transparent"}`,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "border-color 0.2s, opacity 0.2s",
                opacity: isA ? 1 : 0.55,
                whiteSpace: "nowrap",
                fontFamily: "inherit",
              }}
            >
              {t.icon && (
                <span style={{ fontSize: 14, color: isA ? t.color : C.textSec }}>{t.icon}</span>
              )}
              <span style={{ fontSize: 13, fontWeight: isA ? 700 : 500, color: isA ? C.text : C.textSec }}>
                {t.label}
              </span>
              {t.score && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: isA ? `${t.color}18` : C.bg,
                    color: isA ? t.color : C.textDim,
                    transition: "all 0.2s",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {t.score}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content — keyed for tabFade animation on tab switch */}
      <div
        key={primaryTab}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 28px 28px",
          background: C.bgSoft,
          animation: "tabFade 0.3s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        {renderTabContent()}
      </div>
    </div>
  );
}
