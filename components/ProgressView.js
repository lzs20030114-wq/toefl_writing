"use client";
import React, { useEffect, useMemo, useState } from "react";
import { loadHist, deleteSession, clearAllSessions, SESSION_STORE_EVENTS } from "../lib/sessionStore";
import { buildHistoryEntries, buildHistoryStats } from "../lib/history/viewModel";
import { C, FONT, Btn, TopBar } from "./shared/ui";
import { HistoryRow } from "./history/HistoryRow";

/* ── helpers ─────────────────────────────────────────────── */

function getBandColor(band) {
  if (band >= 5.5) return "#16a34a";
  if (band >= 4.5) return "#2563eb";
  if (band >= 3.5) return "#d97706";
  if (band >= 2.5) return "#ea580c";
  return "#dc2626";
}

function getBandLabel(band) {
  if (band >= 5.5) return "C1+";
  if (band >= 4.5) return "B2\u2013C1";
  if (band >= 3.5) return "B1\u2013B2";
  if (band >= 2.5) return "A2\u2013B1";
  return "A1\u2013A2";
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

function getTaskScoreFromMock(s, taskId) {
  const t = Array.isArray(s?.details?.tasks) ? s.details.tasks.find((x) => x.taskId === taskId) : null;
  if (!t || !Number.isFinite(t.score)) return null;
  return `${t.score}/${t.maxScore}`;
}

/* ── SVG components ──────────────────────────────────────── */

function BandRing({ band, size = 88 }) {
  const color = getBandColor(band);
  const pct = Math.max(0, Math.min(100, ((band - 1) / 5) * 100));
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={6} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size * 0.3, fontWeight: 800, color, lineHeight: 1 }}>{band.toFixed(1)}</span>
        <span style={{ fontSize: size * 0.12, color: "#9ca3af", marginTop: 1 }}>/ 6.0</span>
      </div>
    </div>
  );
}

function MockTrend({ mocks }) {
  const sorted = [...mocks].sort((a, b) => new Date(a.date) - new Date(b.date));
  const bands = sorted.map((m) => m.band);
  const min = Math.min(...bands, 1);
  const max = Math.max(...bands, 6);
  const range = max - min || 1;
  const w = 120;
  const h = 32;
  const pts = bands.map((b, i) => {
    const x = (i / (bands.length - 1)) * w;
    const y = h - ((b - min) / range) * h;
    return { x, y, b };
  });

  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={getBandColor(p.b)} />
      ))}
    </svg>
  );
}

/* ── section bar ─────────────────────────────────────────── */

function SectionBar({ color, label, count }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid " + C.bdr }}>
      <div style={{ width: 4, height: 18, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: C.t1, letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</span>
      {Number.isFinite(count) && (
        <span style={{ fontSize: 11, fontWeight: 700, background: "#f0f4ff", color: "#3b82f6", borderRadius: 10, padding: "1px 8px" }}>{count}</span>
      )}
    </div>
  );
}

/* ── tab filter ───────────────────────────────────────────── */

const PRACTICE_TABS = [
  { key: "all", label: "All" },
  { key: "build", label: "\u{1F9E9} Build", type: "bs" },
  { key: "email", label: "\u{1F4E7} Email", type: "email" },
  { key: "discussion", label: "\u{1F4AC} Disc.", type: "discussion" },
];

function TabBar({ active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 0, borderBottom: "1px solid " + C.bdr }}>
      {PRACTICE_TABS.map((t) => {
        const sel = active === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              flex: 1,
              padding: "10px 0",
              background: sel ? "#f0f4ff" : "transparent",
              border: "none",
              borderBottom: sel ? "2px solid #3b82f6" : "2px solid transparent",
              fontSize: 13,
              fontWeight: sel ? 700 : 500,
              color: sel ? "#3b82f6" : C.t2,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── type icon helper ─────────────────────────────────────── */

function typeIcon(type) {
  if (type === "bs") return "\u{1F9E9}";
  if (type === "email") return "\u{1F4E7}";
  if (type === "discussion") return "\u{1F4AC}";
  return "";
}

/* ── main component ───────────────────────────────────────── */

export function ProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
  const [expandedMock, setExpandedMock] = useState(null);
  const [expandedPractice, setExpandedPractice] = useState(null);
  const [tab, setTab] = useState("all");

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
  const hasPendingMock = stats.hasPendingMock;

  // Split entries into mock vs practice
  const mockEntries = useMemo(
    () => entries.filter((e) => e.session.type === "mock").sort((a, b) => new Date(b.session.date) - new Date(a.session.date)),
    [entries],
  );
  const practiceEntries = useMemo(
    () => entries.filter((e) => e.session.type !== "mock").sort((a, b) => new Date(b.session.date) - new Date(a.session.date)),
    [entries],
  );

  // Practice type stats
  const bs = stats.byType.bs;
  const em = stats.byType.email;
  const di = stats.byType.discussion;

  // Mock band stats
  const mockBands = useMemo(() => mockEntries.map((e) => e.session).filter((s) => Number.isFinite(s.band)), [mockEntries]);
  const latestMock = mockEntries.length > 0 ? mockEntries[0].session : null;
  const bestBand = mockBands.length > 0 ? Math.max(...mockBands.map((m) => m.band)) : null;
  const avgBand = mockBands.length > 0 ? mockBands.reduce((a, m) => a + m.band, 0) / mockBands.length : null;

  // Filtered practice list
  const filteredPractice = useMemo(() => {
    if (tab === "all") return practiceEntries;
    const t = PRACTICE_TABS.find((x) => x.key === tab);
    return t?.type ? practiceEntries.filter((e) => e.session.type === t.type) : practiceEntries;
  }, [practiceEntries, tab]);

  // Auto-poll for pending mock scoring
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
    if (expandedMock === sourceIndex) setExpandedMock(null);
    if (expandedPractice === sourceIndex) setExpandedPractice(null);
  }

  function handleClearAll() {
    if (!window.confirm("Delete all history records?")) return;
    const newHist = clearAllSessions();
    setHist({ ...newHist });
    setExpandedMock(null);
    setExpandedPractice(null);
  }

  const isEmpty = entries.length === 0;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title="Practice History" section="Progress" onExit={onBack} />
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>

        {isEmpty && (
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, padding: 40, textAlign: "center", color: C.t2 }}>
            No history records yet.
          </div>
        )}

        {!isEmpty && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* ═══════ MOCK EXAMS SECTION ═══════ */}
            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, overflow: "hidden" }}>
              <SectionBar color={C.nav} label="Mock Exams" count={mockEntries.length} />

              {mockEntries.length === 0 ? (
                <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 13, color: C.t2 }}>
                  No mock exams yet. Take your first mock exam to see your Band score here.
                </div>
              ) : (
                <>
                  {/* Latest result hero */}
                  {latestMock && Number.isFinite(latestMock.band) && (
                    <div style={{ padding: "20px 20px 16px", display: "flex", gap: 20, alignItems: "center", borderBottom: "1px solid #f0f0f0" }}>
                      <BandRing band={latestMock.band} size={88} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: C.t2, letterSpacing: 0.5, marginBottom: 4 }}>LATEST RESULT</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 20, fontWeight: 800, color: getBandColor(latestMock.band) }}>
                            Band {latestMock.band.toFixed(1)}
                          </span>
                          <span style={{ fontSize: 12, color: C.t2, fontWeight: 600 }}>{getBandLabel(latestMock.band)}</span>
                        </div>
                        <div style={{ fontSize: 13, color: C.t1, marginBottom: 6 }}>
                          Scaled {latestMock.scaledScore ?? "--"}/30
                        </div>
                        <div style={{ fontSize: 12, color: C.t2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <span>{"\u{1F9E9}"} {getTaskScoreFromMock(latestMock, "build-sentence") || "--"}</span>
                          <span>{"\u{1F4E7}"} {getTaskScoreFromMock(latestMock, "email-writing") || "--"}</span>
                          <span>{"\u{1F4AC}"} {getTaskScoreFromMock(latestMock, "academic-writing") || "--"}</span>
                        </div>
                        {mockBands.length >= 2 && (
                          <div style={{ marginTop: 8 }}>
                            <MockTrend mocks={mockBands} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Mock history list */}
                  <div style={{ padding: "0 16px" }}>
                    {mockEntries.map((entry, i) => (
                      <HistoryRow
                        key={entry.sourceIndex}
                        entry={entry}
                        isExpanded={expandedMock === entry.sourceIndex}
                        isLast={i === mockEntries.length - 1}
                        onToggle={() => setExpandedMock(expandedMock === entry.sourceIndex ? null : entry.sourceIndex)}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>

                  {/* Mock stats footer */}
                  {mockBands.length > 1 && (
                    <div style={{ padding: "10px 16px", borderTop: "1px solid #f0f0f0", display: "flex", gap: 20, fontSize: 12, color: C.t2 }}>
                      <span>{"\u{1F3C6}"} Best: <b style={{ color: getBandColor(bestBand) }}>{bestBand.toFixed(1)}</b></span>
                      <span>Avg: <b style={{ color: C.t1 }}>{avgBand.toFixed(1)}</b></span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ═══════ PRACTICE SECTION ═══════ */}
            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, overflow: "hidden" }}>
              <SectionBar color="#3b82f6" label="Practice" count={practiceEntries.length} />

              {/* Stats cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, padding: "16px 16px 12px" }}>
                {[
                  {
                    icon: "\u{1F9E9}",
                    label: "Build",
                    n: bs.length,
                    stat: bs.length ? Math.round(bs.reduce((a, s) => a + (s.correct / s.total) * 100, 0) / bs.length) + "%" : "-",
                  },
                  {
                    icon: "\u{1F4E7}",
                    label: "Email",
                    n: em.length,
                    stat: em.length ? (em.reduce((a, s) => a + s.score, 0) / em.length).toFixed(1) + "/5" : "-",
                  },
                  {
                    icon: "\u{1F4AC}",
                    label: "Discussion",
                    n: di.length,
                    stat: di.length ? (di.reduce((a, s) => a + s.score, 0) / di.length).toFixed(1) + "/5" : "-",
                  },
                ].map((c, i) => (
                  <div key={i} style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: C.t2, marginBottom: 4 }}>{c.icon} {c.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: C.nav }}>{c.n}</div>
                    <div style={{ fontSize: 12, color: C.t2 }}>{c.stat}</div>
                  </div>
                ))}
              </div>

              {/* Tab filter */}
              <TabBar active={tab} onChange={setTab} />

              {/* Practice list */}
              <div style={{ padding: "0 16px" }}>
                {filteredPractice.length === 0 ? (
                  <div style={{ padding: "20px 0", textAlign: "center", fontSize: 13, color: C.t2 }}>
                    {practiceEntries.length === 0
                      ? "No practice sessions yet."
                      : "No records for this filter."}
                  </div>
                ) : (
                  filteredPractice.map((entry, i) => (
                    <HistoryRow
                      key={entry.sourceIndex}
                      entry={entry}
                      isExpanded={expandedPractice === entry.sourceIndex}
                      isLast={i === filteredPractice.length - 1}
                      onToggle={() => setExpandedPractice(expandedPractice === entry.sourceIndex ? null : entry.sourceIndex)}
                      onDelete={handleDelete}
                      showIcon
                    />
                  ))
                )}
              </div>
            </div>

            {/* ═══════ BOTTOM BUTTONS ═══════ */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Btn onClick={onBack}>Back to Menu</Btn>
              <button
                onClick={handleClearAll}
                style={{
                  background: "#fff",
                  color: C.red,
                  border: "1px solid " + C.red,
                  borderRadius: 4,
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                Clear All
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
