const {
  hardFailReasons,
  warnings,
} = require("../lib/questionBank/qualityGateBuildSentence");

describe("qualityGateBuildSentence v2", () => {
  test("hard-fails duplicated prefilled chunks through word-bag mismatch", () => {
    const q = {
      id: "bad_1",
      prompt: "What do you ask?",
      answer: "Could you tell me where the workshop notes are posted?",
      chunks: ["could", "you", "tell me", "where", "the workshop", "notes", "are posted"],
      prefilled: ["you"],
      prefilled_positions: { you: 1 },
      distractor: null,
      has_question_mark: true,
      grammar_points: ["embedded question (where)"],
    };
    const reasons = hardFailReasons(q);
    expect(reasons.some((r) => r.includes("must equal answer words"))).toBe(true);
  });

  test("hard-fails on answer/chunks mismatch", () => {
    const q = {
      id: "bad_2",
      prompt: "What do you ask?",
      answer: "Do you know whether the lab is open tomorrow morning?",
      chunks: ["do", "you know", "whether", "the lab", "is open"],
      prefilled: [],
      prefilled_positions: {},
      distractor: null,
      has_question_mark: true,
      grammar_points: ["embedded question (whether)"],
    };
    const reasons = hardFailReasons(q);
    expect(reasons.some((r) => r.includes("must equal answer words"))).toBe(true);
  });

  test("warns on has_question_mark mismatch", () => {
    const q = {
      id: "warn_1",
      prompt: "What do you ask?",
      answer: "Could you tell me where the workshop notes are posted?",
      chunks: ["could", "tell me", "where", "the workshop", "notes", "are posted"],
      prefilled: ["you"],
      prefilled_positions: { you: 1 },
      distractor: null,
      has_question_mark: false,
      grammar_points: ["embedded question (where)"],
    };
    const list = warnings(q);
    expect(list.some((w) => w.includes("has_question_mark must match answer ending punctuation"))).toBe(true);
  });
});
