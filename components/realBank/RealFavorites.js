"use client";
// 「真题练习记录」的收藏夹视图：题目级收藏（一题一条，存储见 lib/realBankFavorites.js）。
// 每张卡：题型 / 来源分档 / 考试日期 / 话题 + 这道题练过几次、最近一次得分；
// 「去做这道题」直达真题专区里的这道（造句 / 听力应答是所在那一套），「看最近一次记录」回逐题回顾。
// 记录删了收藏照样在（卡片靠收藏时的快照显示），只是没有「最近一次记录」可看。

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { REAL_SUBJECT_META, REAL_SUBJECT_ORDER, REAL_SUBTYPE_META, realScoreColor } from "../../lib/realBankHistory";
import { realFavoriteHref } from "../../lib/realBankFavorites";
import { formatMD, whenLabel } from "../../lib/realBankReview";
import { ACCENT, favoriteOf } from "./realBankMeta";
import { FavButton, IconBox, TierBadge, hoverStyle } from "./realBankUi";
import { realTierLabel } from "../../lib/realBank";

const A = ACCENT.color;

export function RealFavorites({ favorites, entries, index, models, onOpen, onRemove }) {
  const [subject, setSubject] = useState("all");

  // 收藏 key → 这道题的全部单题记录（整卷模考里做过的不算进来：那是一整卷，不是这道题的回顾入口）。
  const byKey = useMemo(() => {
    const m = new Map();
    for (const e of entries) {
      const f = favoriteOf(e, index);
      if (!f) continue;
      const k = `${f.subtype}:${f.itemId}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
    for (const list of m.values()) list.sort((a, b) => Date.parse(b.session.date) - Date.parse(a.session.date));
    return m;
  }, [entries, index]);

  const known = favorites.filter((f) => REAL_SUBTYPE_META[f.subtype]);
  const list = subject === "all" ? known : known.filter((f) => REAL_SUBTYPE_META[f.subtype].subject === subject);
  const chips = [["all", "全部", A, known.length], ...REAL_SUBJECT_ORDER
    .map((k) => [k, REAL_SUBJECT_META[k].label, REAL_SUBJECT_META[k].color, known.filter((f) => REAL_SUBTYPE_META[f.subtype].subject === k).length])
    .filter((c) => c[3] > 0)];

  return (
    <section data-testid="real-favorites" style={{ background: "#fff", border: "1px solid #ebf0ed", borderRadius: 16, overflow: "hidden", animation: "rbFadeUp .3s ease both" }}>
      <div style={{ padding: "14px 18px 10px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 750, letterSpacing: -.2 }}>收藏夹</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: A, background: `${A}0C`, padding: "3px 10px", borderRadius: 999 }}>{list.length} 道题</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a39a" }}>在练习记录里点 ☆ 收藏一道题</span>
      </div>
      {chips.length > 2 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 18px 12px" }}>
          {chips.map(([k, label, c, n]) => {
            const on = subject === k;
            return (
              <button key={k} type="button" onClick={() => setSubject(k)}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 11px", borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: "pointer", border: `1px solid ${on ? `${c}55` : "#ebf0ed"}`, background: on ? `${c}14` : "#fff", color: on ? c : "#5a6b62", fontFamily: "inherit" }}>
                {label}<span style={{ fontSize: 10, opacity: .7, fontVariantNumeric: "tabular-nums" }}>{n}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div style={{ padding: "0 10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        {list.length === 0 ? (
          <div style={{ padding: "36px 16px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 22 }}>☆</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>收藏夹还是空的</div>
            <div style={{ fontSize: 12, color: "#5a6b62", lineHeight: 1.6, maxWidth: 360 }}>做完真题后，在练习明细的每一行或逐题回顾的头部点「☆ 收藏」，这道题就会出现在这里，随时回来再做。</div>
          </div>
        ) : null}
        {list.map((f) => {
          const meta = REAL_SUBTYPE_META[f.subtype];
          const recs = byKey.get(f.key) || [];
          const latest = recs[0];
          const score = latest ? models.get(latest.sourceIndex)?.score : null;
          const sc = realScoreColor(score?.pct, "#5a6b62");
          const added = new Date(f.addedAt);
          return (
            <div key={f.key} data-testid="real-fav-row"
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 12, flexWrap: "wrap" }}
              {...hoverStyle({ background: "#faf9f7" })}>
              <IconBox meta={meta} />
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 650 }}>{meta.label}</span>
                  <TierBadge tier={f.tier} label={f.tier ? realTierLabel(f.tier) : ""} />
                  {f.examDate ? <span style={{ fontSize: 10.5, color: "#94a39a" }}>考试 {f.examDate}</span> : null}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 3, fontSize: 11, color: "#94a39a", fontVariantNumeric: "tabular-nums", minWidth: 0 }}>
                  <span style={{ whiteSpace: "nowrap" }}>{Number.isFinite(added.getTime()) ? `收藏于 ${formatMD(added)}` : "已收藏"}{recs.length ? ` · 练过 ${recs.length} 次` : ""}</span>
                  <span style={{ color: "#5a6b62", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{f.subtitle || f.itemId}</span>
                </div>
              </div>
              {score ? (
                <span title={`最近一次 · ${whenLabel(latest.session.date)}`}
                  style={{ minWidth: 56, textAlign: "center", fontVariantNumeric: "tabular-nums", fontSize: 13, fontWeight: 750, color: sc, background: `${sc}12`, padding: "3px 10px", borderRadius: 8, whiteSpace: "nowrap" }}>{score.label}</span>
              ) : null}
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Link href={realFavoriteHref(f)} data-testid="real-fav-practice"
                  style={{ padding: "7px 12px", borderRadius: 8, border: "none", background: A, color: "#fff", fontSize: 12, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>去做这道题</Link>
                {latest ? (
                  <button type="button" data-testid="real-fav-open" onClick={() => onOpen(latest)}
                    style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${A}55`, background: ACCENT.soft, color: A, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" }}>看最近一次记录</button>
                ) : null}
                <FavButton on compact onToggle={() => onRemove(f.key)} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
