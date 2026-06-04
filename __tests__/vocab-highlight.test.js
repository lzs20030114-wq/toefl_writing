import { getVocabTargetWord, splitForHighlight } from "../lib/reading/vocabHighlight";

describe("getVocabTargetWord", () => {
  test("extracts the quoted word from a vocab-in-context stem", () => {
    expect(
      getVocabTargetWord({
        question_type: "vocabulary_in_context",
        stem: 'The word "varies" in paragraph 1 is closest in meaning to',
      })
    ).toBe("varies");
  });

  test("handles a quoted phrase", () => {
    expect(getVocabTargetWord({ stem: 'The phrase "give up" in paragraph 2 means' })).toBe("give up");
  });

  test("prefers an explicit target_word field", () => {
    expect(getVocabTargetWord({ target_word: "surrender", stem: 'The word "x" ...' })).toBe("surrender");
  });

  test("returns null for non-vocab questions and bad input", () => {
    expect(getVocabTargetWord({ question_type: "factual_detail", stem: "According to paragraph 2, what happens to the air?" })).toBeNull();
    expect(getVocabTargetWord(null)).toBeNull();
    expect(getVocabTargetWord({})).toBeNull();
  });
});

describe("splitForHighlight", () => {
  test("splits whole-word, case-insensitive, preserving original casing", () => {
    const segs = splitForHighlight("Pressure varies with speed; it Varies a lot.", "varies");
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(["varies", "Varies"]);
    expect(segs.map((s) => s.text).join("")).toBe("Pressure varies with speed; it Varies a lot.");
  });

  test("does not match substrings", () => {
    const segs = splitForHighlight("The variable varies.", "vary");
    expect(segs.some((s) => s.hit)).toBe(false);
  });

  test("no target word → single non-hit segment", () => {
    expect(splitForHighlight("hello world", null)).toEqual([{ text: "hello world", hit: false }]);
  });

  test("round-trips the full passage text", () => {
    const text = "varies at the start and varies at the end varies";
    expect(splitForHighlight(text, "varies").map((s) => s.text).join("")).toBe(text);
  });
});
