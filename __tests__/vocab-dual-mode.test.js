import {
  bookStats, buildQueue, forecastLoad, hasReviewMode, introducedToday, localDayKey, mergeCards,
  normalizeCard, recordReviewStarted, reviewCard, reviewQuota, toggleReviewMode, validCardReviewMode, validReviewMode,
} from "../lib/vocab/book";
import { adoptContextSense, getCard, gradeCard, importWords, loadBook, resetCard, saveWord, setReviewMode, undoGrade, writeBook } from "../lib/vocab/vocabStore";
import { readReviewSave, resumableQueue, writeReviewSave } from "../lib/vocab/reviewSave";
import { meaningWordEntry } from "../lib/vocab/meaningExplorer";
import { buildReviewSummary, pickStats } from "../lib/vocab/reviewSummary";
import { STATE, RATING } from "../lib/vocab/srs";

jest.mock("../lib/AuthContext", () => ({ getSavedCode: () => null, AUTH_CHANGED_EVENT: "auth" }));

const now = new Date(2026, 9, 11, 12);
const yesterday = new Date(2026, 9, 10, 12).toISOString();
const tomorrow = new Date(2026, 9, 12, 12).toISOString();
const at = (seconds) => new Date(now.getTime() + seconds * 1000);
const fresh = (word, mode = "both", seconds = 0) => normalizeCard({ word, reviewMode: mode, createdAt: at(seconds).toISOString() }, now);
const old = (word, mode = "both") => normalizeCard({ word, reviewMode: mode,
  state: STATE.REVIEW, due: yesterday, lastReview: yesterday, introducedAt: yesterday, reps: 4,
  stability: 2, difficulty: 5, scheduledDays: 2,
  listeningState: { state: STATE.REVIEW, due: yesterday, lastReview: yesterday, introducedAt: yesterday, reps: 6,
    stability: 3, difficulty: 5, scheduledDays: 3, updatedAt: yesterday } }, now);
const queue = (cards, limits, mode) => buildQueue(cards, now, limits, () => 0.5, mode);

beforeEach(() => { jest.useFakeTimers(); localStorage.clear(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test("收藏归属可以双选，执行模式仍只有两种，投影保留归属", () => {
  expect(validCardReviewMode("both")).toBe("both");
  expect(validReviewMode("both")).toBe("reading");
  expect(validCardReviewMode("unknown")).toBe("reading");
  expect(toggleReviewMode("reading", "reading")).toBe("reading");
  expect(toggleReviewMode("listening", "listening")).toBe("listening");
  expect(toggleReviewMode("reading", "listening")).toBe("both");
  expect(toggleReviewMode("listening", "reading")).toBe("both");
  expect(toggleReviewMode("both", "reading")).toBe("listening");
  expect(toggleReviewMode("both", "listening")).toBe("reading");
  const card = old("bank");
  const projected = reviewCard(card, "listening");
  expect(projected).toMatchObject({ reviewMode: "listening", enrollmentMode: "both", reps: 6 });
  expect(hasReviewMode(projected, "reading")).toBe(true);
  expect(hasReviewMode(projected, "listening")).toBe(true);
  expect(hasReviewMode("both", "both")).toBe(false);
  expect(normalizeCard(projected)).not.toHaveProperty("enrollmentMode");
  expect(fresh("new").listeningState.state).toBe(STATE.NEW);
  expect(normalizeCard({ word: "legacy" }, now).reviewMode).toBe("reading");
});

test("同词进入两轨每轨一次，两套到期状态分别决定是否出现", () => {
  const card = old("bank");
  expect(queue([card, card], { newPerDay: 0, maxReviews: 1 }, "reading")).toHaveLength(1);
  expect(queue([card], { newPerDay: 0, maxReviews: 1 }, "listening")).toHaveLength(1);
  expect(queue([card], { newPerDay: 0, maxReviews: 1 })).toHaveLength(2);
  const laterReading = { ...card, due: tomorrow };
  expect(queue([laterReading], { newPerDay: 0 }, "reading")).toHaveLength(0);
  expect(queue([laterReading], { newPerDay: 0 }, "listening")).toHaveLength(1);
});

test("双轨共享已学词额度；另一轨不再扣一次，quota为零时当天已入的同词仍可复习", () => {
  const card = old("bank"), another = old("other", "reading");
  expect(queue([card, another], { maxReviews: 1, newPerDay: 0 })).toHaveLength(2);
  const marked = recordReviewStarted(card, "reading", now);
  expect(reviewQuota([marked, another], now, { maxReviews: 1 }).remaining).toBe(0);
  expect(queue([marked, another], { maxReviews: 1, newPerDay: 0 }, "listening").map((c) => c.word)).toEqual(["bank"]);
  expect(queue([marked, another], { maxReviews: 1, newPerDay: 0 }, "reading").map((c) => c.word)).toEqual(["bank"]);
});

test("新词额度按独立word跨两轨共用，不饿死听力，另一轨当天已学免受零额度阻挡", () => {
  const cards = [fresh("shared"), fresh("reading", "reading", 1), fresh("heard", "listening", 2)];
  const limits = { newPerDay: 2, maxReviews: 1 };
  const planned = queue(cards, limits);
  expect(new Set(planned.map((card) => card.word)).size).toBe(2);
  expect(planned.filter((card) => card.word === "shared")).toHaveLength(2);
  const completedReading = { ...cards[0], state: STATE.REVIEW, introducedAt: now.toISOString(), lastReview: now.toISOString(), due: tomorrow };
  expect(introducedToday([completedReading], now)).toBe(1);
  expect(queue([completedReading], { newPerDay: 0 }, "listening").map((c) => c.word)).toEqual(["shared"]);
  const backlog = [...Array.from({ length: 8 }, (_, i) => fresh(`r${i}`, "reading", i)), fresh("l", "listening", 10)];
  expect(queue(backlog, { newPerDay: 2 }, "listening").map((c) => c.word)).toEqual(["l"]);
});

test("总收藏唯一，任务按word和轨计数；完成阅读后听力待办仍保留", () => {
  const shared = { ...fresh("shared"), state: STATE.REVIEW, lastReview: now.toISOString(), introducedAt: now.toISOString(), due: tomorrow };
  expect(bookStats([shared], now, { newPerDay: 0 })).toMatchObject({ total: 1, doneToday: 1, todo: 1, todayTotal: 2, newToday: 1 });
  expect(bookStats([shared], now, { newPerDay: 0 }, "reading")).toMatchObject({ total: 1, doneToday: 1, todo: 0 });
  expect(bookStats([shared], now, { newPerDay: 0 }, "listening")).toMatchObject({ total: 1, doneToday: 0, todo: 1 });
  expect(bookStats([old("known")], now).knowledge).toBeLessThanOrEqual(1);
});

test("全局静态阶段和记忆估计一词一份，分科读取各自状态", () => {
  const mature = { ...old("mature"), scheduledDays: 30, listeningState: { ...old("mature").listeningState, scheduledDays: 30 } };
  const paused = { ...old("paused"), suspended: true };
  const learning = { ...old("learning"), state: STATE.LEARNING, listeningState: { ...old("learning").listeningState, state: STATE.LEARNING } };
  const cards = [mature, paused, learning, fresh("new")];
  expect(bookStats(cards, now)).toMatchObject({ total: 4, mature: 1, learning: 1, suspended: 1, untouched: 1 });
  for (const mode of ["reading", "listening"]) expect(bookStats(cards, now, {}, mode)).toMatchObject({ total: 4, mature: 1, learning: 1, suspended: 1, untouched: 1 });
  const stats = bookStats(cards, now);
  const summary = buildReviewSummary({ first: {}, tally: { good: 0, again: 0 }, lost: [], infoFor: () => null,
    senseFor: () => "", startedAt: now.getTime(), endedAt: at(1).getTime(), startStats: pickStats(stats), statsNow: stats });
  expect(summary.changes.find((change) => change.label === "已记牢")).toMatchObject({ from: 1, to: 1, delta: "±0" });
});

test("预测按两轨任务计负担，而每日新词和已学词限额仍按word分配", () => {
  const { days } = forecastLoad([old("first"), old("carry"), fresh("n1"), fresh("n2"), fresh("n3")], now, { newPerDay: 1, maxReviews: 1 }, 4);
  expect(days.map((day) => day.n)).toEqual([4, 4, 2, 0]);
  expect(days[1].carried).toBe(2);
  const future = { ...old("future"), due: tomorrow, listeningState: { ...old("future").listeningState, due: tomorrow } };
  expect(forecastLoad([future], now, { newPerDay: 0, maxReviews: 1 }, 3).days.map((day) => day.n)).toEqual([0, 2, 0]);
});

test("评分、撤销与重置只更新明确执行轨，默认both评分仍走阅读，日志不出现both", () => {
  saveWord({ word: "bank", def: "n. 银行", reviewMode: "both" }, now);
  gradeCard("bank", RATING.GOOD, now, { fuzz: false }, 20, "reading");
  const reading = getCard("bank");
  gradeCard("bank", RATING.AGAIN, at(1), { fuzz: false }, 30, "listening");
  expect(getCard("bank").reps).toBe(reading.reps);
  expect(getCard("bank").listeningState.reps).toBe(1);
  undoGrade("bank", "listening", null, at(2));
  expect(getCard("bank")).toMatchObject({ reps: reading.reps, reviewMode: "both", listeningState: { reps: 0, state: STATE.NEW } });
  gradeCard("bank", RATING.GOOD, at(3), { fuzz: false }, 30, "listening");
  const listening = getCard("bank").listeningState;
  resetCard("bank", at(4), "reading");
  expect(getCard("bank").listeningState).toEqual(listening);
  expect(getCard("bank").reps).toBe(0);
  gradeCard("bank", RATING.GOOD, at(5), { fuzz: false });
  expect(getCard("bank").reps).toBe(1);
  expect(getCard("bank").listeningState).toEqual(listening);
  const logs = JSON.parse(localStorage.getItem("toefl-vocab-logs::guest")).logs;
  expect(logs.every((log) => ["reading", "listening"].includes(log.mode))).toBe(true);
});

test("切出轨道保留进度和存档，重新开启可恢复；两轨存档独立且每词只恢复一次", () => {
  writeBook([old("bank")]);
  writeReviewSave("guest", "reading", { words: ["bank", "bank"], answered: 10 }, now);
  writeReviewSave("guest", "listening", { words: ["bank"], answered: 20 }, now);
  const before = getCard("bank");
  setReviewMode("bank", "reading", at(1));
  expect(getCard("bank").listeningState).toEqual(before.listeningState);
  expect(resumableQueue(readReviewSave("guest", "listening", now), loadBook(), "listening", now)).toEqual([]);
  expect(readReviewSave("guest", "listening", now).answered).toBe(20);
  setReviewMode("bank", "both", at(2));
  expect(resumableQueue(readReviewSave("guest", "reading", now), loadBook(), "reading", now)).toHaveLength(1);
  expect(resumableQueue(readReviewSave("guest", "listening", now), loadBook(), "listening", now)).toHaveLength(1);
  expect(getCard("bank").reviewMode).toBe("both");
  expect(JSON.parse(localStorage.getItem("toefl-vocab-book::guest")).cards[0].reviewMode).toBe("both");
});

test("保存、语境释义和导入接受both且保留已有两轨进度，开启听力初始化空state", () => {
  writeBook([old("bank")]);
  const before = getCard("bank");
  saveWord({ word: "bank", reviewMode: "both", sentence: "The bank is closed." }, at(1));
  adoptContextSense({ word: "bank", reviewMode: "both" }, "河岸", "We sat on the bank.", at(2));
  const after = getCard("bank");
  expect(after.reps).toBe(before.reps);
  expect(after.listeningState).toEqual(before.listeningState);
  expect(after.reviewMode).toBe("both");
  expect(importWords([{ word: "bank", def: "新义" }, { word: "heard", def: "听到" }], { reviewMode: "both", now }).added).toBe(1);
  expect(getCard("bank").listeningState).toEqual(before.listeningState);
  expect(getCard("heard")).toMatchObject({ reviewMode: "both", listeningState: { state: STATE.NEW } });
  saveWord({ word: "only", reviewMode: "reading" }, now);
  expect(getCard("only").listeningState).toBeNull();
  setReviewMode("only", "both", at(3));
  expect(getCard("only").listeningState.state).toBe(STATE.NEW);
});

test("跨设备归属择新而非取并集，关闭听力不会被旧both重新开启，进度仍逐轨择新", () => {
  const earlier = { ...old("bank"), updatedAt: yesterday, readingUpdatedAt: yesterday };
  const closed = { ...earlier, reviewMode: "reading", updatedAt: now.toISOString() };
  for (const [left, right] of [[earlier, closed], [closed, earlier]]) {
    const [merged] = mergeCards([left], [right]);
    expect(merged.reviewMode).toBe("reading");
    expect(merged.listeningState).toEqual(earlier.listeningState);
  }
});

test("中文找词入库保留双选模式", () => {
  const entry = meaningWordEntry({ word: "hinder", partOfSpeech: "v.", meaning: "妨碍", usage: "用于进展受阻的场景", difference: "强调减慢进展", collocations: ["hinder progress"], example: "Rules hinder progress.", translation: "规则妨碍进展。" }, "妨碍", "both");
  expect(entry.reviewMode).toBe("both");
  expect(normalizeCard(entry, now).listeningState.state).toBe(STATE.NEW);
});
