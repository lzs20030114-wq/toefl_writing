/**
 * @jest-environment node
 *
 * AI 评分管线 集成测试
 * 覆盖：parse → calibrate 全流程、section 格式解析、评分校准规则、边界情况
 */

import { parseReport } from "../lib/ai/parse";
import { calibrateScoreReport, calibrateDiscussion, MIN_DISCUSSION_WORDS_FOR_GUARDRAIL } from "../lib/ai/calibration";

// ── Helper: build realistic AI response with section markers ────

function buildSectionResponse({
  score = 4,
  band = "High-Intermediate",
  summary = "Good overall performance.",
  goals = [],
  annotation = "The student wrote a <red>good</red> essay.",
  patterns = "[]",
  comparison = "",
  action = "",
  signals = "",
  rubricDims = null,
}) {
  const scoreBlock = [
    `score: ${score}`,
    `band: ${band}`,
    `summary: ${summary}`,
  ];
  if (rubricDims) {
    if (rubricDims.task != null) scoreBlock.push(`维度-任务完成: ${rubricDims.task}`);
    if (rubricDims.org != null) scoreBlock.push(`维度-组织连贯: ${rubricDims.org}`);
    if (rubricDims.lang != null) scoreBlock.push(`维度-语言使用: ${rubricDims.lang}`);
  }

  const parts = [`===SCORE===\n${scoreBlock.join("\n")}`];
  if (goals.length > 0) {
    parts.push(`===GOALS===\n${goals.map((g, i) => `Goal ${i + 1}: ${g.status} ${g.reason || ""}`).join("\n")}`);
  }
  if (annotation) parts.push(`===ANNOTATION===\n${annotation}`);
  if (patterns) parts.push(`===PATTERNS===\n${patterns}`);
  if (comparison) parts.push(`===COMPARISON===\n${comparison}`);
  if (action) parts.push(`===ACTION===\n${action}`);
  if (signals) parts.push(`===SIGNALS===\n${signals}`);
  return parts.join("\n\n");
}

function makeWords(n) {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

// ── Parse tests ─────────────────────────────────────────

describe("AI parse: section-based response", () => {
  test("parses score, band, and summary from ===SCORE=== section", () => {
    const raw = buildSectionResponse({ score: 3.5, band: "Intermediate+", summary: "Solid effort." });
    const result = parseReport(raw);

    expect(result.error).toBe(false);
    expect(result.score).toBe(3.5);
    expect(result.band).toBe(null); // band from section is numeric match
    expect(result.summary).toBe("Solid effort.");
  });

  test("parses goals from ===GOALS=== section", () => {
    const raw = buildSectionResponse({
      score: 3,
      goals: [
        { status: "OK", reason: "Clearly addressed." },
        { status: "PARTIAL", reason: "Needs more detail." },
        { status: "MISSING", reason: "Not mentioned." },
      ],
    });
    const result = parseReport(raw);

    expect(result.goals).toHaveLength(3);
    expect(result.goals[0].status).toBe("OK");
    expect(result.goals[1].status).toBe("PARTIAL");
    expect(result.goals[2].status).toBe("MISSING");
  });

  test("parses dimension scores from ===SCORE=== section", () => {
    const raw = buildSectionResponse({
      score: 4,
      rubricDims: { task: 4.5, org: 3.5, lang: 4 },
    });
    const result = parseReport(raw);

    expect(result.rubric).not.toBeNull();
    expect(result.rubric.dimensions.task_fulfillment.score).toBe(4.5);
    expect(result.rubric.dimensions.organization_coherence.score).toBe(3.5);
    expect(result.rubric.dimensions.language_use.score).toBe(4);
  });

  test("handles JSON report format (legacy)", () => {
    const json = JSON.stringify({
      score: 4.5,
      band: 5,
      summary: "Excellent writing.",
      key_problems: [{ explanation: "Minor issue", example: "test", action: "fix" }],
    });
    const result = parseReport(json);

    expect(result.error).toBeUndefined(); // JSON path doesn't set error
    expect(result.score).toBe(4.5);
    expect(result.band).toBe(5);
    expect(result.key_problems).toHaveLength(1);
  });

  test("handles code-fenced JSON", () => {
    const raw = "```json\n" + JSON.stringify({ score: 3, band: 3 }) + "\n```";
    const result = parseReport(raw);
    expect(result.score).toBe(3);
  });

  test("returns fallback on empty response", () => {
    const result = parseReport("");
    expect(result.error).toBe(true);
    expect(result.score).toBeNull();
    expect(result.errorReason).toMatch(/empty/i);
  });

  test("returns fallback on response without section markers", () => {
    const result = parseReport("Here is some unstructured text without markers.");
    expect(result.error).toBe(true);
    expect(result.errorReason).toMatch(/section/i);
  });

  test("returns fallback when SCORE section has no valid score", () => {
    const raw = "===SCORE===\nsummary: Something happened\n===ANNOTATION===\ntext";
    const result = parseReport(raw);
    expect(result.error).toBe(true);
    expect(result.errorReason).toMatch(/score/i);
  });
});

// ── Calibration tests ───────────────────────────────────

describe("AI calibration: email scoring", () => {
  test("applies word count floor (< 50 words caps at 3)", () => {
    const raw = buildSectionResponse({
      score: 4.5,
      rubricDims: { task: 4.5, org: 4.5, lang: 4.5 },
    });
    const parsed = parseReport(raw);
    const calibrated = calibrateScoreReport("email", parsed, makeWords(30));

    expect(calibrated.score).toBeLessThanOrEqual(3);
    expect(calibrated.calibration.adjusted).toBe(true);
    expect(calibrated.calibration.reasons).toContain("email_thin_response_cap");
  });

  test("does not cap adequate email response", () => {
    const raw = buildSectionResponse({
      score: 4,
      rubricDims: { task: 4, org: 4, lang: 4 },
    });
    const parsed = parseReport(raw);
    // 150 words with concrete markers
    const response = makeWords(150) + " deadline schedule because specific";
    const calibrated = calibrateScoreReport("email", parsed, response);

    expect(calibrated.score).toBeGreaterThanOrEqual(3.5);
  });

  test("clamps score to 0-5 range regardless of input", () => {
    const raw = buildSectionResponse({
      score: 6,
      rubricDims: { task: 6, org: 6, lang: 6 },
    });
    const parsed = parseReport(raw);
    const calibrated = calibrateScoreReport("email", parsed, makeWords(200));

    expect(calibrated.score).toBeLessThanOrEqual(5);
    expect(calibrated.score).toBeGreaterThanOrEqual(0);
  });
});

describe("AI calibration: discussion scoring", () => {
  test("applies word count floor when too short", () => {
    const raw = buildSectionResponse({
      score: 4,
      rubricDims: { task: 4, org: 4, lang: 4 },
      signals: "stance_clear: true\nhas_example: true\nengages_discussion: true",
    });
    const parsed = parseReport(raw);
    const shortResponse = makeWords(MIN_DISCUSSION_WORDS_FOR_GUARDRAIL - 10);
    const calibrated = calibrateScoreReport("discussion", parsed, shortResponse);

    expect(calibrated.score).toBeLessThanOrEqual(2);
    expect(calibrated.calibration.reasons).toContain("word_count_floor");
  });

  test("caps at 3 when stance is unclear", () => {
    const raw = buildSectionResponse({
      score: 4,
      rubricDims: { task: 4, org: 4, lang: 4 },
      signals: "stance_clear: false\nhas_example: true\nengages_discussion: true",
    });
    const parsed = parseReport(raw);
    const calibrated = calibrateScoreReport("discussion", parsed, makeWords(150));

    expect(calibrated.score).toBeLessThanOrEqual(3);
    expect(calibrated.calibration.reasons).toContain("ai_no_stance");
  });

  test("caps at 3 when no engagement", () => {
    const raw = buildSectionResponse({
      score: 4,
      rubricDims: { task: 4, org: 4, lang: 4 },
      signals: "stance_clear: true\nhas_example: true\nengages_discussion: false",
    });
    const parsed = parseReport(raw);
    const calibrated = calibrateScoreReport("discussion", parsed, makeWords(150));

    expect(calibrated.score).toBeLessThanOrEqual(3);
    expect(calibrated.calibration.reasons).toContain("ai_no_engagement");
  });

  test("caps at 4 when no example provided", () => {
    const raw = buildSectionResponse({
      score: 5,
      rubricDims: { task: 5, org: 5, lang: 5 },
      signals: "stance_clear: true\nhas_example: false\nengages_discussion: true",
    });
    const parsed = parseReport(raw);
    const calibrated = calibrateScoreReport("discussion", parsed, makeWords(150));

    expect(calibrated.score).toBeLessThanOrEqual(4);
    expect(calibrated.calibration.reasons).toContain("ai_no_example_cap");
  });

  test("does not adjust score when all signals positive", () => {
    const raw = buildSectionResponse({
      score: 4,
      rubricDims: { task: 4, org: 4, lang: 4 },
      signals: "stance_clear: true\nhas_example: true\nengages_discussion: true",
    });
    const parsed = parseReport(raw);
    const calibrated = calibrateScoreReport("discussion", parsed, makeWords(150));

    expect(calibrated.calibration.reasons).toHaveLength(0);
    expect(calibrated.score).toBe(4);
  });
});

// ── Band label mapping ──────────────────────────────────

describe("AI calibration: band labels", () => {
  const testCases = [
    [5, "Advanced"],
    [4.5, "High-Intermediate+"],
    [4, "High-Intermediate"],
    [3.5, "Intermediate+"],
    [3, "Intermediate"],
    [2.5, "Low-Intermediate+"],
    [2, "Low-Intermediate"],
    [1, "Basic"],
    [0, "Below Basic"],
  ];

  test.each(testCases)("score %s maps to band %s", (score, expectedBand) => {
    const raw = buildSectionResponse({
      score,
      rubricDims: { task: score, org: score, lang: score },
      signals: "stance_clear: true\nhas_example: true\nengages_discussion: true",
    });
    const parsed = parseReport(raw);
    const calibrated = calibrateScoreReport("discussion", parsed, makeWords(200));

    expect(calibrated.band).toBe(expectedBand);
  });
});

// ── Confidence & key problems ───────────────────────────

describe("AI calibration: confidence state", () => {
  test("detects low confidence for very short email", () => {
    const raw = buildSectionResponse({
      score: 3,
      rubricDims: { task: 3, org: 3, lang: 3 },
    });
    const parsed = parseReport(raw);
    const calibrated = calibrateScoreReport("email", parsed, makeWords(40));

    expect(calibrated.confidence_state.level).toBe("low");
    expect(calibrated.confidence_state.reasons).toContain("very_short_response");
  });

  test("reports normal confidence for adequate response", () => {
    const raw = buildSectionResponse({
      score: 4,
      rubricDims: { task: 4, org: 4, lang: 4 },
    });
    const parsed = parseReport(raw);
    const calibrated = calibrateScoreReport("email", parsed, makeWords(150));

    expect(calibrated.confidence_state.level).toBe("normal");
  });
});

// ── Rubric normalization ────────────────────────────────

describe("AI calibration: rubric normalization", () => {
  test("uses weighted combination: 40% task + 30% org + 30% lang", () => {
    const raw = buildSectionResponse({
      score: 4,
      rubricDims: { task: 5, org: 3, lang: 4 },
    });
    const parsed = parseReport(raw);
    const calibrated = calibrateScoreReport("email", parsed, makeWords(150));

    // 5*0.4 + 3*0.3 + 4*0.3 = 2 + 0.9 + 1.2 = 4.1
    expect(calibrated.rubric.weighted_score).toBeCloseTo(4.1, 1);
  });

  test("falls back to overall score when dimensions missing", () => {
    const raw = buildSectionResponse({ score: 3 });
    const parsed = parseReport(raw);
    const calibrated = calibrateScoreReport("email", parsed, makeWords(150));

    // All dims default to 3 → 3*0.4 + 3*0.3 + 3*0.3 = 3
    expect(calibrated.rubric.weighted_score).toBeCloseTo(3, 1);
  });

  test("clamps dimension scores to 0-5 via normalizeRubric", () => {
    // Parse regex only matches 0-5, so out-of-range dims fall back to overall score.
    // Test clamping via direct rubric injection (simulating AI returning raw object).
    const parsed = parseReport(buildSectionResponse({ score: 3 }));
    // Inject out-of-range rubric as if AI returned it in JSON format
    parsed.rubric = {
      dimensions: {
        task_fulfillment: { score: 7 },
        organization_coherence: { score: -2 },
        language_use: { score: 4 },
      },
    };
    const calibrated = calibrateScoreReport("email", parsed, makeWords(150));

    expect(calibrated.rubric.dimensions.task_fulfillment.score).toBe(5);
    expect(calibrated.rubric.dimensions.organization_coherence.score).toBe(0);
    expect(calibrated.rubric.dimensions.language_use.score).toBe(4);
  });
});

// ── End-to-end parse → calibrate ────────────────────────

describe("AI scoring: end-to-end pipeline", () => {
  test("full pipeline: realistic AI response → parsed → calibrated", () => {
    const raw = buildSectionResponse({
      score: 3.5,
      summary: "学生表现良好，但需加强论证。",
      rubricDims: { task: 4, org: 3, lang: 3.5 },
      goals: [
        { status: "OK", reason: "Addressed main point." },
        { status: "PARTIAL", reason: "Needs elaboration." },
      ],
      annotation: 'The student <red message="时态错误" fix="used → had used">used</red> the wrong tense.',
      patterns: JSON.stringify([{ tag: "tense_error", count: 2, summary: "Inconsistent tense usage." }]),
      action: "短板1: 时态一致性\n重要性: 影响评分\n行动: 检查每句时态",
      signals: "stance_clear: true\nhas_example: true\nengages_discussion: true",
    });

    const parsed = parseReport(raw);
    expect(parsed.error).toBe(false);
    expect(parsed.score).toBe(3.5);
    expect(parsed.goals).toHaveLength(2);

    const calibrated = calibrateScoreReport("discussion", parsed, makeWords(150));
    expect(calibrated.score).toBeGreaterThanOrEqual(0);
    expect(calibrated.score).toBeLessThanOrEqual(5);
    expect(calibrated.band).toBeDefined();
    expect(calibrated.rubric).toBeDefined();
    expect(calibrated.rubric.method).toBe("weighted_combination");
    expect(calibrated.score_confidence).toBeDefined();
    expect(calibrated.confidence_state).toBeDefined();
    expect(calibrated.calibration).toBeDefined();
  });

  test("handles null/undefined result gracefully", () => {
    expect(calibrateScoreReport("email", null, "text")).toBeNull();
    expect(calibrateScoreReport("email", undefined, "text")).toBeUndefined();
  });
});
