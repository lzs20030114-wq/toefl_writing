"use client";
// 真题专区 · 按考试场次总览（/real-bank/sets）。
//
// 视觉骨架是「考期账本」：一场一行，左侧日期块（月.日 大字 + 卷别），中间卷名 + 各题型题量
// chip，右侧本场进度。按月分组加一行月份标签 —— 54 套卷铺量后靠月份扫描，比扁平列表好找。
// 顶部一条「按题型练」快捷 pill 保留原来的六个题型入口，两种找题方式并存。
import Link from "next/link";
import { useState } from "react";
import { HOME_FONT, HOME_PAGE_CSS, HOME_TOKENS as T } from "../home/theme";
import { TopBar } from "../shared/ui";
import { parseRealSetName, REAL_TIER_LABELS, realSourceFlagNote } from "../../lib/realBank";
import { countSetDone } from "./realBankDone";
import { REAL_ACCENT as AC, REAL_INK, REAL_TYPE_LABELS } from "./theme";

const TYPE_ORDER = ["ctw", "rdl", "ap", "discussion", "email", "bs"];

function monthLabel(date) {
  const m = String(date || "").match(/^(\d{4})-(\d{2})/);
  if (!m) return "日期未知";
  return `${m[1]} 年 ${Number(m[2])} 月`;
}

function ProgressBar({ done, total, width = 120 }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const finished = total > 0 && done >= total;
  return (
    <div style={{ height: 5, width, background: `${AC.color}18`, borderRadius: 3, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: finished ? T.primary : AC.color, borderRadius: 3, transition: "width .3s ease" }} />
    </div>
  );
}

export function SectionChip({ label, count, unit, done }) {
  const finished = count > 0 && done >= count;
  return (
    <span style={{
      display: "inline-flex", alignItems: "baseline", gap: 4,
      fontSize: 11, fontWeight: 600, lineHeight: 1.6,
      padding: "1px 8px", borderRadius: 999,
      background: finished ? T.primarySoft : AC.soft,
      color: finished ? T.primaryDeep : REAL_INK,
      border: `1px solid ${finished ? T.primaryMist : `${AC.color}30`}`,
      whiteSpace: "nowrap",
    }}>
      {label}
      <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.85 }}>
        {done > 0 ? `${done}/${count}` : count} {unit}
      </span>
    </span>
  );
}

export function RealSetRow({ set, doneByType, hover, onHover }) {
  const done = countSetDone(set, doneByType);
  const finished = set.total > 0 && done >= set.total;
  const { month, day, variant } = parseRealSetName(set.source, set.date);
  const flagNote = realSourceFlagNote(set.flags);
  const isHover = hover === set.id;

  return (
    <Link
      href={`/real-bank/sets?set=${encodeURIComponent(set.id)}`}
      data-testid={`real-set-${set.id}`}
      onMouseEnter={() => onHover(set.id)}
      onMouseLeave={() => onHover("")}
      className="real-set-row"
      style={{
        display: "flex", alignItems: "stretch", position: "relative",
        textDecoration: "none", color: "inherit",
        background: T.card, border: `1px solid ${isHover ? `${AC.color}90` : T.bdr}`,
        borderRadius: 12, overflow: "hidden",
        transform: isHover ? "translateY(-2px)" : "none",
        boxShadow: isHover ? `0 6px 18px ${AC.color}28` : T.shadow,
        transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: finished ? T.primary : AC.color, opacity: isHover || finished ? 1 : 0, transition: "opacity 150ms ease" }} />

      {/* 日期块 */}
      <div className="real-set-date" style={{
        width: 84, minWidth: 84, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: finished ? T.primarySoft : AC.soft, padding: "12px 6px", gap: 2,
      }}>
        {month ? (
          <>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.5, color: finished ? T.primary : AC.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
              {month}.{day}
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: finished ? T.primaryDeep : REAL_INK, opacity: 0.8, letterSpacing: 0.3 }}>
              {variant || (set.date ? set.date.slice(0, 4) : "")}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, fontWeight: 700, color: REAL_INK }}>—</div>
        )}
      </div>
      <div style={{ width: 1, flexShrink: 0, background: `linear-gradient(to bottom, transparent, ${finished ? T.primary : AC.color}45, transparent)` }} />

      {/* 卷名 + 题型 chip */}
      <div style={{ flex: 1, minWidth: 0, padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.t1, lineHeight: 1.3 }}>{set.source}</div>
          <span style={{ fontSize: 10, fontWeight: 700, color: REAL_INK, background: "#fff", border: `1px solid ${AC.color}44`, borderRadius: 999, padding: "0 7px", lineHeight: 1.7 }}>
            {REAL_TIER_LABELS[set.tier] || REAL_TIER_LABELS.legacy}
          </span>
          {finished && (
            <span style={{ fontSize: 10, fontWeight: 700, color: T.primary, background: T.primarySoft, border: `1px solid ${T.primaryMist}`, borderRadius: 4, padding: "0 6px", lineHeight: 1.7 }}>已全部练完</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {set.sections.map((sec) => {
            const ids = doneByType[sec.key] || new Set();
            const d = sec.items.filter((it) => ids.has(String(it.id))).length;
            return <SectionChip key={sec.key} label={sec.label} count={sec.items.length} unit={sec.unit} done={d} />;
          })}
        </div>
        {flagNote && (
          <div style={{ fontSize: 11, color: T.amber, lineHeight: 1.4 }}>⚠ {flagNote}</div>
        )}
      </div>

      {/* 进度 */}
      <div className="real-set-progress" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: finished ? T.primary : T.t2, fontVariantNumeric: "tabular-nums" }}>
          {done}<span style={{ color: T.t3, fontWeight: 600 }}>/{set.total} 题</span>
        </div>
        <ProgressBar done={done} total={set.total} width={96} />
      </div>
      <div style={{ display: "flex", alignItems: "center", paddingRight: 14, color: AC.color, fontSize: 15 }}>&gt;</div>
    </Link>
  );
}

/**
 * @param sets       getRealExamSets() 的返回
 * @param doneByType { ctw: Set, rdl: Set, ap: Set }
 * @param typeCounts { ctw: n, rdl: n, ap: n, discussion: n, email: n, bs: n } —— 快捷 pill 上的题量
 */
export function RealSetHub({ sets, doneByType, typeCounts, onExit }) {
  const [hover, setHover] = useState("");
  const totalItems = sets.reduce((n, s) => n + s.total, 0);
  const totalDone = sets.reduce((n, s) => n + countSetDone(s, doneByType), 0);
  const latest = sets[0];

  // 按月分组（sets 已按日期倒序）
  const groups = [];
  for (const s of sets) {
    const label = monthLabel(s.date);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.sets.push(s);
    else groups.push({ label, sets: [s] });
  }

  return (
    <>
      <style>{HOME_PAGE_CSS}{`
@media (max-width: 720px) {
  .real-shell { padding: 20px 14px 48px !important; }
  .real-set-progress { display: none !important; }
  .real-set-date { width: 64px !important; min-width: 64px !important; }
  .real-head { flex-direction: column !important; }
  .real-head-stat { text-align: left !important; }
}
`}</style>
      <div style={{ minHeight: "100vh", background: T.bg, fontFamily: HOME_FONT }}>
        <TopBar title="按考试场次" section="真题专区 | 场次" onExit={onExit} />

        <div className="real-shell" style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 36px 60px" }}>
          {/* Header */}
          <div style={{
            background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 14,
            boxShadow: T.shadow, padding: "24px 28px", marginBottom: 16,
            animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 50ms both",
          }}>
            <div className="real-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 11, color: AC.color, fontWeight: 700, letterSpacing: 0.3, marginBottom: 4 }}>Real Questions · By Exam Date</div>
                <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: T.t1, letterSpacing: -0.3 }}>按考试场次练真题</h2>
                <p style={{ margin: 0, fontSize: 13, color: T.t2, lineHeight: 1.5, maxWidth: 560 }}>
                  一场考试一套题，按考试日期排列，最近一场在最前。每场列出当场回忆整理并通过独立盲审的题目；
                  做过的题在这里和题型列表里都会标「已练」。
                </p>
              </div>
              <div className="real-head-stat" style={{ textAlign: "right", minWidth: 150 }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: AC.color, fontVariantNumeric: "tabular-nums" }}>
                  {sets.length}<span style={{ fontSize: 14, fontWeight: 600, color: T.t3 }}> 场</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: T.t3, margin: "0 6px" }}>·</span>
                  {totalDone}<span style={{ fontSize: 16, fontWeight: 600, color: T.t3 }}>/{totalItems} 题</span>
                </div>
                <div style={{ fontSize: 11, color: T.t3, marginBottom: 8 }}>
                  {latest?.date ? `最近一场 ${latest.date}` : "已完成"}
                </div>
                <div style={{ display: "inline-block" }}><ProgressBar done={totalDone} total={totalItems} width={150} /></div>
              </div>
            </div>
          </div>

          {/* 按题型快捷入口 */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 20, padding: "0 2px", animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 100ms both" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.t3, letterSpacing: 0.3, marginRight: 4 }}>按题型练</span>
            {TYPE_ORDER.map((t) => (
              <Link
                key={t}
                href={`/real-bank?type=${t}`}
                style={{
                  textDecoration: "none", borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 600,
                  background: T.card, color: T.t2, border: `1px solid ${T.bdr}`, boxShadow: T.shadow, whiteSpace: "nowrap",
                }}
              >
                {REAL_TYPE_LABELS[t].short}
                {typeCounts?.[t] != null && <span style={{ color: T.t3, marginLeft: 4, fontVariantNumeric: "tabular-nums" }}>{typeCounts[t]}</span>}
              </Link>
            ))}
          </div>

          {sets.length === 0 && (
            <div style={{ background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 14, padding: 40, textAlign: "center", boxShadow: T.shadow, fontSize: 14, color: T.t2 }}>
              场次真题还在录入中，先从上方按题型练。
            </div>
          )}

          {groups.map((g, gi) => (
            <div key={g.label} style={{ marginBottom: 22, animation: `fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) ${150 + gi * 60}ms both` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 2px 10px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.t2, letterSpacing: 0.3, whiteSpace: "nowrap" }}>{g.label}</div>
                <div style={{ flex: 1, height: 1, background: T.bdr }} />
                <div style={{ fontSize: 11, color: T.t3, whiteSpace: "nowrap" }}>{g.sets.length} 场</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {g.sets.map((s) => (
                  <RealSetRow key={s.id} set={s} doneByType={doneByType} hover={hover} onHover={setHover} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
