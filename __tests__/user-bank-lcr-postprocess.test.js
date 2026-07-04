const { postProcessLcr } = require("../lib/ai/prompts/questionExtraction");

// postProcessLcr: schema分档 for personal-bank LCR import (听力选择回应).
// One item = one question (speaker + 4 options + answer). Mirrors user-bank-reading-postprocess
// conventions. Answer may be null (verify 代解); speaker missing / options incomplete / bad answer
// letter → invalid with a Chinese reason. Audio is never produced here.
function base(over = {}) {
  return {
    speaker: "Where should I submit the revised essay by Friday?",
    options: { A: "The library closes early.", B: "It took all weekend.", C: "Just email it to me.", D: "No, the deadline is the same." },
    answer: "C",
    ...over,
  };
}

describe("postProcessLcr", () => {
  test("valid item → not invalid, answer normalized, defaults filled", () => {
    const out = postProcessLcr(base({ answer: "c" }));
    expect(out.invalid).toBeUndefined();
    expect(out.answer).toBe("C"); // lowercase normalized
    expect(out.context).toBeTruthy(); // default context filled
    expect(out.difficulty).toBe("medium");
    expect(out.answer_paradigm).toBeTruthy();
    expect(out.options.A).toBe("The library closes early.");
    // audio_url is never produced by the extractor.
    expect(out.audio_url).toBeUndefined();
  });

  test("null answer is ALLOWED (答案可缺，verify 代解)", () => {
    const out = postProcessLcr(base({ answer: null }));
    expect(out.invalid).toBeUndefined();
    expect(out.answer).toBeNull();
  });

  test("empty answer string → null, not invalid", () => {
    const out = postProcessLcr(base({ answer: "" }));
    expect(out.invalid).toBeUndefined();
    expect(out.answer).toBeNull();
  });

  test("missing speaker → invalid (引导手补口播句)", () => {
    const out = postProcessLcr(base({ speaker: "" }));
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/口播/);
  });

  test("non-ABCD answer → invalid", () => {
    const out = postProcessLcr(base({ answer: "Z" }));
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/答案/);
  });

  test("incomplete options → invalid (缺选项)", () => {
    const out = postProcessLcr(base({ options: { A: "a", B: "b", C: "", D: "d" } }));
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/选项/);
  });

  test("garbage input → invalid, never throws", () => {
    expect(() => postProcessLcr(null)).not.toThrow();
    expect(postProcessLcr(null).invalid).toBe(true);
    expect(postProcessLcr(undefined).invalid).toBe(true);
    expect(postProcessLcr("not an object").invalid).toBe(true);
  });

  test("profile warnings surface but never block a valid item", () => {
    // Missing explanation / distractor_types / paradigm → validateLCR profile warnings; must not invalidate.
    const out = postProcessLcr(base({ answer: "C" }));
    expect(out.invalid).toBeUndefined();
    // warnings is optional; when present it must be an array.
    if (out.warnings) expect(Array.isArray(out.warnings)).toBe(true);
  });
});
