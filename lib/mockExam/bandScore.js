/**
 * ETS Writing Section Band Score Conversion
 *
 * Pipeline: raw scores -> rubric mean (0-5) -> scaled (0-30) -> band (1.0-6.0)
 *
 * Based on ETS official lookup tables:
 * - Rubric mean to scaled 0-30 (non-linear, top-compressed)
 * - Scaled 0-30 to band 1.0-6.0 (range buckets)
 */

// ETS official anchor points: [rubricMean, scaled0to30]
const ETS_WRITING_TABLE = [
  [5.00, 30],
  [4.75, 29],
  [4.50, 28],
  [4.25, 27],
  [4.00, 25],
  [3.75, 24],
  [3.50, 22],
  [3.25, 21],
  [3.00, 20],
  [2.75, 18],
  [2.50, 17],
  [2.25, 15],
  [2.00, 14],
  [1.75, 12],
  [1.50, 11],
  [1.25, 10],
  [1.00, 8],
  [0.75, 6],
  [0.50, 4],
  [0.25, 2],
  [0.00, 0],
];

/**
 * Convert rubric mean (0-5) to ETS scaled score (0-30)
 * using linear interpolation between official anchor points.
 */
export function rubricMeanToScaled(mean) {
  if (typeof mean !== "number" || isNaN(mean)) return 0;
  if (mean >= 5) return 30;
  if (mean <= 0) return 0;

  for (let i = 0; i < ETS_WRITING_TABLE.length - 1; i++) {
    const [rm1, s1] = ETS_WRITING_TABLE[i];
    const [rm2, s2] = ETS_WRITING_TABLE[i + 1];
    if (mean <= rm1 && mean >= rm2) {
      const ratio = (mean - rm2) / (rm1 - rm2);
      return Math.round(s2 + ratio * (s1 - s2));
    }
  }
  return 0;
}

/**
 * Convert ETS scaled score (0-30) to band (1.0-6.0).
 */
export function scaledToBand(scaled) {
  if (!Number.isFinite(scaled)) return 1.0;
  if (scaled >= 29) return 6.0;
  if (scaled >= 27) return 5.5;
  if (scaled >= 24) return 5.0;
  if (scaled >= 21) return 4.5;
  if (scaled >= 17) return 4.0;
  if (scaled >= 15) return 3.5;
  if (scaled >= 13) return 3.0;
  if (scaled >= 11) return 2.5;
  if (scaled >= 7) return 2.0;
  if (scaled >= 3) return 1.5;
  return 1.0;
}

/**
 * Map band to CEFR level descriptor.
 */
export function bandToCEFR(band) {
  if (band >= 5.5) return "C1+";
  if (band >= 4.5) return "B2-C1";
  if (band >= 3.5) return "B1-B2";
  if (band >= 2.5) return "A2-B1";
  return "A1-A2";
}

/**
 * Map band to color key for UI rendering.
 * Returns: "green" | "blue" | "yellow" | "orange" | "red"
 */
export function bandToColor(band) {
  if (band >= 5.5) return "green";
  if (band >= 4.5) return "blue";
  if (band >= 3.5) return "yellow";
  if (band >= 2.5) return "orange";
  return "red";
}

/**
 * Full pipeline: raw task scores -> Band result object.
 *
 * @param {number} basRaw  Build a Sentence raw score (0-10)
 * @param {number} emailScore  Email rubric score (0-5)
 * @param {number} discussionScore  Academic Discussion rubric score (0-5)
 * @returns {{ band, scaledScore, combinedMean, cefr, color, breakdown }}
 */
export function calculateWritingBand(basRaw, emailScore, discussionScore) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const bas = clamp(basRaw, 0, 10);
  const email = clamp(emailScore, 0, 5);
  const discussion = clamp(discussionScore, 0, 5);

  const basMean = (bas / 10) * 5;
  const combinedMean = (basMean + email + discussion) / 3;
  const scaledScore = rubricMeanToScaled(combinedMean);
  const band = scaledToBand(scaledScore);
  const cefr = bandToCEFR(band);
  const color = bandToColor(band);

  return {
    band,
    scaledScore,
    combinedMean: Math.round(combinedMean * 100) / 100,
    cefr,
    color,
    breakdown: {
      buildASentence: { raw: bas, outOf: 10, mean: Math.round(basMean * 100) / 100 },
      writeAnEmail: { score: email, outOf: 5 },
      academicDiscussion: { score: discussion, outOf: 5 },
    },
  };
}
