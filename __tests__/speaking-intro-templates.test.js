/**
 * Unit locks for the Speaking intro-narration templates (2026-07-16).
 * The paradigm is distilled verbatim from 27 real-exam sets — see
 * data/claudeGen/reports/SPEAKING-INTRO-PARADIGM-2026-07-16.md.
 */
import {
  buildRepeatIntro,
  buildInterviewIntro,
  normalizePlace,
  INTERVIEW_LOGISTICS,
  SPEAKING_SECTION_NARRATION,
  INTERVIEW_TASK_NARRATION,
} from "../lib/speakingGen/introTemplates";

describe("buildRepeatIntro", () => {
  test("manager rule: instruction repeats the NOUN, never a pronoun", () => {
    const r = buildRepeatIntro({
      id: "rpt_dining_001",
      scenario: "Dining Hall Tour",
      speaker_role: "dining services manager",
    });
    expect(r.instructionText).toBe(
      "Listen to the manager and repeat what the manager says. Repeat only once.",
    );
    expect(r.settingText.toLowerCase()).toContain("manager");
    // No he/she pronoun leaked into the manager instruction.
    expect(/\b(he|she)\b/i.test(r.instructionText)).toBe(false);
  });

  test('"manager" match is case-insensitive and substring-based (e.g. "Station Manager")', () => {
    const r = buildRepeatIntro({ id: "x", scenario: "Campus Radio Station", speaker_role: "Station Manager" });
    expect(r.instructionText).toMatch(/Listen to the manager and repeat what the manager says\./);
  });

  test("deterministic: same id+scenario always yields the same intro", () => {
    const args = { id: "rpt_1780329446_017", scenario: "Library Orientation", speaker_role: "librarian" };
    const a = buildRepeatIntro(args);
    const b = buildRepeatIntro(args);
    expect(a).toEqual(b);
  });

  test("id drives the trainer/speaker + he/she split — both variants occur across ids", () => {
    let trainer = 0, speaker = 0, he = 0, she = 0;
    for (let i = 0; i < 200; i++) {
      const r = buildRepeatIntro({ id: `set_${i}`, scenario: "Library Orientation", speaker_role: "librarian" });
      if (/your trainer/.test(r.instructionText)) trainer++;
      if (/the speaker/.test(r.instructionText)) speaker++;
      if (/what he says/.test(r.instructionText)) he++;
      if (/what she says/.test(r.instructionText)) she++;
    }
    expect(trainer).toBeGreaterThan(0);
    expect(speaker).toBeGreaterThan(0);
    expect(he).toBeGreaterThan(0);
    expect(she).toBeGreaterThan(0);
    // Every set is either trainer or speaker (mutually exclusive, exhaustive).
    expect(trainer + speaker).toBe(200);
  });

  test("missing scenario/speaker_role → documented generic fallback", () => {
    const r = buildRepeatIntro({});
    expect(r.settingText).toBe("You are being trained to assist visitors.");
    expect(r.instructionText).toBe("Listen to your trainer and repeat what he says. Repeat only once.");
  });

  test("undefined argument object does not throw and still falls back", () => {
    expect(() => buildRepeatIntro()).not.toThrow();
    const r = buildRepeatIntro();
    expect(r.instructionText).toContain("Repeat only once.");
  });

  test('"Repeat only once." is always the fixed tail', () => {
    const scenarios = ["IT Help Desk", "Bike Tire Repair (how-to)", "Grocery Store Help", "", "Planetarium Visit"];
    for (const scenario of scenarios) {
      for (let i = 0; i < 20; i++) {
        const r = buildRepeatIntro({ id: `${scenario}_${i}`, scenario, speaker_role: "guide" });
        expect(r.instructionText.endsWith("Repeat only once.")).toBe(true);
      }
    }
  });

  test("place is naturalized into the setting sentence (abbreviations preserved)", () => {
    // Force a non-manager path; the place appears in the setting sentence.
    const r = buildRepeatIntro({ id: "seed-place", scenario: "IT Help Desk", speaker_role: "IT support technician" });
    expect(r.settingText).toContain("IT help desk");
  });
});

describe("normalizePlace", () => {
  test("lower-cases words, preserves known abbreviations, strips (how-to)", () => {
    expect(normalizePlace("IT Help Desk")).toBe("IT help desk");
    expect(normalizePlace("Botanical Garden Tour")).toBe("botanical garden tour");
    expect(normalizePlace("Bike Tire Repair (how-to)")).toBe("bike tire repair");
    expect(normalizePlace("")).toBe("");
    expect(normalizePlace(null)).toBe("");
  });
});

describe("buildInterviewIntro", () => {
  test("intro present → setting is the bank intro + fixed logistics", () => {
    const intro = "You have agreed to participate in a survey about time management strategies.";
    const r = buildInterviewIntro({ intro });
    expect(r.settingText).toBe(intro);
    expect(r.logisticsText).toBe(INTERVIEW_LOGISTICS);
    expect(r.logisticsText).toBe(
      "You will have a short online interview with a researcher. The researcher will ask you some questions.",
    );
  });

  test("intro missing → generic setting + logistics, no throw", () => {
    expect(() => buildInterviewIntro()).not.toThrow();
    const r = buildInterviewIntro({});
    expect(r.settingText).toBe("You have agreed to participate in a short research interview.");
    expect(r.logisticsText).toBe(INTERVIEW_LOGISTICS);
  });
});

describe("task-level narration constants are verbatim real-exam", () => {
  test("speaking-section narration", () => {
    expect(SPEAKING_SECTION_NARRATION).toContain(
      "Speaking section. In the speaking section, you will answer 11 questions",
    );
    expect(SPEAKING_SECTION_NARRATION).toContain("Listen and repeat.");
    expect(SPEAKING_SECTION_NARRATION).toContain("No time for preparation will be provided.");
  });

  test("interview-task narration", () => {
    expect(INTERVIEW_TASK_NARRATION).toContain("Take an interview. An interviewer will ask you questions.");
    expect(INTERVIEW_TASK_NARRATION).toContain("say as much as you can in the time allowed");
  });
});
