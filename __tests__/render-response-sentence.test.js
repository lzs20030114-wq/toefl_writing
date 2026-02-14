const { renderResponseSentence } = require("../lib/questionBank/renderResponseSentence");

describe("renderResponseSentence", () => {
  test("renders complete correct/user response sentences", () => {
    const q = {
      given: "Could you",
      responseSuffix: "?",
      answerOrder: ["send me", "the slides", "after class", "today"],
    };
    const out = renderResponseSentence(q, ["send me", "the slides", "today", "after class"]);
    expect(out.correctSentenceFull).toBe("Could you send me the slides after class today?");
    expect(out.userSentenceFull).toBe("Could you send me the slides today after class?");
  });

  test("fixes punctuation spacing and collapses double spaces", () => {
    const q = {
      given: "Please",
      responseSuffix: ".",
      answerOrder: ["sit down", ",", "everyone"],
    };
    const out = renderResponseSentence(q);
    expect(out.correctSentenceFull).toBe("Please sit down, everyone.");
  });
});
