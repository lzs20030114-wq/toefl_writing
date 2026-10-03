"use client";
// 选择题逐题回顾：阅读日常 / 学术、听力对话 / 通知 / 讲座、听力应答（设计稿 · 选择题）。
//
// 左：原文面板（吸顶，可收起；阅读是分段正文，听力是带播放器的逐句原文 / 对话气泡）；
// 右：每题一张折叠卡——头部一行（对错标 / 题号 / 题干 / 你选·正确 / 展开箭头），展开后是
//     题干全文（插入句题拆成三段、选句题标「第 N 段」）、四个选项（正确答案 / 你的选择打标签）、解析、AI 讲解。
// 听力应答没有原文面板：每题自带「Speaker」口播 + 播放器。
// 查词典（WordLookupLayer）、逐句点播、AI 讲解的 Pro 门与缓存都复用各科历史页同一套，这里只管版面。
import React, { useMemo, useState } from "react";
import { WordLookupLayer } from "../../reading/WordLookupLayer";
import { AudioPlayer } from "../../listening/AudioPlayer";
import { SentenceTranscript } from "../../listening/SentenceTranscript";
import { useSentencePlayback } from "../../listening/ListeningProgressView";
import { useReadingAiExplain, ReadingAiExplainBlock } from "../../reading/useReadingAiExplain";
import { useListeningAiExplain, ListeningAiExplainBlock, conversationText } from "../../listening/useListeningAiExplain";
import { questionLookupContext } from "../../../lib/dict/core";
import { insertStemParts } from "../../../lib/reading/insertSentence";
import { isSentenceSelection, sentenceOptionKeys, sentenceOptionText } from "../../../lib/reading/sentenceSelection";
import { LV, READ_FONT } from "../realBankUi";
import { Chev } from "../realBankUi";
import { EmptyNote, Ghost, Mark, ReviewCard } from "./shared";

const OPTION_KEYS = ["A", "B", "C", "D"];

function optionList(q, r, correctKey) {
  const selectMode = isSentenceSelection(q);
  const src = q.options || r?.options || {};
  const keys = selectMode ? sentenceOptionKeys(src) : OPTION_KEYS.filter((k) => src[k] != null && src[k] !== "");
  return keys.map((k) => {
    const A = k === correctKey;
    const S = k === r?.selected;
    return {
      k, text: String(src[k]), A, S,
      c: A ? "#065F46" : S ? "#991B1B" : "#5a6b62", bg: A ? "#F0FDF4" : S ? "#FEF2F2" : "#fff",
      bd: A ? "#BBF7D0" : S ? "#FECACA" : "#ebf0ed", fw: A || S ? 600 : 400,
      kc: A ? "#059669" : S ? "#DC2626" : "#94a39a",
      tag: A && S ? "你的选择 · 正确" : A ? "正确答案" : S ? "你的选择" : "",
      tagC: A ? "#059669" : "#DC2626", tagBg: A ? "#D1FAE5" : "#FEE2E2",
    };
  });
}

function Options({ options }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {options.map((o) => (
        <div key={o.k} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 10px", borderRadius: 8, border: `1px solid ${o.bd}`, background: o.bg }}>
          <span style={{ fontWeight: 800, color: o.kc, fontSize: 12, minWidth: 18, lineHeight: 1.55 }}>{o.k}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.55, color: o.c, fontWeight: o.fw }}>{o.text}</span>
          {o.tag ? <span style={{ flexShrink: 0, display: "inline-flex", padding: "1px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700, lineHeight: 1.6, color: o.tagC, background: o.tagBg }}>{o.tag}</span> : null}
        </div>
      ))}
    </div>
  );
}

function ContextHeader({ title, hint, open, onToggle }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid #ebf0ed", background: "#fff", flexWrap: "wrap" }}>
      <strong style={{ fontSize: 12 }}>{title}</strong>
      <span style={{ fontSize: 11, color: "#94a39a" }}>{hint}</span>
      <button type="button" onClick={onToggle} style={{ marginLeft: "auto", border: "1px solid #ebf0ed", background: "#fff", borderRadius: 7, padding: "3px 9px", fontSize: 11, color: "#5a6b62", cursor: "pointer" }}>{open ? "收起原文" : "展开原文"}</button>
    </div>
  );
}

// 听力应答每题的口播：文字（逐句可点 / 可查词）+ 播放器。组件化是因为 useSentencePlayback 是 hook。
function LcrSpeaker({ item, speakerText }) {
  const audioUrl = item.audio_url || null;
  const sp = useSentencePlayback(item.sentence_timings || null, audioUrl);
  return (
    <>
      <div data-no-dict style={{ display: "flex" }}>
        <AudioPlayer ref={sp.playerRef} compact playbackRateControl src={audioUrl} text={speakerText} isPractice onTime={sp.onTime} />
      </div>
      {speakerText ? (
        <WordLookupLayer passage={speakerText} source="listening" onPlaySentence={sp.onPlaySentence} listeningAudio={{ audioUrl, timings: sp.timings }}
          style={{ fontFamily: READ_FONT, fontSize: 13.5, lineHeight: 1.7, fontStyle: "italic", padding: "7px 12px", background: "#fafbfa", borderLeft: "3px solid #8B5CF6", borderRadius: "0 8px 8px 0" }}>
          <span style={{ fontStyle: "normal", fontSize: 11, fontWeight: 700, color: "#8B5CF6", marginRight: 6, fontFamily: "inherit" }}>Speaker</span>
          <SentenceTranscript timings={sp.timings} transcript={speakerText} activeIndex={sp.activeIndex} onPick={sp.onPick} />
        </WordLookupLayer>
      ) : null}
    </>
  );
}

export function McqReview({ session, subtype, model, vid, ctx }) {
  const d = session.details || {};
  const results = useMemo(() => (Array.isArray(d.results) ? d.results : []), [d.results]);
  const questions = useMemo(() => (Array.isArray(d.questions) ? d.questions : []), [d.questions]);
  const items = Array.isArray(d.items) ? d.items : [];
  const isLcr = subtype === "lcr";
  const isPassage = subtype === "rdl" || subtype === "ap";
  const isReading = isPassage;
  const isTurns = subtype === "lc";
  const isTranscript = subtype === "la" || subtype === "lat";
  const hasCtx = !isLcr;

  const passage = d.passage || "";
  const transcript = d.transcript || d.passage || "";
  const conversation = Array.isArray(d.conversation) ? d.conversation : Array.isArray(d.turns) ? d.turns : [];
  const audioUrl = d.audio_url || null;
  const audioText = transcript || conversation.map((t) => t.text || t.content || "").join(" ");
  const sp = useSentencePlayback(d.sentence_timings || null, audioUrl);
  const readingAi = useReadingAiExplain();
  const listeningAi = useListeningAiExplain();
  const [ctxOpen, setCtxOpen] = useState(true);
  const lookupContext = useMemo(
    () => questionLookupContext(isPassage ? passage : audioText, questions.length ? questions : results),
    [isPassage, passage, audioText, questions, results],
  );

  const paras = useMemo(() => {
    if (!isPassage) return [];
    let num = 0;
    return passage.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean).map((t) => {
      const head = !/[.!?]$/.test(t);
      if (!head) num += 1;
      return { text: t, head, num: head ? "" : `¶${num}` };
    });
  }, [isPassage, passage]);

  const visible = model.units.filter((u) => ctx.pass(u));
  const ctxPos = ctx.wide ? "sticky" : "static";
  const ctxMax = ctx.wide ? "calc(100vh - 240px)" : "340px";

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      {hasCtx ? (
        <div data-testid="mcq-context" style={{ flex: "1 1 380px", minWidth: 0, position: ctxPos, top: 112, background: "#fafbfa", border: "1px solid #ebf0ed", borderRadius: 12, overflow: "hidden" }}>
          <ContextHeader title={isPassage ? "原文" : "原文精听"} hint={isPassage ? "点任意词查释义" : "点编号逐句点播 · 点词查释义"} open={ctxOpen} onToggle={() => setCtxOpen(!ctxOpen)} />
          {!isPassage && (audioUrl || audioText) ? (
            <div data-no-dict style={{ padding: "10px 14px 0", display: "flex" }}>
              <AudioPlayer ref={sp.playerRef} compact playbackRateControl src={audioUrl} text={audioText} isPractice onTime={sp.onTime} />
            </div>
          ) : null}
          {ctxOpen ? (
            <div style={{ maxHeight: ctxMax, overflow: "auto", padding: "12px 16px 16px", fontFamily: READ_FONT, fontSize: 14, lineHeight: 1.85 }}>
              {isPassage ? (
                <WordLookupLayer passage={passage}>
                  {paras.map((p, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                      <span data-no-dict style={{ width: 22, flexShrink: 0, fontSize: 10, fontWeight: 700, color: "#94a39a", paddingTop: 5, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{p.num}</span>
                      <p style={{ margin: 0, flex: 1, minWidth: 0, fontWeight: p.head ? 700 : 400, whiteSpace: "pre-wrap" }}>{p.text}</p>
                    </div>
                  ))}
                  {paras.length === 0 ? <Ghost>这条记录没有保存原文。</Ghost> : null}
                </WordLookupLayer>
              ) : null}
              {isTranscript ? (
                <WordLookupLayer passage={transcript} source="listening" onPlaySentence={sp.onPlaySentence} listeningAudio={{ audioUrl, timings: sp.timings }} style={{ whiteSpace: "pre-wrap" }}>
                  <SentenceTranscript timings={sp.timings} transcript={transcript} activeIndex={sp.activeIndex} onPick={sp.onPick} />
                </WordLookupLayer>
              ) : null}
              {isTurns ? (
                <WordLookupLayer passage={audioText} source="listening" onPlaySentence={sp.onPlaySentence} listeningAudio={{ audioUrl, timings: sp.timings }}>
                  {conversation.length > 0
                    ? <SentenceTranscript variant="turns" timings={sp.timings} conversation={conversation} activeIndex={sp.activeIndex} onPick={sp.onPick} />
                    : <div style={{ whiteSpace: "pre-wrap" }}>{transcript}</div>}
                </WordLookupLayer>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ flex: "1 1 400px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <WordLookupLayer passage={lookupContext} source={isReading ? "reading" : "listening"} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visible.map((u) => {
            const i = u.idx;
            const r = results[i] || {};
            const q = (isLcr ? items[i] : questions[i]) || {};
            const ok = u.lv === "ok";
            const o = ctx.isOpen(i);
            const key = `${vid}:${i}`;
            const correctKey = r.correct || q.answer || q.correct_answer || "";
            const options = optionList(q, r, correctKey);
            const insert = !isLcr ? insertStemParts(q) : null;
            const selectMode = isSentenceSelection(q);
            const speakerText = isLcr ? String(q.speaker || q.stem || r.stem || "") : "";
            const stem = String(q.stem || r.stem || "");
            const explanation = q.explanation || r.explanation || "";
            const L = LV[ok ? "ok" : "bad"];
            const summary = ok ? `${r.selected || "—"} ✓` : `你选 ${r.selected || "—"} · 正确 ${correctKey || "—"}`;
            const hasFace = stem || speakerText || options.length > 0;
            return (
              <ReviewCard key={i} dataKey={key} open={o} lv={u.lv}
                head={({ headBg }) => (
                  <button type="button" data-no-dict aria-expanded={o} onClick={() => ctx.toggle(i)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: headBg, border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                    <Mark lv={ok ? "ok" : "bad"} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#94a39a", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>Q{u.n}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1a2420" }}>{isLcr ? `“${speakerText}”` : u.text}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: L.c, whiteSpace: "nowrap", flexShrink: 0 }}>{summary}</span>
                    <Chev open={o} />
                  </button>
                )}>
                {isLcr ? <LcrSpeaker item={q} speakerText={speakerText} /> : null}
                {!isLcr && insert ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 12, color: "#5a6b62", lineHeight: 1.55 }}>{insert.lead}</div>
                    <div style={{ fontFamily: READ_FONT, fontSize: 13.5, fontWeight: 600, lineHeight: 1.6, padding: "8px 12px", borderRadius: 8, background: "#EEF2FF", border: "1px solid #C7D2FE", color: "#3730A3" }}>{insert.sentence}</div>
                    {insert.tail ? <div style={{ fontSize: 13, fontWeight: 600 }}>{insert.tail}</div> : null}
                  </div>
                ) : null}
                {!isLcr && !insert && selectMode ? (
                  <div>
                    <div style={{ fontSize: 11, color: "#94a39a", marginBottom: 3 }}>选句题{Number.isInteger(q.paragraph) ? ` · 第 ${q.paragraph} 段` : ""} · 选项为该段各句</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.6 }}>{stem}</div>
                    {/* 选项是该段的每一句，段落长了不好比 —— 直接把你选的句子与正确句子写出来（历史页同一口径）。 */}
                    <div data-testid="ss-history-detail" style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3, fontSize: 12, lineHeight: 1.6, fontWeight: 600 }}>
                      <div style={{ color: ok ? LV.ok.c : LV.bad.c }}>{`你选的句子：${sentenceOptionText(q, r.selected) || "未作答"}${ok ? " ✓" : ""}`}</div>
                      {!ok ? <div style={{ color: LV.ok.c }}>{`正确句子：${sentenceOptionText(q, correctKey)}`}</div> : null}
                    </div>
                  </div>
                ) : null}
                {!isLcr && !insert && !selectMode && stem ? <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.6 }}>{stem}</div> : null}
                {options.length ? <Options options={options} /> : <div style={{ fontSize: 12, color: "#5a6b62" }}>选择: {r.selected || "—"}{!ok ? <span style={{ color: LV.bad.c }}> (正确: {correctKey || "—"})</span> : null}</div>}
                {explanation ? (
                  <div style={{ fontSize: 12, lineHeight: 1.7, color: "#78350F", padding: "8px 12px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8 }}>
                    <strong style={{ marginRight: 6, color: "#B45309" }}>解析</strong>{explanation}
                  </div>
                ) : null}
                {hasFace ? (
                  <div data-no-dict>
                    {isReading ? (
                      <ReadingAiExplainBlock variant="review" includeCorrect explainKey={`${session.id}-q${i}`}
                        detail={{ qid: q.qid || `${d.itemId || ""}-q${i}`, stem, question: q, options: q.options, selected: r.selected, correct: correctKey, passage, isCorrect: ok }}
                        {...readingAi} />
                    ) : isLcr ? (
                      <ListeningAiExplainBlock variant="review" includeCorrect explainKey={`${session.id}-lcr${i}`}
                        detail={{ subtype: "lcr", qid: q.id || `${session.id}-lcr${i}`, speaker: speakerText, situation: q.situation || d.topic || "", pragmaticFunction: q.pragmatic_function || "", options: q.options || r.options || {}, selected: r.selected, correct: correctKey, isCorrect: ok }}
                        {...listeningAi} />
                    ) : (
                      <ListeningAiExplainBlock variant="review" includeCorrect explainKey={`${session.id}-q${i}`}
                        detail={{ subtype: d.subtype || subtype, qid: q.qid || `${d.itemIds?.[0] || session.id}-q${i}`, stem, contextText: transcript || (isTurns ? conversationText(conversation) : ""), options: q.options || r.options || {}, selected: r.selected, correct: correctKey, isCorrect: ok }}
                        {...listeningAi} />
                    )}
                  </div>
                ) : null}
              </ReviewCard>
            );
          })}
        </WordLookupLayer>
        {visible.length === 0 ? <EmptyNote>{ctx.emptyText}</EmptyNote> : null}
      </div>
    </div>
  );
}
