"use client";
// 真题专区 · 单场详情（/real-bank/sets?set=…）。
//
// 一场考试按题型分组列题：组头 = 题型中文名 + ETS 任务名 + 本组进度；题目行 = 序号 / 摘要 /
// 已练勾。点题跳到 /real-bank?type=…&item=…&set=… —— 题型页收到 item 参数会跳过 picker
// 直接进答题，做完按 set 参数回到本页（判分 / 历史 / 已练 全走题型页原有链路，本组件零判分逻辑）。
import { useState } from "react";
import { HOME_FONT, HOME_PAGE_CSS, HOME_TOKENS as T } from "../home/theme";
import { TopBar } from "../shared/ui";
import { parseRealSetName, REAL_SET_SECTIONS, REAL_TIER_LABELS, realSourceFlagNote } from "../../lib/realBank";
import { countSetDone } from "./realBankDone";
import { REAL_ACCENT as AC, REAL_INK } from "./theme";

const ETS_NAME = Object.fromEntries(REAL_SET_SECTIONS.map((s) => [s.key, s.etsName]));

function ItemRow({ item, index, done, hover, onHover, onSelect }) {
  const isHover = hover === item.id;
  return (
    <div
      data-testid={`real-set-item-${item.id}`}
      onClick={() => onSelect(item)}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover("")}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(item); } }}
      style={{
        display: "flex", alignItems: "stretch", position: "relative",
        background: T.card, border: `1px solid ${isHover ? `${AC.color}90` : T.bdr}`,
        borderRadius: 12, overflow: "hidden", cursor: "pointer",
        transform: isHover ? "translateY(-2px)" : "none",
        boxShadow: isHover ? `0 6px 18px ${AC.color}28` : T.shadow,
        transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: done ? T.primary : AC.color, opacity: isHover || done ? 1 : 0, transition: "opacity 150ms ease" }} />
      <div style={{ width: 52, minWidth: 52, display: "flex", alignItems: "center", justifyContent: "center", background: done ? T.primarySoft : AC.soft }}>
        {done
          ? <div style={{ fontSize: 18, fontWeight: 800, color: T.primary }}>&#10003;</div>
          : <div style={{ fontSize: 15, fontWeight: 800, color: AC.color, fontVariantNumeric: "tabular-nums" }}>#{index + 1}</div>}
      </div>
      <div style={{ width: 1, flexShrink: 0, background: `linear-gradient(to bottom, transparent, ${done ? T.primary : AC.color}45, transparent)` }} />
      <div style={{ flex: 1, minWidth: 0, padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.t1, lineHeight: 1.35, marginBottom: item.subtitle ? 3 : 0 }}>{item.title}</div>
        {item.subtitle && (
          <div style={{ fontSize: 12, color: T.t2, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
            {item.subtitle}
          </div>
        )}
      </div>
      {done && (
        <div style={{ position: "absolute", top: 6, right: 8, fontSize: 10, fontWeight: 700, color: T.primary, background: T.primarySoft, borderRadius: 4, padding: "1px 6px", border: `1px solid ${T.primaryMist}`, lineHeight: 1.6 }}>已练</div>
      )}
      <div style={{ padding: "12px 12px", display: "flex", alignItems: "center", color: AC.color, fontSize: 15 }}>&gt;</div>
    </div>
  );
}

/**
 * @param set        getRealExamSet() 的返回（非空）
 * @param doneByType { ctw: Set, rdl: Set, ap: Set }
 * @param onSelect   (item) => void —— item = { id, type, title, subtitle }
 */
export function RealSetDetail({ set, doneByType, onSelect, onExit }) {
  const [hover, setHover] = useState("");
  const done = countSetDone(set, doneByType);
  const pct = set.total > 0 ? Math.round((done / set.total) * 100) : 0;
  const finished = set.total > 0 && done >= set.total;
  const { month, day, variant } = parseRealSetName(set.source, set.date);
  const flagNote = realSourceFlagNote(set.flags);
  const tierLabel = REAL_TIER_LABELS[set.tier] || REAL_TIER_LABELS.legacy;

  // 「接着练」= 第一道没做过的题（按科目顺序）
  const nextItem = (() => {
    for (const sec of set.sections) {
      const ids = doneByType[sec.key] || new Set();
      const hit = sec.items.find((it) => !ids.has(String(it.id)));
      if (hit) return hit;
    }
    return null;
  })();

  return (
    <>
      <style>{HOME_PAGE_CSS}{`
@media (max-width: 960px) {
  .real-item-grid { grid-template-columns: 1fr !important; }
  .real-shell { padding: 20px 14px 48px !important; }
  .real-head { flex-direction: column !important; }
  .real-head-stat { text-align: left !important; }
}
`}</style>
      <div style={{ minHeight: "100vh", background: T.bg, fontFamily: HOME_FONT }}>
        <TopBar title={set.source} section="真题专区 | 场次" onExit={onExit} />

        <div className="real-shell" style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 36px 60px" }}>
          {/* Header */}
          <div data-testid="real-set-header" style={{
            background: T.card, border: `1px solid ${T.bdr}`, borderRadius: 14,
            boxShadow: T.shadow, padding: "22px 28px", marginBottom: 22,
            animation: "fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) 50ms both",
          }}>
            <div className="real-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
              <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                <div style={{
                  width: 72, minWidth: 72, height: 72, borderRadius: 14,
                  background: finished ? T.primarySoft : AC.soft, border: `1px solid ${finished ? T.primaryMist : `${AC.color}30`}`,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: finished ? T.primary : AC.color, letterSpacing: -0.5, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                    {month ? `${month}.${day}` : "—"}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: finished ? T.primaryDeep : REAL_INK, opacity: 0.8 }}>{variant || set.date.slice(0, 4)}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: AC.color, fontWeight: 700, letterSpacing: 0.3, marginBottom: 4 }}>Real Questions · {set.date || "日期未知"}</div>
                  <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: T.t1, letterSpacing: -0.3, lineHeight: 1.2 }}>{set.source}</h2>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: T.t2 }}>
                    <span style={{ fontWeight: 700, color: REAL_INK, background: "#fff", border: `1px solid ${AC.color}44`, borderRadius: 999, padding: "0 8px", lineHeight: 1.8 }}>{tierLabel}</span>
                    <span>考生回忆整理 · 独立盲审一致后收录 · 非 ETS 官方原题</span>
                  </div>
                  {flagNote && <div style={{ marginTop: 6, fontSize: 12, color: T.amber, lineHeight: 1.4 }}>⚠ {flagNote}</div>}
                </div>
              </div>
              <div className="real-head-stat" style={{ textAlign: "right", minWidth: 150 }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: finished ? T.primary : AC.color, fontVariantNumeric: "tabular-nums" }}>
                  {done}<span style={{ fontSize: 16, fontWeight: 600, color: T.t3 }}>/{set.total}</span>
                </div>
                <div style={{ fontSize: 11, color: T.t3, marginBottom: 8 }}>已完成</div>
                <div style={{ height: 6, background: `${AC.color}18`, borderRadius: 3, overflow: "hidden", width: 150, display: "inline-block" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: finished ? T.primary : AC.color, borderRadius: 3 }} />
                </div>
                {nextItem && (
                  <div style={{ marginTop: 10 }}>
                    <button
                      data-testid="real-set-continue"
                      onClick={() => onSelect(nextItem)}
                      style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: AC.color, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: HOME_FONT }}
                    >
                      {done > 0 ? "接着练" : "开始这一场"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {set.sections.map((sec, si) => {
            const ids = doneByType[sec.key] || new Set();
            const secDone = sec.items.filter((it) => ids.has(String(it.id))).length;
            return (
              <div key={sec.key} style={{ marginBottom: 24, animation: `fadeUp 0.5s cubic-bezier(0.25,1,0.5,1) ${120 + si * 60}ms both` }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "0 2px 10px" }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: T.t1 }}>{sec.label}</div>
                  <div style={{ fontSize: 11, color: T.t3, fontWeight: 600, letterSpacing: 0.3 }}>{ETS_NAME[sec.key]}</div>
                  <div style={{ flex: 1, height: 1, background: T.bdr, alignSelf: "center" }} />
                  <div style={{ fontSize: 12, color: secDone >= sec.items.length ? T.primary : T.t2, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {secDone}/{sec.items.length} {sec.unit}
                  </div>
                </div>
                <div className="real-item-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {sec.items.map((it, i) => (
                    <ItemRow key={it.id} item={it} index={i} done={ids.has(String(it.id))} hover={hover} onHover={setHover} onSelect={onSelect} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
