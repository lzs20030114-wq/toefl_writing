/**
 * 单词本的纯数据层：规范化、合并、统计、排队。
 * 不碰 localStorage / fetch / React，全部可直接跑测试。
 */

import { STATE, isDue, newCardState, currentRetrievability } from "./srs";

/** 单词本一张卡的完整形状（word 是主键，一个词只有一张卡）。 */
export const CARD_FIELDS = [
  "word", "display", "phonetic", "def", "tag", "sentence", "source",
  "createdAt", "updatedAt", "introducedAt", "deletedAt",
  "state", "step", "stability", "difficulty", "due", "lastReview",
  "reps", "lapses", "scheduledDays",
];

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

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** 把任意来源（本地旧数据 / 云端行 / 收藏入参）收拾成一张合法卡片。 */
export function normalizeCard(raw, now = new Date()) {
  if (!raw) return null;
  const word = str(raw.word).trim().toLowerCase();
  if (!word) return null;
  const nowIso = new Date(now).toISOString();
  const srs = newCardState(now);
  return {
    word,
    display: str(raw.display || raw.word).trim() || word,
    phonetic: str(raw.phonetic).trim(),
    def: str(raw.def).trim(),
    tag: str(raw.tag).trim(),
    sentence: str(raw.sentence).trim().slice(0, 400),
    source: str(raw.source).trim() || "reading",
    createdAt: raw.createdAt || nowIso,
    updatedAt: raw.updatedAt || raw.createdAt || nowIso,
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
    map.set(c.word, {
      ...winner,
      sentence: winner.sentence || loser.sentence,
      phonetic: winner.phonetic || loser.phonetic,
      def: winner.def || loser.def,
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
  const today = new Date(now);
  const key = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  return activeCards(cards).filter((c) => {
    if (!c.introducedAt) return false;
    const d = new Date(c.introducedAt);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === key;
  }).length;
}

/** 单词本首页那一排数字。 */
export function bookStats(cards, now = new Date(), limits = DEFAULT_LIMITS) {
  const live = activeCards(cards);
  const lim = { ...DEFAULT_LIMITS, ...limits };
  let dueReview = 0;
  let learning = 0;
  let mature = 0;
  let untouched = 0;
  for (const c of live) {
    if (c.state === STATE.NEW) {
      untouched += 1;
      continue;
    }
    if (c.state === STATE.LEARNING || c.state === STATE.RELEARNING) learning += 1;
    if (c.scheduledDays >= MATURE_DAYS) mature += 1;
    if (isDue(c, now)) dueReview += 1;
  }
  const newQuota = Math.max(0, lim.newPerDay - introducedToday(live, now));
  const newToday = Math.min(untouched, newQuota);
  return {
    total: live.length,
    /** 今天要过的卡 = 到期复习 + 今天该放的新词 */
    todo: Math.min(dueReview, lim.maxReviews > 0 ? lim.maxReviews : dueReview) + newToday,
    dueReview,
    newToday,
    untouched,
    learning,
    mature,
    knowledge: knowledgeEstimate(live, now),
  };
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
export function buildQueue(cards, now = new Date(), limits = DEFAULT_LIMITS, rand = Math.random) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const live = activeCards(cards);

  const due = live
    .filter((c) => c.state !== STATE.NEW && isDue(c, now))
    .sort((a, b) => new Date(a.due) - new Date(b.due));
  const reviews = lim.maxReviews > 0 ? due.slice(0, lim.maxReviews) : due;

  const quota = Math.max(0, lim.newPerDay - introducedToday(live, now));
  const fresh = live
    .filter((c) => c.state === STATE.NEW)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(0, quota);

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

/** 收藏自这些科目的词走产出方向（中→英）：写作口语要的是「想得起来、写得出来」。 */
const PRODUCTIVE_SOURCES = new Set(["writing", "speaking"]);

/**
 * 这张卡该怎么问。
 *
 *   cloze     原句挖空（主卡型）：给挖了空的句子 + 音标，让你把词填回去
 *   recognize 纯词卡（英→中）：收藏时没抓到句子时的退路
 *   recall    产出卡（中→英）：给中文释义，让你拼出英文词
 *
 * 为什么主卡是挖空而不是词表：语境提升的是理解，真正提升留存的是**提取**——
 * 同一个句子，挖空和不挖空是两种完全不同的学习活动（den Broek 2018/2022）。
 * 挖空句同时满足语境、提取、以及和阅读听力考法对齐三件事。
 *
 * 为什么不给每个词同时排「英→中」+「中→英」两张卡：复习量直接翻倍，在每天
 * 10–20 分钟的固定预算下等于词汇覆盖砍半。而 TOEFL 阅读的瓶颈是广度（要到
 * 8000–9000 词族才有 98% 覆盖，Nation 2006），拿一半覆盖换一点词汇深度是亏的。
 * 所以一个词只有一张卡，只有写作/口语来源的词才默认走产出方向。
 */
export function cardDirection(card) {
  if (PRODUCTIVE_SOURCES.has(card?.source) || card?.productive === true) return "recall";
  return clozeSentence(card) ? "cloze" : "recognize";
}

/** 句子超过这个词数就截到目标词所在的那一段——信息越少，留存越好。 */
const CLOZE_MAX_WORDS = 28;

/**
 * 在原句里把目标词挖掉，用于 cloze 卡。
 * 大小写不敏感，且吃得下屈折变体（收藏 divide，句子里是 divides）。
 * 挖不出来就返回 null，调用方退回纯词卡 —— 绝不能渲染出一个没挖空的句子。
 */
export function clozeSentence(card) {
  const sentence = card?.sentence;
  const word = card?.word;
  if (!sentence || !word) return null;
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re;
  try {
    re = new RegExp(`\\b${esc}\\w*\\b`, "i");
  } catch {
    return null;
  }
  if (!re.test(sentence)) return null;
  return trimAroundBlank(sentence.replace(re, "______"));
}

/** 长句只留挖空所在的从句，两侧按逗号/分号扩到词数上限为止。 */
function trimAroundBlank(blanked) {
  if (blanked.split(/\s+/).length <= CLOZE_MAX_WORDS) return blanked;
  const parts = blanked.split(/(?<=[,;:—–])\s+/);
  const hit = parts.findIndex((p) => p.includes("______"));
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
