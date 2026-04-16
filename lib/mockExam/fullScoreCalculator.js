/**
 * Full TOEFL Score Calculator
 *
 * Combines all 4 sections (Reading, Listening, Speaking, Writing)
 * into a total TOEFL score.
 *
 * 2026 TOEFL:
 *   - Each section: Band 1-6
 *   - Total band: 4-24 (sum of 4 sections)
 *   - Traditional 0-120 scale: each section band/6 * 30, total 0-120
 *   - CEFR mapping based on average band
 */

/**
 * Calculate the full TOEFL score from all four sections.
 *
 * @param {object} params
 * @param {number} params.readingBand   - Band 1-6
 * @param {number} params.listeningBand - Band 1-6
 * @param {number} params.speakingBand  - Band 1-6
 * @param {number} params.writingBand   - Band 1-6
 * @returns {{
 *   totalBand: number,
 *   totalScaled: number,
 *   sections: { reading, listening, speaking, writing },
 *   cefr: string,
 *   avgBand: number,
 * }}
 */
export function calculateFullTOEFLScore({
  readingBand = 0,
  listeningBand = 0,
  speakingBand = 0,
  writingBand = 0,
}) {
  // Clamp each band to 0-6 range
  const clamp = (v) => Math.max(0, Math.min(6, v));
  const rb = clamp(readingBand);
  const lb = clamp(listeningBand);
  const sb = clamp(speakingBand);
  const wb = clamp(writingBand);

  // Total band: sum of 4 sections (4-24 when all valid, 0-24 raw)
  const totalBand = Math.round((rb + lb + sb + wb) * 2) / 2;

  // Convert each band to 0-30 scale: band / 6 * 30
  const readingScaled = Math.round((rb / 6) * 30);
  const listeningScaled = Math.round((lb / 6) * 30);
  const speakingScaled = Math.round((sb / 6) * 30);
  const writingScaled = Math.round((wb / 6) * 30);
  const totalScaled = readingScaled + listeningScaled + speakingScaled + writingScaled;

  // Average band for CEFR
  const avgBand = totalBand / 4;
  const cefr =
    avgBand >= 5.5
      ? "C1+"
      : avgBand >= 4.5
        ? "C1"
        : avgBand >= 3.5
          ? "B2"
          : avgBand >= 2.5
            ? "B1"
            : avgBand >= 1.5
              ? "A2"
              : "A1";

  return {
    totalBand,
    totalScaled,
    avgBand: Math.round(avgBand * 100) / 100,
    sections: {
      reading: { band: rb, scaled: readingScaled },
      listening: { band: lb, scaled: listeningScaled },
      speaking: { band: sb, scaled: speakingScaled },
      writing: { band: wb, scaled: writingScaled },
    },
    cefr,
  };
}

/**
 * Map a CEFR level to a color key for UI rendering.
 */
export function cefrToColor(cefr) {
  if (cefr === "C1+" || cefr === "C1") return "green";
  if (cefr === "B2") return "blue";
  if (cefr === "B1") return "yellow";
  if (cefr === "A2") return "orange";
  return "red";
}
