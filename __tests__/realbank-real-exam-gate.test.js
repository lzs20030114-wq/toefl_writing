/**
 * 真题口径（realExam）与生成库口径的分界。
 *
 * 起因：2026-09-15 查「落库丢弃」的 249 题，validator 拒收那 83 题里有一大半不是源料残，
 * 是闸门按**生成库**的标准量真题。拿 data/realExam2026 的真实分布对过：
 *   · 对话最短 53 词（4.6 那三段 53/54/57 词都是完整成对的闲聊），26% 在 80 词以下；
 *   · 短应答刺激句最短 3 词（"The classroom's cold."）；
 *   · 面试题面 91 条里 21 条不到 5 词、29 条 5~9 词（"What is your opinion and why?" 6 词）。
 * 所以真题走放宽的长度下限，生成库一个字不动 —— 免得模型借这道口子偷懒产短货。
 * 结构类的闸（题数恰 2 / 讲座 4 题 / 每人至少 2 轮 / 选项必须 4 个）两边一样严。
 */
const { validateLC } = require("../lib/listeningGen/lcValidator");
const { validateLCR } = require("../lib/listeningGen/lcrValidator");
const { validateInterviewSet } = require("../lib/speakingGen/speakingValidator");

const REAL = { realExam: true };
const turn = (speaker, n) => ({ speaker, text: Array.from({ length: n }, (_, i) => `w${i}`).join(" ") });

function lcItem(turns) {
  return {
    id: "x", context: "campus_daily", situation: "",
    speakers: [{ name: "Man", role: "student", gender: "male" }, { name: "Woman", role: "staff", gender: "female" }],
    conversation: turns,
    questions: [
      { stem: "What are they talking about in this conversation?", options: { A: "She is late for class", B: "He forgot the book", C: "They will meet later", D: "The office is closed" }, answer: "A" },
      { stem: "What will the man most likely do next after this?", options: { A: "She is late for class", B: "He forgot the book", C: "They will meet later", D: "The office is closed" }, answer: "B" },
    ],
  };
}

describe("真题放宽的是长度下限，不是结构", () => {
  test("LC：4 轮 / 55 词 —— 生成库拒，真题收", () => {
    const short = lcItem([turn("Man", 15), turn("Woman", 15), turn("Man", 13), turn("Woman", 12)]);
    const gen = validateLC(short);
    expect(gen.valid).toBe(false);
    expect(gen.errors.join(" ")).toMatch(/too_few_turns|conversation_too_short/);
    expect(validateLC(short, REAL).valid).toBe(true);
  });

  test("LC：3 轮、且有一方只说了一次 —— 两种口径都拒（多半是转写没切全）", () => {
    const odd = lcItem([turn("Man", 30), turn("Woman", 20), turn("Man", 20)]);
    expect(validateLC(odd).valid).toBe(false);
    expect(validateLC(odd, REAL).valid).toBe(false);
    expect(validateLC(odd, REAL).errors.join(" ")).toMatch(/speaker_Woman_too_few_turns/);
  });

  test("LC：6 轮的正常对话，两种口径都收", () => {
    const ok = lcItem([turn("Man", 20), turn("Woman", 20), turn("Man", 15), turn("Woman", 15), turn("Man", 10), turn("Woman", 10)]);
    expect(validateLC(ok).valid).toBe(true);
    expect(validateLC(ok, REAL).valid).toBe(true);
  });

  test("LCR：3 词刺激句 —— 生成库拒，真题收；2 词两边都拒", () => {
    const mk = (speaker) => ({
      id: "x", speaker, difficulty: "medium",
      options: { A: "Sure, I can help.", B: "No, not today.", C: "It is over there.", D: "I already did it." },
      answer: "A",
    });
    expect(validateLCR(mk("The classroom's cold.")).valid).toBe(false);
    expect(validateLCR(mk("The classroom's cold."), REAL).valid).toBe(true);
    expect(validateLCR(mk("Too short"), REAL).valid).toBe(false);
  });

  test("面试：6 词题面 —— 生成库拒，真题收", () => {
    const mk = (q) => ({
      id: "x", topic: "", intro: "You will answer a few questions about your own experience.",
      questions: [
        { id: "x_q1", position: "Q1", question: "Tell me about a class you enjoyed this term and why.", difficulty: "personal", word_count: 12, expected_response_topics: [] },
        { id: "x_q2", position: "Q2", question: "What did the instructor do that made it work so well?", difficulty: "personal", word_count: 12, expected_response_topics: [] },
        { id: "x_q3", position: "Q3", question: q, difficulty: "personal", word_count: q.trim().split(/\s+/).length, expected_response_topics: [] },
      ],
    });
    const six = mk("What is your opinion and why?");
    expect(validateInterviewSet(six).valid).toBe(false);
    expect(validateInterviewSet(six).errors.join(" ")).toMatch(/word_count/);
    expect(validateInterviewSet(six, REAL).valid).toBe(true);
  });
});

describe("面试补录：短到当不成一道题的组并进上一题", () => {
  const { mergeShortGroups, checkGroups } = require("../scripts/realbank/recall_speaking.mjs");
  const qs = [
    "Describe a skill you learned outside of school.",   // 1 · 8 词
    "Why?",                                              // 2 · 1 词
    "Some people think group work is always better.",    // 3 · 8 词
    "Do you agree or disagree with this viewpoint?",     // 4 · 8 词
    "Tell me about a time you changed your mind.",       // 5 · 9 词
    "What was it?",                                      // 6 · 3 词
  ];

  test("单词追问并进上一组，5 词以上的完整题面不并", () => {
    expect(mergeShortGroups([[1], [2], [3, 4], [5], [6]], qs)).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  test("首组自己太短就并进第二组（后面没东西可并，只能往前吞）", () => {
    // [2] 是 "Why?"，排在最前面 —— 没有上一组可并，就把它和第二组并成一题
    const merged = mergeShortGroups([[2], [1], [3, 4], [5]], qs);
    expect(merged).toEqual([[2, 1], [3, 4], [5]]);
  });

  test("并完仍要过机械校验：组数掉出 3~4 就判 review，不硬凑", () => {
    const merged = mergeShortGroups([[1], [2], [3]], ["Why?", "Why?", "Why?"]);
    expect(merged).toHaveLength(1);
    expect(checkGroups(merged, 3)).toMatch(/组数/);
  });
});
