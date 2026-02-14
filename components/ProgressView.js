"use client";
import React, { useState, useEffect } from "react";
import { loadHist, deleteSession, clearAllSessions } from "../lib/sessionStore";
import { C, FONT, Btn, TopBar } from "./shared/ui";

export function ProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
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
  }

  function handleClearAll() {
    if (!window.confirm("Delete all history records?")) return;
    const newHist = clearAllSessions();
    setHist({ ...newHist });
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
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < Math.min(ss.length, 10) - 1 ? "1px solid #eee" : "none" }}>
                    <div><span style={{ fontSize: 13, fontWeight: 600 }}>{s.type === "bs" ? "Build" : s.type === "email" ? "Email" : "Discussion"}</span><span style={{ fontSize: 11, color: C.t2, marginLeft: 8 }}>{new Date(s.date).toLocaleDateString()}</span></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: s.type === "bs" ? (s.correct / s.total >= 0.8 ? C.green : C.orange) : (s.score >= 4 ? C.green : s.score >= 3 ? C.orange : C.red) }}>{s.type === "bs" ? s.correct + "/" + s.total : s.score + "/5"}</span>
                      <button onClick={() => handleDelete(realIndex)} title="Delete this entry" style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, padding: "2px 6px", lineHeight: 1, fontWeight: 700, opacity: 0.6 }} onMouseOver={e => e.currentTarget.style.opacity = "1"} onMouseOut={e => e.currentTarget.style.opacity = "0.6"}>x</button>
                    </div>
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
