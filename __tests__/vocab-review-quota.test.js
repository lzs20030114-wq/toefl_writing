import {
  bookStats, buildQueue, localDayKey, mergeCards, normalizeCard, recordReviewStarted, reviewQuota,
} from "../lib/vocab/book";
import { reinsertAfterGap } from "../lib/vocab/reinsert";
import { STATE } from "../lib/vocab/srs";

const now = new Date(2026, 8, 28, 12);
const yesterday = new Date(2026, 8, 27, 12).toISOString();
const due = new Date(2026, 8, 27, 13).toISOString();
const old = (word, mode = "reading") => normalizeCard({
  word, reviewMode: mode, state: STATE.REVIEW, due, introducedAt: yesterday,
  listeningState: mode === "listening" ? { state: STATE.REVIEW, due, introducedAt: yesterday } : null,
}, now);

test("阅读和听力共用到期词额度；同词重入不重复占位", () => {
  const cards = [old("r1"), old("r2"), old("l1", "listening")];
  const limits = { newPerDay: 0, maxReviews: 2 };
  const reading = buildQueue(cards, now, limits, () => 0.5, "reading");
  const listening = buildQueue(cards, now, limits, () => 0.5, "listening");
  expect(reading.length + listening.length).toBe(2);
  expect(bookStats(cards, now, limits).deferredReview).toBe(1);
  const marked = recordReviewStarted(cards[0], "reading", now);
  expect(marked.reviewStartedDates).toEqual([localDayKey(now)]);
  expect(reviewQuota([marked, ...cards.slice(1)], now, limits).remaining).toBe(1);
  expect(buildQueue([marked, ...cards.slice(1)], now, limits, () => 0.5, "reading")).toContainEqual(expect.objectContaining({ word: "r1" }));
  expect(recordReviewStarted(marked, "listening", now).reviewStartedDates).toEqual([localDayKey(now)]);
});

test("当日新词学习步免占额度；删卡仍占当天额度；跨设备合并日期取并集", () => {
  const fresh = normalizeCard({ word: "fresh", introducedAt: now.toISOString(), state: STATE.LEARNING, due }, now);
  expect(recordReviewStarted(fresh, "reading", now).reviewStartedDates).toEqual([]);
  const older = old("older");
  const marked = recordReviewStarted(older, "reading", now);
  const tombstone = { ...marked, deletedAt: now.toISOString() };
  expect(reviewQuota([tombstone], now, { maxReviews: 1 }).remaining).toBe(0);
  const earlier = localDayKey(new Date(2026, 8, 26, 12));
  const [merged] = mergeCards([{ ...marked, reviewStartedDates: [earlier] }], [tombstone]);
  expect(merged.reviewStartedDates).toEqual([earlier, localDayKey(now)]);
});

test("午夜按本地日期重置；阅读新引入、听力已学仍免当天额度", () => {
  const before = new Date(2026, 8, 28, 23, 59);
  const after = new Date(2026, 8, 29, 0, 1);
  const card = recordReviewStarted(old("midnight"), "reading", before);
  expect(reviewQuota([card], before, { maxReviews: 1 }).remaining).toBe(0);
  expect(reviewQuota([card], after, { maxReviews: 1 }).remaining).toBe(1);
  const mixed = { ...old("mixed", "listening"), introducedAt: now.toISOString() };
  expect(recordReviewStarted(mixed, "listening", now).reviewStartedDates).toEqual([]);
});

test("短队列不提前回插，满十张其他卡才可在30分钟学习窗口回插", () => {
  const updated = { word: "again", due: new Date(now.getTime() + 15 * 60000).toISOString() };
  const tenCards = [{ word: "again" }, ...Array.from({ length: 9 }, (_, i) => ({ word: `other${i}` }))];
  expect(reinsertAfterGap(tenCards, 0, updated, 1, { now: now.getTime() })).toBe(tenCards);
  const elevenCards = [...tenCards, { word: "last" }];
  const inserted = reinsertAfterGap(elevenCards, 0, updated, 1, { now: now.getTime() });
  expect(inserted[11]).toBe(updated);
  expect(reinsertAfterGap(elevenCards, 0, { ...updated, due: new Date(now.getTime() + 31 * 60000).toISOString() }, 1, { now: now.getTime() })).toBe(elevenCards);
});
