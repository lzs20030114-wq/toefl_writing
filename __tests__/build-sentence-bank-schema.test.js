const {
  validateQuestion,
  validateQuestionSet,
  validateBuildSentenceBank,
} = require("../lib/questionBank/buildSentenceSchema");

describe("build sentence bank schema v2", () => {
  test("valid question passes", () => {
    const q = {
      id: "ets_t1_q1",
      prompt: "The workshop was useful.",
      answer: "Could you tell me where the workshop notes are posted?",
      chunks: ["could", "tell me", "where", "the workshop", "notes", "are posted"],
      prefilled: ["you"],
      prefilled_positions: { you: 1 },
      distractor: null,
      has_question_mark: true,
      grammar_points: ["modal question (could)", "embedded question (where)"],
    };
    expect(validateQuestion(q)).toEqual({ fatal: [], format: [], content: [] });
  });

  test("prefilled duplicated in chunks is rejected", () => {
    const q = {
      id: "ets_t1_q2",
      prompt: "The workshop was useful.",
      answer: "Could you tell me where the workshop notes are posted?",
      chunks: ["could", "you", "tell me", "where", "the workshop", "notes", "are posted"],
      prefilled: ["you"],
      prefilled_positions: { you: 1 },
      distractor: null,
      has_question_mark: true,
      grammar_points: ["embedded question (where)"],
    };
    const res = validateQuestion(q);
    expect(res.fatal.some((e) => e.includes("must not also appear in chunks"))).toBe(true);
  });

  test("has_question_mark must match answer punctuation", () => {
    const q = {
      id: "ets_t1_q3",
      prompt: "The workshop was useful.",
      answer: "Could you tell me where the workshop notes are posted?",
      chunks: ["could", "tell me", "where", "the workshop", "notes", "are posted"],
      prefilled: ["you"],
      prefilled_positions: { you: 1 },
      distractor: null,
      has_question_mark: false,
      grammar_points: ["embedded question (where)"],
    };
    const res = validateQuestion(q);
    expect(res.format.some((e) => e.includes("has_question_mark must match"))).toBe(true);
  });

  test("distractor appearing in answer is rejected", () => {
    const q = {
      id: "ets_t1_q4",
      prompt: "The workshop was useful.",
      answer: "Could you tell me where the workshop notes are posted?",
      chunks: ["could", "tell me", "where", "the workshop", "notes", "are posted", "workshop"],
      prefilled: ["you"],
      prefilled_positions: { you: 1 },
      distractor: "workshop",
      has_question_mark: true,
      grammar_points: ["embedded question (where)"],
    };
    const res = validateQuestion(q);
    expect(res.fatal.some((e) => e.includes("distractor must not appear in answer"))).toBe(true);
  });

  test("set validator catches duplicate ids", () => {
    const set = {
      set_id: 1,
      questions: [
        {
          id: "dup",
          prompt: "The workshop was useful.",
          answer: "Could you tell me where the workshop notes are posted?",
          chunks: ["could", "tell me", "where", "the workshop", "notes", "are posted"],
          prefilled: ["you"],
          prefilled_positions: { you: 1 },
          distractor: null,
          has_question_mark: true,
          grammar_points: ["embedded question (where)"],
        },
        {
          id: "dup",
          prompt: "The lab was closed.",
          answer: "Do you know whether the lab is open tomorrow morning?",
          chunks: ["do", "you know", "whether", "the lab", "is open", "tomorrow morning"],
          prefilled: [],
          prefilled_positions: {},
          distractor: null,
          has_question_mark: true,
          grammar_points: ["embedded question (whether)"],
        },
      ],
    };
    const result = validateQuestionSet(set);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate id"))).toBe(true);
  });

  test("legacy alias validateBuildSentenceBank still returns schema-like result", () => {
    const invalidSet = {
      set_id: 1,
      questions: [
        {
          id: "bad",
          prompt: "Prompt",
          answer: "Do you know if the lab is open tonight?",
          chunks: ["do", "you know"], // intentionally incomplete
          prefilled: [],
          prefilled_positions: {},
          distractor: null,
          has_question_mark: true,
          grammar_points: ["embedded question (if)"],
        },
      ],
    };
    const result = validateBuildSentenceBank(invalidSet);
    expect(typeof result.ok).toBe("boolean");
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.ok).toBe(false);
  });
});
