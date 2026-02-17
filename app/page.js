"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { C, FONT } from "../components/shared/ui";
import { loadHist, SESSION_STORE_EVENTS } from "../lib/sessionStore";
import { formatMinutesLabel, getTaskTimeSeconds, normalizePracticeMode, PRACTICE_MODE } from "../lib/practiceMode";

const PRACTICE_TASKS = [
  { k: "build-sentence", modeKey: "build", n: "Task 1", t: "Build a Sentence", d: "Reorder words to form a grammatically correct response.", it: "10 questions" },
  { k: "email-writing", modeKey: "email", n: "Task 2", t: "Write an Email", d: "Respond appropriately to a workplace situation.", it: "80-120 words" },
  { k: "academic-writing", modeKey: "discussion", n: "Task 3", t: "Academic Discussion", d: "Respond to an academic discussion prompt.", it: "100+ words" },
];

const MOCK_TASK = {
  k: "mock-exam",
  n: "Full Writing Section",
  t: "Mock Exam Mode",
  d: "Simulated exam environment",
  it: "Task 1 + Task 2 + Task 3",
};

function timeBadge(time, bg = "#e8f0fe", color = C.nav) {
  return (
    <div style={{ width: 90, minWidth: 90, display: "flex", alignItems: "center", justifyContent: "center", background: bg, borderRight: "1px solid " + C.bdr, padding: "8px 4px" }}>
      <div style={{ fontSize: 22, lineHeight: 1, fontWeight: 800, color, whiteSpace: "nowrap" }}>{time}</div>
    </div>
  );
}

export default function Page() {
  const [hoverKey, setHoverKey] = useState("");
  const [sessionCount, setSessionCount] = useState(0);
  const [mode, setMode] = useState(PRACTICE_MODE.STANDARD);

  useEffect(() => {
    const refresh = () => {
      const sessions = loadHist().sessions || [];
      setSessionCount(sessions.length);
    };
    refresh();
    window.addEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
  }, []);

  const historyText = useMemo(() => {
    if (sessionCount > 0) return `${sessionCount} sessions recorded. Review progress and weak areas.`;
    return "Track progress over time and identify weak areas.";
  }, [sessionCount]);

  const cardBase = {
    display: "flex",
    width: "100%",
    textAlign: "left",
    background: "#fff",
    border: "1px solid " + C.bdr,
    borderRadius: 8,
    padding: 0,
    marginBottom: 12,
    cursor: "pointer",
    overflow: "hidden",
    fontFamily: FONT,
    textDecoration: "none",
    color: "inherit",
    minHeight: 106,
    transition: "box-shadow 120ms ease, transform 120ms ease, border-color 120ms ease",
  };

  const modeSuffix = mode === PRACTICE_MODE.CHALLENGE ? "?mode=challenge" : "";
  const mockTotalSeconds =
    getTaskTimeSeconds("build", mode) + getTaskTimeSeconds("email", mode) + getTaskTimeSeconds("discussion", mode);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <div style={{ background: C.nav, color: "#fff", padding: "0 20px", height: 48, display: "flex", alignItems: "center", borderBottom: "3px solid " + C.navDk }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>TOEFL iBT</span>
        <span style={{ opacity: 0.5, margin: "0 12px" }}>|</span>
        <span style={{ fontSize: 13 }}>Writing Section 2026</span>
      </div>
      <div style={{ maxWidth: 800, margin: "32px auto", padding: "0 20px" }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "32px 40px", marginBottom: 24, textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: C.nav }}>TOEFL iBT Writing Practice (2026)</h1>
          <p style={{ color: C.t2, fontSize: 14, margin: "8px 0 0" }}>ETS-style timing & AI feedback for all 3 tasks</p>
          <div style={{ display: "inline-flex", gap: 8, background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 999, marginTop: 14, padding: 4 }}>
            {[
              { value: PRACTICE_MODE.STANDARD, label: "Standard" },
              { value: PRACTICE_MODE.CHALLENGE, label: "Challenge" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setMode(normalizePracticeMode(opt.value))}
                style={{
                  border: "1px solid " + (mode === opt.value ? C.blue : "transparent"),
                  background: mode === opt.value ? "#e8f0fe" : "transparent",
                  color: mode === opt.value ? C.nav : C.t2,
                  borderRadius: 999,
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {PRACTICE_TASKS.map((c) => (
          <Link
            href={`/${c.k}${modeSuffix}`}
            key={c.k}
            onMouseEnter={() => setHoverKey(c.k)}
            onMouseLeave={() => setHoverKey("")}
            style={{
              ...cardBase,
              borderColor: hoverKey === c.k ? "#94a3b8" : C.bdr,
              boxShadow: hoverKey === c.k ? "0 4px 14px rgba(0, 51, 102, 0.12)" : "none",
              transform: hoverKey === c.k ? "translateY(-1px)" : "none",
            }}
          >
            {timeBadge(formatMinutesLabel(getTaskTimeSeconds(c.modeKey, mode)))}
            <div style={{ padding: "14px 16px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, marginBottom: 3 }}>{c.n}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.t1, marginBottom: 4, lineHeight: 1.2 }}>{c.t}</div>
              <div style={{ fontSize: 13, color: C.t2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.d}</div>
            </div>
            <div style={{ padding: "14px 12px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", borderLeft: "1px solid " + C.bdr, minWidth: 108 }}>
              <div style={{ fontSize: 12, color: C.t2, whiteSpace: "nowrap" }}>{c.it}</div>
              <div style={{ color: C.blue, fontSize: 18, lineHeight: 1, marginTop: 4 }}>&gt;</div>
            </div>
          </Link>
        ))}

        <Link
          href={`/${MOCK_TASK.k}${modeSuffix}`}
          onMouseEnter={() => setHoverKey(MOCK_TASK.k)}
          onMouseLeave={() => setHoverKey("")}
          style={{
            ...cardBase,
            marginBottom: 16,
            border: "2px solid " + (hoverKey === MOCK_TASK.k ? C.nav : "#2f528a"),
            boxShadow: hoverKey === MOCK_TASK.k ? "0 6px 18px rgba(0, 51, 102, 0.2)" : "0 2px 10px rgba(0, 51, 102, 0.12)",
            background: "linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%)",
          }}
        >
          {timeBadge(formatMinutesLabel(mockTotalSeconds), "#dbeafe", C.nav)}
          <div style={{ padding: "14px 16px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: 11, color: "#334155", fontWeight: 700, marginBottom: 3 }}>{MOCK_TASK.n}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.nav, marginBottom: 4, lineHeight: 1.2 }}>{MOCK_TASK.t}</div>
            <div style={{ fontSize: 13, color: "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Full TOEFL iBT Writing Section
            </div>
            <div style={{ fontSize: 12, color: "#475569", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {`${formatMinutesLabel(mockTotalSeconds)} | Task 1 + Task 2 + Task 3`}
            </div>
            <div style={{ fontSize: 12, color: "#475569", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {MOCK_TASK.d}
            </div>
          </div>
          <div style={{ padding: "14px 12px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", borderLeft: "1px solid #bfdbfe", minWidth: 108 }}>
            <div style={{ fontSize: 12, color: "#334155", whiteSpace: "nowrap" }}>{MOCK_TASK.it}</div>
            {mode === PRACTICE_MODE.CHALLENGE && <div style={{ fontSize: 11, color: C.red, fontWeight: 700, marginTop: 4 }}>Challenge</div>}
            <div style={{ color: C.nav, fontSize: 18, lineHeight: 1, marginTop: 4 }}>&gt;</div>
          </div>
        </Link>

        <Link
          href="/progress"
          onMouseEnter={() => setHoverKey("progress")}
          onMouseLeave={() => setHoverKey("")}
          style={{
            ...cardBase,
            marginTop: 8,
            borderColor: hoverKey === "progress" ? "#86efac" : C.bdr,
            boxShadow: hoverKey === "progress" ? "0 4px 14px rgba(22, 163, 74, 0.15)" : "none",
            transform: hoverKey === "progress" ? "translateY(-1px)" : "none",
          }}
        >
          <div style={{ width: 90, minWidth: 90, display: "flex", alignItems: "center", justifyContent: "center", background: "#dcfce7", borderRight: "1px solid " + C.bdr, padding: "8px 4px" }}>
            <div style={{ fontSize: 20, lineHeight: 1, fontWeight: 800, color: "#166534", whiteSpace: "nowrap" }}>Progress</div>
          </div>
          <div style={{ padding: "14px 16px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: C.t1, lineHeight: 1.2 }}>Practice History</div>
            <div style={{ fontSize: 13, color: C.t2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{historyText}</div>
          </div>
          <div style={{ padding: "14px 12px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", borderLeft: "1px solid " + C.bdr, minWidth: 108 }}>
            <div style={{ fontSize: 12, color: "#166534", fontWeight: 700 }}>{sessionCount} sessions</div>
            <div style={{ color: C.blue, fontSize: 18, lineHeight: 1, marginTop: 4 }}>&gt;</div>
          </div>
        </Link>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "14px 20px", fontSize: 12, color: C.t2 }}>
          <b style={{ color: C.t1 }}>Powered by DeepSeek AI</b> | ETS-style scoring | Grammar diagnostics | Weakness tracking | AI question generation
        </div>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "14px 20px", marginTop: 12, fontSize: 11, color: C.t2, lineHeight: 1.6 }}>
          <b style={{ color: C.t1 }}>Disclaimer:</b> This tool is an independent practice resource and is not affiliated with, endorsed by, or associated with ETS or the TOEFL program. TOEFL and TOEFL iBT are registered trademarks of ETS. AI scoring is based on publicly available ETS rubric criteria and is intended for self-study reference only. Scores may not reflect actual TOEFL exam results.
        </div>
      </div>
    </div>
  );
}
