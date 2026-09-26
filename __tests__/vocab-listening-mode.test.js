import { normalizeCard, reviewCard, mergeCards, buildQueue, bookStats } from "../lib/vocab/book";
import { saveWord, setReviewMode, gradeCard, getCard, resetCard } from "../lib/vocab/vocabStore";
import { appendReviewLog } from "../lib/vocab/reviewLog";
import { STATE } from "../lib/vocab/srs";

jest.mock("../lib/AuthContext", () => ({ getSavedCode: () => null, AUTH_CHANGED_EVENT: "auth" }));

const at = new Date("2026-09-27T08:00:00Z");
const later = new Date("2026-09-27T09:00:00Z");
const ctx = { audioUrl: "/api/audio/a.mp3", start: 2, end: 5, text: "A useful sentence." };

beforeEach(() => localStorage.clear());

test("旧卡默认阅读，音频片段验证并保留", () => {
  const card = normalizeCard({ word: "Useful", state: STATE.REVIEW, reps: 4 });
  expect(card.reviewMode).toBe("reading");
  expect(reviewCard(card).reps).toBe(4);
  expect(normalizeCard({ word: "x", listeningContext: ctx }).listeningContext).toEqual(ctx);
  expect(normalizeCard({ word: "x", listeningContext: { ...ctx, audioUrl: "javascript:bad" } }).listeningContext).toBeNull();
  expect(normalizeCard({ word: "x", listeningContext: { ...ctx, start: null } }).listeningContext).toBeNull();
  expect(normalizeCard({ word: "x", listeningContext: { ...ctx, end: "5" } }).listeningContext).toBeNull();
});

test("切模式保留文字进度，听力评分及重置均独立", () => {
  saveWord({ word: "useful", reviewMode: "reading" }, at);
  gradeCard("useful", 3, at, { fuzz: false }, 100, "reading");
  const reading = getCard("useful");
  setReviewMode("useful", "listening", later);
  const graded = gradeCard("useful", 3, later, { fuzz: false }, 100, "listening");
  expect(graded.reviewMode).toBe("listening");
  expect(graded.state).not.toBe(STATE.NEW);
  expect(getCard("useful").reps).toBe(reading.reps);
  expect(getCard("useful").listeningState.reps).toBe(graded.reps);
  resetCard("useful", later, "listening");
  expect(getCard("useful").listeningState.state).toBe(STATE.NEW);
  expect(getCard("useful").reps).toBe(reading.reps);
  setReviewMode("useful", "reading", later);
  expect(getCard("useful").reps).toBe(reading.reps);
});

test("跨设备合并逐模式择新，语境从有效一方补足", () => {
  const base = normalizeCard({ word: "useful", reviewMode: "listening", listeningContext: ctx, updatedAt: at.toISOString(), readingUpdatedAt: at.toISOString(), reps: 5,
    listeningState: { state: STATE.REVIEW, reps: 1, updatedAt: later.toISOString() } });
  const remote = normalizeCard({ word: "useful", updatedAt: later.toISOString(), readingUpdatedAt: later.toISOString(), reps: 9,
    listeningState: { state: STATE.REVIEW, reps: 0, updatedAt: at.toISOString() } });
  const [merged] = mergeCards([base], [remote]);
  expect(merged.reps).toBe(9);
  expect(merged.listeningState.reps).toBe(1);
  expect(merged.listeningContext).toEqual(ctx);
});

test("按模式排队，阅读积压不会饿死听力，共用每日新词额度", () => {
  const cards = Array.from({ length: 22 }, (_, i) => normalizeCard({ word: `word${i}`, reviewMode: i < 20 ? "reading" : "listening", createdAt: new Date(at.getTime() + i * 1000).toISOString() }));
  expect(buildQueue(cards, at, { newPerDay: 20 }, () => 0.5, "reading")).toHaveLength(20);
  expect(buildQueue(cards, at, { newPerDay: 20 }, () => 0.5, "listening")).toHaveLength(2);
  expect(bookStats(cards, at, { newPerDay: 20 }, "listening").newToday).toBe(2);
  const introduced = { ...cards[20], listeningState: { ...cards[20].listeningState, introducedAt: at.toISOString() } };
  const after = [...cards.slice(0, 20), introduced, cards[21]];
  expect(buildQueue(after, at, { newPerDay: 1 }, () => 0.5, "reading")).toHaveLength(0);
  expect(bookStats(after, at, { newPerDay: 1 }, "reading").newToday).toBe(0);
});

test("复习日志写入模式，旧模式默认为阅读", () => {
  const before = normalizeCard({ word: "useful" });
  appendReviewLog(before, { ...before, scheduledDays: 1 }, 3, at, 250, "listening");
  appendReviewLog(before, before, 3, at);
  const logs = JSON.parse(localStorage.getItem("toefl-vocab-logs")).logs;
  expect(logs.map((log) => log.mode)).toEqual(["listening", "reading"]);
});
