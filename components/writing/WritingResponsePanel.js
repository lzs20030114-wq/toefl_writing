"use client";
import React from "react";
import { C, Btn, FONT } from "../shared/ui";

export function WritingResponsePanel({
  type,
  pd,
  phase,
  text,
  onTextChange,
  w,
  minW,
  gen,
  fb,
  deferScoring,
  requestState,
  scoreError,
  onStart,
  onSubmit,
  onRetry,
  onNext,
  onGenNew,
  onExit,
  embedded,
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {phase === "ready" ? (
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 40, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 14, color: C.t2 }}>Read the prompt, then click start to begin writing.</div>
          <Btn data-testid="writing-start" onClick={onStart}>Start Writing</Btn>
        </div>
      ) : (
        <>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, overflow: "hidden", flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ background: "#e8e8e8", padding: "10px 16px", fontSize: 12, fontWeight: 700, color: C.t2, borderBottom: "1px solid " + C.bdr, display: "flex", justifyContent: "space-between" }}>
              <span>Your response</span>
              <span style={{ color: w < minW ? C.orange : C.green }}>{w} words {w < minW ? "(" + (minW - w) + " more)" : ""}</span>
            </div>
            <textarea
              data-testid="writing-textarea"
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              disabled={phase === "scoring" || phase === "done"}
              placeholder={type === "email" ? "Dear " + pd.to + ",\n\nI am writing to..." : "I think this is an interesting question..."}
              style={{ flex: 1, minHeight: type === "email" ? 280 : 320, border: "none", padding: 16, fontSize: 14, fontFamily: FONT, lineHeight: 1.7, color: C.t1, resize: "none", outline: "none", background: phase === "done" ? "#fafafa" : "#fff" }}
            />
          </div>
          {phase === "writing" && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Btn data-testid="writing-submit" onClick={onSubmit} variant="success">Submit for Scoring</Btn>
              <span style={{ fontSize: 11, color: C.t2 }}>Ctrl+Enter</span>
            </div>
          )}
        </>
      )}

      {phase === "scoring" && <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 32, textAlign: "center", color: C.t2 }}>AI is scoring your response...</div>}

      {phase === "done" && fb && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <Btn onClick={onNext} variant="secondary">Next Prompt</Btn>
            <Btn onClick={onGenNew} disabled={gen}>{gen ? "Generating..." : "Generate New Prompt"}</Btn>
            <Btn onClick={onExit} variant="secondary">{embedded ? "Back" : "Back to Practice"}</Btn>
          </div>
        </div>
      )}

      {phase === "done" && deferScoring && !fb && (
        <div style={{ marginTop: 20 }}>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.green, marginBottom: 6 }}>Response submitted</div>
            <div style={{ fontSize: 13, color: C.t2 }}>
              Scoring is deferred and will be processed in mock exam summary.
            </div>
          </div>
        </div>
      )}

      {phase === "done" && !fb && !deferScoring && (
        <div style={{ marginTop: 20 }}>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>!</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.red, marginBottom: 8 }}>Scoring failed</div>
            <div style={{ fontSize: 14, color: C.t2, marginBottom: 20 }}>The AI service did not return a valid score. You can retry or exit.</div>
            {requestState === "error" && !!scoreError && <div data-testid="score-error-reason" style={{ fontSize: 12, color: C.red, marginBottom: 12 }}>{scoreError}</div>}
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <Btn onClick={onRetry}>Retry Scoring</Btn>
              <Btn onClick={onExit} variant="secondary">{embedded ? "Back" : "Back to Practice"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
