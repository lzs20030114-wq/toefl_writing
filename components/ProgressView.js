"use client";
import React, { useState, useEffect } from "react";
import { loadHist, deleteSession, clearAllSessions } from "../lib/sessionStore";
import { C, FONT, Btn, TopBar } from "./shared/ui";
import { ScoringReport } from "./writing/ScoringReport";

export function ProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
  const [expandedIdx, setExpandedIdx] = useState(null);
  useEffect(() => { setHist(loadHist()); }, []);
  if (!hist) return <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center" }}>Loading...</div>;
  const ss = hist.sessions || [];
  const em = ss.filter(s => s.type === "email");
  const di = ss.filter(s => s.type === "discussion");
  const bs = ss.filter(s => s.type === "bs");

  function handleDelete(realIndex) {
    if (!window.confirm("Delete this record?")) return;
    const newHist = deleteSession(realIndex);
    setHist({ ...newHist });
    if (expandedIdx === realIndex) setExpandedIdx(null);
  }

  function handleClearAll() {
    if (!window.confirm("Delete all history records?")) return;
    const newHist = clearAllSessions();
    setHist({ ...newHist });
    setExpandedIdx(null);
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title="Practice History" section="Progress" onExit={onBack} />
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
        {ss.length === 0 ? <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 40, textAlign: "center" }}>No history records yet.</div> : (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <button onClick={handleClearAll} style={{ background: C.red, color: "#fff", border: "none", borderRadius: 4, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>Clear All</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
              {[
                { l: "Build", n: bs.length, s: bs.length ? Math.round(bs.reduce((a, s) => a + s.correct / s.total * 100, 0) / bs.length) + "%" : "-" },
                { l: "Email", n: em.length, s: em.length ? (em.reduce((a, s) => a + s.score, 0) / em.length).toFixed(1) + "/5" : "-" },
                { l: "Discussion", n: di.length, s: di.length ? (di.reduce((a, s) => a + s.score, 0) / di.length).toFixed(1) + "/5" : "-" }
              ].map((c, i) => <div key={i} style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 16, textAlign: "center" }}><div style={{ fontSize: 11, color: C.t2, marginBottom: 6 }}>{c.l}</div><div style={{ fontSize: 24, fontWeight: 700, color: C.nav }}>{c.n}</div><div style={{ fontSize: 12, color: C.t2 }}>{c.s}</div></div>)}
            </div>
            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.nav, marginBottom: 12 }}>Recent Attempts</div>
              {ss.slice(-10).reverse().map((s, i) => {
                const realIndex = ss.length - 1 - i;
                return (
                  <div key={i}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < Math.min(ss.length, 10) - 1 ? "1px solid #eee" : "none", cursor: "pointer" }} onClick={() => setExpandedIdx(expandedIdx === realIndex ? null : realIndex)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, color: C.t2, userSelect: "none" }}>{expandedIdx === realIndex ? "▼" : "▶"}</span>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{s.type === "bs" ? "Build" : s.type === "email" ? "Email" : "Discussion"}</span>
                        <span style={{ fontSize: 11, color: C.t2 }}>{new Date(s.date).toLocaleDateString()}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: s.type === "bs" ? (s.correct / s.total >= 0.8 ? C.green : C.orange) : (s.score >= 4 ? C.green : s.score >= 3 ? C.orange : C.red) }}>{s.type === "bs" ? s.correct + "/" + s.total : s.score + "/5"}</span>
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(realIndex); }} title="Delete this entry" style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, padding: "2px 6px", lineHeight: 1, fontWeight: 700, opacity: 0.6 }} onMouseOver={e => e.currentTarget.style.opacity = "1"} onMouseOut={e => e.currentTarget.style.opacity = "0.6"}>x</button>
                      </div>
                    </div>
                    {expandedIdx === realIndex && s.details && s.type === "bs" && Array.isArray(s.details) && (
                      <div style={{ background: "#f9f9f9", border: "1px solid #eee", borderRadius: 4, padding: 16, margin: "4px 0 8px 0" }}>
                        <div style={{ fontSize: 12, color: C.t2, marginBottom: 8 }}>
                          正确 {s.correct}/{s.total}
                        </div>
                        {s.details.map((d, j) => (
                          <div key={j} style={{
                            padding: "8px 0",
                            borderBottom: j < s.details.length - 1 ? "1px solid #eee" : "none",
                            fontSize: 13
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                              <span style={{ color: d.isCorrect ? C.green : C.red, fontWeight: 700 }}>
                                {d.isCorrect ? "✓" : "✗"}
                              </span>
                              <span style={{ color: C.t2 }}>Q{j + 1}: {d.prompt}</span>
                              <span style={{ fontSize: 11, color: C.blue, marginLeft: "auto" }}>({d.gp})</span>
                            </div>
                            <div style={{ paddingLeft: 24 }}>
                              <div style={{ color: d.isCorrect ? C.green : C.red }}>
                                我的答案：{d.userAnswer || "(未作答)"}
                              </div>
                              {!d.isCorrect && (
                                <div style={{ color: C.blue, marginTop: 2 }}>
                                  正确答案：{d.correctAnswer}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {expandedIdx === realIndex && s.details && (s.type === "email" || s.type === "discussion") && s.details.userText && (
                      <div style={{ background: "#f9f9f9", border: "1px solid #eee", borderRadius: 4, padding: 16, margin: "4px 0 8px 0" }}>
                        {s.details.promptSummary && (
                          <div style={{ fontSize: 12, color: C.t2, marginBottom: 8 }}>
                            题目：{s.details.promptSummary}
                          </div>
                        )}
                        <div style={{
                          background: "#fff",
                          border: "1px solid " + C.bdr,
                          borderRadius: 4,
                          padding: 12,
                          marginBottom: 12,
                          fontSize: 13,
                          lineHeight: 1.7,
                          whiteSpace: "pre-wrap"
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: C.t2, marginBottom: 6 }}>我的回答</div>
                          {s.details.userText}
                        </div>
                        {s.details.feedback && (
                          <ScoringReport result={s.details.feedback} type={s.type} />
                        )}
                      </div>
                    )}
                    {expandedIdx === realIndex && !s.details && (
                      <div style={{ background: "#f9f9f9", border: "1px solid #eee", borderRadius: 4, padding: 16, margin: "4px 0 8px 0", fontSize: 13, color: C.t2, textAlign: "center" }}>
                        该记录无详细数据（旧版本记录）
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ marginTop: 20 }}><Btn onClick={onBack} variant="secondary">Back to Menu</Btn></div>
      </div>
    </div>
  );
}
