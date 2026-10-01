"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadBook,
  loadLimits,
  saveLimits,
  gradeCard,
  removeWord,
  resetCard,
  setProductive,
  setSuspended,
  editDefinition,
  undoGrade,
  setReviewMode as setStoredReviewMode,
  initVocabSync,
  VOCAB_UPDATED_EVENT,
  getVocabAccountKey,
  getVocabStorageStatus,
} from "../../lib/vocab/vocabStore";
import { AUTH_CHANGED_EVENT, getSavedCode } from "../../lib/AuthContext";
import { activeCards, bookStats, buildQueue, forecastLoad, DEFAULT_LIMITS } from "../../lib/vocab/book";
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
  const [accountKey, setAccountKey] = useState(null);
  const [storageStatus, setStorageStatus] = useState({ persisted: true });
  // 每次评分都推进这个值，让 stats/queue 里的 now 重算（否则跨过整点也不刷新）
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    const account = getVocabAccountKey();
    setCards(loadBook());
    setLimitsState(loadLimits());
    setIsLoggedIn(!!getSavedCode());
    setAccountKey(account);
    setStorageStatus(getVocabStorageStatus());
    setReady(true);
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(VOCAB_UPDATED_EVENT, refresh);
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    const refreshTime = () => setTick((t) => t + 1);
    const timer = window.setInterval(refreshTime, 60 * 1000);
    window.addEventListener("focus", refreshTime);
    document.addEventListener("visibilitychange", refreshTime);
    const stopSync = initVocabSync(refresh);
    return () => {
      window.removeEventListener(VOCAB_UPDATED_EVENT, refresh);
      window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshTime);
      document.removeEventListener("visibilitychange", refreshTime);
      stopSync();
    };
  }, [refresh]);

  const stats = useMemo(
    () => bookStats(cards, new Date(), limits),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, limits, tick],
  );
  const statsByMode = useMemo(() => ({
    reading: bookStats(cards, new Date(), limits, "reading"),
    listening: bookStats(cards, new Date(), limits, "listening"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cards, limits, tick]);

  const forecast = useMemo(
    () => forecastLoad(cards, new Date(), limits),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, limits, tick],
  );

  const makeQueue = useCallback(
    (mode, expectedAccount = accountKey) => expectedAccount === getVocabAccountKey()
      ? buildQueue(loadBook(), new Date(), loadLimits(), Math.random, mode) : [],
    [accountKey],
  );

  const grade = useCallback(
    (word, rating, durationMs, mode, expectedAccount = accountKey) =>
      expectedAccount === getVocabAccountKey()
        ? gradeCard(word, rating, new Date(), undefined, durationMs, mode, expectedAccount) : null,
    [accountKey],
  );
  const undo = useCallback(
    (word, mode, expectedAccount = accountKey) => undoGrade(word, mode, expectedAccount),
    [accountKey],
  );
  const suspend = useCallback((word, on = true) => setSuspended(word, on), []);
  const editDef = useCallback((word, text) => editDefinition(word, text), []);
  const remove = useCallback((word) => removeWord(word), []);
  const reset = useCallback((word) => resetCard(word), []);
  const markProductive = useCallback((word, on) => setProductive(word, on), []);
  const setReviewMode = useCallback((word, mode) => setStoredReviewMode(word, mode), []);
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

  return {
    cards: activeCards(cards), stats, statsByMode, forecast, limits, setLimits, ready: ready && accountKey === getVocabAccountKey(),
    isLoggedIn, accountKey, storageStatus, refresh,
    makeQueue, grade, undo, suspend, editDef, remove, reset, setReviewMode, setProductive: markProductive, schedule,
  };
}
