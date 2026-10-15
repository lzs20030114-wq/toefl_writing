import {
  bookStats, buildQueue, clusterFamilies, familyPosition, mergeCards, normalizeCard, normalizeFamily, FAMILY_AHEAD_DAYS,
} from "../lib/vocab/book";
import { resumableQueue } from "../lib/vocab/reviewSave";
import { familyHead, formVocabEntry } from "../lib/notes/wordForms";
import { STATE } from "../lib/vocab/srs";

const now = new Date(2026, 9, 15, 12);
const iso = (d) => new Date(d).toISOString();
const day = 86400000;
const yesterday = iso(now.getTime() - day);
const review = (word, dueMs, extra = {}) => normalizeCard({
  word, state: STATE.REVIEW, due: iso(now.getTime() + dueMs), introducedAt: yesterday, lastReview: iso(now.getTime() - 5 * day),
  scheduledDays: 5, stability: 5, reps: 3, ...extra,
}, now);
const fresh = (word, extra = {}) => normalizeCard({ word, createdAt: iso(now.getTime() - day), ...extra }, now);
const words = (queue) => queue.map((c) => c.word);

test("组名只认英文词/短语，统一小写", () => {
  expect(normalizeFamily(" Machinery ")).toBe("machinery");
  expect(normalizeFamily("take  off")).toBe("take off");
  expect(normalizeFamily("机器")).toBe("");
  expect(normalizeFamily(null)).toBe("");
  expect(normalizeCard({ word: "machine", family: "Machinery" }).family).toBe("machinery");
});

test("组字段按自己的时钟合并：另一端后来评了分，也不会把组冲掉", () => {
  const grouped = { ...review("machine", 0), family: "machinery", familyUpdatedAt: iso(now.getTime() - 60000), updatedAt: iso(now.getTime() - 60000) };
  const graded = { ...review("machine", 3 * day), family: "", familyUpdatedAt: null, updatedAt: iso(now), reps: 4 };
  const [merged] = mergeCards([grouped], [graded]);
  expect(merged.family).toBe("machinery");
  expect(merged.reps).toBe(4);
  // 后来移出组（空组名、更新的时钟）能同步过去
  const left = { ...graded, family: "", familyUpdatedAt: iso(now) };
  expect(mergeCards([grouped], [left])[0].family).toBe("");
});

test("同组到期词在队列里连着出现，组名那个词打头", () => {
  const cards = [
    review("a1", -day), review("machine", -day, { family: "machinery" }), review("b1", -day),
    review("c1", -day), review("machinery", -day, { family: "machinery" }), review("d1", -day),
  ];
  const q = words(buildQueue(cards, now, { newPerDay: 0, maxReviews: 0 }, Math.random, "reading"));
  const i = q.indexOf("machinery");
  expect(q[i + 1]).toBe("machine");
});

test("组里有词今天复习：两天内到期的组员提前带进来，更远的、今天已复习过的、暂停的不带", () => {
  const cards = [
    review("machine", -day, { family: "machinery" }),
    review("machinist", 1.5 * day, { family: "machinery" }),
    review("machined", 5 * day, { family: "machinery" }),
    review("machining", 1 * day, { family: "machinery", lastReview: iso(now.getTime() - 3600000) }),
    review("machines", 1 * day, { family: "machinery", suspended: true }),
    review("lonely", 1 * day),
  ];
  const q = words(buildQueue(cards, now, { newPerDay: 0, maxReviews: 0 }, Math.random, "reading"));
  expect(q.sort()).toEqual(["machine", "machinist"]);
  expect(FAMILY_AHEAD_DAYS).toBe(2);
  const stats = bookStats(cards, now, { newPerDay: 0, maxReviews: 0 }, "reading");
  expect(stats.todo).toBe(2);
  expect(stats.todayTotal).toBe(3); // 含今天已复习过的 machining
});

test("没有组员今天到期时，不会因为组而提前复习", () => {
  const cards = [review("machine", 1 * day, { family: "machinery" }), review("machinist", 1 * day, { family: "machinery" })];
  expect(buildQueue(cards, now, { newPerDay: 0, maxReviews: 0 }, Math.random, "reading")).toEqual([]);
});

test("新词整组放出：组里放进来一个，其余组员不再看每日新词额度", () => {
  const cards = [
    fresh("alpha", { createdAt: iso(now.getTime() - 3 * day) }),
    fresh("machinery", { family: "machinery" }), fresh("machine", { family: "machinery" }), fresh("machinist", { family: "machinery" }),
    fresh("omega"),
  ];
  const q = words(buildQueue(cards, now, { newPerDay: 2, maxReviews: 0 }, Math.random, "reading"));
  expect(q).toEqual(expect.arrayContaining(["alpha", "machinery", "machine", "machinist"]));
  expect(q).not.toContain("omega");
  const i = q.indexOf("machinery");
  expect(q.slice(i, i + 3).sort()).toEqual(["machine", "machinery", "machinist"]);
});

test("额度满了时整组一起等，不会拆开放", () => {
  const cards = [fresh("alpha", { createdAt: iso(now.getTime() - 3 * day) }), fresh("machinery", { family: "machinery" }), fresh("machine", { family: "machinery" })];
  expect(words(buildQueue(cards, now, { newPerDay: 1, maxReviews: 0 }, Math.random, "reading"))).toEqual(["alpha"]);
});

test("clusterFamilies / familyPosition：只有一个组员在队里时不动、不标", () => {
  const q = [{ word: "x" }, { word: "machine", family: "machinery", reviewMode: "reading" }, { word: "y" }];
  expect(clusterFamilies(q)).toEqual(q);
  expect(familyPosition(q, q[1])).toBeNull();
  const q2 = [...q, { word: "machinist", family: "machinery", reviewMode: "reading" }];
  expect(words(clusterFamilies(q2))).toEqual(["x", "machine", "machinist", "y"]);
  expect(familyPosition(q2, q2[3])).toEqual({ family: "machinery", index: 2, total: 2 });
});

test("从存档继续：提前带进来的组员保留，今天已复习过的丢掉", () => {
  const cards = [
    review("machine", -day, { family: "machinery" }),
    review("machinist", 1.5 * day, { family: "machinery" }),
    review("machined", 1 * day, { family: "machinery", lastReview: iso(now.getTime() - 3600000) }),
    review("plain", 1 * day),
  ];
  const q = resumableQueue({ words: ["machine", "machinist", "machined", "plain"] }, cards, "reading", now);
  expect(words(q)).toEqual(["machine", "machinist"]);
});

test("词形表组名：选中的词在表里就用它，否则用第一行；收藏 entry 带组名", () => {
  const forms = [{ word: "Machinery", pos: "n.", zh: "机器" }, { word: "machine", pos: "n.", zh: "机器" }];
  expect(familyHead(forms, "machine")).toBe("machine");
  expect(familyHead(forms, "the machinery")).toBe("machinery");
  expect(formVocabEntry(forms[1], { family: "machinery" }).family).toBe("machinery");
  expect(formVocabEntry(forms[1]).family).toBe("");
});
