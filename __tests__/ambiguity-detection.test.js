const { hasAmbiguousArrangements } = require("../lib/questionBank/runtimeModel");

describe("hasAmbiguousArrangements", () => {
  test("returns false for a clean question with no ambiguity signals", () => {
    const rq = {
      answerOrder: ["the professor", "explained", "why", "the experiment", "had failed"],
      bank: ["the professor", "explained", "why", "the experiment", "had failed"],
    };
    expect(hasAmbiguousArrangements(rq)).toBe(false);
  });

  test("returns false when answerOrder has more than 8 chunks (too complex to heuristic)", () => {
    const rq = {
      answerOrder: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      bank: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
    };
    expect(hasAmbiguousArrangements(rq)).toBe(false);
  });

  test("returns true when bank has duplicate chunks", () => {
    const rq = {
      answerOrder: ["to", "the lab", "and", "to", "the office"],
      bank: ["to", "the lab", "and", "to", "the office"],
    };
    expect(hasAmbiguousArrangements(rq)).toBe(true);
  });

  test("returns true with many prepositional-start chunks", () => {
    const rq = {
      answerOrder: ["she went", "to the store", "for groceries", "in the morning", "with her friend"],
      bank: ["she went", "to the store", "for groceries", "in the morning", "with her friend"],
    };
    // 4 prep starts: to, for, in, with → (4-1)*0.12 = 0.36, base 0.05, total 0.41 > 0.35
    expect(hasAmbiguousArrangements(rq)).toBe(true);
  });

  test("returns false with only one prepositional-start chunk", () => {
    const rq = {
      answerOrder: ["she went", "to the store", "yesterday"],
      bank: ["she went", "to the store", "yesterday"],
    };
    expect(hasAmbiguousArrangements(rq)).toBe(false);
  });

  test("handles missing/null input gracefully", () => {
    expect(hasAmbiguousArrangements(null)).toBe(false);
    expect(hasAmbiguousArrangements(undefined)).toBe(false);
    expect(hasAmbiguousArrangements({})).toBe(false);
  });

  test("many single function-word chunks increase ambiguity score", () => {
    const rq = {
      answerOrder: ["the", "is", "a", "to", "of", "and"],
      bank: ["the", "is", "a", "to", "of", "and"],
    };
    // 6 function words → (6-3)*0.05 = 0.15, base 0.05, prep "to" = 0, total 0.20 < 0.35
    // Plus "to" is prep start: (1-1)*0.12 = 0, still 0.20 — not ambiguous alone
    expect(hasAmbiguousArrangements(rq)).toBe(false);
  });
});
