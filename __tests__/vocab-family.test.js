import {
  addedHistory, bookStats, buildQueue, clusterFamilies, familyPosition, mergeCards, normalizeCard, normalizeFamily, FAMILY_AHEAD_DAYS,
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

test("addedHistory：按本地日期分天、新的在前，窗口外和已移除的不算", () => {
  const at = (d, h = 10) => new Date(2026, 9, d, h).toISOString();
  const cards = [
    { word: "a", createdAt: at(15) }, { word: "b", createdAt: at(15, 0), reviewMode: "both" },
    { word: "c", createdAt: at(13), reviewMode: "listening" }, { word: "d", createdAt: at(1) },
    { word: "e", createdAt: at(14), deletedAt: at(15) },
  ].map((c) => normalizeCard(c, now));
  const h = addedHistory(cards, now, 7);
  expect(h.rows).toEqual([
    { day: "2026-10-15", total: 2, reading: 2, listening: 1 },
    { day: "2026-10-13", total: 1, reading: 0, listening: 1 },
  ]);
  expect(h.total).toBe(3);
  expect(addedHistory(cards, now).activeDays).toBe(3);
});

test("从存档继续：存档之后才成组的词，续上时补齐组员并排到一起", () => {
  const cards = [
    review("a1", -day), fresh("machining", { family: "machinery" }), review("b1", -day),
    review("machine", -day, { family: "machinery" }),
    review("machinist", 1.5 * day, { family: "machinery" }),
    fresh("machinery", { family: "machinery" }),
    review("far", 5 * day, { family: "machinery" }),
  ];
  // 开场时这些词还没成组：存档里只有 a1、machining、b1、machine，顺序是打散的
  const q = words(resumableQueue({ words: ["a1", "machining", "b1", "machine"] }, cards, "reading", now));
  expect(q).toEqual(["a1", "machinery", "machining", "machine", "machinist", "b1"]);
});

test("旧收藏补组：按笔记里的词形表补，只补从没进过组的词", () => {
  const { familyBackfillPlan } = require("../lib/vocab/familyBackfill");
  const table = "[词形]\nmachinery｜n.｜机器｜原词｜x\nmachine｜n.｜机器｜｜x\nmachining｜n.｜机械加工｜｜x\nmachinist｜n.｜机械师｜｜x\n[/词形]";
  const notes = [
    { id: "n1", quote: "machinery", createdAt: iso(now.getTime() - 2 * day), turns: [{ q: "列出所有词形", a: `词形如下\n${table}` }] },
    { id: "n2", quote: "analysis", createdAt: iso(now.getTime() - day), turns: [{ q: "x", a: "[词形]\nanalysis｜n.｜分析｜｜x\nanalyze｜v.｜分析｜｜x\n[/词形]" }] },
    { id: "n3", quote: "gone", deletedAt: iso(now), turns: [{ a: "[词形]\ngone｜v.｜去｜｜x\ngo｜v.｜去｜｜x\n[/词形]" }] },
  ];
  const cards = [
    fresh("machinery"), fresh("machining"),
    fresh("machine", { family: "", familyUpdatedAt: iso(now) }), // 用户移出过组
    fresh("analysis"), // 表里只收了一个，不成组
    fresh("gone"), fresh("go"),
  ];
  expect(familyBackfillPlan(notes, cards)).toEqual([{ family: "machinery", words: ["machinery", "machining"] }]);
  // 已经成组的不再动
  const grouped = cards.map((c) => (["machinery", "machining"].includes(c.word) ? { ...c, family: "machinery", familyUpdatedAt: iso(now) } : c));
  expect(familyBackfillPlan(notes, grouped)).toEqual([]);
});

test("额度里一组只算一个词：新词额度、复习额度都按组计", () => {
  const { familyRunAt, queueUnits, introducedToday } = require("../lib/vocab/book");
  // 新词额度 2：alpha 一个 + machinery 组（3 个词）一个，omega 进不来
  const cards = [
    fresh("alpha", { createdAt: iso(now.getTime() - 3 * day) }),
    fresh("machinery", { family: "machinery" }), fresh("machine", { family: "machinery" }), fresh("machinist", { family: "machinery" }),
    fresh("beta"),
  ];
  const q = words(buildQueue(cards, now, { newPerDay: 2, maxReviews: 0 }, Math.random, "reading"));
  expect(q).not.toContain("beta");
  const withBeta = words(buildQueue(cards, now, { newPerDay: 3, maxReviews: 0 }, Math.random, "reading"));
  expect(withBeta).toContain("beta");
  // 今天已放出的按组算
  const intro = cards.map((c) => (c.word.startsWith("mach") ? { ...c, introducedAt: iso(now) } : c));
  expect(introducedToday(intro, now)).toBe(1);
  // 复习额度 2：组里三个到期词 + 一个单词，全进得来
  const due = [
    review("m1", -day, { family: "machinery" }), review("m2", -day, { family: "machinery" }), review("m3", -day, { family: "machinery" }),
    review("solo", -day), review("late", -day + 1),
  ];
  const dq = buildQueue(due, now, { newPerDay: 0, maxReviews: 2 }, Math.random, "reading");
  expect(words(dq).filter((w) => w.startsWith("m"))).toHaveLength(3);
  expect(dq).toHaveLength(4);
  // 队列里连着的同组卡算一张
  expect(familyRunAt(dq, dq.findIndex((c) => c.family)).length).toBe(3);
  expect(queueUnits(dq)).toBe(2);
});

test("回插的卡落在一组同组词中间时挪到这组后面，组不会被拆开", () => {
  const { reinsertAfterGap } = require("../lib/vocab/reinsert");
  const { familyRunAt } = require("../lib/vocab/book");
  const solo = (w) => ({ word: w, reviewMode: "reading" });
  const fam8 = ["demonstrated", "demonstrate", "demonstrates", "demonstrating"].map((w) => ({ word: w, family: "demonstrated", reviewMode: "reading" }));
  // pos=0，回插点 = 0 + 1 + 3 = 3，正好在组中间
  const queue = [solo("a"), solo("b"), fam8[0], fam8[1], fam8[2], fam8[3], solo("c")];
  const back = { word: "lost", reviewMode: "reading", due: new Date(Date.now() + 60000).toISOString() };
  const next = reinsertAfterGap(queue, 0, back, 1, { gap: 2 });
  expect(next.map((c) => c.word)).toEqual(["a", "b", "demonstrated", "demonstrate", "demonstrates", "demonstrating", "lost", "c"]);
  expect(familyRunAt(next, 2)).toHaveLength(4);
  // 回插的就是同组词：可以接在组里
  const member = { ...fam8[1], due: back.due };
  const q2 = reinsertAfterGap([solo("a"), solo("b"), solo("x"), fam8[2], fam8[3], solo("c")], 0, member, 1, { gap: 3 });
  expect(q2.map((c) => c.word)).toEqual(["a", "b", "x", "demonstrates", "demonstrate", "demonstrating", "c"]);
});
