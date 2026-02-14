const { renderResponseSentence } = require("../lib/questionBank/renderResponseSentence");

describe("renderResponseSentence", () => {
  test("renders complete correct/user response sentences", () => {
    const q = {
      given: "Could you",
      givenIndex: 2,
      responseSuffix: "?",
      answerOrder: ["send me", "the slides", "after class", "today"],
    };
    const out = renderResponseSentence(q, ["send me", "the slides", "today", "after class"]);
    expect(out.correctSentenceFull).toBe("Send me the slides Could you after class today?");
    expect(out.userSentenceFull).toBe("Send me the slides Could you today after class?");
  });

  test("fixes punctuation spacing and collapses double spaces", () => {
    const q = {
      given: "Please",
      givenIndex: 0,
      responseSuffix: ".",
      answerOrder: ["sit down", ",", "everyone"],
    };
    const out = renderResponseSentence(q);
    expect(out.correctSentenceFull).toBe("Please sit down, everyone.");
  });
});
