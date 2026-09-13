"use client";
/**
 * 复习日志。
 *
 * 每打一次分写一条。这张表的用处不在当下 —— 它是以后用真实数据重新拟合 FSRS
 * 权重、做留存率校准监控的唯一原料，而且**事后补不回来**：今天没记，这段时间的
 * 复习行为就永远没了。所以从第一天就写。
 *
 * 本地是一个定长环形缓冲（只留最近 MAX_LOGS 条），云端才是长期归档；
 * 每次同步把还没推上去的批量送走，推成功了就把游标往前挪。
 */

import { getSavedCode } from "../AuthContext";

const KEY = "toefl-vocab-logs";
const MAX_LOGS = 4000;
const BATCH = 200;

const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

function read() {
  if (!isBrowser()) return { logs: [], synced: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { logs: Array.isArray(raw.logs) ? raw.logs : [], synced: Number(raw.synced) || 0 };
  } catch {
    return { logs: [], synced: 0 };
  }
}

function write(state) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 配额爆了：只留最近一半，宁可丢历史也不能让评分动作失败
    try {
      const half = state.logs.slice(-Math.floor(MAX_LOGS / 2));
      localStorage.setItem(KEY, JSON.stringify({ logs: half, synced: 0 }));
    } catch {}
  }
}

/**
 * 记一条复习。prev 是打分**之前**的卡，next 是打分之后的。
 * elapsedDays / scheduledDays 都要存 —— 拟合时需要「当时隔了多久」和「排了多久」。
 */
export function appendReviewLog(prev, next, rating, now = new Date(), durationMs = null) {
  if (!isBrowser() || !prev?.word) return;
  const at = new Date(now);
  const elapsedDays = prev.lastReview
    ? Math.max(0, (at.getTime() - new Date(prev.lastReview).getTime()) / 86400000)
    : 0;
  const entry = {
    w: prev.word,
    r: rating,
    st: prev.state,
    el: Math.round(elapsedDays * 100) / 100,
    sd: next?.scheduledDays ?? 0,
    s: next?.stability != null ? Math.round(next.stability * 1000) / 1000 : null,
    d: next?.difficulty != null ? Math.round(next.difficulty * 1000) / 1000 : null,
    ms: durationMs == null ? null : Math.min(600000, Math.max(0, Math.round(durationMs))),
    at: at.toISOString(),
  };
  const state = read();
  const logs = [...state.logs, entry];
  const overflow = Math.max(0, logs.length - MAX_LOGS);
  write({
    logs: logs.slice(overflow),
    // 丢掉队首时游标要跟着往回挪，否则会把没推送过的日志当成已推送。
    synced: Math.max(0, state.synced - overflow),
  });
}

/** 把还没推上去的日志送到云端。失败就原样留着，下次再试。 */
export async function pushReviewLogs() {
  if (!isBrowser()) return { ok: false, reason: "ssr" };
  const code = String(getSavedCode() || "").trim().toUpperCase();
  if (!code) return { ok: false, reason: "anonymous" };
  const state = read();
  const pending = state.logs.slice(state.synced);
  if (pending.length === 0) return { ok: true, pushed: 0 };

  let pushed = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch("/api/vocab/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, logs: chunk }),
    }).catch(() => null);
    if (!res || !res.ok) break;
    pushed += chunk.length;
  }
  if (pushed > 0) {
    // 重新读一次：推送期间可能又写进了新日志，不能拿旧快照覆盖。
    const cur = read();
    write({ logs: cur.logs, synced: Math.min(cur.logs.length, state.synced + pushed) });
  }
  return { ok: pushed === pending.length, pushed };
}

/** 本地留存的复习条数（调试/统计用）。 */
export function localLogCount() {
  return read().logs.length;
}
