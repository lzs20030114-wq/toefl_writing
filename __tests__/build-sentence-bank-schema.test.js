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

  test("legacy alias validateBuildSentenceBank still works", () => {
    const questions = [
      {
        id: "ets_t1_q11",
        prompt: "The workshop was useful.",
        answer: "Could you tell me where the workshop notes are posted?",
        chunks: ["could", "tell me", "where", "the workshop", "notes", "are posted"],
        prefilled: ["you"],
        prefilled_positions: { you: 1 },
        distractor: null,
        has_question_mark: true,
        grammar_points: ["embedded question (where)", "passive voice"],
      },
      {
        id: "ets_t1_q12",
        prompt: "The lab was closed.",
        answer: "Do you know whether the lab is open tomorrow morning?",
        chunks: ["do", "you know", "whether", "the lab", "is open", "tomorrow morning"],
        prefilled: [],
        prefilled_positions: {},
        distractor: null,
        has_question_mark: true,
        grammar_points: ["embedded question (whether)"],
      },
      {
        id: "ets_t1_q13",
        prompt: "I missed the lecture.",
        answer: "Can you tell me where the lecture slides are uploaded?",
        chunks: ["can", "tell me", "where", "the lecture", "slides", "are uploaded"],
        prefilled: ["you"],
        prefilled_positions: { you: 1 },
        distractor: null,
        has_question_mark: true,
        grammar_points: ["embedded question (where)"],
      },
      {
        id: "ets_t1_q14",
        prompt: "The park looked busy.",
        answer: "Does anybody know whether it is open all year long?",
        chunks: ["does", "anybody know", "whether", "it is open", "all year", "long", "they"],
        prefilled: [],
        prefilled_positions: {},
        distractor: "they",
        has_question_mark: true,
        grammar_points: ["embedded question (whether)"],
      },
      {
        id: "ets_t1_q15",
        prompt: "The film was great.",
        answer: "Can we find out if they are planning another one?",
        chunks: ["can", "we", "find out", "if", "they are", "planning", "another one"],
        prefilled: [],
        prefilled_positions: {},
        distractor: null,
        has_question_mark: true,
        grammar_points: ["embedded question (if)"],
      },
      {
        id: "ets_t1_q16",
        prompt: "The schedule changed.",
        answer: "Could you tell me how long each workshop session was?",
        chunks: ["could", "tell me", "how long", "each", "workshop session", "was", "why"],
        prefilled: ["you"],
        prefilled_positions: { you: 1 },
        distractor: "why",
        has_question_mark: true,
        grammar_points: ["embedded question (how long)"],
      },
      {
        id: "ets_t1_q17",
        prompt: "The exhibition looked good.",
        answer: "Would you happen to know where the exhibit information center is?",
        chunks: ["would", "you happen", "to know", "where", "the exhibit", "information center", "is"],
        prefilled: [],
        prefilled_positions: {},
        distractor: null,
        has_question_mark: true,
        grammar_points: ["embedded question (where)"],
      },
      {
        id: "ets_t1_q18",
        prompt: "The gym may be crowded.",
        answer: "Do you know if it is usually crowded at this time?",
        chunks: ["do", "you know", "if", "it is", "usually crowded", "at this time", "daily"],
        prefilled: [],
        prefilled_positions: {},
        distractor: "daily",
        has_question_mark: true,
        grammar_points: ["embedded question (if)"],
      },
      {
        id: "ets_t1_q19",
        prompt: "The documentary was interesting.",
        answer: "Have you heard any details about how they filmed it?",
        chunks: ["have you heard", "any details", "about", "how", "they filmed", "it"],
        prefilled: [],
        prefilled_positions: {},
        distractor: null,
        has_question_mark: true,
        grammar_points: ["embedded question (how)"],
      },
      {
        id: "ets_t1_q20",
        prompt: "I am applying for a role.",
        answer: "I wonder how many open positions they have.",
        chunks: ["i wonder", "how many", "open", "positions", "they", "have"],
        prefilled: [],
        prefilled_positions: {},
        distractor: null,
        has_question_mark: false,
        grammar_points: ["embedded question (how many)"],
      },
    ];
    const result = validateBuildSentenceBank({ set_id: 1, questions });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
