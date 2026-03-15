"use client";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { C, FONT } from "../../components/shared/ui";
import AdminLayout from "../../components/admin/AdminLayout";

const TOKEN_KEY = "toefl-admin-token";

const TABS = [
  { key: "academic", label: "学术写作 Academic", icon: "🎓" },
  { key: "email", label: "邮件写作 Email", icon: "✉️" },
  { key: "build", label: "连词成句 Build", icon: "🔤" },
];

// ── tiny helpers ──────────────────────────────────────────────────────────────
function Badge({ children, color = C.blue, bg }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 8px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 700,
        background: bg ?? (color + "18"),
        color,
        letterSpacing: 0.3,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function StatCard({ label, count, sub, color = C.blue }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid " + C.bdr,
        borderRadius: 10,
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        boxShadow: C.shadow,
      }}
    >
      <div style={{ fontSize: 13, color: C.t2, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1.1 }}>{count}</div>
      {sub && <div style={{ fontSize: 12, color: C.t3 }}>{sub}</div>}
    </div>
  );
}

function Chevron({ open }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms" }}
    >
      <path d="M4 6l4 4 4-4" stroke={C.t3} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Academic card ─────────────────────────────────────────────────────────────
function AcademicCard({ item, idx }) {
  const [open, setOpen] = useState(false);
  const previewLen = 100;
  const preview = item.professor.text.length > previewLen
    ? item.professor.text.slice(0, previewLen) + "…"
    : item.professor.text;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid " + (open ? C.blue + "60" : C.bdr),
        borderRadius: 10,
        overflow: "hidden",
        transition: "border-color 150ms",
        boxShadow: open ? "0 2px 8px rgba(13,150,104,0.07)" : C.shadow,
      }}
    >
      {/* header row */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "14px 16px",
          cursor: "pointer",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          textAlign: "left",
          fontFamily: FONT,
        }}
      >
        <Badge color={C.blue}>{item.id}</Badge>
        {item.source === "official" && <Badge color="#d97706" bg="#fef3c7">真题</Badge>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: C.t3, marginBottom: 2 }}>
            Prof. {item.professor.name}
          </div>
          <div style={{ fontSize: 14, color: open ? C.t1 : C.t2, lineHeight: 1.55 }}>
            {open ? item.professor.text : preview}
          </div>
        </div>
        <div style={{ flexShrink: 0, marginTop: 2 }}>
          <Chevron open={open} />
        </div>
      </button>

      {/* expanded body */}
      {open && (
        <div
          style={{
            borderTop: "1px solid " + C.bdrSubtle,
            padding: "14px 16px",
            display: "grid",
            gap: 10,
          }}
        >
          {item.students.map((s, i) => (
            <div
              key={i}
              style={{
                background: i % 2 === 0 ? "#f8fdf9" : C.softBlue,
                border: "1px solid " + C.bdrSubtle,
                borderRadius: 8,
                padding: "10px 14px",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: C.t3,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  marginBottom: 4,
                }}
              >
                Student — {s.name}
              </div>
              <div style={{ fontSize: 14, color: C.t1, lineHeight: 1.6 }}>{s.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Email card ────────────────────────────────────────────────────────────────
function EmailCard({ item }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid " + (open ? C.blue + "60" : C.bdr),
        borderRadius: 10,
        overflow: "hidden",
        transition: "border-color 150ms",
        boxShadow: open ? "0 2px 8px rgba(13,150,104,0.07)" : C.shadow,
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "14px 16px",
          cursor: "pointer",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          textAlign: "left",
          fontFamily: FONT,
        }}
      >
        <Badge color="#7c3aed">{item.id}</Badge>
        {item.source === "official" && <Badge color="#d97706" bg="#fef3c7">真题</Badge>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: C.t3 }}>
              To: <strong style={{ color: C.t2 }}>{item.to}</strong>
            </span>
            {item.subject && <span style={{ fontSize: 12, color: C.t3 }}>
              Subject: <strong style={{ color: C.t2 }}>{item.subject}</strong>
            </span>}
          </div>
          <div style={{ fontSize: 14, color: C.t2, lineHeight: 1.55 }}>
            {open
              ? item.scenario
              : item.scenario.length > 100
              ? item.scenario.slice(0, 100) + "…"
              : item.scenario}
          </div>
        </div>
        <div style={{ flexShrink: 0, marginTop: 2 }}>
          <Chevron open={open} />
        </div>
      </button>

      {open && (
        <div
          style={{
            borderTop: "1px solid " + C.bdrSubtle,
            padding: "14px 16px",
            display: "grid",
            gap: 12,
          }}
        >
          <div
            style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
              borderRadius: 8,
              padding: "10px 14px",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#b45309", letterSpacing: 0.5, marginBottom: 4 }}>
              DIRECTION
            </div>
            <div style={{ fontSize: 14, color: C.t1 }}>{item.direction}</div>
          </div>

          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: C.t3,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 6,
              }}
            >
              Writing Goals
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {item.goals.map((g, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span
                    style={{
                      flexShrink: 0,
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: C.blue + "18",
                      color: C.blue,
                      fontSize: 11,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ fontSize: 14, color: C.t1, lineHeight: 1.55 }}>{g}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Build Sentence set + card ─────────────────────────────────────────────────
function BuildQuestionRow({ q, idx }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        borderBottom: "1px solid " + C.bdrSubtle,
        background: open ? "#f8fdf9" : "transparent",
        transition: "background 150ms",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "10px 14px",
          cursor: "pointer",
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          textAlign: "left",
          fontFamily: FONT,
        }}
      >
        <span
          style={{
            flexShrink: 0,
            width: 22,
            height: 22,
            borderRadius: 6,
            background: C.blue + "18",
            color: C.blue,
            fontSize: 11,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {idx + 1}
        </span>
        {q.source === "official" && <Badge color="#d97706" bg="#fef3c7">真题</Badge>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: C.t3, marginBottom: 2 }}>PROMPT</div>
          <div style={{ fontSize: 14, color: C.t2, lineHeight: 1.5 }}>{q.prompt}</div>
          {!open && (
            <div style={{ fontSize: 13, color: C.t1, marginTop: 4, fontStyle: "italic" }}>
              → {q.answer}
            </div>
          )}
        </div>
        <Chevron open={open} />
      </button>

      {open && (
        <div style={{ padding: "0 14px 14px 46px", display: "grid", gap: 10 }}>
          {/* answer */}
          <div
            style={{
              background: "#ecfdf5",
              border: "1px solid #6ee7b7",
              borderRadius: 8,
              padding: "8px 12px",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, letterSpacing: 0.5, marginBottom: 3 }}>
              ANSWER
            </div>
            <div style={{ fontSize: 14, color: C.t1, fontWeight: 600 }}>{q.answer}</div>
          </div>

          {/* chunks row */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.t3, letterSpacing: 0.5, marginBottom: 6 }}>
              CHUNKS{q.distractor ? "  +  DISTRACTOR" : ""}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {q.chunks.map((ch, i) => (
                <span
                  key={i}
                  style={{
                    padding: "3px 10px",
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    borderRadius: 6,
                    fontSize: 13,
                    color: "#1e40af",
                    fontWeight: 600,
                  }}
                >
                  {ch}
                </span>
              ))}
              {q.prefilled?.map((pf, i) => (
                <span
                  key={"pf" + i}
                  style={{
                    padding: "3px 10px",
                    background: "#fef9c3",
                    border: "1px solid #fde047",
                    borderRadius: 6,
                    fontSize: 13,
                    color: "#854d0e",
                    fontWeight: 600,
                  }}
                  title="prefilled"
                >
                  {pf} ✓
                </span>
              ))}
              {q.distractor && (
                <span
                  style={{
                    padding: "3px 10px",
                    background: "#fef2f2",
                    border: "1px solid #fca5a5",
                    borderRadius: 6,
                    fontSize: 13,
                    color: "#b91c1c",
                    fontWeight: 600,
                    textDecoration: "line-through",
                  }}
                  title="distractor"
                >
                  {q.distractor}
                </span>
              )}
            </div>
          </div>

          {/* grammar tags */}
          {q.grammar_points?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {q.grammar_points.map((gp, i) => (
                <Badge key={i} color="#7c3aed">{gp}</Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BuildSetCard({ set, token, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState("");

  async function handleDelete(e) {
    e.stopPropagation();
    if (!confirm(`确认删除套题 #${set.set_id}（共 ${set.questions.length} 道题）？此操作将直接修改正式题库，不可撤销。`)) return;
    setDeleting(true);
    setDeleteMsg("");
    try {
      const res = await fetch(`/api/admin/questions/sets/${set.set_id}`, {
        method: "DELETE",
        headers: { "x-admin-token": token },
      });
      const data = await res.json();
      if (res.ok) {
        onDeleted(set.set_id);
      } else {
        setDeleteMsg(`删除失败：${data.error}`);
        setDeleting(false);
      }
    } catch (e) {
      setDeleteMsg(`请求失败：${e.message}`);
      setDeleting(false);
    }
  }

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid " + (open ? C.blue + "60" : C.bdr),
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: open ? "0 2px 8px rgba(13,150,104,0.07)" : C.shadow,
      }}
    >
      <div
        style={{
          background: open ? "#f0fdf7" : "#fff",
          padding: "13px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          transition: "background 150ms",
        }}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, background: "none", border: "none", cursor: "pointer", fontFamily: FONT, textAlign: "left", padding: 0 }}
        >
          <Badge color={C.blue} bg={C.blue + "18"}>Set {set.set_id}</Badge>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.t1 }}>
              {set.questions.length} questions
            </span>
            <span style={{ fontSize: 13, color: C.t3, marginLeft: 10 }}>
              {set.questions.map((q) => q.id).slice(0, 3).join("  ·  ")}
              {set.questions.length > 3 ? "  …" : ""}
            </span>
          </div>
          <Chevron open={open} />
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          title={`删除套题 #${set.set_id}`}
          style={{
            flexShrink: 0,
            background: "none",
            border: "1px solid #fca5a5",
            color: "#dc2626",
            borderRadius: 6,
            padding: "3px 10px",
            cursor: deleting ? "not-allowed" : "pointer",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: FONT,
            opacity: deleting ? 0.5 : 1,
          }}
        >
          {deleting ? "删除中…" : "删除"}
        </button>
      </div>

      {deleteMsg && (
        <div style={{ padding: "6px 16px", fontSize: 12, color: "#dc2626", background: "#fef2f2" }}>
          {deleteMsg}
        </div>
      )}

      {open && (
        <div style={{ borderTop: "1px solid " + C.bdrSubtle }}>
          {set.questions.map((q, i) => (
            <BuildQuestionRow key={q.id} q={q} idx={i} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Search bar ────────────────────────────────────────────────────────────────
function SearchBar({ value, onChange }) {
  return (
    <input
      type="text"
      placeholder="搜索题目内容…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "9px 14px",
        border: "1px solid " + C.bdr,
        borderRadius: 8,
        fontSize: 14,
        fontFamily: FONT,
        color: C.t1,
        background: "#fff",
        outline: "none",
        boxSizing: "border-box",
      }}
    />
  );
}

// ── Source Toggle ─────────────────────────────────────────────────────────────
function SourceToggle({ value, onChange }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", borderRadius: 8, border: "1px solid " + C.bdr, overflow: "hidden" }}>
        <button
          type="button"
          onClick={() => onChange("regular")}
          style={{
            flex: 1,
            padding: "8px 12px",
            border: "none",
            borderRight: "1px solid " + C.bdr,
            background: value === "regular" ? "#ecfdf5" : "#fff",
            color: value === "regular" ? C.green : C.t3,
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: FONT,
            transition: "all 150ms",
          }}
        >
          普通题库
        </button>
        <button
          type="button"
          onClick={() => onChange("official")}
          style={{
            flex: 1,
            padding: "8px 12px",
            border: "none",
            background: value === "official" ? "#fef3c7" : "#fff",
            color: value === "official" ? "#d97706" : C.t3,
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: FONT,
            transition: "all 150ms",
          }}
        >
          真题库
        </button>
      </div>
      {value === "official" && (
        <div style={{ fontSize: 12, color: "#d97706", background: "#fef3c7", borderRadius: 6, padding: "5px 10px" }}>
          将存入真题库，暂不参与练习轮换
        </div>
      )}
    </div>
  );
}

// ── Form field helpers ────────────────────────────────────────────────────────
function FieldLabel({ children, optional }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: C.t2, marginBottom: 4, letterSpacing: 0.3 }}>
      {children}
      {optional && <span style={{ fontWeight: 400, color: C.t3, marginLeft: 4 }}>(可选)</span>}
    </div>
  );
}

function FieldInput({ value, onChange, placeholder, type = "text" }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%",
        padding: "8px 12px",
        border: "1px solid " + C.bdr,
        borderRadius: 8,
        fontSize: 14,
        fontFamily: FONT,
        color: C.t1,
        background: "#fff",
        outline: "none",
        boxSizing: "border-box",
      }}
    />
  );
}

function FieldTextarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{
        width: "100%",
        padding: "8px 12px",
        border: "1px solid " + C.bdr,
        borderRadius: 8,
        fontSize: 14,
        fontFamily: FONT,
        color: C.t1,
        background: "#fff",
        outline: "none",
        resize: "vertical",
        boxSizing: "border-box",
      }}
    />
  );
}

// ── Add Question Modal ────────────────────────────────────────────────────────
function AddQuestionModal({ type: initialType, token, onClose, onSuccess }) {
  const [formType, setFormType] = useState(initialType);
  const [source, setSource] = useState("regular");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  // Academic form state
  const [acProfName, setAcProfName] = useState("");
  const [acProfText, setAcProfText] = useState("");
  const [acS1Name, setAcS1Name] = useState("");
  const [acS1Text, setAcS1Text] = useState("");
  const [acS2Name, setAcS2Name] = useState("");
  const [acS2Text, setAcS2Text] = useState("");

  // Email form state
  const [emTo, setEmTo] = useState("");
  const [emFrom, setEmFrom] = useState("");
  const [emScenario, setEmScenario] = useState("");
  const [emDirection, setEmDirection] = useState("");
  const [emGoals, setEmGoals] = useState([""]);

  // Build form state
  const [bPrompt, setBPrompt] = useState("");
  const [bAnswer, setBAnswer] = useState("");
  const [bChunks, setBChunks] = useState("");
  const [bPrefilled, setBPrefilled] = useState("");
  const [bDistractor, setBDistractor] = useState("");
  const [bGrammar, setBGrammar] = useState("");

  function addGoal() { setEmGoals((g) => [...g, ""]); }
  function removeGoal(i) { setEmGoals((g) => g.filter((_, idx) => idx !== i)); }
  function updateGoal(i, v) { setEmGoals((g) => g.map((x, idx) => idx === i ? v : x)); }

  function parseCsv(str) {
    return str.split(",").map((s) => s.trim()).filter(Boolean);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");

    let data;
    if (formType === "academic") {
      if (!acProfName.trim() || !acProfText.trim() || !acS1Name.trim() || !acS1Text.trim() || !acS2Name.trim() || !acS2Text.trim()) {
        setErr("请填写所有必填字段");
        return;
      }
      data = {
        professor: { name: acProfName.trim(), text: acProfText.trim() },
        students: [
          { name: acS1Name.trim(), text: acS1Text.trim() },
          { name: acS2Name.trim(), text: acS2Text.trim() },
        ],
      };
    } else if (formType === "email") {
      const goals = emGoals.map((g) => g.trim()).filter(Boolean);
      if (!emTo.trim() || !emFrom.trim() || !emScenario.trim() || !emDirection.trim() || goals.length === 0) {
        setErr("请填写所有必填字段（至少一条 Goal）");
        return;
      }
      data = {
        to: emTo.trim(),
        from: emFrom.trim(),
        scenario: emScenario.trim(),
        direction: emDirection.trim(),
        goals,
      };
    } else {
      const chunks = parseCsv(bChunks);
      if (!bPrompt.trim() || !bAnswer.trim() || chunks.length === 0) {
        setErr("请填写 Prompt、Answer 和 Chunks");
        return;
      }
      data = { prompt: bPrompt.trim(), answer: bAnswer.trim(), chunks };
      const prefilled = parseCsv(bPrefilled);
      if (prefilled.length > 0) data.prefilled = prefilled;
      if (bDistractor.trim()) data.distractor = bDistractor.trim();
      const gp = parseCsv(bGrammar);
      if (gp.length > 0) data.grammar_points = gp;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ type: formType, data, source }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      onSuccess(body.question_id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Tab bar colors
  const typeColor = { academic: C.blue, email: "#7c3aed", build: C.orange };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,30,20,0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px 16px",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          width: "100%",
          maxWidth: 600,
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        {/* modal header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid " + C.bdrSubtle,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, fontSize: 16, fontWeight: 800, color: C.nav }}>添加新题目</div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: C.t3,
              lineHeight: 1,
              padding: "2px 6px",
              fontFamily: FONT,
            }}
          >
            ×
          </button>
        </div>

        {/* type tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid " + C.bdrSubtle, flexShrink: 0 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setFormType(t.key); setErr(""); }}
              style={{
                flex: 1,
                padding: "10px 8px",
                border: "none",
                borderBottom: formType === t.key ? `2px solid ${typeColor[t.key]}` : "2px solid transparent",
                background: formType === t.key ? typeColor[t.key] + "08" : "none",
                color: formType === t.key ? typeColor[t.key] : C.t3,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: FONT,
                transition: "all 150ms",
              }}
            >
              {t.icon} {t.label.split(" ")[0]}
            </button>
          ))}
        </div>

        {/* form body */}
        <form
          onSubmit={handleSubmit}
          style={{ overflowY: "auto", padding: "18px 20px", display: "grid", gap: 14, flex: 1 }}
        >
          <SourceToggle value={source} onChange={setSource} />

          {/* ── Academic form ── */}
          {formType === "academic" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                <div>
                  <FieldLabel>Professor Name</FieldLabel>
                  <FieldInput value={acProfName} onChange={setAcProfName} placeholder="e.g. Smith" />
                </div>
                <div>
                  <FieldLabel>Professor Text</FieldLabel>
                  <FieldTextarea value={acProfText} onChange={setAcProfText} placeholder="Professor's discussion prompt…" rows={3} />
                </div>
              </div>
              <div style={{ height: 1, background: C.bdrSubtle }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                <div>
                  <FieldLabel>Student 1 Name</FieldLabel>
                  <FieldInput value={acS1Name} onChange={setAcS1Name} placeholder="e.g. Alice" />
                </div>
                <div>
                  <FieldLabel>Student 1 Text</FieldLabel>
                  <FieldTextarea value={acS1Text} onChange={setAcS1Text} placeholder="Student's response…" rows={3} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                <div>
                  <FieldLabel>Student 2 Name</FieldLabel>
                  <FieldInput value={acS2Name} onChange={setAcS2Name} placeholder="e.g. Bob" />
                </div>
                <div>
                  <FieldLabel>Student 2 Text</FieldLabel>
                  <FieldTextarea value={acS2Text} onChange={setAcS2Text} placeholder="Student's response…" rows={3} />
                </div>
              </div>
            </>
          )}

          {/* ── Email form ── */}
          {formType === "email" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <FieldLabel>To</FieldLabel>
                  <FieldInput value={emTo} onChange={setEmTo} placeholder="e.g. Professor Lee" />
                </div>
                <div>
                  <FieldLabel>From</FieldLabel>
                  <FieldInput value={emFrom} onChange={setEmFrom} placeholder="e.g. A student" />
                </div>
              </div>
              <div>
                <FieldLabel>Scenario</FieldLabel>
                <FieldTextarea value={emScenario} onChange={setEmScenario} placeholder="Describe the situation…" rows={3} />
              </div>
              <div>
                <FieldLabel>Direction</FieldLabel>
                <FieldInput value={emDirection} onChange={setEmDirection} placeholder="Writing task direction…" />
              </div>
              <div>
                <FieldLabel>Goals</FieldLabel>
                <div style={{ display: "grid", gap: 6 }}>
                  {emGoals.map((g, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: C.t3, minWidth: 16 }}>{i + 1}.</span>
                      <div style={{ flex: 1 }}>
                        <FieldInput
                          value={g}
                          onChange={(v) => updateGoal(i, v)}
                          placeholder={`Goal ${i + 1}…`}
                        />
                      </div>
                      {emGoals.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeGoal(i)}
                          style={{
                            background: "none",
                            border: "1px solid " + C.bdr,
                            borderRadius: 6,
                            padding: "4px 8px",
                            cursor: "pointer",
                            fontSize: 12,
                            color: C.t3,
                            fontFamily: FONT,
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addGoal}
                    style={{
                      background: "none",
                      border: "1px dashed " + C.bdr,
                      borderRadius: 8,
                      padding: "7px 12px",
                      cursor: "pointer",
                      fontSize: 13,
                      color: C.t2,
                      fontFamily: FONT,
                      textAlign: "left",
                    }}
                  >
                    + 添加 Goal
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── Build form ── */}
          {formType === "build" && (
            <>
              <div>
                <FieldLabel>Prompt</FieldLabel>
                <FieldInput value={bPrompt} onChange={setBPrompt} placeholder="The sentence to build…" />
              </div>
              <div>
                <FieldLabel>Answer</FieldLabel>
                <FieldInput value={bAnswer} onChange={setBAnswer} placeholder="Correct assembled sentence…" />
              </div>
              <div>
                <FieldLabel>Chunks</FieldLabel>
                <FieldInput value={bChunks} onChange={setBChunks} placeholder="word1, word2, phrase three, …（逗号分隔）" />
                <div style={{ fontSize: 11, color: C.t3, marginTop: 3 }}>用英文逗号分隔每个词块</div>
              </div>
              <div>
                <FieldLabel optional>Prefilled</FieldLabel>
                <FieldInput value={bPrefilled} onChange={setBPrefilled} placeholder="pre1, pre2, …（逗号分隔，可选）" />
                <div style={{ fontSize: 11, color: C.t3, marginTop: 3 }}>预填入的词块，需包含在 Chunks 中</div>
              </div>
              <div>
                <FieldLabel optional>Distractor</FieldLabel>
                <FieldInput value={bDistractor} onChange={setBDistractor} placeholder="干扰词（可选）" />
              </div>
              <div>
                <FieldLabel optional>Grammar Points</FieldLabel>
                <FieldInput value={bGrammar} onChange={setBGrammar} placeholder="subject-verb agreement, tense, …（逗号分隔，可选）" />
              </div>
            </>
          )}

          {/* error */}
          {err && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fca5a5",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 13,
                color: C.red,
              }}
            >
              {err}
            </div>
          )}

          {/* submit row */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "9px 18px",
                background: "#fff",
                border: "1px solid " + C.bdr,
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                color: C.t2,
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: "9px 20px",
                background: submitting ? "#9ca3af" : C.blue,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 700,
                cursor: submitting ? "not-allowed" : "pointer",
                fontFamily: FONT,
              }}
            >
              {submitting ? "提交中…" : "添加题目"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Success Toast ─────────────────────────────────────────────────────────────
function SuccessToast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div
      style={{
        position: "fixed",
        top: 60,
        left: "50%",
        transform: "translateX(-50%)",
        background: C.green,
        color: "#fff",
        padding: "10px 24px",
        borderRadius: 10,
        fontSize: 14,
        fontWeight: 700,
        zIndex: 9999,
        boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
        whiteSpace: "nowrap",
      }}
    >
      {message}
    </div>
  );
}

// ── Bulk Import Modal ─────────────────────────────────────────────────────────
const BULK_STEPS = { input: "input", parsing: "parsing", preview: "preview", saving: "saving" };

function BulkImportModal({ defaultType, token, onClose, onSuccess }) {
  const [formType, setFormType] = useState(defaultType);
  const [source, setSource] = useState("regular");
  const [text, setText] = useState("");
  const [step, setStep] = useState(BULK_STEPS.input);
  const [parsed, setParsed] = useState([]); // array of question objects
  const [removed, setRemoved] = useState(new Set()); // indices removed in preview
  const [parseErr, setParseErr] = useState("");
  const [saveErr, setSaveErr] = useState("");

  const typeColor = { academic: C.blue, email: "#7c3aed", build: C.orange };

  async function handleParse() {
    if (!text.trim()) return;
    setStep(BULK_STEPS.parsing);
    setParseErr("");
    try {
      const res = await fetch("/api/admin/parse-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ type: formType, text: text.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      if (!body.questions?.length) throw new Error("AI 未能识别任何题目，请检查格式后重试");
      setParsed(body.questions);
      setRemoved(new Set());
      setStep(BULK_STEPS.preview);
    } catch (e) {
      setParseErr(e.message);
      setStep(BULK_STEPS.input);
    }
  }

  async function handleSave() {
    const toSave = parsed.filter((_, i) => !removed.has(i));
    if (toSave.length === 0) return;
    setStep(BULK_STEPS.saving);
    setSaveErr("");
    const results = [];
    for (const q of toSave) {
      try {
        const res = await fetch("/api/admin/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-token": token },
          body: JSON.stringify({ type: formType, data: q, source }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        results.push(body.question_id);
      } catch (e) {
        setSaveErr(`写入失败：${e.message}`);
        setStep(BULK_STEPS.preview);
        return;
      }
    }
    onSuccess(results.length);
  }

  function toggleRemove(i) {
    setRemoved((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  const activeCount = parsed.length - removed.size;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && step !== BULK_STEPS.saving) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,30,20,0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px 16px",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          width: "100%",
          maxWidth: 660,
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        {/* header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid " + C.bdrSubtle,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.nav }}>AI 批量导入</div>
            <div style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>
              {step === BULK_STEPS.input && "粘贴原始题目文本，AI 自动识别结构"}
              {step === BULK_STEPS.parsing && "AI 识别中…"}
              {step === BULK_STEPS.preview && `识别到 ${parsed.length} 道题，已选 ${activeCount} 道`}
              {step === BULK_STEPS.saving && `写入中…`}
            </div>
          </div>
          {step !== BULK_STEPS.saving && (
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.t3, padding: "2px 6px", fontFamily: FONT }}
            >
              ×
            </button>
          )}
        </div>

        {/* type tabs — only in input step */}
        {step === BULK_STEPS.input && (
          <div style={{ display: "flex", borderBottom: "1px solid " + C.bdrSubtle, flexShrink: 0 }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setFormType(t.key)}
                style={{
                  flex: 1,
                  padding: "10px 8px",
                  border: "none",
                  borderBottom: formType === t.key ? `2px solid ${typeColor[t.key]}` : "2px solid transparent",
                  background: formType === t.key ? typeColor[t.key] + "08" : "none",
                  color: formType === t.key ? typeColor[t.key] : C.t3,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: FONT,
                  transition: "all 150ms",
                }}
              >
                {t.icon} {t.label.split(" ")[0]}
              </button>
            ))}
          </div>
        )}

        {/* body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px", display: "grid", gap: 14 }}>

          {/* ── INPUT step ── */}
          {step === BULK_STEPS.input && (
            <>
              <div style={{ fontSize: 13, color: C.t2 }}>
                将多道<strong style={{ color: typeColor[formType] }}>
                  {formType === "academic" ? "学术写作" : formType === "email" ? "邮件写作" : "连词成句"}
                </strong>题目的文本直接粘贴进来，AI 会逐道识别并结构化。
              </div>
              <SourceToggle value={source} onChange={setSource} />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"在此粘贴题目原文…"}
                rows={12}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  border: "1px solid " + C.bdr,
                  borderRadius: 8,
                  fontSize: 14,
                  fontFamily: FONT,
                  color: C.t1,
                  background: "#fafafa",
                  outline: "none",
                  resize: "vertical",
                  boxSizing: "border-box",
                  lineHeight: 1.6,
                }}
              />
              {parseErr && (
                <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: C.red }}>
                  {parseErr}
                </div>
              )}
            </>
          )}

          {/* ── PARSING step ── */}
          {step === BULK_STEPS.parsing && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "40px 0" }}>
              <div
                style={{
                  width: 40, height: 40, borderRadius: "50%",
                  border: `3px solid ${typeColor[formType]}30`,
                  borderTop: `3px solid ${typeColor[formType]}`,
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <div style={{ fontSize: 14, color: C.t2 }}>DeepSeek 识别中，请稍候…</div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* ── PREVIEW step ── */}
          {(step === BULK_STEPS.preview || step === BULK_STEPS.saving) && (
            <>
              <div style={{ fontSize: 13, color: C.t2 }}>
                点击题目卡片可<strong>取消选中</strong>（灰色 = 不写入）。确认后将批量写入数据库。
              </div>
              {saveErr && (
                <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: C.red }}>
                  {saveErr}
                </div>
              )}
              {parsed.map((q, i) => {
                const isRemoved = removed.has(i);
                return (
                  <div
                    key={i}
                    onClick={() => step !== BULK_STEPS.saving && toggleRemove(i)}
                    style={{
                      border: "1px solid " + (isRemoved ? C.bdr : typeColor[formType] + "60"),
                      borderRadius: 10,
                      padding: "12px 14px",
                      cursor: step === BULK_STEPS.saving ? "default" : "pointer",
                      opacity: isRemoved ? 0.4 : 1,
                      background: isRemoved ? "#f9fafb" : "#fff",
                      transition: "all 150ms",
                      display: "grid",
                      gap: 6,
                      userSelect: "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                          background: isRemoved ? C.bdr : typeColor[formType],
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, color: "#fff", fontWeight: 800,
                        }}
                      >
                        {isRemoved ? "✕" : i + 1}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: isRemoved ? C.t3 : typeColor[formType], letterSpacing: 0.3 }}>
                        题目 {i + 1}
                      </span>
                    </div>

                    {formType === "academic" && (
                      <>
                        <div style={{ fontSize: 13, color: C.t2 }}>
                          <strong>Prof. {q.professor?.name}</strong>：{q.professor?.text?.slice(0, 80)}{q.professor?.text?.length > 80 ? "…" : ""}
                        </div>
                        <div style={{ fontSize: 12, color: C.t3 }}>
                          {q.students?.map((s) => s.name).join("  ·  ")}
                        </div>
                      </>
                    )}
                    {formType === "email" && (
                      <>
                        <div style={{ fontSize: 13, color: C.t2 }}>
                          To: <strong>{q.to}</strong>{q.subject ? <>  ·  Subject: <strong>{q.subject}</strong></> : null}
                        </div>
                        <div style={{ fontSize: 12, color: C.t3 }}>
                          {q.scenario?.slice(0, 80)}{q.scenario?.length > 80 ? "…" : ""}
                        </div>
                      </>
                    )}
                    {formType === "build" && (
                      <>
                        <div style={{ fontSize: 13, color: C.t2 }}>{q.prompt}</div>
                        <div style={{ fontSize: 12, color: C.green, fontStyle: "italic" }}>→ {q.answer}</div>
                        <div style={{ fontSize: 12, color: C.t3 }}>
                          {q.chunks?.slice(0, 5).join(" / ")}{q.chunks?.length > 5 ? " …" : ""}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* footer buttons */}
        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid " + C.bdrSubtle,
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            flexShrink: 0,
          }}
        >
          {step === BULK_STEPS.input && (
            <>
              <button
                onClick={onClose}
                style={{ padding: "9px 18px", background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, fontSize: 14, fontWeight: 600, color: C.t2, cursor: "pointer", fontFamily: FONT }}
              >
                取消
              </button>
              <button
                onClick={handleParse}
                disabled={!text.trim()}
                style={{
                  padding: "9px 20px",
                  background: !text.trim() ? "#9ca3af" : typeColor[formType],
                  color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700,
                  cursor: !text.trim() ? "not-allowed" : "pointer", fontFamily: FONT,
                }}
              >
                AI 识别 →
              </button>
            </>
          )}
          {step === BULK_STEPS.preview && (
            <>
              <button
                onClick={() => setStep(BULK_STEPS.input)}
                style={{ padding: "9px 18px", background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, fontSize: 14, fontWeight: 600, color: C.t2, cursor: "pointer", fontFamily: FONT }}
              >
                ← 重新识别
              </button>
              <button
                onClick={handleSave}
                disabled={activeCount === 0}
                style={{
                  padding: "9px 20px",
                  background: activeCount === 0 ? "#9ca3af" : C.green,
                  color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700,
                  cursor: activeCount === 0 ? "not-allowed" : "pointer", fontFamily: FONT,
                }}
              >
                确认写入 {activeCount} 道题
              </button>
            </>
          )}
          {step === BULK_STEPS.saving && (
            <div style={{ fontSize: 13, color: C.t2, padding: "9px 0" }}>写入中，请勿关闭…</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminQuestionsPage() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("academic");
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    try {
      setToken(localStorage.getItem(TOKEN_KEY) || "");
    } catch {
      // no-op
    } finally {
      setReady(true);
    }
  }, []);

  function persistToken(v) {
    setToken(v);
    try {
      localStorage.setItem(TOKEN_KEY, v);
    } catch {
      // no-op
    }
  }

  const load = useCallback(async () => {
    if (!token.trim()) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/questions", {
        headers: { "x-admin-token": token.trim() },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // auto-load when token is ready from localStorage
  useEffect(() => {
    if (ready && token.trim()) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function handleAddSuccess(question_id) {
    setShowAddModal(false);
    load();
    setToast(`✓ 题目已添加 (${question_id})`);
  }

  function handleBulkSuccess(count) {
    setShowBulkModal(false);
    load();
    setToast(`✓ 已批量写入 ${count} 道题`);
  }

  if (!ready) return null;

  // ── stats ──
  const academicCount = data?.academic?.length ?? 0;
  const emailCount = data?.email?.length ?? 0;
  const buildSets = data?.buildSentence?.question_sets ?? [];
  const buildTotal = buildSets.reduce((s, set) => s + (set.questions?.length ?? 0), 0);
  const officialAcademic = (data?.academic ?? []).filter((i) => i.source === "official").length;
  const officialEmail = (data?.email ?? []).filter((i) => i.source === "official").length;
  const officialBuild = buildSets.flatMap((s) => s.questions).filter((q) => q.source === "official").length;

  // ── filtered data ──
  const q = search.trim().toLowerCase();

  const filteredAcademic = q
    ? (data?.academic ?? []).filter(
        (item) =>
          item.professor.text.toLowerCase().includes(q) ||
          item.students.some((s) => s.text.toLowerCase().includes(q)) ||
          item.id.toLowerCase().includes(q)
      )
    : (data?.academic ?? []);

  const filteredEmail = q
    ? (data?.email ?? []).filter(
        (item) =>
          item.scenario.toLowerCase().includes(q) ||
          item.direction.toLowerCase().includes(q) ||
          (item.goals ?? []).some((g) => g.toLowerCase().includes(q)) ||
          item.id.toLowerCase().includes(q)
      )
    : (data?.email ?? []);

  const filteredBuildSets = buildSets
    .map((set) => ({
      ...set,
      questions: q
        ? set.questions.filter(
            (q2) =>
              q2.prompt.toLowerCase().includes(q) ||
              q2.answer.toLowerCase().includes(q) ||
              q2.id.toLowerCase().includes(q) ||
              (q2.grammar_points ?? []).some((gp) => gp.toLowerCase().includes(q))
          )
        : set.questions,
    }))
    .filter((set) => set.questions.length > 0);

  // ── render ──
  return (
    <AdminLayout title="题库管理">
      {toast && <SuccessToast message={toast} onClose={() => setToast(null)} />}
      {showAddModal && (
        <AddQuestionModal
          type={tab}
          token={token.trim()}
          onClose={() => setShowAddModal(false)}
          onSuccess={handleAddSuccess}
        />
      )}
      {showBulkModal && (
        <BulkImportModal
          defaultType={tab}
          token={token.trim()}
          onClose={() => setShowBulkModal(false)}
          onSuccess={handleBulkSuccess}
        />
      )}

      <div style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 16 }}>

        {/* header */}
        <div
          style={{
            background: "#fff",
            border: "1px solid " + C.bdr,
            borderRadius: 10,
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.nav }}>题库管理</div>
            <div style={{ fontSize: 13, color: C.t2, marginTop: 2 }}>
              查看所有练习题目内容，支持展开详情与关键词搜索。
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {data && (
              <>
                <button
                  onClick={() => setShowBulkModal(true)}
                  style={{
                    padding: "8px 16px",
                    background: "#fff",
                    color: C.orange,
                    border: "1px solid " + C.orange + "80",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: FONT,
                  }}
                >
                  AI 批量导入
                </button>
                <button
                  onClick={() => setShowAddModal(true)}
                  style={{
                    padding: "8px 16px",
                    background: C.blue,
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: FONT,
                  }}
                >
                  + 添加题目
                </button>
              </>
            )}
          </div>
        </div>

        {/* token input */}
        {!data && (
          <div
            style={{
              background: "#fff",
              border: "1px solid " + C.bdr,
              borderRadius: 10,
              padding: "16px 20px",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: C.t2 }}>管理员口令</div>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                type="password"
                value={token}
                onChange={(e) => persistToken(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && load()}
                placeholder="输入 ADMIN_DASHBOARD_TOKEN"
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  border: "1px solid " + C.bdr,
                  borderRadius: 8,
                  fontSize: 14,
                  fontFamily: FONT,
                  outline: "none",
                }}
              />
              <button
                onClick={load}
                disabled={loading || !token.trim()}
                style={{
                  padding: "9px 18px",
                  background: C.blue,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: FONT,
                  opacity: loading || !token.trim() ? 0.5 : 1,
                }}
              >
                {loading ? "加载中…" : "加载题库"}
              </button>
            </div>
            {err && <div style={{ fontSize: 13, color: C.red }}>{err}</div>}
          </div>
        )}

        {/* stats row */}
        {data && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <StatCard
              label="学术写作 Academic"
              count={academicCount}
              sub={`${officialAcademic ? officialAcademic + " 道真题 · " : ""}道讨论题`}
              color={C.blue}
            />
            <StatCard
              label="邮件写作 Email"
              count={emailCount}
              sub={`${officialEmail ? officialEmail + " 道真题 · " : ""}道情景写作题`}
              color="#7c3aed"
            />
            <StatCard
              label="连词成句 Build"
              count={buildTotal}
              sub={`${officialBuild ? officialBuild + " 道真题 · " : ""}道题 · ${buildSets.length} 套`}
              color="#d97706"
            />
          </div>
        )}

        {/* tabs + search */}
        {data && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => { setTab(t.key); setSearch(""); }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    border: "1px solid " + (tab === t.key ? C.blue : C.bdr),
                    background: tab === t.key ? C.blue : "#fff",
                    color: tab === t.key ? "#fff" : C.t2,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: FONT,
                    transition: "all 150ms",
                  }}
                >
                  {t.icon}  {t.label}
                </button>
              ))}
            </div>
            <SearchBar value={search} onChange={setSearch} />
          </div>
        )}

        {/* ── academic tab ── */}
        {data && tab === "academic" && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, color: C.t3, paddingLeft: 2 }}>
              显示 {filteredAcademic.length} / {academicCount} 道题
            </div>
            {filteredAcademic.length === 0 && (
              <div style={{ fontSize: 14, color: C.t3, padding: "20px 0", textAlign: "center" }}>
                无匹配结果
              </div>
            )}
            {filteredAcademic.map((item, i) => (
              <AcademicCard key={item.id} item={item} idx={i} />
            ))}
          </div>
        )}

        {/* ── email tab ── */}
        {data && tab === "email" && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, color: C.t3, paddingLeft: 2 }}>
              显示 {filteredEmail.length} / {emailCount} 道题
            </div>
            {filteredEmail.length === 0 && (
              <div style={{ fontSize: 14, color: C.t3, padding: "20px 0", textAlign: "center" }}>
                无匹配结果
              </div>
            )}
            {filteredEmail.map((item) => (
              <EmailCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {/* ── build tab ── */}
        {data && tab === "build" && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, color: C.t3, paddingLeft: 2 }}>
              {q
                ? `搜索到 ${filteredBuildSets.reduce((s, set) => s + set.questions.length, 0)} 道题`
                : `${buildSets.length} 套 · 共 ${buildTotal} 道题`}
            </div>
            {filteredBuildSets.length === 0 && (
              <div style={{ fontSize: 14, color: C.t3, padding: "20px 0", textAlign: "center" }}>
                无匹配结果
              </div>
            )}
            {filteredBuildSets.map((set) => (
              <BuildSetCard
                key={set.set_id}
                set={set}
                token={token.trim()}
                onDeleted={(setId) => {
                  setData(prev => ({
                    ...prev,
                    buildSentence: {
                      ...prev.buildSentence,
                      question_sets: prev.buildSentence.question_sets.filter(s => s.set_id !== setId),
                    },
                  }));
                  setToast(`✓ 套题 #${setId} 已从题库删除`);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
