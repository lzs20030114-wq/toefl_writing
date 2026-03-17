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
