import { wc } from "../utils";
import { buildAnnotationSegments, countAnnotations } from "../annotations/parseAnnotations";

export const MIN_DISCUSSION_WORDS_FOR_GUARDRAIL = 60;

const TAG_STANCE_UNCLEAR = "stance_unclear";
const TAG_NO_ENGAGEMENT = "no_engagement";
const TAG_BASIC_GRAMMAR = "basic_grammar";
const TAG_GOAL_COVERAGE = "goal_coverage";

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

function normalizeTagKey(tag) {
  const t = String(tag || "").trim().toLowerCase();
  if (!t) return "";
  if (/stance|position unclear|opinion unclear|立场|观点/.test(t)) return TAG_STANCE_UNCLEAR;
  if (/engagement|no engagement|互动|回应|参与/.test(t)) return TAG_NO_ENGAGEMENT;
  if (/grammar|grammatical|语法/.test(t)) return TAG_BASIC_GRAMMAR;
  if (/goal|coverage|task completion|目标|任务|完成度/.test(t)) return TAG_GOAL_COVERAGE;
  return t;
}

function countByTag(patterns = []) {
  return patterns.reduce((acc, p) => {
    const tag = normalizeTagKey(p?.tag);
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
      message: "Can be refined for smoother flow and more precise expression.",
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

function clampDimScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, n));
}

function normalizeRubric(input, fallbackScore = 0) {
  const defaultWeights = { task_fulfillment: 0.4, organization_coherence: 0.3, language_use: 0.3 };
  const dim = input?.dimensions || {};
  const task = clampDimScore(dim?.task_fulfillment?.score ?? fallbackScore);
  const org = clampDimScore(dim?.organization_coherence?.score ?? fallbackScore);
  const lang = clampDimScore(dim?.language_use?.score ?? fallbackScore);
  const weighted = task * defaultWeights.task_fulfillment + org * defaultWeights.organization_coherence + lang * defaultWeights.language_use;
  return {
    dimensions: {
      task_fulfillment: {
        score: task,
        weight: defaultWeights.task_fulfillment,
        definition: "How fully and accurately task requirements are addressed.",
        reason: String(dim?.task_fulfillment?.reason || ""),
      },
      organization_coherence: {
        score: org,
        weight: defaultWeights.organization_coherence,
        definition: "Logical flow, progression, and coherence across ideas.",
        reason: String(dim?.organization_coherence?.reason || ""),
      },
      language_use: {
        score: lang,
        weight: defaultWeights.language_use,
        definition: "Grammar control, vocabulary precision, and sentence clarity.",
        reason: String(dim?.language_use?.reason || ""),
      },
    },
    weighted_score: Number(weighted.toFixed(2)),
    method: "weighted_combination",
    note: "Training-oriented structural rubric. Not official ETS scoring.",
  };
}

function buildScoreConfidence(type, rubric, responseText) {
  const dims = rubric?.dimensions || {};
  const reliableAspects = [];
  const uncertainAspects = [];

  if (Number.isFinite(dims?.task_fulfillment?.score)) reliableAspects.push("task_fulfillment");
  if (Number.isFinite(dims?.language_use?.score)) reliableAspects.push("language_use");
  if (Number.isFinite(dims?.organization_coherence?.score) && wc(responseText || "") >= 70) {
    reliableAspects.push("organization_coherence");
  }

  if (type === "discussion") {
    uncertainAspects.push("nuanced_argument_quality");
    if (wc(responseText || "") < 110) uncertainAspects.push("support_depth_in_short_response");
  } else {
    uncertainAspects.push("tone_register_nuance");
    if (wc(responseText || "") < 90) uncertainAspects.push("specificity_depth_in_short_response");
  }

  return {
    reliable_aspects: [...new Set(reliableAspects)].slice(0, 3),
    uncertain_aspects: [...new Set(uncertainAspects)].slice(0, 3),
    qualitative_only: true,
  };
}

function detectConfidenceState(type, responseText, confidence, keyProblems) {
  const reasons = [];
  const words = wc(responseText || "");
  const reliable = Array.isArray(confidence?.reliable_aspects) ? confidence.reliable_aspects.length : 0;
  const uncertain = Array.isArray(confidence?.uncertain_aspects) ? confidence.uncertain_aspects.length : 0;

  if (type === "email" && words < 55) reasons.push("very_short_response");
  if (type === "discussion" && words < 65) reasons.push("very_short_response");
  if (reliable <= 1 && uncertain >= 2) reasons.push("limited_reliable_signals");
  if (!Array.isArray(keyProblems) || keyProblems.length === 0) reasons.push("insufficient_qualitative_evidence");

  return {
    level: reasons.length > 0 ? "low" : "normal",
    qualitative_priority: reasons.length > 0,
    reasons,
  };
}

function compactText(input, max = 160) {
  const s = String(input || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractAnnotatedExample(plainText, ann) {
  const src = String(plainText || "");
  if (!src) return "";
  const start = Number.isInteger(ann?.start) ? ann.start : -1;
  const end = Number.isInteger(ann?.end) ? ann.end : -1;
  if (start >= 0 && end > start && end <= src.length) {
    const snippet = src.slice(start, end).trim();
    if (snippet) return snippet;
  }
  return "";
}

function buildKeyProblems(result, responseText, annotationParsed) {
  const plainText = String(annotationParsed?.plainText || responseText || "");
  const annotations = Array.isArray(annotationParsed?.annotations) ? annotationParsed.annotations : [];
  const candidates = [];

  const grouped = new Map();
  annotations
    .filter((a) => a?.level === "red" || a?.level === "orange")
    .forEach((ann) => {
      const key = `${ann.level}|${String(ann.message || "").toLowerCase().trim()}`;
      const prev = grouped.get(key);
      if (prev) {
        prev.count += 1;
      } else {
        grouped.set(key, { ann, count: 1 });
      }
    });

  for (const { ann, count } of grouped.values()) {
    const example = extractAnnotatedExample(plainText, ann);
    if (!example) continue;
    const impact = (ann.level === "red" ? 90 : 70) + Math.min(10, (count - 1) * 3);
    const explanation = compactText(ann.message || (ann.level === "red" ? "This issue harms clarity and grammar accuracy." : "This wording weakens clarity and precision."));
    const action = compactText(ann.fix || (ann.level === "red" ? "Rewrite this part using a grammatically correct structure." : "Rewrite this part with clearer and more precise wording."));
    if (!explanation || !action) continue;
    candidates.push({
      impact,
      explanation,
      example: compactText(example, 120),
      action,
    });
  }

  if (candidates.length === 0) {
    const patterns = Array.isArray(result?.patterns) ? result.patterns : [];
    const sentences = splitSentences(responseText);
    patterns
      .filter((p) => Number(p?.count || 0) > 0)
      .slice(0, 3)
      .forEach((p, i) => {
        const example = compactText(sentences[i] || sentences[0] || "");
        const explanation = compactText(p?.summary || p?.tag || "");
        if (!example || !explanation) return;
        candidates.push({
          impact: 60 + Math.min(10, Number(p?.count || 0) * 2),
          explanation,
          example,
          action: "Revise this sentence to be more specific and logically connected to your main point.",
        });
      });
  }

  const dedup = [];
  const seen = new Set();
  for (const item of candidates.sort((a, b) => b.impact - a.impact)) {
    const key = `${item.explanation}|${item.example}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(item);
    if (dedup.length >= 3) break;
  }

  return dedup.map((x) => ({
    explanation: x.explanation,
    example: x.example,
    action: x.action,
  }));
}

export function calibrateScoreReport(type, result, responseText) {
  if (!result || typeof result !== "object") return result;

  const parsedScore = Number.isFinite(Number(result.score)) ? Number(result.score) : 0;
  const rubric = normalizeRubric(result.rubric, parsedScore);
  const rawScore = rubric.weighted_score;
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
  const keyProblems = buildKeyProblems(result, responseText, annotationParsed);
  const scoreConfidence = buildScoreConfidence(type, rubric, responseText);
  const confidenceState = detectConfidenceState(type, responseText, scoreConfidence, keyProblems);

  return {
    ...result,
    score: finalScore,
    band: finalBand,
    annotationParsed,
    annotationSegments: buildAnnotationSegments(annotationParsed),
    annotationCounts: countAnnotations(annotationParsed.annotations),
    rubric,
    score_confidence: scoreConfidence,
    confidence_state: confidenceState,
    key_problems: keyProblems,
    calibration: {
      adjusted,
      rawScore,
      finalScore,
      reasons,
    },
  };
}
