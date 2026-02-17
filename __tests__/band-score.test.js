import {
  rubricMeanToScaled,
  scaledToBand,
  bandToCEFR,
  bandToColor,
  calculateWritingBand,
} from "../lib/mockExam/bandScore";

describe("rubricMeanToScaled", () => {
  test("exact ETS anchor points", () => {
    expect(rubricMeanToScaled(5.0)).toBe(30);
    expect(rubricMeanToScaled(4.75)).toBe(29);
    expect(rubricMeanToScaled(4.5)).toBe(28);
    expect(rubricMeanToScaled(4.25)).toBe(27);
    expect(rubricMeanToScaled(4.0)).toBe(25);
    expect(rubricMeanToScaled(3.75)).toBe(24);
    expect(rubricMeanToScaled(3.5)).toBe(22);
    expect(rubricMeanToScaled(3.25)).toBe(21);
    expect(rubricMeanToScaled(3.0)).toBe(20);
    expect(rubricMeanToScaled(2.75)).toBe(18);
    expect(rubricMeanToScaled(2.5)).toBe(17);
    expect(rubricMeanToScaled(2.25)).toBe(15);
    expect(rubricMeanToScaled(2.0)).toBe(14);
    expect(rubricMeanToScaled(1.75)).toBe(12);
    expect(rubricMeanToScaled(1.5)).toBe(11);
    expect(rubricMeanToScaled(1.25)).toBe(10);
    expect(rubricMeanToScaled(1.0)).toBe(8);
    expect(rubricMeanToScaled(0.75)).toBe(6);
    expect(rubricMeanToScaled(0.5)).toBe(4);
    expect(rubricMeanToScaled(0.25)).toBe(2);
    expect(rubricMeanToScaled(0.0)).toBe(0);
  });

  test("boundary cases", () => {
    expect(rubricMeanToScaled(5.5)).toBe(30);
    expect(rubricMeanToScaled(-1)).toBe(0);
    expect(rubricMeanToScaled(NaN)).toBe(0);
    expect(rubricMeanToScaled(Infinity)).toBe(30);
  });

  test("interpolation between anchor points", () => {
    // Between 4.0 (25) and 4.25 (27) — midpoint ~26
    expect(rubricMeanToScaled(4.125)).toBe(26);
    // Between 3.0 (20) and 3.25 (21) — midpoint ~21
    const mid = rubricMeanToScaled(3.125);
    expect(mid).toBeGreaterThanOrEqual(20);
    expect(mid).toBeLessThanOrEqual(21);
  });
});

describe("scaledToBand", () => {
  test("band boundaries", () => {
    expect(scaledToBand(30)).toBe(6.0);
    expect(scaledToBand(29)).toBe(6.0);
    expect(scaledToBand(28)).toBe(5.5);
    expect(scaledToBand(27)).toBe(5.5);
    expect(scaledToBand(26)).toBe(5.0);
    expect(scaledToBand(24)).toBe(5.0);
    expect(scaledToBand(23)).toBe(4.5);
    expect(scaledToBand(21)).toBe(4.5);
    expect(scaledToBand(20)).toBe(4.0);
    expect(scaledToBand(17)).toBe(4.0);
    expect(scaledToBand(16)).toBe(3.5);
    expect(scaledToBand(15)).toBe(3.5);
    expect(scaledToBand(14)).toBe(3.0);
    expect(scaledToBand(13)).toBe(3.0);
    expect(scaledToBand(12)).toBe(2.5);
    expect(scaledToBand(11)).toBe(2.5);
    expect(scaledToBand(10)).toBe(2.0);
    expect(scaledToBand(7)).toBe(2.0);
    expect(scaledToBand(6)).toBe(1.5);
    expect(scaledToBand(3)).toBe(1.5);
    expect(scaledToBand(2)).toBe(1.0);
    expect(scaledToBand(0)).toBe(1.0);
  });

  test("invalid input", () => {
    expect(scaledToBand(NaN)).toBe(1.0);
  });
});

describe("bandToCEFR", () => {
  test("maps bands to CEFR levels", () => {
    expect(bandToCEFR(6.0)).toBe("C1+");
    expect(bandToCEFR(5.5)).toBe("C1+");
    expect(bandToCEFR(5.0)).toBe("B2-C1");
    expect(bandToCEFR(4.5)).toBe("B2-C1");
    expect(bandToCEFR(4.0)).toBe("B1-B2");
    expect(bandToCEFR(3.5)).toBe("B1-B2");
    expect(bandToCEFR(3.0)).toBe("A2-B1");
    expect(bandToCEFR(2.5)).toBe("A2-B1");
    expect(bandToCEFR(2.0)).toBe("A1-A2");
    expect(bandToCEFR(1.0)).toBe("A1-A2");
  });
});

describe("bandToColor", () => {
  test("maps bands to color keys", () => {
    expect(bandToColor(6.0)).toBe("green");
    expect(bandToColor(5.0)).toBe("blue");
    expect(bandToColor(4.0)).toBe("yellow");
    expect(bandToColor(3.0)).toBe("orange");
    expect(bandToColor(1.5)).toBe("red");
  });
});

describe("calculateWritingBand — verification table", () => {
  const cases = [
    { bas: 10, email: 5, disc: 5, mean: 5.0,  scaled: 30, band: 6.0 },
    { bas: 9,  email: 5, disc: 5, mean: 4.83, scaled: 29, band: 6.0 },
    { bas: 9,  email: 4, disc: 5, mean: 4.5,  scaled: 28, band: 5.5 },
    { bas: 8,  email: 4, disc: 4, mean: 4.0,  scaled: 25, band: 5.0 },
    { bas: 7,  email: 4, disc: 4, mean: 3.83, scaled: 24, band: 5.0 },
    { bas: 7,  email: 3, disc: 4, mean: 3.5,  scaled: 22, band: 4.5 },
    { bas: 6,  email: 3, disc: 3, mean: 3.0,  scaled: 20, band: 4.0 },
    { bas: 5,  email: 3, disc: 3, mean: 2.83, scaled: 19, band: 4.0 },
    { bas: 5,  email: 2, disc: 3, mean: 2.5,  scaled: 17, band: 4.0 },
    { bas: 4,  email: 2, disc: 2, mean: 2.0,  scaled: 14, band: 3.0 },
    { bas: 3,  email: 2, disc: 2, mean: 1.83, scaled: 13, band: 3.0 },
    { bas: 2,  email: 1, disc: 1, mean: 1.0,  scaled: 8,  band: 2.0 },
    { bas: 0,  email: 0, disc: 0, mean: 0.0,  scaled: 0,  band: 1.0 },
  ];

  test.each(cases)(
    "BaS=$bas Email=$email Disc=$disc -> mean=$mean scaled=$scaled band=$band",
    ({ bas, email, disc, mean, scaled, band }) => {
      const result = calculateWritingBand(bas, email, disc);
      expect(result.combinedMean).toBeCloseTo(mean, 2);
      expect(result.scaledScore).toBe(scaled);
      expect(result.band).toBe(band);
    },
  );

  test("returns cefr and color", () => {
    const result = calculateWritingBand(8, 4, 4);
    expect(result.cefr).toBe("B2-C1");
    expect(result.color).toBe("blue");
    expect(result.breakdown.buildASentence).toEqual({ raw: 8, outOf: 10, mean: 4 });
    expect(result.breakdown.writeAnEmail).toEqual({ score: 4, outOf: 5 });
    expect(result.breakdown.academicDiscussion).toEqual({ score: 4, outOf: 5 });
  });

  test("clamps out-of-range inputs", () => {
    const result = calculateWritingBand(15, -1, 8);
    expect(result.breakdown.buildASentence.raw).toBe(10);
    expect(result.breakdown.writeAnEmail.score).toBe(0);
    expect(result.breakdown.academicDiscussion.score).toBe(5);
  });
});
