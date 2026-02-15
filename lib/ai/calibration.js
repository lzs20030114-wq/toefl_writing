import { wc } from "../utils";

export const MIN_DISCUSSION_WORDS_FOR_GUARDRAIL = 60;

const DISC_BAND_BY_SCORE = {
  0: 1.0,
  1: 1.5,
  2: 2.5,
  3: 3.5,
  4: 4.5,
  5: 5.5,
};

const TAG_STANCE_UNCLEAR = "立场不清晰";
const TAG_NO_ENGAGEMENT = "未回应他人观点";
const TAG_BASIC_GRAMMAR = "拼写/基础语法";
const TAG_GOAL_COVERAGE = "目标完成不充分";

function countByTag(patterns = []) {
  return patterns.reduce((acc, p) => {
    const tag = String(p?.tag || "").trim();
    if (!tag) return acc;
    acc[tag] = (acc[tag] || 0) + Number(p?.count || 0);
    return acc;
  }, {});
}

export function hasClearStance(text) {
  const t = String(text || "");
  return /\b(i think|i believe|i would argue|in my opinion|i agree|i disagree)\b/i.test(t);
}

export function reasonSignalCount(text) {
  const matches = String(text || "")
    .toLowerCase()
    .match(
      /\b(because|since|for example|for instance|also|furthermore|moreover|in addition|another|first|second|therefore|so|while|although)\b/g
    );
  return matches ? matches.length : 0;
}

export function shouldRaiseDiscussion2To3(result, responseText) {
  if (Number(result?.score) !== 2) return false;
  if (wc(responseText || "") < MIN_DISCUSSION_WORDS_FOR_GUARDRAIL) return false;
  if (!hasClearStance(responseText)) return false;
  if (reasonSignalCount(responseText) < 2) return false;

  const tagCounts = countByTag(result?.patterns || []);
  if ((tagCounts[TAG_STANCE_UNCLEAR] || 0) > 0) return false;
  if ((tagCounts[TAG_NO_ENGAGEMENT] || 0) > 1) return false;
  if ((tagCounts[TAG_BASIC_GRAMMAR] || 0) >= 4) return false;

  return true;
}

function emailGenericSignalCount(text) {
  const t = String(text || "").toLowerCase();
  const phrases = [
    "really enjoyed",
    "strong impression",
    "connects to my interest",
    "i would like to ask if",
    "some brief advice",
    "thank you for your time",
  ];
  return phrases.reduce((n, p) => n + (t.includes(p) ? 1 : 0), 0);
}

function emailConcreteSignalCount(text) {
  const t = String(text || "").toLowerCase();
  const markers = [
    "error message",
    "submit button",
    "last week",
    "resubmit",
    "deadline",
    "schedule",
    "section",
    "grade",
    "attachment",
    "specific",
    "resource",
    "because",
    "for example",
  ];
  return markers.reduce((n, p) => n + (t.includes(p) ? 1 : 0), 0);
}

function shouldLowerEmail4To3(result, responseText) {
  if (Number(result?.score) < 4) return false;
  if (wc(responseText || "") < 50) return true;

  const genericCount = emailGenericSignalCount(responseText);
  const concreteCount = emailConcreteSignalCount(responseText);
  const tagCounts = countByTag(result?.patterns || []);
  const goalCoverageRisk = (tagCounts[TAG_GOAL_COVERAGE] || 0) >= 2;

  // High score with mostly generic statements and thin details should be capped at 3.
  if (goalCoverageRisk) return true;
  if (genericCount >= 3 && concreteCount <= 3) return true;
  if (genericCount >= 2 && concreteCount < 2) return true;
  return false;
}

function shouldCapEmail5To4(result, responseText) {
  if (Number(result?.score) !== 5) return false;
  const t = String(responseText || "").toLowerCase();
  if (/\bsubscriber of\b/.test(t)) return true;
  return false;
}

export function calibrateScoreReport(type, result, responseText) {
  if (!result || typeof result !== "object") return result;
  if (type === "email") {
    if (shouldCapEmail5To4(result, responseText)) {
      return {
        ...result,
        score: 4,
        band: DISC_BAND_BY_SCORE[4],
        summary: `${result.summary || ""}（校准：存在明显搭配错误，5分降至4分）`.trim(),
        calibration: {
          adjusted: true,
          reason: "email_5_to_4_guardrail",
        },
      };
    }
    if (!shouldLowerEmail4To3(result, responseText)) return result;
    return {
      ...result,
      score: 3,
      band: DISC_BAND_BY_SCORE[3],
      summary: `${result.summary || ""}（校准：泛化表达偏多且细节不足，避免4分虚高）`.trim(),
      calibration: {
        adjusted: true,
        reason: "email_4_to_3_guardrail",
      },
    };
  }

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
