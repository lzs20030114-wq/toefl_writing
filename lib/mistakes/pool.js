// 错题池：本地优先、按账号分 key 的 localStorage 存储（仿 lib/vocab/vocabStore 的 ::user:CODE / ::guest）。
//
// 设计口径（docs/mistake-notebook-redesign-2026-10-06.md，2026-10-06 用户拍板）：
//   - 一题一条、跨练习去重、记错几次；可收藏 ☆、可手动「移出错题本」；
//   - **不做**掌握判定 / 今日队列 / 间隔重复 —— 练错题后只回写 lastDrill 供展示；
//   - 池不是唯一真源：每次打开都从练习记录（loadHist）重新派生合并，只加不减，
//     所以换设备时与旧版「从记录现算」持平，本机还能多保住被 200 条上限挤掉的老错题。
//
// 结构：{ v, cards: { [key]: card }, items: { [itemKey]: 篇级快照 }, drills: [练习日志], favMigrated }
// 篇级快照（文章 / 原文 / 题目）按 itemKey 只存一份，卡片只存小快照 brief，防 localStorage 配额。

import { getSavedCode } from "../AuthContext";
import { extractMistakeEntries, SUBTYPE_META } from "./extract";

const BASE_KEY = "toefl-mistake-pool-v1";
const AUTH_STORAGE_KEY = "toefl-user-code";
const MAX_SIDS = 40;
const MAX_DRILLS = 30;
export const MISTAKE_POOL_UPDATED_EVENT = "toefl-mistake-pool-updated";

const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

export function getMistakeAccountKey() {
  if (!isBrowser()) return "guest";
  try {
    const code = String(getSavedCode() || localStorage.getItem(AUTH_STORAGE_KEY) || "").trim().toUpperCase();
    return code || "guest";
  } catch {
    return "guest";
  }
}

function scopedKey(account) {
  return `${BASE_KEY}::${account === "guest" ? "guest" : `user:${account}`}`;
}

export function emptyPool() {
  return { v: 1, cards: {}, items: {}, drills: [], favMigrated: false };
}

function normalizePool(raw) {
  const p = emptyPool();
  if (!raw || typeof raw !== "object") return p;
  if (raw.cards && typeof raw.cards === "object") p.cards = raw.cards;
  if (raw.items && typeof raw.items === "object") p.items = raw.items;
  if (Array.isArray(raw.drills)) p.drills = raw.drills;
  p.favMigrated = !!raw.favMigrated;
  return p;
}

function readPoolFor(account) {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(scopedKey(account));
    return raw ? normalizePool(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function emitUpdated() {
  if (typeof window === "undefined") return;
  try { window.dispatchEvent(new CustomEvent(MISTAKE_POOL_UPDATED_EVENT)); } catch {}
}

/* ── 合并（纯函数） ─────────────────────────────────────── */

function laterIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(b) > new Date(a) ? b : a;
}

/** 把 guest 池并进账号池：卡片按 key 合并（收藏取或、错次取大），篇级快照缺啥补啥。 */
export function mergePools(base, extra) {
  const out = normalizePool(JSON.parse(JSON.stringify(base || emptyPool())));
  const add = normalizePool(extra);
  for (const [key, c] of Object.entries(add.cards)) {
    const cur = out.cards[key];
    if (!cur) { out.cards[key] = c; continue; }
    const sids = [...new Set([...(cur.sids || []), ...(c.sids || [])])].slice(-MAX_SIDS);
    out.cards[key] = {
      ...cur,
      sids,
      wrongCount: Math.max(cur.wrongCount || 0, c.wrongCount || 0, sids.length),
      lastWrongAt: laterIso(cur.lastWrongAt, c.lastWrongAt),
      starred: !!(cur.starred || c.starred),
      lastDrill: (c.lastDrill && (!cur.lastDrill || new Date(c.lastDrill.at) > new Date(cur.lastDrill.at))) ? c.lastDrill : cur.lastDrill,
      updatedAt: laterIso(cur.updatedAt, c.updatedAt),
    };
  }
  for (const [k, it] of Object.entries(add.items)) if (!out.items[k]) out.items[k] = it;
  out.drills = [...out.drills, ...add.drills].sort((a, b) => new Date(a.at) - new Date(b.at)).slice(-MAX_DRILLS);
  return out;
}

/**
 * 把派生出的 entries 合并进池。同一题同一次练习（sid）只算一次；新的一次练习里又错 → 错次 +1，
 * 若这题之前被用户移出、而这次出错晚于移出时间 → 重新回到错题本。
 * 返回 { pool, changed }，不改入参。
 */
export function mergeEntries(pool, entries, now = new Date().toISOString()) {
  const out = normalizePool(pool);
  out.cards = { ...out.cards };
  out.items = { ...out.items };
  let changed = false;
  for (const e of entries || []) {
    if (!e || !e.key) continue;
    const sid = e.source?.sid || "";
    const date = e.source?.date || now;
    if (e.item && e.itemKey) {
      const prev = out.items[e.itemKey];
      if (!prev || (prev.pruned && !e.item.pruned)) {
        out.items[e.itemKey] = e.item;
        changed = true;
      }
    }
    const cur = out.cards[e.key];
    if (!cur) {
      out.cards[e.key] = {
        key: e.key,
        subject: e.subject,
        subtype: e.subtype,
        itemKey: e.itemKey || null,
        index: e.index ?? null,
        brief: e.brief,
        wrongCount: 1,
        firstWrongAt: date,
        lastWrongAt: date,
        real: !!e.source?.real,
        mock: !!e.source?.mock,
        starred: false,
        lastDrill: null,
        sids: sid ? [sid] : [],
        updatedAt: now,
        deletedAt: null,
      };
      changed = true;
      continue;
    }
    if (sid && (cur.sids || []).includes(sid)) continue;
    const next = { ...cur };
    next.sids = [...(cur.sids || []), sid].filter(Boolean).slice(-MAX_SIDS);
    next.wrongCount = (cur.wrongCount || 0) + 1;
    if (!cur.lastWrongAt || new Date(date) >= new Date(cur.lastWrongAt)) {
      next.lastWrongAt = date;
      next.brief = e.brief;
      next.mock = !!e.source?.mock;
      if (e.itemKey) next.itemKey = e.itemKey;
    }
    if (!cur.firstWrongAt || new Date(date) < new Date(cur.firstWrongAt)) next.firstWrongAt = date;
    next.real = !!(cur.real || e.source?.real);
    if (cur.deletedAt && new Date(date) > new Date(cur.deletedAt)) next.deletedAt = null;
    next.updatedAt = now;
    out.cards[e.key] = next;
    changed = true;
  }
  return { pool: out, changed };
}

/* ── 读写 ─────────────────────────────────────────────── */

export function loadPool() {
  if (!isBrowser()) return emptyPool();
  const account = getMistakeAccountKey();
  const mine = readPoolFor(account) || emptyPool();
  if (account === "guest") return mine;
  const guest = readPoolFor("guest");
  if (guest && Object.keys(guest.cards).length > 0) {
    const merged = mergePools(mine, guest);
    if (writePoolFor(account, merged, { silent: true })) {
      try { localStorage.removeItem(scopedKey("guest")); } catch {}
    }
    return merged;
  }
  return mine;
}

const HEAVY_FIELDS = ["passage", "transcript", "conversation", "questions", "blanks", "sentence_timings"];

/** 配额兜底：先把最久没再错过的篇的正文/题目精简掉（卡片 brief 仍能渲染，只是不能整篇重做），再丢日志。 */
function pruneForQuota(pool, round) {
  const lastUse = {};
  for (const c of Object.values(pool.cards)) {
    if (!c.itemKey) continue;
    const t = new Date(c.lastWrongAt || 0).getTime();
    if (!(c.itemKey in lastUse) || t > lastUse[c.itemKey]) lastUse[c.itemKey] = t;
  }
  const candidates = Object.keys(pool.items)
    .filter((k) => !pool.items[k]?.pruned && HEAVY_FIELDS.some((f) => pool.items[k]?.[f]))
    .sort((a, b) => (lastUse[a] || 0) - (lastUse[b] || 0));
  if (candidates.length === 0) {
    if (pool.drills.length > 0 && round < 50) { pool.drills = pool.drills.slice(Math.ceil(pool.drills.length / 2)); return true; }
    return false;
  }
  const batch = Math.max(5, Math.ceil(candidates.length / 4));
  candidates.slice(0, batch).forEach((k) => {
    const it = { ...pool.items[k] };
    HEAVY_FIELDS.forEach((f) => { if (f in it) delete it[f]; });
    it.pruned = true;
    pool.items[k] = it;
  });
  return true;
}

function writePoolFor(account, pool, { silent = false } = {}) {
  if (!isBrowser()) return false;
  const key = scopedKey(account);
  let working = pool;
  for (let round = 0; round < 60; round += 1) {
    try {
      localStorage.setItem(key, JSON.stringify(working));
      if (!silent) emitUpdated();
      return true;
    } catch {
      working = { ...working, items: { ...working.items }, drills: [...working.drills] };
      if (!pruneForQuota(working, round)) break;
    }
  }
  return false;
}

export function savePool(pool, opts) {
  return writePoolFor(getMistakeAccountKey(), normalizePool(pool), opts);
}

/** 从练习记录派生并合并进当前账号的池；有变化才写盘（并发事件）。 */
export function syncPoolFromSessions(sessions) {
  const pool = loadPool();
  const { pool: next, changed } = mergeEntries(pool, extractMistakeEntries(sessions));
  if (changed) savePool(next);
  return changed ? next : pool;
}

function mutateCards(keys, fn) {
  const pool = loadPool();
  const now = new Date().toISOString();
  let changed = false;
  for (const k of keys || []) {
    const c = pool.cards[k];
    if (!c) continue;
    const next = fn({ ...c }, now);
    if (next) { pool.cards[k] = { ...next, updatedAt: now }; changed = true; }
  }
  if (changed) savePool(pool);
  return pool;
}

export function setStarred(key, starred) {
  return mutateCards([key], (c) => ({ ...c, starred: !!starred }));
}

/** 用户手动移出错题本（软删除；之后在新的练习里再错会自动回来）。 */
export function removeCards(keys) {
  return mutateCards(keys, (c, now) => ({ ...c, deletedAt: now }));
}

export function restoreCards(keys) {
  return mutateCards(keys, (c) => ({ ...c, deletedAt: null }));
}

/**
 * 记一次「练错题」：每题回写 lastDrill（仅展示用，不做任何自动判定），并追加一条练习日志。
 * results: [{ key, correct }]；log: { total, correct, durationSec, byType, filters }
 */
export function recordDrill(results, log) {
  const at = new Date().toISOString();
  const map = new Map((results || []).filter((r) => r && r.key).map((r) => [r.key, !!r.correct]));
  const pool = loadPool();
  for (const [k, correct] of map) {
    const c = pool.cards[k];
    if (c) pool.cards[k] = { ...c, lastDrill: { at, correct }, updatedAt: at };
  }
  if (log) pool.drills = [...pool.drills, { at, ...log }].slice(-MAX_DRILLS);
  savePool(pool);
  return pool;
}

export function markFavoritesMigrated(starKeys, extraCards = []) {
  const pool = loadPool();
  const now = new Date().toISOString();
  for (const c of extraCards) if (c && c.key && !pool.cards[c.key]) pool.cards[c.key] = c;
  for (const k of starKeys || []) if (pool.cards[k]) pool.cards[k] = { ...pool.cards[k], starred: true, updatedAt: now };
  pool.favMigrated = true;
  savePool(pool);
  return pool;
}

/* ── 查询（纯函数） ─────────────────────────────────────── */

export function activeCards(pool) {
  return Object.values(pool?.cards || {}).filter((c) => c && !c.deletedAt);
}

export function summarizePool(pool, now = Date.now()) {
  const cards = activeCards(pool);
  const bySubtype = {};
  const bySubject = { bs: 0, reading: 0, listening: 0 };
  let starred = 0;
  let weekNew = 0;
  let neverDrilled = 0;
  const weekAgo = now - 7 * 24 * 3600 * 1000;
  for (const c of cards) {
    bySubtype[c.subtype] = (bySubtype[c.subtype] || 0) + 1;
    if (c.subject in bySubject) bySubject[c.subject] += 1;
    if (c.starred) starred += 1;
    if (new Date(c.firstWrongAt || 0).getTime() >= weekAgo) weekNew += 1;
    if (!c.lastDrill) neverDrilled += 1;
  }
  const drills = pool?.drills || [];
  return {
    total: cards.length,
    bySubtype,
    bySubject,
    starred,
    weekNew,
    neverDrilled,
    removed: Object.values(pool?.cards || {}).filter((c) => c && c.deletedAt).length,
    lastDrill: drills.length > 0 ? drills[drills.length - 1] : null,
  };
}

export function subtypeLabel(subtype) {
  return SUBTYPE_META[subtype]?.label || String(subtype || "").toUpperCase();
}
