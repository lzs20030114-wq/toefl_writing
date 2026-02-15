import { wc } from "../utils";

const DISC_BAND_BY_SCORE = {
  0: 1.0,
  1: 1.5,
  2: 2.5,
  3: 3.5,
  4: 4.5,
  5: 5.5,
};

function countByTag(patterns = []) {
  return patterns.reduce((acc, p) => {
    const tag = String(p?.tag || "").trim();
    if (!tag) return acc;
    acc[tag] = (acc[tag] || 0) + Number(p?.count || 0);
    return acc;
  }, {});
}

function hasClearStance(text) {
  const t = String(text || "");
  return /\b(i think|i believe|i would argue|in my opinion|i agree|i disagree)\b/i.test(t);
}

function reasonSignalCount(text) {
  const matches = String(text || "")
    .toLowerCase()
    .match(
      /\b(because|since|for example|for instance|also|furthermore|moreover|in addition|another|first|second|therefore|so|while|although)\b/g
    );
  return matches ? matches.length : 0;
}

function shouldRaiseDiscussion2To3(result, responseText) {
  if (Number(result?.score) !== 2) return false;
  if (wc(responseText || "") < 60) return false;
  if (!hasClearStance(responseText)) return false;
  if (reasonSignalCount(responseText) < 2) return false;

  const tagCounts = countByTag(result?.patterns || []);
  if ((tagCounts["立场不清晰"] || 0) > 0) return false;
  if ((tagCounts["未回应他人观点"] || 0) > 1) return false;
  if ((tagCounts["拼写/基础语法"] || 0) >= 4) return false;

  return true;
}

export function calibrateScoreReport(type, result, responseText) {
  if (!result || typeof result !== "object") return result;
  if (type !== "discussion") return result;

  if (!shouldRaiseDiscussion2To3(result, responseText)) {
    return { ...result, calibration: { adjusted: false } };
  }

  return {
    ...result,
    score: 3,
    band: DISC_BAND_BY_SCORE[3],
    summary: `${result.summary || ""}（校准：满足Discussion 3分基线，避免2分压分）`.trim(),
    calibration: {
      adjusted: true,
      reason: "discussion_2_to_3_guardrail",
    },
  };
}
