"use client";

import { useState, useEffect, useMemo } from "react";
import { C, FONT, Btn, PageShell, SurfaceCard, TopBar } from "../shared/ui";
import { loadHist, SESSION_STORE_EVENTS, setCurrentUser } from "../../lib/sessionStore";

const ACCENT = { color: "#3B82F6", soft: "#EFF6FF" };

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    return `${month}/${day} ${h}:${m}`;
  } catch { return dateStr; }
}

function subtypeLabel(subtype) {
  if (subtype === "ctw") return "Complete the Words";
  if (subtype === "rdl") return "Read in Daily Life";
  return subtype || "Reading";
}

function subtypeIcon(subtype) {
  return subtype === "ctw" ? "Aa" : "📄";
}

export function ReadingProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
  const [filter, setFilter] = useState("all"); // "all" | "ctw" | "rdl"
  const [expandedIdx, setExpandedIdx] = useState(null);

  useEffect(() => {
    try { setCurrentUser(localStorage.getItem("toefl-auth-code") || ""); } catch {}
    const refresh = () => setHist(loadHist());
    refresh();
    window.addEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const sessions = useMemo(() => {
    if (!hist?.sessions) return [];
    return hist.sessions
      .filter(s => s.type === "reading")
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [hist]);

  const filtered = useMemo(() => {
    if (filter === "all") return sessions;
    return sessions.filter(s => s.details?.subtype === filter);
  }, [sessions, filter]);

  // Stats
  const ctwSessions = sessions.filter(s => s.details?.subtype === "ctw");
  const rdlSessions = sessions.filter(s => s.details?.subtype === "rdl");

  function avgPct(arr) {
    if (arr.length === 0) return null;
    const sum = arr.reduce((s, sess) => {
      const t = Number(sess.total || 0);
      const c = Number(sess.correct || 0);
      return t > 0 ? s + (c / t) : s;
    }, 0);
    return Math.round(sum / arr.length * 100);
  }

  const ctwAvg = avgPct(ctwSessions);
  const rdlAvg = avgPct(rdlSessions);
  const totalAvg = avgPct(sessions);

  if (!hist) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        <TopBar title="阅读练习记录" section="Reading" onExit={onBack} accentColor={ACCENT.color} />
        <PageShell narrow>
          <div style={{ textAlign: "center", padding: "60px 0", color: C.t3 }}>加载中...</div>
        </PageShell>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title="阅读练习记录" section="Reading" onExit={onBack} accentColor={ACCENT.color} />
      <PageShell narrow>
        {/* Stats summary */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 20 }}>
          <StatCard
            label="全部" count={sessions.length}
            avg={totalAvg !== null ? `${totalAvg}%` : "--"}
            active={filter === "all"} onClick={() => setFilter("all")}
            color={ACCENT.color} icon="📊"
          />
          <StatCard
            label="单词补全" count={ctwSessions.length}
            avg={ctwAvg !== null ? `${ctwAvg}%` : "--"}
            active={filter === "ctw"} onClick={() => setFilter("ctw")}
            color="#D97706" icon="Aa"
          />
          <StatCard
            label="日常阅读" count={rdlSessions.length}
            avg={rdlAvg !== null ? `${rdlAvg}%` : "--"}
            active={filter === "rdl"} onClick={() => setFilter("rdl")}
            color="#059669" icon="📄"
          />
        </div>

        {/* Session list */}
        <SurfaceCard style={{ overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.bdr}`, fontSize: 13, fontWeight: 700, color: C.t1 }}>
            练习明细 ({filtered.length})
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: C.t3 }}>
              {sessions.length === 0 ? "还没有阅读练习记录，完成练习后会自动保存。" : "该分类暂无记录。"}
            </div>
          ) : (
            <div style={{ padding: "4px 0" }}>
              {filtered.map((s, i) => {
                const subtype = s.details?.subtype || "?";
                const total = Number(s.total || 0);
                const correct = Number(s.correct || 0);
                const pct = total > 0 ? correct / total : 0;
                const scoreColor = pct >= 0.8 ? "#059669" : pct >= 0.6 ? "#D97706" : "#DC2626";
                const isExpanded = expandedIdx === i;
                const topic = s.details?.topic || "";

                return (
                  <div key={i} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${C.bdr}22` : "none" }}>
                    <button
                      onClick={() => setExpandedIdx(isExpanded ? null : i)}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 10,
                        padding: "12px 16px", background: isExpanded ? `${ACCENT.soft}` : "transparent",
                        border: "none", cursor: "pointer", fontFamily: FONT, textAlign: "left",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = "#F8FAFC"; }}
                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = "transparent"; }}
                    >
                      {/* Icon */}
                      <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: subtype === "ctw" ? "#FFFBEB" : "#ECFDF5",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 700, flexShrink: 0,
                        color: subtype === "ctw" ? "#D97706" : "#059669",
                      }}>
                        {subtypeIcon(subtype)}
                      </div>
                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.t1 }}>
                          {subtypeLabel(subtype)}
                          {topic && <span style={{ fontSize: 11, color: C.t3, fontWeight: 400, marginLeft: 6 }}>{topic}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>{formatDate(s.date)}</div>
                      </div>
                      {/* Score */}
                      <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 15, fontWeight: 720, color: scoreColor }}>
                        {correct}/{total}
                      </span>
                      {s.band && (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 999, background: `${scoreColor}18`, color: scoreColor }}>
                          {s.band.toFixed(1)}
                        </span>
                      )}
                      {/* Chevron */}
                      <svg width={14} height={14} viewBox="0 0 20 20" fill="none" stroke={C.t3} strokeWidth="2"
                        style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", flexShrink: 0 }}>
                        <path d="M5 8l5 5 5-5" />
                      </svg>
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && s.details?.results && (
                      <div style={{ padding: "0 16px 14px", animation: "fadeUp 0.2s ease" }}>
                        {subtype === "ctw" ? (
                          <CTWDetail results={s.details.results} />
                        ) : (
                          <RDLDetail results={s.details.results} />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SurfaceCard>

        <div style={{ marginTop: 20, textAlign: "center" }}>
          <Btn onClick={onBack} variant="secondary">返回</Btn>
        </div>
      </PageShell>
    </div>
  );
}

// ── Stat Card ──

function StatCard({ label, count, avg, active, onClick, color, icon }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "14px 8px", borderRadius: 12, border: `1.5px solid ${active ? color : C.bdr}`,
        background: active ? `${color}08` : C.card,
        cursor: "pointer", fontFamily: FONT, transition: "all 0.15s",
        boxShadow: active ? `0 2px 8px ${color}20` : "none",
      }}
    >
      <span style={{ fontSize: 18, marginBottom: 4 }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: active ? color : C.t2 }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 800, color: active ? color : C.t1, marginTop: 2 }}>{count}</span>
      <span style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>{avg !== "--" ? `平均 ${avg}` : "暂无"}</span>
    </button>
  );
}

// ── CTW Detail ──

function CTWDetail({ results }) {
  if (!Array.isArray(results)) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {results.map((r, i) => {
        const blank = r.blank || {};
        const isCorrect = r.isCorrect;
        return (
          <span key={i} style={{
            fontSize: 12, padding: "3px 8px", borderRadius: 6,
            background: isCorrect ? "#D1FAE5" : "#FEE2E2",
            color: isCorrect ? "#065F46" : "#991B1B",
            fontFamily: "'Courier New', monospace", fontWeight: 600,
          }}>
            {blank.displayed_fragment || ""}
            {isCorrect ? (blank.original_word || "").slice((blank.displayed_fragment || "").length) : `→${blank.original_word || "?"}`}
          </span>
        );
      })}
    </div>
  );
}

// ── RDL Detail ──

function RDLDetail({ results }) {
  if (!Array.isArray(results)) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {results.map((r, i) => (
        <div key={i} style={{
          fontSize: 12, padding: "6px 10px", borderRadius: 8,
          background: r.isCorrect ? "#F0FDF4" : "#FEF2F2",
          border: `1px solid ${r.isCorrect ? "#BBF7D0" : "#FECACA"}`,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontWeight: 700, color: r.isCorrect ? "#059669" : "#DC2626" }}>
            {r.isCorrect ? "✓" : "✗"}
          </span>
          <span style={{ color: C.t2 }}>
            Q{i + 1}: 选 {r.selected}
            {!r.isCorrect && <span style={{ color: "#DC2626" }}> (正确: {r.correct})</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
