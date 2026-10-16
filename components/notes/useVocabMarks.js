"use client";
import { useEffect, useId, useMemo, useState } from "react";
import { loadBook, VOCAB_UPDATED_EVENT } from "../../lib/vocab/vocabStore";
import { savedWordsInPassage, wordPattern } from "../../lib/vocab/passageMarks";
import { findWordRanges } from "../../lib/notes/passageFlash";
import { setHighlightRanges, clearHighlightRanges } from "../../lib/notes/highlightRegistry";

// 原文里给「在这篇里查词典收藏进单词本的词」画另一种颜色的下划线（和问过 AI 的琥珀色区分开）。
// 画法是 CSS 自定义高亮，不动 DOM；原文 DOM 变了（笔记高亮插进来、展开收起）就重找一遍。
export const VOCAB_HIGHLIGHT = "vocab-saved";
export const VOCAB_MARK_CSS = `::highlight(${VOCAB_HIGHLIGHT}) { text-decoration: underline 2px #14B8A6; text-underline-offset: 4px; color: inherit; }`;

export function useVocabMarks(rootRef, passage) {
  const key = useId();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const on = () => setVersion((v) => v + 1);
    window.addEventListener(VOCAB_UPDATED_EVENT, on);
    return () => window.removeEventListener(VOCAB_UPDATED_EVENT, on);
  }, []);

  const patterns = useMemo(
    () => (passage ? savedWordsInPassage(loadBook(), passage).map(wordPattern) : []),
    [passage, version], // eslint-disable-line react-hooks/exhaustive-deps -- version：单词本变了要重读
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !patterns.length) {
      clearHighlightRanges(VOCAB_HIGHLIGHT, key);
      return undefined;
    }
    let frame = 0;
    const draw = () => {
      frame = 0;
      setHighlightRanges(VOCAB_HIGHLIGHT, key, findWordRanges(root, patterns));
    };
    draw();
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
    const obs = typeof MutationObserver !== "undefined" ? new MutationObserver(schedule) : null;
    obs?.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      obs?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      clearHighlightRanges(VOCAB_HIGHLIGHT, key);
    };
  }, [rootRef, patterns, key]);
}
