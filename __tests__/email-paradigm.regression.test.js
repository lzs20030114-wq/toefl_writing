// Regression lock for the Email prompt-paradigm completion (2026-07-10).
//
// History: the 2026-05-31 recalibration fixed recipient forms + dangling refs
// but left the scenario-opener table, verb table, and subject rule at their
// pre-calibration values (13-item old-TPO stats). Result: 36% of bank
// scenarios opened with forms that occur 0 times in the 51 real prompts
// ("You signed up…", third-person setups), Ask was 2.3× over-used while
// Inquire was absent, and subject lines ran 6.7 words vs the real 4.1.
//
// This test locks the hard per-call opener assignment, the slot-3 action-verb
// assignment, the Tell ban, and the subject-line rule.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

let mod;
beforeAll(async () => {
  mod = await import("../lib/ai/prompts/emailWriting.js");
});

describe("Email scenario-opener hard assignment", () => {
  test("every prompt carries exactly one REQUIRED opening from the four real forms", () => {
    const prompt = mod.buildEmailGenPrompt(mod.EMAIL_CATEGORIES[0]);
    expect(prompt).toMatch(/REQUIRED opening \(follow exactly/);
    expect(prompt).toMatch(/Open the scenario with "(You are|You recently|Your |You and your )/);
  });

  test("opener distribution matches the real-exam mix (You-are ~49%, two-sided band)", () => {
    let youAre = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const prompt = mod.buildEmailGenPrompt(mod.EMAIL_CATEGORIES[i % mod.EMAIL_CATEGORIES.length]);
      if (/Open the scenario with "You are…"/.test(prompt)) youAre++;
    }
    const share = youAre / N;
    expect(share).toBeGreaterThan(0.38);
    expect(share).toBeLessThan(0.60);
  });

  test("the dead buckets (You-other-verb / third-person) stay deleted", () => {
    const prompt = mod.buildEmailGenPrompt(mod.EMAIL_CATEGORIES[0]);
    expect(prompt).not.toMatch(/You \[other verb\]/);
    expect(prompt).not.toMatch(/Third-person \/ passive/);
    expect(prompt).toMatch(/NEVER open with "You signed up/);
  });
});

describe("Email goal-verb and subject rules", () => {
  test("slot-3 action verb is assigned from the real action set; Tell is banned", () => {
    for (let i = 0; i < 50; i++) {
      const prompt = mod.buildEmailGenPrompt(mod.EMAIL_CATEGORIES[0]);
      const m = prompt.match(/start it with: (\w+)/);
      expect(m).toBeTruthy();
      expect(["Suggest", "Request", "Inquire", "Ask"]).toContain(m[1]);
      expect(prompt).toMatch(/NEVER use "Tell"/);
    }
  });

  test("subject rule demands a 2-5 word noun phrase", () => {
    const prompt = mod.buildEmailGenPrompt(mod.EMAIL_CATEGORIES[0]);
    expect(prompt).toMatch(/SHORT noun phrase of 2-5 words/);
  });

  test("Services & Events keeps the dominant weight (real exam ~59% services/leisure)", () => {
    const g = mod.EMAIL_CATEGORIES.find((c) => c.key === "G");
    expect(g.weight).toBeGreaterThanOrEqual(0.5);
  });
});

describe("merge-path hard reject (production layer)", () => {
  test("mergeClaude rejects bad recipient forms at accept time", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts/mergeClaude.mjs"), "utf8");
    expect(src).toMatch(/recipient_form/);
    expect(src).toMatch(/EMAIL_RECIPIENT_OK/);
  });
});

describe("bank hygiene", () => {
  test("no bare-organization recipients remain in the live bank", () => {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, "data/emailWriting/prompts.json"), "utf8"));
    const ok = (r) => /^(mr|ms|mrs|dr|prof(essor)?)\.?\s+[A-Z]/i.test(r) || /^[A-Z][a-z]+$/.test(r);
    const bad = list.filter((i) => i.to && !ok(i.to)).map((i) => `${i.id}:${i.to}`);
    expect(bad).toEqual([]);
  });
});
