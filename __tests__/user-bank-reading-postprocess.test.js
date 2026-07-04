const { postProcessRdl, postProcessAp } = require("../lib/ai/prompts/questionExtraction");

// Helpers — a complete MCQ question and enough passage text to clear the min-length gates.
function mcq(over = {}) {
  return {
    question_type: "detail",
    stem: "According to the notice, when does the library close?",
    options: { A: "5 PM", B: "6 PM", C: "7 PM", D: "8 PM" },
    correct_answer: "B",
    explanation: "Stated in the second sentence.",
    ...over,
  };
}
function wordsOf(n) {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}
// ~40 words → inside the RDL short band (30-70).
const RDL_TEXT = wordsOf(40);

describe("postProcessRdl (个人题库导入 schema 分档)", () => {
  test("valid 2-question item → variant short, no invalid flag, answers normalized", () => {
    const out = postProcessRdl({ genre: "notice", text: RDL_TEXT, questions: [mcq(), mcq({ correct_answer: "c" })] });
    expect(out.invalid).toBeUndefined();
    expect(out.variant).toBe("short");
    expect(out.questions).toHaveLength(2);
    expect(out.questions[1].correct_answer).toBe("C"); // lowercase normalized
    expect(out.difficulty).toBe("medium");
  });

  test("3 questions → variant long (分池口径：恰好 2 题才进 short)", () => {
    const out = postProcessRdl({ text: wordsOf(100), questions: [mcq(), mcq(), mcq()] });
    expect(out.variant).toBe("long");
    expect(out.invalid).toBeUndefined();
  });

  test("correct_answer null is ALLOWED (答案可缺，verify 代解)", () => {
    const out = postProcessRdl({ text: RDL_TEXT, questions: [mcq({ correct_answer: null }), mcq({ correct_answer: "" })] });
    expect(out.invalid).toBeUndefined();
    expect(out.questions[0].correct_answer).toBeNull();
    expect(out.questions[1].correct_answer).toBeNull();
  });

  test("correct_answer outside A-D/null → invalid with Chinese reason", () => {
    const out = postProcessRdl({ text: RDL_TEXT, questions: [mcq(), mcq({ correct_answer: "E" })] });
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/第2题答案标记异常/);
  });

  test("missing option → invalid; empty stem → invalid", () => {
    const noC = postProcessRdl({ text: RDL_TEXT, questions: [mcq({ options: { A: "x", B: "y", D: "z" } })] });
    expect(noC.invalid).toBe(true);
    expect(noC.invalid_reason).toMatch(/选项不全（缺选项 C）/);

    const noStem = postProcessRdl({ text: RDL_TEXT, questions: [mcq({ stem: "" })] });
    expect(noStem.invalid).toBe(true);
    expect(noStem.invalid_reason).toMatch(/题干缺失/);
  });

  test("word count outside band → warnings only, NOT invalid (个人题不拒词数)", () => {
    const out = postProcessRdl({ text: wordsOf(20), questions: [mcq(), mcq()] }); // short band is 30-70
    expect(out.invalid).toBeUndefined();
    expect(out.warnings).toBeDefined();
    expect(out.warnings.join(" ")).toMatch(/词数 20/);
  });

  test("missing text / missing questions → invalid", () => {
    expect(postProcessRdl({ questions: [mcq()] }).invalid).toBe(true);
    expect(postProcessRdl({ text: RDL_TEXT, questions: [] }).invalid).toBe(true);
  });

  test("genre falls back to other; format_metadata coerced to object; deterministic", () => {
    const input = { text: RDL_TEXT, questions: [mcq()], format_metadata: null };
    const out = postProcessRdl(input);
    expect(out.genre).toBe("other");
    expect(out.format_metadata).toEqual({});
    expect(postProcessRdl(input)).toEqual(out);
  });
});

describe("postProcessAp (个人题库导入 schema 分档 + paragraphs 派生)", () => {
  // 3 paragraphs × 50 words ≈ 150 words → inside AP band (110-230).
  const AP_PASSAGE = [wordsOf(50), wordsOf(50), wordsOf(50)].join("\n\n");
  const FIVE_QS = [mcq(), mcq(), mcq(), mcq(), mcq()];

  test("paragraphs are derived server-side from \\n\\n — AI-provided array is discarded", () => {
    const out = postProcessAp({ topic: "biology", passage: AP_PASSAGE, paragraphs: ["junk"], questions: FIVE_QS });
    expect(out.invalid).toBeUndefined();
    expect(out.paragraphs).toHaveLength(3);
    expect(out.paragraphs[0]).not.toBe("junk");
    expect(out.paragraphs.join("\n\n")).toBe(AP_PASSAGE);
  });

  test("word count over 230 → warning only (用户搬 300+ 词旧 TPO 不能拒)", () => {
    const long = [wordsOf(150), wordsOf(150)].join("\n\n"); // 300 words
    const out = postProcessAp({ passage: long, questions: FIVE_QS });
    expect(out.invalid).toBeUndefined();
    expect(out.warnings.join(" ")).toMatch(/词数 300/);
  });

  test("question count ≠ 5 → warning only", () => {
    const out = postProcessAp({ passage: AP_PASSAGE, questions: [mcq(), mcq(), mcq()] });
    expect(out.invalid).toBeUndefined();
    expect(out.warnings.join(" ")).toMatch(/共 3 题/);
  });

  test("stem referencing a paragraph beyond the derived count → warning", () => {
    const qs = [mcq({ stem: 'The word "varies" in paragraph 4 is closest in meaning to…' }), mcq(), mcq(), mcq(), mcq()];
    const out = postProcessAp({ passage: AP_PASSAGE, questions: qs }); // only 3 paragraphs
    expect(out.invalid).toBeUndefined();
    expect(out.warnings.join(" ")).toMatch(/引用 paragraph 4/);
  });

  test("insert_text without ■ markers in passage → question dropped + warning", () => {
    const qs = [mcq({ question_type: "insert_text", stem: "Where would the sentence best fit?" }), mcq(), mcq()];
    const out = postProcessAp({ passage: AP_PASSAGE, questions: qs });
    expect(out.invalid).toBeUndefined();
    expect(out.questions).toHaveLength(2); // insert_text dropped
    expect(out.warnings.join(" ")).toMatch(/句子插入题/);
  });

  test("insert_text WITH markers is kept (4 markers → no marker-count warning)", () => {
    const marked = `${wordsOf(40)} [■] ${wordsOf(30)} [■] ${wordsOf(30)}\n\n[■] ${wordsOf(30)} [■] ${wordsOf(20)}`;
    const qs = [mcq({ question_type: "insert_text", stem: "Where would the sentence best fit?" }), mcq()];
    const out = postProcessAp({ passage: marked, questions: qs });
    expect(out.invalid).toBeUndefined();
    expect(out.questions).toHaveLength(2);
    expect((out.warnings || []).join(" ")).not.toMatch(/插入位置标记有/);
  });

  test("null answers allowed; bad answers invalid (同 RDL 口径)", () => {
    const okNull = postProcessAp({ passage: AP_PASSAGE, questions: [mcq({ correct_answer: null }), mcq(), mcq(), mcq(), mcq()] });
    expect(okNull.invalid).toBeUndefined();
    expect(okNull.questions[0].correct_answer).toBeNull();

    const bad = postProcessAp({ passage: AP_PASSAGE, questions: [mcq({ correct_answer: "AB" })] });
    expect(bad.invalid).toBe(true);
    expect(bad.invalid_reason).toMatch(/答案标记异常/);
  });

  test("single paragraph passage → 段落空行提示 warning", () => {
    const out = postProcessAp({ passage: wordsOf(150), questions: FIVE_QS });
    expect(out.invalid).toBeUndefined();
    expect(out.warnings.join(" ")).toMatch(/只识别到 1 个段落/);
  });

  test("missing passage → invalid", () => {
    expect(postProcessAp({ questions: FIVE_QS }).invalid).toBe(true);
  });
});
