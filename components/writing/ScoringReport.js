"use client";
import React from "react";
import { C } from "../shared/ui";

export function ScoringReport({ result, type }) {
  if (!result) return null;
  const sc = result.score >= 4 ? C.green : result.score >= 3 ? C.orange : C.red;
  return (
    <div data-testid="score-panel" style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, overflow: "hidden" }}>
      <div style={{ background: C.nav, color: "#fff", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>ETS Scoring</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 36, fontWeight: 800 }}>{result.score}</span>
            <span style={{ fontSize: 16, opacity: 0.7 }}>/ 5</span>
            <span style={{ background: sc, padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600, marginLeft: 8 }}>Band {result.band}</span>
          </div>
        </div>
      </div>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ color: C.t1, fontSize: 14, lineHeight: 1.6, margin: 0 }}>{result.summary}</p>
        {type === "email" && result.goals_met && (
          <div style={{ background: C.ltB, borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>Goal Coverage</div>
            {result.goals_met.map((m, i) => (
              <div key={i} style={{ fontSize: 13, marginBottom: 3 }}>
                <span style={{ color: m ? C.green : C.red, fontWeight: 700, marginRight: 6 }}>{m ? "OK" : "NO"}</span>
                Goal {i + 1}
              </div>
            ))}
          </div>
        )}
        {type === "discussion" && (
          <div style={{ background: C.ltB, borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>Discussion Engagement</div>
            <div style={{ fontSize: 13, marginBottom: 3 }}>
              <span style={{ color: result.engages_professor ? C.green : C.red, fontWeight: 700, marginRight: 6 }}>{result.engages_professor ? "OK" : "NO"}</span>
              Professor
            </div>
            <div style={{ fontSize: 13 }}>
              <span style={{ color: result.engages_students ? C.green : C.red, fontWeight: 700, marginRight: 6 }}>{result.engages_students ? "OK" : "NO"}</span>
              Students
            </div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ background: "#f0fff4", border: "1px solid #c6f6d5", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 6 }}>Strengths</div>
            {(result.strengths || []).map((s, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>+ {s}</div>)}
          </div>
          <div style={{ background: "#fff5f5", border: "1px solid #fed7d7", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.red, marginBottom: 6 }}>Weaknesses</div>
            {(result.weaknesses || []).map((s, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>- {s}</div>)}
          </div>
        </div>
        {result.grammar_issues && result.grammar_issues.length > 0 && (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#b45309", marginBottom: 6 }}>Language Diagnostics</div>
            {result.grammar_issues.map((g, i) => <div key={i} style={{ fontSize: 13, marginBottom: 3 }}>- {g}</div>)}
            {result.vocabulary_note && <div style={{ fontSize: 13, marginTop: 6 }}><b>Vocabulary:</b> {result.vocabulary_note}</div>}
            {result.argument_quality && <div style={{ fontSize: 13, marginTop: 4 }}><b>Argument:</b> {result.argument_quality}</div>}
          </div>
        )}
        {result.next_steps && result.next_steps.length > 0 && (
          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>Next Steps</div>
            {result.next_steps.map((s, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4 }}><b style={{ color: C.blue }}>{i + 1}.</b> {s}</div>)}
          </div>
        )}
        {result.sample && (
          <div style={{ background: "#f8f9fa", border: "1px solid " + C.bdr, borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>Sample Response (Score 5)</div>
            <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0, fontStyle: "italic" }}>{result.sample}</p>
          </div>
        )}
      </div>
    </div>
  );
}
