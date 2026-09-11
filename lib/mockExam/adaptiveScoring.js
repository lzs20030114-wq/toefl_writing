/**
 * Adaptive Exam Scoring
 *
 * Aligned to what ETS has published about the 2026 multistage-adaptive
 * Reading/Listening sections: the band is derived from performance across BOTH
 * the routing module and the second module, and the routing outcome caps the
 * ceiling (lower path → at most 4 of 6; upper path → up to 6). ETS has NOT
 * published the raw-to-band conversion or any module weighting, so we use the
 * neutral model — every scored question counts once, pooled across modules —
 * which mirrors how each item feeds the ability estimate in a multistage test.
 * (The previous 40 % / 60 % module weighting was an in-house guess that pointed
 * the wrong way once M1 carried 35 of 50 / 32 of 47 questions.)
 *
 *   rawScore = (m1Correct + m2Correct) / (m1Total + m2Total)
 *   maxBand  = upper ? 6.0 : 4.0
 *   band     = rawScore * maxBand, rounded to nearest 0.5, floor 1.0
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
 * @returns {{ band, rawScore, maxBand, path, cefr, color, m1Accuracy, m2Accuracy, m1Weight, m2Weight }}
 *   m1Weight / m2Weight = each module's share of the pooled questions (for display).
 */
export function calculateAdaptiveScore(m1Correct, m1Total, m2Correct, m2Total, path) {
  const safeM1Total = m1Total > 0 ? m1Total : 1;
  const safeM2Total = m2Total > 0 ? m2Total : 1;

  const m1Accuracy = m1Correct / safeM1Total;
  const m2Accuracy = m2Correct / safeM2Total;

  // Pooled raw score (0-1 range): every scored question counts once, so each
  // module's effective weight is simply its share of the questions.
  const pooledTotal = (m1Total > 0 ? m1Total : 0) + (m2Total > 0 ? m2Total : 0);
  const rawScore = pooledTotal > 0 ? (m1Correct + m2Correct) / pooledTotal : 0;
  const m1Weight = pooledTotal > 0 ? (m1Total > 0 ? m1Total : 0) / pooledTotal : 0;
  const m2Weight = pooledTotal > 0 ? 1 - m1Weight : 0;

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
    m1Weight: Math.round(m1Weight * 1000) / 1000,
    m2Weight: Math.round(m2Weight * 1000) / 1000,
  };
}
