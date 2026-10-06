/**
 * 错题池（lib/mistakes）：从练习记录派生 → 去重合并 → 收藏 / 移出 / 练错题回写。
 * 方案见 docs/mistake-notebook-redesign-2026-10-06.md。
 */
import { extractMistakeEntries, expandMockSession, sentenceAround } from "../lib/mistakes/extract";
import {
  activeCards,
  emptyPool,
  loadPool,
  mergeEntries,
  mergePools,
  recordDrill,
  removeCards,
  setStarred,
  summarizePool,
  syncPoolFromSessions,
} from "../lib/mistakes/pool";

const BS_SESSION = {
  type: "bs",
  date: "2026-10-01T10:00:00.000Z",
  correct: 1,
  total: 3,
  details: [
    { qid: "ets_s30_q1", prompt: "What did she say?", userAnswer: "she say what", correctAnswer: "She said that she was tired.", isCorrect: false, grammar_points: ["past_tense"] },
    { qid: "ets_s30_q2", prompt: "Where is it?", userAnswer: "ok", correctAnswer: "ok", isCorrect: true, grammar_points: [] },
    { prompt: "Legacy no qid", userAnswer: "x", correctAnswer: "y", isCorrect: false },
  ],
};

const CTW_SESSION = {
  type: "reading",
  date: "2026-10-02T10:00:00.000Z",
  details: {
    subtype: "ctw",
    itemId: "ctw_1",
    passage: "Plants need water to grow.",
    blanks: [
      { position: 3, original_word: "water", displayed_fragment: "wa" },
      { position: 5, original_word: "grow", displayed_fragment: "gr" },
    ],
    results: [
      { blank: { position: 3, original_word: "water", displayed_fragment: "wa" }, userAnswer: "ter", fullWord: "water", isCorrect: true },
      { blank: { position: 5, original_word: "grow", displayed_fragment: "gr" }, userAnswer: "aw", fullWord: "graw", isCorrect: false },
    ],
  },
};

const RDL_SESSION = {
  type: "reading",
  date: "2026-10-03T10:00:00.000Z",
  details: {
    subtype: "rdl",
    itemId: "rdl_9",
    topic: "campus",
    passage: "Notice text",
    questions: [
      { stem: "Q1?", options: { A: "a", B: "b", C: "c", D: "d" }, correct_answer: "A" },
      { stem: "Q2?", options: { A: "a", B: "b", C: "c", D: "d" }, correct_answer: "C" },
    ],
    results: [
      { selected: "A", correct: "A", isCorrect: true },
      { selected: "B", correct: "C", isCorrect: false },
    ],
  },
};

const LCR_SESSION = {
  type: "listening",
  date: "2026-10-04T10:00:00.000Z",
  details: {
    subtype: "lcr",
    itemIds: ["lcr_a", "lcr_b"],
    items: [
      { id: "lcr_a", speaker: "Hi?", options: { A: "1", B: "2", C: "3", D: "4" }, answer: "A", audio_url: "x.mp3" },
      { id: "lcr_b", speaker: "Bye?", options: { A: "1", B: "2", C: "3", D: "4" }, answer: "B" },
    ],
    results: [
      { itemId: "lcr_a", selected: "C", correct: "A", isCorrect: false },
      { itemId: "lcr_b", selected: "B", correct: "B", isCorrect: true },
    ],
  },
};

const LA_SESSION = {
  type: "listening",
  date: "2026-10-04T11:00:00.000Z",
  details: {
    subtype: "la",
    itemIds: ["la_1"],
    transcript: "Attention students.",
    questions: [
      { stem: "What?", options: { A: "1", B: "2", C: "3", D: "4" }, answer: "D" },
      { stem: "Why?", options: { A: "1", B: "2", C: "3", D: "4" }, answer: "A" },
    ],
    results: [
      { qIndex: 0, selected: "A", correct: "D", isCorrect: false },
      { qIndex: 1, selected: "A", correct: "A", isCorrect: true },
    ],
  },
};

const READING_MOCK = {
  type: "reading",
  mode: "mock",
  date: "2026-10-05T10:00:00.000Z",
  details: {
    subtype: "mock",
    m1: {
      tasks: [
        {
          taskType: "ctw", itemId: "ctw_m", passage: "Cats like fish.",
          blanks: [{ position: 1, original_word: "like", displayed_fragment: "li" }, { position: 2, original_word: "fish", displayed_fragment: "fi" }],
          results: [{ userAnswer: "lilk", isCorrect: false }, { userAnswer: "fish", isCorrect: true }],
        },
        {
          taskType: "rdl", itemId: "rdl_m", text: "Menu", timedOut: true,
          questions: [{ stem: "A?", options: { A: "1", B: "2" }, correct_answer: "A" }, { stem: "B?", options: { A: "1", B: "2" }, correct_answer: "B" }],
          results: [{ selected: "B", correct: "A", isCorrect: false }, { selected: null, correct: "B", isCorrect: false }],
        },
      ],
    },
    m2: { tasks: [{ taskType: "ap", unreached: true, results: [] }] },
  },
};

const LISTENING_MOCK = {
  type: "listening",
  mode: "mock",
  date: "2026-10-05T12:00:00.000Z",
  details: {
    subtype: "mock",
    m1: {
      tasks: [
        { taskType: "lcr", itemId: "lcr_m", speaker: "Hey", options: { A: "1", B: "2" }, answer: "A", results: [{ selected: "B", correct: "A", isCorrect: false }] },
        { taskType: "lc", itemId: "lc_m", conversation: [{ speaker: "M", text: "hi" }], questions: [{ stem: "?", options: { A: "1", B: "2" }, answer: "B" }], results: [{ selected: "A", correct: "B", isCorrect: false }] },
      ],
    },
  },
};

const WRITING_MOCK = {
  type: "mock",
  date: "2026-10-05T13:00:00.000Z",
  details: { tasks: [{ taskId: "bs", meta: { details: [{ qid: "ets_s31_q4", prompt: "P", userAnswer: "u", correctAnswer: "c", isCorrect: false }] } }] },
};

beforeEach(() => {
  localStorage.clear();
});

describe("extractMistakeEntries", () => {
  test("拼句：只收答错的题，key 用 qid，老记录无 qid 时用题面哈希兜底", () => {
    const entries = extractMistakeEntries([BS_SESSION]);
    expect(entries.map((e) => e.key)).toEqual(["bs:ets_s30_q1", expect.stringMatching(/^bs:h:/)]);
    expect(entries[0].brief).toMatchObject({ qid: "ets_s30_q1", correctAnswer: "She said that she was tired.", grammar_points: ["past_tense"] });
    expect(entries[0].source.sid).toBe("bs@2026-10-01T10:00:00.000Z");
  });

  test("填词一空一条（key 带 position），阅读选择一问一条，篇级快照带全文与题目", () => {
    const ctw = extractMistakeEntries([CTW_SESSION]);
    expect(ctw).toHaveLength(1);
    expect(ctw[0].key).toBe("ctw:ctw_1#b5");
    expect(ctw[0].item.blanks).toHaveLength(2);
    expect(ctw[0].brief.userAnswer).toBe("graw");

    const rdl = extractMistakeEntries([RDL_SESSION]);
    expect(rdl).toHaveLength(1);
    expect(rdl[0].key).toBe("rdl:rdl_9#q1");
    expect(rdl[0].index).toBe(1);
    expect(rdl[0].item.questions).toHaveLength(2);
  });

  test("听力应答一题一条（key 跟着题走，跨练习去重），听力选择一问一条", () => {
    const lcr = extractMistakeEntries([LCR_SESSION]);
    expect(lcr.map((e) => e.key)).toEqual(["lcr:lcr_a"]);
    expect(lcr[0].item).toMatchObject({ speaker: "Hi?", answer: "A", audio_url: "x.mp3" });
    const la = extractMistakeEntries([LA_SESSION]);
    expect(la.map((e) => e.key)).toEqual(["la:la_1#q0"]);
    expect(la[0].item.transcript).toBe("Attention students.");
  });

  test("阅读 / 听力模考的逐题结果也收进来；超时没作答的、没看到的不算错", () => {
    const r = extractMistakeEntries([READING_MOCK]);
    expect(r.map((e) => e.key).sort()).toEqual(["ctw:ctw_m#b1", "rdl:rdl_m#q0"]);
    expect(r.every((e) => e.source.mock)).toBe(true);
    const ctw = r.find((e) => e.subtype === "ctw");
    expect(ctw.brief.userAnswer).toBe("lilk");

    const l = extractMistakeEntries([LISTENING_MOCK]);
    expect(l.map((e) => e.key).sort()).toEqual(["lc:lc_m#q0", "lcr:lcr_m"]);

    const w = extractMistakeEntries([WRITING_MOCK]);
    expect(w.map((e) => e.key)).toEqual(["bs:ets_s31_q4"]);
  });

  test("expandMockSession 把模考 CTW 的「碎片+输入」拆回只含输入的 userAnswer", () => {
    const [ps] = expandMockSession(READING_MOCK);
    expect(ps.details.results[0]).toMatchObject({ userAnswer: "lk", fullWord: "lilk", isCorrect: false });
  });

  test("填词错题卡的语境只给空所在的那一句（position 是全文词序号）", () => {
    const p = "Plants need water. They grow (fast) in spring! Then they rest.";
    expect(sentenceAround(p, { position: 4, original_word: "grow" })).toBe("They grow (fast) in spring!");
    expect(sentenceAround(p, { original_word: "rest" })).toBe("Then they rest.");
    expect(extractMistakeEntries([CTW_SESSION])[0].brief.sentenceContext).toBe("Plants need water to grow.");
  });

  test("形状异常的记录不拖垮整体", () => {
    const entries = extractMistakeEntries([null, { type: "reading" }, { type: "listening", details: { results: "x" } }, BS_SESSION]);
    expect(entries.length).toBe(2);
  });
});

describe("mergeEntries", () => {
  test("同一次练习重复派生只算一次；新的一次练习里又错 → 错次 +1", () => {
    const e1 = extractMistakeEntries([BS_SESSION]);
    let { pool, changed } = mergeEntries(emptyPool(), e1);
    expect(changed).toBe(true);
    ({ pool, changed } = mergeEntries(pool, e1));
    expect(changed).toBe(false);
    expect(pool.cards["bs:ets_s30_q1"].wrongCount).toBe(1);

    const again = { ...BS_SESSION, date: "2026-10-06T10:00:00.000Z" };
    ({ pool } = mergeEntries(pool, extractMistakeEntries([again])));
    expect(pool.cards["bs:ets_s30_q1"].wrongCount).toBe(2);
    expect(pool.cards["bs:ets_s30_q1"].lastWrongAt).toBe("2026-10-06T10:00:00.000Z");
    expect(pool.cards["bs:ets_s30_q1"].firstWrongAt).toBe("2026-10-01T10:00:00.000Z");
  });

  test("篇级快照按 itemKey 只存一份", () => {
    const twoWrong = { ...RDL_SESSION, details: { ...RDL_SESSION.details, results: [{ selected: "B", correct: "A", isCorrect: false }, { selected: "B", correct: "C", isCorrect: false }] } };
    const { pool } = mergeEntries(emptyPool(), extractMistakeEntries([twoWrong]));
    expect(Object.keys(pool.cards)).toHaveLength(2);
    expect(Object.keys(pool.items)).toEqual(["rdl:rdl_9"]);
  });

  test("移出的题：旧记录再派生不会回来；之后的新练习里再错会回来", () => {
    syncPoolFromSessions([BS_SESSION]);
    removeCards(["bs:ets_s30_q1"]);
    let pool = syncPoolFromSessions([BS_SESSION]);
    expect(pool.cards["bs:ets_s30_q1"].deletedAt).toBeTruthy();
    expect(activeCards(pool).map((c) => c.key)).not.toContain("bs:ets_s30_q1");
    const later = { ...BS_SESSION, date: new Date(Date.now() + 60000).toISOString() };
    pool = syncPoolFromSessions([BS_SESSION, later]);
    expect(pool.cards["bs:ets_s30_q1"].deletedAt).toBeNull();
  });
});

describe("本地池读写", () => {
  test("收藏、练错题回写 lastDrill 与日志；派生不覆盖这些本地状态", () => {
    syncPoolFromSessions([BS_SESSION, LCR_SESSION]);
    setStarred("lcr:lcr_a", true);
    recordDrill([{ key: "lcr:lcr_a", correct: true }, { key: "bs:ets_s30_q1", correct: false }], { total: 2, correct: 1, durationSec: 30, byType: {} });
    const pool = syncPoolFromSessions([BS_SESSION, LCR_SESSION]);
    expect(pool.cards["lcr:lcr_a"].starred).toBe(true);
    expect(pool.cards["lcr:lcr_a"].lastDrill.correct).toBe(true);
    expect(pool.cards["bs:ets_s30_q1"].lastDrill.correct).toBe(false);
    expect(pool.drills).toHaveLength(1);
    const s = summarizePool(pool, new Date("2026-10-06T12:00:00.000Z").getTime());
    expect(s.total).toBe(3);
    expect(s.starred).toBe(1);
    expect(s.neverDrilled).toBe(1);
    expect(s.bySubject).toEqual({ bs: 2, reading: 0, listening: 1 });
  });

  test("按账号分 key；登录后把游客池并进账号池", () => {
    syncPoolFromSessions([BS_SESSION]);
    setStarred("bs:ets_s30_q1", true);
    localStorage.setItem("toefl-user-code", "ABCDEF");
    const pool = loadPool();
    expect(pool.cards["bs:ets_s30_q1"].starred).toBe(true);
    expect(localStorage.getItem("toefl-mistake-pool-v1::guest")).toBeNull();
    expect(localStorage.getItem("toefl-mistake-pool-v1::user:ABCDEF")).toBeTruthy();
  });

  test("mergePools：收藏取或、错次取大", () => {
    const a = mergeEntries(emptyPool(), extractMistakeEntries([BS_SESSION])).pool;
    const b = JSON.parse(JSON.stringify(a));
    b.cards["bs:ets_s30_q1"].starred = true;
    b.cards["bs:ets_s30_q1"].wrongCount = 4;
    const m = mergePools(a, b);
    expect(m.cards["bs:ets_s30_q1"]).toMatchObject({ starred: true, wrongCount: 4 });
  });

  test("localStorage 写满时先精简最老的篇级正文，卡片仍保留", () => {
    syncPoolFromSessions([RDL_SESSION]);
    const realSet = Storage.prototype.setItem;
    let calls = 0;
    const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(function (k, v) {
      calls += 1;
      if (String(k).startsWith("toefl-mistake-pool-v1") && String(v).includes("Notice text")) {
        const err = new Error("QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      }
      return realSet.call(this, k, v);
    });
    const pool = syncPoolFromSessions([RDL_SESSION, LCR_SESSION]);
    spy.mockRestore();
    expect(calls).toBeGreaterThan(1);
    const stored = JSON.parse(localStorage.getItem("toefl-mistake-pool-v1::guest"));
    expect(stored.cards["lcr:lcr_a"]).toBeTruthy();
    expect(stored.items["rdl:rdl_9"].pruned).toBe(true);
    expect(stored.items["rdl:rdl_9"].passage).toBeUndefined();
    expect(pool.cards["rdl:rdl_9#q1"]).toBeTruthy();
  });
});
