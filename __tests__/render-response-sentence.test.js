const { renderResponseSentence } = require("../lib/questionBank/renderResponseSentence");

describe("renderResponseSentence", () => {
  test("renders complete correct/user response sentences", () => {
    const q = {
      answer: "Could you send me the slides after class today?",
      has_question_mark: true,
      prefilled: ["you"],
      prefilled_positions: { you: 1 },
    };
    const out = renderResponseSentence(q, ["could", "send me", "the slides", "today", "after class"]);
    expect(out.correctSentenceFull).toBe("Could you send me the slides after class today?");
    expect(out.userSentenceFull).toBe("Could you send me the slides today after class?");
  });

  test("fixes punctuation spacing and collapses double spaces", () => {
    const q = {
      answer: "Please sit down everyone.",
      has_question_mark: false,
      prefilled: [],
      prefilled_positions: {},
    };
    const out = renderResponseSentence(q, ["please", "sit down", "everyone"]);
    expect(out.correctSentenceFull).toBe("Please sit down everyone.");
  });

  test("builds correct sentence with multiple prefilled spans", () => {
    const q = {
      answer: "Could you send me the slides after class today?",
      has_question_mark: true,
      prefilled_positions: { you: 1, "after class": 5 },
    };
    const out = renderResponseSentence(q, ["could", "send me", "the slides", "today"]);
    expect(out.correctSentenceFull).toBe("Could you send me the slides after class today?");
  });

  // P1.6: the reference answer must be shown verbatim from q.answer — preserving
  // proper-noun capitalization and internal commas (previously lowercased/stripped).
  test("renders correct answer verbatim — proper noun + internal comma", () => {
    const q = {
      answer: "Honestly, Juan needed help moving into his apartment.",
      has_question_mark: false,
      prefilled: [],
      prefilled_positions: {},
    };
    const out = renderResponseSentence(q, []);
    expect(out.correctSentenceFull).toBe("Honestly, Juan needed help moving into his apartment.");
  });

  test("renders correct answer verbatim — proper noun + question mark", () => {
    const q = {
      answer: "When does Olivia leave for our conference?",
      has_question_mark: true,
      prefilled: [],
      prefilled_positions: {},
    };
    const out = renderResponseSentence(q, []);
    expect(out.correctSentenceFull).toBe("When does Olivia leave for our conference?");
  });

  test("missing q.answer returns a non-crashing string", () => {
    const out = renderResponseSentence({ has_question_mark: false }, []);
    expect(typeof out.correctSentenceFull).toBe("string");
  });
});
