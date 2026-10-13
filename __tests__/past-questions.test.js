import { collectPastQuestions, pickAnalogies, analogyLines } from "../lib/qa/pastQuestions";
import { wantsAnalogy, wantsMistakeContext, parseAnswer, numberSentences } from "../lib/qa/questionQa";

const sess = (id, date, stem, selected, isCorrect, extra = {}) => ({
  id, type: "reading", date,
  details: { subtype: "ap", itemId: `real_ap_${id}`, passage: "Bees matter a lot. Farms rely on them.",
    questions: [{ question_type: "factual_detail", stem, options: { A: "bees", B: "farms" }, correct_answer: "A", ...extra }],
    results: [{ selected, correct: "A", isCorrect }] },
});

describe("collectPastQuestions", () => {
  test("同题型、排除本题、同一题做过多次只留最近一次；别的题型 / 模考不收", () => {
    const sessions = [
      sess(1, "2026-10-01", "Q1", "B", false),
      sess(2, "2026-10-05", "Q1", "A", true),
      sess(3, "2026-10-02", "current", "B", false),
      sess(4, "2026-10-03", "Q2", "B", false, { question_type: "inference" }),
      { ...sess(5, "2026-10-04", "Q3", "B", false), type: "mock" },
    ];
    const r = collectPastQuestions(sessions, { questionType: "factual_detail", stem: "current", correctAnswer: "A. bees" });
    expect(r.map((d) => [d.stem, d.isCorrect, d.date])).toEqual([["Q1", true, "2026-10-05"]]);
  });
  test("同一天重做同一道题，按完整时间留后做的那次（不论记录先后顺序）", () => {
    const early = sess(1, "2026-10-05T08:00:00.000Z", "Q1", "B", false);
    const late = sess(2, "2026-10-05T20:00:00.000Z", "Q1", "A", true);
    for (const sessions of [[early, late], [late, early]]) {
      const r = collectPastQuestions(sessions, { questionType: "factual_detail", stem: "current" });
      expect(r.map((d) => [d.isCorrect, d.date])).toEqual([[true, "2026-10-05"]]);
    }
  });
});

describe("pickAnalogies", () => {
  const past = [
    { stem: "w1", isCorrect: false, date: "2026-10-09", options: { A: "a", B: "b" }, selected: "B", correct: "A", passage: "" },
    { stem: "w2", isCorrect: false, date: "2026-10-01", options: { A: "a", B: "b" }, selected: "B", correct: "A", passage: "" },
    { stem: "w3", isCorrect: false, date: "2026-10-05", options: { A: "a", B: "b" }, selected: "B", correct: "A", passage: "" },
    { stem: "r1", isCorrect: true, date: "2026-10-02", options: { A: "a", B: "b" }, selected: "A", correct: "A", passage: "Bees matter a lot. Farms rely on them.", qid: "real_ap_9-q0" },
    { stem: "r2", isCorrect: true, date: "2026-10-08", options: { A: "a", B: "b" }, selected: "A", correct: "A", passage: "", question: { explanation: "解析 r2" } },
    { stem: "r3", isCorrect: true, date: "2026-09-01", options: { A: "a", B: "b" }, selected: "A", correct: "A", passage: "" },
  ];
  test("错的 2 道同陷阱优先再按时间，对的 2 道按时间；真题带依据句，生成库带解析", () => {
    const traps = { w2: "偷换概念" };
    const evidenceData = { items: { "real_ap_9-q0": { status: "ok", stem: "r1", sentences: ["Farms rely on them."] } } };
    const r = pickAnalogies(past, { trap: "偷换概念", trapOf: (b) => traps[b.stem] || null, evidenceData });
    expect(r.items.map((m) => [m.n, m.stem, m.trap])).toEqual([[1, "w2", "偷换概念"], [2, "w1", null], [3, "r2", null], [4, "r1", null]]);
    expect(r.items[3].evidence).toEqual(["Farms rely on them."]);
    expect(r.items[2].explanation).toBe("解析 r2");
    const text = analogyLines(r)[0];
    expect(text).toContain("共 6 道：做错 3、做对 3；挑了下面 4 道");
    expect(text).toContain("[题1] 2026-10-01 做错｜题目：w2｜选项：A. a；B. b｜学生选：B. b｜正确：A. a｜当时讲解归纳的陷阱：偷换概念");
    expect(text).toContain("答案依据句（离线标注）：\"Farms rely on them.\"");
  });
  test("没有对比题时不出任何行", () => {
    expect(analogyLines(pickAnalogies([]))).toEqual([]);
  });
});

describe("触发与出处", () => {
  test("wantsAnalogy：预设或提问里提出类似需求", () => {
    expect(wantsAnalogy("", "analogy")).toBe(true);
    expect(wantsAnalogy("", "parse-key")).toBe(false);
    expect(wantsAnalogy("能举一反三吗", null)).toBe(true);
    expect(wantsAnalogy("这类题怎么做", null)).toBe(true);
    expect(wantsAnalogy("这句什么意思", null)).toBe(false);
    // 错题仍按原口径
    expect(wantsMistakeContext("我是不是老是犯这种错", null)).toBe(true);
  });
  test("[题N] 按这一轮给的对比题数量核对", () => {
    const sentences = numberSentences("A cat sat.");
    const cites = (past) => parseAnswer("见 [题1] 和 [题3]", sentences, [], { past }).filter((x) => x.type === "cite").map((x) => [x.id, x.valid]);
    expect(cites(2)).toEqual([["题1", true], ["题3", false]]);
    expect(cites(0)).toEqual([["题1", false], ["题3", false]]);
  });
});
