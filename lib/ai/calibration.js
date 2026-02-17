import { wc } from "../utils";
import { buildAnnotationSegments, countAnnotations } from "../annotations/parseAnnotations";

export const MIN_DISCUSSION_WORDS_FOR_GUARDRAIL = 60;

const TAG_STANCE_UNCLEAR = "绔嬪満涓嶆竻鏅?";
const TAG_NO_ENGAGEMENT = "鏈洖搴斾粬浜鸿鐐?";
const TAG_BASIC_GRAMMAR = "鎷煎啓/鍩虹璇硶";
const TAG_GOAL_COVERAGE = "鐩爣瀹屾垚涓嶅厖鍒?";

function roundToHalf(v) {
  return Math.round(Number(v || 0) * 2) / 2;
}

function clampScore(v) {
  return Math.max(0, Math.min(5, roundToHalf(v)));
}

function scoreToBand(score) {
  const s = clampScore(score);
  if (s === 0) return 1.0;
  return Number((s + 0.5).toFixed(1));
}

function countByTag(patterns = []) {
  return patterns.reduce((acc, p) => {
    const tag = String(p?.tag || "").trim();
    if (!tag) return acc;
    acc[tag] = (acc[tag] || 0) + Number(p?.count || 0);
    return acc;
  }, {});
}

function sentenceSpans(text) {
  const t = String(text || "");
  const spans = [];
  let start = 0;
  for (let i = 0; i < t.length; i += 1) {
    if (/[.!?]/.test(t[i])) {
      let end = i + 1;
      while (end < t.length && /\s/.test(t[end])) end += 1;
      if (end > start) spans.push({ start, end, text: t.slice(start, end).trim() });
      start = end;
    }
  }
  if (start < t.length) spans.push({ start, end: t.length, text: t.slice(start).trim() });
  return spans.filter((s) => s.text.length > 0);
}

function hasClearStanceInternal(text) {
  const t = String(text || "");
  return /\b(i think|i believe|i would argue|in my opinion|i agree|i disagree)\b/i.test(t);
}

export function hasClearStance(text) {
  return hasClearStanceInternal(text);
}

export function reasonSignalCount(text) {
  const matches = String(text || "")
    .toLowerCase()
    .match(
      /\b(because|since|for example|for instance|also|furthermore|moreover|in addition|another|first|second|therefore|so|while|although|for one thing|as a result)\b/g
    );
  return matches ? matches.length : 0;
}

export function shouldRaiseDiscussion2To3(result, responseText) {
  if (Number(result?.score) !== 2) return false;
  if (wc(responseText || "") < MIN_DISCUSSION_WORDS_FOR_GUARDRAIL) return false;
  if (!hasClearStanceInternal(responseText)) return false;
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

function lexicalRepetitionPenalty(text) {
  const tokens = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (tokens.length < 40) return 0;
  const freq = {};
  tokens.forEach((w) => {
    freq[w] = (freq[w] || 0) + 1;
  });
  const repeatedShare = Object.values(freq).reduce((n, c) => n + (c >= 4 ? c : 0), 0) / tokens.length;

  const spans = sentenceSpans(text);
  const starters = {};
  spans.forEach((s) => {
    const first = s.text.toLowerCase().split(/\s+/)[0] || "";
    if (!first) return;
    starters[first] = (starters[first] || 0) + 1;
  });
  const maxStarterRepeat = Math.max(0, ...Object.values(starters));

  if (repeatedShare >= 0.22 || maxStarterRepeat >= 3) return 0.5;
  return 0;
}

function shouldCapDiscussionAtFour(text) {
  const src = String(text || "").trim();
  if (!src) return false;
  const paragraphs = src.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const oneParagraph = paragraphs.length <= 1;
  const lacksExample = !/\b(for example|for instance|for one thing|such as)\b/i.test(src);
  const shallowReasoning = reasonSignalCount(src) < 3 || sentenceSpans(src).length <= 4;
  return oneParagraph && lacksExample && shallowReasoning;
}

function getAnnotationState(result, responseText) {
  const plainText = String(result?.annotationParsed?.plainText || responseText || "");
  const annotations = Array.isArray(result?.annotationParsed?.annotations)
    ? [...result.annotationParsed.annotations]
    : [];
  return { plainText, annotations };
}

function addBlueRefinements(baseState, minBlue = 1) {
  const state = { plainText: baseState.plainText, annotations: [...baseState.annotations] };
  const spans = sentenceSpans(state.plainText);
  if (spans.length === 0) return state;

  const existingBlue = state.annotations.filter((a) => a.level === "blue").length;
  let needed = Math.max(0, minBlue - existingBlue);
  if (needed === 0) return state;

  const used = new Set(state.annotations.map((a) => `${a.start}-${a.end}`));
  for (let i = 0; i < spans.length && needed > 0; i += 1) {
    const s = spans[i];
    if (!s.text || s.text.length < 10) continue;
    const key = `${s.start}-${s.end}`;
    if (used.has(key)) continue;
    state.annotations.push({
      level: "blue",
      message: "可进一步优化句子流畅度与表达精确性。",
      fix: "Tighten this sentence by using a more specific verb and clearer logical connector.",
      start: s.start,
      end: s.end,
    });
    used.add(key);
    needed -= 1;
  }
  return state;
}

function ensureAnnotationsByScore(result, responseText, finalScore, finalBand) {
  let state = getAnnotationState(result, responseText);
  const isHigh = Number(finalScore) >= 4.5 || Number(finalBand) >= 5;
  if (state.annotations.length === 0) {
    state = addBlueRefinements(state, isHigh ? 2 : 1);
  } else if (isHigh) {
    state = addBlueRefinements(state, 1);
  }
  return state;
}

export function calibrateScoreReport(type, result, responseText) {
  if (!result || typeof result !== "object") return result;

  const rawScore = Number.isFinite(Number(result.score)) ? Number(result.score) : 0;
  let finalScore = rawScore;
  let adjusted = false;
  const reasons = [];

  if (type === "email") {
    const t = String(responseText || "").toLowerCase();
    if (rawScore === 5 && /\bsubscriber of\b/.test(t)) {
      finalScore = Math.min(finalScore, 4);
      adjusted = true;
      reasons.push("email_5_to_4_guardrail");
    }

    if (rawScore >= 4) {
      if (wc(responseText || "") < 50) {
        finalScore = Math.min(finalScore, 3);
        adjusted = true;
        reasons.push("email_thin_response_cap");
      }
      const genericCount = emailGenericSignalCount(responseText);
      const concreteCount = emailConcreteSignalCount(responseText);
      const tagCounts = countByTag(result?.patterns || []);
      const goalCoverageRisk = (tagCounts[TAG_GOAL_COVERAGE] || 0) >= 2;
      if (goalCoverageRisk || (genericCount >= 3 && concreteCount <= 3) || (genericCount >= 2 && concreteCount < 2)) {
        finalScore = Math.min(finalScore, 3);
        adjusted = true;
        reasons.push("email_generic_expression_cap");
      }
    }
  }

  if (type === "discussion") {
    if (shouldRaiseDiscussion2To3(result, responseText)) {
      finalScore = Math.max(finalScore, 3);
      adjusted = true;
      reasons.push("discussion_2_to_3_guardrail");
    }

    if (finalScore > 4 && shouldCapDiscussionAtFour(responseText)) {
      finalScore = 4;
      adjusted = true;
      reasons.push("discussion_depth_cap_4");
    }
  }

  const repPenalty = lexicalRepetitionPenalty(responseText);
  if (repPenalty > 0) {
    finalScore -= repPenalty;
    adjusted = true;
    reasons.push("repetition_penalty");
  }

  finalScore = clampScore(finalScore);
  const finalBand = scoreToBand(finalScore);

  const annotationState = ensureAnnotationsByScore(result, responseText, finalScore, finalBand);
  const annotationParsed = {
    plainText: annotationState.plainText,
    annotations: annotationState.annotations,
    parseError: false,
    hasMarkup: annotationState.annotations.length > 0,
  };

  return {
    ...result,
    score: finalScore,
    band: finalBand,
    annotationParsed,
    annotationSegments: buildAnnotationSegments(annotationParsed),
    annotationCounts: countAnnotations(annotationParsed.annotations),
    calibration: {
      adjusted,
      rawScore,
      finalScore,
      reasons,
    },
  };
}
