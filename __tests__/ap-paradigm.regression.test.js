// Regression lock for the AP ending-template-collapse fix (2026-07-10).
//
// History: the prompt rule "NO conclusion/summary — end with a forward-looking
// LIMITATION move" was executed by the generator ~100% of the time, producing
// "However, …challenges remain" closers in 45.8% of bank passages vs 1.6% in
// the 64 real 2026改后 passages — the single loudest synthetic fingerprint in
// the reading bank. The fix rotates FIVE ending moves via hard per-item
// assignment (ENDING_MOVES deck), limitation held to ~20%.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { buildAPPrompt } = require("../lib/readingGen/apPromptBuilder.js");

describe("AP ending-move hard assignment", () => {
  test("every passage spec carries an assigned ending move", () => {
    const prompt = buildAPPrompt(5);
    const count = (prompt.match(/Ending move \(REQUIRED, follow exactly\):/g) || []).length;
    expect(count).toBe(5);
  });

  test("limitation assignment share stays ~20% (two-sided band, not 100%, not 0%)", () => {
    let limitation = 0, total = 0;
    for (let b = 0; b < 100; b++) {
      const prompt = buildAPPrompt(5);
      const specs = prompt.split("Ending move (REQUIRED, follow exactly):").slice(1);
      for (const s of specs) {
        total++;
        if (/^\s*End on ONE forward-looking limitation/.test(s)) limitation++;
      }
    }
    const share = limitation / total;
    expect(share).toBeGreaterThan(0.10);
    expect(share).toBeLessThan(0.35);
  });

  test("the mandatory-limitation rule stays deleted from the structure rules", () => {
    const src = fs.readFileSync(path.join(ROOT, "lib/readingGen/apPromptBuilder.js"), "utf8");
    expect(src).not.toMatch(/end with a forward-looking LIMITATION move/);
    expect(src).toMatch(/const ENDING_MOVES/);
  });
});

describe("apQuality scorer has teeth (source-mirrored detector)", () => {
  const lastSent = (t) => { const s = String(t || "").trim().split(/(?<=[.!?])\s+/); return s[s.length - 1] || ""; };
  test("scoreBatch carries the however-ending detector", () => {
    const src = fs.readFileSync(path.join(ROOT, "lib/quality/scoreBatch.mjs"), "utf8");
    expect(src).toMatch(/function apQuality/);
    expect(src).toMatch(/however-ending/);
  });
  test("detector separates however-enders from clean endings", () => {
    const bad = "Solar panels convert light into power. However, significant challenges remain unsolved.";
    const good = "Solar panels convert light into power. Researchers are continuously uncovering new materials that boost efficiency.";
    expect(/\bhowever\b/i.test(lastSent(bad))).toBe(true);
    expect(/\bhowever\b/i.test(lastSent(good))).toBe(false);
  });
});
