/**
 * buildRDLPrompt / buildShortRDLPrompt excludeSubjects injection.
 *
 * The nightly routine must not regenerate subjects that already exist in the
 * bank or the un-merged staging backlog. These builders take excludeSubjects
 * and inject a strong "do not write about" block; when the option is absent the
 * output must be unchanged (no block leaks in).
 */

const {
  buildRDLPrompt,
  buildShortRDLPrompt,
} = require("../lib/readingGen/rdlPromptBuilder.js");

const BLOCK_HEADER = "DO NOT WRITE ABOUT ANY OF THESE ALREADY-USED SUBJECTS/SCENARIOS";

describe("buildRDLPrompt excludeSubjects", () => {
  test("injects the exclusion block and every entry when provided", () => {
    const subjects = ["annual e-waste recycling drive", "campus 5k fun run saturday"];
    const prompt = buildRDLPrompt(2, { excludeSubjects: subjects });
    expect(prompt).toContain(BLOCK_HEADER);
    for (const s of subjects) expect(prompt).toContain(`- ${s}`);
    // The block precedes the items section it constrains.
    expect(prompt.indexOf(BLOCK_HEADER)).toBeLessThan(prompt.indexOf("## ITEMS TO GENERATE"));
  });

  test("omits the block entirely when excludeSubjects is empty / not passed", () => {
    expect(buildRDLPrompt(2, {})).not.toContain(BLOCK_HEADER);
    expect(buildRDLPrompt(2, { excludeSubjects: [] })).not.toContain(BLOCK_HEADER);
    expect(buildRDLPrompt(2)).not.toContain(BLOCK_HEADER);
  });

  test("backward compatible: no-exclude output keeps a single blank line before the items header", () => {
    const prompt = buildRDLPrompt(2, {});
    const idx = prompt.indexOf("## ITEMS TO GENERATE");
    expect(prompt.slice(idx - 2, idx)).toBe("\n\n"); // exactly one blank line, no stray whitespace
  });

  test("caps the rendered list at 40 entries", () => {
    const many = Array.from({ length: 60 }, (_, i) => `subject number ${i}`);
    const prompt = buildRDLPrompt(2, { excludeSubjects: many });
    expect(prompt).toContain("- subject number 0");
    expect(prompt).toContain("- subject number 39");
    expect(prompt).not.toContain("- subject number 40");
  });
});

describe("buildShortRDLPrompt excludeSubjects", () => {
  test("injects the exclusion block and every entry when provided", () => {
    const subjects = ["quick tutoring appointment room 204", "package pickup mailroom friday"];
    const prompt = buildShortRDLPrompt(4, { excludeSubjects: subjects });
    expect(prompt).toContain(BLOCK_HEADER);
    for (const s of subjects) expect(prompt).toContain(`- ${s}`);
    expect(prompt.indexOf(BLOCK_HEADER)).toBeLessThan(prompt.indexOf("## ITEMS TO GENERATE"));
  });

  test("omits the block entirely when excludeSubjects is empty / not passed", () => {
    expect(buildShortRDLPrompt(4, {})).not.toContain(BLOCK_HEADER);
    expect(buildShortRDLPrompt(4, { excludeSubjects: [] })).not.toContain(BLOCK_HEADER);
    expect(buildShortRDLPrompt(4)).not.toContain(BLOCK_HEADER);
  });

  test("backward compatible: no-exclude output keeps a single blank line before the items header", () => {
    const prompt = buildShortRDLPrompt(4, {});
    const idx = prompt.indexOf("## ITEMS TO GENERATE");
    expect(prompt.slice(idx - 2, idx)).toBe("\n\n");
  });
});
