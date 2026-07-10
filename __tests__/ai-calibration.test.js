import {
  calibrateScoreReport,
  calibrateDiscussion,
} from "../lib/ai/calibration";

const LONG_ENOUGH_TEXT =
  "While I acknowledge Claire's viewpoint, I remain aligned with Andrew's position on this matter. " +
  "This approach offers significant advantages for students in terms of skill development. " +
  "By focusing on practical applications, students gain valuable experience that directly applies to their future careers. " +
  "Furthermore, this method encourages critical thinking and collaborative problem-solving in real-world contexts. " +
  "To illustrate, students working on group projects must negotiate, plan, and deliver results under time constraints.";

describe("calibrateDiscussion (signal-driven)", () => {
  test("caps discussion at 4 when AI signals has_example=false", () => {
    const result = {
      score: 5,
      signals: { stance_clear: true, has_example: false, engages_discussion: true },
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const out = calibrateScoreReport("discussion", result, LONG_ENOUGH_TEXT);
    expect(out.score).toBeLessThanOrEqual(4);
    expect(out.calibration.reasons).toContain("ai_no_example_cap");
  });

  test("caps discussion at 3 when AI signals stance_clear=false", () => {
    const result = {
      score: 4.5,
      signals: { stance_clear: false, has_example: true, engages_discussion: true },
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const out = calibrateScoreReport("discussion", result, LONG_ENOUGH_TEXT);
    expect(out.score).toBeLessThanOrEqual(3);
    expect(out.calibration.reasons).toContain("ai_no_stance");
  });

  test("template-style stance 'I remain aligned with' is not penalized", () => {
    const result = {
      score: 4.5,
      signals: { stance_clear: true, has_example: true, engages_discussion: true },
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const out = calibrateScoreReport("discussion", result, LONG_ENOUGH_TEXT);
    expect(out.score).toBeGreaterThanOrEqual(4.5);
    expect(out.calibration.adjusted).toBe(false);
  });

  test("caps at 2 when word count < 60", () => {
    const result = {
      score: 5,
      signals: { stance_clear: true, has_example: true, engages_discussion: true },
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const shortText = "I agree with Andrew. Learning is important.";
    const out = calibrateScoreReport("discussion", result, shortText);
    expect(out.score).toBeLessThanOrEqual(2);
    expect(out.calibration.reasons).toContain("word_count_floor");
  });
});

describe("email goals-based guardrails", () => {
  // >50 words, service/leisure register, deliberately full of the polite
  // phrases the OLD hard-coded caps used to punish ("really enjoyed",
  // "thank you for your time", ...).
  const HOTEL_FEEDBACK_EMAIL =
    "Dear Mr. Rodriguez,\n" +
    "I recently stayed at your hotel and I really enjoyed the breakfast and the friendly staff, which left a strong impression on me. " +
    "However, the air conditioner in my room was very loud at night, so I could not sleep well during my three-night stay. " +
    "I would like to ask if you could have it inspected, and I would suggest offering guests earplugs at the front desk in the meantime. " +
    "Thank you for your time and attention.\n" +
    "Sincerely,\nLisa";

  const rubric = (task, org, lang) => ({
    dimensions: {
      task_fulfillment: { score: task },
      organization_coherence: { score: org },
      language_use: { score: lang },
    },
  });

  const goalList = (...statuses) =>
    statuses.map((status, i) => ({ index: i + 1, status, reason: "" }));

  test("well-written email with polite template phrases is NOT capped (old phrase-list regression)", () => {
    const result = {
      score: 4.5,
      rubric: rubric(5, 4.5, 4),
      goals: goalList("OK", "OK", "OK"),
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const out = calibrateScoreReport("email", result, HOTEL_FEEDBACK_EMAIL);
    expect(out.calibration.adjusted).toBe(false);
    expect(out.score).toBe(4.5);
  });

  test("a MISSING goal caps the score at 3", () => {
    const result = {
      score: 4.5,
      rubric: rubric(5, 5, 4),
      goals: goalList("OK", "MISSING", "OK"),
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const out = calibrateScoreReport("email", result, HOTEL_FEEDBACK_EMAIL);
    expect(out.score).toBeLessThanOrEqual(3);
    expect(out.calibration.reasons).toContain("email_goal_missing_cap");
  });

  test("two PARTIAL goals cap the score at 3", () => {
    const result = {
      score: 4.5,
      rubric: rubric(5, 5, 4),
      goals: goalList("OK", "PARTIAL", "PARTIAL"),
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const out = calibrateScoreReport("email", result, HOTEL_FEEDBACK_EMAIL);
    expect(out.score).toBeLessThanOrEqual(3);
    expect(out.calibration.reasons).toContain("email_goals_partial_cap");
  });

  test("one PARTIAL goal caps the score at 4", () => {
    const result = {
      score: 5,
      rubric: rubric(5, 5, 4.5),
      goals: goalList("OK", "PARTIAL", "OK"),
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const out = calibrateScoreReport("email", result, HOTEL_FEEDBACK_EMAIL);
    expect(out.score).toBeLessThanOrEqual(4);
    expect(out.calibration.reasons).toContain("email_goal_partial_cap");
  });

  test("thin response still caps at 3", () => {
    const result = {
      score: 4.5,
      rubric: rubric(5, 5, 4),
      goals: goalList("OK", "OK", "OK"),
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const out = calibrateScoreReport("email", result, "Dear Sir, please fix my heater soon. Thanks, Lisa");
    expect(out.score).toBeLessThanOrEqual(3);
    expect(out.calibration.reasons).toContain("email_thin_response_cap");
  });
});

describe("holistic reconciliation (lift)", () => {
  const rubric = (task, org, lang) => ({
    dimensions: {
      task_fulfillment: { score: task },
      organization_coherence: { score: org },
      language_use: { score: lang },
    },
  });

  test("holistic above weighted lifts final by at most half a band", () => {
    // weighted = 4.5*0.4 + 4*0.3 + 4*0.3 = 4.2; holistic 5 → min(5, 4.7) → 4.5
    const result = {
      score: 5,
      rubric: rubric(4.5, 4, 4),
      signals: { stance_clear: true, has_example: true, engages_discussion: true },
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const out = calibrateScoreReport("discussion", result, LONG_ENOUGH_TEXT);
    expect(out.score).toBe(4.5);
    expect(out.calibration.reasons).toContain("holistic_lift");
  });

  test("holistic below weighted never drags the score down", () => {
    const result = {
      score: 3,
      rubric: rubric(4, 4, 4),
      signals: { stance_clear: true, has_example: true, engages_discussion: true },
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const out = calibrateScoreReport("discussion", result, LONG_ENOUGH_TEXT);
    expect(out.score).toBe(4);
    expect(out.calibration.reasons).not.toContain("holistic_lift");
  });

  test("guardrail caps still beat the lift (discussion stance)", () => {
    const result = {
      score: 5,
      rubric: rubric(4.5, 4, 4),
      signals: { stance_clear: false, has_example: true, engages_discussion: true },
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const out = calibrateScoreReport("discussion", result, LONG_ENOUGH_TEXT);
    expect(out.score).toBeLessThanOrEqual(3);
  });

  test("guardrail caps still beat the lift (email missing goal)", () => {
    const result = {
      score: 5,
      rubric: rubric(4.5, 4, 4),
      goals: [
        { index: 1, status: "OK", reason: "" },
        { index: 2, status: "MISSING", reason: "" },
        { index: 3, status: "OK", reason: "" },
      ],
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const out = calibrateScoreReport(
      "email",
      result,
      "Dear Mr. Lee, I am writing about the gym schedule change that affected my training plan this month. The new opening hours conflict directly with my work schedule, so I can no longer train before my shift starts in the morning. I would like to ask whether an earlier opening time could be considered for weekdays, or whether members could receive a temporary discount. Thank you for your attention. Best regards, Lisa"
    );
    expect(out.score).toBeLessThanOrEqual(3);
    expect(out.calibration.reasons).toContain("email_goal_missing_cap");
  });
});

describe("calibrateScoreReport", () => {
  test("near-top response keeps high score and includes blue annotation", () => {
    const result = {
      score: 5,
      band: 5.5,
      summary: "strong",
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const text =
      "I believe universities should prioritize project-based learning because it develops practical problem-solving skills that are essential in the modern workplace. " +
      "For example, when students design a community energy plan, they must combine theory, data analysis, and teamwork to produce a viable solution. " +
      "In addition, this format improves motivation since students can see real outcomes from their work and receive meaningful feedback. " +
      "Therefore, project-based learning prepares students more effectively for professional collaboration and long-term career success.";

    const out = calibrateScoreReport("discussion", result, text);
    expect(out.score).toBeGreaterThanOrEqual(4.5);
    expect((out.annotationParsed?.annotations || []).some((a) => a.level === "blue")).toBe(true);
  });

  test("builds compact key_problems with explanation, example, and action", () => {
    const result = {
      score: 3,
      band: 3.5,
      summary: "needs work",
      patterns: [],
      annotationParsed: {
        plainText: "I receive your feedback yesterday. This idea is good for many things.",
        annotations: [
          { level: "red", message: "Verb tense is incorrect.", fix: "Use past tense: received.", start: 0, end: 31 },
          { level: "orange", message: "This is too vague.", fix: "Add one concrete detail.", start: 33, end: 70 },
        ],
      },
    };
    const out = calibrateScoreReport("email", result, result.annotationParsed.plainText);
    expect(Array.isArray(out.key_problems)).toBe(true);
    expect(out.key_problems.length).toBeGreaterThanOrEqual(1);
    expect(out.key_problems.length).toBeLessThanOrEqual(3);
    out.key_problems.forEach((p) => {
      expect(typeof p.explanation).toBe("string");
      expect(p.explanation.length).toBeGreaterThan(0);
      expect(typeof p.example).toBe("string");
      expect(p.example.length).toBeGreaterThan(0);
      expect(typeof p.action).toBe("string");
      expect(p.action.length).toBeGreaterThan(0);
    });
    expect(out.score_confidence).toBeTruthy();
    expect(Array.isArray(out.score_confidence.reliable_aspects)).toBe(true);
    expect(out.score_confidence.reliable_aspects.length).toBeGreaterThan(0);
    expect(Array.isArray(out.score_confidence.uncertain_aspects)).toBe(true);
    expect(out.score_confidence.uncertain_aspects.length).toBeGreaterThan(0);
  });

  test("does not force low confidence when response is long and signals are reliable", () => {
    const result = {
      score: 4.5,
      band: 5.0,
      summary: "strong",
      patterns: [],
      annotationParsed: { plainText: "", annotations: [] },
    };
    const text =
      "I believe universities should expand internship-based courses because students need direct exposure to workplace expectations. " +
      "For example, business students who collaborate with local companies can apply classroom models to real budgeting decisions. " +
      "In addition, supervisors can provide targeted feedback that improves communication and decision-making under time pressure. " +
      "Therefore, internship-based learning creates a stronger bridge between academic knowledge and practical performance. " +
      "This structure also helps students identify skill gaps earlier and improve before they enter full-time positions.";

    const out = calibrateScoreReport("discussion", result, text);
    expect(Array.isArray(out.key_problems)).toBe(true);
    expect(out.key_problems.length).toBe(0);
    expect(out.confidence_state).toBeTruthy();
    expect(out.confidence_state.level).toBe("normal");
  });
});
