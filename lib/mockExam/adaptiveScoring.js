/**
 * Adaptive Exam Scoring
 *
 * Scoring formula:
 *   M1 contributes 40%, M2 contributes 60% of the raw accuracy.
 *   Path determines the maximum achievable band:
 *     "upper" path → maxBand 6.0
 *     "lower" path → maxBand 4.0
 *
 *   rawScore = (m1Correct/m1Total)*0.4 + (m2Correct/m2Total)*0.6
 *   band = rawScore * maxBand, rounded to nearest 0.5
 */

/**
 * Map band to CEFR level.
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
 */
export function getScoreColor(band) {
  if (band >= 5.5) return "green";
  if (band >= 4.5) return "blue";
  if (band >= 3.5) return "yellow";
  if (band >= 2.5) return "orange";
  return "red";
}

/**
 * Calculate the adaptive exam score.
 *
 * @param {number} m1Correct - correct answers in module 1
 * @param {number} m1Total - total scorable items in module 1
 * @param {number} m2Correct - correct answers in module 2
 * @param {number} m2Total - total scorable items in module 2
 * @param {"upper"|"lower"} path - routing path from module 1
 * @returns {{ band, rawScore, maxBand, path, cefr, color, m1Accuracy, m2Accuracy }}
 */
export function calculateAdaptiveScore(m1Correct, m1Total, m2Correct, m2Total, path) {
  const safeM1Total = m1Total > 0 ? m1Total : 1;
  const safeM2Total = m2Total > 0 ? m2Total : 1;

  const m1Accuracy = m1Correct / safeM1Total;
  const m2Accuracy = m2Correct / safeM2Total;

  // Weighted raw score (0-1 range)
  const rawScore = m1Accuracy * 0.4 + m2Accuracy * 0.6;

  // Path-dependent max band
  const maxBand = path === "upper" ? 6.0 : 4.0;

  // Scale to band, round to nearest 0.5
  const rawBand = rawScore * maxBand;
  const band = Math.max(1.0, Math.round(rawBand * 2) / 2);

  const cefr = bandToCEFR(band);
  const color = getScoreColor(band);

  return {
    band,
    rawScore: Math.round(rawScore * 1000) / 1000,
    maxBand,
    path,
    cefr,
    color,
    m1Accuracy: Math.round(m1Accuracy * 1000) / 1000,
    m2Accuracy: Math.round(m2Accuracy * 1000) / 1000,
  };
}
