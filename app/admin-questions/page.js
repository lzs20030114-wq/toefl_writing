"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { C, FONT } from "../../components/shared/ui";

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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: C.t3 }}>
              To: <strong style={{ color: C.t2 }}>{item.to}</strong>
            </span>
            <span style={{ fontSize: 12, color: C.t3 }}>
              From: <strong style={{ color: C.t2 }}>{item.from}</strong>
            </span>
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

function BuildSetCard({ set }) {
  const [open, setOpen] = useState(false);
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
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          background: open ? "#f0fdf7" : "#fff",
          border: "none",
          padding: "13px 16px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontFamily: FONT,
          transition: "background 150ms",
        }}
      >
        <Badge color={C.blue} bg={C.blue + "18"}>Set {set.set_id}</Badge>
        <div style={{ flex: 1, textAlign: "left" }}>
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

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminQuestionsPage() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("academic");
  const [search, setSearch] = useState("");

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

  async function load() {
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
  }

  // auto-load when token is ready from localStorage
  useEffect(() => {
    if (ready && token.trim()) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (!ready) return null;

  // ── stats ──
  const academicCount = data?.academic?.length ?? 0;
  const emailCount = data?.email?.length ?? 0;
  const buildSets = data?.buildSentence?.question_sets ?? [];
  const buildTotal = buildSets.reduce((s, set) => s + (set.questions?.length ?? 0), 0);

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
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, padding: "20px 16px" }}>
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
          <Link href="/admin" style={{ fontSize: 13, color: C.blue, fontWeight: 600, textDecoration: "none" }}>
            ← 返回后台首页
          </Link>
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
              sub="道讨论题"
              color={C.blue}
            />
            <StatCard
              label="邮件写作 Email"
              count={emailCount}
              sub="道情景写作题"
              color="#7c3aed"
            />
            <StatCard
              label="连词成句 Build"
              count={buildTotal}
              sub={`道题 · ${buildSets.length} 套`}
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
              <BuildSetCard key={set.set_id} set={set} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
