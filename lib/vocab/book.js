/**
 * 单词本的纯数据层：规范化、合并、统计、排队。
 * 不碰 localStorage / fetch / React，全部可直接跑测试。
 */

import { STATE, isDue, newCardState, currentRetrievability } from "./srs";

/** 单词本一张卡的完整形状（word 是主键，一个词只有一张卡）。 */
export const CARD_FIELDS = [
  "word", "display", "phonetic", "def", "defFull", "tag", "sentence", "sentences", "source",
  "productive",
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
  return {
    word,
    display: str(raw.display || raw.word).trim() || word,
    phonetic: str(raw.phonetic).trim(),
    def: str(raw.def).trim(),
    // 用户点选了某一条义项当主释义时，整条词典释义留在这儿当备份（复习背面小字展示）。
    defFull: str(raw.defFull).trim(),
    tag: str(raw.tag).trim(),
    sentence,
    // 同一个词在别处又遇到时追加的语境句（主句不变），复习时轮换着用。
    sentences: normalizeSentences(raw.sentences, sentence),
    source: str(raw.source).trim() || "reading",
    // 用户手动标的「这个词要会写」：进入 review 后转成产出卡（见 cardDirection）。
    productive: raw.productive === true,
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
    // 注意 productive 刻意不在并集里（由 ...winner 带过来）：它是个开关，
    // 用户在一台设备上关掉，必须能同步成「关」，并集会让它再也关不掉。
    const sentence = winner.sentence || loser.sentence;
    map.set(c.word, {
      ...winner,
      sentence,
      // 语境池也取并集：在手机上加的那句，不该因为电脑上打了一次分就没了。
      // 这里截断方向和 normalizeSentences 相反（留前 MAX_CONTEXTS 条）：
      // 合并时 winner 的句子排在前面，要保的是它，不是 loser 补进来的尾巴。
      sentences: dedupeSentences(
        [...(winner.sentences || []), ...(loser.sentences || [])],
        sentence,
      ).slice(0, MAX_CONTEXTS),
      phonetic: winner.phonetic || loser.phonetic,
      def: winner.def || loser.def,
      defFull: winner.defFull || loser.defFull,
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

/** 收藏自这些科目的词进入 review 后走产出方向（中→英）：写作口语要的是「写得出来」。 */
const PRODUCTIVE_SOURCES = new Set(["writing", "speaking"]);

/**
 * 这张卡该怎么问。
 *
 *   context   原句里高亮认词（主卡型）：给完整原句、目标词高亮，回忆它在这里是什么意思
 *   recognize 纯词卡（英→中）：收藏时没抓到句子时的退路
 *   recall    产出卡（中→英）：给中文释义 + 挖空的原句，让你拼出英文词
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
 *      先认得出来，再谈写得出来。
 *
 * 为什么不给每个词同时排「英→中」+「中→英」两张卡：复习量直接翻倍，在每天
 * 10–20 分钟的固定预算下等于词汇覆盖砍半。而 TOEFL 阅读的瓶颈是广度（要到
 * 8000–9000 词族才有 98% 覆盖，Nation 2006），拿一半覆盖换一点词汇深度是亏的。
 * 所以一个词只有一张卡，只有写作/口语来源（或用户手动勾了「要会写」）的词
 * 才在进入 review 后转成产出方向。
 *
 * 方向对单词是稳定的，但「这次给不给语境」由 pickContext 决定：只有一句语境的词
 * 每第 3 次复习会落到 recognize（裸词卡），防止记住的是句子而不是词。
 */
export function cardDirection(card) {
  const wantsProductive = PRODUCTIVE_SOURCES.has(card?.source) || card?.productive === true;
  if (wantsProductive && card?.state === STATE.REVIEW) return "recall";
  return contextSentence(card) ? "context" : "recognize";
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
 * 抽掉语境只会把难度堆在最不该难的地方（同 cardDirection 对产出卡的处理）。
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
 * 在原句里把目标词挖掉。现在只给 recall（产出）卡的正面用：那张卡要你拼出英文，
 * 句子里当然不能出现答案。
 * 挖不出来就返回 null —— 绝不能渲染出一个没挖空的句子。
 */
export function clozeSentence(card) {
  const re = card?.word ? wordRe(card.word) : null;
  if (!re) return null;
  for (const sentence of sentenceCandidates(card)) {
    if (re.test(sentence)) return trimAroundBlank(sentence.replace(re, "______"));
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
