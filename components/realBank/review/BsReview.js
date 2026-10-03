"use client";
// 造句（Build a Sentence）逐题回顾：搜索 + 每句一张折叠卡，展开后左右并排「你的答案 / 正确答案」词级对比（设计稿 · 造句）。
import React, { useState } from "react";
import { useBsAiExplain, BsAiExplainBlock } from "../../buildSentence/useBsAiExplain";
import { wordDiff } from "../../../lib/realBankReview";
import { translateGrammarPoint } from "../../../lib/utils";
import { LV, Chev } from "../realBankUi";
import { EmptyNote, Mark } from "./shared";

function copyText(text, setNote, label) {
  try { navigator.clipboard.writeText(String(text || "")); } catch { /* 剪贴板不可用时只提示 */ }
  setNote(`已复制${label}`);
  setTimeout(() => setNote(""), 1600);
}

export function BsReview({ session, model, vid, ctx }) {
  const details = Array.isArray(session.details) ? session.details : [];
  const ai = useBsAiExplain();
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const qy = query.trim().toLowerCase();

  const visible = model.units.filter((u) => {
    if (!ctx.pass(u)) return false;
    if (!qy) return true;
    const it = details[u.idx] || {};
    return [it.prompt, it.userAnswer, it.correctAnswer].some((x) => String(x || "").toLowerCase().includes(qy));
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索题目或答案" aria-label="搜索题目或答案"
        style={{ border: "1px solid #dde5df", borderRadius: 10, padding: "8px 12px", fontSize: 12, maxWidth: 320, outline: "none", color: "#1a2420", background: "#fff", fontFamily: "inherit" }} />
      {note ? <div role="status" style={{ fontSize: 11.5, color: LV.ok.c }}>{note}</div> : null}
      <div style={{ border: "1px solid #ebf0ed", borderRadius: 12, overflow: "hidden" }}>
        {visible.map((u) => {
          const i = u.idx;
          const it = details[i] || {};
          const ok = u.lv === "ok";
          const o = ctx.isOpen(i);
          const key = `${vid}:${i}`;
          const df = wordDiff(it.userAnswer, it.correctAnswer);
          const grammar = (Array.isArray(it.grammar_points) ? it.grammar_points : []).map(translateGrammarPoint);
          const userSpans = df.user.map((w, x) => (
            <span key={x}><span style={{ color: w.hit ? "#1a2420" : LV.bad.c, background: w.hit ? "transparent" : LV.bad.bg, textDecoration: w.hit ? "none" : "line-through", borderRadius: 3, padding: "0 1px" }}>{w.t}</span>{w.sp}</span>
          ));
          return (
            <div key={i} data-q={key} style={{ borderBottom: "1px solid #f0f3f1" }}>
              <button type="button" aria-expanded={o} onClick={() => ctx.toggle(i)}
                style={{ width: "100%", display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 14px", border: "none", background: o ? LV[ok ? "ok" : "bad"].soft : "#fff", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                <span style={{ marginTop: 1, display: "inline-flex" }}><Mark lv={ok ? "ok" : "bad"} /></span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#94a39a", flexShrink: 0, paddingTop: 4, minWidth: 22 }}>#{u.n}</span>
                <div style={{ flex: 1, minWidth: 0, whiteSpace: "normal" }}>
                  <div style={{ fontSize: 11.5, color: "#94a39a", marginBottom: 2 }}>{it.prompt}</div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "#1a2420" }}>{userSpans}</div>
                </div>
                <span style={{ flexShrink: 0, display: "inline-flex", padding: "2px 8px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: "#5a6b62", background: "#f3f6f4", marginTop: 2 }}>{grammar[0] || "—"}</span>
                <span style={{ marginTop: 6, display: "inline-flex" }}><Chev open={o} /></span>
              </button>
              {o ? (
                <div style={{ padding: "2px 14px 14px 68px", display: "flex", flexDirection: "column", gap: 10, animation: "rbFadeUp .2s ease both" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 8 }}>
                    <div style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${ok ? LV.ok.bd : LV.bad.bd}`, background: ok ? LV.ok.soft : LV.bad.soft }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a39a", marginBottom: 4 }}>你的答案</div>
                      <div style={{ fontSize: 14, lineHeight: 1.7 }}>{userSpans}</div>
                      <button type="button" onClick={() => copyText(it.userAnswer, setNote, "你的答案")} style={{ marginTop: 8, border: "1px solid #dde5df", background: "#fff", borderRadius: 8, fontSize: 10.5, padding: "4px 8px", cursor: "pointer", color: "#5a6b62" }}>复制我的答案</button>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${LV.ok.bd}`, background: LV.ok.soft }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a39a", marginBottom: 4 }}>正确答案</div>
                      <div style={{ fontSize: 14, lineHeight: 1.7, color: "#065F46" }}>
                        {df.corr.map((w, x) => (
                          <span key={x}><span style={{ background: w.hit ? "transparent" : "#BBF7D0", borderBottom: w.hit ? "none" : `2px solid ${LV.ok.c}`, borderRadius: 3, padding: "0 1px" }}>{w.t}</span>{w.sp}</span>
                        ))}
                        {df.corr.length === 0 ? "（空）" : null}
                      </div>
                      <button type="button" onClick={() => copyText(it.correctAnswer, setNote, "正确答案")} style={{ marginTop: 8, border: "1px solid #dde5df", background: "#fff", borderRadius: 8, fontSize: 10.5, padding: "4px 8px", cursor: "pointer", color: "#5a6b62" }}>复制正确答案</button>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "#94a39a" }}>语法点</span>
                    {grammar.map((g, gi) => <span key={gi} style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, color: "#0d9668", background: "#ECFDF5" }}>{g}</span>)}
                    {grammar.length === 0 ? <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, color: "#5a6b62", background: "#f3f4f6" }}>暂无语法标签</span> : null}
                  </div>
                  <BsAiExplainBlock variant="review" includeCorrect explainKey={`${vid}-bs${i}`}
                    detail={{ prompt: it.prompt, userAnswer: it.userAnswer, correctAnswer: it.correctAnswer, grammar_points: it.grammar_points || [], isCorrect: ok }}
                    aiExplains={ai.aiExplains} isLegacy={ai.isLegacy} handleAiExplain={ai.handleAiExplain} />
                </div>
              ) : null}
            </div>
          );
        })}
        {visible.length === 0 ? <EmptyNote>{ctx.emptyText}</EmptyNote> : null}
      </div>
    </div>
  );
}

