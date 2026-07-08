"use strict";
/**
 * Proves the admin deploy gate (lib/gen/deployGate.js) judges like the nightly
 * pipeline instead of rubber-stamping — closing the §2.3 "同题不同判" bypass
 * (QUESTION-PIPELINE-REVIEW-2026-07-07): the deploy button used to re-number and
 * ship staging content with ZERO validation/dedup while the same batch would be
 * vetted by mergeClaude at night.
 *
 *   - BS: a strict-passing REAL bank set deploys cleanly onto an empty bank (the
 *     gate accepts what the nightly gate ships — this is the 同判 contract, and is
 *     why this file reads the real bank instead of synthesizing a 10-item set);
 *     the same set against the full bank is rejected wholesale as content-dup;
 *     garbage items are rejected by validateQuestion.
 *   - Disc/Email: schema-invalid rejected; exact dup (professor.text / scenario)
 *     rejected; near dup caught by the fuzzy layer; ids continue from the bank max.
 *   - The Disc/Email normalizers are exported from deployGate as the single source
 *     of truth (mergeClaude requires them from here — no hand-synced copies).
 */
const {
  vetBSDeploy,
  vetFlatDeploy,
  normalizeDiscItem,
  normalizeEmailItem,
} = require("../lib/gen/deployGate.js");
const { validateAllSets } = require("../scripts/validate-bank.js");

// ── BS: judged against the real bank (同判 contract) ─────────────────────────
describe("vetBSDeploy — same judgment as the nightly BS merge", () => {
  const bank = require("../data/buildSentence/questions.json");
  const sets = bank.question_sets;
  // Newest strict-passing set — guaranteed to exist because mergeClaude only ever
  // admits strict-passing sets (older hand-made sets may predate the strict gate).
  let goodSet = null;
  for (let i = sets.length - 1; i >= 0 && !goodSet; i--) {
    if (validateAllSets({ question_sets: [sets[i]] }, { strict: true }).ok) goodSet = sets[i];
  }

  test("a strict-passing real set deploys onto an empty bank with re-minted ids", () => {
    expect(goodSet).not.toBeNull();
    const r = vetBSDeploy([], [{ questions: goodSet.questions }]);
    expect(r.acceptedCount).toBe(1);
    expect(r.newSetIds).toEqual([1]);
    expect(r.addedQuestions).toBe(goodSet.questions.length);
    for (const [qi, q] of r.deploySets[0].questions.entries()) {
      expect(q.id).toBe(`ets_s1_q${qi + 1}`);
    }
  });

  test("re-deploying an already-banked set is rejected wholesale as content-dup", () => {
    const r = vetBSDeploy(sets, [{ questions: goodSet.questions }]);
    expect(r.acceptedCount).toBe(0);
    expect(r.rejected.some((x) => /content-dup/.test(x.reason))).toBe(true);
  });

  test("garbage items are rejected by validateQuestion, not shipped", () => {
    const r = vetBSDeploy([], [{ questions: [{ id: "x", prompt: "", answer: "" }] }]);
    expect(r.acceptedCount).toBe(0);
    expect(r.rejected.some((x) => /item invalid/.test(x.reason))).toBe(true);
  });
});

// ── Disc/Email: synthetic fixtures ───────────────────────────────────────────
const DISC_FIXTURE = {
  course: "Environmental Science",
  professor: {
    name: "Dr. Alvarez",
    text: "Cities around the world are debating whether to ban private cars from their downtown cores. What do you think is the strongest argument on either side of this debate?",
  },
  students: [
    { name: "Priya", text: "Banning cars would make downtown air cleaner and streets safer for pedestrians, so I support it." },
    { name: "Marcus", text: "Small businesses depend on customers who drive, so a ban could hurt the local economy badly." },
  ],
};

const EMAIL_FIXTURE = {
  topic: "校园学习",
  scenario: "You borrowed a projector from the media center for a class presentation, but when you set it up at home to rehearse, the power adapter was missing from the bag.",
  direction: "Write an email to Mr. Delgado. In your email, do the following:",
  goals: [
    "Explain when you borrowed the projector and what was missing",
    "Make clear that the bag was sealed when you received it",
    "Ask how you can get a replacement adapter before your presentation",
  ],
  to: "Mr. Delgado",
  subject: "Missing power adapter for borrowed projector",
};

describe("vetFlatDeploy — Discussion", () => {
  test("valid item deploys with a minted id continuing from the bank max", () => {
    const existing = [{ id: "ad7", course: "History", professor: { name: "Dr. B", text: "Something entirely unrelated about ancient trade routes and their cultural impact." }, students: [] }];
    const r = vetFlatDeploy("disc", existing, [DISC_FIXTURE]);
    expect(r.acceptedCount).toBe(1);
    expect(r.accepted[0].id).toBe("ad8");
  });

  test("schema-invalid item is rejected", () => {
    const r = vetFlatDeploy("disc", [], [{ course: "X" }]);
    expect(r.acceptedCount).toBe(0);
    expect(r.rejected[0].reason).toBe("schema_invalid");
  });

  test("exact professor-text duplicate is rejected", () => {
    const banked = { id: "ad1", ...normalizeDiscItem(DISC_FIXTURE) };
    const r = vetFlatDeploy("disc", [banked], [DISC_FIXTURE]);
    expect(r.acceptedCount).toBe(0);
    expect(r.rejected[0].reason).toBe("duplicate_professor_text");
    expect(r.rejected[0].matchId).toBe("ad1");
  });
});

describe("vetFlatDeploy — Email", () => {
  test("valid item deploys as em1 onto an empty bank", () => {
    const r = vetFlatDeploy("email", [], [EMAIL_FIXTURE]);
    expect(r.acceptedCount).toBe(1);
    expect(r.accepted[0].id).toBe("em1");
  });

  test("exact scenario duplicate is rejected", () => {
    const banked = { id: "em3", ...normalizeEmailItem(EMAIL_FIXTURE) };
    const r = vetFlatDeploy("email", [banked], [EMAIL_FIXTURE]);
    expect(r.acceptedCount).toBe(0);
    expect(r.rejected[0].reason).toBe("duplicate_scenario");
  });

  test("near-duplicate scenario (one-word edit) is caught by the fuzzy layer", () => {
    const banked = { id: "em3", ...normalizeEmailItem(EMAIL_FIXTURE) };
    const nearDup = { ...EMAIL_FIXTURE, scenario: EMAIL_FIXTURE.scenario.replace("projector", "camera") };
    const r = vetFlatDeploy("email", [banked], [nearDup]);
    expect(r.acceptedCount).toBe(0);
    expect(r.rejected[0].reason).toMatch(/^content_dup_/);
  });

  test("within-batch repeats are caught (check-then-add)", () => {
    const r = vetFlatDeploy("email", [], [EMAIL_FIXTURE, { ...EMAIL_FIXTURE }]);
    expect(r.acceptedCount).toBe(1);
    expect(r.rejected).toHaveLength(1);
  });
});
