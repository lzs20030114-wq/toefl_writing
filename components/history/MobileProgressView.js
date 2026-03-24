"use client";
import React, { useState, useMemo, useEffect } from "react";
import { FONT } from "../shared/ui";
import { formatLocalDateTime, translateGrammarPoint } from "../../lib/utils";
import { WritingFeedbackPanel } from "../writing/WritingFeedbackPanel";
import { useBsAiExplain, BsAiExplainBlock } from "../buildSentence/useBsAiExplain";
import { HistoryRow } from "./HistoryRow";

const P = {
  bg: "#f4f7f5", surface: "#ffffff", border: "#dde5df", borderSubtle: "#ebf0ed",
  text: "#1a2420", textSec: "#5a6b62", textDim: "#94a39a",
  primary: "#0d9668", primaryDeep: "#087355", primarySoft: "#ecfdf5",
  teal: "#0891B2", tealSoft: "#ecfeff",
  amber: "#d97706", amberSoft: "#fffbeb",
  indigo: "#6366F1", indigoSoft: "#eef2ff",
  rose: "#E11D48", roseSoft: "#fff1f2",
  purple: "#7C3AED", purpleSoft: "#f5f3ff",
  shadow: "0 1px 3px rgba(10,40,25,0.04), 0 1px 2px rgba(10,40,25,0.02)",
};

const TYPE = {
  bs: { label: "拼句练习", short: "拼句", color: P.amber, soft: P.amberSoft, icon: "🧩" },
  email: { label: "邮件写作", short: "邮件", color: P.teal, soft: P.tealSoft, icon: "📧" },
  discussion: { label: "学术讨论", short: "讨论", color: P.indigo, soft: P.indigoSoft, icon: "💬" },
  mock: { label: "模考", short: "模考", color: P.purple, soft: P.purpleSoft, icon: "🎯" },
};

const MOCK_IDS = { BUILD: "build-sentence", EMAIL: "email-writing", DISC: "academic-writing" };

function getBandColor(band) {
  if (band >= 5.5) return "#16a34a";
  if (band >= 4.5) return "#2563eb";
  if (band >= 3.5) return "#d97706";
  if (band >= 2.5) return "#ea580c";
  return "#dc2626";
}

function getScoreLabel(s) {
  if (!s) return "--";
  if (s.type === "bs") return s.total > 0 ? `${s.correct}/${s.total}` : "--";
  if (s.type === "mock") return Number.isFinite(s.band) ? `${s.band.toFixed(1)}` : "--";
  return Number.isFinite(s.score) ? `${s.score}/5` : "--";
}

function getScoreColor(s) {
  if (!s) return P.textDim;
  if (s.type === "bs") return s.total > 0 && s.correct / s.total >= 0.8 ? "#16a34a" : P.amber;
  if (s.type === "mock") return Number.isFinite(s.band) ? getBandColor(s.band) : P.textDim;
  return s.score >= 4 ? "#16a34a" : s.score >= 3 ? P.amber : "#dc2626";
}

// -- Shared tiny components --

function BackBtn({ onClick, label = "返回" }) {
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", color: P.textSec, fontSize: 14, fontWeight: 600, padding: "10px 4px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, touchAction: "manipulation" }}>
      <span style={{ fontSize: 16 }}>&#8249;</span> {label}
    </button>
  );
}

function Tag({ children, color, bg, style }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, color: color || P.textSec, background: bg || `${color || P.textSec}18`, lineHeight: "18px", whiteSpace: "nowrap", ...style }}>
      {children}
    </span>
  );
}

// ============================================================
// MOCK DETAIL — full-screen overlay
// ============================================================

function MockDetailView({ entry, onBack }) {
  const s = entry.session;
  const tasks = Array.isArray(s?.details?.tasks) ? s.details.tasks : [];
  const byId = {};
  tasks.forEach((t) => { if (t?.taskId) byId[t.taskId] = t; });

  const emailTask = byId[MOCK_IDS.EMAIL] || null;
  const discTask = byId[MOCK_IDS.DISC] || null;
  const bsTask = byId[MOCK_IDS.BUILD] || null;
  const bsDetails = Array.isArray(bsTask?.meta?.details) ? bsTask.meta.details : [];

  const [tab, setTab] = useState(MOCK_IDS.EMAIL);
  const mobileBsAi = useBsAiExplain();
  const bc = Number.isFinite(s.band) ? getBandColor(s.band) : P.textDim;

  const tabs = [
    { key: MOCK_IDS.EMAIL, label: "邮件写作", color: P.teal },
    { key: MOCK_IDS.DISC, label: "学术讨论", color: P.indigo },
    { key: MOCK_IDS.BUILD, label: "拼句练习", color: P.amber },
  ];

  function renderWritingTab(task) {
    if (!task) return <div style={{ padding: 32, textAlign: "center", color: P.textDim, fontSize: 13 }}>暂无数据。</div>;
    const fb = task?.meta?.feedback || null;
    const pd = task?.meta?.response?.promptData || null;
    const userText = task?.meta?.response?.userText || "";
    const type = task?.taskId === MOCK_IDS.EMAIL ? "email" : "discussion";
    return <WritingFeedbackPanel fb={fb} type={type} pd={pd} userText={userText} containerHeight="100%" onExit={null} onRetry={null} onNext={null} />;
  }

  function renderBsTab() {
    if (!bsDetails.length) return <div style={{ padding: 32, textAlign: "center", color: P.textDim, fontSize: 13 }}>暂无拼句数据。</div>;
    const correct = bsDetails.filter((d) => d?.isCorrect).length;
    return (
      <div style={{ padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ background: "#0f2318", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: "#fff" }}>{correct}</span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>/ {bsDetails.length}</span>
          </div>
          <span style={{ fontSize: 12, color: P.textSec }}>正确率 {Math.round((correct / bsDetails.length) * 100)}%</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {bsDetails.map((d, i) => (
            <div key={i} style={{ padding: "10px 12px", background: P.surface, borderRadius: 10, border: `1px solid ${P.borderSubtle}`, borderLeft: `3px solid ${d.isCorrect ? P.primary : P.rose}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ color: d.isCorrect ? P.primary : P.rose, fontWeight: 800, fontSize: 14 }}>{d.isCorrect ? "✓" : "✗"}</span>
                <span style={{ fontSize: 12, color: P.text, lineHeight: 1.5, flex: 1, wordBreak: "break-word" }}>{d.correctAnswer || d.prompt || `第 ${i + 1} 题`}</span>
              </div>
              {!d.isCorrect && d.userAnswer ? <div style={{ fontSize: 11, color: P.rose, marginBottom: 4, paddingLeft: 20 }}>你的答案：{d.userAnswer}</div> : null}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3, paddingLeft: 20 }}>
                {(Array.isArray(d.grammar_points) ? d.grammar_points : []).map((g, gi) => (
                  <Tag key={gi} color={P.teal} bg={P.tealSoft}>{translateGrammarPoint(g)}</Tag>
                ))}
              </div>
              <div style={{ paddingLeft: 20 }}>
                <BsAiExplainBlock explainKey={`mob-${i}`} detail={d} aiExplains={mobileBsAi.aiExplains} isLegacy={mobileBsAi.isLegacy} handleAiExplain={mobileBsAi.handleAiExplain} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: P.bg, fontFamily: FONT, display: "flex", flexDirection: "column", height: "100dvh" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, padding: "0 12px", borderBottom: `1px solid ${P.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 48, background: P.surface }}>
        <BackBtn onClick={onBack} />
        <span style={{ fontSize: 14, fontWeight: 700, color: P.text }}>模考报告</span>
        <span style={{ fontSize: 20, fontWeight: 800, color: bc, minWidth: 44, textAlign: "right" }}>{Number.isFinite(s.band) ? s.band.toFixed(1) : "--"}</span>
      </div>
      {/* Tabs */}
      <div style={{ flexShrink: 0, display: "flex", borderBottom: `1px solid ${P.borderSubtle}`, background: P.surface, overflowX: "auto" }}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ flex: 1, minWidth: 0, padding: "11px 0", background: "none", border: "none", borderBottom: `2.5px solid ${active ? t.color : "transparent"}`, fontSize: 13, fontWeight: active ? 700 : 500, color: active ? P.text : P.textDim, cursor: "pointer", touchAction: "manipulation" }}>
              {t.label}
            </button>
          );
        })}
      </div>
      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
        {tab === MOCK_IDS.BUILD ? renderBsTab() : tab === MOCK_IDS.EMAIL ? renderWritingTab(emailTask) : renderWritingTab(discTask)}
      </div>
    </div>
  );
}

// ============================================================
// WRITING DETAIL — full-screen overlay
// ============================================================

function WritingDetailView({ entry, onBack }) {
  const s = entry.session;
  const fb = s.details?.feedback || null;
  const pd = s.details?.promptData || null;
  const userText = s.details?.userText || "";
  const type = s.type;
  const tc = TYPE[type] || TYPE.email;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: P.bg, fontFamily: FONT, display: "flex", flexDirection: "column", height: "100dvh" }}>
      <div style={{ flexShrink: 0, padding: "0 12px", borderBottom: `1px solid ${P.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 48, background: P.surface }}>
        <BackBtn onClick={onBack} />
        <span style={{ fontSize: 14, fontWeight: 700, color: P.text }}>{tc.label}反馈</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: getScoreColor(s), minWidth: 44, textAlign: "right" }}>{getScoreLabel(s)}</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
        <WritingFeedbackPanel fb={fb} type={type} pd={pd} userText={userText} containerHeight="100%" onExit={null} onRetry={null} onNext={null} />
      </div>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function MobileProgressView({ vm }) {
  const {
    entries, mockEntries, practiceEntries, filteredPractice,
    filter, setFilter, selectedWeak, setSelectedWeak,
    activeMockSrcIdx, setActiveMockSrcIdx,
    activePracticeSrcIdx, setActivePracticeSrcIdx,
    expandedSrcIdx, setExpandedSrcIdx,
    statItems, typeAvgs, topWeaknesses,
    handleDelete, onBack,
    showClearConfirm, setShowClearConfirm, confirmClearAll,
  } = vm;

  // Derive active detail entries
  const activeMockEntry = useMemo(() => mockEntries.find((e) => e.sourceIndex === activeMockSrcIdx) || null, [mockEntries, activeMockSrcIdx]);
  const activePracticeEntry = useMemo(() => practiceEntries.find((e) => e.sourceIndex === activePracticeSrcIdx) || null, [practiceEntries, activePracticeSrcIdx]);

  const hasOverlay = !!(activeMockEntry || (activePracticeEntry && (activePracticeEntry.session.type === "email" || activePracticeEntry.session.type === "discussion")));
  useEffect(() => {
    if (!hasOverlay) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [hasOverlay]);

  // Full-screen overlays
  if (activeMockEntry) {
    return <MockDetailView entry={activeMockEntry} onBack={() => setActiveMockSrcIdx(null)} />;
  }
  if (activePracticeEntry && (activePracticeEntry.session.type === "email" || activePracticeEntry.session.type === "discussion")) {
    return <WritingDetailView entry={activePracticeEntry} onBack={() => setActivePracticeSrcIdx(null)} />;
  }

  return (
    <div style={{ fontFamily: FONT, background: P.bg, height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes mSlideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {/* Top bar */}
      <div style={{ flexShrink: 0, padding: "0 12px", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 48, background: P.surface, borderBottom: `1px solid ${P.border}` }}>
        <BackBtn onClick={onBack} />
        <span style={{ fontSize: 15, fontWeight: 800, color: P.text }}>练习记录</span>
        <span style={{ width: 44 }} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", padding: "10px 0 24px" }}>

        {/* Stat filter chips */}
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 12px 10px", WebkitOverflowScrolling: "touch" }}>
          {statItems.map((item) => {
            const active = filter === item.key;
            return (
              <button key={item.key} onClick={() => { setFilter(item.key); setSelectedWeak(null); }} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, border: `1.5px solid ${active ? item.color : P.border}`, background: active ? `${item.color}12` : P.surface, cursor: "pointer", touchAction: "manipulation", boxShadow: active ? `0 0 0 2px ${item.color}18` : P.shadow, transition: "all 0.15s" }}>
                <span style={{ fontSize: 15 }}>{item.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: active ? item.color : P.text }}>{item.short}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: active ? item.color : P.textDim, background: active ? `${item.color}18` : P.bg, padding: "1px 6px", borderRadius: 999 }}>{item.count}</span>
              </button>
            );
          })}
        </div>

        {/* Mock section */}
        {mockEntries.length > 0 && (
          <div style={{ padding: "0 12px", marginBottom: 12, animation: "mSlideUp 0.35s ease both" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: P.text, marginBottom: 8 }}>🎯 模考记录</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {mockEntries.map((entry) => {
                const s = entry.session;
                const bc = Number.isFinite(s.band) ? getBandColor(s.band) : P.textDim;
                return (
                  <button key={entry.sourceIndex} onClick={() => setActiveMockSrcIdx(entry.sourceIndex)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 12, border: `1px solid ${P.border}`, background: P.surface, boxShadow: P.shadow, cursor: "pointer", touchAction: "manipulation", textAlign: "left", width: "100%" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 3 }}>整套模考</div>
                      <div style={{ fontSize: 11, color: P.textDim }}>{formatLocalDateTime(s.date)}</div>
                      <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                        {s.cefr && <Tag color={P.textSec}>CEFR {s.cefr}</Tag>}
                        {s.scaledScore != null && <Tag color={P.primary} bg={P.primarySoft}>换算 {s.scaledScore}/30</Tag>}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, paddingLeft: 12 }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: bc, lineHeight: 1 }}>{Number.isFinite(s.band) ? s.band.toFixed(1) : "--"}</div>
                      <div style={{ fontSize: 10, color: P.textDim, marginTop: 2 }}>/ 6.0</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Weakness chips */}
        {topWeaknesses.length > 0 && (
          <div style={{ padding: "0 12px", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: P.textSec, marginBottom: 6 }}>薄弱点筛选</div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, WebkitOverflowScrolling: "touch" }}>
              {topWeaknesses.map(([w, count]) => {
                const active = selectedWeak === w;
                return (
                  <button key={w} onClick={() => setSelectedWeak(active ? null : w)} style={{ flexShrink: 0, padding: "5px 10px", borderRadius: 8, border: `1px solid ${active ? P.rose : P.border}`, background: active ? P.roseSoft : P.surface, fontSize: 11, fontWeight: 600, color: active ? P.rose : P.textSec, cursor: "pointer", touchAction: "manipulation", display: "flex", alignItems: "center", gap: 4 }}>
                    {translateGrammarPoint(w)}
                    <span style={{ fontSize: 10, color: active ? P.rose : P.textDim }}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Practice session list */}
        <div style={{ padding: "0 12px", animation: "mSlideUp 0.35s ease 80ms both" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: P.text, marginBottom: 8 }}>练习明细 ({filteredPractice.length})</div>

          {filteredPractice.length === 0 ? (
            <div style={{ padding: "28px 0", textAlign: "center", fontSize: 12, color: P.textDim }}>
              {selectedWeak ? `没有包含「${selectedWeak}」薄弱点的记录。` : "当前筛选下暂无练习记录。"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {filteredPractice.map((entry) => {
                const s = entry.session;
                const tc = TYPE[s.type] || TYPE.bs;
                const isExp = expandedSrcIdx === entry.sourceIndex;
                const isWriting = s.type === "email" || s.type === "discussion";

                return (
                  <div key={entry.sourceIndex} style={{ borderRadius: 12, border: `1px solid ${isExp ? tc.color + "60" : P.border}`, background: P.surface, boxShadow: isExp ? `0 0 0 2px ${tc.color}14` : P.shadow, overflow: "hidden", transition: "all 0.2s" }}>
                    {/* Row header */}
                    <button
                      onClick={() => {
                        if (isWriting) {
                          setActivePracticeSrcIdx(entry.sourceIndex);
                        } else {
                          setExpandedSrcIdx(isExp ? null : entry.sourceIndex);
                        }
                      }}
                      style={{ display: "flex", alignItems: "center", width: "100%", padding: "12px 12px", background: "none", border: "none", cursor: "pointer", touchAction: "manipulation", textAlign: "left", gap: 10, minHeight: 48 }}
                    >
                      <span style={{ fontSize: 18, flexShrink: 0 }}>{tc.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: P.text }}>{tc.label}</div>
                        <div style={{ fontSize: 11, color: P.textDim, marginTop: 1 }}>{formatLocalDateTime(s.date)}</div>
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 800, color: getScoreColor(s), flexShrink: 0 }}>{getScoreLabel(s)}</span>
                      <span style={{ fontSize: 11, color: P.textDim, flexShrink: 0, transform: isExp ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>&#9654;</span>
                    </button>

                    {/* Expanded BS inline detail */}
                    {isExp && s.type === "bs" && (
                      <div style={{ borderTop: `1px solid ${P.borderSubtle}`, padding: "8px 10px 12px" }}>
                        <HistoryRow entry={entry} isExpanded={true} isLast={true} onToggle={() => {}} onDelete={() => handleDelete(entry.sourceIndex)} typeAvgs={typeAvgs} detailOnly={true} />
                        <button onClick={() => { if (window.confirm("删除这条记录？")) handleDelete(entry.sourceIndex); }} style={{ marginTop: 8, padding: "6px 14px", borderRadius: 8, border: `1px solid ${P.borderSubtle}`, background: "none", color: P.textDim, fontSize: 11, fontWeight: 600, cursor: "pointer", touchAction: "manipulation" }}>
                          删除此记录
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Clear all */}
        {entries.length > 0 && (
          <div style={{ padding: "20px 12px 0", display: "flex", justifyContent: "center" }}>
            <button onClick={() => setShowClearConfirm(true)} style={{ background: "none", border: `1px solid ${P.borderSubtle}`, color: P.textDim, padding: "9px 20px", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", touchAction: "manipulation" }}>
              清除全部记录
            </button>
          </div>
        )}
      </div>

      {/* Clear confirm modal */}
      {showClearConfirm && (
        <div onClick={() => setShowClearConfirm(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: P.surface, borderRadius: 16, padding: "24px 20px 20px", width: "100%", maxWidth: 360, boxShadow: "0 -4px 24px rgba(0,0,0,0.12)", animation: "mSlideUp 0.25s ease both" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: P.text, marginBottom: 6 }}>清除全部记录？</div>
            <div style={{ fontSize: 13, color: P.textSec, lineHeight: 1.6, marginBottom: 18 }}>所有练习记录和模考数据将被永久删除，无法恢复。</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowClearConfirm(false)} style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: `1px solid ${P.border}`, background: P.surface, color: P.textSec, fontSize: 14, fontWeight: 600, cursor: "pointer", touchAction: "manipulation" }}>
                取消
              </button>
              <button onClick={confirmClearAll} style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", touchAction: "manipulation" }}>
                确认清除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
