// Regression lock for the Speaking Listen&Repeat paradigm fixes (2026-07-09/10).
//
// History: two rounds of fixes. Round 1 (2026-05-31) killed the synthetic tells
// (yes/no questions, punitive threats, rigid 2/3/2 staircase); round 2
// (2026-07-09) restored the real-exam variety the first round over-suppressed
// (Welcome openers ~16%, walkthrough flow, 18-word cap). The bank purged all
// pre-recalibration sets. This test locks the builder mechanics and the
// scoreBatch guard so neither round silently rots.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { buildRepeatPrompt } = require("../lib/speakingGen/repeatPromptBuilder.js");
const { validateRepeatSet } = require("../lib/speakingGen/speakingValidator.js");

describe("repeat builder mechanics", () => {
  test("per-set flow assignment exists and at most one set per batch greets", () => {
    for (let b = 0; b < 100; b++) {
      const { prompt } = buildRepeatPrompt(3);
      const welcomes = (prompt.match(/allowed to greet/g) || []).length;
      expect(welcomes).toBeLessThanOrEqual(1);
      expect(prompt).toMatch(/Set type & flow:/);
    }
  });

  test("welcome-flow share stays in the real band (~16%, two-sided)", () => {
    let welcome = 0, total = 0;
    for (let b = 0; b < 300; b++) {
      const { prompt } = buildRepeatPrompt(3);
      const specs = prompt.split("Set type & flow:").slice(1);
      for (const s of specs) {
        total++;
        if (/Open with a short greeting/.test(s)) welcome++;
      }
    }
    const share = welcome / total;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.25);
  });

  test("hard word cap is 18 (real max 17-18; monitor scores 3-18)", () => {
    const { STRUCTURE_RULES } = require("../lib/speakingGen/repeatPromptBuilder.js");
    expect(STRUCTURE_RULES.hard.word_range[1]).toBe(18);
  });
});

describe("validator guards", () => {
  const set = (sentences) => ({
    id: "rpt_test_001",
    scenario: "Library",
    speaker_role: "librarian",
    sentences: sentences.map((s, i) => ({ id: `s${i}`, sentence: s, difficulty: i < 2 ? "easy" : i < 6 ? "medium" : "hard" })),
  });

  test("flags questions and punitive threats (0/351 in real)", () => {
    const r = validateRepeatSet(set([
      "Do you have your card?",
      "Late returns will result in suspension of your privileges.",
      "Books are shelved along this wall.",
      "You can renew items online before the due date.",
      "Quiet zones stay open until midnight.",
      "Reference desks sit on the second floor.",
      "If you cannot find a title, check the floor map near the stairs.",
    ]));
    const w = r.warnings.join(" | ");
    expect(w).toMatch(/question_mark/);
    expect(w).toMatch(/punitive_warning/);
  });

  test("no longer warns on real-shaped medium-dominant signatures (2/4/1)", () => {
    const r = validateRepeatSet(set([
      "Printers are located near the entrance.",
      "Check your inbox for new messages.",
      "We can replace your laptop charger at the front counter.",
      "Software updates are installed automatically every Friday evening.",
      "The digital catalog can be accessed from any campus computer.",
      "You will need to restart your device after the update is done.",
      "If you are unsure how to connect, check the help guide posted by the main desk.",
    ]));
    expect(r.warnings.join(" | ")).not.toMatch(/difficulty_distribution/);
  });

  test("bank carries no pre-recalibration fingerprints", () => {
    const bank = JSON.parse(fs.readFileSync(path.join(ROOT, "data/speaking/bank/repeat.json"), "utf8"));
    const all = bank.items.flatMap((it) => it.sentences.map((s) => s.sentence));
    expect(all.filter((t) => /\?/.test(t)).length).toBe(0);
    expect(all.filter((t) => /(will result in|suspension of|incur a|penalt|violation)/i.test(t)).length).toBe(0);
  });
});
