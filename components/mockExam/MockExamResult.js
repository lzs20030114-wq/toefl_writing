"use client";
import React, { useState } from "react";
import { C, Btn, FONT } from "../shared/ui";
import { ScoringReport } from "../writing/ScoringReport";
import { TASK_IDS } from "../../lib/mockExam/contracts";

const BAND_COLORS = {
  green:  { bg: "#dcfce7", border: "#22c55e", text: "#15803d", ring: "#22c55e" },
  blue:   { bg: "#dbeafe", border: "#3b82f6", text: "#1d4ed8", ring: "#3b82f6" },
  yellow: { bg: "#fef9c3", border: "#eab308", text: "#a16207", ring: "#eab308" },
  orange: { bg: "#ffedd5", border: "#f97316", text: "#c2410c", ring: "#f97316" },
  red:    { bg: "#fee2e2", border: "#ef4444", text: "#b91c1c", ring: "#ef4444" },
};

const LEVEL_LABELS = {
  green:  "高级",
  blue:   "中高级",
  yellow: "中级",
  orange: "初中级",
  red:    "初级",
};

function TaskIcon({ taskId }) {
  if (taskId === TASK_IDS.BUILD_SENTENCE) return "\u{1F9E9}";
  if (taskId === TASK_IDS.EMAIL_WRITING) return "\u{1F4E7}";
  if (taskId === TASK_IDS.ACADEMIC_WRITING) return "\u{1F4AC}";
  return "\u{1F4DD}";
}

export function MockExamResult({
  session,
  scoringPhase,
  scoringError,
  examResultRows,
  onStartNew,
  onExit,
  canRetryScoring = false,
  onRetryScoring = null,
  reportLanguage = "zh",
}) {
  const [expandedTask, setExpandedTask] = useState(null);
  const agg = session?.aggregate || {};
  const scoringDone = scoringPhase === "done" || scoringPhase === "error";
  const bandReady = scoringDone && Number.isFinite(agg.band);
  const band = bandReady ? agg.band.toFixed(1) : "--";
  const scaledScore = bandReady ? agg.scaledScore : "--";
  const cefr = bandReady ? agg.cefr : "--";
  const colorKey = bandReady ? (agg.color || "blue") : "blue";
  const palette = BAND_COLORS[colorKey] || BAND_COLORS.blue;
  const levelLabel = bandReady ? (LEVEL_LABELS[colorKey] || "") : "";

  const hasFeedback = (taskId) => {
    const a = session?.attempts?.[taskId];
    return a?.meta?.feedback && typeof a.meta.feedback === "object";
  };

  const getFeedback = (taskId) => {
    return session?.attempts?.[taskId]?.meta?.feedback || null;
  };

  const getTaskType = (taskId) => {
    if (taskId === TASK_IDS.EMAIL_WRITING) return "email";
    if (taskId === TASK_IDS.ACADEMIC_WRITING) return "discussion";
    return null;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Band Score Hero */}
      <div style={{
        background: "#fff",
        border: `2px solid ${palette.border}`,
        borderRadius: 12,
        padding: "32px 24px",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 13, color: C.t2, marginBottom: 8, letterSpacing: 1, textTransform: "uppercase" }}>
          写作部分结果
        </div>

        {/* Band circle */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          width: 120,
          height: 120,
          borderRadius: "50%",
          border: `4px solid ${palette.ring}`,
          background: palette.bg,
          margin: "8px auto 12px",
        }}>
          <span style={{ fontSize: 42, fontWeight: 800, color: palette.text, lineHeight: 1, fontFamily: FONT }}>
            {band}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: palette.text, marginTop: 2 }}>段位</span>
        </div>

        <div style={{ fontSize: 14, color: C.t1, marginBottom: 4 }}>
          换算分：<b>{scaledScore}</b> / 30
        </div>
        <div style={{
          display: "inline-block",
          background: palette.bg,
          border: `1px solid ${palette.border}`,
          borderRadius: 14,
          padding: "3px 14px",
          fontSize: 13,
          fontWeight: 600,
          color: palette.text,
        }}>
          欧框：{cefr} {levelLabel && `\u00B7 ${levelLabel}`}
        </div>

        {scoringPhase === "pending" && (
          <div style={{ marginTop: 14, fontSize: 13, color: C.blue }}>
            AI 正在评分任务 2 和任务 3，请稍候。
          </div>
        )}
        {scoringPhase === "error" && (
          <div style={{ marginTop: 14, fontSize: 13, color: C.red }}>
            AI 评分部分失败：{scoringError}
          </div>
        )}
      </div>

      {/* Task breakdown */}
      <div style={{
        background: "#fff",
        border: "1px solid " + C.bdr,
        borderRadius: 8,
        overflow: "hidden",
      }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid " + C.bdr, fontSize: 13, fontWeight: 700, color: C.t1 }}>
          分项结果
        </div>
        {examResultRows.map((row) => {
          const taskType = getTaskType(row.id);
          const canExpand = taskType && hasFeedback(row.id);
          const isExpanded = expandedTask === row.id;

          return (
            <div key={row.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 16px",
                  borderBottom: "1px solid #f0f0f0",
                  cursor: canExpand ? "pointer" : "default",
                  background: isExpanded ? "#f8fafc" : "transparent",
                }}
                onClick={() => canExpand && setExpandedTask(isExpanded ? null : row.id)}
              >
                <span style={{ fontSize: 14, color: C.t1 }}>
                  <TaskIcon taskId={row.id} /> {row.title}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: C.nav }}>{row.scoreText}</span>
                  {canExpand && (
                    <span style={{ fontSize: 11, color: C.blue }}>
                      {isExpanded ? "\u25B2 收起" : "\u25BC 详情"}
                    </span>
                  )}
                </span>
              </div>
              {isExpanded && canExpand && (
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", background: "#fafbfc" }}>
                  <ScoringReport
                    result={getFeedback(row.id)}
                    type={taskType}
                    uiLang={getFeedback(row.id)?.reportLanguage || reportLanguage}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10 }}>
        {scoringPhase !== "pending" && canRetryScoring && typeof onRetryScoring === "function" && (
          <Btn onClick={onRetryScoring} variant="secondary">重试 AI 评分</Btn>
        )}
        <Btn onClick={onStartNew}>开始新模考</Btn>
        <Btn onClick={onExit} variant="secondary">返回</Btn>
      </div>

      {/* Disclaimer */}
      <div style={{
        background: "#fffbeb",
        border: "1px solid #fde68a",
        borderRadius: 6,
        padding: "10px 14px",
        fontSize: 12,
        color: "#92400e",
        lineHeight: 1.6,
      }}>
        该分数基于公开可用的 ETS 换算表与 AI 评分标准进行估算，不代表官方 ETS 成绩。
      </div>
    </div>
  );
}
