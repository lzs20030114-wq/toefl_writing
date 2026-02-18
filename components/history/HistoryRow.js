"use client";
import React, { useMemo, useState } from "react";
import { C } from "../shared/ui";
import { ScoringReport } from "../writing/ScoringReport";

const MOCK_TASK_IDS = {
  BUILD: "build-sentence",
  EMAIL: "email-writing",
  DISC: "academic-writing",
};

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
  if (!s || typeof s !== "object") return "--";
  if (s.type === "bs") {
    const total = Number(s.total || 0);
    const correct = Number(s.correct || 0);
    if (total <= 0) return "--";
    return `${correct}/${total}`;
  }
  if (s.type === "mock") {
    if (Number.isFinite(s.band)) return `${s.band.toFixed(1)} /6`;
    return `${s.score || 0}%`;
  }
  return `${s.score}/5`;
}

function getScoreColor(s) {
  if (!s || typeof s !== "object") return C.t2;
  if (s.type === "bs") {
    const total = Number(s.total || 0);
    const correct = Number(s.correct || 0);
    if (total <= 0) return C.t2;
    return correct / total >= 0.8 ? C.green : C.orange;
  }
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
    if (Number.isNaN(dt.getTime())) return String(d || "");
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  } catch {
    return String(d || "");
  }
}

function truncate(text, max = 40) {
  const s = String(text || "").trim();
  if (!s) return "(empty)";
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}

function countWords(text) {
  const s = String(text || "").trim();
  if (!s) return 0;
  return s.split(/\s+/).length;
}

async function copyText(text) {
  const s = String(text || "");
  if (!s) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

function Chip({ children, color = "#3b82f6", bg = "#eff6ff" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        color,
        background: bg,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function MockExamDetails({ session }) {
  const [activeTab, setActiveTab] = useState(MOCK_TASK_IDS.BUILD);
  const [bsFilter, setBsFilter] = useState("all");
  const [bsQuery, setBsQuery] = useState("");
  const [expandedBsRows, setExpandedBsRows] = useState({});
  const [copyHint, setCopyHint] = useState("");

  const tasks = Array.isArray(session?.details?.tasks) ? session.details.tasks : [];
  const byId = useMemo(() => {
    const map = {};
    tasks.forEach((t) => {
      const taskId = t?.taskId;
      if (!taskId) return;
      map[taskId] = t;
    });
    return map;
  }, [tasks]);

  const bsTask = byId[MOCK_TASK_IDS.BUILD] || null;
  const emailTask = byId[MOCK_TASK_IDS.EMAIL] || null;
  const discTask = byId[MOCK_TASK_IDS.DISC] || null;

  const bsDetails = Array.isArray(bsTask?.meta?.details) ? bsTask.meta.details : [];
  const bsCorrect = bsDetails.filter((d) => d?.isCorrect).length;

  const topGrammarTags = useMemo(() => {
    const freq = {};
    bsDetails.forEach((d) => {
      const list = Array.isArray(d?.grammar_points) ? d.grammar_points : [];
      list.forEach((g) => {
        const tag = String(g || "").trim();
        if (!tag) return;
        freq[tag] = (freq[tag] || 0) + 1;
      });
    });
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, n]) => ({ tag, n }));
  }, [bsDetails]);

  const filteredBs = useMemo(() => {
    const q = bsQuery.trim().toLowerCase();
    return bsDetails.filter((d) => {
      const passFilter =
        bsFilter === "all" ||
        (bsFilter === "correct" && d?.isCorrect) ||
        (bsFilter === "incorrect" && !d?.isCorrect);
      if (!passFilter) return false;
      if (!q) return true;
      return [d?.prompt, d?.userAnswer, d?.correctAnswer]
        .map((x) => String(x || "").toLowerCase())
        .some((x) => x.includes(q));
    });
  }, [bsDetails, bsFilter, bsQuery]);

  function taskChip(taskId, short) {
    const t = byId[taskId];
    if (!t) return <Chip key={taskId}>{short}: --</Chip>;
    const score = Number.isFinite(t.score) ? t.score : "pending";
    return <Chip key={taskId}>{short}: {score}/{t.maxScore}</Chip>;
  }

  async function onCopy(label, text) {
    const ok = await copyText(text);
    setCopyHint(ok ? `${label} copied` : `Copy failed`);
    setTimeout(() => setCopyHint(""), 1200);
  }

  function renderBs() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>
            Correct {bsCorrect}/{bsDetails.length}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {topGrammarTags.map((x) => (
              <Chip key={x.tag} color="#1d4ed8" bg="#dbeafe">{x.tag} x{x.n}</Chip>
            ))}
            {topGrammarTags.length === 0 && <Chip color="#6b7280" bg="#f3f4f6">No tags</Chip>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {["all", "correct", "incorrect"].map((f) => (
            <button
              key={f}
              onClick={() => setBsFilter(f)}
              style={{
                border: "1px solid " + (bsFilter === f ? C.blue : "#d1d5db"),
                background: bsFilter === f ? "#eff6ff" : "#fff",
                color: bsFilter === f ? C.blue : C.t2,
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 700,
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
          <input
            value={bsQuery}
            onChange={(e) => setBsQuery(e.target.value)}
            placeholder="Search prompt/answer"
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 6,
              padding: "5px 8px",
              fontSize: 12,
              minWidth: 180,
              flex: "1 1 220px",
            }}
          />
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
          {filteredBs.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: C.t2 }}>No questions match current filter.</div>
          ) : (
            filteredBs.map((d, i) => {
              const rowKey = `${d?.prompt || ""}-${i}`;
              const open = !!expandedBsRows[rowKey];
              const statusColor = d?.isCorrect ? C.green : C.red;
              return (
                <div key={rowKey} style={{ borderBottom: i === filteredBs.length - 1 ? "none" : "1px solid #eef2f7" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "64px 120px 1fr 1fr auto",
                      gap: 8,
                      padding: "10px 12px",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ fontSize: 12, color: C.t2 }}>Q{i + 1}</div>
                    <Chip color={statusColor} bg={d?.isCorrect ? "#dcfce7" : "#fee2e2"}>
                      {d?.isCorrect ? "Correct" : "Incorrect"}
                    </Chip>
                    <div style={{ fontSize: 12, color: C.t1 }}>{truncate(d?.userAnswer, 40)}</div>
                    <div style={{ fontSize: 12, color: C.t2 }}>{truncate(d?.correctAnswer, 40)}</div>
                    <button
                      onClick={() => setExpandedBsRows((p) => ({ ...p, [rowKey]: !open }))}
                      style={{
                        border: "1px solid #cbd5e1",
                        background: "#fff",
                        borderRadius: 6,
                        fontSize: 12,
                        padding: "4px 8px",
                        cursor: "pointer",
                        color: C.blue,
                        fontWeight: 700,
                      }}
                    >
                      {open ? "Collapse" : "Expand"}
                    </button>
                  </div>

                  {open && (
                    <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                        <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
                          <div style={{ fontSize: 11, color: C.t2, marginBottom: 6 }}>Your full response</div>
                          <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.55 }}>{d?.userAnswer || "(empty)"}</div>
                          <button
                            onClick={() => onCopy("Your response", d?.userAnswer)}
                            style={{ marginTop: 8, border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, fontSize: 11, padding: "4px 8px", cursor: "pointer" }}
                          >
                            Copy your
                          </button>
                        </div>
                        <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
                          <div style={{ fontSize: 11, color: C.t2, marginBottom: 6 }}>Correct full response</div>
                          <div style={{ fontSize: 13, color: C.t1, lineHeight: 1.55 }}>{d?.correctAnswer || "(empty)"}</div>
                          <button
                            onClick={() => onCopy("Correct response", d?.correctAnswer)}
                            style={{ marginTop: 8, border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, fontSize: 11, padding: "4px 8px", cursor: "pointer" }}
                          >
                            Copy correct
                          </button>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {(Array.isArray(d?.grammar_points) ? d.grammar_points : []).map((g, gi) => (
                          <Chip key={`${rowKey}-g-${gi}`} color="#1d4ed8" bg="#dbeafe">{g}</Chip>
                        ))}
                        {(!Array.isArray(d?.grammar_points) || d.grammar_points.length === 0) && (
                          <Chip color="#6b7280" bg="#f3f4f6">No grammar tags</Chip>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {copyHint ? <div style={{ fontSize: 11, color: C.green }}>{copyHint}</div> : null}
      </div>
    );
  }

  function renderWritingTask(task, taskTypeLabel) {
    if (!task) return <div style={{ fontSize: 12, color: C.t2 }}>No data.</div>;
    const response = task?.meta?.response || null;
    const feedback = task?.meta?.feedback || null;
    const words = Number.isFinite(task?.meta?.wordCount)
      ? task.meta.wordCount
      : countWords(response?.userText || "");
    const reportType = task?.taskId === MOCK_TASK_IDS.EMAIL ? "email" : "discussion";

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Chip>{taskTypeLabel} score: {Number.isFinite(task.score) ? `${task.score}/${task.maxScore}` : "pending"}</Chip>
          <Chip color="#0f766e" bg="#ccfbf1">Words: {words || 0}</Chip>
          {Number.isFinite(task?.meta?.secondsUsed) && <Chip color="#7c3aed" bg="#ede9fe">Time: {task.meta.secondsUsed}s</Chip>}
        </div>

        {response?.userText && (
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 11, color: C.t2, marginBottom: 6 }}>Your response</div>
            <div style={{ fontSize: 13, color: C.t1, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{response.userText}</div>
          </div>
        )}

        {feedback && typeof feedback === "object" ? (
          <ScoringReport result={feedback} type={reportType} uiLang={feedback?.reportLanguage || "zh"} />
        ) : (
          <div style={{ fontSize: 12, color: task?.meta?.error ? C.red : C.t2 }}>
            {task?.meta?.error ? `Scoring error: ${task.meta.error}` : "No AI feedback yet."}
          </div>
        )}
      </div>
    );
  }

  const mockTabs = [
    { id: MOCK_TASK_IDS.BUILD, label: "Build Sentence" },
    { id: MOCK_TASK_IDS.EMAIL, label: "Email" },
    { id: MOCK_TASK_IDS.DISC, label: "Discussion" },
  ];

  return (
    <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <Chip>Band: {Number.isFinite(session?.band) ? session.band.toFixed(1) : "--"}</Chip>
        <Chip>Scaled: {session?.scaledScore ?? "--"}/30</Chip>
        <Chip>CEFR: {session?.cefr || "--"}</Chip>
        {taskChip(MOCK_TASK_IDS.BUILD, "BS")}
        {taskChip(MOCK_TASK_IDS.EMAIL, "Email")}
        {taskChip(MOCK_TASK_IDS.DISC, "Disc")}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {mockTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              border: "1px solid " + (activeTab === t.id ? C.blue : "#d1d5db"),
              background: activeTab === t.id ? "#eff6ff" : "#fff",
              color: activeTab === t.id ? C.blue : C.t2,
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              padding: "5px 10px",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === MOCK_TASK_IDS.BUILD && renderBs()}
      {activeTab === MOCK_TASK_IDS.EMAIL && renderWritingTask(emailTask, "Email")}
      {activeTab === MOCK_TASK_IDS.DISC && renderWritingTask(discTask, "Discussion")}
    </div>
  );
}

export function HistoryRow({ entry, isExpanded, isLast, onToggle, onDelete, showIcon }) {
  const s = entry?.session || {};
  const sourceIndex = entry?.sourceIndex;

  const mockTasks = Array.isArray(s?.details?.tasks) ? s.details.tasks : [];
  const mockBuild = mockTasks.find((t) => t?.taskId === MOCK_TASK_IDS.BUILD);
  const mockEmail = mockTasks.find((t) => t?.taskId === MOCK_TASK_IDS.EMAIL);
  const mockDisc = mockTasks.find((t) => t?.taskId === MOCK_TASK_IDS.DISC);

  const mockChip = (label, task) => (
    <Chip key={label} color="#1d4ed8" bg="#dbeafe">
      {label} {Number.isFinite(task?.score) ? `${task.score}/${task.maxScore}` : `pending/${task?.maxScore || "--"}`}
    </Chip>
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 0",
          borderBottom: isLast ? "none" : "1px solid #eee",
          cursor: "pointer",
          gap: 10,
          flexWrap: "wrap",
        }}
        onClick={() => onToggle?.()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 11, color: C.t2, userSelect: "none", flexShrink: 0 }}>{isExpanded ? "\u25BC" : "\u25B6"}</span>
          <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
            {showIcon ? typeIcon(s.type) : ""}{getTypeLabel(s.type)}
          </span>
          {s.type === "mock" && Number.isFinite(s?.band) && (
            <Chip color="#1d4ed8" bg="#dbeafe">Band {s.band.toFixed(1)}</Chip>
          )}
          <span style={{ fontSize: 11, color: C.t2, whiteSpace: "nowrap" }}>{fmtDate(s.date)}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {s.type === "mock" && (
            <>
              <Chip color="#0f766e" bg="#ccfbf1">Scaled {s.scaledScore ?? "--"}/30</Chip>
              <Chip color="#4b5563" bg="#f3f4f6">CEFR {s.cefr || "--"}</Chip>
              {mockChip("BS", mockBuild)}
              {mockChip("Email", mockEmail)}
              {mockChip("Disc", mockDisc)}
            </>
          )}
          <span style={{ fontSize: 14, fontWeight: 700, color: getScoreColor(s), whiteSpace: "nowrap" }}>{getScoreLabel(s)}</span>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.();
            }}
            style={{
              border: "1px solid #cbd5e1",
              background: "#fff",
              borderRadius: 6,
              fontSize: 12,
              padding: "4px 8px",
              cursor: "pointer",
              color: C.blue,
              fontWeight: 700,
            }}
          >
            {isExpanded ? "Hide details" : "View details"}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(sourceIndex);
            }}
            title="Delete this entry"
            style={{
              background: "none",
              border: "none",
              color: C.red,
              cursor: "pointer",
              fontSize: 16,
              padding: "2px 6px",
              lineHeight: 1,
              fontWeight: 700,
              opacity: 0.7,
            }}
          >
            x
          </button>
        </div>
      </div>

      {isExpanded && s.type === "bs" && s.details && Array.isArray(s.details) && (
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

      {isExpanded && s.type === "mock" && s.details && <MockExamDetails session={s} />}

      {isExpanded && s.details && (s.type === "email" || s.type === "discussion") && s.details.userText && (
        <div style={{ background: "#f9f9f9", border: "1px solid #eee", borderRadius: 4, padding: 16, margin: "4px 0 8px 0" }}>
          {s.details.promptSummary && <div style={{ fontSize: 12, color: C.t2, marginBottom: 8 }}>Prompt: {s.details.promptSummary}</div>}
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 12, marginBottom: 12, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.t2, marginBottom: 6 }}>Your response</div>
            {s.details.userText}
          </div>
          {s.details.feedback && <ScoringReport result={s.details.feedback} type={s.type} uiLang={s.details.feedback?.reportLanguage || "zh"} />}
        </div>
      )}

      {isExpanded && !s.details && (
        <div style={{ background: "#f9f9f9", border: "1px solid #eee", borderRadius: 4, padding: 16, margin: "4px 0 8px 0", fontSize: 13, color: C.t2, textAlign: "center" }}>
          No detail data for this record (older entry).
        </div>
      )}
    </div>
  );
}
