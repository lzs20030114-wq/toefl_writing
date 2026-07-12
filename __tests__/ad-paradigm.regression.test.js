// Regression lock for the Discussion three-pools fix (2026-07-10).
//
// History: real 2026改后 items are far more formulaic than the bank assumed —
// student names come from exactly {Claire, Paul, Andrew, Kelly} (99% of 100
// real posts), professors from exactly {Dr. Gupta, Dr. Diaz, Dr. Achebe}, and
// student openers follow the "I believe/think" + "In my opinion" pairing. The
// bank ran a 50-name pool whose picker actively EXCLUDED Claire/Paul 65% of
// the time, invented professor surnames, grew an "I'm skeptical…" opener
// template (18%, real 0%), and leaked an off-list course (marine biology ×9)
// through a loose "pick a course" instruction.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

let mod;
beforeAll(async () => {
  mod = await import("../lib/ai/prompts/academicWriting.js");
});

describe("Discussion pools", () => {
  test("student name pool is exactly the real four-name pool", () => {
    expect([...mod.DISC_STUDENT_NAMES].sort()).toEqual(["Andrew", "Claire", "Kelly", "Paul"]);
  });

  test("system prompt pins the three real professor surnames and bans invention", () => {
    const sys = mod.buildDiscGenSystemPrompt();
    expect(sys).toMatch(/ONLY these three surnames: Dr\. Gupta/);
    expect(sys).not.toMatch(/don't reuse 2-3/);
  });

  test("system prompt carries the S1/S2 opener formula and bans the skeptic template", () => {
    const sys = mod.buildDiscGenSystemPrompt();
    expect(sys).toMatch(/Student 1 opens with "I believe/);
    expect(sys).toMatch(/In my opinion/);
    expect(sys).toMatch(/NEVER open with "I'm skeptical/);
  });

  test("course list carries the real signature courses", () => {
    for (const c of ["business ethics", "marketing", "anthropology", "educational psychology"]) {
      expect(mod.DISC_COURSE_LIST).toContain(c);
    }
    expect(mod.DISC_COURSE_LIST).not.toContain("marine biology");
  });

  test("the synthetic this_week template stays replaced by the real prototype", () => {
    const tw = mod.DISC_OPENING_STYLES.find((o) => o.style === "this_week");
    expect(tw.instruction).not.toMatch(/For this week's discussion, let's think about/);
    expect(tw.instruction).toMatch(/This week, we have been exploring/);
  });
});

describe("generation-path hygiene (source locks)", () => {
  test("pickStudentNames no longer excludes Claire/Paul", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts/generateDiscQuestions.mjs"), "utf8");
    expect(src).not.toMatch(/n !== "Claire" && n !== "Paul"/);
  });

  test("printDisc pins course to the allowed list and Dr. surnames in the output template", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts/print-bank-prompt.mjs"), "utf8");
    expect(src).toMatch(/MUST be EXACTLY one string from the ALLOWED COURSE LIST/);
    expect(src).not.toMatch(/"name":"Professor"/);
    expect(src).not.toMatch(/about 37% of real TPO does this/);
  });

  test("mergeClaude hard-rejects off-whitelist course/names/professor at accept time", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts/mergeClaude.mjs"), "utf8");
    expect(src).toMatch(/course_not_in_whitelist/);
    expect(src).toMatch(/student_name_not_in_pool/);
    expect(src).toMatch(/professor_name_not_in_pool/);
  });

  test("bank contains no off-list marine biology items and no literal-Professor names", () => {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, "data/academicWriting/prompts.json"), "utf8"));
    expect(list.filter((i) => /marine/i.test(i.course || "")).length).toBe(0);
    expect(list.filter((i) => (i.professor?.name || i.professor) === "Professor").length).toBe(0);
  });
});
