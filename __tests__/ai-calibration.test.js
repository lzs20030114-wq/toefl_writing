import {
  calibrateScoreReport,
  hasClearStance,
  reasonSignalCount,
  shouldRaiseDiscussion2To3,
} from "../lib/ai/calibration";

describe("ai calibration helpers", () => {
  test("hasClearStance detects stance phrases", () => {
    expect(hasClearStance("I think this policy is useful.")).toBe(true);
    expect(hasClearStance("In my opinion, this is effective.")).toBe(true);
    expect(hasClearStance("This policy is useful.")).toBe(false);
  });

  test("reasonSignalCount counts reasoning markers", () => {
    const text =
      "I think this is useful because it saves time. Also, for example, students can plan better.";
    expect(reasonSignalCount(text)).toBeGreaterThanOrEqual(3);
  });
});

describe("calibrateScoreReport", () => {
  test("raises discussion score 2 -> 3 when guardrail conditions are met", () => {
    const result = {
      score: 2,
      band: 2.5,
      summary: "limited",
      patterns: [{ tag: "argument depth", count: 1, summary: "light support" }],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const text =
      "I think airplanes are the most important invention because they connect countries quickly. " +
      "Also, they improve business travel and family communication across long distances. " +
      "While other inventions are important, airplanes changed global mobility more directly. " +
      "For example, international students can now study abroad more easily. " +
      "In addition, medical teams can transport emergency supplies between regions in a matter of hours.";

    expect(shouldRaiseDiscussion2To3(result, text)).toBe(true);
    const out = calibrateScoreReport("discussion", result, text);
    expect(out.score).toBe(3);
    expect(out.band).toBe(3.5);
    expect(out.calibration.adjusted).toBe(true);
  });

  test("medium-quality discussion is capped at <= 4.0 and still has annotations", () => {
    const result = {
      score: 5,
      band: 5.5,
      summary: "good",
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const text =
      "I think students should learn online because it is convenient and flexible. " +
      "I think it is useful for many learners and it helps them save commuting time. " +
      "I think online learning is important for modern education.";

    const out = calibrateScoreReport("discussion", result, text);
    expect(out.score).toBeLessThanOrEqual(4.0);
    expect((out.annotationParsed?.annotations || []).length).toBeGreaterThanOrEqual(1);
  });

  test("near-top response keeps high score and includes blue annotation", () => {
    const result = {
      score: 5,
      band: 5.5,
      summary: "strong",
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const text =
      "I believe universities should prioritize project-based learning because it develops practical problem-solving skills. " +
      "For example, when students design a community energy plan, they must combine theory, data analysis, and teamwork. " +
      "In addition, this format improves motivation since students can see real outcomes from their work. " +
      "Therefore, project-based learning prepares students more effectively for professional collaboration.";

    const out = calibrateScoreReport("discussion", result, text);
    expect(out.score).toBeGreaterThanOrEqual(4.5);
    expect((out.annotationParsed?.annotations || []).some((a) => a.level === "blue")).toBe(true);
  });

  test("applies repetition penalty by 0.5", () => {
    const result = {
      score: 4.5,
      band: 5.0,
      summary: "ok",
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const text =
      "I think it is good because it supports long-term skill growth, and for example students can practice repeatedly with feedback. " +
      "I think it is helpful because students can revise quickly, and I think it is practical because teachers can monitor progress.\n\n" +
      "I think students improve communication and I think students gain confidence over time. " +
      "Also, I think students benefit from clear goals and I think students benefit from consistent routines.";
    const out = calibrateScoreReport("discussion", result, text);
    expect(out.score).toBe(4);
    expect(out.calibration.reasons).toContain("repetition_penalty");
  });
});
