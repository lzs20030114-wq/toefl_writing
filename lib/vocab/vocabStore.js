"use client";
/**
 * 单词本的存储层：localStorage 本地优先 + Supabase 云同步。
 *
 * 为什么本地优先：收藏发生在划词弹窗里，点一下必须立刻变「已收藏」，不能等网络；
 * 复习时每打一次分都要落一次状态，走网络会卡手。所以本地是唯一真源，云端只是
 * 一份可选的跨设备副本 —— 云端表没建 / 没登录 / 请求失败，功能照常能用。
 *
 * 合并策略见 book.js 的 mergeCards：按 word 取 updatedAt 新的一份，软删除
 * （deletedAt）也参与比较，所以「在手机上删掉的词」能同步到电脑。
 */

import { getSavedCode, AUTH_CHANGED_EVENT } from "../AuthContext";
import { schedule, newCardState, paramsForPlan, STATE } from "./srs";
import { loadStudyPlan } from "../studyPlan";
import { appendReviewLog, pushReviewLogs } from "./reviewLog";
import { normalizeCard, mergeCards, activeCards, needsDictFill, DEFAULT_LIMITS, MAX_CONTEXTS } from "./book";
import { parseSenses } from "../dict/core";

const BASE_KEY = "toefl-vocab-book";
const LIMITS_KEY = "toefl-vocab-limits";
const AUTH_STORAGE_KEY = "toefl-user-code";
export const VOCAB_UPDATED_EVENT = "toefl-vocab-updated";

/** 单词本上限：本地只留这么多张，超了从最早收藏且已记牢的开始丢。 */
const MAX_CARDS = 3000;

const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

function currentCode() {
  if (!isBrowser()) return "";
  const fromCtx = String(getSavedCode() || "").trim().toUpperCase();
  if (fromCtx) return fromCtx;
  return String(localStorage.getItem(AUTH_STORAGE_KEY) || "").trim().toUpperCase();
}

function scopedKey() {
  const code = currentCode();
  return `${BASE_KEY}::${code ? `user:${code}` : "guest"}`;
}

function readRaw(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.cards) ? parsed.cards : null;
  } catch {
    return null;
  }
}

function emitUpdated() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(VOCAB_UPDATED_EVENT));
  } catch {}
}

/**
 * 读单词本。登录后第一次读会把「游客态收藏的词」并进当前账号 —— 用户在没登录时
 * 划词收藏了一堆，登录后不该看见空本子。
 */
export function loadBook() {
  if (!isBrowser()) return [];
  const key = scopedKey();
  const mine = readRaw(key) || [];
  const code = currentCode();
  if (!code) return mine.map((c) => normalizeCard(c)).filter(Boolean);

  const guestKey = `${BASE_KEY}::guest`;
  const guest = readRaw(guestKey);
  if (guest && guest.length > 0) {
    const merged = mergeCards(mine, guest);
    writeBook(merged, { silent: true });
    try {
      localStorage.removeItem(guestKey);
    } catch {}
    return merged;
  }
  return mine.map((c) => normalizeCard(c)).filter(Boolean);
}

function prune(cards) {
  if (cards.length <= MAX_CARDS) return cards;
  // 先丢已软删除的，再丢「收藏最早且已记牢」的，最后才按收藏时间丢。
  const alive = cards.filter((c) => !c.deletedAt);
  if (alive.length <= MAX_CARDS) return alive;
  const sorted = [...alive].sort((a, b) => {
    const am = (a.scheduledDays || 0) >= 21 ? 1 : 0;
    const bm = (b.scheduledDays || 0) >= 21 ? 1 : 0;
    if (am !== bm) return bm - am;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
  const drop = new Set(sorted.slice(0, alive.length - MAX_CARDS).map((c) => c.word));
  return alive.filter((c) => !drop.has(c.word));
}

export function writeBook(cards, { silent = false } = {}) {
  if (!isBrowser()) return cards;
  const next = prune((cards || []).map((c) => normalizeCard(c)).filter(Boolean));
  try {
    localStorage.setItem(scopedKey(), JSON.stringify({ v: 1, cards: next }));
  } catch {
    // 配额爆了：丢掉已记牢的老词再试一次，实在不行就放弃（内存态仍然正确）。
    try {
      const trimmed = next.slice(-800);
      localStorage.setItem(scopedKey(), JSON.stringify({ v: 1, cards: trimmed }));
    } catch {}
  }
  if (!silent) emitUpdated();
  return next;
}

export function getCard(word) {
  const w = String(word || "").trim().toLowerCase();
  if (!w) return null;
  return loadBook().find((c) => c.word === w && !c.deletedAt) || null;
}

export function isSaved(word) {
  return !!getCard(word);
}

/**
 * 把一句新语境并进一张卡：主句（sentence）一旦定下就不再改写，新句子追加进
 * 语境池 sentences（上限 MAX_CONTEXTS，满了丢最早的那句）。
 * 句子为空、等于主句、或已经在池里时原样返回 prev（调用方据此判断「没变」）。
 * 主句还空着（收藏时没抓到句子）时，这句直接当主句，免得卡片有池没主句。
 */
function withSentence(prev, sentence) {
  const s = String(sentence || "").trim().slice(0, 400);
  if (!s) return prev;
  if (!prev.sentence) return { ...prev, sentence: s };
  if (s === prev.sentence) return prev;
  const pool = Array.isArray(prev.sentences) ? prev.sentences : [];
  if (pool.includes(s)) return prev;
  return { ...prev, sentences: [...pool, s].slice(-MAX_CONTEXTS) };
}

/**
 * 收藏一个词（已存在则补全缺的字段，不重置复习进度）。
 * entry: { word, display, phonetic, def, defFull, tag, sentence, source }
 */
export function saveWord(entry, now = new Date()) {
  const card = normalizeCard(entry, now);
  if (!card) return null;
  const book = loadBook();
  const idx = book.findIndex((c) => c.word === card.word);
  const nowIso = new Date(now).toISOString();

  if (idx >= 0) {
    const prev = book[idx];
    // 又在别处查到同一个词：新句子进语境池，主句不动。
    // （以前是「例句以新的为准」，直接覆盖主句。换成池是因为同一个词永远在同一句里
    //   复习会让人记住句子而不是词，而覆盖式更新连「上一句」都留不下来 ——
    //   多语境才让词义泛化到新语境，见 book.pickContext 的出处。）
    const withCtx = withSentence(prev, card.sentence);
    const revived = {
      ...withCtx,
      // 之前删过就复活，但保留原来的复习进度
      deletedAt: null,
      display: prev.display || card.display,
      phonetic: prev.phonetic || card.phonetic,
      def: prev.def || card.def,
      defFull: prev.defFull || card.defFull,
      tag: prev.tag || card.tag,
      source: prev.source || card.source,
      updatedAt: nowIso,
    };
    const next = [...book];
    next[idx] = revived;
    writeBook(next);
    scheduleSync();
    return revived;
  }

  const created = { ...card, ...newCardState(now), createdAt: nowIso, updatedAt: nowIso };
  writeBook([created, ...book]);
  scheduleSync();
  return created;
}

/**
 * 给一个已收藏的词再加一句语境（划词弹窗的「＋ 加这句语境」）。
 * 词不存在或已软删除返回 null；句子已在卡上时不重复追加，但仍返回这张卡。
 */
export function addSentence(word, sentence, now = new Date()) {
  const w = String(word || "").trim().toLowerCase();
  if (!w) return null;
  const book = loadBook();
  const idx = book.findIndex((c) => c.word === w && !c.deletedAt);
  if (idx < 0) return null;
  const prev = book[idx];
  const withCtx = withSentence(prev, sentence);
  if (withCtx === prev) return prev; // 没变化就别写盘、别触发一次同步
  const updated = { ...withCtx, updatedAt: new Date(now).toISOString() };
  const next = [...book];
  next[idx] = updated;
  writeBook(next);
  scheduleSync();
  return updated;
}

/**
 * 用户在词典弹窗里点定了某一条义项：把它设成主释义，整条词典释义留作 defFull。
 * 词典的 t 是一整条词条（好几个词性、七八个义项），复习时看着对不上原句；
 * 释义要补上单一语境的短板，前提是它对得上那句话（Bolger 2008）。
 * 词不存在（或已软删除）返回 null。
 */
export function chooseSense(word, sense, fullDef, now = new Date()) {
  const w = String(word || "").trim().toLowerCase();
  if (!w) return null;
  const book = loadBook();
  const idx = book.findIndex((c) => c.word === w && !c.deletedAt);
  if (idx < 0) return null;
  const prev = book[idx];
  const def = String(sense || "").trim();
  const updated = {
    ...prev,
    def,
    // 整条释义的备份：优先用这次带来的整条；没有就沿用已存的；再没有就把被顶掉的
    // 旧释义留下来（旧释义多半正是整条词典释义）。
    defFull:
      String(fullDef || "").trim() || prev.defFull || (prev.def !== def ? prev.def : ""),
    updatedAt: new Date(now).toISOString(),
  };
  const next = [...book];
  next[idx] = updated;
  writeBook(next);
  scheduleSync();
  return updated;
}

/**
 * 卡上的释义是「薄条目」时，用复习时现查到的词典条目把主释义顶掉。
 *
 * 由来：ECDICT 给几百个屈折形单收了没音标、只有领域义项的条目（varying →
 * `[计] 改变`），收藏时命中的就是它，卡上于是只剩一句看不懂的专业释义。
 * 复习时查到原形（vary: vt. 改变, 使多样化 / vi. 变化, 有不同, 违反）就换上去，
 * 顺便把原形词形记进 lemma —— 释义讲的是原形，不说一声会让人以为那些词性
 * 属于卡面上这个词形。
 *
 * 三条不做的事：
 *  - 不动 word。那是主键，换掉会把这张卡的复习进度、云端行、以及用户可能已有的
 *    另一张 vary 卡全搅在一起，代价远大于收益。
 *  - 不动 phonetic。卡面上的词形是 varying，挂 vary 的音标是错的。
 *  - 不碰已经有通用词性的卡（needsDictFill = false）—— 那是用户自己点定的义项，
 *    或上一次已经顶替过的，词典没有资格覆盖。
 *
 * 词不存在、已软删除、或查来的条目本身也薄，都返回原卡（或 null），不写盘。
 */
export function adoptDictEntry(word, entry, now = new Date()) {
  const w = String(word || "").trim().toLowerCase();
  if (!w || !entry) return null;
  const t = String(entry.t || "").trim();
  // 查来的条目本身也没有通用词性 —— 换了也还是看不懂，白写一次盘和一次同步
  if (!t || !parseSenses(t).some((g) => g.posTags.length > 0)) return null;

  const book = loadBook();
  const idx = book.findIndex((c) => c.word === w && !c.deletedAt);
  if (idx < 0) return null;
  const prev = book[idx];
  if (!needsDictFill(prev)) return prev;

  const lemma = String(entry.word || "").trim().toLowerCase();
  const updated = {
    ...prev,
    def: t,
    // 主释义就是整条词典释义时，defFull 没有再存一份的意义（复习背面据此不重复渲染）
    defFull: "",
    lemma: lemma && lemma !== w ? lemma : "",
    tag: prev.tag || String(entry.g || "").trim(),
    updatedAt: new Date(now).toISOString(),
  };
  const next = [...book];
  next[idx] = updated;
  writeBook(next);
  scheduleSync();
  return updated;
}

/** 取消收藏（软删除，这样删除也能同步到别的设备）。 */
export function removeWord(word, now = new Date()) {
  const w = String(word || "").trim().toLowerCase();
  if (!w) return;
  const book = loadBook();
  const idx = book.findIndex((c) => c.word === w);
  if (idx < 0) return;
  const next = [...book];
  next[idx] = { ...next[idx], deletedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
  writeBook(next);
  scheduleSync();
}

/**
 * 当前用户的调度参数：设了考试日期就按备考计划收紧
 * （间隔上限压到距考试天数；考前 10 天进 0.95 冲刺档）。
 */
export function currentScheduleParams(now = new Date()) {
  if (!isBrowser()) return {};
  try {
    const plan = loadStudyPlan(currentCode() || undefined);
    return paramsForPlan(plan?.examDate, now);
  } catch {
    return {};
  }
}

/**
 * 给一张卡打分，写回新的 SRS 状态，并记一条复习日志。返回新卡片。
 * @param {number} durationMs 这张卡从显示到打分花了多久（留给以后做隐式分档）
 */
export function gradeCard(word, rating, now = new Date(), params, durationMs = null) {
  const w = String(word || "").trim().toLowerCase();
  const book = loadBook();
  const idx = book.findIndex((c) => c.word === w && !c.deletedAt);
  if (idx < 0) return null;
  const prev = book[idx];
  const srs = schedule(prev, rating, now, { ...currentScheduleParams(now), ...params });
  const nowIso = new Date(now).toISOString();
  const next = [...book];
  next[idx] = {
    ...prev,
    ...srs,
    introducedAt: prev.introducedAt || (prev.state === STATE.NEW ? nowIso : prev.introducedAt),
    updatedAt: nowIso,
  };
  writeBook(next);
  appendReviewLog(prev, srs, rating, now, durationMs);
  scheduleSync();
  return next[idx];
}

/**
 * 标记/取消「这个词要会写」。默认打开；进入 review 后改成产出卡
 * （给释义拼英文，见 book.cardDirection）；在此之前仍然是认词卡。
 * 找不到这个词（或已被软删除）返回 null。
 */
export function setProductive(word, on, now = new Date()) {
  const w = String(word || "").trim().toLowerCase();
  if (!w) return null;
  const book = loadBook();
  const idx = book.findIndex((c) => c.word === w && !c.deletedAt);
  if (idx < 0) return null;
  const next = [...book];
  next[idx] = {
    ...next[idx],
    productive: !!on,
    spellingOptOut: !on,
    updatedAt: new Date(now).toISOString(),
  };
  writeBook(next);
  scheduleSync();
  return next[idx];
}

/** 把一张卡打回新词状态重新学。 */
export function resetCard(word, now = new Date()) {
  const w = String(word || "").trim().toLowerCase();
  const book = loadBook();
  const idx = book.findIndex((c) => c.word === w && !c.deletedAt);
  if (idx < 0) return null;
  const next = [...book];
  next[idx] = {
    ...next[idx],
    ...newCardState(now),
    introducedAt: null,
    updatedAt: new Date(now).toISOString(),
  };
  writeBook(next);
  scheduleSync();
  return next[idx];
}

/* ── 每日配额（用户可调） ── */

export function loadLimits() {
  if (!isBrowser()) return { ...DEFAULT_LIMITS };
  try {
    const raw = JSON.parse(localStorage.getItem(LIMITS_KEY) || "{}");
    return {
      newPerDay: Number.isFinite(raw.newPerDay) ? Math.max(0, Math.min(100, raw.newPerDay)) : DEFAULT_LIMITS.newPerDay,
      maxReviews: Number.isFinite(raw.maxReviews) ? Math.max(0, Math.min(999, raw.maxReviews)) : DEFAULT_LIMITS.maxReviews,
    };
  } catch {
    return { ...DEFAULT_LIMITS };
  }
}

export function saveLimits(limits) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(LIMITS_KEY, JSON.stringify({ ...loadLimits(), ...limits }));
  } catch {}
  emitUpdated();
}

/* ── 云同步 ── */

let syncTimer = null;
let syncing = false;

/**
 * 双向同步：拉云端 → 与本地合并 → 把合并结果推回云端。
 * 任何一步失败都静默返回（本地仍然是完整可用的）。
 */
export async function syncVocabCloud({ force = false } = {}) {
  if (!isBrowser()) return { ok: false, reason: "ssr" };
  const code = currentCode();
  if (!code) return { ok: false, reason: "anonymous" };
  if (syncing && !force) return { ok: false, reason: "busy" };
  syncing = true;
  try {
    const local = loadBook();
    const res = await fetch(`/api/vocab?code=${encodeURIComponent(code)}`);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const body = await res.json().catch(() => ({}));
    const remote = Array.isArray(body?.cards) ? body.cards : [];
    const merged = mergeCards(local, remote);
    writeBook(merged);

    // 只推「本地这份比云端新」的卡，避免每次全量上传。
    const remoteMap = new Map(remote.map((c) => [String(c.word || "").toLowerCase(), c]));
    const push = merged.filter((c) => {
      const r = remoteMap.get(c.word);
      if (!r) return true;
      return new Date(c.updatedAt).getTime() > new Date(r.updatedAt || 0).getTime();
    });
    if (push.length > 0) {
      // 分批推，避免单个请求体过大被网关拦掉。
      for (let i = 0; i < push.length; i += 100) {
        const chunk = push.slice(i, i + 100);
        // eslint-disable-next-line no-await-in-loop
        const r = await fetch("/api/vocab", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, cards: chunk }),
        });
        if (!r.ok) return { ok: false, reason: `HTTP ${r.status}`, pushed: i };
      }
    }
    // 日志和卡片一起推：卡片是「现在的状态」，日志是「怎么走到这一步的」，
    // 后者才是以后重新拟合参数的原料。推失败不影响卡片同步的成功判定。
    await pushReviewLogs().catch(() => null);

    return { ok: true, total: merged.length, pushed: push.length };
  } catch (e) {
    return { ok: false, reason: e?.message || "sync failed" };
  } finally {
    syncing = false;
  }
}

/** 收藏/评分后攒一会儿再同步，别每点一下就发一次请求。 */
export function scheduleSync(delay = 2500) {
  if (!isBrowser()) return;
  if (!currentCode()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncVocabCloud();
  }, delay);
}

/** 页面挂载时调一次：先同步，再让调用方刷新 UI。登录态变化也要重来。 */
export function initVocabSync(onChange) {
  if (!isBrowser()) return () => {};
  const run = () => {
    syncVocabCloud().then(() => onChange && onChange());
  };
  run();
  window.addEventListener(AUTH_CHANGED_EVENT, run);
  return () => window.removeEventListener(AUTH_CHANGED_EVENT, run);
}

export { activeCards };
