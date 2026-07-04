const {
  postProcessRepeat,
  postProcessInterview,
  REPEAT_WORD_RANGES,
} = require("../lib/ai/prompts/questionExtraction");

// (a) postProcessRepeat: deterministic difficulty banding + word-count boundary rejection.
describe("postProcessRepeat", () => {
  test("assigns difficulty deterministically by word count (matches validator ranges)", () => {
    // easy: 4-7, medium: 8-12, hard: 13-20
    expect(postProcessRepeat({ sentence: "Printers are near the door." }).difficulty).toBe("easy"); // 5 words
    expect(
      postProcessRepeat({ sentence: "Please remember to bring your student card tomorrow." }).difficulty
    ).toBe("medium"); // 8 words
    expect(
      postProcessRepeat({
        sentence: "The library will close early on Friday because of the scheduled maintenance work.",
      }).difficulty
    ).toBe("hard"); // 13 words
  });

  test("is deterministic — same input yields same output", () => {
    const s = { sentence: "Please submit the form before the deadline." };
    expect(postProcessRepeat(s)).toEqual(postProcessRepeat(s));
  });

  test("backfills word_count and timing_seconds", () => {
    const out = postProcessRepeat({ sentence: "Printers are near the door." });
    expect(out.word_count).toBe(5);
    expect(out.timing_seconds).toBe(8); // easy timing
    expect(REPEAT_WORD_RANGES.easy).toBeDefined();
  });

  test("rejects sentences under 3 words", () => {
    const out = postProcessRepeat({ sentence: "Hi there" });
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/out of range 3-25/);
  });

  test("rejects sentences over 25 words", () => {
    const long = Array.from({ length: 30 }, () => "word").join(" ") + ".";
    const out = postProcessRepeat({ sentence: long });
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/out of range 3-25/);
  });

  test("rejects non-English (Chinese) content", () => {
    const out = postProcessRepeat({ sentence: "请把打印机放在门口附近的位置处。" });
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/not proper English/);
  });

  test("empty sentence is flagged invalid", () => {
    const out = postProcessRepeat({ sentence: "" });
    expect(out.invalid).toBe(true);
  });
});

// (a) postProcessInterview: word-count boundary rejection + backfill.
describe("postProcessInterview", () => {
  test("accepts a normal question and backfills word_count", () => {
    const q = "What kinds of technology do you use most often in your daily life these days?";
    const out = postProcessInterview({ question: q });
    expect(out.invalid).toBeUndefined();
    expect(out.word_count).toBe(15);
  });

  test("rejects questions under 10 words", () => {
    const out = postProcessInterview({ question: "Do you like coffee?" });
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/out of range 10-60/);
  });

  test("rejects questions over 60 words", () => {
    const long = "Why " + Array.from({ length: 65 }, () => "really").join(" ") + " important?";
    const out = postProcessInterview({ question: long });
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/out of range 10-60/);
  });

  test("rejects non-English content", () => {
    const out = postProcessInterview({ question: "你平时最常用哪些人工智能工具来帮助自己完成日常的学习和工作任务呢？" });
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/not proper English/);
  });
});
