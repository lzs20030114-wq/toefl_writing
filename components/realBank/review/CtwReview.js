"use client";
// 阅读填词（CTW）逐题回顾：原文里的空按对错上色，下方是每空一张小卡（设计稿 · 填词），点卡片开解析。
// 原文点词查词典（WordLookupLayer），挖空词也一样查词典（data-dict-word 让拆成两段上色的词整块当一个词查）；
// 别再给原文里的空挂「跳到下方解析」—— 那会把词典顶掉（2026-10 用户反馈）。
import React from "react";
import { WordLookupLayer } from "../../reading/WordLookupLayer";
import { splitBlankToken } from "../../../lib/reading/ctwToken";
import { useCtwAiExplain, CtwAiExplainBlock, locateBlankSentence } from "../../reading/useCtwAiExplain";
import { LV, MONO, READ_FONT } from "../realBankUi";
import { EmptyNote } from "./shared";

export function CtwReview({ session, model, vid, ctx }) {
  const d = session.details || {};
  const passage = d.passage || "";
  const results = Array.isArray(d.results) ? d.results : [];
  const blankList = results.map((r, i) => (r && r.blank) || (d.blanks || [])[i] || {});
  const itemId = d.itemId || "";
  const ai = useCtwAiExplain();

  const posToIdx = {};
  blankList.forEach((b, i) => { if (Number.isInteger(b.position)) posToIdx[b.position] = i; });

  const words = passage.split(/\s+/).filter(Boolean);
  const visible = model.units.filter((u) => ctx.pass(u));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {passage ? (
        <WordLookupLayer passage={passage} style={{ fontFamily: READ_FONT, fontSize: 14.5, lineHeight: 2.2, padding: "16px 20px", background: "#fafbfa", border: "1px solid #ebf0ed", borderRadius: 12 }}>
          {words.map((word, wi) => {
            const bi = posToIdx[wi];
            if (bi == null) return <span key={wi}>{word} </span>;
            const b = blankList[bi];
            const full = String(b.original_word || "");
            const frag = String(b.displayed_fragment || "");
            const { lead, tail } = splitBlankToken(word, full);
            const L = LV[model.units[bi]?.lv === "ok" ? "ok" : "bad"];
            const o = ctx.isOpen(bi);
            return (
              <span key={wi}>
                {lead}
                <span data-dict-word={full}
                  style={{ cursor: "pointer", fontFamily: MONO, fontSize: 13.5, fontWeight: 700, padding: "1px 4px", borderRadius: 4, background: o ? L.bg : L.soft, borderBottom: `2px solid ${L.c}`, boxShadow: o ? `0 0 0 2px ${L.c}40` : "none" }}>
                  <span style={{ color: "#5a6b62" }}>{frag}</span><span style={{ color: L.c }}>{full.slice(frag.length)}</span>
                </span>
                {tail}{" "}
              </span>
            );
          })}
        </WordLookupLayer>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontSize: 12, color: "#5a6b62" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: LV.ok.bg, borderBottom: `2px solid ${LV.ok.c}` }} />正确</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: LV.bad.bg, borderBottom: `2px solid ${LV.bad.c}` }} />错误</span>
        <span style={{ color: "#94a39a" }}>点下方卡片查看解析 · 点原文里的词（含空）查释义</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(136px,1fr))", gap: 6 }}>
        {visible.map((u) => {
          const i = u.idx;
          const r = results[i] || {};
          const b = blankList[i];
          const frag = String(b.displayed_fragment || "");
          const full = String(b.original_word || "");
          const ok = u.lv === "ok";
          const L = LV[ok ? "ok" : "bad"];
          const o = ctx.isOpen(i);
          const answered = String(r.userAnswer ?? "").trim() !== "";
          const userFull = r.fullWord || `${frag}${r.userAnswer ?? ""}`;
          const loc = o ? locateBlankSentence(passage, b.position) : null;
          const key = `${vid}:${i}`;
          return (
            <React.Fragment key={i}>
              <button data-q={key} type="button" aria-expanded={o} onClick={() => ctx.toggle(i)}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 8, border: `${o ? "1.5px" : "1px"} solid ${o ? L.c : L.bd}`, background: o ? L.bg : L.soft, cursor: "pointer", fontFamily: MONO, fontSize: 12.5, fontWeight: 700, textAlign: "left", transition: "all .15s" }}>
                <span style={{ color: L.c, fontSize: 11 }}>{ok ? "✓" : "✗"}</span>
                <span style={{ color: "#94a39a" }}>{frag}</span>
                <span style={{ color: L.c }}>{full.slice(frag.length)}</span>
                <span style={{ marginLeft: "auto", fontSize: 10, color: "#94a39a", fontFamily: "inherit" }}>{u.n}</span>
              </button>
              {o ? (
                <div data-testid="ctw-blank-panel" style={{ gridColumn: "1 / -1", minWidth: 0, padding: "12px 14px", background: "#fff", border: "1px solid #ebf0ed", borderLeft: `3px solid ${L.c}`, borderRadius: 10, display: "flex", flexDirection: "column", gap: 10, animation: "rbFadeUp .2s ease both" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 16px", fontSize: 12, color: "#5a6b62" }}>
                    <strong style={{ color: "#1a2420" }}>第 {u.n} 空</strong>
                    <span>你填的 {answered ? <span style={{ fontFamily: MONO, fontWeight: 700, color: L.c, wordBreak: "break-all" }}>{userFull}</span> : <span style={{ color: "#94a39a" }}>未作答</span>}</span>
                    <span>正确答案 <span style={{ fontFamily: MONO, fontWeight: 700, color: LV.ok.c, wordBreak: "break-all" }}>{full}</span></span>
                    <button type="button" onClick={() => ctx.toggle(i)} style={{ marginLeft: "auto", border: "none", background: "none", color: "#94a39a", fontSize: 11, cursor: "pointer" }}>收起</button>
                  </div>
                  {loc?.sentence ? (
                    <div style={{ fontFamily: READ_FONT, fontSize: 13.5, lineHeight: 1.9, padding: "8px 12px", background: "#fafbfa", border: "1px solid #ebf0ed", borderRadius: 8, wordBreak: "break-word" }}>
                      {loc.words.map((w, wi) => {
                        if (wi !== loc.targetIndexInSentence) return <span key={wi}>{w} </span>;
                        const punct = w.match(/[.,;:!?]+$/)?.[0] || "";
                        const core = punct ? w.slice(0, -punct.length) : w;
                        return (
                          <span key={wi}>
                            <span style={{ background: LV.ok.bg, color: LV.ok.c, fontWeight: 700, borderBottom: `2px solid ${LV.ok.c}`, borderRadius: 3, padding: "1px 4px", fontFamily: MONO }}>{core}</span>{punct}{" "}
                          </span>
                        );
                      })}
                    </div>
                  ) : null}
                  <div data-no-dict>
                    <CtwAiExplainBlock
                      variant="review" includeCorrect
                      explainKey={`${session.id || itemId}-${i}`}
                      detail={{ isCorrect: ok, itemId, position: b.position, displayed_fragment: frag, original_word: full, fullWord: userFull, userAnswer: r.userAnswer ?? "", passage, blankIndex: i, blankTotal: results.length }}
                      aiExplains={ai.aiExplains} isPro={ai.isPro} handleAiExplain={ai.handleAiExplain}
                    />
                  </div>
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
      {visible.length === 0 ? <EmptyNote>{ctx.emptyText}</EmptyNote> : null}
    </div>
  );
}
