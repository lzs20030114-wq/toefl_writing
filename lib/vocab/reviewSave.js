/**
 * 复习存档：阅读复习每过完一段（10 个词）落一次，下次能从这里接着来。
 *
 * 存的不是「卡片」而是「词 + 这一场的统计」：每次评分已经把 SRS 状态写进了单词本，
 * 存档只负责单词本记不住的东西 —— 本场队列里还没过的词（含按学习步排进来的回访）、
 * 已答张数、记得/忘了、首次是否想起来、本场忘过哪些词。恢复时按词重新从单词本取卡，
 * 所以别的设备/标签页里已经复习掉的词不会被重复问。
 *
 * 存档只当天有效：隔天到期的词早就变了，旧队列没有意义。
 * 按账号 + 模式分键，和单词本本身的隔离口径一致。
 */

import {
  activeCards, clusterFamilies, familyCompanions, localDayKey, reviewCard, validReviewMode, hasReviewMode, FAMILY_AHEAD_DAYS,
} from "./book";
import { STATE } from "./srs";

const PREFIX = "toefl-vocab-review-save";
/** 和 VocabReview 的同场回访窗口一致：到期时间在这之内的学习步卡还算本场的。 */
export const SESSION_WINDOW_MS = 30 * 60 * 1000;
const MAX_WORDS = 500;

const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";
const keyFor = (account, mode) => `${PREFIX}::${account === "guest" || !account ? "guest" : `user:${account}`}::${validReviewMode(mode)}`;

const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const words = (list) => (Array.isArray(list) ? list.filter((w) => typeof w === "string" && w).slice(0, MAX_WORDS) : []);
const flags = (obj) => Object.fromEntries(Object.entries(obj && typeof obj === "object" ? obj : {})
  .filter(([w]) => typeof w === "string").slice(0, MAX_WORDS).map(([w, v]) => [w, v === true]));
const counts = (obj) => Object.fromEntries(Object.entries(obj && typeof obj === "object" ? obj : {})
  .filter(([w, v]) => typeof w === "string" && Number.isFinite(v)).slice(0, MAX_WORDS).map(([w, v]) => [w, num(v)]));

/** 把任意读回来的东西收拾成合法存档；当天以外的、形状不对的返回 null。 */
export function normalizeReviewSave(raw, mode, now = new Date()) {
  if (!raw || typeof raw !== "object" || raw.v !== 1) return null;
  if (raw.day !== localDayKey(now) || raw.mode !== validReviewMode(mode)) return null;
  const queue = words(raw.words);
  if (!queue.length) return null;
  const stats = raw.startStats && typeof raw.startStats === "object"
    ? { knowledge: num(raw.startStats.knowledge), mature: num(raw.startStats.mature), learning: num(raw.startStats.learning) }
    : null;
  return {
    v: 1, day: raw.day, mode: raw.mode, at: typeof raw.at === "string" ? raw.at : new Date(now).toISOString(),
    words: queue,
    answered: num(raw.answered),
    tally: { good: num(raw.tally?.good), again: num(raw.tally?.again) },
    first: flags(raw.first),
    seen: counts(raw.seen),
    lost: words(raw.lost),
    segNo: num(raw.segNo),
    elapsedMs: num(raw.elapsedMs),
    startStats: stats,
  };
}

export function readReviewSave(account, mode, now = new Date()) {
  if (!isBrowser()) return null;
  try {
    return normalizeReviewSave(JSON.parse(localStorage.getItem(keyFor(account, mode)) || "null"), mode, now);
  } catch {
    return null;
  }
}

/** 写失败（存储满 / 隐私模式）就算了：存档只是个便利，不能因为它打断复习。 */
export function writeReviewSave(account, mode, save, now = new Date()) {
  if (!isBrowser()) return false;
  try {
    localStorage.setItem(keyFor(account, mode), JSON.stringify({
      ...save, v: 1, mode: validReviewMode(mode), day: localDayKey(now), at: new Date(now).toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearReviewSave(account, mode) {
  if (!isBrowser()) return;
  try { localStorage.removeItem(keyFor(account, mode)); } catch {}
}

/**
 * 按存档里的词，从当前单词本重新取出可继续复习的卡。
 * 丢掉：已删除/已暂停的词、中途改了复习类型的词、以及已经在别处复习掉
 * （不再到期、也不在本场回访窗口内）的词。
 */
export function resumableQueue(save, cards, mode, now = new Date()) {
  const selected = validReviewMode(mode);
  const byWord = new Map(activeCards(cards).map((card) => [card.word, card]));
  const horizon = new Date(now).getTime() + SESSION_WINDOW_MS;
  const out = [];
  const seen = new Set();
  for (const word of save?.words || []) {
    const raw = byWord.get(word);
    if (!raw || raw.suspended || !hasReviewMode(raw, selected) || seen.has(word)) continue;
    const card = reviewCard(raw, selected);
    // 词形组提前带进来的组员本来就没到期，按提前的天数放宽；今天已复习过的照样丢掉。
    const limit = card.family ? new Date(now).getTime() + FAMILY_AHEAD_DAYS * 86400000 : horizon;
    if (card.family && card.lastReview && localDayKey(card.lastReview) === localDayKey(now) && new Date(card.due).getTime() > horizon) continue;
    if (card.state !== STATE.NEW && !(new Date(card.due).getTime() <= limit)) continue;
    out.push(card);
    seen.add(word);
  }
  // 存档是开场时的队列：之后才成组（重开笔记点「整组收藏」）的词，续上时也要连着出现——
  // 补上该提前带进来的组员和同组新词，再按组排到一起。
  const families = new Set(out.filter((c) => c.family).map((c) => c.family));
  const extra = families.size ? [
    ...familyCompanions(cards, now, out, selected),
    ...activeCards(cards).filter((raw) => !raw.suspended && hasReviewMode(raw, selected)).map((raw) => reviewCard(raw, selected))
      .filter((c) => c.family && families.has(c.family) && c.state === STATE.NEW),
  ].filter((c) => !seen.has(c.word) && seen.add(c.word)) : [];
  return clusterFamilies([...out, ...extra]);
}
