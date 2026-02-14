import { renderSentence } from "../lib/questionBank/renderSentence";

describe("renderSentence", () => {
  test("joins prompt tokens and blanks into a full sentence", () => {
    const promptTokens = [
      { t: "text", v: "you should" },
      { t: "blank" },
      { t: "given", v: "for the" },
      { t: "blank" },
      { t: "blank" },
      { t: "blank" },
    ];

    const out = renderSentence(promptTokens, ["sign up", "lab section", "online", "today"]);
    expect(out).toBe("you should sign up for the lab section online today");
  });

  test("handles punctuation spacing", () => {
    const promptTokens = [
      { t: "text", v: "please" },
      { t: "blank" },
      { t: "text", v: "," },
      { t: "text", v: "thanks" },
      { t: "text", v: "!" },
    ];

    const out = renderSentence(promptTokens, ["sit down"]);
    expect(out).toBe("please sit down, thanks!");
  });
});

