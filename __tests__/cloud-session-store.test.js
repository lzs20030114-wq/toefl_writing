import { buildScoreObj } from "../lib/cloudSessionStore";

describe("cloud session score payloads", () => {
  test("preserves reading and listening accuracy fields", () => {
    expect(buildScoreObj({
      type: "reading",
      mode: "standard",
      correct: 7,
      total: 10,
      band: 4.5,
    })).toEqual({
      mode: "standard",
      correct: 7,
      total: 10,
      band: 4.5,
    });

    expect(buildScoreObj({
      type: "listening",
      mode: "mock",
      correct: 15,
      total: 20,
      band: 5,
    })).toEqual({
      mode: "mock",
      correct: 15,
      total: 20,
      band: 5,
    });
  });

  test("preserves speaking practice score and mock band", () => {
    expect(buildScoreObj({
      type: "speaking",
      mode: "standard",
      details: { averageScore: 3.5 },
    })).toEqual({
      mode: "standard",
      score: 3.5,
    });

    expect(buildScoreObj({
      type: "speaking",
      mode: "mock",
      details: { band: 4.5 },
    })).toEqual({
      mode: "mock",
      band: 4.5,
    });
  });
});
