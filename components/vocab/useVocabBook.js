"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadBook,
  loadLimits,
  saveLimits,
  gradeCard,
  removeWord,
  setWordProductive,
  resetCard,
  initVocabSync,
  VOCAB_UPDATED_EVENT,
} from "../../lib/vocab/vocabStore";
import { AUTH_CHANGED_EVENT, getSavedCode } from "../../lib/AuthContext";
import { activeCards, bookStats, buildQueue, DEFAULT_LIMITS } from "../../lib/vocab/book";
import { currentScheduleParams } from "../../lib/vocab/vocabStore";
import { DEFAULT_PARAMS } from "../../lib/vocab/srs";

/**
 * 单词本的 React 接口。
 *
 * SSR 安全：初值一律空，真正的数据在 useEffect 里从 localStorage 读 ——
 * 服务端渲染的 HTML 里不能带用户数据，否则 hydration 会对不上。
 */
export function useVocabBook() {
  const [cards, setCards] = useState([]);
  const [limits, setLimitsState] = useState(DEFAULT_LIMITS);
  const [ready, setReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // 每次评分都推进这个值，让 stats/queue 里的 now 重算（否则跨过整点也不刷新）
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setCards(activeCards(loadBook()));
    setLimitsState(loadLimits());
    setIsLoggedIn(!!getSavedCode());
    setReady(true);
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(VOCAB_UPDATED_EVENT, refresh);
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    const stopSync = initVocabSync(refresh);
    return () => {
      window.removeEventListener(VOCAB_UPDATED_EVENT, refresh);
      window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
      stopSync();
    };
  }, [refresh]);

  const stats = useMemo(
    () => bookStats(cards, new Date(), limits),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, limits, tick],
  );

  const makeQueue = useCallback(
    () => buildQueue(loadBook(), new Date(), loadLimits()),
    [],
  );

  const grade = useCallback(
    (word, rating, durationMs) => gradeCard(word, rating, new Date(), undefined, durationMs),
    [],
  );
  const remove = useCallback((word) => removeWord(word), []);
  const setProductive = useCallback((word, productive) => setWordProductive(word, productive), []);
  const reset = useCallback((word) => resetCard(word), []);
  const setLimits = useCallback((next) => {
    saveLimits(next);
    setLimitsState(loadLimits());
  }, []);

  // 设了考试日期的用户会被自动收紧排期；考前 10 天进冲刺档（留存率 0.9 → 0.95）。
  // 这是算法在背后做的事，UI 得说一声，否则用户只会觉得「怎么突然多了这么多词」。
  const schedule = useMemo(() => {
    const p = currentScheduleParams(new Date());
    return {
      sprint: p.requestRetention != null && p.requestRetention > DEFAULT_PARAMS.requestRetention,
      maxIntervalDays: p.maximumInterval ?? null,
      retention: p.requestRetention ?? DEFAULT_PARAMS.requestRetention,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return { cards, stats, limits, setLimits, ready, isLoggedIn, refresh, makeQueue, grade, remove, setProductive, reset, schedule };
}
