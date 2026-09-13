"use client";
import { useCallback, useEffect, useState } from "react";
import { loadBook, loadLimits, VOCAB_UPDATED_EVENT, syncVocabCloud } from "../../lib/vocab/vocabStore";
import { AUTH_CHANGED_EVENT } from "../../lib/AuthContext";
import { activeCards, bookStats } from "../../lib/vocab/book";

/**
 * 首页入口用的轻量摘要：只要「今天该过几个词 / 一共收了几个」。
 * 挂载时顺手拉一次云端，这样换设备打开首页角标就是对的。
 *
 * SSR 安全：初值全 0，真数据在 useEffect 里补 —— 服务端渲染不能带用户数据。
 */
export function useVocabSummary() {
  const [summary, setSummary] = useState({ total: 0, todo: 0, dueReview: 0, newToday: 0, ready: false });

  const refresh = useCallback(() => {
    const stats = bookStats(activeCards(loadBook()), new Date(), loadLimits());
    setSummary({ ...stats, ready: true });
  }, []);

  useEffect(() => {
    refresh();
    syncVocabCloud().then((r) => {
      if (r && r.ok) refresh();
    });
    window.addEventListener(VOCAB_UPDATED_EVENT, refresh);
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener(VOCAB_UPDATED_EVENT, refresh);
      window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
    };
  }, [refresh]);

  return summary;
}
