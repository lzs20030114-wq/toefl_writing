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
import { appendReviewLog, pushReviewLogs, removeReviewLog } from "./reviewLog";
import { normalizeCard, mergeCards, activeCards, needsDictFill, DEFAULT_LIMITS, MAX_CONTEXTS, SRS_FIELDS, reviewCard, validReviewMode, recordReviewStarted } from "./book";
import { hasUsableSense, parseSenses } from "../dict/core";
import { normalizeVocabularyItems, validateVocabularyEntry } from "./importVocabulary";
import { VOCAB_CARD_MAX_BYTES, vocabularyCardBytes } from "./syncLimits";

const BASE_KEY = "toefl-vocab-book";
const LIMITS_KEY = "toefl-vocab-limits";
const AUTH_STORAGE_KEY = "toefl-user-code";
export const VOCAB_UPDATED_EVENT = "toefl-vocab-updated";

const unsavedBooks = new Map();
const syncStates = new Map();
const REQUEST_TIMEOUT_MS = 15000;

const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

function currentCode() {
  if (!isBrowser()) return "";
  try {
    return String(getSavedCode() || localStorage.getItem(AUTH_STORAGE_KEY) || "").trim().toUpperCase();
  } catch { return ""; }
}

export function getVocabAccountKey() {
  return currentCode() || "guest";
}

function scopedKey(account = getVocabAccountKey()) {
  return `${BASE_KEY}::${account === "guest" ? "guest" : `user:${account}`}`;
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

export function getVocabStorageStatus() {
  return { persisted: !unsavedBooks.has(scopedKey()) };
}

function readBookFor(account) {
  const key = scopedKey(account);
  const persisted = readRaw(key) || [];
  const pending = unsavedBooks.get(key);
  return pending ? mergeCards(pending, persisted) : persisted;
}

function writeBookFor(account, cards, { silent = false } = {}) {
  const key = scopedKey(account);
  const incoming = (cards || []).map((c) => normalizeCard(c)).filter(Boolean);
  // An unsaved quota snapshot can coexist with another tab's newly persisted
  // words. Preserve those extra words, while explicit edits in incoming win
  // ties (resetting a card may intentionally lower its repetition count).
  const disk = unsavedBooks.has(key) ? readRaw(key) || [] : [];
  const byWord = new Map(disk.map((c) => [String(c.word || "").toLowerCase(), c]));
  for (const card of incoming) byWord.set(card.word, card);
  const next = [...byWord.values()].map((c) => normalizeCard(c)).filter(Boolean);
  try {
    localStorage.setItem(key, JSON.stringify({ v: 1, cards: next }));
    unsavedBooks.delete(key);
  } catch {
    // Keep the complete, unsaved book in memory until a later write or sync can retry.
    unsavedBooks.set(key, next);
  }
  if (!silent) emitUpdated();
  return next;
}

/**
 * 读单词本。登录后第一次读会把「游客态收藏的词」并进当前账号 —— 用户在没登录时
 * 划词收藏了一堆，登录后不该看见空本子。
 */
export function loadBook() {
  if (!isBrowser()) return [];
  const account = getVocabAccountKey();
  const mine = readBookFor(account);
  if (account === "guest") return mine.map((c) => normalizeCard(c)).filter(Boolean);

  const guestKey = `${BASE_KEY}::guest`;
  const guest = readBookFor("guest");
  if (guest && guest.length > 0) {
    const merged = mergeCards(mine, guest);
    writeBookFor(account, merged, { silent: true });
    // Never erase the only durable copy of a guest card after a quota failure.
    if (!unsavedBooks.has(scopedKey(account))) {
      try {
        localStorage.removeItem(guestKey);
        unsavedBooks.delete(guestKey);
      } catch {}
    }
    return merged;
  }
  return mine.map((c) => normalizeCard(c)).filter(Boolean);
}

export function writeBook(cards, { silent = false } = {}) {
  if (!isBrowser()) return cards;
  return writeBookFor(getVocabAccountKey(), cards, { silent });
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
      reviewMode: entry.reviewMode === "reading" || entry.reviewMode === "listening" ? entry.reviewMode : prev.reviewMode,
      listeningContext: card.listeningContext || prev.listeningContext,
      listeningState: prev.listeningState || (entry.reviewMode === "listening" ? { ...newCardState(now), introducedAt: null, updatedAt: nowIso } : null),
      updatedAt: nowIso,
    };
    const next = [...book];
    next[idx] = revived;
    writeBook(next);
    scheduleSync();
    return revived;
  }

  const created = { ...card, ...newCardState(now), createdAt: nowIso, updatedAt: nowIso,
    readingUpdatedAt: nowIso,
    listeningState: card.reviewMode === "listening" ? { ...newCardState(now), introducedAt: null, updatedAt: nowIso } : null };
  writeBook([created, ...book]);
  scheduleSync();
  return created;
}

/** Adopt a user-confirmed contextual meaning atomically, preserving both SRS tracks. */
export function adoptContextSense(entry, definition, sentence, now = new Date(), expectedAccount = null) {
  const account = getVocabAccountKey();
  if (!isBrowser() || (expectedAccount != null && expectedAccount !== account)) return null;
  const def = typeof definition === "string" ? definition.trim() : "";
  const currentSentence = typeof sentence === "string" ? sentence.trim() : "";
  if (!hasUsableSense(def)) throw new Error("请填写完整的语境释义，不能仅使用省略号。");
  if (!currentSentence || currentSentence.length > 400) throw new Error("原句不能为空或超过 400 字，尚未采用。");
  if (def.length > 300) throw new Error("语境释义不能超过 300 字，尚未采用。");
  const word = String(entry?.word || "").trim().toLowerCase();
  if (!word || word.length > 60) throw new Error("单词无效，尚未采用。");
  // Direct account read avoids guest-migration writes before validation succeeds.
  const book = readBookFor(account).map(card => normalizeCard(card)).filter(Boolean);
  const idx = book.findIndex(card => card.word === word);
  const prev = idx >= 0 ? book[idx] : null;
  const nowIso = new Date(Math.max(new Date(now).getTime(), new Date(prev?.contextSenseResetAt || 0).getTime() + 1)).toISOString();
  const otherRecent = (prev?.sentences || []).filter(item => item !== currentSentence && item !== prev?.sentence);
  const retained = [currentSentence, ...(prev?.sentence && prev.sentence !== currentSentence ? [prev.sentence] : []), ...otherRecent.slice(-(MAX_CONTEXTS - (prev?.sentence && prev.sentence !== currentSentence ? 1 : 0)))];
  const senses = [...(prev?.contextSenses || []).filter(item => item.sentence !== currentSentence), { sentence: currentSentence, def, updatedAt: nowIso }];
  const generic = prev?.baseDef || (!(prev?.contextSenses || []).length ? prev?.def : "") || entry?.def || entry?.defFull || "";
  const updated = normalizeCard({ ...(prev || entry), word,
    sentence: currentSentence, sentences: retained.filter(item => item !== currentSentence),
    def, baseDef: hasUsableSense(generic) ? generic : "",
    defFull: prev?.defFull || entry?.defFull || (!(prev?.contextSenses || []).length ? prev?.def : "") || "",
    contextSenses: senses, definitionLocked: true, definitionUpdatedAt: nowIso,
    deletedAt: null, updatedAt: nowIso,
    reviewMode: entry?.reviewMode === "reading" || entry?.reviewMode === "listening" ? entry.reviewMode : prev?.reviewMode,
    listeningContext: normalizeCard(entry, now)?.listeningContext || prev?.listeningContext,
    listeningState: prev?.listeningState || (entry?.reviewMode === "listening" ? { ...newCardState(now), introducedAt: null, updatedAt: nowIso } : null),
  }, now);
  if (vocabularyCardBytes(updated) > VOCAB_CARD_MAX_BYTES) throw new Error("卡片超过云同步的 8 KB 限制，尚未采用。请缩短释义或原句后重试。");
  if (getVocabAccountKey() !== account) return null;
  const next = [...book];
  if (idx >= 0) next[idx] = updated;
  else next.unshift(updated);
  writeBookFor(account, next);
  scheduleSync();
  return updated;
}

/** Import once after preview confirmation. Existing active cards are untouched. */
export function importWords(entries, { expectedAccount, reviewMode = "reading", source = "", now = new Date() } = {}) {
  const account = getVocabAccountKey();
  const result = { added: 0, duplicates: 0, invalid: 0, persisted: true, accountChanged: false };
  if (expectedAccount !== undefined && expectedAccount !== account) return { ...result, accountChanged: true };
  if (!isBrowser()) return { ...result, persisted: false };
  const parsed = normalizeVocabularyItems(entries);
  result.invalid = parsed.skipped;
  result.duplicates = parsed.duplicates;
  // Reading the scoped book directly avoids an unrelated guest migration write.
  const book = readBookFor(account).map((card) => normalizeCard(card)).filter(Boolean);
  const byWord = new Map(book.map((card, index) => [card.word, index]));
  const next = [...book], added = [];
  const mode = validReviewMode(reviewMode), nowIso = new Date(now).toISOString();
  for (const entry of parsed.items) {
    const index = byWord.get(entry.word);
    if (index !== undefined && !next[index].deletedAt) { result.duplicates++; continue; }
    const validationError = entry.validationError || validateVocabularyEntry(entry);
    if (validationError) throw new Error(`「${entry.display || entry.word}」：${validationError} 尚未导入任何单词。`);
    const card = normalizeCard({ ...entry, source: entry.source || source || "import", definitionLocked: hasUsableSense(entry.def), reviewMode: mode, ...newCardState(now), createdAt: nowIso, updatedAt: nowIso, readingUpdatedAt: nowIso, introducedAt: null, deletedAt: null,
      listeningState: mode === "listening" ? { ...newCardState(now), introducedAt: null, updatedAt: nowIso } : null }, now);
    if (vocabularyCardBytes(card) > VOCAB_CARD_MAX_BYTES) throw new Error(`「${entry.display || entry.word}」的卡片超过云同步的 8 KB 限制；请缩短释义或原句后重试。尚未导入任何单词。`);
    if (index !== undefined) next[index] = card;
    else { added.push(card); byWord.set(card.word, next.length + added.length - 1); }
    result.added++;
  }
  // No awaited work occurs here; check again immediately before the single write.
  if (getVocabAccountKey() !== account) return { ...result, added: 0, accountChanged: true };
  if (result.added) {
    writeBookFor(account, [...added, ...next]);
    scheduleSync();
  }
  result.persisted = !unsavedBooks.has(scopedKey(account));
  return result;
}

export function setReviewMode(word, mode, now = new Date()) {
  if (mode !== "reading" && mode !== "listening") return null;
  const book = loadBook();
  const idx = book.findIndex((c) => c.word === String(word || "").trim().toLowerCase() && !c.deletedAt);
  if (idx < 0) return null;
  const nowIso = new Date(now).toISOString();
  const next = [...book];
  next[idx] = { ...next[idx], reviewMode: mode, updatedAt: nowIso,
    listeningState: next[idx].listeningState || (mode === "listening" ? { ...newCardState(now), introducedAt: null, updatedAt: nowIso } : null) };
  writeBook(next);
  scheduleSync();
  return next[idx];
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
export function chooseSense(word, sense, fullDef, now = new Date(), sentence = null) {
  const w = String(word || "").trim().toLowerCase();
  if (!w) return null;
  const def = String(sense || "").trim();
  if (!hasUsableSense(def)) return null;
  const book = loadBook();
  const idx = book.findIndex((c) => c.word === w && !c.deletedAt);
  if (idx < 0) return null;
  const prev = book[idx];
  const currentSentence = String(sentence || "").trim();
  const nowIso = new Date(now).toISOString();
  if (currentSentence && prev.contextSenses?.length) {
    // A chip selected in another sentence is local too; keep the other adopted meanings.
    return adoptContextSense({ ...prev, defFull: String(fullDef || "").trim() || prev.defFull }, def, currentSentence, now, getVocabAccountKey());
  }
  const updated = {
    ...prev,
    def,
    definitionLocked: true,
    definitionUpdatedAt: nowIso,
    baseDef: def,
    contextSenses: [],
    contextSenseResetAt: nowIso,
    // 整条释义的备份：优先用这次带来的整条；没有就沿用已存的；再没有就把被顶掉的
    // 旧释义留下来（旧释义多半正是整条词典释义）。
    defFull:
      String(fullDef || "").trim() || prev.defFull || (prev.def !== def ? prev.def : ""),
    updatedAt: new Date(now).toISOString(),
  };
  if (def.length > 300 || currentSentence.length > 400 || vocabularyCardBytes(normalizeCard(updated, now)) > VOCAB_CARD_MAX_BYTES) throw new Error("释义或卡片过长，尚未修改。请缩短后重试。");
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
export function adoptDictEntry(word, entry, now = new Date(), expectedAccount = null) {
  if (expectedAccount != null && expectedAccount !== getVocabAccountKey()) return null;
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

/** 逐词设置是否要求会写；不重置原有复习进度。 */
export function setWordProductive(word, productive, now = new Date()) {
  const w = String(word || "").trim().toLowerCase();
  const book = loadBook();
  const idx = book.findIndex((c) => c.word === w && !c.deletedAt);
  if (idx < 0) return null;
  const next = [...book];
  next[idx] = { ...next[idx], productive: productive !== false, updatedAt: new Date(now).toISOString() };
  writeBook(next);
  scheduleSync();
  return next[idx];
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
export function gradeCard(word, rating, now = new Date(), params, durationMs = null, mode = null, expectedAccount = null) {
  if (expectedAccount != null && expectedAccount !== getVocabAccountKey()) return null;
  const w = String(word || "").trim().toLowerCase();
  const book = loadBook();
  const idx = book.findIndex((c) => c.word === w && !c.deletedAt);
  if (idx < 0) return null;
  const prev = book[idx];
  const selected = validReviewMode(mode || prev.reviewMode);
  const marked = recordReviewStarted(prev, selected, now);
  const projected = reviewCard(prev, selected);
  const srs = schedule(projected, rating, now, { ...currentScheduleParams(now), ...params });
  const nowIso = new Date(now).toISOString();
  const next = [...book];
  next[idx] = selected === "listening" ? {
    ...marked,
    listeningState: { ...srs, introducedAt: projected.introducedAt || (projected.state === STATE.NEW ? nowIso : null), updatedAt: nowIso },
    updatedAt: nowIso,
  } : {
    ...marked, ...srs,
    introducedAt: prev.introducedAt || (prev.state === STATE.NEW ? nowIso : prev.introducedAt),
    readingUpdatedAt: nowIso, updatedAt: nowIso,
  };
  writeBook(next);
  appendReviewLog(projected, srs, rating, now, durationMs, selected, getVocabAccountKey());
  gradeUndoStack.push({ account: getVocabAccountKey(), word: w, mode: selected, before: prev, at: nowIso });
  if (gradeUndoStack.length > UNDO_LIMIT) gradeUndoStack.shift();
  scheduleSync();
  return reviewCard(next[idx], selected);
}

/** 最近几次评分前的卡片原貌，只活在这个标签页的内存里，供「撤销上一张」用。 */
const UNDO_LIMIT = 30;
const gradeUndoStack = [];

/**
 * 撤销最近一次评分：把这张卡的调度状态（和那次评分顺手记下的「今天已开始复习」额度、
 * 首次引入时间）退回评分之前，并拿掉还没上传的那条复习日志。
 *
 * 只认栈顶、且必须是同一个词同一个模式 —— 撤销是「刚按错了」的后悔药，不是时光机：
 * 中间夹了别的评分就拒绝，免得把别张卡的状态改乱。
 * 只退回评分动过的字段，评分之后用户对这张卡做的别的改动（释义、要会写…）原样保留。
 * 退回时把时钟字段（readingUpdatedAt / listeningState.updatedAt / updatedAt）拨到现在，
 * 这样云同步合并时「撤销」赢过「那次评分」，别的设备也会看到撤销后的状态。
 * 返回投影后的卡，没撤成（栈顶对不上 / 词没了 / 换了账号）返回 null。
 */
export function undoGrade(word, mode = null, expectedAccount = null, now = new Date()) {
  const account = getVocabAccountKey();
  if (expectedAccount != null && expectedAccount !== account) return null;
  const w = String(word || "").trim().toLowerCase();
  const wanted = mode ? validReviewMode(mode) : null;
  const top = gradeUndoStack[gradeUndoStack.length - 1];
  if (!w || !top || top.account !== account || top.word !== w || (wanted && top.mode !== wanted)) return null;
  const book = loadBook();
  const idx = book.findIndex((c) => c.word === w && !c.deletedAt);
  if (idx < 0) { gradeUndoStack.pop(); return null; }
  const { before } = top;
  const nowIso = new Date(now).toISOString();
  const next = [...book];
  next[idx] = top.mode === "listening" ? {
    ...next[idx],
    listeningState: { ...(before.listeningState || { ...newCardState(now), introducedAt: null }), updatedAt: nowIso },
    reviewStartedDates: before.reviewStartedDates || [],
    updatedAt: nowIso,
  } : {
    ...next[idx],
    ...Object.fromEntries(SRS_FIELDS.map((field) => [field, before[field]])),
    introducedAt: before.introducedAt || null,
    reviewStartedDates: before.reviewStartedDates || [],
    readingUpdatedAt: nowIso,
    updatedAt: nowIso,
  };
  gradeUndoStack.pop();
  writeBook(next);
  removeReviewLog(w, top.at, top.mode, account);
  scheduleSync();
  return reviewCard(next[idx], top.mode);
}

/** 暂停/恢复复习一个词：留着词和进度，但不进任何队列、不占额度。 */
export function setSuspended(word, on, now = new Date()) {
  const w = String(word || "").trim().toLowerCase();
  if (!w) return null;
  const book = loadBook();
  const idx = book.findIndex((c) => c.word === w && !c.deletedAt);
  if (idx < 0) return null;
  const next = [...book];
  next[idx] = { ...next[idx], suspended: !!on, updatedAt: new Date(now).toISOString() };
  writeBook(next);
  scheduleSync();
  return next[idx];
}

/**
 * 用户手改一个词的释义（词库「编辑释义」/ 复习菜单）。
 * 走和「点定义项」同一条路：手写的就是主释义，锁住不被词典覆盖，原释义留作 defFull 备份。
 * 空释义、过长直接抛错；词不存在返回 null。
 */
export function editDefinition(word, text, now = new Date()) {
  const def = String(text || "").trim();
  if (!def) throw new Error("释义不能为空。");
  return chooseSense(word, def, "", now, null);
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
export function resetCard(word, now = new Date(), mode = null) {
  const w = String(word || "").trim().toLowerCase();
  const book = loadBook();
  const idx = book.findIndex((c) => c.word === w && !c.deletedAt);
  if (idx < 0) return null;
  const next = [...book];
  const nowIso = new Date(now).toISOString();
  const selected = validReviewMode(mode || next[idx].reviewMode);
  next[idx] = selected === "listening"
    ? { ...next[idx], listeningState: { ...newCardState(now), introducedAt: null, updatedAt: nowIso }, updatedAt: nowIso }
    : { ...next[idx], ...newCardState(now), introducedAt: null, readingUpdatedAt: nowIso, updatedAt: nowIso };
  writeBook(next);
  scheduleSync();
  return reviewCard(next[idx], selected);
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

function syncState(account) {
  if (!syncStates.has(account)) syncStates.set(account, { active: null, pending: false, forcePending: false, timer: null, retries: 0 });
  return syncStates.get(account);
}

function queueSync(account, delay) {
  const state = syncState(account);
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    if (getVocabAccountKey() === account) syncVocabCloud();
  }, delay);
}

async function requestJsonWithTimeout(url, options) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) return { ok: false, status: res.status };
        return { ok: true, status: res.status, body: await res.json() };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("request timeout")); }, REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function syncOnce(code, state) {
  const stillCurrent = () => currentCode() === code;
  const remote = [];
  const seenCursors = new Set();
  let cursor = null;
  do {
    const url = `/api/vocab?code=${encodeURIComponent(code)}&limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await requestJsonWithTimeout(url);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, retryable: res.status === 429 || res.status >= 500 };
    const body = res.body;
    if (!stillCurrent()) return { ok: false, reason: "account-changed" };
    if (!body?.ok || !Array.isArray(body.cards)) return { ok: false, reason: "invalid-page" };
    remote.push(...body.cards);
    cursor = body.nextCursor || null;
    if (cursor && seenCursors.has(cursor)) return { ok: false, reason: "repeated-cursor" };
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  // Re-read after GET: a save, grade, or delete may have happened during the request.
  const merged = mergeCards(loadBook(), remote);
  if (!stillCurrent()) return { ok: false, reason: "account-changed" };
  writeBookFor(code, merged);
  state.pending = false;

  const remoteMap = new Map(remote.map((c) => [String(c.word || "").toLowerCase(), c]));
  const push = merged.filter((c) => {
    const r = remoteMap.get(c.word);
    return !r || JSON.stringify(c) !== JSON.stringify(normalizeCard(r));
  });
  for (let i = 0; i < push.length; i += 100) {
    if (!stillCurrent()) return { ok: false, reason: "account-changed", pushed: i };
    const r = await requestJsonWithTimeout("/api/vocab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, cards: push.slice(i, i + 100) }),
    });
    if (!stillCurrent()) return { ok: false, reason: "account-changed", pushed: i };
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}`, pushed: i, retryable: r.status === 429 || r.status >= 500 };
    const receipt = r.body;
    if (!stillCurrent()) return { ok: false, reason: "account-changed", pushed: i };
    if (receipt?.ok !== true) return { ok: false, reason: "invalid-receipt", pushed: i };
  }
  const logs = await pushReviewLogs(code).catch(() => ({ ok: false, retryable: true }));
  if (!stillCurrent()) return { ok: false, reason: "account-changed" };
  if (!logs.ok) return { ok: false, reason: "logs-pending", retryable: !!logs.retryable };
  return { ok: true, total: merged.length, pushed: push.length };
}

/**
 * 双向同步：拉云端 → 与本地合并 → 把合并结果推回云端。
 * 任何一步失败都静默返回（本地仍然是完整可用的）。
 */
export async function syncVocabCloud({ force = false } = {}) {
  if (!isBrowser()) return { ok: false, reason: "ssr" };
  const code = currentCode();
  if (!code) return { ok: false, reason: "anonymous" };
  const state = syncState(code);
  if (state.active) {
    if (force) state.forcePending = true;
    return state.active;
  }
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  state.active = (async () => {
    let result;
    for (let pass = 0; pass < 2; pass++) {
      try { result = await syncOnce(code, state); }
      catch (e) { result = { ok: false, reason: e?.message || "sync failed", retryable: true }; }
      if (!result.ok || (!state.pending && !state.forcePending) || currentCode() !== code) break;
      state.forcePending = false;
    }
    return result;
  })();
  let outcome;
  try { outcome = await state.active; return outcome; }
  finally {
    state.active = null;
    if (currentCode() === code) {
      if (outcome?.ok) {
        state.retries = 0;
        if (state.pending || state.forcePending) queueSync(code, 2500);
      } else if (outcome?.retryable) {
        state.retries = Math.min(state.retries + 1, 6);
        queueSync(code, Math.min(60000, 2000 * 2 ** (state.retries - 1)));
      }
    }
  }
}

/** 收藏/评分后攒一会儿再同步，别每点一下就发一次请求。 */
export function scheduleSync(delay = 2500) {
  if (!isBrowser()) return;
  const code = currentCode();
  if (!code) return;
  const state = syncState(code);
  state.pending = true;
  if (!state.active) queueSync(code, delay);
}

/** 页面挂载时调一次：先同步，再让调用方刷新 UI。登录态变化也要重来。 */
export function initVocabSync(onChange) {
  if (!isBrowser()) return () => {};
  const run = () => {
    syncVocabCloud().then(() => onChange && onChange());
  };
  run();
  window.addEventListener(AUTH_CHANGED_EVENT, run);
  window.addEventListener("online", run);
  return () => {
    window.removeEventListener(AUTH_CHANGED_EVENT, run);
    window.removeEventListener("online", run);
  };
}

export { activeCards };
