/**
 * 单词本的纯数据层：规范化、合并、统计、排队。
 * 不碰 localStorage / fetch / React，全部可直接跑测试。
 */

import { normalizeContextSenses } from "./contextSenses";
export { definitionForContext } from "./contextSenses";

import { STATE, isDue, newCardState, currentRetrievability } from "./srs";
import { hasUsableSense, parseSenses } from "../dict/core";

/** 单词本一张卡的完整形状（word 是主键，一个词只有一张卡）。 */
export const CARD_FIELDS = [
  "word", "display", "phonetic", "def", "defFull", "definitionLocked", "tag", "sentence", "sentences", "source",
  "lemma", "baseDef", "contextSenses", "definitionUpdatedAt", "contextSenseResetAt",
  "productive", "spellingOptOut", "suspended",
  "createdAt", "updatedAt", "introducedAt", "deletedAt",
  "state", "step", "stability", "difficulty", "due", "lastReview",
  "reps", "lapses", "scheduledDays",
  "reviewStartedDates",
  "readingUpdatedAt", "reviewMode", "listeningContext", "listeningState",
];

export const SRS_FIELDS = ["state", "step", "stability", "difficulty", "due", "lastReview", "reps", "lapses", "scheduledDays"];
export const validReviewMode = (mode) => mode === "listening" ? "listening" : "reading";

export function normalizeListeningContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  const audioUrl = str(raw.audioUrl).trim().slice(0, 1000);
  const text = str(raw.text).trim().slice(0, 400);
  if (!audioUrl || !text || !(/^(https?:\/\/|\/api\/audio\/)/i.test(audioUrl))) return null;
  const start = raw.start;
  const end = raw.end;
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 120) return null;
  return { audioUrl, start, end, text };
}

function srsOf(card) { return Object.fromEntries(SRS_FIELDS.map((field) => [field, card[field]])); }

/** 把当前模式进度投影到旧复习组件可用的根字段，不改持久化卡片。 */
export function reviewCard(card, mode = card?.reviewMode) {
  if (!card) return null;
  const selected = validReviewMode(mode);
  return selected === "listening"
    ? { ...card, ...srsOf(card.listeningState || newCardState()), introducedAt: card.listeningState?.introducedAt || null, reviewMode: selected }
    : { ...card, reviewMode: selected };
}

/**
 * 这张卡的释义够不够用：有任何一条挂着通用词性（n./vt./a.…）就算够。
 *
 * 不够的典型是 varying —— ECDICT 给这个屈折形单收了 `[计] 改变`（没音标、没词性），
 * 收藏时命中的就是它，于是卡上永远只有这一句看不懂的话。这种卡复习时现查一次词典，
 * 把原形 vary 的完整词性释义顶上去（vocabStore.adoptDictEntry）。
 *
 * 反过来，只要卡上已经有通用词性，这把尺子就说「够」——
 * 那要么是用户自己点定的义项，要么是上一次已经顶替过的，都不该再被词典覆盖。
 */
export function needsDictFill(card) {
  if (!card) return false;
  if (card.definitionLocked === true && hasUsableSense(card.def)) return false;
  return !parseSenses(`${card.def || ""}\n${card.defFull || ""}`)
    .some((g) => g.posTags.length > 0);
}

/** 到这个间隔就算「记牢了」（Anki 口径的 mature card）。 */
export const MATURE_DAYS = 21;

export const DEFAULT_LIMITS = {
  /**
   * 每天放出的新词上限。
   * 模拟（DR=0.9，60 天备考）：20 新词/天 → 日均 69 次复习，按语境卡 10–15 秒/张
   * 算是 11–17 分钟，正好卡住「每天 10–20 分钟」的预算；25 以上会溢出。
   * 留存率几乎不随新词量变化（都在 94% 上下），所以这个数的唯一约束是时间。
   */
  newPerDay: 20,
  /**
   * 每天复习条数上限（0 = 不限）。
   * 同一组模拟里峰值是日均的 1.44 倍（99 次），上限取 120 ≈ 日均 ×1.75：
   * 正常波动不会被截断，只在「出门一周回来攒了三百张」时把墙拆成几天 ——
   * 那面墙才是真正劝退人的东西。
   */
  maxReviews: 120,
};

/** 本地日键供每日额度使用；不按 UTC 截日。 */
export function localDayKey(now = new Date()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function reviewDates(raw) {
  return [...new Set((Array.isArray(raw) ? raw : []).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort().slice(-45);
}

function introducedOn(card, day) {
  return [card.introducedAt, card.listeningState?.introducedAt].some((at) => at && localDayKey(at) === day);
}

/** 评分入口调用：把已学词今天第一次复习记在卡上，供跨模式与跨设备共用额度。 */
export function recordReviewStarted(card, mode, now = new Date()) {
  if (!card) return card;
  const day = localDayKey(now);
  const current = reviewCard(card, mode);
  if (current.state === STATE.NEW || introducedOn(card, day) || card.reviewStartedDates?.includes(day)) return card;
  return { ...card, reviewStartedDates: reviewDates([...(card.reviewStartedDates || []), day]) };
}

/** 每个词每天首次开启已学词复习才占一个额度；当天新词后续学习步免费。 */
export function reviewQuota(cards, now = new Date(), limits = DEFAULT_LIMITS) {
  const day = localDayKey(now);
  const started = (cards || []).filter((card) => card?.reviewStartedDates?.includes(day)).length;
  const max = { ...DEFAULT_LIMITS, ...limits }.maxReviews;
  return { started, remaining: max > 0 ? Math.max(0, max - started) : Infinity };
}

function dueSelection(cards, now, limits, mode) {
  const day = localDayKey(now);
  const { remaining } = reviewQuota(cards, now, limits);
  const dueEntries = activeCards(cards).filter((raw) => !raw.suspended).map((raw) => ({ card: reviewCard(raw), free: introducedOn(raw, day) }))
    .filter(({ card }) => card.state !== STATE.NEW && isDue(card, now))
    .sort((a, b) => new Date(a.card.due) - new Date(b.card.due));
  let taken = 0;
  const selected = dueEntries.filter(({ card, free }) => {
    if (card.reviewStartedDates?.includes(day) || free) return true;
    if (taken >= remaining) return false;
    taken += 1;
    return true;
  }).map(({ card }) => card);
  return {
    due: mode ? dueEntries.filter(({ card }) => card.reviewMode === mode) : dueEntries,
    selected: mode ? selected.filter((card) => card.reviewMode === mode) : selected,
  };
}

function freshSelection(cards, now, limits, mode) {
  const quota = Math.max(0, limits.newPerDay - introducedToday(cards, now));
  const fresh = activeCards(cards).filter((card) => !card.suspended).map((card) => reviewCard(card)).filter((card) => card.state === STATE.NEW);
  const reading = fresh.filter((card) => card.reviewMode === "reading").sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const listening = fresh.filter((card) => card.reviewMode === "listening").sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const out = [];
  // 两种模式都有新词时轮流放出，避免先收藏的一科长期占满额度。
  while (out.length < quota && (reading.length || listening.length)) {
    if (reading.length && out.length < quota) out.push(reading.shift());
    if (listening.length && out.length < quota) out.push(listening.shift());
  }
  return mode ? out.filter((card) => card.reviewMode === mode) : out;
}

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

/**
 * 主句之外最多再存几句语境。
 * 三句已经够撑起「同一个词在不同句子里」的轮换（见 pickContext），再多只是让
 * 卡片体积和云端 JSONB 变大，用户也记不住第四个出处。
 */
export const MAX_CONTEXTS = 3;

/** 额外语境句：去空、去重、剔除与主句重复的（不截断数量）。 */
function dedupeSentences(list, sentence) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const s = str(raw).trim().slice(0, 400);
    if (!s || s === sentence || out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

/** 规范化语境池：超过上限时丢最早加进来的那几句（新遇到的语境更贴近当下在读的东西）。 */
function normalizeSentences(list, sentence) {
  return dedupeSentences(list, sentence).slice(-MAX_CONTEXTS);
}

/** 把任意来源（本地旧数据 / 云端行 / 收藏入参）收拾成一张合法卡片。 */
export function normalizeCard(raw, now = new Date()) {
  if (!raw) return null;
  const word = str(raw.word).trim().toLowerCase();
  if (!word) return null;
  const nowIso = new Date(now).toISOString();
  const srs = newCardState(now);
  const sentence = str(raw.sentence).trim().slice(0, 400);
  const rawDef = str(raw.def).trim();
  const fullDef = str(raw.defFull).trim();
  // Older cards can hold a clicked bare ellipsis. Recover from the saved
  // full dictionary entry without touching any SRS or mode fields.
  const def = hasUsableSense(rawDef) ? rawDef : hasUsableSense(fullDef) ? fullDef : "";
  return {
    word,
    display: str(raw.display || raw.word).trim() || word,
    phonetic: str(raw.phonetic).trim(),
    def,
    baseDef: hasUsableSense(raw.baseDef) ? str(raw.baseDef).trim() : "",
    contextSenses: normalizeContextSenses(raw.contextSenses, [sentence, ...normalizeSentences(raw.sentences, sentence)], raw.contextSenseResetAt),
    definitionUpdatedAt: raw.definitionUpdatedAt || null,
    contextSenseResetAt: raw.contextSenseResetAt || null,
    definitionLocked: raw.definitionLocked === true && hasUsableSense(def),
    // 用户点选了某一条义项当主释义时，整条词典释义留在这儿当备份（复习背面小字展示）。
    defFull: fullDef,
    // 这个词形的原形（varying → vary）。只在「薄释义被词典条目顶替」时写进来，
    // 见 vocabStore.adoptDictEntry —— 顶替之后释义讲的是原形，不说一声会让人
    // 以为那些词性属于卡面上这个词形。
    lemma: str(raw.lemma).trim().toLowerCase(),
    tag: str(raw.tag).trim(),
    sentence,
    // 同一个词在别处又遇到时追加的语境句（主句不变），复习时轮换着用。
    sentences: normalizeSentences(raw.sentences, sentence),
    source: str(raw.source).trim() || "reading",
    reviewMode: validReviewMode(raw.reviewMode),
    listeningContext: normalizeListeningContext(raw.listeningContext),
    listeningState: raw.listeningState && typeof raw.listeningState === "object"
      ? { ...newCardState(now), ...Object.fromEntries(SRS_FIELDS.filter((field) => raw.listeningState[field] !== undefined).map((field) => [field, raw.listeningState[field]])), introducedAt: raw.listeningState.introducedAt || null, updatedAt: raw.listeningState.updatedAt || raw.listeningState.lastReview || raw.updatedAt || nowIso }
      : null,
    // 旧卡的 productive=false 是过去的默认值，无法和手动关闭区分。
    // 新规则用 spellingOptOut 记录用户明确剔除；旧卡一律默认要会写。
    productive: raw.spellingOptOut !== true,
    spellingOptOut: raw.spellingOptOut === true,
    // 用户在复习中点了「暂停复习这个词」：保留词和进度，但不再进任何队列/额度。
    suspended: raw.suspended === true,
    createdAt: raw.createdAt || nowIso,
    updatedAt: raw.updatedAt || raw.createdAt || nowIso,
    readingUpdatedAt: raw.readingUpdatedAt || raw.lastReview || raw.updatedAt || raw.createdAt || nowIso,
    reviewStartedDates: reviewDates(raw.reviewStartedDates),
    introducedAt: raw.introducedAt || null,
    deletedAt: raw.deletedAt || null,
    state: raw.state || srs.state,
    step: Number.isFinite(raw.step) ? raw.step : srs.step,
    stability: Number.isFinite(raw.stability) ? raw.stability : srs.stability,
    difficulty: Number.isFinite(raw.difficulty) ? raw.difficulty : srs.difficulty,
    due: raw.due || srs.due,
    lastReview: raw.lastReview || null,
    reps: Number.isFinite(raw.reps) ? raw.reps : 0,
    lapses: Number.isFinite(raw.lapses) ? raw.lapses : 0,
    scheduledDays: Number.isFinite(raw.scheduledDays) ? raw.scheduledDays : 0,
  };
}

/**
 * 两份卡表按 word 合并，updatedAt 新的赢（软删除也参与比较，所以删除能传播）。
 * 云同步和跨标签页合并都走这里。
 */
export function mergeCards(a, b) {
  const map = new Map();
  const put = (card) => {
    const c = normalizeCard(card);
    if (!c) return;
    const prev = map.get(c.word);
    if (!prev) {
      map.set(c.word, c);
      return;
    }
    const prevAt = new Date(prev.updatedAt).getTime() || 0;
    const nextAt = new Date(c.updatedAt).getTime() || 0;
    // updatedAt 打平时（同一秒内两端各写一次）留复习次数多的那份，
    // 否则一次评分可能被另一端的旧状态覆盖掉。
    const winner = nextAt > prevAt || (nextAt === prevAt && (c.reps || 0) > (prev.reps || 0)) ? c : prev;
    const loser = winner === c ? prev : c;
    // 业务字段取并集：一端补了例句/释义，不该因为另一端更新而丢。
    // 注意会写偏好刻意不在并集里（由 ...winner 带过来）：它是个开关，
    // 用户在一台设备上关掉，必须能同步成「关」，并集会让它再也关不掉。
    let sentence = winner.sentence || loser.sentence;
    const lockedDefinition = winner.definitionLocked && hasUsableSense(winner.def) ? winner
      : loser.definitionLocked && hasUsableSense(loser.def) ? loser : null;
    const definitionOwner = lockedDefinition
      ? (winner.definitionLocked && loser.definitionLocked && new Date(loser.definitionUpdatedAt).getTime() > new Date(winner.definitionUpdatedAt).getTime() ? loser : lockedDefinition)
      : winner;
    // Definition edits have their own clock: a later grade must not revert the adopted sentence.
    if (definitionOwner.contextSenses?.length && definitionOwner.sentence) sentence = definitionOwner.sentence;
    const sentenceOwner = sentence === winner.sentence ? winner : loser;
    const sentenceOther = sentenceOwner === winner ? loser : winner;
    const mergedSentences = dedupeSentences([...(sentenceOwner.sentences || []), sentenceOther.sentence, ...(sentenceOther.sentences || [])], sentence).slice(0, MAX_CONTEXTS);
    const contextSenseResetAt = new Date(winner.contextSenseResetAt).getTime() >= new Date(loser.contextSenseResetAt).getTime() ? winner.contextSenseResetAt : loser.contextSenseResetAt;
    const readingWinner = new Date(c.readingUpdatedAt).getTime() > new Date(prev.readingUpdatedAt).getTime()
      || (c.readingUpdatedAt === prev.readingUpdatedAt && c.reps > prev.reps) ? c : prev;
    const pListen = prev.listeningState;
    const cListen = c.listeningState;
    const listeningState = !pListen ? cListen : !cListen ? pListen
      : new Date(cListen.updatedAt).getTime() > new Date(pListen.updatedAt).getTime()
        || (cListen.updatedAt === pListen.updatedAt && cListen.reps > pListen.reps) ? cListen : pListen;
    map.set(c.word, {
      ...winner,
      ...srsOf(readingWinner),
      introducedAt: readingWinner.introducedAt,
      readingUpdatedAt: readingWinner.readingUpdatedAt,
      listeningState,
      listeningContext: winner.listeningContext || loser.listeningContext,
      reviewStartedDates: reviewDates([...(winner.reviewStartedDates || []), ...(loser.reviewStartedDates || [])]),
      sentence,
      phonetic: winner.phonetic || loser.phonetic,
      sentences: mergedSentences,
      contextSenses: normalizeContextSenses([...(loser.contextSenses || []), ...(winner.contextSenses || [])], [sentence, ...mergedSentences], contextSenseResetAt),
      contextSenseResetAt,
      definitionUpdatedAt: definitionOwner.definitionUpdatedAt,
      baseDef: definitionOwner.baseDef,
      def: lockedDefinition ? definitionOwner.def : winner.def || loser.def,
      defFull: lockedDefinition ? definitionOwner.defFull : winner.defFull || loser.defFull,
      definitionLocked: !!lockedDefinition,
      lemma: winner.lemma || loser.lemma,
      tag: winner.tag || loser.tag,
      createdAt:
        new Date(loser.createdAt) < new Date(winner.createdAt) ? loser.createdAt : winner.createdAt,
    });
  };
  (a || []).forEach(put);
  (b || []).forEach(put);
  return [...map.values()];
}

/** 过滤掉软删除的卡。 */
export function activeCards(cards) {
  return (cards || []).filter((c) => c && !c.deletedAt);
}

/** 今天（本地时区）放出过多少新词。 */
export function introducedToday(cards, now = new Date()) {
  const key = localDayKey(now);
  return activeCards(cards).filter((c) => {
    return introducedOn(c, key);
  }).length;
}

/** 忘过这么多次就算「易忘词」（Anki 的 leech 阈值是 8，本站复习量小，取 3 更早提醒）。 */
export const LEECH_LAPSES = 3;
export const isLeech = (card) => (card?.lapses || 0) >= LEECH_LAPSES;

/**
 * 一张卡当前处在哪个阶段（互斥）：
 *   paused 暂停复习 · new 未开始 · learning 学习中（含重学） · mature 已记牢 · review 复习中
 * 列表徽章、记忆分布条、筛选 chip 共用这一把尺子，三处数字才对得上。
 * 注意 mature 排在 learning 之后：重学中的老词仍然算「学习中」。
 */
export function cardStage(card) {
  if (!card) return "new";
  if (card.suspended) return "paused";
  if (card.state === STATE.NEW) return "new";
  if (card.state === STATE.LEARNING || card.state === STATE.RELEARNING) return "learning";
  if ((card.scheduledDays || 0) >= MATURE_DAYS) return "mature";
  return "review";
}

/** 一张卡平均要花多少秒（含同场的学习步回访）：10–15 秒/张再加一点回访余量。 */
const SECONDS_PER_CARD = 16;
/** 今天剩 n 张大约要几分钟（至少 1 分钟，0 张返回 0）。 */
export function estimateMinutes(n) {
  return n > 0 ? Math.max(1, Math.round((n * SECONDS_PER_CARD) / 60)) : 0;
}

/** 单词本首页那一排数字。 */
export function bookStats(cards, now = new Date(), limits = DEFAULT_LIMITS, mode = null) {
  const all = activeCards(cards);
  const live = (mode ? all.filter((c) => validReviewMode(c.reviewMode) === mode) : all).map((c) => reviewCard(c));
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const day = localDayKey(now);
  let dueReview = 0;
  let learning = 0;
  let mature = 0;
  let untouched = 0;
  let suspended = 0;
  const doneWords = new Set();
  for (const c of live) {
    if (c.lastReview && localDayKey(c.lastReview) === day) doneWords.add(c.word);
    if (c.suspended) {
      suspended += 1;
      continue;
    }
    if (c.state === STATE.NEW) {
      untouched += 1;
      continue;
    }
    if (c.state === STATE.LEARNING || c.state === STATE.RELEARNING) learning += 1;
    if (c.scheduledDays >= MATURE_DAYS) mature += 1;
    if (isDue(c, now)) dueReview += 1;
  }
  const duePlan = dueSelection(cards, now, lim, mode);
  const freshAll = freshSelection(cards, now, lim, mode);
  const newToday = freshAll.length;
  // 今天的计划总量 = 已经过的词 + 还没过的词（同一个词只算一次：
  // 刚答「忘了」的词既在 doneWords 里、又会因学习步到期而回到待办里）。
  const pending = [...duePlan.selected, ...freshAll].filter((c) => !doneWords.has(c.word));
  const pendingWords = new Set(pending.map((c) => c.word));
  return {
    total: live.length,
    /** 今天要过的卡 = 到期复习 + 今天该放的新词 */
    todo: duePlan.selected.length + newToday,
    dueReview,
    eligibleReview: duePlan.selected.length,
    // 其中认得之后还要拼写的（进入 review 且要会写）：这类卡最费时间，单独告诉用户。
    spellingDue: duePlan.selected.filter(needsSpelling).length,
    deferredReview: duePlan.due.length - duePlan.selected.length,
    reviewRemaining: reviewQuota(cards, now, lim).remaining,
    newToday,
    untouched,
    learning,
    mature,
    suspended,
    /** 今天已经过了几个词 / 今日计划共几个词（含已过的）/ 还剩几个 */
    doneToday: doneWords.size,
    todayTotal: doneWords.size + pendingWords.size,
    knowledge: knowledgeEstimate(live, now),
  };
}

/**
 * 未来几天每天大约要过多少词（概览页的「未来 7 天」）。
 *
 * 只数「已经排定」的负担，不预测将来的评分：
 *   · 今天 = 今日计划总量（已过 + 待过），和概览顶部「今日复习 N 词」同一个数
 *   · 之后每天 = 当天到期的老词（含上一天超额顺延来的）+ 当天放出的新词
 *   · 老词按 maxReviews 封顶，超出的顺延到下一天；新词按 newPerDay 放，放完为止
 * 这是个估算 —— 将来每天新评分产生的新到期词没算进去，页面上也这么说明。
 */
export function forecastLoad(cards, now = new Date(), limits = DEFAULT_LIMITS, days = 7) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const stats = bookStats(cards, now, lim);
  const duePlan = dueSelection(cards, now, lim, null);
  const live = activeCards(cards).filter((c) => !c.suspended).map((c) => reviewCard(c));
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const keys = Array.from({ length: days }, (_, i) => {
    const d = new Date(dayStart);
    d.setDate(d.getDate() + i);
    return localDayKey(d);
  });
  const scheduled = new Map(keys.map((k) => [k, 0]));
  for (const c of live) {
    if (c.state === STATE.NEW) continue;
    const k = localDayKey(c.due);
    if (scheduled.has(k) && k !== keys[0]) scheduled.set(k, scheduled.get(k) + 1);
  }
  let carry = duePlan.due.length - duePlan.selected.length;
  let freshLeft = Math.max(0, live.filter((c) => c.state === STATE.NEW).length - stats.newToday);
  const out = [{ date: keys[0], n: stats.todayTotal, carried: 0 }];
  for (let i = 1; i < days; i += 1) {
    const wanted = scheduled.get(keys[i]) + carry;
    const reviews = lim.maxReviews > 0 ? Math.min(wanted, lim.maxReviews) : wanted;
    const fresh = Math.min(lim.newPerDay, freshLeft);
    freshLeft -= fresh;
    out.push({ date: keys[i], n: reviews + fresh, carried: i === 1 ? carry : 0 });
    carry = wanted - reviews;
  }
  return { days: out, total: out.reduce((sum, d) => sum + d.n, 0) };
}

/** 词库页的排序选项。 */
export const SORT_OPTIONS = [
  ["urgency", "按紧急程度"], ["recent", "最近收藏"], ["forgettable", "最容易忘"], ["alpha", "字母顺序"],
];
export function sortCards(cards, key = "urgency", now = new Date()) {
  if (key === "recent") return [...cards].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (key === "alpha") return [...cards].sort((a, b) => a.word.localeCompare(b.word));
  if (key === "forgettable") {
    // 忘得最多的在前；打平时看 FSRS 难度（越难越容易忘），再看可提取度
    return [...cards].sort((a, b) => (b.lapses || 0) - (a.lapses || 0)
      || (b.difficulty || 0) - (a.difficulty || 0)
      || (currentRetrievability(a, now) ?? 2) - (currentRetrievability(b, now) ?? 2));
  }
  return sortByUrgency(cards, now);
}

/**
 * 「此刻大概记得多少个词」= 所有卡片可提取度之和（∑R）。
 *
 * 这是给用户看的核心进度数字，刻意不用「已复习卡片数」：后者衡量的是工作量，
 * 把工作量做成成就指标会激励用户去调高留存率、多刷卡，正好和「用最少时间记住
 * 最多词」相反。∑R 才是产出。
 */
export function knowledgeEstimate(cards, now = new Date()) {
  let sum = 0;
  for (const c of activeCards(cards)) {
    const r = currentRetrievability(c, now);
    if (r != null) sum += r;
  }
  return Math.round(sum);
}

/**
 * 排出今天的复习队列。
 *
 *   1. 到期越久的越先过 —— 逾期的卡留存率最低，先救它
 *   2. 新词按收藏时间先后放出，打散插进复习流，不堆在开头或结尾
 *   3. 整体打乱一次，并把同源（同一篇文章收藏的）词拆开
 *
 * 第 3 条的理由不是「交错练习」—— 元分析（Brunmair & Richter 2019）显示
 * 词表材料的交错效应是 g = −0.39，分块反而更好，所以别把交错当卖点。
 * 打乱是为了消除干扰：不让用户靠「上一张是什么」来回忆，也不让同一篇文章里
 * 的近义词连着出现互相提示。
 *
 * @param {function} rand [0,1) 随机源，测试可注入
 */
export function buildQueue(cards, now = new Date(), limits = DEFAULT_LIMITS, rand = Math.random, mode = null) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const reviews = dueSelection(cards, now, lim, mode).selected;
  const fresh = freshSelection(cards, now, lim, mode);

  if (reviews.length === 0 && fresh.length === 0) return [];

  // 复习卡先打乱（逾期顺序已经在 slice 时用过了，进了队列就没必要再按 due 排）
  const shuffled = shuffle(reviews, rand);

  if (fresh.length === 0) return spreadSources(shuffled, rand);
  if (shuffled.length === 0) return spreadSources(fresh);

  // 新词均匀插进复习流：每 gap 张复习卡后放一个新词。
  const gap = Math.max(1, Math.floor(shuffled.length / fresh.length));
  const out = [];
  let f = 0;
  for (let i = 0; i < shuffled.length; i += 1) {
    out.push(shuffled[i]);
    if (f < fresh.length && (i + 1) % gap === 0) {
      out.push(fresh[f]);
      f += 1;
    }
  }
  while (f < fresh.length) {
    out.push(fresh[f]);
    f += 1;
  }
  return spreadSources(out);
}

/** Fisher–Yates，不改原数组。 */
function shuffle(arr, rand = Math.random) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 把相邻的同源卡拆开：碰到和前一张同源的，就和后面第一张不同源的换位。
 * 换不动（剩下全是同源）就认了 —— 单词本里本来就可能整本来自同一篇文章。
 */
function spreadSources(queue) {
  const sourceOf = (c) => `${c.source || ""}|${(c.sentence || "").slice(0, 24)}`;
  const out = [...queue];
  for (let i = 1; i < out.length; i += 1) {
    if (sourceOf(out[i]) !== sourceOf(out[i - 1])) continue;
    for (let j = i + 1; j < out.length; j += 1) {
      if (sourceOf(out[j]) !== sourceOf(out[i - 1])) {
        [out[i], out[j]] = [out[j], out[i]];
        break;
      }
    }
  }
  return out;
}

/**
 * 这张卡的正面怎么问（任何词、任何阶段，正面都是认词）。
 *
 *   context   原句里高亮认词（主卡型）：给完整原句、目标词高亮，回忆它在这里是什么意思
 *   recognize 纯词卡（英→中）：收藏时没抓到句子时的退路
 *
 * 要会写的词不再换一张「中→英」的正面，而是认词选了「记得」之后再弹拼写（needsSpelling）。
 *
 * 为什么主卡型从「原句挖空」换成了「原句里高亮认词」：
 *
 *  (a) 阅读和听力要的能力是「看到词想起词义」，和 TOEFL 词汇题同形；L2→L1 正是
 *      训练意义回忆的方向（Mondria & Wiersma 2004：接收方向练出的是接收能力，
 *      产出方向练不出接收速度）。语境在这里的作用是消歧，不是答案。
 *  (b) 旧的挖空卡是个混合体：正面挂着音标，等于已经把词形交出去了，「填词」这一步
 *      退化成照着音标抄；而真实句子的空位本来就不唯一（同一个位置常有好几个词
 *      填得进去），提取目标不清。最关键的是，这张卡从头到尾没要求过**词义**提取，
 *      而词义才是考场上要用的那一半。
 *  (c) 产出方向（给释义、拼出英文）只在词进入 review 状态后才启用：初学阶段就强制
 *      产出会挤占词形编码的注意力资源，反而损害词形学习本身（Barcroft 2006）。
 *      先认得出来，再谈写得出来。见 needsSpelling。
 *
 * 为什么不给每个词同时排「英→中」+「中→英」两张卡：复习量直接翻倍，在每天
 * 10–20 分钟的固定预算下等于词汇覆盖砍半。而 TOEFL 阅读的瓶颈是广度（要到
 * 8000–9000 词族才有 98% 覆盖，Nation 2006），拿一半覆盖换一点词汇深度是亏的。
 * 一个词仍只有一张卡：要会写的词在同一张卡里先认词、再拼写，用户可逐词剔除拼写。
 *
 * 「这次给不给语境」由 pickContext 决定：只有一句语境的词每第 3 次复习会落到
 * recognize（裸词卡），防止记住的是句子而不是词。
 */
export function cardDirection(card) {
  return contextSentence(card) ? "context" : "recognize";
}

/**
 * 认词选了「记得」之后，还要不要写出拼写才算数。
 *
 * 2026-10-02 之前，要会写的词一进 review 正面就换成「给释义拼英文」：学习阶段只练过认词，
 * 毕业后第一次复习突然冷考拼写，线上跨天复习 37% 记成「忘了」（认词只有 3%），
 * 间隔被打回 1 天，重学那几遍又退回认词卡 —— 拼错了却在练认词。
 * 现在改成同一张卡先认词、选「记得」再拼，拼对才算记得：
 *   - 要会写（productive，默认开）且有能当提示的释义；
 *   - 只在 review / relearning 阶段：新词第一天仍只认词（Barcroft 2006，见 cardDirection (c)），
 *     复习时失手进了重学，重学那几遍也要拼对才算数。
 */
export function needsSpelling(card) {
  return card?.productive !== false
    && (card?.state === STATE.REVIEW || card?.state === STATE.RELEARNING)
    && hasUsableSense(card?.def);
}

/** 句子超过这个词数就截到目标词所在的那一段——信息越少，留存越好。 */
const CLOZE_MAX_WORDS = 28;

/** 这张卡手上有哪些语境句（主句在前，去空去重）。 */
export function contextPool(card) {
  const out = [];
  for (const raw of [card?.sentence, ...(Array.isArray(card?.sentences) ? card.sentences : [])]) {
    const s = str(raw).trim();
    if (!s || out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

/**
 * 这一次复习用哪句语境（返回 null = 这次用裸词卡）。
 *
 * 为什么要换句子：同一个词永远在同一句里复习，学到的可能是「这句话里那个位置的词」
 * 而不是词义本身。多语境呈现才让词义泛化到新语境（Bolger, Balass, Landen &
 * Perfetti 2008：同一个词在多个不同语境里出现，学到的词义表征更稳定、更可迁移；
 * Webb 2008：语境的多样性比重复次数更能决定词义知识的质量）。
 *
 * 文献没给「隔几次换一句」的数字，所以规则取最保守的一档：
 *   - 有第二句就按 reps 轮着来（每次复习换一个出处）；
 *   - 只有一句时，每第 3 次复习改用裸词卡（返回 null）—— 逼一次「脱离这句话也认得」，
 *     这是单语境下唯一能检出「记句子不记词」的手段。
 * 裸词轮换只在 review 之后启用：learning 阶段还在建词形—词义的联结，
 * 抽掉语境只会把难度堆在最不该难的地方（同 needsSpelling 对拼写的处理）。
 */
export function pickContext(card) {
  const pool = contextPool(card);
  if (pool.length === 0) return null;
  const reps = Number.isFinite(card?.reps) ? card.reps : 0;
  if (pool.length === 1) {
    if (card?.state === STATE.REVIEW && ((reps % 3) + 3) % 3 === 2) return null;
    return pool[0];
  }
  return pool[((reps % pool.length) + pool.length) % pool.length];
}

/** 目标词的匹配式：大小写不敏感，且吃得下屈折变体（收藏 divide，句子里是 divides）。 */
function wordRe(word) {
  const esc = String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(`\\b${esc}\\w*\\b`, "i");
  } catch {
    return null;
  }
}

/**
 * 这次该拿来用的句子，按优先级排好：pickContext 选中的那句在前，其余的兜底。
 * 兜底是必要的 —— 轮到的那句不一定含目标词（例如用户在别处加语境时词形差太远），
 * 这种情况宁可换一句，也不要退回裸词卡。
 */
function sentenceCandidates(card) {
  const picked = pickContext(card);
  if (!picked) return [];
  return [picked, ...contextPool(card).filter((s) => s !== picked)];
}

/**
 * 这次复习实际用到的那句原文（未截断）：pickContext 选中且含目标词的那句，
 * 兜底顺序与 sentenceCandidates 一致。给卡片**背面**用 —— 正面从池里轮到第二句时，
 * 背面高亮的必须也是这一句，不能一翻面又跳回主句。
 * 一句都用不上时返回 null（调用方可退回 card.sentence 当作答案展示）。
 */
export function activeSentence(card) {
  const re = card?.word ? wordRe(card.word) : null;
  if (!re) return null;
  for (const sentence of sentenceCandidates(card)) {
    if (re.test(sentence)) return sentence;
  }
  return null;
}

/**
 * 在原句里把目标词挖掉。现在只给拼写那一步用（认词选「记得」之后）：要你拼出英文，
 * 句子里当然不能出现答案。
 * 挖不出来就返回 null —— 绝不能渲染出一个没挖空的句子。
 */
export function clozeSentence(card) {
  const re = card?.word ? wordRe(card.word) : null;
  if (!re) return null;
  // 拼写填的是词条本身；句中即使是 divides，答案仍是 divide。
  const letters = [...card.word].filter((char) => /\p{L}/u.test(char)).length;
  const blank = "_".repeat(Math.max(1, letters));
  for (const sentence of sentenceCandidates(card)) {
    if (re.test(sentence)) return trimAroundBlank(sentence.replace(re, blank), blank);
  }
  return null;
}

/**
 * 原句里保留目标词本身的那一版，用于 context 卡（正面高亮这个词，问它是什么意思）。
 * 匹配规则和 clozeSentence 完全一致，长句也走同一套截断；区别只在于最后把空格填回
 * 原文里那个词形 —— 用户看到的必须是他当时读到的样子。
 * 一句都用不上（池空 / 轮到裸词卡 / 谁都不含这个词）就返回 null，调用方退回纯词卡。
 */
export function contextSentence(card) {
  const re = card?.word ? wordRe(card.word) : null;
  if (!re) return null;
  for (const sentence of sentenceCandidates(card)) {
    const hit = sentence.match(re);
    if (!hit) continue;
    // 先挖空再截断，保证截出来的那一段一定是目标词所在的那一段，然后把词原样放回去。
    return trimAroundBlank(sentence.replace(re, "______")).replace("______", hit[0]);
  }
  return null;
}

/** 长句只留挖空所在的从句，两侧按逗号/分号扩到词数上限为止。 */
function trimAroundBlank(blanked, blank = "______") {
  if (blanked.split(/\s+/).length <= CLOZE_MAX_WORDS) return blanked;
  const parts = blanked.split(/(?<=[,;:—–])\s+/);
  const hit = parts.findIndex((p) => p.includes(blank));
  if (hit < 0) return blanked;
  let lo = hit;
  let hi = hit;
  const words = (i, j) => parts.slice(i, j + 1).join(" ").split(/\s+/).length;
  while (words(lo, hi) < CLOZE_MAX_WORDS && (lo > 0 || hi < parts.length - 1)) {
    // 先往左扩（主语多半在左边，留着句子才读得通），左边到头再往右
    if (lo > 0 && words(lo - 1, hi) <= CLOZE_MAX_WORDS) lo -= 1;
    else if (hi < parts.length - 1 && words(lo, hi + 1) <= CLOZE_MAX_WORDS) hi += 1;
    else break;
  }
  const out = parts.slice(lo, hi + 1).join(" ").trim();
  return `${lo > 0 ? "… " : ""}${out}${hi < parts.length - 1 ? " …" : ""}`;
}

/** 来源科目的中文名，复习时显示在卡片上 —— 情境线索本身就是有效的提取线索。 */
const SOURCE_LABELS = {
  reading: "阅读",
  listening: "听力",
  speaking: "口语",
  writing: "写作",
  "real-bank": "真题",
  manual: "手动添加",
};
export function sourceLabel(card) {
  return SOURCE_LABELS[card?.source] || "练习";
}

/** 列表页排序用：留存率最低的排前面（最该看的）。 */
export function sortByUrgency(cards, now = new Date()) {
  return [...activeCards(cards)].sort((a, b) => {
    const ra = currentRetrievability(a, now);
    const rb = currentRetrievability(b, now);
    if (ra == null && rb == null) return new Date(b.createdAt) - new Date(a.createdAt);
    if (ra == null) return -1;
    if (rb == null) return 1;
    return ra - rb;
  });
}
