"use client";
import React, { useEffect, useId, useRef } from "react";
import { WordLookupLayer } from "../reading/WordLookupLayer";
import { usePassageNotes } from "./usePassageNotes";
import { NoteCard, SELECTION_CSS } from "./NotedPassage";
import { findSentenceRange } from "../../lib/notes/passageFlash";
import { setHighlightRanges, clearHighlightRanges } from "../../lib/notes/highlightRegistry";
import { useVocabMarks } from "./useVocabMarks";

// 划词词典 + 划词问 AI，给「内容不是一整篇纯文字」的地方用（挖空的填词原文、听力逐句原文、题干和选项…）：
// 用法和 WordLookupLayer 一样，children 原样渲染；Pro 用户选中几个词 / 一句就能问 AI，
// 笔记卡统一排在这块内容的最后（默认收起），问过的地方用 CSS 高亮标出来（点不了，点笔记卡展开）。
// 笔记、额度和 NotedPassage 是同一套（passage_notes，每天 30 轮），passage 就是 AI 看到的「原文」。

export const SAVED_HIGHLIGHT = "note-saved";
const SAVED_CSS = `::highlight(${SAVED_HIGHLIGHT}) { background-color: rgba(254, 243, 199, 0.9); text-decoration: underline 2px #F59E0B; text-underline-offset: 3px; }`;

export function NotedLookup({ passage, source = "reading", children, style, onPlaySentence, listeningAudio }) {
  const notes = usePassageNotes(passage, { source });
  const id = useId();
  const bodyRef = useRef(null);
  const cardsRef = useRef(null);
  const placed = notes.placed;
  useVocabMarks(bodyRef, passage);
  const quotes = placed.map((p) => p.note.quote).join("\u0001");

  useEffect(() => {
    const root = bodyRef.current;
    setHighlightRanges(SAVED_HIGHLIGHT, id, root ? placed.map((p) => findSentenceRange(root, p.note.quote)).filter(Boolean) : []);
    return () => clearHighlightRanges(SAVED_HIGHLIGHT, id);
  }, [id, quotes]); // eslint-disable-line react-hooks/exhaustive-deps

  // 新问的那一处：笔记卡排在最后，外面是限高滚动框时要滚到看得见。
  const draftId = placed.find((p) => p.note.draft)?.note.id || null;
  useEffect(() => {
    if (!draftId || !cardsRef.current) return;
    const el = cardsRef.current.querySelector(`[data-note-id="${draftId}"]`);
    el?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [draftId]);

  return (
    <>
      {/* 样式表放在划词层外面：放里面的话，它的文字会被当成原文的一部分（取「所在原句」时混进去） */}
      <style dangerouslySetInnerHTML={{ __html: SELECTION_CSS + SAVED_CSS }} />
      <WordLookupLayer passage={passage} style={style} source={source} onPlaySentence={onPlaySentence} listeningAudio={listeningAudio} notes={notes}>
        <div data-noted-lookup ref={bodyRef} style={{ display: "contents" }}>
          {children}
        </div>
        {placed.length ? (
          <div ref={cardsRef} data-no-dict data-testid="noted-lookup-cards" style={{ marginTop: 6 }}>
            {placed.map((p) => (
              <div key={p.note.id} data-note-id={p.note.id}>
                <NoteCard placed={p} notes={notes} />
              </div>
            ))}
          </div>
        ) : null}
      </WordLookupLayer>
    </>
  );
}
