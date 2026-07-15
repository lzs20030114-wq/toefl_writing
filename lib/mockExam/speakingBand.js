/**
 * Speaking mock-exam band computation on the ETS raw-score structure.
 *
 * Official raw structure (data/speakingScoring/scoringModel.json):
 *   Listen & Repeat  — 7 questions × 0-5 holistic = 35 points
 *   Take an Interview — 4 questions × 0-5 holistic = 20 points
 *   Speaking raw total = 0-55  →  scaled 1-6 band.
 *
 * Our practice/mock repeat sets are 6-8 sentences (not a fixed 7), so we normalize
 * the per-sentence official-level mean to the 35-point equivalent. Interview scales
 * however many questions were answered up to the 4-question / 20-point equivalent.
 *
 * ETS converts raw→band with proprietary weighted equipercentile linking that we
 * cannot replicate; this is a transparent linear approximation (rawTotal/55 × 6),
 * rounded to the nearest half band with a floor of 1. It is explicitly an estimate
 * (the results screen keeps the "not an official ETS score" disclaimer).
 */

export const REPEAT_RAW_MAX = 35;     // 7 × 5
export const INTERVIEW_RAW_MAX = 20;  // 4 × 5
export const SPEAKING_RAW_MAX = 55;   // 35 + 20

function meanOf(list) {
  const nums = (Array.isArray(list) ? list : []).map(Number).filter(Number.isFinite);
  if (nums.length === 0) return { mean: 0, count: 0 };
  return { mean: nums.reduce((a, b) => a + b, 0) / nums.length, count: nums.length };
}

/**
 * Convert per-question official levels into raw sub-scores and the 0-55 total.
 *
 * @param {number[]} repeatLevels    — official 0-5 level per repeated sentence
 * @param {number[]} interviewScores — AI 0-5 score per answered interview question
 */
export function computeSpeakingRaw(repeatLevels, interviewScores) {
  const r = meanOf(repeatLevels);
  const i = meanOf(interviewScores);
  // (mean/5)*max is identical to the spec's (levelSum/count)*7 and (scoreSum/count)*4.
  const repeatRaw = Math.min(REPEAT_RAW_MAX, (r.mean / 5) * REPEAT_RAW_MAX);
  const interviewRaw = Math.min(INTERVIEW_RAW_MAX, (i.mean / 5) * INTERVIEW_RAW_MAX);
  const rawTotal = repeatRaw + interviewRaw;
  return {
    repeatMean: r.mean,
    interviewMean: i.mean,
    repeatRaw,
    interviewRaw,
    rawTotal,
  };
}

/** Linear raw(0-55) → band(1-6), half-step, floor 1, cap 6. */
export function rawToSpeakingBand(rawTotal) {
  const raw = Number.isFinite(rawTotal) ? Math.max(0, rawTotal) : 0;
  const band = (raw / SPEAKING_RAW_MAX) * 6;
  return Math.min(6, Math.max(1, Math.round(band * 2) / 2));
}

/**
 * Full band computation.
 * @returns {{ band, rawTotal, repeatRaw, interviewRaw, repeatMean, interviewMean }}
 */
export function calculateSpeakingBand(repeatLevels, interviewScores) {
  const raw = computeSpeakingRaw(repeatLevels, interviewScores);
  return { ...raw, band: rawToSpeakingBand(raw.rawTotal) };
}
