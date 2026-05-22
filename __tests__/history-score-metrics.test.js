import {
  buildDailyAveragePoints,
  getAccuracyPercent,
  getSpeakingAverageScore,
  getSpeakingBandScore,
} from "../lib/history/scoreMetrics";

describe("history score metrics", () => {
  test("gets accuracy from top-level correct and total", () => {
    expect(getAccuracyPercent({ correct: 3, total: 4 })).toBe(75);
  });

  test("falls back to details.results when cloud score fields are missing", () => {
    const session = {
      type: "reading",
      details: {
        subtype: "rdl",
        results: [{ isCorrect: true }, { isCorrect: false }, { isCorrect: true }],
      },
    };

    expect(Math.round(getAccuracyPercent(session))).toBe(67);
  });

  test("falls back to mock module totals", () => {
    const session = {
      type: "listening",
      details: {
        subtype: "mock",
        m1: { correct: 6, total: 8 },
        m2: { correct: 3, total: 4 },
      },
    };

    expect(getAccuracyPercent(session)).toBe(75);
  });

  test("builds daily averages and skips sessions without a valid score", () => {
    const points = buildDailyAveragePoints(
      [
        { date: "2026-05-20T09:00:00.000Z", correct: 1, total: 2 },
        { date: "2026-05-20T12:00:00.000Z", details: { results: [{ isCorrect: true }] } },
        { date: "2026-05-21T12:00:00.000Z", details: {} },
        { date: "2026-05-22T12:00:00.000Z", correct: 3, total: 4 },
      ],
      getAccuracyPercent,
    );

    expect(points).toHaveLength(2);
    expect(points[0].avg).toBe(75);
    expect(points[1].avg).toBe(75);
    expect(points.every((point) => Number.isFinite(point.avg))).toBe(true);
  });

  test("gets speaking scores from both practice average and mock details band", () => {
    expect(getSpeakingAverageScore({ score: 4 })).toBe(4);
    expect(getSpeakingAverageScore({ details: { averageScore: 3.5 } })).toBe(3.5);
    expect(getSpeakingBandScore({ details: { band: 4.5 } })).toBe(4.5);
  });
});
