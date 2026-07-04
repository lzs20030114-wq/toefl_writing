const {
  postProcessBuild,
  validateBuildForImport,
} = require("../lib/ai/prompts/questionExtraction");

// Helper: run the same pipeline the extract routes run for the build branch.
function importBuild(raw) {
  return validateBuildForImport(postProcessBuild(raw));
}

// A well-formed TPO 3-part build question. answer = "You can study there until midnight now."
// chunks(minus distractor "did") + prefilled "You" == answer words.
function goodQuestion(overrides = {}) {
  return {
    prompt: "Is the reading room open again?",
    answer: "You can study there until midnight now.",
    chunks: ["can study", "there until", "midnight", "now", "did"],
    prefilled: ["You"],
    distractor: "did",
    grammar_points: ["present simple"],
    ...overrides,
  };
}

// ── (a) distractor word-bag difference inference ──
describe("validateBuildForImport — distractor inference (code over AI)", () => {
  test("keeps a correct distractor and marks the question valid", () => {
    const out = importBuild(goodQuestion());
    expect(out.invalid).toBeUndefined();
    expect(out.distractor).toBe("did");
  });

  test("overrides the AI's wrong distractor with the code-derived one", () => {
    // "did" is the true leftover (chunks∪prefilled − answer), but the AI claimed "now".
    const out = importBuild(goodQuestion({ distractor: "now" }));
    expect(out.invalid).toBeUndefined();
    expect(out.distractor).toBe("did"); // code wins
  });

  test("nulls out a hallucinated distractor when every tile is used", () => {
    // No extra tile: chunks all appear in the answer, no distractor tile present.
    const out = importBuild({
      prompt: "Is the reading room open again?",
      answer: "You can study there until midnight now.",
      chunks: ["can study", "there until", "midnight", "now"],
      prefilled: ["You"],
      distractor: "did", // AI hallucinated — no leftover tile exists
      grammar_points: ["present simple"],
    });
    expect(out.invalid).toBeUndefined();
    expect(out.distractor).toBeNull();
  });

  test("marks invalid when leftover is >1 word (tiles & answer don't line up)", () => {
    // Two extra words ("did", "really") beyond the answer → can't reconcile.
    const out = importBuild(goodQuestion({
      chunks: ["can study", "there until", "midnight", "now", "did", "really"],
      distractor: "did",
    }));
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/词块与答案对不上/);
  });

  test("marks invalid when the single leftover word is not a standalone chunk", () => {
    // Leftover word "really" is buried inside a multi-word chunk, not its own tile.
    const out = importBuild({
      prompt: "Is the reading room open again?",
      answer: "You can study there until midnight now.",
      chunks: ["can study", "there until", "midnight really", "now"],
      prefilled: ["You"],
      distractor: null,
      grammar_points: ["present simple"],
    });
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/词块与答案对不上/);
  });
});

// ── (b) schema fatal gate ──
describe("validateBuildForImport — schema fatal gate", () => {
  test("marks invalid when a fatal schema error remains (bad word-bag)", () => {
    // answer has a word ("tomorrow") that no tile supplies → chunks+prefilled != answer fatal.
    const out = importBuild({
      prompt: "When are you free?",
      answer: "I can meet you tomorrow afternoon here.",
      chunks: ["can meet", "you", "afternoon", "here"],
      prefilled: ["I"],
      distractor: null,
      grammar_points: ["modal"],
    });
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/未通过|对不上/);
  });

  test("format-level issues (short answer) are warnings, not blocking", () => {
    // Uses the known-good conversational prompt (passes the dialogue/contract fatals) with a
    // 5-word answer that only trips the format-level "answer word count 7-15" — NOT fatal.
    const out = importBuild({
      prompt: "Is the reading room open again?",
      answer: "You can study there now.",
      chunks: ["can study", "there", "now", "did"],
      prefilled: ["You"],
      distractor: "did",
      grammar_points: ["present simple"],
    });
    expect(out.invalid).toBeUndefined();
    expect(Array.isArray(out.warnings)).toBe(true);
    expect(out.warnings.join(" ")).toMatch(/answer word count/);
  });
});

// Sanity: does not throw on garbage input, degrades gracefully.
describe("validateBuildForImport — robustness", () => {
  test("never throws; empty/garbage input degrades to invalid", () => {
    expect(() => validateBuildForImport({})).not.toThrow();
    const out = validateBuildForImport({ chunks: [], prefilled: [], answer: "" });
    expect(out.invalid).toBe(true);
  });
});
