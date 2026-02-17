"use client";
import React, { useEffect, useMemo, useState } from "react";
import { loadHist, deleteSession, clearAllSessions, SESSION_STORE_EVENTS } from "../lib/sessionStore";
import { buildHistoryEntries, buildHistoryStats, buildRecentEntries } from "../lib/history/viewModel";
import { C, FONT, Btn, TopBar } from "./shared/ui";
import { HistoryRow } from "./history/HistoryRow";

export function ProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
  const [expandedIdx, setExpandedIdx] = useState(null);

  useEffect(() => {
    const refresh = () => setHist(loadHist());
    refresh();
    window.addEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const entries = useMemo(() => buildHistoryEntries(hist), [hist]);
  const stats = useMemo(() => buildHistoryStats(entries), [entries]);
  const sessions = stats.sessions;
  const bs = stats.byType.bs;
  const em = stats.byType.email;
  const di = stats.byType.discussion;
  const mk = stats.byType.mock;
  const hasPendingMock = stats.hasPendingMock;

  useEffect(() => {
    if (!hist || !hasPendingMock) return;
    const timer = setInterval(() => setHist(loadHist()), 3000);
    return () => clearInterval(timer);
  }, [hist, hasPendingMock]);

  if (!hist) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center" }}>
        Loading...
      </div>
    );
  }

  function handleDelete(sourceIndex) {
    if (!window.confirm("Delete this record?")) return;
    const newHist = deleteSession(sourceIndex);
    setHist({ ...newHist });
    if (expandedIdx === sourceIndex) setExpandedIdx(null);
  }

  function handleClearAll() {
    if (!window.confirm("Delete all history records?")) return;
    const newHist = clearAllSessions();
    setHist({ ...newHist });
    setExpandedIdx(null);
  }

  const recent = buildRecentEntries(entries, 10);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title="Practice History" section="Progress" onExit={onBack} />
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
        {sessions.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 40, textAlign: "center" }}>
            No history records yet.
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <button onClick={handleClearAll} style={{ background: C.red, color: "#fff", border: "none", borderRadius: 4, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
                Clear All
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
              {[
                { l: "Build", n: bs.length, s: bs.length ? Math.round(bs.reduce((a, s) => a + (s.correct / s.total) * 100, 0) / bs.length) + "%" : "-" },
                { l: "Email", n: em.length, s: em.length ? (em.reduce((a, s) => a + s.score, 0) / em.length).toFixed(1) + "/5" : "-" },
                { l: "Discussion", n: di.length, s: di.length ? (di.reduce((a, s) => a + s.score, 0) / di.length).toFixed(1) + "/5" : "-" },
                { l: "Mock", n: mk.length, s: mk.length ? (() => { const withBand = mk.filter((m) => Number.isFinite(m.band)); return withBand.length ? "Band " + (withBand.reduce((a, m) => a + m.band, 0) / withBand.length).toFixed(1) : Math.round(mk.reduce((a, m) => a + (m.score || 0), 0) / mk.length) + "%"; })() : "-" },
              ].map((c, i) => (
                <div key={i} style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: C.t2, marginBottom: 6 }}>{c.l}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: C.nav }}>{c.n}</div>
                  <div style={{ fontSize: 12, color: C.t2 }}>{c.s}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.nav, marginBottom: 12 }}>Recent Attempts</div>
              {recent.map((entry, i) => {
                return (
                  <HistoryRow
                    key={entry.sourceIndex}
                    entry={entry}
                    isExpanded={expandedIdx === entry.sourceIndex}
                    isLast={i === recent.length - 1}
                    onToggle={() => setExpandedIdx(expandedIdx === entry.sourceIndex ? null : entry.sourceIndex)}
                    onDelete={handleDelete}
                  />
                );
              })}
            </div>
          </div>
        )}
        <div style={{ marginTop: 20 }}>
          <Btn onClick={onBack} variant="secondary">Back to Menu</Btn>
        </div>
      </div>
    </div>
  );
}
