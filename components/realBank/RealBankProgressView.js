"use client";
// 「真题练习记录」页（/real-bank/progress）。
//
// 结构对齐各科历史页的模考记录（ReadingProgressView / ListeningProgressView 的
// 「侧栏最新一次 + 列表 → 右栏完整报告」两栏范式）：
//   左栏：最新一次真题练习 + 题库覆盖（12 题型各练了多少）
//   右栏：概览（四科统计卡 + 得分率趋势 + 练习明细列表）；点任一条 → 整栏切成该条的完整回顾
// 回顾正文**不重写**：写作走 HistoryRow（含 ScoringReport 批注），阅读 / 听力 / 口语直接复用
// 各科历史页导出的 CTWDetail / RDLDetail / LCRDetail / LADetail / LCDetail / RepeatDetail /
// InterviewDetail —— 与常规练习历史逐题回看完全同一套渲染，真题记录不会少字段、不会少解析。
//
// 记录辨认 / 得分口径在 lib/realBankHistory.js（纯函数，与后台真题统计同一判定）。
// 本页 import lib/realBank 只为给每条记录补「来源分档 + 考试日期 + 卷次」（历史里没存这些），
// 这是真题专区自己的路由，与 app/real-bank/page.js 同一份 bundle 代价；首页入口卡不走这里。

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FONT, TopBar, SurfaceCard, ChevronIcon, ModeChip, NEUTRAL } from "../shared/ui";
import { loadHist, deleteSession, SESSION_STORE_EVENTS, setCurrentUser } from "../../lib/sessionStore";
import { getSavedCode } from "../../lib/AuthContext";
import { formatLocalDateTime } from "../../lib/utils";
import { buildDailyAveragePoints } from "../../lib/history/scoreMetrics";
import { relativeDateLabel } from "../../lib/history/dateGroup";
import { StatCard } from "../shared/StatCard";
import { AccuracyTrendChart } from "../shared/AccuracyTrendChart";
import { HistoryRow } from "../history/HistoryRow";
import { WritingFeedbackPanel } from "../writing/WritingFeedbackPanel";
import { buildRetryHref, startRetryFromHistory } from "../../lib/history/retry";
import { CTWDetail, RDLDetail } from "../reading/ReadingProgressView";
import { LCRDetail, LADetail, LCDetail } from "../listening/ListeningProgressView";
import { RepeatDetail, InterviewDetail } from "../speaking/SpeakingProgressView";
import {
  REAL_SUBJECT_META,
  REAL_SUBJECT_ORDER,
  REAL_SUBTYPE_META,
  REAL_SUBTYPE_ORDER,
  buildRealBankCoverage,
  buildRealBankEntries,
  buildRealBankSubjectStats,
  realScoreColor,
  realSessionItemIds,
  realSessionScore,
} from "../../lib/realBankHistory";
import {
  formatExamDate,
  getRealAPItems,
  getRealBSBatches,
  getRealCTWItems,
  getRealDiscussionPrompts,
  getRealEmailPrompts,
  getRealInterviewSets,
  getRealLAItems,
  getRealLATItems,
  getRealLCItems,
  getRealLCRItems,
  getRealRDLItems,
  getRealRepeatSets,
  realTierLabel,
} from "../../lib/realBank";
import { REAL_WRITING_COUNTS } from "../home/realExamCounts";
import REAL_READING_COUNTS from "../../data/realBank/reading/counts.json";
import REAL_LISTENING_COUNTS from "../../data/realBank/listening/counts.json";
import REAL_SPEAKING_COUNTS from "../../data/realBank/speaking/counts.json";

// 与 components/home/sections.js 的 SECTION_ACCENTS["real-bank"] 同色（金琥珀）。
const ACCENT = { color: "#B45309", soft: "#FFF7ED" };
const P = { ...NEUTRAL, primary: ACCENT.color, primarySoft: ACCENT.soft };

// 来源分档 chip 配色：官方绿、回忆版金、参考版灰 —— 与 picker 卡片上的分档语义一致。
const TIER_CHIP = {
  official: { color: "#166534", bg: "#DCFCE7" },
  recalled: { color: "#B45309", bg: "#FFF7ED" },
  legacy: { color: "#4B5563", bg: "#F3F4F6" },
};

// 题库总量（覆盖率分母）：写作三题型是冻结常量，其余读 build_bank 落库时写的 counts.json。
const BANK_TOTALS = {
  bs: REAL_WRITING_COUNTS.bs,
  email: REAL_WRITING_COUNTS.email,
  discussion: REAL_WRITING_COUNTS.discussion,
  ctw: REAL_READING_COUNTS.ctw,
  rdl: REAL_READING_COUNTS.rdl,
  ap: REAL_READING_COUNTS.ap,
  lcr: REAL_LISTENING_COUNTS.lcr,
  lc: REAL_LISTENING_COUNTS.lc,
  la: REAL_LISTENING_COUNTS.la,
  lat: REAL_LISTENING_COUNTS.lat,
  repeat: REAL_SPEAKING_COUNTS.repeat,
  interview: REAL_SPEAKING_COUNTS.interview,
};

/* ── 真题条目索引（id → 来源分档 / 考试日期 / 卷次标签） ─────────── */
// 历史记录里只存了题目 id（real_ 前缀），分档与日期要回题库查。整库只建一次（模块级缓存），
// 12 个题库加起来一千多条，Map 一次建完几毫秒。
let itemIndexCache = null;
function getRealItemIndex() {
  if (itemIndexCache) return itemIndexCache;
  const m = new Map();
  const put = (it, extra) => {
    const id = String(it?.id || "");
    if (!id) return;
    m.set(id, { tier: it?.tier, date: it?.date || "", label: "", ...extra });
  };
  try {
    getRealDiscussionPrompts().forEach((p) => put(p, { label: p.course || "" }));
    getRealEmailPrompts().forEach((p) => put(p, {}));
    getRealBSBatches().forEach((b, i) =>
      b.questions.forEach((q) => put(q, { tier: b.tier, date: b.date, label: `第 ${i + 1} 套 · ${b.label || ""}`.replace(/ · $/, "") })),
    );
    getRealCTWItems().forEach((it) => put(it, { label: it.topic || "" }));
    getRealRDLItems().forEach((it) => put(it, { label: it.topic || it.genre || "" }));
    getRealAPItems().forEach((it) => put(it, { label: it.topic || "" }));
    getRealLCRItems().forEach((it) => put(it, { label: it.speaker || "" }));
    getRealLCItems().forEach((it) => put(it, { label: it.topic || it.context || "" }));
    getRealLAItems().forEach((it) => put(it, { label: it.topic || it.context || "" }));
    getRealLATItems().forEach((it) => put(it, { label: it.topic || it.context || "" }));
    getRealRepeatSets().forEach((s) => put(s, { label: s.scenario || s.topic || "" }));
    getRealInterviewSets().forEach((s) => put(s, { label: s.topic || "" }));
  } catch {
    // 题库某一份坏了不该让记录页白屏：索引缺项只是少显示分档 / 日期。
  }
  itemIndexCache = m;
  return m;
}

function truncate(text, max = 56) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** 一条记录的展示信息：题型元数据、来源分档、考试日期、副标题（题目摘要 / 话题 / 卷次）。 */
function describeEntry(entry, index) {
  const s = entry.session || {};
  const sub = entry.subtype;
  const meta = REAL_SUBTYPE_META[sub] || {};
  const d = s.details;
  const obj = d && typeof d === "object" && !Array.isArray(d) ? d : {};
  const ids = realSessionItemIds(s);
  const info = ids.length > 0 ? index.get(ids[0]) : null;
  // 写作历史里整道题（promptData）都存了，分档 / 日期优先读历史本身（老记录也能显示）。
  const tier = obj.promptData?.tier || info?.tier || (ids.length > 0 && sub !== "bs" && sub !== "email" && sub !== "discussion" ? "recalled" : "");
  const examDate = formatExamDate(obj.promptData?.date || info?.date || "");

  let subtitle = "";
  if (sub === "email" || sub === "discussion") subtitle = obj.promptSummary || info?.label || "";
  else if (sub === "bs") subtitle = info?.label || (Array.isArray(d) ? `${d.length} 题` : "");
  else if (sub === "lcr") subtitle = obj.items?.[0]?.speaker || info?.label || "";
  else subtitle = obj.topic || obj.genre || info?.label || "";

  return { meta, tier, tierLabel: tier ? realTierLabel(tier) : "", examDate, subtitle: truncate(subtitle) };
}

function retryHref(entry) {
  const mode = String(entry?.session?.mode || "").trim();
  const qs = new URLSearchParams();
  qs.set("type", entry.subtype);
  if (mode && mode !== "standard") qs.set("mode", mode);
  return `/real-bank?${qs.toString()}`;
}

/* ── 小件 ─────────────────────────────────────────────────────────── */

function TierChip({ tier, label }) {
  if (!label) return null;
  const c = TIER_CHIP[tier] || TIER_CHIP.legacy;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "1px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700, lineHeight: 1.5, color: c.color, background: c.bg, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function DeleteIcon({ onClick }) {
  return (
    <span role="button" tabIndex={0} title="删除" aria-label="删除记录"
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onClick?.(); } }}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 6, color: P.textDim, cursor: "pointer", transition: "all 0.15s", flexShrink: 0 }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "#dc2626"; e.currentTarget.style.background = "#dc262612"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = P.textDim; e.currentTarget.style.background = "transparent"; }}
    >
      <svg viewBox="0 0 16 16" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M2.5 4.5h11M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M6.5 7v4.5M9.5 7v4.5M3.5 4.5l.5 8.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l.5-8.5" />
      </svg>
    </span>
  );
}

/* ── 侧栏：最新一次 ───────────────────────────────────────────────── */

function LatestCard({ entry, index, onOpen }) {
  if (!entry) return null;
  const { meta, tierLabel, tier } = describeEntry(entry, index);
  const score = realSessionScore(entry.session);
  const sc = realScoreColor(score.pct);
  return (
    <button
      data-testid="real-latest-card"
      onClick={onOpen}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", textAlign: "left", cursor: "pointer",
        background: `linear-gradient(135deg, ${ACCENT.soft} 0%, #fffbeb 100%)`, borderRadius: 14, border: `1px solid ${ACCENT.color}22`, marginBottom: 14, fontFamily: FONT,
      }}
    >
      <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#fff", border: `3px solid ${sc}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontSize: score.label.length > 4 ? 11 : 13, fontWeight: 800, color: sc, fontVariantNumeric: "tabular-nums" }}>{score.label}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: P.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>最近一次真题练习</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: P.text, marginBottom: 3 }}>{meta.icon} {meta.label}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <TierChip tier={tier} label={tierLabel} />
          <span style={{ fontSize: 10, color: P.textDim }}>{new Date(entry.session.date).toLocaleDateString("zh-CN")}</span>
        </div>
      </div>
      <span style={{ fontSize: 12, color: ACCENT.color, flexShrink: 0 }}>→</span>
    </button>
  );
}

/* ── 侧栏：题库覆盖 ───────────────────────────────────────────────── */

function CoverageCard({ coverage }) {
  const [open, setOpen] = useState(true);
  const doneTotal = coverage.reduce((s, c) => s + c.done, 0);
  const bankTotal = coverage.reduce((s, c) => s + c.total, 0);
  return (
    <div data-testid="real-coverage-card" style={{ background: P.surface, borderRadius: 12, border: `1px solid ${P.border}`, overflow: "hidden", marginBottom: 16 }}>
      <button onClick={() => setOpen(!open)}
        style={{ width: "100%", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", background: P.bg, border: "none", borderBottom: open ? `1px solid ${P.borderSubtle}` : "none", cursor: "pointer", fontFamily: FONT }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: P.text }}>📜 题库覆盖 ({doneTotal}/{bankTotal})</span>
        <span style={{ fontSize: 11, color: P.textDim }}>{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div style={{ padding: "6px 14px 10px", animation: "expandDown 0.3s cubic-bezier(0.16,1,0.3,1)" }}>
          {REAL_SUBJECT_ORDER.map((subj) => (
            <div key={subj} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: P.textDim, letterSpacing: "0.04em", marginBottom: 4 }}>{REAL_SUBJECT_META[subj].label}</div>
              {coverage.filter((c) => c.subject === subj).map((c) => {
                const m = REAL_SUBTYPE_META[c.subtype];
                return (
                  <div key={c.subtype} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                    <span style={{ width: 30, fontSize: 11, color: P.textSec, flexShrink: 0 }}>{m.short}</span>
                    <div style={{ flex: 1, height: 5, borderRadius: 3, background: `${m.color}14`, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${c.pct ?? 0}%`, background: m.color, borderRadius: 3, transition: "width 0.5s" }} />
                    </div>
                    <span style={{ width: 58, textAlign: "right", fontSize: 10.5, color: c.done > 0 ? P.text : P.textDim, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                      {c.done}/{c.total || "?"} {m.unit}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 列表行 ───────────────────────────────────────────────────────── */

function EntryRow({ entry, index, onOpen, onDelete }) {
  const s = entry.session;
  const { meta, tier, tierLabel, examDate, subtitle } = describeEntry(entry, index);
  const score = realSessionScore(s);
  const sc = realScoreColor(score.pct, P.textSec);
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="real-entry-row"
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "none", border: "none", cursor: "pointer", transition: "all 0.15s", borderRadius: 10, textAlign: "left", fontFamily: FONT }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "#faf9f7"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ width: 34, height: 34, borderRadius: 10, background: `${meta.color}12`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: meta.color, flexShrink: 0 }}>{meta.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: P.text, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span>{meta.label}</span>
          <TierChip tier={tier} label={tierLabel} />
          <ModeChip mode={s.mode} />
          {examDate ? <span style={{ fontSize: 10.5, color: P.textDim, fontWeight: 500 }}>考试 {examDate}</span> : null}
        </div>
        <div style={{ fontSize: 11, color: P.textDim, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
          <span>{formatLocalDateTime(s.date)}</span>
          {subtitle ? <span style={{ color: P.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>{subtitle}</span> : null}
        </div>
      </div>
      <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13, fontWeight: 750, color: sc, background: `${sc}0C`, padding: "3px 10px", borderRadius: 8, whiteSpace: "nowrap" }}>{score.label}</span>
      <ChevronIcon open={false} color={P.textDim} />
      <DeleteIcon onClick={onDelete} />
    </div>
  );
}

/* ── 完整回顾（右栏） ──────────────────────────────────────────────── */

function RealSessionBody({ entry, onClose }) {
  const s = entry.session;
  const sub = entry.subtype;
  // 写作（讨论 / 邮件）：与主练习记录页（ProgressView）和模考报告同一套 WritingFeedbackPanel ——
  // 左栏原文逐句批注、右栏「宏观评价与建议 / 逐句批注大纲 / 范文对比分析」三标签。
  // 评分失败（feedback 为空）的记录退回 HistoryRow，它会把作答文本和「没有评分反馈」说清楚。
  if (sub === "email" || sub === "discussion") {
    const fb = s.details?.feedback || null;
    if (!fb) return <HistoryRow entry={{ session: s, sourceIndex: entry.sourceIndex }} isExpanded detailOnly />;
    const retry = buildRetryHref(s);
    return (
      <div data-testid="real-writing-report" style={{ borderLeft: `3px solid ${REAL_SUBTYPE_META[sub].color}`, borderRadius: 12, overflow: "hidden" }}>
        <WritingFeedbackPanel
          key={entry.sourceIndex}
          fb={fb}
          type={sub}
          pd={s.details?.promptData || null}
          userText={s.details?.userText || ""}
          containerHeight="720px"
          onRetry={retry ? () => startRetryFromHistory(s) : null}
          onNext={null}
          onExit={onClose}
        />
      </div>
    );
  }
  if (sub === "bs") {
    return <HistoryRow entry={{ session: s, sourceIndex: entry.sourceIndex }} isExpanded detailOnly />;
  }
  if (sub === "ctw") return <CTWDetail session={s} />;
  if (sub === "rdl" || sub === "ap") return <RDLDetail session={s} />;
  if (sub === "lcr") return <LCRDetail session={s} />;
  if (sub === "lc") return <LCDetail session={s} />;
  if (sub === "la" || sub === "lat") return <LADetail session={s} />;
  if (sub === "repeat") return <RepeatDetail session={s} />;
  if (sub === "interview") return <InterviewDetail session={s} />;
  return <div style={{ fontSize: 12, color: P.textDim }}>这条记录缺少可展示的详情。</div>;
}

function RealSessionDetail({ entry, index, onClose, onDelete }) {
  const s = entry.session;
  const sub = entry.subtype;
  const { meta, tier, tierLabel, examDate, subtitle } = describeEntry(entry, index);
  const score = realSessionScore(s);
  const sc = realScoreColor(score.pct, P.textSec);
  const [confirm, setConfirm] = useState(false);

  return (
    <div data-testid="real-session-detail" style={{ animation: "slideInRight 0.4s cubic-bezier(0.16,1,0.3,1)" }}>
      <SurfaceCard style={{ padding: "18px 22px", marginBottom: 14, boxShadow: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button onClick={onClose} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: `1px solid ${P.border}`, background: P.surface, color: P.textSec, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
            ← 返回列表
          </button>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: P.text, letterSpacing: "-0.02em" }}>{meta.icon} {meta.label}</span>
              <TierChip tier={tier} label={tierLabel} />
              <ModeChip mode={s.mode} />
            </div>
            <div style={{ fontSize: 11.5, color: P.textDim, marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span>{formatLocalDateTime(s.date)}</span>
              {examDate ? <span>考试日期 {examDate}</span> : null}
              {subtitle ? <span style={{ color: P.textSec }}>{subtitle}</span> : null}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#fff", border: `3px solid ${sc}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: score.label.length > 4 ? 11 : 13, fontWeight: 800, color: sc, fontVariantNumeric: "tabular-nums" }}>{score.label}</span>
            </div>
            <Link href={retryHref(entry)} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${ACCENT.color}55`, background: ACCENT.soft, color: ACCENT.color, fontSize: 12, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
              再练一套
            </Link>
            {!confirm ? (
              <button onClick={() => setConfirm(true)} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${P.border}`, background: P.surface, color: P.textDim, fontSize: 12, cursor: "pointer", fontFamily: FONT }}>
                删除
              </button>
            ) : (
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <button onClick={onDelete} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>确认删除</button>
                <button onClick={() => setConfirm(false)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${P.border}`, background: P.surface, color: P.textSec, fontSize: 12, cursor: "pointer", fontFamily: FONT }}>取消</button>
              </span>
            )}
          </div>
        </div>
      </SurfaceCard>
      <SurfaceCard style={{ padding: "18px 22px", boxShadow: "none" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: P.textSec, marginBottom: 12, letterSpacing: "0.02em" }}>
          {sub === "email" || sub === "discussion" ? "批改报告" : "逐题回顾"}
        </div>
        <RealSessionBody entry={entry} onClose={onClose} />
      </SurfaceCard>
    </div>
  );
}

/* ── 主视图 ───────────────────────────────────────────────────────── */

export function RealBankProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [activeIdx, setActiveIdx] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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

  const index = useMemo(() => getRealItemIndex(), []);
  const entries = useMemo(() => buildRealBankEntries(hist?.sessions), [hist]);
  const coverage = useMemo(() => buildRealBankCoverage(entries, BANK_TOTALS), [entries]);
  const subjectStats = useMemo(() => buildRealBankSubjectStats(entries), [entries]);

  const bySubject = useMemo(
    () => (subjectFilter === "all" ? entries : entries.filter((e) => REAL_SUBTYPE_META[e.subtype].subject === subjectFilter)),
    [entries, subjectFilter],
  );
  const typesPresent = useMemo(() => REAL_SUBTYPE_ORDER.filter((t) => bySubject.some((e) => e.subtype === t)), [bySubject]);
  const filtered = useMemo(
    () => (typeFilter === "all" ? bySubject : bySubject.filter((e) => e.subtype === typeFilter)),
    [bySubject, typeFilter],
  );
  const trendPts = useMemo(
    () => buildDailyAveragePoints(filtered.map((e) => e.session), (s) => realSessionScore(s).pct),
    [filtered],
  );

  const activeEntry = entries.find((e) => e.sourceIndex === activeIdx) || null;

  function pickSubject(subj) {
    setSubjectFilter(subj);
    setTypeFilter("all");
    setActiveIdx(null);
  }

  function handleDelete(sourceIndex) {
    deleteSession(sourceIndex);
    setHist(loadHist());
    if (activeIdx === sourceIndex) setActiveIdx(null);
  }

  function confirmClearAll() {
    setShowClearConfirm(false);
    // 逐条删（只删真题记录，不动常规练习 / 模考历史）。
    entries.forEach((e) => deleteSession(e.sourceIndex));
    setHist(loadHist());
    setActiveIdx(null);
  }

  const totalAvg = (() => {
    const vals = entries.map((e) => realSessionScore(e.session).pct).filter(Number.isFinite);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  })();

  if (!hist) {
    return (
      <div style={{ minHeight: "100vh", background: P.bg, fontFamily: FONT }}>
        <TopBar title="真题练习记录" section="Real Questions" onExit={onBack} />
        <div style={{ textAlign: "center", padding: "60px 0", color: P.textDim }}>加载中...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: P.bg, fontFamily: FONT }}>
      <style>{`
        @keyframes fadeUpReal { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes slideInRight { from { opacity:0; transform:translateX(24px) scale(0.99); } to { opacity:1; transform:translateX(0) scale(1); } }
        @keyframes slideInLeft { from { opacity:0; transform:translateX(-16px); } to { opacity:1; transform:translateX(0); } }
        @keyframes expandDown { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
        @media (max-width: 960px) {
          .rbp-layout { flex-direction: column !important; gap: 16px !important; }
          .rbp-sidebar { width: 100% !important; position: static !important; }
          .rbp-stats { flex-direction: column !important; }
          .rbp-stats-grid { flex: 1 1 auto !important; }
        }
      `}</style>

      <TopBar title="真题练习记录" section="Real Questions" onExit={onBack} />

      {entries.length === 0 ? (
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
          <SurfaceCard style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 8 }}>还没有真题练习记录</div>
            <div style={{ fontSize: 12, color: P.textDim, marginBottom: 16 }}>在真题专区完成任意一道题后，记录会自动保存在这里（含逐题回顾）。</div>
            <Link href="/?section=real-bank" style={{ display: "inline-block", padding: "9px 18px", borderRadius: 8, background: ACCENT.color, color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
              去真题专区
            </Link>
          </SurfaceCard>
        </div>
      ) : (
        <div className="rbp-layout" style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 24px 60px", display: "flex", gap: 24, alignItems: "flex-start" }}>
          {/* 左栏：标题 + 最近一次 + 题库覆盖 */}
          <aside className="rbp-sidebar" style={{ width: 320, flexShrink: 0, position: "sticky", top: 68, animation: "fadeUpReal 0.5s cubic-bezier(0.25,1,0.5,1) 60ms both" }}>
            <div style={{ marginBottom: 16 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: P.text, letterSpacing: "-0.03em", lineHeight: 1.2, margin: "0 0 6px" }}>真题练习记录</h1>
              <p style={{ fontSize: 12, color: P.textDim, lineHeight: 1.6, margin: 0 }}>
                共 {entries.length} 次{totalAvg != null ? ` · 平均得分率 ${totalAvg}%` : ""}。点击任一条记录查看逐题回顾。
              </p>
            </div>
            <LatestCard entry={entries[0]} index={index} onOpen={() => setActiveIdx(entries[0].sourceIndex)} />
            <CoverageCard coverage={coverage} />
          </aside>

          {/* 右栏：完整回顾 或 概览 */}
          <main style={{ flex: 1, minWidth: 0, animation: "fadeUpReal 0.5s cubic-bezier(0.25,1,0.5,1) 120ms both" }}>
            {activeEntry ? (
              <RealSessionDetail
                key={activeEntry.sourceIndex}
                entry={activeEntry}
                index={index}
                onClose={() => setActiveIdx(null)}
                onDelete={() => handleDelete(activeEntry.sourceIndex)}
              />
            ) : (
              <div key="overview" style={{ animation: "slideInLeft 0.35s cubic-bezier(0.16,1,0.3,1)" }}>
                {/* 四科统计卡 + 趋势 */}
                <div className="rbp-stats" style={{ display: "flex", gap: 14, marginBottom: 18, alignItems: "stretch" }}>
                  <div className="rbp-stats-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flex: "0 0 52%" }}>
                    {subjectStats.map((st) => {
                      const m = REAL_SUBJECT_META[st.subject];
                      return (
                        <StatCard
                          key={st.subject}
                          icon={m.icon}
                          short={m.label}
                          count={st.count}
                          avg={st.avgPct != null ? `得分率 ${st.avgPct}%` : st.count > 0 ? "暂无分数" : "暂无"}
                          color={m.color}
                          active={subjectFilter === st.subject}
                          onClick={() => pickSubject(subjectFilter === st.subject ? "all" : st.subject)}
                        />
                      );
                    })}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, padding: "12px 14px 8px", background: P.surface, borderRadius: 14, border: `1px solid ${P.borderSubtle}`, display: "flex", flexDirection: "column" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: P.textSec, marginBottom: 4 }}>
                      得分率趋势{subjectFilter !== "all" ? ` · ${REAL_SUBJECT_META[subjectFilter].label}` : ""}
                    </div>
                    <div style={{ flex: 1, minHeight: 0 }}>
                      <AccuracyTrendChart pts={trendPts} accentColor={ACCENT.color} ticks={[0, 50, 100]} maxValue={100} tickSuffix="%" />
                    </div>
                  </div>
                </div>

                {/* 练习明细 */}
                <div style={{ background: P.surface, borderRadius: 16, border: `1px solid ${P.borderSubtle}`, overflow: "hidden" }}>
                  <div style={{ padding: "14px 18px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 750, color: P.text, letterSpacing: "-0.02em" }}>练习明细</span>
                    <span style={{ fontSize: 11, fontWeight: 550, color: ACCENT.color, background: `${ACCENT.color}0C`, padding: "3px 10px", borderRadius: 999 }}>{filtered.length} 条记录</span>
                  </div>
                  {typesPresent.length > 1 && (
                    <div data-testid="real-type-filter" style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 18px 10px" }}>
                      {[{ key: "all", label: "全部" }, ...typesPresent.map((t) => ({ key: t, label: REAL_SUBTYPE_META[t].short, color: REAL_SUBTYPE_META[t].color }))].map((opt) => {
                        const selected = typeFilter === opt.key;
                        const color = opt.color || ACCENT.color;
                        return (
                          <button key={opt.key} onClick={() => setTypeFilter(opt.key)}
                            style={{ padding: "4px 11px", borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: FONT, border: `1px solid ${selected ? `${color}55` : P.borderSubtle}`, background: selected ? `${color}14` : P.surface, color: selected ? color : P.textSec }}>
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ padding: "4px 14px 14px" }}>
                    {filtered.length === 0 ? (
                      <div style={{ padding: "24px 0", textAlign: "center", fontSize: 12, color: P.textDim }}>该分类暂无记录</div>
                    ) : (() => {
                      let lastLabel = "";
                      return filtered.map((entry, i) => {
                        const label = relativeDateLabel(new Date(entry.session.date));
                        const showHeader = label !== lastLabel;
                        lastLabel = label;
                        return (
                          <React.Fragment key={entry.sourceIndex}>
                            {showHeader && (
                              <div style={{ padding: "10px 6px 4px", fontSize: 11, fontWeight: 650, color: P.textDim, letterSpacing: "0.02em", borderTop: i === 0 ? "none" : `1px solid ${P.borderSubtle}`, marginTop: i === 0 ? 0 : 4 }}>
                                {label}
                              </div>
                            )}
                            <EntryRow
                              entry={entry}
                              index={index}
                              onOpen={() => setActiveIdx(entry.sourceIndex)}
                              onDelete={() => handleDelete(entry.sourceIndex)}
                            />
                          </React.Fragment>
                        );
                      });
                    })()}
                  </div>
                </div>

                {/* 清空 */}
                <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
                  {!showClearConfirm ? (
                    <button onClick={() => setShowClearConfirm(true)}
                      style={{ background: "none", border: `1px solid ${P.borderSubtle}`, color: P.textDim, padding: "8px 18px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
                      清空全部真题记录
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>确认清空？只删真题记录，不影响常规练习和模考。</span>
                      <button onClick={confirmClearAll} style={{ background: "#dc2626", color: "#fff", border: "none", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: FONT }}>确认</button>
                      <button onClick={() => setShowClearConfirm(false)} style={{ background: P.surface, border: `1px solid ${P.border}`, color: P.textSec, padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: FONT }}>取消</button>
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
