"use client";
import { useCallback, useEffect, useState } from "react";
import { loadHist, SESSION_STORE_EVENTS } from "../../lib/sessionStore";
import { AUTH_CHANGED_EVENT, getSavedCode } from "../../lib/AuthContext";
import {
  MISTAKE_POOL_UPDATED_EVENT,
  emptyPool,
  getMistakeAccountKey,
  loadPool,
  markFavoritesMigrated,
  summarizePool,
  syncPoolFromSessions,
} from "../../lib/mistakes/pool";
import { bsKey } from "../../lib/mistakes/extract";
import { loadFavoritesCloud } from "../../lib/mistakeFavorites";

// 旧版「★ 收藏」存在云端 mistake_favorites（只有拼句接过 UI）。新版收藏走本地池，
// 每个账号首次打开时把旧收藏读一次并入 starred，之后不再写那张表。
// 表可能不存在（迁移台账状态「未知」）：服务端回了错误也标记已迁移，只有网络异常才下次再试。
let favMigrationInFlight = false;
async function migrateLegacyFavorites(pool) {
  if (favMigrationInFlight || pool.favMigrated) return;
  const code = String(getSavedCode() || "").trim().toUpperCase();
  if (!code) return;
  favMigrationInFlight = true;
  try {
    const { data, error } = await loadFavoritesCloud(code, { limit: 500 });
    if (getMistakeAccountKey() !== code) return;
    const favorites = error ? [] : (Array.isArray(data?.favorites) ? data.favorites : []);
    const current = loadPool();
    const starKeys = [];
    const extraCards = [];
    for (const f of favorites) {
      const snap = f?.snapshot || {};
      if ((f?.subject || "bs") !== "bs" || !snap.prompt) continue;
      const match = Object.values(current.cards).find((c) => c.subject === "bs"
        && c.brief?.prompt === snap.prompt && c.brief?.correctAnswer === snap.correctAnswer);
      if (match) { starKeys.push(match.key); continue; }
      const key = bsKey({ prompt: snap.prompt, correctAnswer: snap.correctAnswer });
      const date = snap.sessionDate || f.created_at || new Date().toISOString();
      extraCards.push({
        key, subject: "bs", subtype: "bs", itemKey: null, index: null,
        brief: { qid: null, prompt: snap.prompt, userAnswer: snap.userAnswer || "", correctAnswer: snap.correctAnswer || "", grammar_points: Array.isArray(snap.grammar_points) ? snap.grammar_points : [] },
        wrongCount: 1, firstWrongAt: date, lastWrongAt: date, real: false, mock: false,
        starred: true, lastDrill: null, sids: [`fav@${f.id}`], updatedAt: new Date().toISOString(), deletedAt: null,
      });
      starKeys.push(key);
    }
    markFavoritesMigrated(starKeys, extraCards);
  } catch {
    // 网络异常：下次打开再试
  } finally {
    favMigrationInFlight = false;
  }
}

/**
 * 错题池 hook。SSR 安全：首帧 pool 为空、ready=false，挂载后才读 localStorage
 * （2026-05-13 水合事故：useState(() => loadHist()) 服务端/客户端不一致）。
 *
 * derive=true 时每次挂载 / 练习记录更新 / 登录切换都会从 loadHist() 重新派生合并。
 */
export function useMistakePool({ derive = true, migrateFavorites = false } = {}) {
  const [pool, setPool] = useState(emptyPool);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(() => {
    const next = derive ? syncPoolFromSessions(loadHist()?.sessions || []) : loadPool();
    setPool(next);
    setReady(true);
    if (migrateFavorites && !next.favMigrated) migrateLegacyFavorites(next);
  }, [derive, migrateFavorites]);

  useEffect(() => {
    refresh();
    const reload = () => setPool(loadPool());
    const histEvent = SESSION_STORE_EVENTS?.HISTORY_UPDATED_EVENT;
    if (histEvent) window.addEventListener(histEvent, refresh);
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    window.addEventListener(MISTAKE_POOL_UPDATED_EVENT, reload);
    const onStorage = (e) => { if (!e.key || e.key.startsWith("toefl-mistake-pool-v1")) reload(); };
    window.addEventListener("storage", onStorage);
    return () => {
      if (histEvent) window.removeEventListener(histEvent, refresh);
      window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
      window.removeEventListener(MISTAKE_POOL_UPDATED_EVENT, reload);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  return { pool, ready, refresh };
}

/** 侧栏 / 移动入口用的轻量摘要。 */
export function useMistakeSummary() {
  const { pool, ready } = useMistakePool({ derive: true });
  return { ...summarizePool(pool), ready };
}
