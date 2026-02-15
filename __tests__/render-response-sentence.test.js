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

  test("legacy given is inserted at givenIndex and matches correct sentence", () => {
    const q = {
      given: "you",
      givenIndex: 2,
      has_question_mark: true,
      responseSuffix: "?",
      answerOrder: ["would", "like", "to send", "me", "a copy", "of it"],
      bank: ["a copy", "like", "to send", "would", "me", "of it"],
      answer: "Would like you to send me a copy of it?",
    };
    const out = renderResponseSentence(q, q.answerOrder);
    expect(out.correctSentenceFull).toBe("Would like you to send me a copy of it?");
  });
});
