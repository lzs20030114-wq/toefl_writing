"use client";

import React, { useState, useMemo } from "react";
import { useReadingAiExplain, ReadingAiExplainBlock } from "./useReadingAiExplain";

// — Color tokens — kept local so this component renders correctly when
//   embedded in either reading or listening progress views down the road.
const C = {
  text: "#1a2420",
  textSec: "#5a6b62",
  textDim: "#94a39a",
  border: "#dde5df",
  borderSubtle: "#ebf0ed",
  surface: "#ffffff",
  bg: "#f8faf9",
  correct: "#059669",
  correctSoft: "#d1fae5",
  wrong: "#dc2626",
  wrongSoft: "#fee2e2",
  partialSoft: "#fef3c7",
  blue: "#2563eb",
  blueSoft: "#dbeafe",
  red: "#dc2626",
  redSoft: "#fef2f2",
};

const TASK_LABEL = {
  ctw: { label: "Complete the Words", short: "CTW", icon: "Aa", color: "#D97706" },
  rdl: { label: "Read in Daily Life", short: "RDL", icon: "📄", color: "#059669" },
  ap:  { label: "Academic Passage",   short: "AP",  icon: "📚", color: "#6366F1" },
  lcr: { label: "Choose a Response",  short: "LCR", icon: "💬", color: "#8B5CF6" },
  la:  { label: "Announcement",       short: "LA",  icon: "📢", color: "#F59E0B" },
  lc:  { label: "Conversation",       short: "LC",  icon: "🗣",  color: "#0891B2" },
  lat: { label: "Academic Talk",      short: "LAT", icon: "🎓", color: "#6366F1" },
};

function pct(c, t) {
  return t > 0 ? Math.round((c / t) * 100) : 0;
}

function getTaskMeta(taskType) {
  return TASK_LABEL[taskType] || { label: taskType || "Unknown", short: "?", icon: "•", color: C.textSec };
}

// — Summary cells (top row, kept from old MockDetail) —

function SummaryCells({ band, cefr, m1, m2 }) {
  const m1Pct = pct(m1?.correct || 0, m1?.total || 0);
  const m2Pct = pct(m2?.correct || 0, m2?.total || 0);
  const cell = (label, value, hint) => (
    <div
      style={{
        flex: 1,
        padding: "10px 12px",
        background: C.bg,
        border: `1px solid ${C.borderSubtle}`,
        borderRadius: 8,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>{label}</div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: C.text,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {hint && <div style={{ fontSize: 10, color: C.textDim, marginTop: 1 }}>{hint}</div>}
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {cell("Band", String(band ?? "—"), cefr ? `CEFR ${cefr}` : null)}
      {cell("Module 1", `${m1?.correct ?? 0}/${m1?.total ?? 0}`, m1?.total ? `${m1Pct}%` : null)}
      {cell("Module 2", `${m2?.correct ?? 0}/${m2?.total ?? 0}`, m2?.total ? `${m2Pct}%` : null)}
    </div>
  );
}

// — Overview chips (wrong count + strength/weakness) —

function OverviewBar({ tasks }) {
  // tasks is the flat array of all task snapshots from both modules
  const total = tasks.reduce((s, t) => s + (t.total || 0), 0);
  const correct = tasks.reduce((s, t) => s + (t.correct || 0), 0);
  const wrong = total - correct;

  // Group accuracy by task type
  const byType = {};
  for (const t of tasks) {
    if (!t.taskType) continue;
    if (!byType[t.taskType]) byType[t.taskType] = { c: 0, t: 0 };
    byType[t.taskType].c += t.correct || 0;
    byType[t.taskType].t += t.total || 0;
  }
  const ranked = Object.entries(byType)
    .filter(([, v]) => v.t > 0)
    .map(([k, v]) => ({ type: k, pct: v.c / v.t, total: v.t }))
    .sort((a, b) => b.pct - a.pct);

  const strong = ranked[0];
  const weak = ranked[ranked.length - 1];

  const chip = (label, value, color) => (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        background: `${color}10`,
        border: `1px solid ${color}25`,
        borderRadius: 999,
        fontSize: 11,
      }}
    >
      <span style={{ color: C.textSec, fontWeight: 500 }}>{label}</span>
      <span style={{ color, fontWeight: 700 }}>{value}</span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {chip("错题", `${wrong} 道`, wrong > 0 ? C.red : C.correct)}
      {strong && strong !== weak && chip("强项", getTaskMeta(strong.type).short, getTaskMeta(strong.type).color)}
      {weak && chip("弱项", getTaskMeta(weak.type).short, getTaskMeta(weak.type).color)}
    </div>
  );
}

// — CTW task: render passage with blanks colored —

function CtwTaskBody({ task, explainHook }) {
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
    const userTyped = result?.userAnswer || blank.displayed_fragment + "…";
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

  // List of mistakes so the user can scan errors quickly without hovering
  const mistakes = results
    .map((r, i) => ({ r, blank: blanks[i] }))
    .filter((x) => x.blank && !x.r?.isCorrect);

  return (
    <div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 2.0,
          padding: "12px 16px",
          background: C.bg,
          borderRadius: 10,
          border: `1px solid ${C.borderSubtle}`,
          marginBottom: 10,
        }}
      >
        {rendered}
      </div>
      {mistakes.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 6 }}>
            错题对照（共 {mistakes.length} 个）
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6 }}>
            {mistakes.map(({ r, blank }, i) => (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: C.wrongSoft,
                  border: `1px solid ${C.wrong}25`,
                  fontFamily: "'Courier New', monospace",
                }}
              >
                <span style={{ color: C.wrong, textDecoration: "line-through" }}>
                  {r?.userAnswer || "(未填)"}
                </span>
                <span style={{ color: C.textDim, margin: "0 4px" }}>→</span>
                <span style={{ color: C.correct, fontWeight: 700 }}>{blank.original_word}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// — MCQ task (RDL / AP / LCR / LA / LC / LAT) — per-question detail —

function McqTaskBody({ task, explainHook, sectionPassage }) {
  const questions = Array.isArray(task.questions) ? task.questions : [];
  const results = Array.isArray(task.results) ? task.results : [];

  // For LCR there's a single implicit question; synthesize a question shape
  // so the same renderer works.
  const renderable = questions.length
    ? questions
    : task.options
    ? [{ stem: task.speaker || "Listen and choose a response.", options: task.options, correct_answer: task.answer }]
    : [];

  const passage = task.passage || task.text || sectionPassage || "";

  return (
    <div>
      {/* Passage / source text */}
      {passage && (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.7,
            padding: "10px 14px",
            background: C.bg,
            borderRadius: 10,
            border: `1px solid ${C.borderSubtle}`,
            marginBottom: 10,
            whiteSpace: "pre-wrap",
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {passage}
        </div>
      )}
      {/* Audio (if present, just a link badge — playing in review is out of scope here) */}
      {task.audio_url && (
        <div
          style={{
            fontSize: 11,
            color: C.textSec,
            marginBottom: 8,
            padding: "6px 10px",
            background: C.blueSoft,
            border: `1px solid ${C.blue}25`,
            borderRadius: 6,
            display: "inline-block",
          }}
        >
          🎧 原音频已记录
        </div>
      )}
      {/* Per-question cards */}
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
                padding: "10px 12px",
                borderRadius: 10,
                background: isCorrect ? C.correctSoft : C.wrongSoft,
                border: `1px solid ${isCorrect ? C.correct : C.wrong}30`,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: C.text,
                  marginBottom: 8,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    color: isCorrect ? C.correct : C.wrong,
                    flexShrink: 0,
                    minWidth: 16,
                  }}
                >
                  {isCorrect ? "✓" : "✗"}
                </span>
                <span style={{ flex: 1 }}>{q.stem || q.question || `第 ${i + 1} 题`}</span>
              </div>

              {/* Options */}
              {q.options && (
                <div style={{ marginLeft: 24, display: "flex", flexDirection: "column", gap: 4 }}>
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
                      bg = "rgba(5,150,105,0.06)";
                      weight = 600;
                      suffix = " ✓";
                    }
                    if (isUser && !isAns) {
                      color = C.wrong;
                      bg = "rgba(220,38,38,0.06)";
                      weight = 600;
                      suffix = " ← 你的选择";
                    }
                    return (
                      <div
                        key={key}
                        style={{
                          fontSize: 12,
                          color,
                          fontWeight: weight,
                          padding: "4px 8px",
                          background: bg,
                          borderRadius: 6,
                          lineHeight: 1.5,
                        }}
                      >
                        <span style={{ fontFamily: "monospace", marginRight: 6 }}>{key}.</span>
                        {q.options[key]}
                        {suffix}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Built-in explanation from the question bank */}
              {q.explanation && (
                <div
                  style={{
                    marginTop: 8,
                    marginLeft: 24,
                    fontSize: 12,
                    color: C.textSec,
                    lineHeight: 1.6,
                    padding: "8px 10px",
                    background: C.surface,
                    border: `1px solid ${C.borderSubtle}`,
                    borderRadius: 6,
                  }}
                >
                  <span style={{ fontWeight: 700, color: C.text, marginRight: 4 }}>💡 解析:</span>
                  {q.explanation}
                </div>
              )}

              {/* AI explanation (Pro, only for wrong answers) */}
              {!isCorrect && (
                <div style={{ marginLeft: 24 }}>
                  <ReadingAiExplainBlock
                    explainKey={`${task.itemId || "task"}-q${i}`}
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

// — A single task card (one CTW set, one RDL/AP passage, one LCR clip, etc.) —

function TaskCard({ task, index, defaultOpen, explainHook }) {
  const meta = getTaskMeta(task.taskType);
  const [open, setOpen] = useState(defaultOpen);
  const allCorrect = task.correct === task.total && task.total > 0;
  const statusColor = allCorrect ? C.correct : C.wrong;

  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.borderSubtle}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: open ? `${meta.color}06` : "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: `${meta.color}14`,
            color: meta.color,
            fontSize: 12,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {meta.icon}
        </span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.text }}>
          {meta.label}
          <span style={{ fontSize: 11, color: C.textDim, marginLeft: 8, fontWeight: 400 }}>
            #{index + 1}
            {task.topic ? ` · ${task.topic}` : ""}
          </span>
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: statusColor,
            background: `${statusColor}14`,
            padding: "2px 8px",
            borderRadius: 999,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {task.correct}/{task.total}
        </span>
        <span style={{ fontSize: 10, color: C.textDim, marginLeft: 4 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ padding: "12px 14px", borderTop: `1px solid ${C.borderSubtle}` }}>
          {task.taskType === "ctw" ? (
            <CtwTaskBody task={task} explainHook={explainHook} />
          ) : (
            <McqTaskBody task={task} explainHook={explainHook} />
          )}
        </div>
      )}
    </div>
  );
}

// — One module section (M1 or M2) —

function ModuleSection({ title, m, defaultOpen, accent, explainHook }) {
  const [open, setOpen] = useState(defaultOpen);
  const tasks = Array.isArray(m?.tasks) ? m.tasks : [];
  const correct = m?.correct ?? 0;
  const total = m?.total ?? 0;
  // Auto-open the first wrong task so the user lands on something actionable
  const firstWrongIdx = tasks.findIndex((t) => (t.correct || 0) < (t.total || 0));

  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.borderSubtle}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: open ? `${accent}06` : C.bg,
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: C.text,
            flex: 1,
          }}
        >
          {title}
          <span style={{ fontSize: 11, color: C.textDim, marginLeft: 8, fontWeight: 400 }}>
            {tasks.length} 个 task
          </span>
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: accent,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {correct}/{total}
          <span style={{ fontSize: 11, color: C.textDim, marginLeft: 6, fontWeight: 500 }}>
            {pct(correct, total)}%
          </span>
        </span>
        <span style={{ fontSize: 11, color: C.textDim, marginLeft: 6 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div
          style={{
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {tasks.length === 0 ? (
            <div style={{ fontSize: 12, color: C.textDim, textAlign: "center", padding: "16px 0" }}>
              此模块没有保存详细数据。该记录是旧版本生成的，详情无法回放。
            </div>
          ) : (
            tasks.map((t, i) => (
              <TaskCard
                key={i}
                task={t}
                index={i}
                defaultOpen={i === firstWrongIdx}
                explainHook={explainHook}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// — Main export —

export function MockSessionDetail({ session, accent = "#3B82F6" }) {
  const d = session?.details || {};
  const m1 = d.m1 || { correct: 0, total: 0 };
  const m2 = d.m2 || { correct: 0, total: 0 };
  const band = d.band ?? session?.band ?? "—";
  const cefr = d.cefr || "";
  const path = d.path || "";

  const allTasks = useMemo(() => {
    const a = Array.isArray(m1.tasks) ? m1.tasks : [];
    const b = Array.isArray(m2.tasks) ? m2.tasks : [];
    return [...a, ...b];
  }, [m1.tasks, m2.tasks]);

  const explainHook = useReadingAiExplain();

  const hasTasks = allTasks.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SummaryCells band={band} cefr={cefr} m1={m1} m2={m2} />
      {path && (
        <div
          style={{
            fontSize: 11,
            color: C.textSec,
            padding: "8px 12px",
            background: `${accent}08`,
            borderRadius: 8,
            borderLeft: `3px solid ${accent}`,
          }}
        >
          <span style={{ fontWeight: 700, color: accent, marginRight: 6 }}>路径</span>
          {path === "upper" ? "Upper (高阶难度)" : path === "lower" ? "Lower (基础难度)" : path}
        </div>
      )}
      {hasTasks && <OverviewBar tasks={allTasks} />}

      <ModuleSection
        title="Module 1 · 路由阶段"
        m={m1}
        defaultOpen={true}
        accent={accent}
        explainHook={explainHook}
      />
      <ModuleSection
        title={`Module 2 · ${path === "upper" ? "Upper" : path === "lower" ? "Lower" : "自适应"}`}
        m={m2}
        defaultOpen={false}
        accent={accent}
        explainHook={explainHook}
      />

      {!hasTasks && (
        <div
          style={{
            fontSize: 12,
            color: C.textDim,
            textAlign: "center",
            padding: "12px",
            background: C.bg,
            borderRadius: 8,
          }}
        >
          这是旧版本的模考记录，仅保存了分数概览。完成新模考后可看到题目级回放。
        </div>
      )}
    </div>
  );
}
