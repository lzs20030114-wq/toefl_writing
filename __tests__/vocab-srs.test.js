/**
 * 单词本调度器（lib/vocab/srs.js）+ 纯数据层（lib/vocab/book.js）的行为锁。
 *
 * 这两个模块决定「一个词下次什么时候再出现」，错了用户不会看见报错，只会
 * 觉得「这 App 背不牢」——所以在这里把关键不变量钉死。
 */
import {
  RATING,
  STATE,
  DEFAULT_PARAMS,
  schedule,
  newCardState,
  forgettingCurve,
  intervalFromStability,
  currentRetrievability,
  previewIntervals,
  formatWait,
  paramsForPlan,
  DEFAULT_W,
} from "../lib/vocab/srs";
import {
  normalizeCard,
  mergeCards,
  bookStats,
  buildQueue,
  activeSentence,
  cardDirection,
  clozeSentence,
  contextPool,
  contextSentence,
  introducedToday,
  knowledgeEstimate,
  pickContext,
  sourceLabel,
} from "../lib/vocab/book";
import { saveWord, addSentence, chooseSense, getCard } from "../lib/vocab/vocabStore";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => null),
  getSavedTier: jest.fn(() => "free"),
  AUTH_CHANGED_EVENT: "toefl-auth-changed",
}));

const NOW = new Date("2026-09-13T08:00:00Z");
const DAY = 86400000;
// 关掉抖动，断言才是确定的
const P = { ...DEFAULT_PARAMS, fuzz: false };

function reviewCard(extra = {}) {
  return {
    ...newCardState(NOW),
    state: STATE.REVIEW,
    stability: 10,
    difficulty: 5,
    reps: 3,
    lastReview: new Date(NOW.getTime() - 10 * DAY).toISOString(),
    scheduledDays: 10,
    ...extra,
  };
}

/**
 * FSRS-6 出厂参数的数值核对。
 *
 * 这些期望值取自 FSRS 官方实现（py-fsrs / fsrs-rs）的默认参数所应当算出的结果，
 * 与 docs/vocab-srs-research.md 第三节列的表一致。抄错权重里任何一位小数都不会
 * 崩、不会报错，只会让用户默默记不住词 —— 这一组断言就是为了让它崩。
 */
describe("FSRS-6 出厂参数", () => {
  const D0 = (g) => DEFAULT_W[4] - Math.exp(DEFAULT_W[5] * (g - 1)) + 1;

  test("权重是 21 个（FSRS-6，不是 4.5 的 17 个或 5 的 19 个）", () => {
    expect(DEFAULT_W).toHaveLength(21);
  });

  test("初始难度 D0 四档", () => {
    expect(D0(1)).toBeCloseTo(6.4133, 4);
    expect(D0(2)).toBeCloseTo(5.1122, 4);
    expect(D0(3)).toBeCloseTo(2.1181, 4);
    expect(D0(4)).toBeCloseTo(-4.7716, 4); // Easy 档原始值为负是正常的
  });

  test("decay = -w20 = -0.1542（FSRS-6 才把它变成可学习参数，4.5/5 是固定 -0.5）", () => {
    expect(DEFAULT_W[20]).toBeCloseTo(0.1542, 6);
  });

  test("R(S, S) 恒等于 0.9 —— 稳定度「单位是天」的定义式", () => {
    for (const S of [0.5, 2.3065, 10, 90]) {
      expect(forgettingCurve(S, S)).toBeCloseTo(0.9, 9);
    }
  });

  test("DR=0.9 时的首次间隔：Again 0.2 / Hard 1.3 / Good 2.3 / Easy 8.3 天", () => {
    const got = [1, 2, 3, 4].map((g) => intervalFromStability(DEFAULT_W[g - 1], 0.9));
    expect(got[0]).toBeCloseTo(0.2, 1);
    expect(got[1]).toBeCloseTo(1.3, 1);
    expect(got[2]).toBeCloseTo(2.3, 1);
    expect(got[3]).toBeCloseTo(8.3, 1);
  });

  test("S=10 的遗忘曲线尾部（FSRS-6 比 4.5 厚得多）", () => {
    expect(forgettingCurve(40, 10)).toBeCloseTo(0.782, 3);
    expect(forgettingCurve(100, 10)).toBeCloseTo(0.693, 3);
    expect(forgettingCurve(365, 10)).toBeCloseTo(0.574, 3);
  });
});

describe("遗忘曲线", () => {
  test("t=0 时必然记得，之后单调下降", () => {
    expect(forgettingCurve(0, 10)).toBeCloseTo(1, 6);
    const a = forgettingCurve(5, 10);
    const b = forgettingCurve(20, 10);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0);
  });

  test("稳定度越高，同样天数后记得越牢", () => {
    expect(forgettingCurve(10, 30)).toBeGreaterThan(forgettingCurve(10, 5));
  });

  test("目标留存率 0.9 时，间隔就等于稳定度（DSR 的定义式）", () => {
    expect(intervalFromStability(17, 0.9)).toBeCloseTo(17, 6);
  });

  test("要求记得越牢，间隔越短", () => {
    expect(intervalFromStability(17, 0.95)).toBeLessThan(intervalFromStability(17, 0.85));
  });
});

describe("首次评分", () => {
  test("四档给出的初始稳定度递增", () => {
    const s = [RATING.AGAIN, RATING.HARD, RATING.GOOD, RATING.EASY].map(
      (r) => schedule({}, r, NOW, P).stability,
    );
    expect(s[0]).toBeLessThan(s[1]);
    expect(s[1]).toBeLessThan(s[2]);
    expect(s[2]).toBeLessThan(s[3]);
  });

  test("评 Again 的新词落在学习步骤里（分钟级），当天还会再见", () => {
    const next = schedule({}, RATING.AGAIN, NOW, P);
    expect(next.state).toBe(STATE.LEARNING);
    expect(new Date(next.due).getTime() - NOW.getTime()).toBeLessThan(60 * 60 * 1000);
  });

  test("评 Easy 的新词直接毕业，按天排", () => {
    const next = schedule({}, RATING.EASY, NOW, P);
    expect(next.state).toBe(STATE.REVIEW);
    expect(next.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  test("Again 给出的难度高于 Easy", () => {
    expect(schedule({}, RATING.AGAIN, NOW, P).difficulty)
      .toBeGreaterThan(schedule({}, RATING.EASY, NOW, P).difficulty);
  });
});

describe("复习阶段", () => {
  test("记得 → 稳定度增加、间隔变长", () => {
    const card = reviewCard();
    const next = schedule(card, RATING.GOOD, NOW, P);
    expect(next.stability).toBeGreaterThan(card.stability);
    expect(next.scheduledDays).toBeGreaterThan(card.scheduledDays);
    expect(next.state).toBe(STATE.REVIEW);
  });

  test("四档评分的间隔严格递增（Again < Hard < Good < Easy）", () => {
    const card = reviewCard();
    const days = [RATING.HARD, RATING.GOOD, RATING.EASY].map(
      (r) => schedule(card, r, NOW, P).scheduledDays,
    );
    expect(days[0]).toBeLessThan(days[1]);
    expect(days[1]).toBeLessThan(days[2]);
    const again = schedule(card, RATING.AGAIN, NOW, P);
    expect(again.state).toBe(STATE.RELEARNING);
  });

  test("忘了 → 进重学队列、lapses+1、稳定度不反超", () => {
    const card = reviewCard();
    const next = schedule(card, RATING.AGAIN, NOW, P);
    expect(next.state).toBe(STATE.RELEARNING);
    expect(next.lapses).toBe(card.lapses + 1);
    expect(next.stability).toBeLessThanOrEqual(card.stability);
    expect(next.stability).toBeGreaterThan(0);
  });

  test("难的词间隔涨得比简单的词慢", () => {
    const easyWord = schedule(reviewCard({ difficulty: 2 }), RATING.GOOD, NOW, P);
    const hardWord = schedule(reviewCard({ difficulty: 9 }), RATING.GOOD, NOW, P);
    expect(hardWord.scheduledDays).toBeLessThan(easyWord.scheduledDays);
  });

  test("难度不会被连续 Good 单调推到 10（均值回归生效）", () => {
    let card = reviewCard({ difficulty: 9.5 });
    for (let i = 0; i < 30; i += 1) {
      card = { ...card, ...schedule(card, RATING.GOOD, new Date(NOW.getTime() + i * 40 * DAY), P) };
    }
    expect(card.difficulty).toBeLessThan(9.5);
    expect(card.difficulty).toBeGreaterThanOrEqual(1);
  });

  test("难度永远落在 1–10", () => {
    let card = reviewCard();
    for (let i = 0; i < 50; i += 1) {
      const r = [RATING.AGAIN, RATING.HARD, RATING.GOOD, RATING.EASY][i % 4];
      card = { ...card, ...schedule(card, r, new Date(NOW.getTime() + i * DAY), P) };
      expect(card.difficulty).toBeGreaterThanOrEqual(1);
      expect(card.difficulty).toBeLessThanOrEqual(10);
    }
  });

  test("间隔不超过 maximumInterval（备考周期内不能把词排到看不见的地方）", () => {
    let card = reviewCard();
    for (let i = 0; i < 40; i += 1) {
      const at = new Date(new Date(card.due).getTime());
      card = { ...card, ...schedule(card, RATING.EASY, at, P) };
      expect(card.scheduledDays).toBeLessThanOrEqual(P.maximumInterval);
    }
  });

  test("逾期很久才复习且记得 → 稳定度涨得比准时复习更多", () => {
    const onTime = schedule(reviewCard({ lastReview: new Date(NOW.getTime() - 2 * DAY).toISOString() }), RATING.GOOD, NOW, P);
    const overdue = schedule(reviewCard({ lastReview: new Date(NOW.getTime() - 40 * DAY).toISOString() }), RATING.GOOD, NOW, P);
    expect(overdue.stability).toBeGreaterThan(onTime.stability);
  });
});

describe("学习步骤", () => {
  const waitMin = (next, from) => (new Date(next.due).getTime() - from.getTime()) / 60000;

  test("新词第一次 Good 落在 10 分钟后的学习步上，不跳过当天巩固", () => {
    const next = schedule(newCardState(NOW), RATING.GOOD, NOW, P);
    expect(next.state).toBe(STATE.LEARNING);
    expect(next.step).toBe(0);
    expect(waitMin(next, NOW)).toBeCloseTo(10, 3);
  });

  /**
   * 首日三次提取是这套配置的核心（Nakata 2017 / Rawson & Dunlosky 2011），
   * 两步学习步就是为了买到它 —— 所以把整条路径钉死，别被「官方建议单步」改回去。
   */
  test("新词首日要隔开答对 3 次才毕业：当场 → 10 分钟 → 20 分钟 → review(1 天)", () => {
    let card = { ...newCardState(NOW) };

    const s1 = schedule(card, RATING.GOOD, NOW, P);
    expect(s1.state).toBe(STATE.LEARNING);
    expect(s1.step).toBe(0);
    expect(waitMin(s1, NOW)).toBeCloseTo(10, 3);

    card = { ...card, ...s1 };
    const at2 = new Date(NOW.getTime() + 11 * 60000);
    const s2 = schedule(card, RATING.GOOD, at2, P);
    expect(s2.state).toBe(STATE.LEARNING);
    expect(s2.step).toBe(1);
    expect(waitMin(s2, at2)).toBeCloseTo(20, 3);

    card = { ...card, ...s2 };
    const at3 = new Date(at2.getTime() + 21 * 60000);
    const s3 = schedule(card, RATING.GOOD, at3, P);
    expect(s3.state).toBe(STATE.REVIEW);
    // 新词毕业后的第一个间隔压到 1 天，让它跨过一次睡眠（Mazza et al. 2016）
    expect(s3.scheduledDays).toBe(1);
  });

  test("学习步里任何一步评 Again 都退回第一步（10 分钟）", () => {
    const atStep0 = { ...newCardState(NOW), state: STATE.LEARNING, step: 0, stability: 3, difficulty: 5, reps: 1 };
    const back0 = schedule(atStep0, RATING.AGAIN, NOW, P);
    expect(back0.state).toBe(STATE.LEARNING);
    expect(back0.step).toBe(0);
    expect(waitMin(back0, NOW)).toBeCloseTo(10, 3);

    const atStep1 = { ...atStep0, step: 1 };
    const back1 = schedule(atStep1, RATING.AGAIN, NOW, P);
    expect(back1.state).toBe(STATE.LEARNING);
    expect(back1.step).toBe(0);
    expect(waitMin(back1, NOW)).toBeCloseTo(10, 3);
  });

  test("忘掉的词同样要隔开答对 3 次才放回复习流：10 分钟 → 20 分钟 → review(1 天)", () => {
    let card = reviewCard();

    const lapse = schedule(card, RATING.AGAIN, NOW, P);
    expect(lapse.state).toBe(STATE.RELEARNING);
    expect(lapse.step).toBe(0);
    expect(waitMin(lapse, NOW)).toBeCloseTo(10, 3);

    card = { ...card, ...lapse };
    const at2 = new Date(NOW.getTime() + 11 * 60000);
    const s2 = schedule(card, RATING.GOOD, at2, P);
    expect(s2.state).toBe(STATE.RELEARNING);
    expect(s2.step).toBe(1);
    expect(waitMin(s2, at2)).toBeCloseTo(20, 3);

    card = { ...card, ...s2 };
    const at3 = new Date(at2.getTime() + 21 * 60000);
    const s3 = schedule(card, RATING.GOOD, at3, P);
    expect(s3.state).toBe(STATE.REVIEW);
    expect(s3.scheduledDays).toBe(1);
  });

  test("重学中评 Again 退回重学第一步", () => {
    const card = { ...newCardState(NOW), state: STATE.RELEARNING, step: 1, stability: 3, difficulty: 5, reps: 4 };
    const next = schedule(card, RATING.AGAIN, NOW, P);
    expect(next.state).toBe(STATE.RELEARNING);
    expect(next.step).toBe(0);
    expect(waitMin(next, NOW)).toBeCloseTo(10, 3);
  });

  test("复习卡当天再看一遍走 same-day 公式，稳定度不会暴涨", () => {
    const card = reviewCard({ lastReview: new Date(NOW.getTime() - 2 * 3600000).toISOString() });
    const next = schedule(card, RATING.GOOD, NOW, P);
    expect(next.stability).toBeGreaterThanOrEqual(card.stability);
    expect(next.stability).toBeLessThan(card.stability * 1.5);
  });
});

describe("备考计划收紧参数", () => {
  test("没设考试日期就用默认", () => {
    expect(paramsForPlan(null, NOW)).toEqual({});
  });

  test("间隔上限压到距考试天数", () => {
    const in20 = new Date(NOW.getTime() + 20 * DAY);
    const p = paramsForPlan(in20.toISOString().slice(0, 10), NOW);
    expect(p.maximumInterval).toBeLessThanOrEqual(21);
    expect(p.requestRetention).toBeUndefined();
  });

  test("考前 10 天内进冲刺档，目标留存率拉到 0.95", () => {
    const in5 = new Date(NOW.getTime() + 5 * DAY);
    const p = paramsForPlan(in5.toISOString().slice(0, 10), NOW);
    expect(p.requestRetention).toBe(0.95);
    expect(p.maximumInterval).toBeLessThanOrEqual(6);
  });

  test("考试日已过就不再收紧（用户没改计划也不该被卡死）", () => {
    const past = new Date(NOW.getTime() - 3 * DAY);
    expect(paramsForPlan(past.toISOString().slice(0, 10), NOW)).toEqual({});
  });
});

describe("previewIntervals / formatWait", () => {
  test("四个按钮各给一个未来时间，且不改动原卡", () => {
    const card = reviewCard();
    const snapshot = JSON.stringify(card);
    const p = previewIntervals(card, NOW);
    expect(Object.keys(p)).toHaveLength(4);
    for (const r of [1, 2, 3, 4]) {
      expect(new Date(p[r].due).getTime()).toBeGreaterThan(NOW.getTime());
    }
    expect(JSON.stringify(card)).toBe(snapshot);
  });

  test("说人话", () => {
    expect(formatWait(1)).toBe("1 分钟");
    expect(formatWait(120)).toBe("2 小时");
    expect(formatWait(60 * 24 * 3)).toBe("3 天");
    expect(formatWait(60 * 24 * 60)).toBe("2 个月");
  });
});

describe("currentRetrievability", () => {
  test("新卡返回 null，复习过的卡返回 0–1", () => {
    expect(currentRetrievability(newCardState(NOW), NOW)).toBeNull();
    const r = currentRetrievability(reviewCard(), NOW);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(1);
  });
});

/* ── book.js ── */

describe("normalizeCard", () => {
  test("词形统一小写去空格；没有 word 就不是一张卡", () => {
    expect(normalizeCard({ word: "  Photosynthesis " }).word).toBe("photosynthesis");
    expect(normalizeCard({ word: "" })).toBeNull();
    expect(normalizeCard(null)).toBeNull();
  });

  test("缺字段时补出完整形状，不会渲染时炸 undefined", () => {
    const c = normalizeCard({ word: "cell" }, NOW);
    expect(c.state).toBe(STATE.NEW);
    expect(c.reps).toBe(0);
    expect(c.def).toBe("");
    expect(c.defFull).toBe("");
    expect(c.sentences).toEqual([]);
    expect(c.productive).toBe(true);
    expect(c.spellingOptOut).toBe(false);
    expect(typeof c.due).toBe("string");
  });

  test("旧卡的默认 false 不算手动剔除，只有新标记才关闭会写要求", () => {
    expect(normalizeCard({ word: "old", productive: false }).productive).toBe(true);
    const excluded = normalizeCard({ word: "excluded", productive: false, spellingOptOut: true });
    expect(excluded.productive).toBe(false);
    expect(excluded.spellingOptOut).toBe(true);
  });

  test("语境池去空去重、剔掉和主句重复的那句", () => {
    const c = normalizeCard({
      word: "pattern",
      sentence: "A pattern emerged.",
      sentences: ["A pattern emerged.", "  ", "The pattern repeats.", "The pattern repeats."],
    });
    expect(c.sentences).toEqual(["The pattern repeats."]);
  });

  test("语境池最多 3 句，超了丢最早加的那几句", () => {
    const c = normalizeCard({
      word: "pattern",
      sentence: "Main.",
      sentences: ["one pattern", "two pattern", "three pattern", "four pattern"],
    });
    expect(c.sentences).toEqual(["two pattern", "three pattern", "four pattern"]);
  });

  test("defFull 收下整条词典释义", () => {
    const c = normalizeCard({ word: "pattern", def: "n. 图案", defFull: "n. 图案, 模式\nvt. 模仿" });
    expect(c.def).toBe("n. 图案");
    expect(c.defFull).toBe("n. 图案, 模式\nvt. 模仿");
  });
});

describe("mergeCards", () => {
  test("同一个词按 updatedAt 取新的", () => {
    const older = normalizeCard({ word: "cell", def: "旧", updatedAt: "2026-09-01T00:00:00Z", reps: 1 });
    const newer = normalizeCard({ word: "cell", def: "新", updatedAt: "2026-09-10T00:00:00Z", reps: 5 });
    const merged = mergeCards([older], [newer]);
    expect(merged).toHaveLength(1);
    expect(merged[0].def).toBe("新");
    expect(merged[0].reps).toBe(5);
  });

  test("updatedAt 打平时留复习次数多的那份", () => {
    const a = normalizeCard({ word: "cell", updatedAt: "2026-09-10T00:00:00Z", reps: 1 });
    const b = normalizeCard({ word: "cell", updatedAt: "2026-09-10T00:00:00Z", reps: 7 });
    expect(mergeCards([a], [b])[0].reps).toBe(7);
  });

  test("业务字段取并集：一端补的例句不会因为另一端更新而丢", () => {
    const withSentence = normalizeCard({ word: "cell", sentence: "A cell is small.", updatedAt: "2026-09-01T00:00:00Z" });
    const newerNoSentence = normalizeCard({ word: "cell", def: "细胞", updatedAt: "2026-09-10T00:00:00Z" });
    const merged = mergeCards([withSentence], [newerNoSentence]);
    expect(merged[0].sentence).toBe("A cell is small.");
    expect(merged[0].def).toBe("细胞");
  });

  test("「要会写」开关跟 updatedAt 新的一方走，不做并集（关掉也要能同步出去）", () => {
    const on = normalizeCard({ word: "cell", productive: true, updatedAt: "2026-09-01T00:00:00Z" });
    const off = normalizeCard({ word: "cell", spellingOptOut: true, updatedAt: "2026-09-10T00:00:00Z" });
    expect(mergeCards([on], [off])[0].productive).toBe(false);
    expect(mergeCards([off], [on])[0].productive).toBe(false);
    expect(mergeCards([on], [off])[0].spellingOptOut).toBe(true);
    // 反过来（新的那份打开了）当然也要生效
    const onNewer = normalizeCard({ word: "cell", productive: true, updatedAt: "2026-09-20T00:00:00Z" });
    expect(mergeCards([off], [onNewer])[0].productive).toBe(true);
  });

  test("语境池取并集（winner 的在前），defFull 也不会因为另一端更新而丢", () => {
    const local = normalizeCard({
      word: "pattern", sentence: "Main.", sentences: ["local pattern"],
      defFull: "n. 图案, 模式", updatedAt: "2026-09-10T00:00:00Z",
    });
    const remote = normalizeCard({
      word: "pattern", sentence: "Main.", sentences: ["remote pattern"],
      updatedAt: "2026-09-01T00:00:00Z",
    });
    const merged = mergeCards([local], [remote]);
    expect(merged[0].sentences).toEqual(["local pattern", "remote pattern"]);
    expect(merged[0].defFull).toBe("n. 图案, 模式");
  });

  test("并集撞上限时保 winner 那几句，且不会把主句重复进池", () => {
    const winner = normalizeCard({
      word: "pattern", sentence: "Main pattern.", sentences: ["w1 pattern", "w2 pattern", "w3 pattern"],
      updatedAt: "2026-09-10T00:00:00Z",
    });
    const loser = normalizeCard({
      word: "pattern", sentence: "Main pattern.", sentences: ["l1 pattern", "Main pattern."],
      updatedAt: "2026-09-01T00:00:00Z",
    });
    const merged = mergeCards([winner], [loser]);
    expect(merged[0].sentences).toEqual(["w1 pattern", "w2 pattern", "w3 pattern"]);
  });

  test("软删除能传播（删除侧更新时间更新 → 删除赢）", () => {
    const alive = normalizeCard({ word: "cell", updatedAt: "2026-09-01T00:00:00Z" });
    const deleted = normalizeCard({ word: "cell", updatedAt: "2026-09-10T00:00:00Z", deletedAt: "2026-09-10T00:00:00Z" });
    expect(mergeCards([alive], [deleted])[0].deletedAt).toBeTruthy();
  });

  test("两边各有独有的词时都保留", () => {
    const merged = mergeCards(
      [normalizeCard({ word: "a" })],
      [normalizeCard({ word: "b" })],
    );
    expect(merged.map((c) => c.word).sort()).toEqual(["a", "b"]);
  });
});

describe("bookStats / buildQueue", () => {
  const limits = { newPerDay: 3, maxReviews: 100 };

  function makeBook() {
    return [
      // 到期的复习卡
      normalizeCard({ word: "due1", state: STATE.REVIEW, stability: 5, difficulty: 5, reps: 2, scheduledDays: 5, due: new Date(NOW.getTime() - 2 * DAY).toISOString(), lastReview: new Date(NOW.getTime() - 7 * DAY).toISOString() }),
      normalizeCard({ word: "due2", state: STATE.REVIEW, stability: 5, difficulty: 5, reps: 2, scheduledDays: 5, due: new Date(NOW.getTime() - 1 * DAY).toISOString(), lastReview: new Date(NOW.getTime() - 6 * DAY).toISOString() }),
      // 没到期的
      normalizeCard({ word: "later", state: STATE.REVIEW, stability: 40, difficulty: 5, reps: 6, scheduledDays: 40, due: new Date(NOW.getTime() + 20 * DAY).toISOString(), lastReview: NOW.toISOString() }),
      // 已记牢
      normalizeCard({ word: "mature", state: STATE.REVIEW, stability: 60, difficulty: 3, reps: 9, scheduledDays: 60, due: new Date(NOW.getTime() + 50 * DAY).toISOString(), lastReview: NOW.toISOString() }),
      // 新词 5 个
      ...["n1", "n2", "n3", "n4", "n5"].map((w, i) =>
        normalizeCard({ word: w, createdAt: new Date(NOW.getTime() - (5 - i) * DAY).toISOString() }),
      ),
      // 软删除的不算数
      normalizeCard({ word: "gone", deletedAt: NOW.toISOString() }),
    ];
  }

  test("统计只数活着的卡，新词受每日配额限制", () => {
    const s = bookStats(makeBook(), NOW, limits);
    expect(s.total).toBe(9);
    expect(s.dueReview).toBe(2);
    expect(s.untouched).toBe(5);
    expect(s.newToday).toBe(3); // newPerDay=3
    expect(s.todo).toBe(5);
    expect(s.mature).toBe(2); // later(40d) + mature(60d) 都 ≥21
  });

  test("队列 = 到期复习 + 限额内的新词，没到期的和删掉的都不进来", () => {
    const q = buildQueue(makeBook(), NOW, limits, () => 0.5);
    expect(q).toHaveLength(5);
    const words = q.map((c) => c.word).sort();
    expect(words).toEqual(["due1", "due2", "n1", "n2", "n3"]);
  });

  test("队列会被打乱（不是每次都按同一顺序发）", () => {
    const book = [
      ...Array.from({ length: 12 }, (_, i) =>
        normalizeCard({
          word: `w${i}`, state: STATE.REVIEW, stability: 5, difficulty: 5, reps: 2, scheduledDays: 5,
          due: new Date(NOW.getTime() - (12 - i) * DAY).toISOString(),
          lastReview: new Date(NOW.getTime() - 20 * DAY).toISOString(),
        }),
      ),
    ];
    const a = buildQueue(book, NOW, { newPerDay: 0, maxReviews: 100 }, () => 0.1).map((c) => c.word);
    const b = buildQueue(book, NOW, { newPerDay: 0, maxReviews: 100 }, () => 0.9).map((c) => c.word);
    expect(a.sort()).toEqual(b.sort()); // 集合一样
    const a2 = buildQueue(book, NOW, { newPerDay: 0, maxReviews: 100 }, () => 0.1).map((c) => c.word);
    const b2 = buildQueue(book, NOW, { newPerDay: 0, maxReviews: 100 }, () => 0.9).map((c) => c.word);
    expect(a2).not.toEqual(b2); // 顺序不一样
  });

  test("同一篇文章来的词不会连着出现（相邻同源要被拆开）", () => {
    const sent = (n) => `Sentence ${n} about things.`;
    const book = [
      ...["a1", "a2", "a3"].map((w) => normalizeCard({ word: w, source: "reading", sentence: sent(1), state: STATE.REVIEW, stability: 5, difficulty: 5, reps: 2, scheduledDays: 5, due: new Date(NOW.getTime() - DAY).toISOString(), lastReview: new Date(NOW.getTime() - 6 * DAY).toISOString() })),
      ...["b1", "b2", "b3"].map((w) => normalizeCard({ word: w, source: "listening", sentence: sent(2), state: STATE.REVIEW, stability: 5, difficulty: 5, reps: 2, scheduledDays: 5, due: new Date(NOW.getTime() - DAY).toISOString(), lastReview: new Date(NOW.getTime() - 6 * DAY).toISOString() })),
    ];
    const q = buildQueue(book, NOW, { newPerDay: 0, maxReviews: 100 }, () => 0);
    let adjacent = 0;
    for (let i = 1; i < q.length; i += 1) {
      if (q[i].sentence === q[i - 1].sentence) adjacent += 1;
    }
    expect(adjacent).toBe(0);
  });

  test("预计记得的词数 = 各卡可提取度之和，新词不计入", () => {
    const book = [
      normalizeCard({ word: "solid", state: STATE.REVIEW, stability: 100, difficulty: 4, reps: 5, scheduledDays: 100, lastReview: NOW.toISOString(), due: new Date(NOW.getTime() + 100 * DAY).toISOString() }),
      normalizeCard({ word: "faded", state: STATE.REVIEW, stability: 1, difficulty: 8, reps: 2, scheduledDays: 1, lastReview: new Date(NOW.getTime() - 200 * DAY).toISOString(), due: new Date(NOW.getTime() - 199 * DAY).toISOString() }),
      normalizeCard({ word: "fresh" }),
    ];
    expect(knowledgeEstimate(book, NOW)).toBe(1); // 1.0 + 约 0.2 + 0
    expect(knowledgeEstimate([], NOW)).toBe(0);
  });

  test("新词按收藏先后放出，不会跳号", () => {
    const q = buildQueue(makeBook(), NOW, limits);
    const fresh = q.filter((c) => c.state === STATE.NEW).map((c) => c.word);
    expect(fresh).toEqual(["n1", "n2", "n3"]);
  });

  test("今天已放出的新词要从明日配额里扣掉", () => {
    const book = makeBook().map((c) =>
      c.word === "n1" ? { ...c, state: STATE.LEARNING, introducedAt: NOW.toISOString(), reps: 1 } : c,
    );
    expect(introducedToday(book, NOW)).toBe(1);
    const s = bookStats(book, NOW, limits);
    expect(s.newToday).toBe(2); // 3 - 1
  });

  test("maxReviews 截断复习量", () => {
    const q = buildQueue(makeBook(), NOW, { newPerDay: 0, maxReviews: 1 });
    expect(q).toHaveLength(1);
  });

  test("空本子给空队列，不抛异常", () => {
    expect(buildQueue([], NOW, limits)).toEqual([]);
    expect(bookStats([], NOW, limits).todo).toBe(0);
  });
});

describe("卡片方向 / 原句", () => {
  test("主卡型是原句里高亮认词 —— 有句子且句子里找得到这个词就走 context", () => {
    expect(cardDirection({ word: "divide", source: "reading", sentence: "A cell divides." })).toBe("context");
  });

  test("收藏时没抓到句子（或句子里没这个词）→ 退回纯词卡", () => {
    expect(cardDirection({ word: "cell", source: "reading" })).toBe("recognize");
    expect(cardDirection({ word: "cell", source: "reading", sentence: "无关的句子。" })).toBe("recognize");
  });

  test("所有来源的词默认在 review 后走产出方向（中→英）", () => {
    expect(cardDirection({ word: "divide", source: "writing", sentence: "A cell divides.", state: STATE.REVIEW })).toBe("recall");
    expect(cardDirection({ word: "divide", source: "speaking", state: STATE.REVIEW })).toBe("recall");
    expect(cardDirection({ word: "divide", source: "reading", state: STATE.REVIEW })).toBe("recall");
  });

  test("手动剔除后，写作和口语词也只考认词", () => {
    expect(cardDirection({ word: "divide", source: "writing", productive: false, sentence: "A cell divides.", state: STATE.REVIEW })).toBe("context");
    expect(cardDirection({ word: "divide", source: "speaking", productive: false, state: STATE.REVIEW })).toBe("recognize");
  });

  test("还没进 review 的产出词先认词 —— 初学阶段强制产出反而损害词形学习（Barcroft 2006）", () => {
    for (const st of [STATE.NEW, STATE.LEARNING, STATE.RELEARNING]) {
      expect(cardDirection({ word: "divide", source: "writing", sentence: "A cell divides.", state: st })).toBe("context");
      expect(cardDirection({ word: "divide", source: "speaking", state: st })).toBe("recognize");
      expect(cardDirection({ word: "divide", source: "reading", productive: true, state: st })).toBe("recognize");
    }
  });

  test("还没进 review 的卡：方向不随复习次数变（学习阶段不做裸词轮换）", () => {
    const card = { word: "divide", source: "reading", sentence: "A cell divides." };
    for (const st of [STATE.NEW, STATE.LEARNING, STATE.RELEARNING]) {
      const dirs = [0, 1, 2, 3, 7].map((reps) => cardDirection({ ...card, state: st, reps }));
      expect(new Set(dirs)).toEqual(new Set(["context"]));
    }
  });

  test("review 后、只有一句语境的词：每第 3 次复习改用裸词卡，防止记住的是句子", () => {
    const card = { word: "divide", source: "reading", productive: false, sentence: "A cell divides.", state: STATE.REVIEW };
    const dirs = [0, 1, 2, 3, 4, 5].map((reps) => cardDirection({ ...card, reps }));
    expect(dirs).toEqual(["context", "context", "recognize", "context", "context", "recognize"]);
  });

  test("有第二句语境时就轮换着用，永远不会掉成裸词卡", () => {
    const card = {
      word: "divide", source: "reading", productive: false, state: STATE.REVIEW,
      sentence: "A cell divides.", sentences: ["Rivers divide the plain."],
    };
    const dirs = [0, 1, 2, 3].map((reps) => cardDirection({ ...card, reps }));
    expect(new Set(dirs)).toEqual(new Set(["context"]));
    const used = [0, 1, 2, 3].map((reps) => contextSentence({ ...card, reps }));
    expect(used).toEqual([
      "A cell divides.", "Rivers divide the plain.",
      "A cell divides.", "Rivers divide the plain.",
    ]);
  });

  test("context 句把目标词原样留在原句里（屈折变体和大小写都不许被改写）", () => {
    expect(contextSentence({ word: "divide", sentence: "A cell divides rapidly." }))
      .toBe("A cell divides rapidly.");
    expect(contextSentence({ word: "pivotal", sentence: "Pivotal moments are rare." }))
      .toBe("Pivotal moments are rare.");
  });

  test("超过 28 词的长句截断后仍然含目标词，且不会漏出下划线", () => {
    const long =
      "Although the evidence remains contested, the discovery was pivotal in reshaping our understanding of early human migration, which scholars had long assumed to be impossible during the glacial maximum.";
    const out = contextSentence({ word: "pivotal", sentence: long });
    expect(out).toContain("pivotal");
    expect(out).not.toContain("______");
    expect(out.split(/\s+/).length).toBeLessThanOrEqual(30);
    expect(out.length).toBeLessThan(long.length);
  });

  test("句子里找不到这个词 / 根本没句子 → 返回 null，调用方退回纯词卡", () => {
    expect(contextSentence({ word: "cell", sentence: "Nothing here." })).toBeNull();
    expect(contextSentence({ word: "cell", sentence: "" })).toBeNull();
    expect(contextSentence({ word: "cell" })).toBeNull();
    expect(contextSentence(null)).toBeNull();
  });

  test("长句挖空后截到目标词所在的那一段", () => {
    const long =
      "Although the evidence remains contested, the discovery was pivotal in reshaping our understanding of early human migration, which scholars had long assumed to be impossible during the glacial maximum.";
    const out = clozeSentence({ word: "pivotal", sentence: long });
    expect(out).toContain("_______");
    expect(out.split(/\s+/).length).toBeLessThanOrEqual(30);
    expect(out.length).toBeLessThan(long.length);
  });

  test("语境池 = 主句 + 额外句，去空去重", () => {
    expect(contextPool({ word: "divide", sentence: "A.", sentences: ["B.", "A.", ""] })).toEqual(["A.", "B."]);
    expect(contextPool({ word: "divide" })).toEqual([]);
    expect(contextPool(null)).toEqual([]);
  });

  test("pickContext 四种情况", () => {
    // 池空 → 没有语境可给
    expect(pickContext({ word: "divide" })).toBeNull();
    // 只有一句、还没进 review → 每次都是这一句
    expect(pickContext({ word: "divide", sentence: "A.", state: STATE.LEARNING, reps: 2 })).toBe("A.");
    // 只有一句、进了 review → 每第 3 次（reps % 3 === 2）改用裸词卡
    expect(pickContext({ word: "divide", sentence: "A.", state: STATE.REVIEW, reps: 2 })).toBeNull();
    expect(pickContext({ word: "divide", sentence: "A.", state: STATE.REVIEW, reps: 3 })).toBe("A.");
    // 有两句以上 → 按 reps 轮换
    const many = { word: "divide", sentence: "A.", sentences: ["B.", "C."], state: STATE.REVIEW };
    expect([0, 1, 2, 3, 4].map((reps) => pickContext({ ...many, reps })))
      .toEqual(["A.", "B.", "C.", "A.", "B."]);
  });

  test("轮到池里第二句时，长句照样截到目标词那一段", () => {
    const long =
      "Although the evidence remains contested, the discovery was pivotal in reshaping our understanding of early human migration, which scholars had long assumed to be impossible during the glacial maximum.";
    const card = { word: "pivotal", sentence: "A pivotal choice.", sentences: [long], state: STATE.REVIEW, reps: 1 };
    const out = contextSentence(card);
    expect(out).toContain("pivotal");
    expect(out).not.toContain("______");
    expect(out.split(/\s+/).length).toBeLessThanOrEqual(30);
    expect(out.length).toBeLessThan(long.length);
  });

  test("轮到的那句里没有这个词时，顺着池里其余的句子找，不白白退回裸词卡", () => {
    const card = {
      word: "divide", productive: false, state: STATE.REVIEW, reps: 1,
      sentence: "A cell divides.", sentences: ["与这个词无关的一句。"],
    };
    expect(contextSentence(card)).toBe("A cell divides.");
    expect(cardDirection(card)).toBe("context");
  });

  test("来源显示成中文", () => {
    expect(sourceLabel({ source: "reading" })).toBe("阅读");
    expect(sourceLabel({ source: "listening" })).toBe("听力");
    expect(sourceLabel({})).toBe("练习");
  });

  test("挖空把词换成下划线，屈折形式也能挖掉", () => {
    expect(clozeSentence({ word: "divide", sentence: "A cell divides rapidly." }))
      .toBe("A cell ______ rapidly.");
    expect(clozeSentence({ word: "approximately", sentence: "There are approximately 1,670 stones." }))
      .toBe("There are _____________ 1,670 stones.");
    expect(clozeSentence({ word: "cat", sentence: "The cats slept." }))
      .toBe("The ___ slept.");
  });

  test("句子里找不到这个词就不出挖空卡", () => {
    expect(clozeSentence({ word: "cell", sentence: "Nothing here." })).toBeNull();
    expect(clozeSentence({ word: "cell", sentence: "" })).toBeNull();
  });
});

/**
 * 存储层里和语境池/义项相关的那几条规则（vocabStore 是浏览器层，jsdom 下直接跑）。
 */
describe("vocabStore · 语境池与义项", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("再次收藏同一个词：主句不动，新句子进池", () => {
    saveWord({ word: "pattern", def: "n. 图案", sentence: "A pattern emerged.", source: "reading" });
    saveWord({ word: "pattern", def: "n. 图案", sentence: "The pattern repeats.", source: "listening" });
    const card = getCard("pattern");
    expect(card.sentence).toBe("A pattern emerged.");
    expect(card.sentences).toEqual(["The pattern repeats."]);
  });

  test("同一句再收藏一次不会在池里重复", () => {
    saveWord({ word: "pattern", sentence: "A pattern emerged.", source: "reading" });
    saveWord({ word: "pattern", sentence: "A pattern emerged.", source: "reading" });
    expect(getCard("pattern").sentences).toEqual([]);
  });

  test("addSentence 追加一句；满 3 句后丢最早的那句", () => {
    saveWord({ word: "pattern", sentence: "Main pattern.", source: "reading" });
    ["one pattern", "two pattern", "three pattern", "four pattern"].forEach((s) => addSentence("pattern", s));
    expect(getCard("pattern").sentences).toEqual(["two pattern", "three pattern", "four pattern"]);
  });

  test("addSentence 对没收藏的词返回 null，对已在卡上的句子不重复追加", () => {
    expect(addSentence("nosuchword", "x")).toBeNull();
    saveWord({ word: "pattern", sentence: "Main pattern.", source: "reading" });
    expect(addSentence("pattern", "Main pattern.").sentences).toEqual([]);
    addSentence("pattern", "two pattern");
    expect(addSentence("pattern", "two pattern").sentences).toEqual(["two pattern"]);
  });

  test("chooseSense 把某一条义项设成主释义，整条留作 defFull", () => {
    const full = "n. 模范, 典型, 图案\nvt. 模仿";
    saveWord({ word: "pattern", def: full, sentence: "A pattern emerged.", source: "reading" });
    const next = chooseSense("pattern", "n. 图案", full);
    expect(next.def).toBe("n. 图案");
    expect(next.defFull).toBe(full);
    expect(getCard("pattern").def).toBe("n. 图案");
    expect(chooseSense("nosuchword", "n. 图案", full)).toBeNull();
  });

  test("chooseSense 没带整条释义时，把被顶掉的旧释义留作备份", () => {
    saveWord({ word: "pattern", def: "n. 模范, 图案", sentence: "A pattern emerged.", source: "reading" });
    expect(chooseSense("pattern", "n. 图案").defFull).toBe("n. 模范, 图案");
  });
});

describe("activeSentence · 背面例句与正面同源", () => {
  const two = {
    word: "pattern",
    state: "review",
    sentence: "The pattern on the vase is Greek.",
    sentences: ["Weather patterns shift every decade."],
  };
  test("轮到池里第二句时返回第二句（未截断原文）", () => {
    expect(activeSentence({ ...two, reps: 1 })).toBe("Weather patterns shift every decade.");
    expect(activeSentence({ ...two, reps: 2 })).toBe("The pattern on the vase is Greek.");
  });
  test("只有一句且轮到裸词卡时返回 null，调用方退回主句", () => {
    const one = { word: "cell", state: "review", sentence: "Every cell has a nucleus.", reps: 5 };
    expect(activeSentence(one)).toBeNull();
    expect(activeSentence({ ...one, reps: 3 })).toBe("Every cell has a nucleus.");
  });
  test("轮到的句子不含目标词就兜底到含词的那句", () => {
    const card = { ...two, reps: 1, sentences: ["A sentence about something else."] };
    expect(activeSentence(card)).toBe("The pattern on the vase is Greek.");
  });
});
