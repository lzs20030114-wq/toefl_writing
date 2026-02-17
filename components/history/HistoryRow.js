"use client";
import React from "react";
import { C } from "../shared/ui";
import { ScoringReport } from "../writing/ScoringReport";

function getTypeLabel(type) {
  if (type === "bs") return "Build";
  if (type === "email") return "Email";
  if (type === "discussion") return "Discussion";
  if (type === "mock") return "Mock Exam";
  return "Unknown";
}

function typeIcon(type) {
  if (type === "bs") return "\u{1F9E9} ";
  if (type === "email") return "\u{1F4E7} ";
  if (type === "discussion") return "\u{1F4AC} ";
  return "";
}

function getScoreLabel(s) {
  if (s.type === "bs") return `${s.correct}/${s.total}`;
  if (s.type === "mock") {
    if (Number.isFinite(s.band)) return `${s.band.toFixed(1)} /6`;
    return `${s.score || 0}%`;
  }
  return `${s.score}/5`;
}

function getScoreColor(s) {
  if (s.type === "bs") return s.correct / s.total >= 0.8 ? C.green : C.orange;
  if (s.type === "mock") {
    const band = s.band;
    if (Number.isFinite(band)) {
      if (band >= 5.5) return "#16a34a";
      if (band >= 4.5) return "#2563eb";
      if (band >= 3.5) return "#d97706";
      if (band >= 2.5) return "#ea580c";
      return "#dc2626";
    }
    const p = s.score || 0;
    if (p >= 80) return C.green;
    if (p >= 60) return C.orange;
    return C.red;
  }
  if (s.score >= 4) return C.green;
  if (s.score >= 3) return C.orange;
  return C.red;
}

function fmtDate(d) {
  try {
    const dt = new Date(d);
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  } catch {
    return String(d || "");
  }
}

export function HistoryRow({ entry, isExpanded, isLast, onToggle, onDelete, showIcon }) {
  const s = entry.session;
  const sourceIndex = entry.sourceIndex;

  return (
    <div>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: isLast ? "none" : "1px solid #eee", cursor: "pointer" }}
        onClick={onToggle}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: C.t2, userSelect: "none", flexShrink: 0 }}>{isExpanded ? "\u25BC" : "\u25B6"}</span>
          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
            {showIcon ? typeIcon(s.type) : ""}{getTypeLabel(s.type)}
          </span>
          {s.type === "mock" && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 8px", borderRadius: 10, flexShrink: 0, background: s.details?.scoringPhase === "error" ? "#fee2e2" : s.details?.scoringPhase === "done" ? "#dcfce7" : "#dbeafe", color: s.details?.scoringPhase === "error" ? C.red : s.details?.scoringPhase === "done" ? C.green : C.blue }}>
              {s.details?.scoringPhase === "error" ? "error" : s.details?.scoringPhase === "done" ? "done" : "scoring..."}
            </span>
          )}
          <span style={{ fontSize: 11, color: C.t2, whiteSpace: "nowrap" }}>{fmtDate(s.date)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: getScoreColor(s) }}>{getScoreLabel(s)}</span>
          <button onClick={(e) => { e.stopPropagation(); onDelete(sourceIndex); }} title="Delete this entry" style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, padding: "2px 6px", lineHeight: 1, fontWeight: 700, opacity: 0.6 }} onMouseOver={(e) => (e.currentTarget.style.opacity = "1")} onMouseOut={(e) => (e.currentTarget.style.opacity = "0.6")}>
            x
          </button>
        </div>
      </div>

      {isExpanded && s.details && s.type === "bs" && Array.isArray(s.details) && (
        <div style={{ background: "#f9f9f9", border: "1px solid #eee", borderRadius: 4, padding: 16, margin: "4px 0 8px 0" }}>
          <div style={{ fontSize: 12, color: C.t2, marginBottom: 8 }}>Correct {s.correct}/{s.total}</div>
          {s.details.map((d, j) => (
            <div key={j} style={{ padding: "8px 0", borderBottom: j < s.details.length - 1 ? "1px solid #eee" : "none", fontSize: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ color: d.isCorrect ? C.green : C.red, fontWeight: 700 }}>{d.isCorrect ? "OK" : "X"}</span>
                <span style={{ color: C.t2 }}>Q{j + 1}: {d.prompt}</span>
                <span style={{ fontSize: 11, color: C.blue, marginLeft: "auto" }}>({Array.isArray(d.grammar_points) ? d.grammar_points.join(", ") : d.gp || ""})</span>
              </div>
              <div style={{ paddingLeft: 24 }}>
                <div style={{ color: d.isCorrect ? C.green : C.red }}>Your answer: {d.userAnswer || "(no answer)"}</div>
                {!d.isCorrect && <div style={{ color: C.blue, marginTop: 2 }}>Correct answer: {d.correctAnswer}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {isExpanded && s.details && (s.type === "email" || s.type === "discussion") && s.details.userText && (
        <div style={{ background: "#f9f9f9", border: "1px solid #eee", borderRadius: 4, padding: 16, margin: "4px 0 8px 0" }}>
          {s.details.promptSummary && <div style={{ fontSize: 12, color: C.t2, marginBottom: 8 }}>Prompt: {s.details.promptSummary}</div>}
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 12, marginBottom: 12, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.t2, marginBottom: 6 }}>Your response</div>
            {s.details.userText}
          </div>
          {s.details.feedback && <ScoringReport result={s.details.feedback} type={s.type} />}
        </div>
      )}

      {isExpanded && s.type === "mock" && s.details && (
        <div style={{ background: "#f9f9f9", border: "1px solid #eee", borderRadius: 4, padding: 16, margin: "4px 0 8px 0" }}>
          <div style={{ fontSize: 12, color: C.t2, marginBottom: 8 }}>
            {Number.isFinite(s.band) ? `Band ${s.band.toFixed(1)} | Scaled ${s.scaledScore ?? "--"}/30 | CEFR ${s.cefr ?? "--"} | ` : ""}
            Overall: {s.score || 0}%
          </div>
          {Array.isArray(s.details.tasks) && s.details.tasks.map((t, j) => (
            <div key={j} style={{ padding: "8px 0", borderBottom: j < s.details.tasks.length - 1 ? "1px solid #eee" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{t.title || t.taskId}</span>
                <span>{Number.isFinite(t.score) ? `${t.score}/${t.maxScore}` : "pending"}</span>
              </div>
              {t.taskId === "build-sentence" && Array.isArray(t.meta?.details) && t.meta.details.length > 0 && (
                <div style={{ marginTop: 6, paddingLeft: 8 }}>
                  {t.meta.details.map((d, k) => (
                    <div key={k} style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>
                      Q{k + 1}: {d.isCorrect ? "Correct" : "Incorrect"} | Your: {d.userAnswer || "(no answer)"} {!d.isCorrect ? `| Correct: ${d.correctAnswer || ""}` : ""}
                    </div>
                  ))}
                </div>
              )}
              {(t.taskId === "email-writing" || t.taskId === "academic-writing") && t.meta?.response?.userText && (
                <div style={{ marginTop: 8 }}>
                  {!!t.meta?.response?.promptSummary && <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>Prompt: {t.meta.response.promptSummary}</div>}
                  <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 10, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 8 }}>
                    {t.meta.response.userText}
                  </div>
                  {t.meta.feedback && <ScoringReport result={t.meta.feedback} type={t.taskId === "email-writing" ? "email" : "discussion"} />}
                  {!t.meta.feedback && t.meta.error && <div style={{ fontSize: 12, color: C.red }}>Scoring error: {t.meta.error}</div>}
                </div>
              )}
            </div>
          ))}
          {s.details.scoringPhase === "error" && <div style={{ fontSize: 12, color: C.red, marginTop: 8 }}>Scoring error: {s.details.scoringError || "unknown"}</div>}
        </div>
      )}

      {isExpanded && !s.details && (
        <div style={{ background: "#f9f9f9", border: "1px solid #eee", borderRadius: 4, padding: 16, margin: "4px 0 8px 0", fontSize: 13, color: C.t2, textAlign: "center" }}>
          No detail data for this record (legacy entry).
        </div>
      )}
    </div>
  );
}
