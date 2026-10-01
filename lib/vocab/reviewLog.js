"use client";
/** 复习日志按账号隔离；旧版无归属日志保留在原 key，不自动认领。 */

import { getSavedCode } from "../AuthContext";

const LEGACY_KEY = "toefl-vocab-logs";
const BATCH = 200;
const KEEP_SYNCED = 4000;
const REQUEST_TIMEOUT_MS = 15000;
const unsaved = new Map();
const pushing = new Map();

const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

function accountKey() {
  if (!isBrowser()) return "guest";
  try { return String(getSavedCode() || localStorage.getItem("toefl-user-code") || "").trim().toUpperCase() || "guest"; }
  catch { return "guest"; }
}

function keyFor(account) {
  return `${LEGACY_KEY}::${account === "guest" ? "guest" : `user:${account}`}`;
}

function logId(log) {
  return `${log.w}\u0000${log.at}\u0000${log.mode || "reading"}`;
}

function stored(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "{}");
    return { logs: Array.isArray(raw.logs) ? raw.logs : [], synced: Math.max(0, Number(raw.synced) || 0) };
  } catch { return { logs: [], synced: 0 }; }
}

function mergeStates(a, b) {
  const entries = new Map();
  const accepted = new Set();
  for (const state of [a, b]) {
    state.logs.forEach((log, index) => {
      const id = logId(log);
      if (!entries.has(id)) entries.set(id, log);
      if (index < state.synced) accepted.add(id);
    });
  }
  const synced = [];
  const pending = [];
  for (const [id, log] of entries) (accepted.has(id) ? synced : pending).push(log);
  return { logs: [...synced, ...pending], synced: synced.length };
}

function acknowledge(state, confirmed) {
  const accepted = [];
  const pending = [];
  state.logs.forEach((log, index) => {
    (index < state.synced || confirmed.has(logId(log)) ? accepted : pending).push(log);
  });
  return { logs: [...accepted, ...pending], synced: accepted.length };
}

function read(account) {
  if (!isBrowser()) return { logs: [], synced: 0 };
  const key = keyFor(account);
  const disk = stored(key);
  return unsaved.has(key) ? mergeStates(unsaved.get(key), disk) : disk;
}

function write(account, state, { replace = false } = {}) {
  const key = keyFor(account);
  const next = replace ? state : mergeStates(state, stored(key));
  try {
    localStorage.setItem(key, JSON.stringify(next));
    unsaved.delete(key);
  } catch {
    unsaved.set(key, next);
  }
}

/** 记录评分发生时的账号，即使异步上传期间切换登录态也不会串号。 */
export function appendReviewLog(prev, next, rating, now = new Date(), durationMs = null, mode = "reading", expectedAccount = null) {
  if (!isBrowser() || !prev?.word) return;
  const account = accountKey();
  if (expectedAccount != null && account !== expectedAccount) return;
  const at = new Date(now);
  const elapsedDays = prev.lastReview
    ? Math.max(0, (at.getTime() - new Date(prev.lastReview).getTime()) / 86400000)
    : 0;
  const entry = {
    w: prev.word,
    mode: mode === "listening" ? "listening" : "reading",
    r: rating,
    st: prev.state,
    el: Math.round(elapsedDays * 100) / 100,
    sd: next?.scheduledDays ?? 0,
    s: next?.stability != null ? Math.round(next.stability * 1000) / 1000 : null,
    d: next?.difficulty != null ? Math.round(next.difficulty * 1000) / 1000 : null,
    ms: durationMs == null ? null : Math.min(600000, Math.max(0, Math.round(durationMs))),
    at: at.toISOString(),
  };
  const state = read(account);
  write(account, { logs: [...state.logs, entry], synced: state.synced });
}

/**
 * 撤销评分时把刚记的那条日志拿掉（按 词 + 时间戳 + 模式 认条目）。
 * 已经上传到云端的那条拿不回来 —— 日志是「发生过的事」的流水，不改写已同步的历史，
 * 返回 false 让调用方知道；本地还没上传的才删。
 */
export function removeReviewLog(word, at, mode = "reading", expectedAccount = null) {
  if (!isBrowser() || !word) return false;
  const account = accountKey();
  if (expectedAccount != null && account !== expectedAccount) return false;
  const state = read(account);
  const id = logId({ w: word, at: new Date(at).toISOString(), mode: mode === "listening" ? "listening" : "reading" });
  const index = state.logs.findIndex((log) => logId(log) === id);
  if (index < 0 || index < state.synced) return false;
  write(account, { logs: state.logs.filter((_, i) => i !== index), synced: state.synced }, { replace: true });
  return true;
}

async function sendBatch(code, chunk) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const res = await fetch("/api/vocab/logs", {
          method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, logs: chunk }),
        });
        if (!res.ok) return { ok: false, retryable: res.status === 429 || res.status >= 500 };
        return { ok: true, body: await res.json() };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("request timeout")); }, REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

/** 上传固定账号的快照；新追加的日志留待下一次。 */
export async function pushReviewLogs(expectedAccount = null) {
  if (!isBrowser()) return { ok: false, reason: "ssr" };
  const code = accountKey();
  if (code === "guest") return { ok: false, reason: "anonymous" };
  if (expectedAccount != null && code !== expectedAccount) return { ok: false, reason: "account-changed" };
  if (pushing.has(code)) return pushing.get(code);
  const task = (async () => {
    const state = read(code);
    const pending = state.logs.slice(state.synced);
    if (!pending.length) return { ok: true, pushed: 0 };
    let pushed = 0;
    let retryable = false;
    for (let i = 0; i < pending.length; i += BATCH) {
      if (accountKey() !== code) break;
      const chunk = pending.slice(i, i + BATCH);
      let res;
      try { res = await sendBatch(code, chunk); }
      catch { retryable = true; break; }
      if (!res?.ok) { retryable = !!res?.retryable; break; }
      if (res.body?.ok !== true) break;
      pushed += chunk.length;
      // A second tab may trim or reorder the old synced prefix while this
      // request is in flight. Acknowledge only the exact receipt's log IDs.
      const cur = read(code);
      write(code, acknowledge(cur, new Set(chunk.map(logId))));
    }
    return { ok: pushed === pending.length, pushed, retryable };
  })();
  pushing.set(code, task);
  try { return await task; }
  finally {
    pushing.delete(code);
    // Only prune confirmed cloud copies. Never trim pending logs, including
    // entries appended while a batch was in flight.
    const cur = read(code);
    const drop = Math.max(0, cur.synced - KEEP_SYNCED);
    if (drop) write(code, { logs: cur.logs.slice(drop), synced: cur.synced - drop }, { replace: true });
  }
}

/** 当前账号（含游客）的本地条数；旧全局日志可从原 key 手工导出。 */
export function localLogCount() {
  return read(accountKey()).logs.length;
}
