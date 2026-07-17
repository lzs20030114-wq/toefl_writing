"use client";

import React, { useState } from "react";
import { formatLocalDateTime } from "../../lib/utils";
import { getBandColor } from "../../lib/history/bandColor";
import { RepeatDetail, InterviewDetail, DIM_LABELS, DIM_COLORS } from "./SpeakingTaskDetails";

// Full-screen speaking mock diagnostic report — mirrors reading MockSessionDetail
// 1:1 (shell + header + primary tabs), rendered in the right pane of
// SpeakingProgressView when a mock record is selected in the sidebar.

// — Color tokens (kept local, copied from MockSessionDetail so the component is
//   self-contained) —
const C = {
  text: "#1a2420",
  textSec: "#5a6b62",
  textDim: "#94a39a",
  border: "#dde5df",
  borderSubtle: "#ebf0ed",
  surface: "#ffffff",
  bg: "#f8faf9",
  bgSoft: "#f4f7f5",
  purple: "#7C3AED",
  purpleSoft: "#f5f3ff",
  shadowLg: "0 10px 40px rgba(10,40,25,0.08), 0 2px 10px rgba(10,40,25,0.04)",
};

const REPEAT_COLOR = "#F59E0B";
const INTERVIEW_COLOR = "#EF4444";

// Mini-bar color for the per-question overview strips. A genuine 0 is a real
// score (red) — only "never recorded" and "recorded but unscored" (e.g. STT
// failed) are gray.
function miniBarColor(recorded, score, hi, mid) {
  if (!recorded || score == null) return "#e2e8f0";
  if (score >= hi) return "#22c55e";
  if (score >= mid) return "#eab308";
  return "#ef4444";
}

export function SpeakingMockDetail({ session, onClose, onDelete, accent = "#F59E0B" }) {
  const d = session?.details || {};
  const band = Number.isFinite(session?.band) ? session.band : Number.isFinite(d.band) ? d.band : null;
  const cefr = d.cefr || "";
  const repeatScore = d.repeatScore;
  const interviewScore = d.interviewScore;
  const avgRepeatAccuracy = d.avgRepeatAccuracy;
  const elapsed = d.elapsed;

  // Per-question snapshots are only present on mocks saved after the upgrade;
  // legacy records carry a score summary only.
  const repeatItems = Array.isArray(d.repeatItems) ? d.repeatItems : [];
  const interviewItems = Array.isArray(d.interviewItems) ? d.interviewItems : [];
  const hasItems = repeatItems.length > 0 || interviewItems.length > 0;

  const [primaryTab, setPrimaryTab] = useState("overview");

  const bc = getBandColor(band);
  const bandStr = Number.isFinite(band) ? band.toFixed(1) : "—";

  // Build primary tabs: overview + one per task (only when its items exist).
  const primaryTabs = [
    { key: "overview", label: "概览 · 总体", color: accent, score: null },
    ...(repeatItems.length > 0
      ? [{ key: "repeat", label: "Task 1 · 听后复述", color: REPEAT_COLOR, score: `${repeatScore != null ? repeatScore : "—"}/5` }]
      : []),
    ...(interviewItems.length > 0
      ? [{ key: "interview", label: "Task 2 · 模拟面试", color: INTERVIEW_COLOR, score: `${interviewScore != null ? interviewScore : "—"}/5` }]
      : []),
  ];

  // Enlarged score cell (full-screen variant of the practice-list mini cells).
  const scoreCell = (label, value, hint, valueColor) => (
    <div style={{ flex: 1, padding: "16px 18px", background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 14, textAlign: "center" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: valueColor || C.text, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>{hint}</div>}
    </div>
  );

  function renderOverview() {
    // Interview dimension averages (fluency / intelligibility / language / organization).
    const validIntv = interviewItems.filter((s) => s.aiScore && !s.aiScore.error);
    const dimKeys = ["fluency", "intelligibility", "language", "organization"];
    const dimAvg = {};
    dimKeys.forEach((key) => {
      const vals = validIntv.map((s) => s.aiScore?.dimensions?.[key]?.score).filter((v) => v != null);
      dimAvg[key] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 2) / 2 : null;
    });
    const anyDim = dimKeys.some((k) => dimAvg[k] != null);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Score cells */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {scoreCell("Band", bandStr, cefr ? `CEFR ${cefr}` : null, bc)}
          {scoreCell("听后复述", avgRepeatAccuracy != null ? `${avgRepeatAccuracy}%` : "—", repeatScore != null ? `Score ${repeatScore}/5` : null)}
          {scoreCell("模拟面试", interviewScore != null ? `${interviewScore}/5` : "—", null)}
        </div>

        {/* Legacy record placeholder — mirrors reading MockSessionDetail. */}
        {!hasItems && (
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
        )}

        {/* Interview dimension averages */}
        {interviewItems.length > 0 && anyDim && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
              面试维度得分
            </div>
            <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap", padding: "14px 16px", background: C.surface, border: `1px solid ${C.borderSubtle}`, borderRadius: 12 }}>
              {dimKeys.map((key) => {
                if (dimAvg[key] == null) return null;
                return (
                  <div key={key} style={{ textAlign: "center", minWidth: 64 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: DIM_COLORS[key] }}>{dimAvg[key]}</div>
                    <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600, marginTop: 2 }}>{DIM_LABELS[key].label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Per-question mini bars */}
        {repeatItems.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
              听后复述 · 逐句准确率
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {repeatItems.map((item, i) => {
                const acc = item.score?.accuracy ?? null;
                const label = !item.recorded ? "未录制" : acc == null ? "未评分" : `${acc}%`;
                return <div key={i} title={`S${i + 1}: ${label}`} style={{ flex: 1, height: 8, borderRadius: 4, background: miniBarColor(item.recorded, acc, 80, 60) }} />;
              })}
            </div>
          </div>
        )}
        {interviewItems.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
              模拟面试 · 逐题得分
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {interviewItems.map((item, i) => {
                const sc = item.aiScore && !item.aiScore.error ? item.aiScore.score ?? null : null;
                const label = !item.recorded ? "已跳过" : sc == null ? "未评分" : `${sc}/5`;
                return <div key={i} title={`Q${i + 1}: ${label}`} style={{ flex: 1, height: 8, borderRadius: 4, background: miniBarColor(item.recorded, sc, 4, 3) }} />;
              })}
            </div>
          </div>
        )}

        {/* Elapsed */}
        {elapsed != null && (
          <div style={{ fontSize: 12, color: C.textSec, padding: "8px 14px", background: `${accent}0C`, borderRadius: 10, borderLeft: `3px solid ${accent}` }}>
            <span style={{ fontWeight: 700, color: accent, marginRight: 6 }}>用时</span>{Math.floor(elapsed / 60)} 分 {elapsed % 60} 秒
          </div>
        )}
      </div>
    );
  }

  function renderTabContent() {
    if (primaryTab === "overview") return renderOverview();
    if (primaryTab === "repeat") {
      // Synthesize a session so the shared renderer can be reused verbatim.
      return (
        <RepeatDetail
          session={{ details: { items: repeatItems, attempted: repeatItems.filter((i) => i.recorded).length, total: repeatItems.length } }}
        />
      );
    }
    if (primaryTab === "interview") {
      return (
        <InterviewDetail
          session={{ details: { items: interviewItems, attempted: interviewItems.filter((i) => i.recorded).length, total: interviewItems.length } }}
        />
      );
    }
    return null;
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
      {/* Header — mirrors reading MockSessionDetail / writing FullMockReport */}
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
              口语详细诊断报告
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
            {d.rawTotal != null && (
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
                原始分 {d.rawTotal}/55
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

      {/* Primary tabs — mirrors reading MockSessionDetail's primaryTabs */}
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
