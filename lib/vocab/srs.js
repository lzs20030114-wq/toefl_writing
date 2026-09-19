/**
 * 单词本的间隔重复调度器 —— FSRS-6（DSR 模型）。
 *
 * 纯函数、不碰浏览器 API 也不碰存储，便于直接跑测试；UI 只负责把卡片传进来、
 * 把返回的新状态写回去。
 *
 * 记忆三量（DSR）：
 *   S  stability      稳定度，单位「天」：留存率从 100% 掉到 90% 需要多少天
 *   D  difficulty     这个词对这个人有多难，1(最易)–10(最难)
 *   R  retrievability 此刻还想得起来的概率，由 S 和距上次复习的天数推出
 *
 * 遗忘曲线（幂函数，比传统指数形式更贴合真实复习日志）：
 *   R(t, S) = (1 + FACTOR · t / S) ^ DECAY
 * FSRS-6 把 decay 变成了可学习参数 w[20]（4.5/5 里它是固定的 −0.5），
 * FACTOR 由它反推，保证 R(S, S) ≡ 0.9 —— 这就是「稳定度单位是天」的定义。
 * 由目标留存率反解间隔：
 *   I(S) = S / FACTOR · (DR ^ (1/DECAY) − 1)
 *
 * 为什么是 FSRS 而不是 SM-2（Anki 经典算法）：SM-2 只维护一个 ease factor，
 * 不建模「这次复习时你还剩多少记忆」，答错就粗暴砍间隔。srs-benchmark
 * （9999 用户 / 3.5 亿条复习）上 FSRS-6 的 log loss 0.3460，FSRS-4.5 0.3625，
 * Duolingo 的 HLR 0.4694（比「永远输出平均留存率」的常数基线 0.3945 还差）。
 * 完整横评、公式推导与实证依据见 docs/vocab-srs-research.md。
 */

export const RATING = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };
export const RATINGS = [RATING.AGAIN, RATING.HARD, RATING.GOOD, RATING.EASY];

export const STATE = {
  NEW: "new",
  LEARNING: "learning",
  REVIEW: "review",
  RELEARNING: "relearning",
};

const DAY_MS = 86400000;
const MIN_MS = 60000;

/**
 * FSRS-6 默认权重（21 个）。
 *
 * 取自 FSRS 官方实现的出厂默认值（py-fsrs `DEFAULT_PARAMETERS` 与 fsrs-rs
 * `FSRS6_DEFAULT_PARAMETERS` 一致），是在千万级真实复习日志上拟合出来的。
 * __tests__/vocab-srs.test.js 把「这组权重应当算出的具体数值」钉成了断言
 * （D₀ 四档、DR=0.9 时的首间隔、R(S,S)=0.9），抄错任何一位小数都会红 ——
 * 这类错误不会崩、不会报错，只会让用户默默记不住词，所以必须由测试兜底。
 *
 * 等本项目自己的复习日志攒够了，应该用 fsrs-optimizer 在我们的数据上重新
 * 拟合一套作为新的全局默认值（群体拟合，不是每人一套）。算法形状不用动，
 * 只换这 21 个数。
 *
 * 语义：
 *   w0..w3   首次评 Again/Hard/Good/Easy 的初始稳定度（天）
 *   w4, w5   初始难度：D₀(G) = w4 − e^(w5·(G−1)) + 1
 *   w6       难度更新步长        w7  难度均值回归系数
 *   w8..w10  记得时的稳定度增益   w11..w14 遗忘后的稳定度
 *   w15      Hard 折扣           w16 Easy 加成
 *   w17..w19 当日二次复习         w20 遗忘曲线的 decay
 */
export const DEFAULT_W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
  1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
  1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];

export const DEFAULT_PARAMS = {
  w: DEFAULT_W,
  /**
   * 目标留存率：到期时希望还记得的概率。
   * 社区常说的最优值 0.85 优化的是「无限期长跑的单位工作量知识产出」；
   * 我们的用户 60 天后要考试，优化的是考试当天的留存总量。模拟下
   * 0.85→0.90 复习量 +20% 换考试日留存 +1.3~3.9 点（划算），
   * 0.90→0.95 再 +45% 只换 +1.6~3.3 点（不划算）。所以默认 0.90。
   */
  requestRetention: 0.9,
  /**
   * 间隔上限（天）。库默认 36500，对备考毫无意义 —— 排到考试之后 = 永不再见。
   * 设了考试日期的用户会被 paramsForPlan() 进一步收紧到「距考试天数」。
   */
  maximumInterval: 90,
  /**
   * 学习步骤（分钟）。两步 = 一个新词在首日要隔开答对 3 次才毕业
   * （第一次当场 → 10 分钟后 → 再 20 分钟后）。
   *
   * 这是对 Anki/FSRS 官方指导的**有意偏离**：官方建议只留**单个**步骤
   * （10m/15m/20m/30m），理由是多步会干扰 FSRS 的排期精度、还可能让 Hard 的
   * 间隔超过 Good。但那条建议的前提在 FSRS-6 已经不成立 —— 它把当日复习单独
   * 建模进去了（w17..w19 的 same-day 公式），当日多看一次不再污染长期 S 的估计。
   *
   * 我们真正要买的是**首日提取次数**：同一场里隔开提取 5–7 次显著优于 1–3 次
   * （Nakata 2017），而「答对 3 次」是投入产出比最高的那个门槛 ——
   * 再往上加次数，长期留存的边际收益已经压不过时间成本
   * （Rawson & Dunlosky 2011）。两步刚好把新词卡在 3 次答对上。
   */
  learningSteps: [10, 20],
  /**
   * 重学步骤（分钟）。同上：忘掉的词也要首日隔开答对 3 次才放回复习流 ——
   * 一次答对就放回去，下次见面多半还是忘（lapse 的本质是 S 已经塌了）。
   */
  relearningSteps: [10, 20],
  /**
   * 新词毕业后的第一个间隔强制压到 1 天。
   * FSRS 在 DR=0.9 下给 Good 的首间隔是 2.3 天；压到 1 天是有据可依的偏离：
   * 两次学习之间插入一次睡眠，所需练习量减半且长期留存显著更好
   * （Mazza et al. 2016）。今天学的新词，明天一定要再见一次。
   */
  firstIntervalDays: 1,
  /** 间隔抖动：同一天涌入的词不会永远绑在一起到期。 */
  fuzz: true,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const decayOf = (w) => -(w[20] ?? 0.1542);
/** FACTOR 由 decay 反推，保证 R(S, S) ≡ 0.9。 */
const factorOf = (w) => Math.pow(0.9, 1 / decayOf(w)) - 1;

/** R(t, S)：距上次复习 elapsedDays 天后，还想得起来的概率。 */
export function forgettingCurve(elapsedDays, stability, w = DEFAULT_W) {
  if (!(stability > 0)) return 0;
  return Math.pow(1 + (factorOf(w) * Math.max(0, elapsedDays)) / stability, decayOf(w));
}

/** 由稳定度反解「留存率掉到 requestRetention」时的间隔（天，未取整）。 */
export function intervalFromStability(stability, requestRetention, w = DEFAULT_W) {
  if (!(stability > 0)) return 0;
  return (stability / factorOf(w)) * (Math.pow(requestRetention, 1 / decayOf(w)) - 1);
}

function initialStability(w, rating) {
  return Math.max(0.01, w[rating - 1]);
}

/** D₀(G) = w4 − e^(w5·(G−1)) + 1。注意 Easy 档原始值为负是正常的。 */
function initialDifficultyRaw(w, rating) {
  return w[4] - Math.exp(w[5] * (rating - 1)) + 1;
}

function nextDifficulty(w, difficulty, rating) {
  const delta = -w[6] * (rating - 3);
  // 线性阻尼：D 越接近 10，同样的评分推得越动不了。这才是防「难度地狱」的主力，
  // 均值回归（w7 默认 0.001）只是兜底。
  const damped = difficulty + ((10 - difficulty) * delta) / 9;
  const reverted = w[7] * initialDifficultyRaw(w, RATING.EASY) + (1 - w[7]) * damped;
  return clamp(reverted, 1, 10);
}

function stabilityAfterRecall(w, stability, difficulty, retrievability, rating) {
  const hardPenalty = rating === RATING.HARD ? w[15] : 1;
  const easyBonus = rating === RATING.EASY ? w[16] : 1;
  const growth =
    Math.exp(w[8]) *
    (11 - difficulty) *
    Math.pow(stability, -w[9]) *
    (Math.exp((1 - retrievability) * w[10]) - 1) *
    hardPenalty *
    easyBonus;
  return Math.max(0.01, stability * (1 + growth));
}

function stabilityAfterLapse(w, stability, difficulty, retrievability) {
  const longTerm =
    w[11] *
    Math.pow(difficulty, -w[12]) *
    (Math.pow(stability + 1, w[13]) - 1) *
    Math.exp((1 - retrievability) * w[14]);
  // 遗忘后的稳定度不得高于「当日再看一遍」那条路径算出来的值。
  const shortTerm = stability / Math.exp(w[17] * w[18]);
  return Math.max(0.01, Math.min(longTerm, shortTerm));
}

/** 当日二次复习：增益随 S 增大而收敛 —— 算法层面就否定了「一个词连刷五遍」。 */
function stabilitySameDay(w, stability, rating) {
  const raw = Math.exp(w[17] * (rating - 3 + w[18])) * Math.pow(stability, -w[19]);
  const factor = rating >= RATING.HARD ? Math.max(raw, 1) : raw;
  return Math.max(0.01, stability * factor);
}

/**
 * 间隔抖动：把 interval 在 ±5%（至少 ±1 天）内随机挪一挪。
 * rand 可注入，测试里传固定值就能得到确定结果。
 */
function applyFuzz(interval, rand) {
  if (interval < 2.5) return interval;
  const delta = Math.max(1, interval * 0.05);
  return interval - delta + rand() * delta * 2;
}

/** 新卡片的 SRS 初始状态（还没排期，due = 现在，等着进今日新词队列）。 */
export function newCardState(now = new Date()) {
  const iso = new Date(now).toISOString();
  return {
    state: STATE.NEW,
    step: 0,
    stability: 0,
    difficulty: 0,
    due: iso,
    lastReview: null,
    reps: 0,
    lapses: 0,
    scheduledDays: 0,
  };
}

/** 距上次复习过了多少天（新卡/首次复习算 0）。 */
export function elapsedDaysOf(card, now = new Date()) {
  if (!card?.lastReview) return 0;
  const ms = new Date(now).getTime() - new Date(card.lastReview).getTime();
  return Math.max(0, ms / DAY_MS);
}

/** 此刻这张卡还想得起来的概率（0–1）；新卡返回 null。 */
export function currentRetrievability(card, now = new Date(), w = DEFAULT_W) {
  if (!card || !(card.stability > 0) || !card.lastReview) return null;
  return forgettingCurve(elapsedDaysOf(card, now), card.stability, w);
}

export function isDue(card, now = new Date()) {
  if (!card?.due) return true;
  return new Date(card.due).getTime() <= new Date(now).getTime();
}

/**
 * 核心：给一张卡打分，算出新的 SRS 状态。
 *
 * @param {object} card    带 SRS 字段的卡片（新卡可以只给 {}）
 * @param {number} rating  RATING.AGAIN|HARD|GOOD|EASY（UI 只发 AGAIN / GOOD）
 * @param {Date}   now
 * @param {object} params  覆盖 DEFAULT_PARAMS 的部分字段
 * @param {function} rand  [0,1) 随机源，测试可注入
 * @returns {object} 新的 SRS 字段（不含 word/def 等业务字段，由调用方合并）
 */
export function schedule(card, rating, now = new Date(), params = {}, rand = Math.random) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const w = p.w || DEFAULT_W;
  const at = new Date(now);
  const prevState = card?.state || STATE.NEW;
  const isFirst = prevState === STATE.NEW || !(card?.stability > 0);
  const elapsed = elapsedDaysOf(card, at);
  // 同一天内的再次复习走 same-day 公式，不能当成「隔了 0 天的长期复习」。
  const sameDay = !isFirst && elapsed < 1;

  let difficulty;
  let stability;

  if (isFirst) {
    difficulty = clamp(initialDifficultyRaw(w, rating), 1, 10);
    stability = initialStability(w, rating);
  } else {
    const r = forgettingCurve(elapsed, card.stability, w);
    difficulty = nextDifficulty(w, card.difficulty, rating);
    stability = sameDay
      ? stabilitySameDay(w, card.stability, rating)
      : rating === RATING.AGAIN
        ? stabilityAfterLapse(w, card.stability, difficulty, r)
        : stabilityAfterRecall(w, card.stability, difficulty, r, rating);
  }

  const reps = (card?.reps || 0) + 1;
  const lapses = (card?.lapses || 0) + (rating === RATING.AGAIN && prevState === STATE.REVIEW ? 1 : 0);
  const base = { stability, difficulty, lastReview: at.toISOString(), reps, lapses };

  const stepAt = (state, step, minutes) => ({
    ...base,
    state,
    step,
    due: new Date(at.getTime() + minutes * MIN_MS).toISOString(),
    scheduledDays: 0,
  });

  // ── 分支 1：还在学习/重学阶段，按分钟排，当天内再见一次 ──
  const inSteps = prevState === STATE.NEW || prevState === STATE.LEARNING || prevState === STATE.RELEARNING;
  const steps = prevState === STATE.RELEARNING ? p.relearningSteps : p.learningSteps;
  if (inSteps && steps.length > 0 && rating !== RATING.EASY) {
    // 新卡还没进步骤，用 -1 表示「在第一步之前」：这样一次 Good 是落到 step 0
    // （10 分钟后当天再见一次），而不是直接跳过学习阶段毕业。
    const curStep = prevState === STATE.NEW ? -1 : card?.step || 0;
    // Again 退回第一步；Hard 原地再来一次；Good 前进一步。
    const nextStep =
      rating === RATING.AGAIN ? 0 : rating === RATING.HARD ? Math.max(0, curStep) : curStep + 1;
    if (nextStep < steps.length) {
      return stepAt(prevState === STATE.RELEARNING ? STATE.RELEARNING : STATE.LEARNING, nextStep, steps[nextStep]);
    }
    // 走完最后一步 → 毕业，落到下面按天排。
  }

  // ── 分支 2：复习阶段答错 → 进重学队列 ──
  if (rating === RATING.AGAIN && prevState === STATE.REVIEW && p.relearningSteps.length > 0) {
    return stepAt(STATE.RELEARNING, 0, p.relearningSteps[0]);
  }

  // ── 分支 3：按天排期 ──
  let interval = intervalFromStability(stability, p.requestRetention, w);
  // 新词毕业的第一步压到 1 天，让它跨过一次睡眠（Mazza et al. 2016）。
  if (inSteps && p.firstIntervalDays > 0) interval = Math.min(interval, p.firstIntervalDays);
  if (p.fuzz) interval = applyFuzz(interval, rand);
  const days = clamp(Math.round(interval), 1, p.maximumInterval);

  return {
    ...base,
    state: STATE.REVIEW,
    step: 0,
    due: new Date(at.getTime() + days * DAY_MS).toISOString(),
    scheduledDays: days,
  };
}

/**
 * 按备考计划收紧调度参数。
 *
 *   - 间隔上限压到「距考试还剩几天」：排到考试之后的复习等于没排
 *   - 考前 10 天进冲刺档：目标留存率拉到 0.95，用更多复习量换考试日的确定性
 *
 * @param {string|null} examDate  "YYYY-MM-DD"
 */
export function paramsForPlan(examDate, now = new Date()) {
  if (!examDate) return {};
  const exam = new Date(`${examDate}T23:59:59`);
  if (Number.isNaN(exam.getTime())) return {};
  const daysLeft = Math.ceil((exam.getTime() - new Date(now).getTime()) / DAY_MS);
  if (daysLeft <= 0) return {};
  const out = { maximumInterval: Math.max(1, Math.min(DEFAULT_PARAMS.maximumInterval, daysLeft)) };
  if (daysLeft <= 10) out.requestRetention = 0.95;
  return out;
}

/** 这张卡下次什么时候再见（分钟）。用于「明天还有多少」这类预估，不写回状态。 */
export function previewIntervals(card, now = new Date(), params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params, fuzz: false };
  const out = {};
  for (const rating of RATINGS) {
    const next = schedule(card, rating, now, p);
    out[rating] = {
      due: next.due,
      minutes: Math.max(1, Math.round((new Date(next.due).getTime() - new Date(now).getTime()) / MIN_MS)),
      days: next.scheduledDays,
    };
  }
  return out;
}

/** 把分钟数说成人话：「15 分钟 / 2 天 / 3 个月」。 */
export function formatWait(minutes) {
  if (!(minutes > 0)) return "马上";
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时`;
  const days = minutes / (60 * 24);
  if (days < 31) return `${Math.round(days)} 天`;
  if (days < 365) return `${Math.round(days / 30)} 个月`;
  return `${(days / 365).toFixed(1)} 年`;
}
