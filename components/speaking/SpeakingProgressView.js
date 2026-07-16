"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { FONT, PageShell, SurfaceCard, TopBar, ChevronIcon, ModeChip, NEUTRAL } from "../shared/ui";
import { StatCard } from "../shared/StatCard";
import { AccuracyTrendChart } from "../shared/AccuracyTrendChart";
import { loadHist, deleteSession, SESSION_STORE_EVENTS, setCurrentUser } from "../../lib/sessionStore";
import { getSavedCode } from "../../lib/AuthContext";
import { formatLocalDateTime } from "../../lib/utils";
import { buildDailyAveragePoints, getSpeakingAverageScore } from "../../lib/history/scoreMetrics";
import { relativeDateLabel } from "../../lib/history/dateGroup";
import { getBandColor } from "../../lib/history/bandColor";
import { RepeatDetail, InterviewDetail } from "./SpeakingTaskDetails";
import { SpeakingMockDetail } from "./SpeakingMockDetail";

const ACCENT = { color: "#F59E0B", soft: "#FFFBEB" };

const P = {
  ...NEUTRAL,
  primary: "#F59E0B", primarySoft: "#FFFBEB",
};

const SUBTYPE_META = {
  repeat:    { label: "听后复述", short: "复述", color: "#F59E0B", soft: "#FFFBEB", icon: "🔁" },
  interview: { label: "模拟面试", short: "面试", color: "#EF4444", soft: "#FEF2F2", icon: "🎤" },
  mock:      { label: "口语模考", short: "模考", color: "#DC2626", soft: "#FEF2F2", icon: "🎯" },
};

function getSubtypeInfo(subtype) {
  return SUBTYPE_META[subtype] || SUBTYPE_META.repeat;
}

// Older mock-exam sessions were stored with type "speaking-exam" and a flat
// shape. Re-shape them on read so legacy history records surface alongside
// the new unified "speaking" + subtype "mock" records.
function normalizeSpeakingSession(s) {
  if (s?.type === "speaking-exam") {
    return {
      ...s,
      type: "speaking",
      mode: "mock",
      band: s.band,
      details: {
        subtype: "mock",
        band: s.band,
        cefr: s.cefr,
        repeatScore: s.details?.repeatScore,
        interviewScore: s.details?.interviewScore,
        avgRepeatAccuracy: s.details?.avgRepeatAccuracy,
        rawTotal: s.details?.rawTotal,
        repeatSetId: s.details?.repeatSetId,
        interviewSetId: s.details?.interviewSetId,
        elapsed: s.details?.elapsed,
      },
    };
  }
  return s;
}

// -- Trend Chart (SVG) — practice only (mock lives in the sidebar) --

function SpeakingTrendChart({ sessions, filter }) {
  const filtered = filter === "all" ? sessions : sessions.filter(s => s.details?.subtype === filter);
  const pts = buildDailyAveragePoints(filtered, getSpeakingAverageScore);
  return <AccuracyTrendChart pts={pts} accentColor={ACCENT.color} ticks={[0, 2.5, 5]} maxValue={5} />;
}

// -- Session Row (practice records only) --

function SessionRow({ session, expanded, onToggle, onDelete }) {
  const s = session;
  const subtype = s.details?.subtype || "repeat";
  const m = getSubtypeInfo(subtype);
  const avgScore = s.details?.averageScore;
  const topic = s.details?.topic || "";
  const attempted = s.details?.attempted || 0;
  const total = s.details?.total || 0;

  const scoreDisplay = avgScore != null ? `${avgScore}/5` : `${attempted}/${total}`;
  const scoreColor = avgScore != null
    ? (avgScore >= 4 ? "#059669" : avgScore >= 3 ? "#D97706" : "#E11D48")
    : P.textSec;

  return (
    <div style={{ transition: "all 0.2s" }}>
      <button onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          padding: "13px 16px", background: expanded ? `${m.color}06` : "none",
          border: "none", cursor: "pointer", transition: "all 0.15s", borderRadius: 10,
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = "#f8faf9"; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = "transparent"; }}
      >
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: `${m.color}10`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: m.color }}>{m.icon}</div>
          {expanded && <div style={{ position: "absolute", left: -6, top: 8, bottom: 8, width: 3, borderRadius: 2, background: m.color }} />}
        </div>
        <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: expanded ? 700 : 580, color: P.text, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span>{m.label}</span>
            {topic && <span style={{ fontSize: 11, color: P.textDim, fontWeight: 400 }}>{topic}</span>}
            <ModeChip mode={s.mode} />
          </div>
          <div style={{ fontSize: 11, color: P.textDim, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{formatLocalDateTime(s.date)}</div>
        </div>
        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 750, color: scoreColor, background: `${scoreColor}0C`, padding: "3px 10px", borderRadius: 8 }}>{scoreDisplay}</span>
        <ChevronIcon open={expanded} color={P.textDim} />
        <span role="button" tabIndex={0} title="删除"
          onClick={e => { e.stopPropagation(); if (onDelete) onDelete(); }}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 6, color: P.textDim, cursor: "pointer", transition: "all 0.15s", flexShrink: 0 }}
          onMouseEnter={e => { e.currentTarget.style.color = "#dc2626"; e.currentTarget.style.background = "#dc262612"; }}
          onMouseLeave={e => { e.currentTarget.style.color = P.textDim; e.currentTarget.style.background = "transparent"; }}
        >
          <svg viewBox="0 0 16 16" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M2.5 4.5h11M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M6.5 7v4.5M9.5 7v4.5M3.5 4.5l.5 8.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l.5-8.5" />
          </svg>
        </span>
      </button>
      {/* Practice list only — mock entries render via the sidebar →
          right-pane SpeakingMockDetail flow, so no mock branch here. */}
      {expanded && (
        <div style={{ padding: "0 16px 14px 62px", animation: "fadeUp 0.2s ease" }}>
          {subtype === "interview" ? <InterviewDetail session={s} /> : <RepeatDetail session={s} />}
        </div>
      )}
    </div>
  );
}

// -- Latest Mock Card (sidebar) --

function LatestMockCard({ session }) {
  if (!session) return null;
  const band = Number.isFinite(session.band) ? session.band : session.details?.band;
  const cefr = session.details?.cefr || session.cefr || "";
  const bc = getBandColor(band);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        background: `linear-gradient(135deg, ${P.primarySoft} 0%, #FEF3C7 100%)`,
        borderRadius: 14,
        border: `1px solid ${P.primary}18`,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          width: 50,
          height: 50,
          borderRadius: "50%",
          background: "#fff",
          border: `3px solid ${bc}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 800, color: bc, fontVariantNumeric: "tabular-nums" }}>
          {Number.isFinite(band) ? band.toFixed(1) : "—"}
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: P.textDim,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 4,
          }}
        >
          最新模考
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {cefr && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: 4,
                background: P.bg,
                border: `1px solid ${P.borderSubtle}`,
                color: P.textSec,
              }}
            >
              CEFR {cefr}
            </span>
          )}
          <span style={{ fontSize: 10, color: P.textDim }}>
            {new Date(session.date).toLocaleDateString("zh-CN")}
          </span>
        </div>
      </div>
    </div>
  );
}

// -- Mock list (sidebar) --

function MockListSidebar({ entries, activeIdx, onSelect }) {
  const [open, setOpen] = useState(true);
  return (
    <div
      style={{
        background: P.surface,
        borderRadius: 12,
        border: `1px solid ${P.border}`,
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "12px 14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: P.bg,
          border: "none",
          borderBottom: open ? `1px solid ${P.borderSubtle}` : "none",
          cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: P.text }}>
          🎯 模考记录 ({entries.length})
        </span>
        <span style={{ fontSize: 11, color: P.textDim }}>{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div
          style={{
            maxHeight: 360,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            animation: "expandDown 0.3s cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          {entries.length === 0 ? (
            <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 12, color: P.textDim }}>
              暂无模考记录。
            </div>
          ) : (
            entries.map((entry, i) => {
              const s = entry.session;
              const band = Number.isFinite(s.band) ? s.band : s.details?.band;
              const bc = getBandColor(band);
              const rpt = s.details?.repeatScore;
              const intv = s.details?.interviewScore;
              const isActive = activeIdx === entry.sourceIndex;
              const date = new Date(s.date);
              const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
              return (
                <button
                  key={entry.sourceIndex}
                  onClick={() => onSelect(isActive ? null : entry.sourceIndex)}
                  style={{
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: isActive ? `${bc}10` : "transparent",
                    border: "none",
                    borderLeft: `3px solid ${isActive ? bc : "transparent"}`,
                    borderBottom: i < entries.length - 1 ? `1px solid ${P.borderSubtle}` : "none",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = `${P.textDim}08`;
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      background: `${bc}15`,
                      border: `1.5px solid ${bc}40`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: bc,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {Number.isFinite(band) ? band.toFixed(1) : "—"}
                    </span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: P.text, lineHeight: 1.3 }}>
                      {dateStr}
                      <span style={{ fontSize: 10, color: P.textDim, fontWeight: 500, marginLeft: 6 }}>
                        {date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: P.textDim, marginTop: 2 }}>
                      复述 {rpt != null ? rpt : "—"}/5 · 面试 {intv != null ? intv : "—"}/5
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: P.textDim, flexShrink: 0 }}>{isActive ? "◀" : "▸"}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// -- Main View --

export function SpeakingProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
  const [filter, setFilter] = useState("all");
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [activeMockSrcIdx, setActiveMockSrcIdx] = useState(null);
  // Set when a `?mock=<date>` deep link points at a record we can't find (e.g.
  // the exam's cloud save silently failed) — surfaced as an amber notice.
  const [mockNotFound, setMockNotFound] = useState(false);
  // Consume a `?mock=...` deep link exactly once (from the post-exam ResultsCard
  // link) so re-renders don't re-open it.
  const mockDeepLinkConsumed = useRef(false);

  useEffect(() => {
    try { setCurrentUser(getSavedCode() || ""); } catch {}
    const refresh = () => setHist(loadHist());
    refresh();
    window.addEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // Build entries up-front so sourceIndex survives normalization (legacy
  // speaking-exam records produce a new object ref, breaking indexOf lookups
  // later). Prefer cloud row id when present.
  const entries = useMemo(() => {
    if (!hist?.sessions) return [];
    return hist.sessions
      .map((s, i) => ({
        original: s,
        sourceIndex: Number.isFinite(Number(s?.id)) ? Number(s.id) : i,
      }))
      .filter((e) => e.original.type === "speaking" || e.original.type === "speaking-exam")
      .map((e) => ({ session: normalizeSpeakingSession(e.original), sourceIndex: e.sourceIndex }))
      .sort((a, b) => new Date(b.session.date) - new Date(a.session.date));
  }, [hist]);

  const sessions = useMemo(() => entries.map((e) => e.session), [entries]);
  const mockEntries = useMemo(
    () => entries.filter((e) => e.session.details?.subtype === "mock"),
    [entries],
  );
  const practiceEntries = useMemo(
    () => entries.filter((e) => e.session.details?.subtype !== "mock"),
    [entries],
  );

  // Deep link: the post-exam ResultsCard sends `?mock=<sessionDate>` (its exact
  // save identity) — or legacy `?mock=latest`. "latest" opens the newest mock
  // (mockEntries is date-desc, so [0] is latest); an identity link opens THAT
  // record by date, and if it isn't present (e.g. a cloud save that silently
  // failed) we flag it. Strip the param afterward. Read window once (no
  // useSearchParams — the page has no Suspense boundary and it would break the
  // build).
  useEffect(() => {
    if (mockDeepLinkConsumed.current || typeof window === "undefined") return;
    if (mockEntries.length === 0) return; // wait for records (cloud sync)
    const params = new URLSearchParams(window.location.search);
    const val = params.get("mock");
    mockDeepLinkConsumed.current = true;
    if (val === "latest") {
      setActiveMockSrcIdx(mockEntries[0].sourceIndex);
    } else if (val != null) {
      const target = mockEntries.find((e) => e.session.date === val);
      if (target) setActiveMockSrcIdx(target.sourceIndex);
      else setMockNotFound(true);
    }
    try {
      params.delete("mock");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    } catch {}
  }, [mockEntries]);

  const filteredPractice = useMemo(() => {
    if (filter === "all") return practiceEntries;
    return practiceEntries.filter((e) => e.session.details?.subtype === filter);
  }, [practiceEntries, filter]);

  const repeatSessions = practiceEntries.filter((e) => e.session.details?.subtype === "repeat").map((e) => e.session);
  const interviewSessions = practiceEntries.filter((e) => e.session.details?.subtype === "interview").map((e) => e.session);
  const practiceSessions = practiceEntries.map((e) => e.session);

  function avgScore(arr) {
    if (arr.length === 0) return null;
    const scores = arr.map(getSpeakingAverageScore).filter(Number.isFinite);
    if (scores.length === 0) return null;
    const sum = scores.reduce((a, b) => a + b, 0);
    return Math.round((sum / scores.length) * 2) / 2;
  }

  const repeatAvg = avgScore(repeatSessions);
  const interviewAvg = avgScore(interviewSessions);
  const totalAvg = avgScore(practiceSessions);

  // Stats: practice subtypes only (mock has its own sidebar treatment + a
  // different band scale, doesn't share the 0-5 chart axis).
  const statItems = [
    { key: "all",       icon: "📊", short: "全部", count: practiceSessions.length, color: P.primary, avg: totalAvg !== null ? `平均 ${totalAvg}/5` : "" },
    { key: "repeat",    icon: SUBTYPE_META.repeat.icon,    short: SUBTYPE_META.repeat.short,    count: repeatSessions.length,    color: SUBTYPE_META.repeat.color,    avg: repeatAvg !== null ? `平均 ${repeatAvg}/5` : "暂无" },
    { key: "interview", icon: SUBTYPE_META.interview.icon, short: SUBTYPE_META.interview.short, count: interviewSessions.length, color: SUBTYPE_META.interview.color, avg: interviewAvg !== null ? `平均 ${interviewAvg}/5` : "暂无" },
  ];

  const activeMockEntry = mockEntries.find((e) => e.sourceIndex === activeMockSrcIdx) || null;

  function handleDelete(sourceIndex) {
    deleteSession(sourceIndex);
    setHist(loadHist());
    setExpandedIdx(null);
    if (activeMockSrcIdx === sourceIndex) setActiveMockSrcIdx(null);
  }

  function confirmClearAll() {
    setShowClearConfirm(false);
    // Delete speaking entries one-by-one to avoid wiping non-speaking history.
    // Descending sourceIndex order: in local (logged-out) mode sourceIndex is an
    // array index, and deleting low indices first would shift later ones onto
    // the wrong (possibly non-speaking) records. Cloud row ids don't care.
    [...entries]
      .sort((a, b) => b.sourceIndex - a.sourceIndex)
      .forEach((e) => deleteSession(e.sourceIndex));
    setHist(loadHist());
    setActiveMockSrcIdx(null);
  }

  if (!hist) {
    return (
      <div style={{ minHeight: "100vh", background: P.bg, fontFamily: FONT }}>
        <TopBar title="口语练习记录" section="Speaking" onExit={onBack} accentColor={ACCENT.color} />
        <PageShell narrow><div style={{ textAlign: "center", padding: "60px 0", color: P.textDim }}>加载中...</div></PageShell>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: P.bg, fontFamily: FONT }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes slideInRight { from { opacity:0; transform:translateX(24px) scale(0.99); } to { opacity:1; transform:translateX(0) scale(1); } }
        @keyframes slideInLeft { from { opacity:0; transform:translateX(-16px); } to { opacity:1; transform:translateX(0); } }
        @keyframes expandDown { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes tabFade { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
        @media (max-width: 960px) {
          .sp-layout { flex-direction: column !important; gap: 16px !important; }
          .sp-sidebar { width: 100% !important; position: static !important; }
        }
      `}</style>

      <TopBar title="口语练习记录" section="Speaking" onExit={onBack} accentColor={ACCENT.color} />

      {sessions.length === 0 ? (
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
          <SurfaceCard style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 8 }}>暂无口语练习记录</div>
            <div style={{ fontSize: 12, color: P.textDim }}>完成口语练习后，记录会自动保存在这里。</div>
          </SurfaceCard>
        </div>
      ) : (
        <div
          className="sp-layout"
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            padding: "24px 24px 60px",
            display: "flex",
            gap: 24,
            alignItems: "flex-start",
          }}
        >
          {/* Left sidebar: title + latest mock + mock list */}
          <aside
            className="sp-sidebar"
            style={{
              width: 320,
              flexShrink: 0,
              position: "sticky",
              top: 68,
              animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 60ms both",
            }}
          >
            <div style={{ marginBottom: 16 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: P.text, letterSpacing: "-0.03em", lineHeight: 1.2, margin: "0 0 6px" }}>
                口语练习记录
              </h1>
              <p style={{ fontSize: 12, color: P.textDim, lineHeight: 1.6, margin: 0 }}>
                点击模考查看完整报告
              </p>
            </div>
            {mockEntries.length > 0 && <LatestMockCard session={mockEntries[0].session} />}
            {/* Deep-linked mock record missing (likely a failed save) — explain
                why the requested mock isn't shown before the mock list. */}
            {mockNotFound && (
              <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#92400e", lineHeight: 1.6 }}>
                未找到本次模考的记录（可能保存失败），以下为历史记录。
              </div>
            )}
            <MockListSidebar
              entries={mockEntries}
              activeIdx={activeMockSrcIdx}
              onSelect={(idx) => setActiveMockSrcIdx(idx)}
            />
          </aside>

          {/* Right main: mock detail OR practice overview */}
          <main style={{ flex: 1, minWidth: 0, animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 120ms both" }}>
            {activeMockEntry ? (
              <SpeakingMockDetail
                key={activeMockEntry.sourceIndex}
                session={activeMockEntry.session}
                accent={ACCENT.color}
                onClose={() => setActiveMockSrcIdx(null)}
                onDelete={() => handleDelete(activeMockEntry.sourceIndex)}
              />
            ) : (
              <div key="overview" style={{ animation: "slideInLeft 0.35s cubic-bezier(0.16,1,0.3,1)" }}>
                {/* Stats row: 3 cards + trend chart (practice only) */}
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    marginBottom: 18,
                    alignItems: "stretch",
                    animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 80ms both",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flex: "0 0 52%" }}>
                    {statItems.map(({ key, ...rest }) => (
                      <div key={key} style={{ display: "grid", ...(key === "all" ? { gridColumn: "1 / -1" } : {}) }}>
                        <StatCard {...rest} avgMax={5} active={filter === key} onClick={() => setFilter(key)} />
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "12px 14px 8px",
                      background: P.surface,
                      borderRadius: 14,
                      border: `1px solid ${P.borderSubtle}`,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: P.textSec, marginBottom: 4 }}>
                      分数趋势
                    </div>
                    <div style={{ flex: 1, minHeight: 0 }}>
                      <SpeakingTrendChart sessions={practiceSessions} filter={filter} />
                    </div>
                  </div>
                </div>

                {/* Practice list (no mocks — those are in the sidebar) */}
                <div
                  style={{
                    background: P.surface,
                    borderRadius: 16,
                    border: `1px solid ${P.borderSubtle}`,
                    overflow: "hidden",
                    animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 200ms both",
                  }}
                >
                  <div
                    style={{
                      padding: "14px 18px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 750, color: P.text, letterSpacing: "-0.02em" }}>
                      练习明细
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 550,
                        color: ACCENT.color,
                        background: `${ACCENT.color}08`,
                        padding: "3px 10px",
                        borderRadius: 999,
                      }}
                    >
                      {filteredPractice.length} 条记录
                    </span>
                  </div>
                  <div style={{ padding: "4px 14px 14px" }}>
                    {filteredPractice.length === 0 ? (
                      <div style={{ padding: "24px 0", textAlign: "center", fontSize: 12, color: P.textDim }}>
                        该分类暂无记录
                      </div>
                    ) : (() => {
                      let lastLabel = "";
                      return filteredPractice.map((entry, i) => {
                        const s = entry.session;
                        const d = new Date(s.date);
                        const label = relativeDateLabel(d);
                        const showHeader = label !== lastLabel;
                        lastLabel = label;
                        return (
                          <React.Fragment key={entry.sourceIndex}>
                            {showHeader && (
                              <div
                                style={{
                                  padding: "10px 6px 4px",
                                  fontSize: 11,
                                  fontWeight: 650,
                                  color: P.textDim,
                                  letterSpacing: "0.02em",
                                  borderTop: i === 0 ? "none" : `1px solid ${P.borderSubtle}`,
                                  marginTop: i === 0 ? 0 : 4,
                                }}
                              >
                                {label}
                              </div>
                            )}
                            <SessionRow
                              session={s}
                              expanded={expandedIdx === entry.sourceIndex}
                              onToggle={() =>
                                setExpandedIdx(expandedIdx === entry.sourceIndex ? null : entry.sourceIndex)
                              }
                              onDelete={() => handleDelete(entry.sourceIndex)}
                            />
                          </React.Fragment>
                        );
                      });
                    })()}
                  </div>
                </div>

                {/* Clear all */}
                <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
                  {!showClearConfirm ? (
                    <button
                      onClick={() => setShowClearConfirm(true)}
                      style={{
                        background: "none",
                        border: `1px solid ${P.borderSubtle}`,
                        color: P.textDim,
                        padding: "8px 18px",
                        borderRadius: 9,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 600,
                        transition: "all 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "#dc2626";
                        e.currentTarget.style.color = "#dc2626";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = P.borderSubtle;
                        e.currentTarget.style.color = P.textDim;
                      }}
                    >
                      清空全部口语记录
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>确认清空？</span>
                      <button
                        onClick={confirmClearAll}
                        style={{
                          background: "#dc2626",
                          color: "#fff",
                          border: "none",
                          padding: "6px 14px",
                          borderRadius: 8,
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        确认
                      </button>
                      <button
                        onClick={() => setShowClearConfirm(false)}
                        style={{
                          background: P.surface,
                          border: `1px solid ${P.border}`,
                          color: P.textSec,
                          padding: "6px 14px",
                          borderRadius: 8,
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
