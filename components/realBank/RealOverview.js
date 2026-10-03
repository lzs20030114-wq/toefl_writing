"use client";
// 「真题练习记录」概览页（设计稿「真题练习记录 优化版」· 概览）。
//
// 一张整合的摘要卡（整体得分率 / 得分率趋势 / 最近一次）+ 科目条（点选筛科目）+ 可折叠的题库覆盖条，
// 下面是「练习明细」：按日分组（可折叠）、点一行就地展开「错题速览」，再决定进入逐题回顾 / 再练 / 删除。
// 纯展示 + 本页内的展开状态；筛选条件、删除、重试评分都由父组件（RealBankProgressView）持有。

import React, { useState } from "react";
import Link from "next/link";
import { ModeChip } from "../shared/ui";
import {
  REAL_SUBJECT_META,
  REAL_SUBJECT_ORDER,
  REAL_SUBTYPE_META,
  realScoreColor,
  realSessionScore,
} from "../../lib/realBankHistory";
import { buildDailyAveragePoints } from "../../lib/history/scoreMetrics";
import { averagePct, buildPreview, groupEntriesByDay, rowTimeLabel, stripUnits, whenLabel } from "../../lib/realBankReview";
import { ACCENT, describeEntry, retryHref } from "./realBankMeta";
import { Chev, IconBox, LV, ScoreRing, TierBadge, hoverStyle } from "./realBankUi";

const A = ACCENT.color;

function TrendChart({ points }) {
  const n = points.length;
  const x0 = 40;
  const x1 = 412;
  const y = (v) => 90 - v * 0.8;
  const xs = (i) => (n <= 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1));
  const dots = points.map((p, i) => ({ cx: xs(i).toFixed(1), cy: y(p.avg).toFixed(1), c: realScoreColor(p.avg, "#94a39a") }));
  const lab = (key) => { const [, m, d] = String(key).split("-"); return `${+m}/${+d}`; };
  const line = dots.map((d) => `${d.cx},${d.cy}`).join(" ");
  const area = n > 1 ? `M${dots[0].cx},90 ${dots.map((d) => `L${d.cx},${d.cy}`).join(" ")} L${dots[n - 1].cx},90 Z` : "";
  return (
    <svg viewBox="0 0 420 110" width="100%" style={{ display: "block" }} data-testid="real-trend-chart">
      <line x1="40" x2="412" y1="10" y2="10" stroke="#ebf0ed" />
      <line x1="40" x2="412" y1="50" y2="50" stroke="#ebf0ed" strokeDasharray="3 3" />
      <line x1="40" x2="412" y1="90" y2="90" stroke="#dde5df" />
      <text x="32" y="13" textAnchor="end" fontSize="9" fill="#94a39a">100%</text>
      <text x="32" y="53" textAnchor="end" fontSize="9" fill="#94a39a">50%</text>
      <text x="32" y="93" textAnchor="end" fontSize="9" fill="#94a39a">0%</text>
      {area ? <path d={area} fill={A} fillOpacity="0.07" /> : null}
      {n > 1 ? <polyline points={line} fill="none" stroke={A} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /> : null}
      {dots.map((d, i) => <circle key={i} cx={d.cx} cy={d.cy} r="3.4" fill="#fff" stroke={d.c} strokeWidth="1.8" />)}
      {n ? <text x="40" y="106" fontSize="9" fill="#94a39a">{lab(points[0].date)}</text> : null}
      {n > 1 ? <text x="412" y="106" textAnchor="end" fontSize="9" fill="#94a39a">{lab(points[n - 1].date)}</text> : null}
    </svg>
  );
}

function SummaryCard({ all, bySubject, list, subject, onSubject, coverage, covOpen, onToggleCov, index, onOpen }) {
  const avgAll = averagePct(bySubject);
  const subjSuffix = subject === "all" ? "" : ` · ${REAL_SUBJECT_META[subject].label}`;
  const unscored = bySubject.filter((e) => !Number.isFinite(realSessionScore(e.session).pct)).length;
  const points = buildDailyAveragePoints(list.map((e) => e.session), (s) => realSessionScore(s).pct);

  const latest = all[0];
  const lm = latest ? describeEntry(latest, index) : null;
  const lscore = latest ? realSessionScore(latest.session) : null;
  const lsc = lscore ? realScoreColor(lscore.pct, "#5a6b62") : "#5a6b62";

  const covDone = coverage.reduce((s, c) => s + c.done, 0);
  const covTotal = coverage.reduce((s, c) => s + c.total, 0);
  const covPct = covTotal > 0 ? `${Math.round((covDone / covTotal) * 1000) / 10}%` : "—";

  const subjectCells = [["all", { label: "全部", icon: "📊", color: A }], ...REAL_SUBJECT_ORDER.map((k) => [k, REAL_SUBJECT_META[k]])].map(([k, S]) => {
    const rs = k === "all" ? all : all.filter((e) => REAL_SUBTYPE_META[e.subtype].subject === k);
    return { k, S, count: rs.length, avg: averagePct(rs), on: subject === k };
  });

  return (
    <section style={{ background: "#fff", border: "1px solid #dde5df", borderRadius: 14, boxShadow: "0 1px 3px rgba(10,40,25,0.04)", overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 190px", padding: "18px 20px", borderRight: "1px solid #ebf0ed", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a39a", letterSpacing: ".08em" }}>整体得分率{subjSuffix}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: -1, lineHeight: 1, color: realScoreColor(avgAll, "#1a2420") }}>{avgAll != null ? avgAll : "—"}</span>
            <span style={{ fontSize: 13, color: "#94a39a", fontWeight: 600 }}>{avgAll != null ? "%" : ""}</span>
          </div>
          <div style={{ fontSize: 12, color: "#5a6b62", lineHeight: 1.5 }}>{bySubject.length} 次练习 · {unscored} 次未评分</div>
        </div>
        <div style={{ flex: "2 1 360px", padding: "14px 18px 8px", borderRight: "1px solid #ebf0ed", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#5a6b62" }}>得分率趋势{subjSuffix}</span>
            <span style={{ fontSize: 10.5, color: "#94a39a" }}>按天平均</span>
          </div>
          <TrendChart points={points} />
        </div>
        {latest ? (
          <button data-testid="real-latest-card" onClick={() => onOpen(latest)}
            style={{ flex: "1 1 250px", minWidth: 0, display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", border: "none", background: `linear-gradient(135deg,${ACCENT.soft} 0%,#fffbeb 100%)`, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
            {...hoverStyle({ filter: "brightness(0.985)" })}>
            <ScoreRing pct={lscore.pct} label={lscore.label} color={lsc} fill="#fff" track="#f3e6d6" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a39a", letterSpacing: ".08em", marginBottom: 4 }}>最近一次真题练习</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#1a2420" }}>{lm.meta.icon} {lm.meta.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <TierBadge tier={lm.tier} label={lm.tierLabel} />
                <span style={{ fontSize: 10.5, color: "#94a39a" }}>{whenLabel(latest.session.date)}</span>
              </div>
            </div>
            <span style={{ fontSize: 12, color: A, fontWeight: 700 }}>→</span>
          </button>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", borderTop: "1px solid #ebf0ed" }}>
        {subjectCells.map(({ k, S, count, avg, on }) => (
          <button key={k} data-testid={`real-subject-${k}`} onClick={() => onSubject(on && k !== "all" ? "all" : k)}
            style={{ position: "relative", display: "flex", flexDirection: "column", gap: 7, padding: "12px 16px 13px", border: "none", borderRight: "1px solid #ebf0ed", background: on ? `${S.color}0A` : "#fff", cursor: "pointer", textAlign: "left", transition: "background .2s", fontFamily: "inherit" }}
            {...hoverStyle({ background: on ? `${S.color}0A` : "#fafcfb" })}>
            <span style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, background: on ? S.color : "transparent" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13 }}>{S.icon}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: on ? S.color : "#1a2420" }}>{S.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 800, letterSpacing: -.4, fontVariantNumeric: "tabular-nums", color: on ? S.color : "#1a2420" }}>{count}</span>
            </div>
            <div style={{ height: 3, borderRadius: 2, background: `${S.color}14`, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${avg || 0}%`, background: on ? S.color : `${S.color}70`, borderRadius: 2, transition: "width .5s" }} />
            </div>
            <span style={{ fontSize: 10.5, color: on ? S.color : "#94a39a", fontWeight: 600 }}>{avg != null ? `得分率 ${avg}%` : count ? "暂无分数" : "暂无记录"}</span>
          </button>
        ))}
      </div>

      <div data-testid="real-coverage-card" style={{ borderTop: "1px solid #ebf0ed" }}>
        <button onClick={onToggleCov} aria-expanded={covOpen}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "11px 18px", border: "none", background: "#fafbfa", cursor: "pointer", textAlign: "left", flexWrap: "wrap", fontFamily: "inherit" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#1a2420" }}>📜 题库覆盖</span>
          <span style={{ fontSize: 12, color: "#5a6b62", fontVariantNumeric: "tabular-nums" }}>{covDone} / {covTotal} 题 · {covPct}</span>
          <span style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {REAL_SUBJECT_ORDER.map((k) => {
              const cs = coverage.filter((c) => c.subject === k);
              const on = subject === k;
              return (
                <span key={k} style={{ fontSize: 11, color: on ? REAL_SUBJECT_META[k].color : "#5a6b62", fontVariantNumeric: "tabular-nums", fontWeight: on ? 700 : 500 }}>
                  {REAL_SUBJECT_META[k].label} {cs.reduce((s, c) => s + c.done, 0)}/{cs.reduce((s, c) => s + c.total, 0)}
                </span>
              );
            })}
          </span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#94a39a" }}>
            {covOpen ? "收起" : "按题型展开"}<Chev open={covOpen} />
          </span>
        </button>
        <div style={{ display: "grid", gridTemplateRows: covOpen ? "1fr" : "0fr", transition: "grid-template-rows .32s cubic-bezier(0.25,1,0.5,1)" }}>
          <div style={{ minHeight: 0, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "4px 24px", padding: "6px 18px 16px", borderTop: "1px solid #ebf0ed" }}>
              {REAL_SUBJECT_ORDER.map((k) => {
                const S = REAL_SUBJECT_META[k];
                const rows = coverage.filter((c) => c.subject === k);
                const on = subject === k;
                return (
                  <div key={k} style={{ padding: "8px 10px", borderRadius: 10, background: on ? `${S.color}0A` : "transparent" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: S.color }}>{S.label}</span>
                      <span style={{ fontSize: 10.5, color: "#94a39a", fontVariantNumeric: "tabular-nums" }}>{rows.reduce((s, c) => s + c.done, 0)}/{rows.reduce((s, c) => s + c.total, 0)}</span>
                    </div>
                    {rows.map((c) => {
                      const m = REAL_SUBTYPE_META[c.subtype];
                      return (
                        <div key={c.subtype} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                          <span style={{ width: 30, fontSize: 11, color: "#5a6b62", flexShrink: 0 }}>{m.short}</span>
                          <div style={{ flex: 1, height: 5, borderRadius: 3, background: `${m.color}1A`, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${c.done && c.total ? Math.max(3, (c.done / c.total) * 100) : 0}%`, background: m.color, borderRadius: 3 }} />
                          </div>
                          <span style={{ width: 64, textAlign: "right", fontSize: 10.5, color: c.done ? "#1a2420" : "#94a39a", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{c.done}/{c.total || "?"} {m.unit}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function EntryRow({ entry, index, model, expanded, onToggle, onOpen, onDelete, onRescore, rescoring, rescoreError, canRescore }) {
  const [confirming, setConfirming] = useState(false);
  const s = entry.session;
  const info = describeEntry(entry, index);
  const sc = realScoreColor(model.score.pct, "#5a6b62");
  const strip = stripUnits(s, model);
  const pv = buildPreview(model);
  const rowTime = rowTimeLabel(s.date);

  return (
    <div data-testid="real-entry-row" data-expanded={expanded ? "1" : "0"}
      style={{ borderRadius: 12, background: expanded ? "#fcfdfc" : "transparent", border: `1px solid ${expanded ? "#dde5df" : "transparent"}`, boxShadow: expanded ? "0 2px 10px rgba(10,40,25,0.05)" : "none", transition: "background .2s,border-color .2s" }}>
      <div role="button" tabIndex={0} onClick={onToggle} aria-expanded={expanded}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", cursor: "pointer", borderRadius: 12, flexWrap: "wrap" }}
        {...hoverStyle({ background: "#faf9f7" })}>
        <IconBox meta={info.meta} />
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: expanded ? 750 : 620 }}>{info.meta.label}</span>
            <TierBadge tier={info.tier} label={info.tierLabel} />
            {s.details?.realMock ? null : <ModeChip mode={s.mode} />}
            {info.examDate ? <span style={{ fontSize: 10.5, color: "#94a39a" }}>考试 {info.examDate}</span> : null}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 3, fontSize: 11, color: "#94a39a", fontVariantNumeric: "tabular-nums", minWidth: 0 }}>
            <span style={{ whiteSpace: "nowrap" }}>{rowTime}{info.duration ? ` · 用时 ${info.duration}` : ""}</span>
            <span style={{ color: "#5a6b62", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{info.subtitle}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }} aria-hidden="true">
          {strip.slice(0, 14).map((u, i) => <span key={i} style={{ width: 6, height: 16, borderRadius: 2, background: LV[u.lv].c + (u.lv === "ok" ? "99" : "") }} />)}
          {strip.length > 14 ? <span style={{ fontSize: 10, color: "#94a39a", marginLeft: 3 }}>+{strip.length - 14}</span> : null}
        </div>
        <span style={{ minWidth: 56, textAlign: "center", fontVariantNumeric: "tabular-nums", fontSize: 13, fontWeight: 750, color: sc, background: `${sc}12`, padding: "3px 10px", borderRadius: 8, whiteSpace: "nowrap" }}>{model.score.label}</span>
        <Chev open={expanded} size={14} />
      </div>

      {expanded ? (
        <div style={{ margin: "0 12px 12px 58px", paddingTop: 12, borderTop: "1px dashed #e3e9e5", display: "flex", gap: 18, flexWrap: "wrap", animation: "rbFadeUp .22s ease both" }}>
          <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a39a", letterSpacing: ".06em", marginBottom: 2 }}>{pv.title}</div>
            {pv.items.map((u) => (
              <button key={u.idx} onClick={() => onOpen(entry, u.idx)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", textAlign: "left", minWidth: 0, fontFamily: "inherit" }}
                {...hoverStyle({ background: "#f4f7f5" })}>
                <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: LV[u.lv].c, background: LV[u.lv].bg, borderRadius: 6, padding: "2px 7px" }}>{u.label}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#1a2420", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.text}</span>
                <span style={{ flexShrink: 0, fontSize: 11, color: "#5a6b62", whiteSpace: "nowrap" }}>{u.hint}</span>
              </button>
            ))}
            {pv.more ? <span style={{ fontSize: 11, color: "#94a39a", padding: "2px 8px" }}>还有 {pv.moreCount} 项，进入逐题回顾查看</span> : null}
            {pv.none ? <span style={{ fontSize: 12.5, color: pv.noneKind === "unscored" ? "#92400e" : "#059669", padding: "4px 8px" }}>{pv.noneText}</span> : null}
            {canRescore ? (
              <button onClick={onRescore} disabled={rescoring}
                style={{ alignSelf: "flex-start", marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: `1px solid ${A}55`, background: ACCENT.soft, color: A, fontSize: 12, fontWeight: 700, cursor: rescoring ? "default" : "pointer", fontFamily: "inherit" }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={A} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" /><path d="M13.5 2.5v3h-3" /></svg>
                {rescoring ? "评分中…" : rescoreError ? "再试一次" : "重试评分"}
              </button>
            ) : null}
            {canRescore && rescoreError && !rescoring ? <span role="alert" style={{ fontSize: 11.5, color: LV.bad.c, padding: "0 8px" }}>重新评分失败：{rescoreError}</span> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "0 0 150px" }}>
            <button onClick={() => onOpen(entry)}
              style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: A, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
              {...hoverStyle({ background: "#92400E" })}>{pv.cta} →</button>
            <Link href={retryHref(entry)}
              style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${A}55`, background: ACCENT.soft, color: A, fontSize: 12, fontWeight: 700, textAlign: "center", textDecoration: "none", whiteSpace: "nowrap" }}>再练一套</Link>
            {!confirming ? (
              <button aria-label="删除记录" onClick={() => setConfirming(true)}
                style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #ebf0ed", background: "#fff", color: "#94a39a", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                {...hoverStyle({ color: "#dc2626", borderColor: "#fecaca" })}>删除记录</button>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={onDelete} style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>确认删除</button>
                <button onClick={() => setConfirming(false)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #dde5df", background: "#fff", color: "#5a6b62", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>取消</button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RealOverview({
  entries, index, models, coverage, subject, type, onSubject, onType, groupsClosed, onToggleGroup, covOpen, onToggleCov,
  onOpen, onDelete, onClearAll, onRescore, rescoring, rescoreError, canRescoreEntry, subtypeOrder,
}) {
  const [expanded, setExpanded] = useState(null);
  const [clearConfirm, setClearConfirm] = useState(false);

  const bySubject = subject === "all" ? entries : entries.filter((e) => REAL_SUBTYPE_META[e.subtype].subject === subject);
  const list = type === "all" ? bySubject : bySubject.filter((e) => e.subtype === type);
  const present = subtypeOrder.filter((t) => bySubject.some((e) => e.subtype === t));
  const chips = [["all", "全部", A, bySubject.length], ...present.map((t) => [t, REAL_SUBTYPE_META[t].short, REAL_SUBTYPE_META[t].color, bySubject.filter((e) => e.subtype === t).length])];
  const groups = groupEntriesByDay(list);
  const totalAvg = averagePct(entries);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "rbFadeUp .4s cubic-bezier(0.25,1,0.5,1) both" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 800, letterSpacing: -.6 }}>真题练习记录</h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#5a6b62", lineHeight: 1.5 }}>
            共 {entries.length} 次{totalAvg != null ? ` · 平均得分率 ${totalAvg}%` : ""} · 展开一条记录可速览错题，或进入逐题回顾
          </p>
        </div>
        <Link href="/?section=real-bank" style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${A}55`, background: ACCENT.soft, color: A, fontSize: 12, fontWeight: 700, textDecoration: "none" }}>去真题专区练一套</Link>
      </div>

      <SummaryCard all={entries} bySubject={bySubject} list={list} subject={subject} onSubject={onSubject} coverage={coverage}
        covOpen={covOpen} onToggleCov={onToggleCov} index={index} onOpen={onOpen} />

      <section style={{ background: "#fff", border: "1px solid #ebf0ed", borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px 10px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 750, letterSpacing: -.2 }}>练习明细</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: A, background: `${A}0C`, padding: "3px 10px", borderRadius: 999 }}>{list.length} 条记录</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a39a" }}>点一条展开速览 · 分组标题可折叠</span>
        </div>
        {present.length > 1 ? (
          <div data-testid="real-type-filter" style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 18px 12px" }}>
            {chips.map(([k, label, c, n]) => {
              const on = type === k;
              return (
                <button key={k} onClick={() => { setExpanded(null); onType(k); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 11px", borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: "pointer", border: `1px solid ${on ? `${c}55` : "#ebf0ed"}`, background: on ? `${c}14` : "#fff", color: on ? c : "#5a6b62", fontFamily: "inherit" }}>
                  {label}<span style={{ fontSize: 10, opacity: .7, fontVariantNumeric: "tabular-nums" }}>{n}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <div style={{ padding: "0 10px 12px", display: "flex", flexDirection: "column" }}>
          {list.length === 0 ? <div style={{ padding: "28px 0", textAlign: "center", fontSize: 12, color: "#94a39a" }}>该分类暂无记录</div> : null}
          {groups.map((g, gi) => {
            const closed = !!groupsClosed[g.label];
            const a = averagePct(g.entries);
            return (
              <div key={g.label} style={{ borderTop: gi === 0 ? "none" : "1px solid #f0f3f1" }}>
                <button onClick={() => onToggleGroup(g.label)} aria-expanded={!closed}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 8px 6px", border: "none", background: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#5a6b62" }}>{g.label}</span>
                  <span style={{ fontSize: 11, color: "#94a39a", fontVariantNumeric: "tabular-nums" }}>{g.entries.length} 次{a != null ? ` · 平均 ${a}%` : ""}</span>
                  <span style={{ flex: 1, height: 1, background: "#f0f3f1" }} />
                  <Chev rotate={closed} />
                </button>
                {!closed ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 4 }}>
                    {g.entries.map((entry) => (
                      <EntryRow key={entry.sourceIndex} entry={entry} index={index} model={models.get(entry.sourceIndex)}
                        expanded={expanded === entry.sourceIndex}
                        onToggle={() => setExpanded(expanded === entry.sourceIndex ? null : entry.sourceIndex)}
                        onOpen={onOpen} onDelete={() => { setExpanded(null); onDelete(entry); }}
                        canRescore={canRescoreEntry(entry)} rescoring={rescoring[entry.sourceIndex] === "loading"} rescoreError={rescoreError[entry.sourceIndex] || ""} onRescore={() => onRescore(entry)} />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
        {!clearConfirm ? (
          <button onClick={() => setClearConfirm(true)}
            style={{ background: "none", border: "1px solid #ebf0ed", color: "#94a39a", padding: "8px 18px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}
            {...hoverStyle({ borderColor: "#dc2626", color: "#dc2626" })}>清空全部真题记录</button>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
            <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>确认清空？只删真题记录，不影响常规练习和模考。</span>
            <button onClick={() => { setClearConfirm(false); onClearAll(); }} style={{ background: "#dc2626", color: "#fff", border: "none", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>确认</button>
            <button onClick={() => setClearConfirm(false)} style={{ background: "#fff", border: "1px solid #dde5df", color: "#5a6b62", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>取消</button>
          </div>
        )}
      </div>
    </div>
  );
}

