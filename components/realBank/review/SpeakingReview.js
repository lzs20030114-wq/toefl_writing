"use client";
// 口语逐题回顾：跟读（每句一张折叠卡，逐词标漏读）与访谈（整场 AI 分析 + 每题四维评分）。设计稿 · 口语。
// 原句 / 题目朗读、「再练一次」录音（只在本页显示、不写入历史）、整场 AI 分析的 Pro 门与缓存都复用口语历史页同一套。
import React from "react";
import { RepeatRetake } from "../../speaking/RepeatRetake";
import { InterviewAiReviewBlock } from "../../speaking/useInterviewAiReview";
import { LV, READ_FONT, Chev } from "../realBankUi";
import { EmptyNote, ReadAloud, ReviewCard } from "./shared";

const normWord = (w) => String(w).toLowerCase().replace(/[^\w]/g, "");

/** 原句逐词判定：命中的消费一次 matchedWords，其余（含 missedWords）算漏读；没录音则全部 null。 */
function classifyWords(sentence, score, recorded) {
  const words = String(sentence || "").split(/\s+/).filter(Boolean);
  if (!recorded || !score) return words.map((t) => ({ t, missed: null }));
  const pool = [...(score.matchedWords || [])];
  return words.map((t) => {
    const at = pool.indexOf(normWord(t));
    if (at !== -1) { pool.splice(at, 1); return { t, missed: false }; }
    return { t, missed: true };
  });
}

const chip = (bg, color) => ({ fontSize: 11.5, padding: "1px 7px", borderRadius: 5, background: bg, color, fontFamily: "'Open Sans',sans-serif" });
const labelStyle = { fontSize: 11, fontWeight: 700, color: "#5a6b62", width: 52 };

export function RepeatReview({ session, model, vid, ctx }) {
  const items = Array.isArray(session.details?.items) ? session.details.items : [];
  const visible = model.units.filter((u) => ctx.pass(u));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5, color: "#5a6b62", marginBottom: 2 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ color: LV.bad.c, textDecoration: "underline wavy #FCA5A5", textUnderlineOffset: 3 }}>word</span>漏读或读错
        </span>
        <span style={{ color: "#94a39a" }}>点开一句可重听原句、看转写，并「再练一次」</span>
      </div>
      {visible.map((u) => {
        const i = u.idx;
        const it = items[i] || {};
        const sc = it.score && typeof it.score === "object" ? it.score : null;
        const acc = Number(sc?.accuracy);
        const recorded = !!it.recorded && Number.isFinite(acc);
        const o = ctx.isOpen(i);
        const L = LV[u.lv];
        const words = classifyWords(it.sentence, sc, recorded);
        const missedList = Array.isArray(sc?.missedWords) ? sc.missedWords : [];
        const extraList = Array.isArray(sc?.extraWords) ? sc.extraWords : [];
        const key = `${vid}:${i}`;
        return (
          <ReviewCard key={i} dataKey={key} open={o} lv={u.lv} bodyPadding="2px 14px 14px 46px"
            head={({ headBg }) => (
              <button type="button" aria-expanded={o} onClick={() => ctx.toggle(i)}
                style={{ width: "100%", display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 14px", border: "none", background: headBg, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", background: it.recorded ? "#FEF3C7" : "#F3F4F6", color: it.recorded ? "#B45309" : "#94a39a", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, flexShrink: 0, marginTop: 1 }}>{u.n}</span>
                <div style={{ flex: 1, minWidth: 0, whiteSpace: "normal", fontFamily: READ_FONT, fontSize: 13.5, lineHeight: 1.65 }}>
                  {words.map((w, x) => (
                    <span key={x} style={{ color: w.missed ? LV.bad.c : recorded ? "#1a2420" : "#5a6b62", textDecoration: w.missed ? "underline wavy #FCA5A5" : "none", textUnderlineOffset: 3 }}>{w.t}{x < words.length - 1 ? " " : ""}</span>
                  ))}
                  {words.length === 0 ? "（句子内容不可用）" : null}
                </div>
                <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 750, color: L.c, background: L.bg, padding: "2px 9px", borderRadius: 7, fontVariantNumeric: "tabular-nums" }}>{recorded ? `${acc}%` : "未录制"}</span>
                <span style={{ marginTop: 6, display: "inline-flex" }}><Chev open={o} /></span>
              </button>
            )}>
            <ReadAloud label="原句朗读" text={it.sentence} labelWidth={52} />
            {recorded ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={labelStyle}>准确率</span>
                <div style={{ flex: 1, maxWidth: 400, height: 5, background: "#EEF2EF", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.max(0, Math.min(100, acc))}%`, background: L.c, borderRadius: 3 }} /></div>
                <strong style={{ fontSize: 12, color: L.c, fontVariantNumeric: "tabular-nums" }}>{acc}%</strong>
              </div>
            ) : null}
            {missedList.length > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={labelStyle}>漏读</span>
                {missedList.map((w, x) => <span key={x} style={chip("#FEF2F2", "#B91C1C")}>{w}</span>)}
              </div>
            ) : null}
            {extraList.length > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={labelStyle}>多余词</span>
                {extraList.map((w, x) => <span key={x} style={chip("#F3F4F6", "#4B5563")}>{w}</span>)}
              </div>
            ) : null}
            {it.transcript ? (
              <div style={{ padding: "8px 12px", background: "#fafbfa", border: "1px solid #ebf0ed", borderRadius: 8, fontSize: 12.5, color: "#5a6b62", fontStyle: "italic", lineHeight: 1.6 }}>
                <span style={{ fontStyle: "normal", fontSize: 10.5, fontWeight: 700, color: "#94a39a", marginRight: 6 }}>你的复述（转写）</span>{it.transcript}
              </div>
            ) : null}
            {!it.recorded ? <div style={{ fontSize: 12, color: "#94a39a", fontStyle: "italic" }}>这一句当时没有录到声音，可以在下面补练。</div> : null}
            {it.sentence ? (
              <div style={{ paddingTop: 10, borderTop: "1px dashed #e3e9e5" }}>
                <RepeatRetake sentenceText={it.sentence} questionId={it.id || ""} originalAccuracy={recorded ? acc : null} />
              </div>
            ) : null}
          </ReviewCard>
        );
      })}
      {visible.length === 0 ? <EmptyNote>{ctx.emptyText}</EmptyNote> : null}
    </div>
  );
}

const DIMS = [
  ["fluency", "流利度", "Fluency", "#F59E0B"],
  ["intelligibility", "可理解度", "Intelligibility", "#0891B2"],
  ["language", "语言使用", "Language", "#7C3AED"],
  ["organization", "组织结构", "Organization", "#16A34A"],
];

export function InterviewReview({ session, model, vid, ctx }) {
  const d = session.details || {};
  const items = Array.isArray(d.items) ? d.items : [];
  const visible = model.units.filter((u) => ctx.pass(u));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <InterviewAiReviewBlock items={items} averageScore={d.averageScore ?? null} totalElapsed={d.totalElapsed || d.elapsed || 0} topic={d.topic || ""} />
      {visible.map((u) => {
        const i = u.idx;
        const it = items[i] || {};
        const sc = it.aiScore;
        const hasScore = !!(sc && !sc.error && Number.isFinite(Number(sc.score)));
        const o = ctx.isOpen(i);
        const L = LV[u.lv];
        const key = `${vid}:${i}`;
        return (
          <ReviewCard key={i} dataKey={key} open={o} lv={u.lv} bodyPadding="2px 14px 14px 50px"
            head={({ headBg }) => (
              <button type="button" aria-expanded={o} onClick={() => ctx.toggle(i)}
                style={{ width: "100%", display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", border: "none", background: headBg, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                <span style={{ height: 22, padding: "0 7px", borderRadius: 999, background: it.recorded ? "#FEE2E2" : "#F3F4F6", color: it.recorded ? "#DC2626" : "#94a39a", display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 800, flexShrink: 0, marginTop: 1, whiteSpace: "nowrap" }}>Q{u.n.replace(/^Q/, "")}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.55, whiteSpace: "normal" }}>{it.question || "（问题内容不可用）"}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                    {it.category ? <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#EDE9FE", color: "#5B21B6" }}>{it.category}</span> : null}
                    {hasScore && sc.dimensions ? DIMS.map(([k, l, , c]) => (
                      sc.dimensions[k] ? <span key={k} title={l} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, color: "#5a6b62" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />{sc.dimensions[k].score}</span> : null
                    )) : null}
                  </div>
                </div>
                <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 750, color: L.c, background: L.bg, padding: "2px 9px", borderRadius: 7, fontVariantNumeric: "tabular-nums" }}>{hasScore ? `${sc.score}/5` : it.recorded ? "未评分" : "已跳过"}</span>
                <span style={{ marginTop: 6, display: "inline-flex" }}><Chev open={o} /></span>
              </button>
            )}>
            {it.question ? <ReadAloud label="题目朗读" text={it.question} /> : null}
            {hasScore ? (
              <>
                {sc.dimensions ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "10px 18px" }}>
                    {DIMS.map(([k, l, en, c]) => {
                      const dim = sc.dimensions[k];
                      if (!dim) return null;
                      return (
                        <div key={k}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 700 }}>{l} <span style={{ color: "#94a39a", fontWeight: 400 }}>{en}</span></span>
                            <span style={{ fontSize: 12, fontWeight: 800, color: c }}>{dim.score}</span>
                          </div>
                          <div style={{ height: 4, background: "#EEF2EF", borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${(Number(dim.score) / 5) * 100}%`, background: c, borderRadius: 2 }} /></div>
                          {dim.feedback ? <div style={{ fontSize: 11.5, color: "#5a6b62", lineHeight: 1.5, marginTop: 4 }}>{dim.feedback}</div> : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {sc.summary ? <div style={{ padding: "9px 12px", background: "#fafbfa", border: "1px solid #ebf0ed", borderRadius: 8, fontSize: 12.5, lineHeight: 1.65 }}><strong style={{ fontSize: 10.5, color: "#94a39a", marginRight: 6 }}>AI 总评</strong>{sc.summary}</div> : null}
                {Array.isArray(sc.suggestions) && sc.suggestions.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a39a", letterSpacing: ".06em" }}>改进建议</div>
                    {sc.suggestions.map((t, n) => <div key={n} style={{ display: "flex", gap: 6, fontSize: 12, color: "#5a6b62", lineHeight: 1.55 }}><span style={{ color: "#F59E0B", fontWeight: 800, flexShrink: 0 }}>{n + 1}.</span><span>{t}</span></div>)}
                  </div>
                ) : null}
              </>
            ) : null}
            {it.transcript ? (
              <div style={{ padding: "9px 12px", background: "#fafbfa", border: "1px solid #ebf0ed", borderRadius: 8, fontSize: 12.5, color: "#5a6b62", lineHeight: 1.65, fontStyle: "italic", maxHeight: 120, overflow: "auto" }}>
                <span style={{ fontStyle: "normal", fontSize: 10.5, fontWeight: 700, color: "#94a39a", marginRight: 6 }}>Transcript</span>{it.transcript}
              </div>
            ) : null}
            {!hasScore && it.recorded && !it.transcript ? <div style={{ fontSize: 12, color: "#94a39a", fontStyle: "italic" }}>评分数据不可用</div> : null}
            {!it.recorded ? <div style={{ fontSize: 12, color: "#94a39a", fontStyle: "italic" }}>这道题当时跳过了，没有录音与评分。可以听题目朗读后自己试答一遍。</div> : null}
          </ReviewCard>
        );
      })}
      {visible.length === 0 ? <EmptyNote>{ctx.emptyText}</EmptyNote> : null}
    </div>
  );
}
