/**
 * lib/realBankReview.js —— 真题练习记录逐题回顾的纯函数层。
 * 锁：①各题型的 unit（编号 / 对错档位 / 提示文案）从真实 session 形状里读对；
 * ②错题速览（标题 / 条数 / 空态）；③日分组与时间标签；④模考题组摊平。
 */
import {
  adaptMockTask,
  averagePct,
  buildMockTasks,
  buildPreview,
  buildReviewModel,
  dayGroupLabel,
  groupEntriesByDay,
  reviewKind,
  rowTimeLabel,
  stripUnits,
  whenLabel,
  wordDiff,
} from "../lib/realBankReview";

const ctw = {
  type: "reading", correct: 1, total: 2, date: "2026-09-02T10:00:00",
  details: {
    subtype: "ctw", itemId: "real_ctw_1", passage: "x",
    blanks: [{ position: 1, original_word: "dorm", displayed_fragment: "do" }, { position: 4, original_word: "early", displayed_fragment: "ea" }],
    results: [{ isCorrect: true }, { isCorrect: false, userAnswer: "rly" }],
  },
};

const rdl = {
  type: "reading", correct: 1, total: 3, date: "2026-09-02T10:00:00",
  details: {
    subtype: "rdl", itemId: "real_rdl_1",
    questions: [
      { stem: "What is the notice about?", options: { A: "a", B: "b" } },
      { question_type: "insert_text", stem: "There are four locations [■] in the passage that indicate where the following sentence could be added. Prices fell. Where would the sentence best fit? Select a location to add the sentence to the passage.", options: { A: "1", B: "2" } },
      { stem: "Why was it posted?", options: { A: "a", B: "b" } },
    ],
    results: [{ selected: "A", correct: "A", isCorrect: true }, { selected: "B", correct: "A", isCorrect: false }, { selected: "A", correct: "B", isCorrect: false }],
  },
};

const lcr = {
  type: "listening", correct: 0, total: 1, date: "2026-09-03T10:00:00",
  details: {
    subtype: "lcr", itemIds: ["real_lcr_1"], real: true,
    items: [{ id: "real_lcr_1", speaker: "Could you review my essay?", options: { A: "x", C: "Sure." }, answer: "C" }],
    results: [{ selected: "A", correct: "C", isCorrect: false }],
  },
};

const bs = {
  type: "bs", correct: 1, total: 2, date: "2026-09-04T10:00:00",
  details: [
    { qid: "real_bs_1", prompt: "p1", userAnswer: "a b", correctAnswer: "a b", isCorrect: true, grammar_points: ["relative clause"] },
    { qid: "real_bs_2", prompt: "p2", userAnswer: "b a", correctAnswer: "a b", isCorrect: false, grammar_points: ["passive", "tense"] },
  ],
};

const repeat = {
  type: "speaking", date: "2026-09-04T10:00:00",
  details: {
    subtype: "repeat", setId: "real_rep_1", real: true, averageScore: 3.5,
    items: [
      { sentence: "s1", recorded: true, score: { accuracy: 92 } },
      { sentence: "s2", recorded: true, score: { accuracy: 70 } },
      { sentence: "s3", recorded: true, score: { accuracy: 40 } },
      { sentence: "s4", recorded: false },
    ],
  },
};

const interview = {
  type: "speaking", date: "2026-09-04T10:00:00",
  details: {
    subtype: "interview", setId: "real_iv_1", real: true, averageScore: 3.0,
    items: [
      { question: "q1", category: "habits", recorded: true, aiScore: { score: 4.5 } },
      { question: "q2", recorded: true, aiScore: { score: 2.5 } },
      { question: "q3", recorded: false },
      { question: "q4", recorded: true, aiScore: { error: "x" } },
    ],
  },
};

const writing = {
  type: "email", score: 4, date: "2026-09-05T10:00:00",
  details: {
    promptId: "real_em_1", promptData: { id: "real_em_1" }, userText: "Dear Ms. Carter",
    feedback: {
      score: 4,
      annotationSegments: [
        { type: "text", text: "Dear " },
        { type: "mark", level: "red", errorType: "grammar", text: "I has", fix: "I have", note: "n" },
        { type: "text", text: " ok " },
        { type: "mark", level: "orange", text: "very good", fix: "excellent", note: "n" },
        { type: "mark", level: "red", errorType: "spelling", text: "experiance", fix: "experience", note: "n" },
      ],
    },
  },
};

const unscored = {
  type: "email", score: null, date: "2026-09-05T11:00:00",
  details: { promptId: "real_em_2", promptData: { id: "real_em_2" }, userText: "hello", feedback: null, scoringFailed: true },
};

describe("reviewKind", () => {
  test("12 题型 + 写作评分有无 + 模考", () => {
    expect(reviewKind(ctw, "ctw")).toBe("ctw");
    ["rdl", "ap", "lc", "la", "lat", "lcr"].forEach((s) => expect(reviewKind({ details: {} }, s)).toBe("mcq"));
    expect(reviewKind(bs, "bs")).toBe("bs");
    expect(reviewKind(repeat, "repeat")).toBe("repeat");
    expect(reviewKind(interview, "interview")).toBe("interview");
    expect(reviewKind(writing, "email")).toBe("writing");
    expect(reviewKind(unscored, "email")).toBe("unscored");
    expect(reviewKind({ details: { realMock: true } }, "mock-reading")).toBe("mock");
  });
});

describe("buildReviewModel units", () => {
  test("填词：每空一个 unit，答错的提示「你填 · 应为」", () => {
    const m = buildReviewModel(ctw, "ctw");
    expect(m.units.map((u) => u.lv)).toEqual(["ok", "bad"]);
    expect(m.units[0]).toMatchObject({ idx: 0, n: 1, label: "第 1 空", text: "do____", hint: "dorm" });
    expect(m.units[1].hint).toBe("你填 early · 应为 early");
    expect(m.score.label).toBe("1/2");
  });

  test("阅读选择题：插入句题用「插入句：」当文案；答错带你选 / 正确", () => {
    const m = buildReviewModel(rdl, "rdl");
    expect(m.units.map((u) => u.lv)).toEqual(["ok", "bad", "bad"]);
    expect(m.units[0].hint).toBe("A ✓");
    expect(m.units[1].text).toBe("插入句：Prices fell.");
    expect(m.units[1].hint).toBe("你选 B · 正确 A");
  });

  test("听力应答：题干读 details.items[i].speaker", () => {
    const m = buildReviewModel(lcr, "lcr");
    expect(m.units[0]).toMatchObject({ lv: "bad", text: "Could you review my essay?", hint: "你选 A · 正确 C" });
  });

  test("造句：文案是正确答案，提示是语法点", () => {
    const m = buildReviewModel(bs, "bs");
    expect(m.units.map((u) => u.lv)).toEqual(["ok", "bad"]);
    expect(m.units[1]).toMatchObject({ text: "a b", hint: "passive · tense" });
  });

  test("口语跟读：≥80 ok / ≥60 mid / 其余 bad / 没录 none", () => {
    const m = buildReviewModel(repeat, "repeat");
    expect(m.units.map((u) => u.lv)).toEqual(["ok", "mid", "bad", "none"]);
    expect(m.units[0].hint).toBe("92%");
    expect(m.units[3].hint).toBe("未录制");
    expect(m.score.label).toBe("3.5/5");
  });

  test("口语访谈：≥4 ok / ≥3 mid / 其余 bad；跳过与评分出错都是 none", () => {
    const m = buildReviewModel(interview, "interview");
    expect(m.units.map((u) => u.lv)).toEqual(["ok", "bad", "none", "none"]);
    expect(m.units.map((u) => u.n)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(m.units[2].hint).toBe("已跳过");
    expect(m.units[3].hint).toBe("未评分");
  });

  test("写作：只取 mark 段，idx 是 annotationSegments 的下标（定位 mark-err{idx}）", () => {
    const m = buildReviewModel(writing, "email");
    expect(m.kind).toBe("writing");
    expect(m.units.map((u) => [u.idx, u.n, u.lv, u.label])).toEqual([
      [1, 1, "bad", "语法错误"],
      [3, 2, "mid", "表达建议"],
      [4, 3, "bad", "拼写错误"],
    ]);
    expect(m.units[0].hint).toBe("→ I have");
    expect(m.score.label).toBe("4/5");
  });

  test("评分失败的写作：kind=unscored，没有 unit，得分「未评分」", () => {
    const m = buildReviewModel(unscored, "email");
    expect(m.kind).toBe("unscored");
    expect(m.units).toEqual([]);
    expect(m.score.label).toBe("未评分");
  });
});

describe("buildPreview", () => {
  test("选择题：只列错题，最多 4 条，多的给 moreCount", () => {
    const sess = { ...rdl, details: { ...rdl.details, results: Array.from({ length: 6 }, () => ({ selected: "B", correct: "A", isCorrect: false })), questions: [] } };
    const p = buildPreview(buildReviewModel(sess, "rdl"));
    expect(p.title).toBe("错题速览 · 6 题");
    expect(p.items).toHaveLength(4);
    expect(p.more).toBe(true);
    expect(p.moreCount).toBe(2);
    expect(p.cta).toBe("逐题回顾");
  });

  test("全对 → none；评分失败 → 另一句文案；写作 / 口语标题各自不同", () => {
    const allOk = { ...ctw, details: { ...ctw.details, results: [{ isCorrect: true }, { isCorrect: true }] } };
    expect(buildPreview(buildReviewModel(allOk, "ctw"))).toMatchObject({ none: true, noneKind: "clean", noneText: "本次全部答对，可以直接再练一套。" });
    expect(buildPreview(buildReviewModel(unscored, "email"))).toMatchObject({ title: "批改状态", none: true, noneKind: "unscored", cta: "查看作答" });
    expect(buildPreview(buildReviewModel(writing, "email"))).toMatchObject({ title: "批改要点 · 3 处", cta: "查看批改报告" });
    expect(buildPreview(buildReviewModel(repeat, "repeat")).title).toBe("待提高 · 3 项");
  });
});

describe("真题模考", () => {
  const mock = {
    type: "mock", mode: "mock", date: "2026-09-07T10:00:00", score: 6,
    details: {
      realMock: true, source: "real-bank", section: "reading", real: true, subtype: "mock",
      seenItemIds: ["real_ctw_1", "real_rdl_1"],
      items: [{ id: "real_rdl_1", taskType: "rdl", questions: [{ stem: "S1" }, { stem: "S2" }], text: "body" }],
      aggregate: { raw: 3, maxRaw: 4 },
      tasks: [
        { taskType: "ctw", itemId: "real_ctw_1", correct: 1, total: 2, results: ctw.details.results, blanks: ctw.details.blanks, passage: "x" },
        { taskType: "rdl", itemId: "real_rdl_1", correct: 2, total: 2, results: [{ selected: "A", correct: "A", isCorrect: true }, { selected: "B", correct: "B", isCorrect: true }] },
      ],
    },
  };

  test("adaptMockTask：子记录类型 / 题数 / 从 items 补回题面与原文", () => {
    const a = adaptMockTask(mock, mock.details.tasks[1], 1);
    expect(a).toMatchObject({ type: "rdl", itemId: "real_rdl_1" });
    expect(a.session.type).toBe("reading");
    expect(a.session.details.questions).toHaveLength(2);
    expect(a.session.details.passage).toBe("body");
    expect(a.session.correct).toBe(2);
  });

  test("题组 unit：按得分率定档（全对 ok / ≥60% mid / 否则 bad（1/2=50% 记 bad）），文案带题型简称", () => {
    const m = buildReviewModel(mock, "mock-reading", { shortOf: (t) => ({ ctw: "填词", rdl: "日常" }[t]) });
    expect(m.kind).toBe("mock");
    expect(m.units.map((u) => [u.lv, u.hint])).toEqual([["bad", "1/2"], ["ok", "2/2"]]);
    expect(m.units[0].text).toContain("填词");
    expect(m.score.label).toBe("3/4");
    expect(buildMockTasks(mock)).toHaveLength(2);
  });

  test("stripUnits：模考摊平所有题组逐题；写作 / 未评分没有进度点", () => {
    const m = buildReviewModel(mock, "mock-reading");
    expect(stripUnits(mock, m)).toHaveLength(4);
    expect(stripUnits(writing, buildReviewModel(writing, "email"))).toEqual([]);
    expect(stripUnits(unscored, buildReviewModel(unscored, "email"))).toEqual([]);
  });

  test("写作模考题组的评分失败不崩（meta 为空）", () => {
    const wm = { type: "mock", date: "2026-09-07T10:00:00", details: { realMock: true, section: "writing", items: [], tasks: [{ taskType: "email", itemId: "real_em_9", score: null, maxScore: 5, meta: null, items: [{ id: "real_em_9" }] }] } };
    const m = buildReviewModel(wm, "mock-writing");
    expect(m.units).toHaveLength(1);
    expect(buildMockTasks(wm)[0].model.kind).toBe("unscored");
  });
});

describe("真题模考：超时 / 中止前没到达的题", () => {
  const SECRET = "UNSEEN PASSAGE TEXT";
  const reached = { taskType: "ctw", itemId: "real_ctw_1", correct: 1, total: 2, results: ctw.details.results, blanks: ctw.details.blanks, passage: "x" };
  const base = { realMock: true, source: "real-bank", section: "reading", real: true, subtype: "mock", seenItemIds: ["real_ctw_1"], aggregate: { raw: 1, maxRaw: 35 } };
  // 新记录：没到达的组只存占位（无题面），items 里同样是占位。
  const timedOut = {
    type: "reading", mode: "mock", date: "2026-10-03T10:00:00",
    details: {
      ...base,
      items: [{ id: "real_ctw_1", taskType: "ctw" }, { id: "real_rdl_9", taskType: "rdl", realMockRole: "scored", unreached: true }],
      tasks: [reached, { taskType: "rdl", itemId: "real_rdl_9", realMockRole: "scored", unreached: true, timedOut: true, correct: 0, total: 2, unanswered: 2, results: [] }],
    },
  };
  // 修复前的旧记录：没到达的组照样存了整篇原文、题目与正确答案 —— 只能靠 seenItemIds 认出来。
  const legacy = {
    type: "reading", mode: "mock", date: "2026-10-02T10:00:00",
    details: {
      ...base,
      items: [{ id: "real_ctw_1", taskType: "ctw" }, { id: "real_rdl_9", taskType: "rdl", text: SECRET, questions: [{ stem: "Q?", correct_answer: "B" }] }],
      tasks: [reached, { taskType: "rdl", itemId: "real_rdl_9", correct: 0, total: 2, timedOut: true, text: SECRET, questions: [{ stem: "Q?", correct_answer: "B" }], results: [{ selected: null, correct: "B", isCorrect: false }] }],
    },
  };

  test.each([["新记录（unreached 占位）", timedOut], ["旧记录（按 seenItemIds 认）", legacy]])("%s：题组标成未到达，不带任何题面 / 答案，不可点进", (_, rec) => {
    const tasks = buildMockTasks(rec);
    expect(tasks[0].unreached).toBeUndefined();
    expect(tasks[0].model.kind).toBe("ctw");
    expect(tasks[1]).toMatchObject({ unreached: true, session: null, sourceItem: null, type: "rdl", itemId: "real_rdl_9" });
    expect(tasks[1].model).toEqual({ kind: "unreached", units: [], score: { label: "0/2", pct: 0, kind: "mock" } });
    expect(JSON.stringify(tasks[1])).not.toContain(SECRET);
    expect(JSON.stringify(tasks[1])).not.toContain("correct_answer");

    const m = buildReviewModel(rec, "mock-reading", { shortOf: (t) => ({ ctw: "填词", rdl: "日常" }[t]) });
    expect(m.units[1]).toMatchObject({ lv: "none", label: "第 2 题组", text: "日常 · 未到达", hint: "0/2", unreached: true });
    expect(JSON.stringify(m.units)).not.toContain(SECRET);
    // 进度点只摊平到达的组；速览照列全部题组（含未到达）
    expect(stripUnits(rec, m)).toHaveLength(2);
    const p = buildPreview(m);
    expect(p.items.map((u) => u.unreached === true)).toEqual([false, true]);
    expect(buildPreview(tasks[1].model)).toMatchObject({ none: true, noneKind: "unreached", items: [] });
  });

  test("没有 seenItemIds 的旧记录不据此猜测（一律当已展示）", () => {
    const rec = { ...legacy, details: { ...legacy.details, seenItemIds: [] } };
    expect(buildMockTasks(rec).some((t) => t.unreached)).toBe(false);
  });

  const writingBase = {
    realMock: true, source: "real-bank", section: "writing", real: true, subtype: "mock", mockSessionId: "ms-1",
    seenItemIds: ["real_bs_1", "real_bs_2", "real_em_1", "real_ad_1"],
  };
  const bsMeta = (details) => ({ taskId: "bs", taskType: "bs", title: "Build a Sentence", score: 1, maxScore: 10, itemIds: ["real_bs_1", "real_bs_2", "real_bs_3", "real_bs_4"], meta: { details } });

  test("写作造句：没展示的题只剩「第 N 题 · 未到达」，题面 / 答案都不带（新占位与旧记录都一样）", () => {
    const rec = {
      type: "mock", date: "2026-10-03T10:00:00",
      details: {
        ...writingBase,
        tasks: [bsMeta([
          { qid: "real_bs_1", prompt: "p1", userAnswer: "a b", correctAnswer: "a b", isCorrect: true },
          { qid: "real_bs_2", prompt: "p2", userAnswer: "b a", correctAnswer: "a b", isCorrect: false },
          { qid: "real_bs_3", unreached: true, isCorrect: false },
          // 旧记录：超时自动交卷把没展示的题也连题面带答案存了下来
          { qid: "real_bs_4", prompt: "p4", userAnswer: "(no answer)", correctAnswer: "SECRET ANSWER", isCorrect: false },
        ])],
      },
    };
    const [bsTask] = buildMockTasks(rec);
    expect(bsTask.unreached).toBeUndefined();
    expect(bsTask.model.units.map((u) => [u.lv, u.label, u.text])).toEqual([
      ["ok", "第 1 题", "a b"], ["bad", "第 2 题", "a b"], ["none", "第 3 题 · 未到达", ""], ["none", "第 4 题 · 未到达", ""],
    ]);
    expect(bsTask.session.details[3]).toEqual({ qid: "real_bs_4", unreached: true, isCorrect: false });
    // 回顾组件只读子记录与逐题模型
    expect(JSON.stringify([bsTask.session, bsTask.model])).not.toContain("SECRET ANSWER");
  });

  test("中止的写作模考：题源是未到达占位的邮件 / 讨论组算未到达；整卷得分「已中止」", () => {
    const rec = {
      type: "mock", date: "2026-10-03T10:00:00",
      details: {
        ...writingBase, aborted: true, seenItemIds: ["real_bs_1"],
        items: [{ id: "real_bs_1", taskType: "bs" }, { id: "real_em_1", taskType: "email", unreached: true }, { id: "real_ad_1", taskType: "discussion", unreached: true }],
        tasks: [
          bsMeta([{ qid: "real_bs_1", prompt: "p1", userAnswer: "a b", correctAnswer: "a b", isCorrect: true }, { qid: "real_bs_2", unreached: true, isCorrect: false }]),
          { taskId: "email", taskType: "email", score: null, maxScore: 5, itemIds: ["real_em_1"], items: [{ id: "real_em_1", taskType: "email", unreached: true }], meta: null },
          { taskId: "discussion", taskType: "discussion", score: null, maxScore: 5, itemIds: ["real_ad_1"], items: [{ id: "real_ad_1", taskType: "discussion", unreached: true }], meta: null },
        ],
      },
    };
    const tasks = buildMockTasks(rec);
    expect(tasks.map((t) => !!t.unreached)).toEqual([false, true, true]);
    expect(tasks[1].model.score).toEqual({ label: "0/5", pct: 0, kind: "mock" });
    expect(buildReviewModel(rec, "mock-writing").score).toEqual({ label: "已中止", pct: null, kind: "mock" });
  });
});

describe("日期", () => {
  // 2026-10-03 是周六 → 本周一是 9/28：9/28–10/1 属「本周早些时候」，9/27 及以前「更早」
  const now = new Date("2026-10-03T23:30:00");
  test("dayGroupLabel", () => {
    expect(dayGroupLabel("2026-10-03T09:00:00", now)).toBe("今天");
    expect(dayGroupLabel("2026-10-02T23:59:00", now)).toBe("昨天");
    expect(dayGroupLabel("2026-10-01T09:00:00", now)).toBe("本周早些时候");
    expect(dayGroupLabel("2026-09-28T09:00:00", now)).toBe("本周早些时候");
    expect(dayGroupLabel("2026-09-27T09:00:00", now)).toBe("更早");
    expect(dayGroupLabel("garbage", now)).toBe("更早");
  });

  test("周一当天：昨天之外没有「本周早些时候」，前天起都是更早", () => {
    const monday = new Date("2026-09-28T12:00:00");
    expect(dayGroupLabel("2026-09-27T09:00:00", monday)).toBe("昨天");
    expect(dayGroupLabel("2026-09-26T09:00:00", monday)).toBe("更早");
  });

  test("whenLabel / rowTimeLabel", () => {
    expect(whenLabel("2026-10-03T10:42:00", now)).toBe("今天 10:42");
    expect(whenLabel("2026-10-01T18:30:00", now)).toBe("10月1日 周四 18:30");
    expect(rowTimeLabel("2026-10-02T08:05:00", now)).toBe("08:05");
    expect(rowTimeLabel("2026-09-20T08:05:00", now)).toBe("9月20日 08:05");
  });

  test("groupEntriesByDay 保持顺序、按标签聚合", () => {
    const mk = (date) => ({ session: { date } });
    const groups = groupEntriesByDay([mk("2026-10-03T09:00:00"), mk("2026-10-03T08:00:00"), mk("2026-10-02T08:00:00"), mk("2026-09-01T08:00:00")], now);
    expect(groups.map((g) => [g.label, g.entries.length])).toEqual([["今天", 2], ["昨天", 1], ["更早", 1]]);
  });
});

describe("averagePct", () => {
  test("无分记录不进平均；全无分返回 null", () => {
    const entries = [{ session: ctw }, { session: unscored }];
    expect(averagePct(entries)).toBe(50);
    expect(averagePct([{ session: unscored }])).toBeNull();
    expect(averagePct([])).toBeNull();
  });
});

describe("wordDiff", () => {
  test("词序错：公共子序列标 hit，其余标 miss；忽略大小写与标点", () => {
    const d = wordDiff("Do you know if there are any materials I need to bring?", "do you know if there are any materials I need to bring");
    expect(d.user.every((w) => w.hit)).toBe(true);
    expect(d.corr.every((w) => w.hit)).toBe(true);
    const e = wordDiff("know you do if", "do you know if");
    expect(e.user.filter((w) => !w.hit).length).toBeGreaterThan(0);
    expect(e.user.map((w) => w.t).join(" ")).toBe("know you do if");
    expect(e.corr.map((w) => w.t + w.sp).join("")).toBe("do you know if");
  });
  test("缺词 / 多词 / 空答案不崩", () => {
    const d = wordDiff("a c", "a b c");
    expect(d.user.map((w) => w.hit)).toEqual([true, true]);
    expect(d.corr.map((w) => w.hit)).toEqual([true, false, true]);
    expect(wordDiff("", "x y").corr.every((w) => !w.hit)).toBe(true);
    expect(wordDiff(undefined, undefined)).toEqual({ user: [], corr: [] });
  });
});
