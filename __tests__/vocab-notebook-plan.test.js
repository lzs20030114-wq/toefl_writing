import {
  LEECH_LAPSES, SORT_OPTIONS, bookStats, buildQueue, cardStage, estimateMinutes, forecastLoad, isLeech,
  localDayKey, normalizeCard, sortCards,
} from "../lib/vocab/book";
import { STATE, RATING } from "../lib/vocab/srs";
import { clearReviewSave, normalizeReviewSave, readReviewSave, resumableQueue, writeReviewSave } from "../lib/vocab/reviewSave";
import { editDefinition, getCard, gradeCard, loadBook, saveWord, setSuspended, undoGrade } from "../lib/vocab/vocabStore";
import { localLogCount } from "../lib/vocab/reviewLog";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: () => "",
  AUTH_CHANGED_EVENT: "auth-changed",
}));

const now = new Date(2026, 8, 28, 12);
const iso = (d, h = 12) => new Date(2026, 8, d, h).toISOString();
const review = (word, over = {}) => normalizeCard({
  word, def: "v. 词义", sentence: `We ${word} it.`, state: STATE.REVIEW, stability: 5, difficulty: 5,
  scheduledDays: 5, reps: 3, lastReview: iso(25), due: iso(27), introducedAt: iso(20), ...over,
}, now);

describe("今日计划 · bookStats", () => {
  test("已过的词和待过的词合起来是今日总量，同一个词只算一次", () => {
    const cards = [
      review("a"), review("b"),
      // 今天评过一次「忘了」：学习步还没到期，不算待办
      review("c", { state: STATE.RELEARNING, lastReview: iso(28, 9), due: iso(28, 18) }),
      // 今天评过又因为学习步 10 分钟前到期：既在已过里、又在待过里
      review("d", { state: STATE.RELEARNING, lastReview: iso(28, 11), due: iso(28, 11) }),
      normalizeCard({ word: "fresh", def: "新" }, now),
    ];
    const stats = bookStats(cards, now, { newPerDay: 5, maxReviews: 100 });
    expect(stats.doneToday).toBe(2); // c, d
    expect(stats.todo).toBe(2 + 1 + 1); // a, b, d 到期 + fresh 新词 = 4
    expect(stats.todayTotal).toBe(2 + 3); // 已过 c,d + 待过 a,b,fresh（d 不重复计）
  });

  test("考拼写 = 进入 review 且要会写的到期词；只需认得的不算", () => {
    const cards = [review("a"), review("b", { spellingOptOut: true }), review("c", { state: STATE.LEARNING })];
    const stats = bookStats(cards, now, { newPerDay: 0, maxReviews: 100 });
    expect(stats.eligibleReview).toBe(3);
    expect(stats.spellingDue).toBe(1);
  });

  test("暂停的词不进队列、不占额度、单独计数", () => {
    const cards = [review("a"), review("b", { suspended: true }), normalizeCard({ word: "p", suspended: true }, now)];
    const stats = bookStats(cards, now, { newPerDay: 10, maxReviews: 100 });
    expect(stats.suspended).toBe(2);
    expect(stats.total).toBe(3);
    expect(stats.todo).toBe(1);
    expect(buildQueue(cards, now, { newPerDay: 10, maxReviews: 100 }, () => 0.5).map((c) => c.word)).toEqual(["a"]);
    expect(cardStage(cards[1])).toBe("paused");
  });

  test("估时：约 16 秒一张，至少 1 分钟，0 张为 0", () => {
    expect([0, 1, 7, 26, 33].map(estimateMinutes)).toEqual([0, 1, 2, 7, 9]);
  });
});

describe("阶段 / 易忘 / 排序", () => {
  test("cardStage 互斥：重学中的老词仍算学习中，即便间隔已很长", () => {
    expect(cardStage(normalizeCard({ word: "n" }, now))).toBe("new");
    expect(cardStage(review("a", { state: STATE.RELEARNING, scheduledDays: 40 }))).toBe("learning");
    expect(cardStage(review("a", { scheduledDays: 40 }))).toBe("mature");
    expect(cardStage(review("a", { scheduledDays: 5 }))).toBe("review");
  });

  test("忘过 3 次起算易忘词", () => {
    expect(LEECH_LAPSES).toBe(3);
    expect(isLeech({ lapses: 2 })).toBe(false);
    expect(isLeech({ lapses: 3 })).toBe(true);
  });

  test("四种排序", () => {
    const cards = [
      review("pear", { createdAt: iso(10), lapses: 0 }),
      review("apple", { createdAt: iso(20), lapses: 4, difficulty: 8 }),
      review("mango", { createdAt: iso(15), lapses: 4, difficulty: 6 }),
    ];
    const names = (key) => sortCards(cards, key, now).map((c) => c.word);
    expect(SORT_OPTIONS.map(([k]) => k)).toEqual(["urgency", "recent", "forgettable", "alpha"]);
    expect(names("recent")).toEqual(["apple", "mango", "pear"]);
    expect(names("alpha")).toEqual(["apple", "mango", "pear"]);
    expect(names("forgettable")).toEqual(["apple", "mango", "pear"]);
    expect(names("urgency")).toHaveLength(3);
  });
});

describe("未来 7 天 · forecastLoad", () => {
  const limits = { newPerDay: 2, maxReviews: 3 };
  test("今天 = 今日总量；之后每天 = 当天到期 + 顺延 + 新词，老词按上限封顶并顺延", () => {
    const cards = [
      review("a"), review("b"), review("c"), review("d"), // 4 张今天到期，上限 3 → 顺延 1
      review("e", { due: iso(29) }), review("f", { due: iso(29) }),
      review("g", { due: iso(30, 9) }),
      ...["n1", "n2", "n3", "n4", "n5"].map((w) => normalizeCard({ word: w, def: "新" }, now)),
    ];
    const { days, total } = forecastLoad(cards, now, limits, 7);
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe(localDayKey(now));
    expect(days[0].n).toBe(3 + 2); // 3 复习 + 2 新词
    // 明天：e,f 到期 + 顺延 1 = 3（正好等于上限）+ 2 新词
    expect(days[1].n).toBe(3 + 2);
    expect(days[1].carried).toBe(1);
    // 后天：g + 新词 1（5 个新词放完 2+2+1）
    expect(days[2].n).toBe(1 + 1);
    expect(days[3].n).toBe(0);
    expect(total).toBe(days.reduce((s, d) => s + d.n, 0));
  });

  test("maxReviews = 0 表示不限，不产生顺延", () => {
    const cards = [review("a"), review("b"), review("e", { due: iso(29) })];
    const { days } = forecastLoad(cards, now, { newPerDay: 0, maxReviews: 0 }, 3);
    expect(days.map((d) => d.n)).toEqual([2, 1, 0]);
    expect(days[1].carried).toBe(0);
  });
});

describe("存档", () => {
  beforeEach(() => localStorage.clear());

  test("写入后同一天可读回，隔天作废；形状不对的丢掉", () => {
    const save = { words: ["a", "b"], answered: 10, tally: { good: 7, again: 3 }, first: { a: true, b: false }, seen: { a: 1 }, lost: ["b"], segNo: 1, elapsedMs: 5000, startStats: { knowledge: 9, mature: 2, learning: 1 } };
    expect(writeReviewSave("guest", "reading", save, now)).toBe(true);
    expect(readReviewSave("guest", "reading", now)).toMatchObject({ words: ["a", "b"], answered: 10, tally: { good: 7, again: 3 }, lost: ["b"], segNo: 1, startStats: { knowledge: 9 } });
    expect(readReviewSave("guest", "listening", now)).toBeNull();
    expect(readReviewSave("USER1", "reading", now)).toBeNull();
    expect(readReviewSave("guest", "reading", new Date(2026, 8, 29, 8))).toBeNull();
    expect(normalizeReviewSave({ v: 2 }, "reading", now)).toBeNull();
    expect(normalizeReviewSave({ v: 1, day: localDayKey(now), mode: "reading", words: [] }, "reading", now)).toBeNull();
    clearReviewSave("guest", "reading");
    expect(readReviewSave("guest", "reading", now)).toBeNull();
  });

  test("恢复队列：丢掉删除/暂停/已在别处复习掉的词，保留未学新词和学习步回访", () => {
    const cards = [
      review("due"),
      review("later", { due: iso(30) }), // 别处已复习，不再到期
      review("soon", { state: STATE.RELEARNING, due: new Date(now.getTime() + 10 * 60000).toISOString() }),
      review("paused", { suspended: true }),
      review("gone", { deletedAt: iso(28, 10) }),
      normalizeCard({ word: "fresh", def: "新" }, now),
      review("moved", { reviewMode: "listening", listeningState: { state: STATE.REVIEW, due: iso(27) } }),
    ];
    const queue = resumableQueue({ words: ["due", "later", "soon", "paused", "gone", "fresh", "moved", "missing"] }, cards, "reading", now);
    expect(queue.map((c) => c.word)).toEqual(["due", "soon", "fresh"]);
  });
});

describe("vocabStore · 撤销 / 暂停 / 编辑释义", () => {
  beforeEach(() => localStorage.clear());
  const at = new Date(2026, 8, 28, 12, 0, 0);

  test("撤销评分：调度状态、今日额度、首次引入时间和复习日志都退回评分前", () => {
    saveWord({ word: "Cell", def: "细胞", sentence: "A cell divides.", source: "reading" }, at);
    const before = getCard("cell");
    const graded = gradeCard("cell", RATING.GOOD, at, undefined, 4000, "reading");
    expect(graded.state).toBe(STATE.LEARNING);
    expect(getCard("cell").introducedAt).toBe(at.toISOString());
    expect(localLogCount()).toBe(1);

    const restored = undoGrade("cell", "reading", null, new Date(at.getTime() + 5000));
    expect(restored.state).toBe(STATE.NEW);
    const after = getCard("cell");
    expect(after).toMatchObject({ state: before.state, reps: 0, lapses: 0, introducedAt: null, lastReview: null, reviewStartedDates: [] });
    expect(after.stability).toBe(before.stability);
    expect(new Date(after.readingUpdatedAt).getTime()).toBeGreaterThan(at.getTime());
    expect(localLogCount()).toBe(0);
    // 再撤销一次：栈已空
    expect(undoGrade("cell", "reading")).toBeNull();
  });

  test("只退回评分动过的字段，评分后的别的改动保留；栈顶对不上就拒绝", () => {
    saveWord({ word: "cell", def: "细胞", sentence: "A cell divides.", source: "reading" }, at);
    saveWord({ word: "wall", def: "墙", sentence: "A wall.", source: "reading" }, at);
    gradeCard("cell", RATING.AGAIN, at, undefined, null, "reading");
    editDefinition("cell", "细胞（生物学）", at);
    gradeCard("wall", RATING.GOOD, at, undefined, null, "reading");
    expect(undoGrade("cell", "reading")).toBeNull(); // 栈顶是 wall
    expect(undoGrade("wall", "listening")).toBeNull(); // 模式不符
    expect(undoGrade("wall", "reading")).not.toBeNull();
    const restored = undoGrade("cell", "reading");
    expect(restored.state).toBe(STATE.NEW);
    expect(getCard("cell").def).toBe("细胞（生物学）");
    expect(getCard("cell").definitionLocked).toBe(true);
  });

  test("听力评分的撤销只动听力进度", () => {
    saveWord({ word: "habitat", def: "栖息地", source: "reading" }, at);
    const before = getCard("habitat");
    gradeCard("habitat", RATING.GOOD, at, undefined, null, "listening");
    expect(getCard("habitat").listeningState.state).not.toBe(STATE.NEW);
    undoGrade("habitat", "listening");
    const after = getCard("habitat");
    expect(after.listeningState.state).toBe(STATE.NEW);
    expect(after.state).toBe(before.state);
  });

  test("暂停 / 恢复复习", () => {
    saveWord({ word: "cell", def: "细胞", source: "reading" }, at);
    expect(setSuspended("cell", true).suspended).toBe(true);
    expect(loadBook()[0].suspended).toBe(true);
    expect(setSuspended("cell", false).suspended).toBe(false);
    expect(setSuspended("nope", true)).toBeNull();
  });

  test("编辑释义：手写的成为锁定的主释义，原释义留作备份；空/超长报错", () => {
    saveWord({ word: "cell", def: "n. 细胞, 牢房", source: "reading" }, at);
    const edited = editDefinition("cell", "细胞（生物）", at);
    expect(edited).toMatchObject({ def: "细胞（生物）", definitionLocked: true, defFull: "n. 细胞, 牢房" });
    expect(() => editDefinition("cell", "  ")).toThrow("释义不能为空");
    expect(() => editDefinition("cell", "长".repeat(301))).toThrow();
    expect(editDefinition("nope", "x")).toBeNull();
  });
});
