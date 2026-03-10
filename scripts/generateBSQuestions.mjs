/**
 * Robust Build a Sentence generator pipeline:
 * 1) online candidate generation
 * 2) hard validation (schema/runtime)
 * 3) AI quality scoring filter
 * 4) pool-based set assembly with TPO difficulty mix (1/7/2)
 *
 * Usage:
 *   node scripts/generateBSQuestions.mjs
 *
 * Env:
 *   DEEPSEEK_API_KEY=...
 *   DEEPSEEK_PROXY_URL=http://127.0.0.1:10808   (optional)
 *   BS_TARGET_SETS=6                              (optional)
 *   BS_MAX_ROUNDS=32                              (optional)
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { callDeepSeekViaCurl, resolveProxyUrl, formatDeepSeekError } = require("../lib/ai/deepseekHttp.js");
const { validateQuestionSet, validateQuestion } = require("../lib/questionBank/buildSentenceSchema.js");
const { hardFailReasons, warnings: qualityWarnings } = require("../lib/questionBank/qualityGateBuildSentence.js");
const {
  getStructuredPromptParts,
  validateStructuredPromptParts,
} = require("../lib/questionBank/buildSentencePromptContract.js");
const {
  normalizeRuntimeQuestion,
  validateRuntimeQuestion,
} = require("../lib/questionBank/runtimeModel.js");
const {
  estimateQuestionDifficulty,
  evaluateSetDifficultyAgainstTarget,
  ETS_2026_TARGET_COUNTS_10,
} = require("../lib/questionBank/difficultyControl.js");
const { isEmbeddedQuestion } = require("../lib/questionBank/etsProfile.js");
const { validateAllSets } = require("./validate-bank.js");

const OUTPUT_PATH = process.env.BS_OUTPUT_PATH ? resolve(String(process.env.BS_OUTPUT_PATH)) : resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const RESERVE_PATH = resolve(__dirname, "..", "data", "buildSentence", "reserve_pool.json");
const CIRCUIT_BREAKER_LOG_PATH = resolve(__dirname, "..", "data", "buildSentence", "circuit_breaker_log.json");
const TARGET_SET_COUNT = Number(process.env.BS_TARGET_SETS || 6);
const MIN_REVIEW_SCORE = Number(process.env.BS_MIN_REVIEW_SCORE || 78);
const MIN_REVIEW_OVERALL = Number(process.env.BS_MIN_REVIEW_OVERALL || 84);
const MIN_ETS_SIMILARITY = Number(process.env.BS_MIN_ETS_SIMILARITY || 72);
const MIN_SOLVABILITY = Number(process.env.BS_MIN_SOLVABILITY || 78);
const CIRCUIT_BREAKER_WINDOW = 3;
const CIRCUIT_BREAKER_MIN_GENERATED = 4;
const CIRCUIT_BREAKER_MIN_ACCEPT_RATE = 0.2;
const CIRCUIT_BREAKER_COOLDOWN_ROUNDS = 3;

function loadEnv() {
  const paths = [
    resolve(__dirname, "..", ".env.local"),
    resolve(__dirname, "..", ".env"),
  ];
  for (const p of paths) {
    try {
      const txt = readFileSync(p, "utf8");
      txt.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
        if (!m) return;
        if (process.env[m[1]]) return;
        process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch (_) {
      // ignore missing env file
    }
  }
}

function normalizeText(s) {
  return String(s || "").trim();
}

function endsWithQuestionMark(answer) {
  return normalizeText(answer).endsWith("?");
}

function uniqBy(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function parseJsonArray(text) {
  const body = String(text || "");
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error("no JSON array in model output");
  }
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Split a chunk that has more than maxWords into sub-chunks.
 * Strategy: split into ceil and floor halves to keep collocations natural.
 */
function autoSplitChunk(chunk, maxWords = 3) {
  const words = chunk.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [chunk];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

/**
 * Ensure effective chunk count is at least minCount by splitting longest chunks.
 */
function ensureMinChunkCount(chunks, distractor, minCount = 4) {
  let result = [...chunks];
  let maxIter = 10;
  while (maxIter-- > 0) {
    const effective = result.filter((c) => c !== distractor);
    if (effective.length >= minCount) break;
    // find longest effective chunk to split
    let longestIdx = -1;
    let longestLen = 0;
    result.forEach((c, i) => {
      if (c === distractor) return;
      const wLen = c.split(/\s+/).length;
      if (wLen > longestLen) { longestLen = wLen; longestIdx = i; }
    });
    if (longestIdx < 0 || longestLen < 2) break;
    const words = result[longestIdx].split(/\s+/);
    const mid = Math.ceil(words.length / 2);
    result.splice(longestIdx, 1, words.slice(0, mid).join(" "), words.slice(mid).join(" "));
  }
  return result;
}

function wordCountsFromText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[.,!?;:]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .reduce((acc, word) => {
      acc[word] = (acc[word] || 0) + 1;
      return acc;
    }, {});
}

function subtractWordCounts(base, minus) {
  const out = { ...base };
  Object.entries(minus || {}).forEach(([word, count]) => {
    if (!out[word]) return;
    out[word] = Math.max(0, out[word] - count);
    if (out[word] === 0) delete out[word];
  });
  return out;
}

function chunkWordCounts(chunk) {
  return wordCountsFromText(String(chunk || ""));
}

function canConsumeChunk(counts, chunk) {
  const needed = chunkWordCounts(chunk);
  return Object.entries(needed).every(([word, count]) => (counts[word] || 0) >= count);
}

function consumeChunk(counts, chunk) {
  const out = { ...counts };
  Object.entries(chunkWordCounts(chunk)).forEach(([word, count]) => {
    out[word] = Math.max(0, (out[word] || 0) - count);
    if (out[word] === 0) delete out[word];
  });
  return out;
}

function autoRepairWordBag(answer, prefilled, chunks, distractor) {
  const answerCounts = wordCountsFromText(answer);
  const prefilledCounts = wordCountsFromText((prefilled || []).join(" "));
  let remaining = subtractWordCounts(answerCounts, prefilledCounts);
  const repaired = [];

  for (const chunk of (chunks || []).filter((c) => c !== distractor)) {
    if (canConsumeChunk(remaining, chunk)) {
      repaired.push(chunk);
      remaining = consumeChunk(remaining, chunk);
    }
  }

  const missingWords = Object.entries(remaining).flatMap(([word, count]) =>
    Array.from({ length: count }, () => word),
  );

  // Only repair the safest case: exactly one single-word gap remains.
  if (missingWords.length === 1) {
    repaired.push(missingWords[0]);
  }

  return distractor == null ? repaired : [...repaired, distractor];
}

function normalizeQuestion(raw, tempId) {
  const q = raw && typeof raw === "object" ? raw : {};

  // Fix 1: lowercase chunks and distractor BEFORE intermediate processing
  // so ensureMinChunkCount's `c !== distractor` comparison is always case-consistent.
  let chunks = Array.isArray(q.chunks)
    ? q.chunks.map((c) => normalizeText(c).toLowerCase()).filter(Boolean)
    : [];
  const prefilled = Array.isArray(q.prefilled)
    ? q.prefilled.map((c) => normalizeText(c)).filter(Boolean)
    : [];
  const rawPositions = (q.prefilled_positions && typeof q.prefilled_positions === "object" && !Array.isArray(q.prefilled_positions))
    ? q.prefilled_positions
    : {};

  const distractor = normalizeText(q.distractor)?.toLowerCase() || null;
  const answer = normalizeText(q.answer);
  const answerWords = answer.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);

  // Auto-fix: Split any chunk with >3 words
  chunks = chunks.flatMap((c) => autoSplitChunk(c, 3));

  // Auto-fix: Remove prefilled coverage from chunks.
  // AI often duplicates prefilled words into chunks in two ways:
  //   (a) exact phrase match: prefilled=["the report"], chunks includes "the report"
  //   (b) split words: prefilled=["the report"], chunks includes "the" and "report" separately
  // Strategy: greedily consume prefilled words from chunks (single-word first).
  if (prefilled.length > 0) {
    // Build a word-level budget of what prefilled covers
    const prefilledWordBudget = [];
    prefilled.forEach((pf) => {
      pf.toLowerCase().split(/\s+/).filter(Boolean).forEach((w) => prefilledWordBudget.push(w));
    });
    // Remove exact-phrase matches first
    const prefilledPhraseSet = new Set(prefilled.map((p) => p.toLowerCase()));
    chunks = chunks.filter((c) => !prefilledPhraseSet.has(c.toLowerCase()));
    // Then remove single-word chunks that are covered by the prefilled budget
    const budget = [...prefilledWordBudget];
    chunks = chunks.filter((c) => {
      const cWords = c.toLowerCase().split(/\s+/);
      if (cWords.length === 1) {
        const idx = budget.indexOf(cWords[0]);
        if (idx !== -1) { budget.splice(idx, 1); return false; }
      }
      return true;
    });
  }

  // Repair the most common deterministic word-bag failures before validation.
  chunks = autoRepairWordBag(answer, prefilled, chunks, distractor);

  // Auto-fix: Ensure at least 4 effective chunks
  chunks = ensureMinChunkCount(chunks, distractor, 4);

  // Auto-fix: Correct prefilled_positions based on actual answer text.
  // Fix 2: fallback lookup is case-insensitive so AI key-case mismatches don't lose positions.
  const rawPositionsLower = Object.fromEntries(
    Object.entries(rawPositions).map(([k, v]) => [k.toLowerCase(), v])
  );
  const correctedPositions = {};
  prefilled.forEach((pf) => {
    const pfWords = pf.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
    if (pfWords.length === 0) return;

    let found = false;
    for (let i = 0; i <= answerWords.length - pfWords.length; i++) {
      const slice = answerWords.slice(i, i + pfWords.length);
      if (slice.every((w, idx) => w === pfWords[idx])) {
        correctedPositions[pf] = i;
        found = true;
        break;
      }
    }
    // Fallback: case-insensitive key lookup on original AI-provided positions
    if (!found) {
      const fallback = rawPositionsLower[pf.toLowerCase()];
      if (fallback !== undefined) correctedPositions[pf] = fallback;
    }
  });

  // Auto-fix: drop any prefilled item that couldn't be located in the answer.
  // If AI invents a prefilled phrase not present in answer, discard it silently
  // (question becomes harder but word bag stays valid).
  const validPrefilled = prefilled.filter((pf) => correctedPositions[pf] !== undefined);

  const promptParts = getStructuredPromptParts(q);
  const promptContract = validateStructuredPromptParts(q, { requireStructured: false });
  const renderedPrompt = promptParts.hasStructured ? promptContract.renderedPrompt : normalizeText(q.prompt);

  return {
    id: normalizeText(q.id) || tempId,
    prompt: renderedPrompt,
    ...(promptParts.hasStructured
      ? {
          prompt_context: promptParts.context,
          prompt_task_kind: promptParts.taskKind,
          prompt_task_text: promptParts.taskText,
        }
      : {}),
    answer,
    chunks,
    prefilled: validPrefilled,
    prefilled_positions: correctedPositions,
    distractor,
    has_question_mark: endsWithQuestionMark(answer),
    grammar_points: Array.isArray(q.grammar_points)
      ? q.grammar_points.map((g) => normalizeText(g)).filter(Boolean)
      : [],
  };
}

function stableAnswerKey(q) {
  return normalizeText(q.answer).toLowerCase();
}

/**
 * Classify a question's answer into one of 6 TPO structural types.
 * Used for quota tracking and targeted generation.
 */
function classifyAnswerType(q) {
  const a = String(q.answer || "").toLowerCase();
  const gps = (Array.isArray(q?.grammar_points) ? q.grammar_points : []).map((x) => String(x || "").toLowerCase()).join(" | ");
  // Interrogative frame: polite information-seeking question with embedded clause
  if (
    /^(can you tell me|could you tell me|do you know|would you mind telling me|could you explain|can you remind me)\b/i.test(q.answer) ||
    /\b(interrogative frame|polite question frame)\b/.test(gps)
  )
    return "interrogative";
  // 1st-person embedded — check BEFORE 3rd-reporting to prevent "I asked..." being misclassified
  if (
    /\b(1st-embedded|1st person|1st-person)\b/.test(gps) ||
    /\b(have no idea|had no idea|don't understand|didn't understand|couldn't understand|found out|would love to know|can't decide|don't know|didn't know|do not know|did not know|does not know)\b/.test(a) ||
    (/^i\b/i.test(a) && /\b(what|when|where|who|how|whether|if)\b/.test(a) && !/^i (did not|didn't|do not|don't|have not|haven't|could not|couldn't|am not|was not|wasn't|are not|aren't)\b/i.test(a))
  )
    return "1st-embedded";
  // 3rd-person reporting (only after ruling out 1st-person)
  if (
    /\b(wanted to know|asked|inquired|was curious|were curious|needed to know|was wondering|were wondering|wants to know|needs to know|curious about)\b/.test(a) ||
    /\b(3rd-reporting|reporting verb|indirect question)\b/.test(gps)
  )
    return "3rd-reporting";
  // Relative/contact clause
  if (
    /\bthe \w+.*(?: i | you | he | she | we | they )|\b(?:that|which|who|whom) (?:i |you |he |she |we |they )/i.test(a) ||
    /\b(relative clause|contact clause)\b/.test(gps)
  )
    return "relative";
  // Negation
  if (/\b(did not|didn't|have not|haven't|could not|couldn't|was not|wasn't|is not|isn't|am not|are not|aren't|has not|hasn't|do not|don't|no longer|not able|were not|weren't)\b/.test(a))
    return "negation";
  return "direct";
}

/**
 * Per-set quota: how many questions of each type 脳 difficulty per 10-question set.
 * Derived from statistical analysis of 60 real TPO questions across 6 sets.
 * Difficulty distribution per set: easy=1, medium=7, hard=2.
 * Type distribution within each difficulty: from TPO analysis.
 *
 * easy  (1/set):  negation锟?5%, 3rd-reporting锟?8%, interrogative锟?8%, 1st-embedded锟?%
 * medium (7/set): 3rd-reporting锟?8%, negation锟?2%, 1st-embedded锟?2%, interrogative锟?%, direct锟?%, relative锟?%
 * hard  (2/set):  3rd-reporting锟?5%, 1st-embedded锟?5%, relative锟?9%, interrogative锟?3%, direct锟?3%, negation锟?%
 */
const TYPE_LIST = ["negation", "3rd-reporting", "1st-embedded", "interrogative", "direct", "relative"];
const WILLING_TYPES = ["3rd-reporting", "negation", "1st-embedded"]; // AI generates naturally
const TPO_TYPE_TARGET_RATIO = Object.freeze({
  "negation": 0.183,
  "3rd-reporting": 0.417,
  "1st-embedded": 0.15,
  "interrogative": 0.1,
  "direct": 0.067,
  "relative": 0.083,
});

function buildRejectFeedbackHints(rejectReasons) {
  const entries = Object.entries(rejectReasons || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  if (entries.length === 0) return "";

  const hints = [];
  entries.forEach(([reason]) => {
    const r = String(reason).toLowerCase();
    if (r.includes("chunks (minus distractor) + prefilled words")) {
      hints.push("Strictly ensure chunks(+prefilled) exactly reconstruct answer words, no missing or extra words.");
    }
    if (r.includes("effective chunks count")) {
      hints.push("Keep effective chunk count in the allowed range and avoid too few chunks.");
    }
    if (r.includes("must be at most 3 words")) {
      hints.push("Every chunk must be at most 3 words. Split long chunks.");
    }
    if (r.includes("distractor must not appear in answer")) {
      hints.push("Distractor tokens must never appear in answer.");
    }
    if (r.includes("question mark")) {
      hints.push("Maintain question/statement ratio within set-level target.");
    }
    if (r.includes("embedded")) {
      hints.push("Include 6-8 embedded-question items in DECLARATIVE form (not questions). Use wanted to know, asked, was curious. Ensure 7-9 items have single-word distractors.");
    }
    if (r.includes("review:blocker") || r.includes("solvability")) {
      hints.push("Avoid ambiguous chunk order; each item should have one clearly best arrangement.");
    }
    if (r.includes("prompt_task_text") || r.includes("prompt must include an explicit task")) {
      hints.push("prompt_task_text MUST be an explicit task/question, NOT background. Use patterns: 'What did [person] ask?', 'How do you respond?', 'Tell your friend about it.', 'Describe what happened.' Put background/context in prompt_context, NOT in prompt_task_text.");
    }
  });

  const uniq = [...new Set(hints)];
  if (uniq.length === 0) return "";
  return `\nRecent rejection feedback (must fix):\n- ${uniq.join("\n- ")}\n`;
}

const TYPE_DIFFICULTY_HINTS = {
  "negation": {
    easy: `ALL answers in this group: simple negative statement, 7-10 words.
Structure: "I did not [verb]." / "I could not [verb]." / "I am not [adj]." / "I cannot [verb]."
Examples:
- "I did not have time to finish the report."
- "I could not find the reservation confirmation."
- "I am not going to sign for the package."
Prompt: prompt_task_kind="respond", prompt_task_text="How do you respond?" or "What do you say?"
Distractor: "did" or "do" or morphological variant.
SCORER FENCE (easy): Only "did not" / "do not" / "cannot" / "could not" / "am not" / "is not". NO "have not been" (passive). NO "had not" (past perfect). NO comparative. NO relative clause. NO embedded wh-clause.
PREFILLED (easy): Use prefilled=["i"] at position 0. NEVER ["not"].`,

    medium: `ALL answers in this group: negative statement, 9-12 words, may include a short embedded element.
Examples WITH correct prefilled (study these carefully):
  answer: "I did not understand what the manager explained."  prefilled=["i"] pos=0 ✔
  answer: "I have not received any confirmation about the schedule."  prefilled=["i"] pos=0 ✔
  answer: "He did not know why the meeting was postponed."  prefilled=["he"] pos=0 ✔
  BAD: answer="I did not attend the interview last week."  prefilled=["not"] ✘ WRONG
  CORRECT: answer="I did not attend the interview last week."  prefilled=["i"] pos=0 ✔ RIGHT
  BAD: answer="He did not know why the package was rerouted."  prefilled=["not"] ✘ WRONG
  CORRECT: answer="He did not know why the package was rerouted."  prefilled=["he"] pos=0 ✔ RIGHT
Prompt: prompt_task_kind="respond", prompt_task_text="How do you respond?" or "What do you say?" Distractor: "did"/"do" or morphological variant.
SCORER FENCE (medium): Prefer simple past ("did not") or present perfect ("have not"). AVOID past perfect negation ("had not done" -> HARD). AVOID passive negation ("was not approved", "has not been sent" -> HARD). At most ONE advanced grammar feature.
PREFILLED (medium/easy): ALL negation answers use the SUBJECT as prefilled. 1st-person ("I did not..."): prefilled=["i"] at position 0. 3rd-person: use a DESCRIPTIVE 2-word subject NP, e.g. prefilled=["the manager"], ["the professor"], ["the student"]. NEVER use bare ["he"]/["she"]/["they"] — always a descriptive NP. NEVER use ["not"] as prefilled — "not" belongs in chunks, not in prefilled.`,

    hard: `ALL answers in this group: negation + advanced grammar complexity, 10-13 words.
Examples:
- "I had not realized how quickly the project deadline was approaching."
- "I did not understand why the meeting had been postponed again."
Hard MUST come from structure: past perfect negation, passive/passive-progressive inside clause, or negation + embedded grammar trap.
Distractor: morphological variant (e.g. "realized/realize", "approaching/approach").
PREFILLED REMINDER: Hard sentences are 10-13 words — chunks MUST still be ≤ 8. Give the SUBJECT as prefilled: subject pronoun ("i", "she", "he") or 2-word subject NP ("the professor", "the manager"). Example: answer=11 words, prefilled=["the professor"] (2 words) -> R=9 -> shorten sentence to 10 words -> R=8. Difficulty comes from GRAMMAR STRUCTURE, not from chunk count.`,
  },

  "3rd-reporting": {
    easy: `ALL answers in this group: short third-person reporting, 8-10 words.
Structure: "[Descriptive NP] wanted to know if [short clause]." / "[Descriptive NP] asked what time..."
Subject MUST be 3rd-person descriptive NP — NEVER "I/my/me". NEVER bare "he/she/they".
Examples:
- "The manager wants to know if you need a ride."
- "My advisor asked me what time the meeting starts."
- "Some colleagues wanted to know if the library was open."
Prompt: prompt_task_kind="report", prompt_task_text="What did the manager ask?" or "What does the professor want to know?" Distractor: "did" or "do".
SCORER FENCE (easy): Embedded clause uses simple present or simple past only. NO passive ("was approved"). NO past perfect ("had gone"). NO "whom". NO comparative.`,

    medium: `ALL answers in this group: third-person reporting, 10-13 words.
Structure: "[Descriptive NP] [wanted to know / asked / was curious / needed to know] [wh/if clause]"
Subject MUST be 3rd-person descriptive NP — NEVER "I/my/me" (not 1st-person). NEVER bare "he/she/they".
Use: the manager / the professor / some colleagues / the supervisor / the librarian / the advisor / her study partner
Vary wh-words across the batch: if(3), what(2), where(2), why(2), when(1)
Declarative word order in clause (NO inversion). Distractor: "did"/"do" for most.
SCORER FENCE (medium): Embedded clause uses simple past or simple present ONLY. STRICTLY AVOID past perfect in embedded clause ("had been done", "had gone" -> HARD). STRICTLY AVOID passive voice in embedded clause ("whether it had been approved", "when it would be submitted" -> HARD). AVOID "whom". Maximum ONE advanced grammar feature.
PREFILLED (medium/easy): 3rd-person answers — use a DESCRIPTIVE SUBJECT NP as prefilled. NEVER use bare pronouns ["he"], ["she"], ["they"] — expand to the full subject noun phrase. 2-word NP: ["the manager"], ["the professor"], ["the student"], ["the librarian"], ["the ranger"]. 3-word NP: ["some colleagues"], ["her study partner"], ["the front desk"], ["the shop owner"]. Choose 2-word or 3-word based on what sounds most natural for the subject.`,

    hard: `ALL answers in this group: third-person reporting with structurally complex embedded clause, 10-13 words.
Complexity options (MUST include at least one):
- Past perfect in clause: "He wanted to know where all the files had gone."
- Passive in clause: "She wanted to know when the report would be submitted."
- whom: "She wanted to know whom I would give the presentation to."
- Two-layer: "The manager wanted to know how we had been able to finish on time."
Hard MUST come from grammar complexity, not from padding the sentence.
Distractor: morphological variant or "whom/who", "where/when" function-word swap.
PREFILLED REMINDER: Hard sentences are 10-13 words — chunks MUST still be ≤ 8. Give the SUBJECT as prefilled: ALWAYS a descriptive 2-word subject NP ("the professor", "the manager", "the supervisor"). NEVER "i" (not 1st-person), NEVER bare "she"/"he". Example: answer=11 words, prefilled=["the professor"] (2 words) -> R=9 -> shorten sentence to 10 words -> R=8. Difficulty comes from GRAMMAR STRUCTURE, not from chunk count.`,
  },

  "1st-embedded": {
    easy: `ALL answers in this group: first-person embedded, 8-10 words, simple structure.
Structure: "I have no idea [wh-clause]." / "I am not sure [wh-clause]."
Examples:
- "I have no idea where they are going."
- "I am not sure what time the event starts."
- "I do not know if the store is open."
Prompt: prompt_task_kind="respond", prompt_task_text="What do you say?" or prompt_task_kind="tell", prompt_task_text="Tell your friend what you think."
Distractor: "do" or "did".
SCORER FENCE (easy): Embedded clause uses simple present only. NO passive. NO past perfect. NO comparative. NO "whom".`,

    medium: `ALL answers in this group: first-person embedded, 10-13 words.
Examples:
- "I do not understand why he decided to quit the team."
- "I found out where the new office supplies are kept."
- "I have no idea who will be leading the morning session."
- "I am not sure when the package is going to arrive."
Distractor: "did"/"does" or function-word variant.
SCORER FENCE (medium): Embedded clause uses simple past or simple present only. AVOID past perfect ("had done" -> HARD). AVOID passive voice in embedded clause ("has been approved", "is being processed" -> HARD). AVOID "whom". AVOID combining two advanced grammar features.
PREFILLED (medium/easy): 1st-embedded answers are always 1st-person. Use prefilled=["i"] at position 0. Simplest and most authentic.`,

    hard: `ALL answers in this group: complex first-person embedded, 10-13 words.
Examples:
- "I would love to know which restaurant you enjoyed the most." (superlative)
- "I have not been told who will be responsible for the final report." (passive + embedded)
- "We just found out where the new library equipment is being stored." (passive progressive)
Include passive voice OR superlative/comparative OR perfect aspect in the embedded clause. Hard MUST be signaled by grammar structure rather than answer length.
Distractor: morphological variant (e.g. "enjoyed/enjoy", "stored/store").
PREFILLED REMINDER: Hard sentences are 10-13 words — chunks MUST still be ≤ 8. Give the SUBJECT as prefilled: subject pronoun ("i", "she", "he") or 2-word subject NP ("the professor", "the manager"). Example: answer=11 words, prefilled=["the professor"] (2 words) -> R=9 -> shorten sentence to 10 words -> R=8. Difficulty comes from GRAMMAR STRUCTURE, not from chunk count.`,
  },

  "interrogative": {
    easy: `ALL answers in this group use a natural polite question frame, 8-11 words.
Allowed frames (vary across batch):
- "Can you tell me ..."
- "Could you tell me ..."
- "Do you know ..."
Core rule: embedded clause stays in declarative word order.
Examples:
- "Can you tell me what your plans are for tomorrow?"
- "Do you know if the professor covered any new material?"
Prompt: prompt_task_kind="ask", prompt_task_text="What do you ask?" or "How do you ask about it?"
Distractor: "did"/"do" or nearby auxiliary/modal variant.
SCORER FENCE (easy): Embedded clause uses simple present or simple past only. NO passive. NO past perfect. NO comparative.`,

    medium: `ALL answers in this group use a natural interrogative frame, 10-13 words, moderate embedded complexity.
Use 2-4 different polite frames across the batch. Core rule: embedded clause stays declarative.
Examples WITH correct prefilled (the 2-word opener, NEVER the embedded topic noun):
  answer: "Could you tell me how you are feeling about it?"  prefilled=["could you"] pos=0
  answer: "Can you remind me when that event was rescheduled?"  prefilled=["can you"] pos=0
  answer: "Do you know what time it opens on Sundays?"  prefilled=["do you"] pos=0
  CRITICAL: the 2-word opener is ALWAYS prefilled. NEVER a noun phrase inside the clause.
Distractor: morphological variant or nearby auxiliary/modal variant.
SCORER FENCE (medium): AVOID past perfect in embedded clause ("had been done" -> HARD). AVOID passive in embedded clause ("has been approved" -> HARD). Simple past or present tense in embedded clause only.
PREFILLED (medium/easy): ALWAYS use the 2-word opening frame as prefilled: ["could you"], ["can you"], ["do you"], ["would you"]. NEVER any noun phrase from the embedded clause as prefilled.`,

    hard: `ALL answers in this group use a natural interrogative frame with complex embedded question, 10-13 words.
The question frame stays simple. Hardness comes from the embedded clause.
Examples:
- "Could you tell me how the project team managed to finish ahead of schedule?"
- "Do you know why the final report had not been submitted yet?"
Hard MUST come from embedded grammar: tense/aspect mismatch, passive/perfect inside clause, layered embedding.
Distractor: morphological variant (e.g. "decided/decide", "managed/manage").
PREFILLED REMINDER: Hard sentences are 10-13 words — chunks MUST still be ≤ 8. Give the SUBJECT as prefilled: subject pronoun ("i", "she", "he") or 2-word subject NP ("the professor", "the manager"). Example: answer=11 words, prefilled=["the professor"] (2 words) -> R=9 -> shorten sentence to 10 words -> R=8. Difficulty comes from GRAMMAR STRUCTURE, not from chunk count.`,
  },

  "direct": {
    medium: `ALL answers in this group: direct declarative statement (no reporting verb, no negation), 9-12 words.
Describe a situation, location, preference, or fact.
Examples:
- "I found the work environment at this company to be much more relaxed."
- "The store next to the post office sells all types of winter apparel."
Prompt: prompt_task_kind="tell", prompt_task_text="Describe what happened." or "Tell your friend about it." or prompt_task_kind="respond", prompt_task_text="What do you say?"
Distractor: morphological variant (e.g. "relaxed/relax", "sells/sold").
PREFILLED (medium): use the SUBJECT as prefilled. 1st-person answers: ["i"]. 3rd-person: 2-word subject NP like ["the store"], ["the professor"]. NOT the object.`,

    hard: `ALL answers in this group: complex direct statement, 10-13 words, with comparative or structurally dense modification.
Examples:
- "This coffee tastes better than all of the other brands I have tried."
- "I found it in the back of the furniture section at the local superstore."
Prefer comparative/superlative structures, dense modifiers, or other learner-unfamiliar grammar. Do not inflate difficulty by length alone.
Distractor: morphological variant or comparative swap ("better/good", "only/once").
PREFILLED REMINDER: Hard sentences are 10-13 words — chunks MUST still be ≤ 8. Give the SUBJECT as prefilled: subject pronoun ("i", "she", "he") or 2-word subject NP ("the professor", "the manager"). Example: answer=11 words, prefilled=["the professor"] (2 words) -> R=9 -> shorten sentence to 10 words -> R=8. Difficulty comes from GRAMMAR STRUCTURE, not from chunk count.`,
  },

  "relative": {
    medium: `ALL answers in this group: contact/relative clause structure, 9-12 words.
"The [noun] [I/you] [verb]..." (contact clause - omitted relative pronoun)
Examples:
- "The bookstore I stopped by had the novel in stock."
- "The diner that opened last week serves many delicious entrees."
Prompt: prompt_task_kind="tell", prompt_task_text="Describe what you found." or prompt_task_kind="respond", prompt_task_text="What do you tell your friend?"
Distractor: morphological variant (e.g. "stopped/stop", "opened/open").
PREFILLED (medium): use the SUBJECT as prefilled. Contact clause: subject NP like ["the bookstore"], ["the diner"]. 1st-person: ["i"]. NOT the object inside the relative clause.`,

    hard: `ALL answers in this group: relative/contact clause with additional complexity, 10-13 words.
Combine relative clause with passive or perfect:
- "The desk you ordered is scheduled to arrive on Friday."
- "The book she recommended had already been checked out."
Distractor: morphological variant (e.g. "ordered/order", "recommended/recommend").
PREFILLED REMINDER: Hard sentences are 10-13 words — chunks MUST still be ≤ 8. Give the SUBJECT as prefilled: subject pronoun ("i", "she", "he") or 2-word subject NP ("the professor", "the manager"). Example: answer=11 words, prefilled=["the professor"] (2 words) -> R=9 -> shorten sentence to 10 words -> R=8. Difficulty comes from GRAMMAR STRUCTURE, not from chunk count.`,
  },
};

const SCENARIO_POOL = [
  "Home/Family: grocery shopping, home repair, neighbor interaction, cooking",
  "Leisure/Hobbies: local library, community center, sports class, art gallery, bookstore",
  "Service/Retail: restaurant waiter, clothing store, post office, hair salon",
  "Education/Academic: student study group, campus cafe, registrar office, internship interview",
  "Health/Wellness: dental appointment, pharmacy, yoga class, medical clinic",
  "Nature/Environment: local park, botanical garden, weather forecast, hiking trail"
];

const PERSONA_POOL = [
  "The flight attendant", "A young architect", "The local librarian", "A frustrated customer",
  "The software developer", "An exchange student", "The elderly neighbor", "The yoga instructor",
  "A travel blogger", "The store clerk", "A delivery driver", "The project supervisor",
  "A volunteer", "The museum curator", "An enthusiastic intern", "The shop owner"
];

// Common words that carry no topic signal — filtered out before similarity comparison
const TOPIC_STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "have", "has", "had", "will", "would", "could", "should",
  "what", "how", "when", "where", "who", "whom", "which", "that", "this",
  "to", "of", "and", "or", "but", "for", "with", "from", "about", "into",
  "you", "your", "yours", "i", "me", "my", "he", "she", "they", "them", "their", "it",
  "not", "no", "any", "some", "if", "then", "than", "so", "very", "just",
  "tell", "told", "asked", "ask", "want", "wanted", "know", "find", "out",
  "say", "said", "wonder", "wondering", "need", "needs",
]);

/**
 * Extract meaningful topic words from a question's prompts and answer.
 * Excludes stopwords and short function words.
 */
function extractTopicWords(q) {
  const text = [
    String(q.prompt_context || ""),
    String(q.prompt_task_text || q.prompt || ""),
    String(q.answer || ""),
  ].join(" ").toLowerCase().replace(/[^a-z\s]/g, " ");
  return new Set(
    text.split(/\s+/).filter((w) => w.length > 4 && !TOPIC_STOPWORDS.has(w))
  );
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Returns true if candidate question is too topically similar to recent pool questions.
 * Only compares against the most recent TOPIC_REPEAT_WINDOW questions — comparing against
 * the entire pool causes over-rejection as the pool grows large (100+ questions).
 * Threshold 0.45: share >45% of meaningful topic words → reject as topic repeat.
 */
const TOPIC_REPEAT_WINDOW = 40;
function isTopicRepeat(q, pool, threshold = 0.45) {
  if (!pool || pool.length === 0) return false;
  const words = extractTopicWords(q);
  if (words.size < 2) return false; // too few topic words to compare reliably
  const recent = pool.slice(-TOPIC_REPEAT_WINDOW);
  for (const existing of recent) {
    if (jaccardSimilarity(words, extractTopicWords(existing)) >= threshold) return true;
  }
  return false;
}

/**
 * Extract recent topic phrases from the accepted pool to help the AI avoid repetition.
 * Returns up to 20 short context/topic strings used in recent questions.
 */
function extractRecentTopics(pool, maxQuestions = 30) {
  const recent = pool.slice(-maxQuestions);
  const topics = [];
  for (const q of recent) {
    // Prefer prompt_context; fall back to first few words of prompt_task_text
    const ctx = String(q.prompt_context || "").trim();
    const task = String(q.prompt_task_text || q.prompt || "").trim();
    const phrase = ctx || task;
    if (phrase) topics.push(phrase);
  }
  // Deduplicate and limit
  return [...new Set(topics)].slice(0, 20);
}

function buildGeneratePrompt(round, spec, rejectFeedback = "", recentTopics = []) {
  // spec: [{type, difficulty, count}, ...]
  const totalCount = spec.reduce((s, x) => s + x.count, 0);

  // Pick 3 random scenarios and 5 random personas to prime the AI
  const pickedScenarios = shuffle(SCENARIO_POOL).slice(0, 3).join("; ");
  const pickedPersonas = shuffle(PERSONA_POOL).slice(0, 5).join(", ");

  let qIndex = 1;
  const groupSections = spec.map((item, i) => {
    const { type, difficulty, count } = item;
    const hints = (TYPE_DIFFICULTY_HINTS[type] || {})[difficulty] || "";
    const diffSpec = difficulty === "easy"
      ? "Answer length: 7-10 words. Chunks: 5-6."
      : difficulty === "medium"
      ? "Answer length: 10-13 words. Chunks: 6-7."
      : "Answer length: usually 10-13 words. Chunks: 6-8. MUST be hard because of advanced grammar structure: e.g. passive, past perfect, relative/contact clause, whom, comparative/superlative, or multi-layer embedding. Do NOT make an item hard by length alone. Answer length: usually 10-13 words. Chunks: 6-8. MUST be hard because of advanced grammar structure: e.g. passive, past perfect, relative/contact clause, whom, comparative/superlative, or multi-layer embedding. Do NOT make an item hard by length alone.";
    const ids = Array.from({ length: count }, (_, j) => `tmp_r${round}_q${qIndex + j}`).join(", ");
    qIndex += count;
    return `### GROUP ${i + 1}: ${count} item${count > 1 ? "s" : ""} 锟?${type.toUpperCase()} / ${difficulty.toUpperCase()}
IDs: ${ids}
${hints}
${diffSpec}`;
  }).join("\n\n");

  return `You are a TOEFL iBT Writing Task 1 "Build a Sentence" content architect.
Return ONLY a JSON array with exactly ${totalCount} objects.

## CORE MISSION:
Generate high-quality conversational sentences. Focus on natural language flow.

## DISTRACTOR ANNOTATION RULES (CRITICAL):
For each item, set "has_distractor" to true/false based on these TPO rules:
1. Set "has_distractor": false ONLY when:
   - Simple Negation: basic negative statement < 9 words.
   - High Complexity: 3+ nested grammar points (e.g. Embedded + Passive + Perfect).
   - Contact Clause: relative pronoun is omitted.
2. Set "has_distractor": true for ALL other cases (~80-90% of batch).
3. A distractor is INVALID if inserting it can still produce a grammatical or semantically plausible answer. Distractors must break the tested grammar point, not act like another acceptable chunk.

## VERB DIVERSITY:
DO NOT use the same reporting verb (e.g., "wanted to know") more than twice in this batch.
Vary with: inquired, wondered, asked, was curious, needed to find out, was not sure.

## INTERROGATIVE FRAME DIVERSITY:
- If this batch includes interrogative items, vary the polite opener naturally.
- Do NOT repeat the exact same interrogative opener more than twice in one batch.
- Prefer a small natural family such as "Can you tell me ...", "Could you tell me ...", "Do you know ...", "Would you mind telling me ...", "Can you remind me ...".
- Do NOT use long, theatrical, or overly formal lead-ins just to create fake variety.
- The opener should stay short; the tested difficulty should come from the embedded clause.

## SCENARIO & PERSONA CONTEXT:
- Scenarios: ${pickedScenarios}
- Personas: ${pickedPersonas}
${recentTopics.length > 0 ? `
## TOPIC DIVERSITY — AVOID THESE RECENTLY USED SCENARIOS:
The following topics/scenarios were already used in the current batch. Choose DIFFERENT settings, characters, and situations for this round:
${recentTopics.map((t, i) => `${i + 1}. ${t}`).join("\n")}
Pick fresh scenarios: different location, different relationship, different activity. Do NOT recycle the same topic even with different wording.
` : ""}
${groupSections}

## WARNING — PREFILLED STRATEGY HAS CHANGED:
You may see older questions in context where prefilled=["not"] or prefilled=["the report"] (object noun phrase).
That is the OLD incorrect style. Do NOT imitate it.
CORRECT strategy: use the SUBJECT as prefilled.
  • 1st-person sentences (I did/asked/found...): prefilled=["i"]
  • 3rd-person sentences (She/He asked...): prefilled=["she"] or ["he"] or 2-word subject NP
  • Interrogative (Could you.../Do you...): prefilled=["could you"] or ["do you"]
  • Negation "not" belongs in CHUNKS, NOT prefilled.
  • Bare pronouns ["he"], ["she"], ["they"] as prefilled for 3rd-person — WRONG ✘
    Replace with descriptive NP: ["the professor"], ["the student"], ["some colleagues"].

## GIVEN WORD (PREFILLED) 鈥?CRITICAL CONCEPT:
In the real TOEFL exercise, 8-9 out of every 10 questions give the student one word or short phrase already placed in the sentence (a "given word"). This makes the task slightly easier.
- "prefilled": a phrase pre-placed for the student (shown on screen, not draggable)
- "prefilled_positions": its 0-based word index in the answer
- That phrase must be REMOVED from "chunks" 鈥?chunks covers only the draggable pieces
- TARGET: about 8-9 out of 10 items should have a non-empty prefilled (~85%, matching real TOEFL). prefilled=[] is acceptable ONLY for short sentences (≤8 words) with no natural subject anchor.
- Every output item must pass a strict WORD-BAG check:
  answer words = (chunks minus distractor) + prefilled words
  no missing words, no extra words, no duplicate coverage

WHAT TO USE AS PREFILLED (TPO authentic — give the SUBJECT, not the object):
- 1st-person pronoun:    "i" for 1st-person sentences (I wondered/asked/noticed/told...)
  → prefilled=["i"], always at position 0. Simplest and most authentic.
- 3rd-person subject NP: 2-3 word descriptive subject noun phrase at sentence start
  → 2-word: "the professor", "the student", "the manager", "my advisor", "the ranger"
  → 3-word: "some colleagues", "her study partner", "the shop owner", "the front desk"
  → NEVER use bare pronouns "he"/"she"/"they" alone — always a descriptive NP
- Interrogative opener:  2-word opening frame (pronoun + aux)
  → "could you", "did she", "do you"
- Short sentences (≤8 words): prefilled=[] is acceptable when no subject anchor is natural.
RULE: prefilled must appear EXACTLY ONCE in the answer.
RULE: Prefer 1-word pronouns ("i") — shortest, most natural, unambiguous.
RULE: Object noun phrases ("the library", "the report") belong in CHUNKS, NOT prefilled.
RULE: prefilled is ≤3 words maximum. Prefer 2-word. A 4-word+ prefilled will be automatically rejected.

## CHUNK GRANULARITY — CRITICAL:
Real TOEFL data: ~77% single-word chunks, ~23% multi-word. Target 6-7 effective chunks per item.

MANDATORY multi-word chunks — NEVER atomize these:
- Infinitives:        "to know", "to find", "to check", "to finish", "to attend", "to make"
- Phrasal verbs:      "find out", "pick up", "carry out", "sign up"
- Aux + participle:   "had gone", "had been", "has been", "will be", "been extended", "is scheduled"
- Fixed collocations: "no idea", "what time", "on time", "in stock", "on Friday", "due to"
Target: 1-2 multi-word chunks per question from the list above.


SINGLE-WORD: subject pronouns (i/he/she/they), question words (where/when/if/whether),
standalone auxiliaries (did/was/were used alone).

THE KEY MATH: R = answer word count − prefilled word count.
- Target R = 6-7 (yields ~6-7 effective chunks). This is the goal.
- HARD RULE: Choose the SUBJECT as prefilled (pronoun or subject NP), not the object.
  For 1st-person sentences: prefilled=["i"] is almost always correct.
  For 3rd-person sentences: use a DESCRIPTIVE 2-3 word subject NP. NEVER bare pronouns ["he"]/["she"]/["they"]. 2-word: ["the professor"], ["the manager"], ["the student"], ["the librarian"]. 3-word when natural: ["some colleagues"], ["her study partner"], ["the shop owner"].
- HARD RULE: prefilled must be ≤3 words. Prefer 2-word (e.g. "the professor", "could you", "the manager"). 3-word is allowed only when the subject NP has no natural 2-word form. Phrases with 4+ words will be REJECTED — always shorten to the core noun.
- If R > 8 (too many draggable words): shorten the sentence.
- If R ≤5 (sentence too short): prefilled=[] is acceptable.

GOOD example (1st-person):
  answer: "I asked whether the library would close early." (8 words)
  prefilled=["i"] → R=7 → chunks=["asked","whether","the library","would","close","early","ask"]
  "the library" stays as a draggable multi-word chunk ✔

GOOD example (3rd-person, subject NP prefilled):
  answer: "The professor mentioned that the deadline had been extended." (9 words)
  prefilled=["the professor"] → R=7 → chunks=["mentioned","that","the deadline","had been","extended","extend"]
  Multi-word: "had been" ✔  Distractor: "extend" (form mismatch)

## UNIQUE-SOLUTION RULE 锟?CRITICAL:
- Every item must have exactly ONE clearly best arrangement.
- Do NOT create items where the distractor can be inserted without obviously breaking grammar.
- Do NOT create items where adverbs, prepositional phrases, or reporting chunks can move around and still sound correct.
- If two arrangements could plausibly be accepted by a careful learner, the item is invalid.
- BAD ambiguous idea:
  chunks: ["he", "asked", "me", "yesterday", "why", "the store closed"]
  problem: "yesterday" may attach in multiple plausible positions.
- GOOD idea:
  use tighter structure chunks so only one order is grammatical, e.g. "asked me", "closed early", "on Friday".
- HARD RULE: NEVER isolate time/place/frequency adverbs as standalone single-word chunks.
  BANNED standalone chunks: "yesterday", "today", "tomorrow", "recently", "finally", "always", "often", "sometimes", "probably", "eventually", "suddenly", "already", "usually".
  Instead, BIND them to the verb they modify: "discussed yesterday", "arrived recently", "finished finally".
  Standalone adverbs will be AUTOMATICALLY REJECTED by the validation system.

HOW PREFILLED WORKS — four TPO-authentic pattern examples:

Pattern A (1st-person sentence, prefilled = subject pronoun "i"):
  answer:            "I asked whether the meeting had been canceled."  [8 words]
  prefilled:         ["i"]
  prefilled_positions: {"i": 0}
  R = 8 - 1 = 7
  chunks:            ["asked", "whether", "the meeting", "had been", "canceled", "cancel"]
  distractor:        "cancel"  (past perfect passive vs base form)
  word bag check:    asked(1)+whether(1)+the meeting(2)+had been(2)+canceled(1)=7 + i(1) = 8 ✓

Pattern B (3rd-person sentence, prefilled = 2-word subject NP "the manager"):
  answer:            "The manager wanted to know if the order was ready."  [10 words]
  prefilled:         ["the manager"]
  prefilled_positions: {"the manager": 0}
  R = 10 - 2 = 8
  chunks:            ["wanted", "to know", "if", "the order", "was", "ready", "is"]
  distractor:        "is"  (was vs is — tense mismatch)
  word bag check:    wanted(1)+to know(2)+if(1)+the order(2)+was(1)+ready(1)=8 + the manager(2) = 10 ✓

Pattern C (interrogative, prefilled = opening frame "could you"):
  answer:            "Could you tell me what time the library closes?"  [9 words]
  prefilled:         ["could you"]
  prefilled_positions: {"could you": 0}
  R = 9 - 2 = 7
  chunks:            ["tell", "me", "what time", "the library", "closes", "closed"]
  distractor:        "closed"  (closes vs closed — tense)
  word bag check:    tell(1)+me(1)+what time(2)+the library(2)+closes(1)=7 + could you(2) = 9 ✓

Pattern D (short sentence ≤8 words, prefilled=[]):
  answer:            "I did not submit the form on time."  [8 words]
  prefilled:         []
  R = 8 (all words draggable)
  chunks:            ["i", "did", "not", "submit", "the form", "on time", "submitted"]
  distractor:        "submitted"  (did not submit vs submitted — tense)
  word bag check:    i(1)+did(1)+not(1)+submit(1)+the form(2)+on time(2)=8 + []=0 → 8 ✓

## Schema:
{
  "id": "tmp_r${round}_q1",
  "has_distractor": boolean,
  "answer_type": "negation" | "3rd-reporting" | "1st-embedded" | "interrogative" | "direct" | "relative",
  "prompt_context": "" or "one background sentence (only for tell/explain; MUST be empty string for ask/report/respond)",
  "prompt_task_kind": "ask" | "report" | "respond" | "tell" | "explain",
  "prompt_task_text": "ONE sentence only — no period in the middle. For ask/report/respond: a self-contained question with scene embedded. For tell/explain: a short instruction.",
  "prompt": "optional; if provided, it must exactly match prompt_context + prompt_task_text rendered by the app",
  "answer": "full correct sentence (7-13 words)",
  "chunks": ["draggable1", "draggable2", "...and distractor if has_distractor=true"],
  "prefilled": ["pre-placed phrase"] or [],
  "prefilled_positions": {"pre-placed phrase": <0-based word index>} or {},
  "distractor": "wrong-form word" or null,
  "has_question_mark": true or false,
  "grammar_points": ["tag1", "tag2"]
}

## PROMPT CONTRACT - CRITICAL:

### TPO AUTHENTIC STYLE — READ THIS FIRST:
Real TOEFL Build-a-Sentence prompts are almost always a SINGLE DIRECT QUESTION.
The scene/context is embedded naturally inside the question itself — there is NO separate context sentence.

≥70% of your items MUST use the TPO single-question style:
  prompt_context = ""   (empty string — no separate background sentence)
  prompt_task_text = a self-contained question that tells the student everything they need

TPO EXAMPLES (single-question style, authentic):
  ✓ "What did the yoga instructor ask about the schedule change?"
  ✓ "What did your friend want to know about the camping trip?"
  ✓ "What did the librarian ask about the overdue book?"
  ✓ "What does the professor ask the student about the assignment?"
  ✓ "Did you enjoy the pottery class you attended last week?"
  ✓ "What did the travel agent ask about your vacation plans?"

Only "tell" and "explain" types naturally need a short context sentence:
  prompt_context = "You went to a pottery class last Saturday."
  prompt_task_text = "Tell your friend about it."

For "ask", "report", and "respond" types: embed the context INTO the question.
WRONG ✗ (two-part format — NOT TPO style):
  prompt_context = "The yoga instructor has a question about the schedule."
  prompt_task_text = "What does she ask?"
RIGHT ✓ (single-question style — TPO authentic):
  prompt_context = ""
  prompt_task_text = "What did the yoga instructor ask about the schedule change?"

### PROMPT FIELDS:
- "prompt_context" = brief scene sentence, OR empty string "" for single-question style
- "prompt_task_kind" = ask | report | respond | tell | explain
- "prompt_task_text" = the EXPLICIT task/question shown to the user (required, never empty)
- The visible prompt is: prompt_context + " " + prompt_task_text (or just prompt_task_text if context is "")

prompt_task_text MUST match one of these validated patterns (auto-rejected otherwise):
  - ask/report: "What did [person] ask/want/say/mention/find out/discover/learn/wonder/need to know?"
               OR "What does [person] ask about [topic]?" — context embedded in the question ✓
  - respond:    "How do you respond?" / "What do you say?" / "What does [person] tell [person]?"
  - tell:       "Tell your friend about it." / "Describe what happened." / "Complete the sentence."
  - explain:    "Explain what you found." / "Share your experience."

${rejectFeedback}
## FINAL CHECKLIST 锟?VERIFY BEFORE OUTPUT:
1. WORD BAG: chunks (minus distractor) + prefilled words must equal EXACTLY the words in answer 锟?no extras, no missing. Verify every item.
2. DISTRACTOR: The distractor word must NOT appear anywhere in the answer string.
3. PREFILLED COUNT: Count your non-empty prefilled items. You MUST have 8-9 items with prefilled in this batch. If you have fewer than 8, go back and add prefilled (subject pronoun or subject NP) to more items before outputting.
4. PREFILLED CORRECTNESS: The prefilled word/phrase must appear EXACTLY in the answer string, at the stated index. Remove it from chunks 鈥?never include it in both prefilled and chunks. chunks + prefilled reconstruct the answer exactly once.
5. CHUNK GRANULARITY & R-VALUE: R = answer_words − prefilled_words. Target R=6-7. prefilled is ≤3 words max (4-word+ = REJECTED). Object noun phrases belong in CHUNKS, not prefilled. 1-2 multi-word chunks per question: infinitives ("to know"), phrasal verbs ("find out"), aux+participle ("had been"). Never 9+ effective chunks.
6. VERB DIVERSITY: No single reporting verb may appear more than twice in this batch.
7. HARD DIFFICULTY: Hard items must be justified by advanced grammar signals, not by extra words. Valid hard signals include passive/passive-progressive, past perfect, relative/contact clause, whom, comparative/superlative, or multi-layer embedding.
8. UNIQUE SOLUTION: Reject any item in your own internal check if the distractor could still fit grammatically or if more than one chunk order seems plausible.
9. INTERROGATIVE QUALITY: For interrogative items, use a short natural polite frame, vary the opener across the batch, and keep the embedded clause in declarative order. Do not mass-produce one stock opener.
10. PROMPT STYLE: ≥70% of items must use single-question style (prompt_context=""). For "ask"/"report"/"respond" types, embed the scene context inside the question text itself. Two-part prompts (separate context sentence + short question) will be flagged.
    prompt_task_text MUST be a SINGLE sentence — no period or question mark in the middle.
    WRONG ✗: prompt_task_text = "The student needed help with her paper. What did she ask the professor?"
    RIGHT ✓: prompt_task_text = "What did the student ask the professor about her paper?"
    prompt_task_text MUST start with a validated cue pattern — see PROMPT CONTRACT above.

Output JSON array only. No markdown.`.trim();
}

function buildTrapSpecialistPrompt(questions) {
  const itemsToTrap = questions.filter(q => q.has_distractor === true);
  const total = itemsToTrap.length;

  return `You are a TOEFL iBT Writing Task 1 Trap Specialist.
Your goal is to add a single lowercase distractor word to items where "has_distractor" is true.

## THE TACTICAL PLAYBOOK (Apply based on grammar_points):
1. EMBEDDED QUESTIONS: 
   - Preferred: Wh-word swap (e.g., where -> which, if -> that) OR Tense mismatch within the clause (e.g., goes -> went).
   - Fallback: Use "did/do" only if the clause verb is a simple base form.
2. RELATIVE/CONTACT CLAUSES:
   - Preferred: Relative pronoun swap (e.g., that -> which, who -> whom) OR Clause verb agreement.
   - NEVER use "did" for these items.
3. PERFECT/PASSIVE/PROGRESSIVE:
   - Mandatory: Use morphological variants (e.g., chosen -> chose, taking -> taken, built -> build).
   - NEVER use "did" for these items.
4. NEGATION:
   - Preferred: Verb form杈ㄦ瀽 (e.g., attend -> attending) OR Modal swap (e.g., could -> can).

## PHILOSOPHY:
Search for the "Evil Twin" of a word in the sentence鈥攁 word that looks plausible but breaks the tested rule. 
Keep "distractor": null for items where "has_distractor" is false.

## SAFETY CHECK:
- The distractor must NOT create another grammatical answer if inserted.
- The distractor must NOT behave like an optional modifier.
- If the sentence still sounds acceptable with the distractor inserted, choose a different distractor.

## INPUT ITEMS:
${JSON.stringify(questions, null, 2)}

## FINAL CHECK 锟?VERIFY BEFORE OUTPUT:
- PASSIVE / PERFECT / PROGRESSIVE items: distractor MUST be a morphological variant (e.g., chosen鈫抍hose, taking鈫抰aken). NEVER "did" or "do".
- PASSIVE / PERFECT / PROGRESSIVE items: distractor MUST be a morphological variant. NEVER "did" or "do".
- RELATIVE / CONTACT CLAUSE items: use pronoun swap or verb agreement. NEVER "did".
- has_distractor=false items: distractor field must remain null.

Return ONLY a JSON array.`.trim();
}
const AMBIGUITY_FUNCTION_WORDS = new Set([
  "the", "a", "an", "to", "of", "and", "or", "but", "from", "that", "this", "it",
  "in", "on", "at", "for", "with", "by", "as", "if", "then", "than", "so", "be",
  "is", "are", "was", "were", "am", "do", "does", "did", "have", "has", "had",
  "before", "after", "about", "into", "over", "under", "already", "please",
]);

const AMBIGUITY_PREP_START_WORDS = new Set([
  "to", "in", "on", "at", "for", "with", "from", "about", "into", "over", "under", "before", "after", "by",
]);

/**
 * Heuristic ambiguity check on a runtime question (with answerOrder + bank).
 * Returns true if the chunk set is structurally prone to multiple valid orderings.
 *
 * Scoring (threshold 0.35):
 *   - Duplicate chunks in bank   +0.22 each
 *   - Single function-word chunks beyond 3  +0.05 each
 *   - Prepositional-start chunks beyond 1   +0.12 each
 */
function hasAmbiguousArrangements(rq) {
  const answerOrder = Array.isArray(rq?.answerOrder) ? rq.answerOrder : [];
  const bank = Array.isArray(rq?.bank) ? rq.bank : [];
  if (answerOrder.length > 8) return false;

  const seen = new Map();
  bank.forEach((chunk) => {
    const key = String(chunk || "").toLowerCase();
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  const duplicateChunks = [...seen.values()].filter((n) => n > 1).length;

  const functionLike = answerOrder.filter((chunk) => {
    const ws = String(chunk || "").toLowerCase().split(/\s+/).filter(Boolean);
    return ws.length === 1 && AMBIGUITY_FUNCTION_WORDS.has(ws[0]);
  }).length;

  const prepStarts = answerOrder.filter((chunk) => {
    const ws = String(chunk || "").toLowerCase().split(/\s+/).filter(Boolean);
    return ws.length > 0 && AMBIGUITY_PREP_START_WORDS.has(ws[0]);
  }).length;

  const score =
    0.05 +
    duplicateChunks * 0.22 +
    Math.max(0, functionLike - 3) * 0.05 +
    Math.max(0, prepStarts - 1) * 0.12;

  return score > 0.35;
}

/**
 * Improved classification using the AI-provided answer_type, 
 * falling back to regex if missing.
 */
function getAnswerType(q) {
  if (q.answer_type && q.answer_type !== "unknown") return q.answer_type;
  return classifyAnswerType(q);
}

function resolvedAnswerType(q) {
  const type = getAnswerType(q);
  return TYPE_LIST.includes(type) ? type : classifyAnswerType(q);
}

/**
 * Compute current pool type脳difficulty counts plus style-feature coverage.
 */
function computePoolState(pool) {
  const state = {};
  for (const diff of ["easy", "medium", "hard"]) {
    state[diff] = {};
    for (const type of TYPE_LIST) {
      state[diff][type] = 0;
    }
  }
  state.typeTotals = Object.fromEntries(TYPE_LIST.map((type) => [type, 0]));
  state.style = {
    total: 0,
    embedded: 0,
    negation: 0,
    distractor: 0,
    qmark: 0,
  };
  for (const q of pool) {
    const meta = attachMeta(q)._meta || {};
    const type = meta.answerType || classifyAnswerType(q);
    const diff = (estimateQuestionDifficulty(q) || {}).bucket || "medium";
    if (state[diff] && type in state[diff]) {
      state[diff][type]++;
    }
    if (type in state.typeTotals) state.typeTotals[type] += 1;
    state.style.total += 1;
    if (meta.isEmbedded) state.style.embedded += 1;
    if (type === "negation") state.style.negation += 1;
    if (meta.hasDistractor) state.style.distractor += 1;
    if (meta.hasQuestionMark) state.style.qmark += 1;
  }
  return state;
}

/**
 * Build planner prompt: AI analyzes pool gaps and outputs a mixed batch spec.
 */
function chooseGapWeightedType(poolState, globalTypeTargets, candidates, fallback) {
  const totals = poolState?.typeTotals || {};
  const ranked = (Array.isArray(candidates) ? candidates : []).map((type) => ({
    type,
    gap: Math.max(0, (globalTypeTargets?.[type] || 0) - (totals[type] || 0)),
    have: totals[type] || 0,
  })).sort((a, b) => {
    if (b.gap !== a.gap) return b.gap - a.gap;
    return a.have - b.have;
  });
  return ranked[0]?.type || fallback;
}


function buildPlannerPrompt(poolState, difficultyTargets, globalTypeTargets, styleTargets = null, targetTotal = 10, mode = "normal") {
  const diffRows = ["easy", "medium", "hard"]
    .map((diff) => {
      const have = TYPE_LIST.reduce((sum, type) => sum + ((poolState[diff] || {})[type] || 0), 0);
      const need = difficultyTargets?.[diff] || 0;
      return { diff, have, need, gap: Math.max(0, need - have) };
    })
    .sort((a, b) => b.gap - a.gap);

  const typeRows = TYPE_LIST
    .map((type) => {
      const have = (poolState.typeTotals || {})[type] || 0;
      const need = globalTypeTargets?.[type] || 0;
      return { type, have, need, gap: Math.max(0, need - have) };
    })
    .sort((a, b) => b.gap - a.gap);

  const diffLines = diffRows.map((r) =>
    `  ${r.diff.padEnd(8)} have=${String(r.have).padStart(3)}  need=${String(r.need).padStart(3)}  gap=${String(r.gap).padStart(3)}`
  );
  const typeLines = typeRows.map((r) =>
    `  ${r.type.padEnd(16)} have=${String(r.have).padStart(3)}  need=${String(r.need).padStart(3)}  gap=${String(r.gap).padStart(3)}`
  );

  const style = poolState.style || { total: 0, embedded: 0, negation: 0, distractor: 0, qmark: 0 };
  const styleSection = styleTargets
    ? `

Style coverage needed to assemble the remaining target sets:
  embedded questions   have=${String(style.embedded).padStart(3)}  need>=${String(styleTargets.embeddedMin).padStart(3)}  gap=${String(Math.max(0, styleTargets.embeddedMin - style.embedded)).padStart(3)}
  negation items       have=${String(style.negation).padStart(3)}  need>=${String(styleTargets.negationMin).padStart(3)}  gap=${String(Math.max(0, styleTargets.negationMin - style.negation)).padStart(3)}
  distractor items     have=${String(style.distractor).padStart(3)}  need>=${String(styleTargets.distractorMin).padStart(3)}  gap=${String(Math.max(0, styleTargets.distractorMin - style.distractor)).padStart(3)}
  question-mark items  have=${String(style.qmark).padStart(3)}  max<=${String(styleTargets.qmarkMax).padStart(3)}
`
    : "";

  return `You are a TOEFL Build-a-Sentence generation planner.

Difficulty coverage needed for the whole pool:
  difficulty have  need  gap
${diffLines.join("\n")}

Global type coverage needed for the whole pool:
  type             have  need  gap
${typeLines.join("\n")}
${styleSection}

Design the next generation batch (exactly ${targetTotal} questions total) to most efficiently fill the largest GLOBAL gaps.
Rules:
- Sum of all count fields must equal exactly ${targetTotal}.
- First satisfy the largest difficulty gaps (easy / medium / hard).
- Then satisfy the largest GLOBAL TYPE gaps across the whole pool. Do NOT assume every set needs the same fixed type recipe.
- Skip categories with gap <= 0 unless needed to support style coverage.
- ALSO prioritize style-feature shortages that can block final set assembly, especially embedded-question and negation shortages.
- If global-type optimization conflicts with style-gap repair, repair the style gaps first.
- Ensure the batch includes enough embedded-capable / negation-capable cells when those style gaps are positive.
- Minimum 1, maximum 8 questions per included cell.
- Valid types: negation, 3rd-reporting, 1st-embedded, interrogative, direct, relative
- Valid difficulties: easy, medium, hard
- Avoid over-producing direct items when direct gap is already filled.
- In boost mode, prioritize precision over breadth: target the single most blocking gap first.
- If all gaps are <= 0, return a balanced mixed batch that does not overproduce direct items.

Return ONLY a JSON array. No markdown. No explanation.
[{"type":"...","difficulty":"...","count":N},...]`.trim();
}

/**
 * Parse planner AI output into a validated spec array totaling exactly 10 questions.
 */
function parsePlannerSpec(text, targetTotal = 10) {
  try {
    const arr = parseJsonArray(text);
    if (!Array.isArray(arr) || arr.length === 0) throw new Error("empty");
    const valid = arr
      .filter((x) => x && typeof x.type === "string" && typeof x.difficulty === "string" && Number(x.count) > 0)
      .map((x) => ({ type: String(x.type), difficulty: String(x.difficulty), count: Number(x.count) }));
    if (valid.length === 0) throw new Error("no valid items");
    if (targetTotal <= 1) {
      const top = valid.sort((a, b) => b.count - a.count)[0];
      return [{ type: top.type, difficulty: top.difficulty, count: 1 }];
    }

    const ranked = valid.sort((a, b) => b.count - a.count);
    if (ranked.length >= targetTotal) {
      return ranked.slice(0, targetTotal).map((x) => ({ type: x.type, difficulty: x.difficulty, count: 1 }));
    }

    const normalized = ranked.map((x) => ({ ...x, count: 1 }));
    let remaining = targetTotal - normalized.length;
    let cursor = 0;
    while (remaining > 0 && normalized.length > 0) {
      normalized[cursor % normalized.length].count += 1;
      remaining -= 1;
      cursor += 1;
    }
    return normalized;
  } catch (_) {
    return [{ type: "3rd-reporting", difficulty: "medium", count: targetTotal }];
  }
}

function enforcePlannerStyleGaps(spec, poolState, styleTargets, globalTypeTargets = null, difficultyTargets = null, targetTotal = 10) {
  const out = Array.isArray(spec) ? spec.map((x) => ({ ...x })) : [];
  if (out.length === 0) return out;

  const style = poolState?.style || { embedded: 0, negation: 0, distractor: 0, qmark: 0 };
  const typeTotals = poolState?.typeTotals || Object.fromEntries(TYPE_LIST.map((type) => [type, 0]));
  const embeddedGap = Math.max(0, (styleTargets?.embeddedMin || 0) - style.embedded);
  const negationGap = Math.max(0, (styleTargets?.negationMin || 0) - style.negation);
  const typeGaps = Object.fromEntries(
    TYPE_LIST.map((type) => [type, Math.max(0, (globalTypeTargets?.[type] || 0) - (typeTotals[type] || 0))])
  );

  const total = out.reduce((sum, x) => sum + x.count, 0);
  if (total !== targetTotal) return out;

  const difficultyGapOrder = ["easy", "medium", "hard"].sort((a, b) => {
    const aHave = TYPE_LIST.reduce((sum, type) => sum + ((poolState?.[a] || {})[type] || 0), 0);
    const bHave = TYPE_LIST.reduce((sum, type) => sum + ((poolState?.[b] || {})[type] || 0), 0);
    const aGap = Math.max(0, (difficultyTargets?.[a] || 0) - aHave);
    const bGap = Math.max(0, (difficultyTargets?.[b] || 0) - bHave);
    return bGap - aGap;
  });

  const replaceOne = (preferredType, preferredDifficulty = null) => {
    const donor = out
      .filter((x) => x.count > 1)
      .sort((a, b) => {
        const aPenalty = (typeGaps[a.type] || 0) === 0 ? 1 : 0;
        const bPenalty = (typeGaps[b.type] || 0) === 0 ? 1 : 0;
        if (aPenalty !== bPenalty) return bPenalty - aPenalty;
        return b.count - a.count;
      })[0];
    if (!donor) {
      if (out.length === 1 && targetTotal === 1) {
        out[0] = { type: preferredType, difficulty: preferredDifficulty || difficultyGapOrder[0] || "medium", count: 1 };
      }
      return;
    }
    donor.count -= 1;
    const targetDifficulty = preferredDifficulty || difficultyGapOrder[0] || "medium";
    const existing = out.find((x) => x.type === preferredType && x.difficulty === targetDifficulty);
    if (existing) {
      existing.count += 1;
    } else {
      out.push({ type: preferredType, difficulty: targetDifficulty, count: 1 });
    }
  };

  if (embeddedGap > 0) {
    const embeddedPlanned = out
      .filter((x) => x.type === "3rd-reporting" || x.type === "1st-embedded" || x.type === "interrogative")
      .reduce((sum, x) => sum + x.count, 0);
    if (embeddedPlanned < Math.min(6, embeddedGap)) {
      replaceOne("1st-embedded", "medium");
      replaceOne("interrogative", "medium");
    }
  }

  if (negationGap > 0) {
    const negPlanned = out
      .filter((x) => x.type === "negation")
      .reduce((sum, x) => sum + x.count, 0);
    if (negPlanned < Math.min(2, negationGap)) {
      replaceOne("negation", embeddedGap > 0 ? "hard" : "medium");
    }
  }

  const scarceTypes = TYPE_LIST
    .filter((type) => !["3rd-reporting", "direct", "negation"].includes(type))
    .sort((a, b) => (typeGaps[b] || 0) - (typeGaps[a] || 0));

  for (const type of scarceTypes) {
    const gap = typeGaps[type] || 0;
    if (gap <= 0) continue;
    const planned = out.filter((x) => x.type === type).reduce((sum, x) => sum + x.count, 0);
    if (planned > 0) continue;
    replaceOne(type, difficultyGapOrder[0] || "medium");
  }

  return out.filter((x) => x.count > 0);
}

// ── Prompt Reformatter ───────────────────────────────────────────────────────
// Dedicated pass: converts two-part prompts (context + short task) into
// single direct questions (TPO authentic style). Only fires on questions
// where prompt_context is non-empty AND task_kind is ask/report/respond.

function buildPromptReformatterPrompt(questions) {
  const items = questions.map(q => ({
    id: q.id,
    prompt_context: q.prompt_context || "",
    prompt_task_kind: q.prompt_task_kind || "",
    prompt_task_text: q.prompt_task_text || "",
  }));
  return `You are a TOEFL prompt style editor. Your ONLY job: rewrite prompts so that every "ask"/"report"/"respond" item has a SINGLE self-contained question sentence.

## TWO CASES TO FIX (ask/report/respond only):

### CASE 1: Separate context + short question
prompt_context is non-empty AND prompt_task_text is a short question → merge them.
Set prompt_context = "" and prompt_task_text = merged single question.

  IN:  context="The yoga instructor is speaking with a student about the schedule."
       task="What does she ask?"
  OUT: context=""
       task="What did the yoga instructor ask the student about the schedule?"

  IN:  context="A customer is at the front desk of a clothing store."
       task="What did the shop owner ask?"
  OUT: context=""
       task="What did the shop owner at the clothing store ask the customer?"

  IN:  context="Some colleagues are discussing a project deadline."
       task="What did they need to know?"
  OUT: context=""
       task="What did the colleagues need to know about the project deadline?"

### CASE 2: Multi-sentence prompt_task_text (context is already empty)
prompt_context is "" AND prompt_task_text contains 2+ sentences → collapse into one question.
Keep prompt_context = "" and rewrite prompt_task_text as a single question with context embedded.

  IN:  context=""
       task="The student was studying late for an exam. What did she want to know about the schedule?"
  OUT: context=""
       task="What did the student studying late for an exam want to know about the schedule?"

  IN:  context=""
       task="Your coworker is having trouble with the printer. What does he ask?"
  OUT: context=""
       task="What does your coworker ask about the printer problem?"

  IN:  context=""
       task="The manager called a meeting about the budget. What did she need to know?"
  OUT: context=""
       task="What did the manager need to know about the budget for the meeting?"

## DO NOT CHANGE:
- "tell" or "explain" items: leave BOTH fields exactly as-is.
- Items that already have a single self-contained question in prompt_task_text (context is "" and task is one sentence): return them unchanged.

## CONSTRAINTS:
- The output task_text MUST be ONE sentence. No period in the middle.
- The output task_text MUST be a natural, grammatical question (for ask/report/respond).
- Do NOT change the person, invent new details, or alter the grammar point being tested.
- Return ONLY a JSON array with objects containing: id, prompt_context, prompt_task_text.
- Do NOT include any other fields.

## ITEMS TO PROCESS:
${JSON.stringify(items, null, 2)}

Return ONLY a JSON array. No markdown.`.trim();
}

/**
 * Reformat two-part prompts into single-question TPO style.
 * Returns the same question list with prompt fields updated.
 * Falls back to original on any error.
 */
async function reformatPrompts(questions) {
  const toReformat = questions.filter(q => {
    const kind = (q.prompt_task_kind || "").toLowerCase();
    if (!["ask", "report", "respond"].includes(kind)) return false;
    const ctx = (q.prompt_context || "").trim();
    if (ctx) return true; // Case 1: has separate context sentence
    // Case 2: context is empty but prompt_task_text contains multiple sentences
    const task = (q.prompt_task_text || "").trim();
    const sentences = task.split(/(?<=[.!?])\s+/).filter(Boolean);
    return sentences.length >= 2;
  });
  if (toReformat.length === 0) return questions;

  let updates;
  try {
    const raw = await callModelDeterministic(buildPromptReformatterPrompt(toReformat));
    const arr = parseJsonArray(raw);
    if (!Array.isArray(arr)) throw new Error("not an array");
    updates = new Map(arr.map(u => [String(u.id || ""), u]));
  } catch (e) {
    console.log(`  reformatter: failed (${e.message}), using originals`);
    return questions;
  }

  return questions.map(q => {
    const u = updates.get(q.id);
    if (!u) return q;
    const newCtx  = String(u.prompt_context  ?? q.prompt_context  ?? "").trim();
    const newTask = String(u.prompt_task_text ?? q.prompt_task_text ?? "").trim();
    if (!newTask) return q; // safety: never blank out the task
    // Clear prompt so validator doesn't flag the mismatch after reformatting
    return { ...q, prompt_context: newCtx, prompt_task_text: newTask, prompt: "" };
  });
}
// ─────────────────────────────────────────────────────────────────────────────

function buildReviewPrompt(questions) {
  return `
You are a strict TOEFL TPO item quality reviewer.
Review the Build a Sentence items and return ONLY JSON:
{
  "overall_score": 0-100,
  "blockers": ["critical issue..."],
  "question_scores": [
    {"id":"...", "score":0-100, "issues":["..."]}
  ]
}

Blockers (ONLY use for these critical issues):
- multiple valid chunk orders (ambiguous arrangement)
- grammar incorrect in the answer sentence
- distractor could be a valid answer chunk (inserting it creates another valid sentence)
- prompt/answer mismatch (answer doesn't respond to prompt)
- indirect question clause uses inverted word order (MUST be declarative)

NOT blockers (deduct points instead):
- chunk composition style
- grammar_points label format
- scene variety

TPO-specific scoring:
- >=85 means production ready
- <78 means reject
- Verify that indirect questions use declarative word order (no auxiliary inversion)
- Verify that distractor did/do/does CANNOT be inserted into the correct answer
- Deduct 3-5 points if answer is a direct question when it should be a statement
- Deduct 3-5 points if an interrogative item uses a stiff, formulaic, or overlong polite opener
- Deduct 3-5 points if a batch of interrogative items repeats the same opener too often

Items:
${JSON.stringify(questions, null, 2)}
`.trim();
}

function buildConsistencyPrompt(questions) {
  return `
You are a TPO Build-a-Sentence auditor.
Evaluate each item against real TPO exam standards.

TPO key characteristics:
- 92% of answers are STATEMENTS (declarative sentences)
- 63% test indirect/embedded questions with declarative word order
- 88% have distractors, mainly extra single-word auxiliary verbs (did/do/does)
- ~77% of chunks are single words; multi-word chunks only for natural collocations
- Core test: "indirect questions do NOT invert" and distractor did/do tests this.

Return ONLY JSON:
{
  "overall_ets_similarity": 0-100,
  "overall_solvability": 0-100,
  "blockers": ["critical issue..."],
  "question_scores": [
    {"id":"...", "ets_similarity":0-100, "solvability":0-100, "issues":["..."]}
  ]
}

Blockers (ONLY for critical issues):
- clearly ambiguous order (multiple valid answers)
- ungrammatical answer
- distractor likely valid in answer
- indirect question uses inverted word order

NOT blockers (reflect in score):
- chunk style, grammar labels, scene variety

Items:
${JSON.stringify(questions, null, 2)}
`.trim();
}

function parseReviewJson(text) {
  const body = String(text || "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("no JSON object in review output");
  }
  const parsed = JSON.parse(body.slice(start, end + 1));
  return {
    overall_score: Number(parsed?.overall_score || 0),
    blockers: Array.isArray(parsed?.blockers) ? parsed.blockers.map((x) => String(x || "")) : [],
    question_scores: Array.isArray(parsed?.question_scores) ? parsed.question_scores : [],
  };
}

function parseConsistencyJson(text) {
  const body = String(text || "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("no JSON object in consistency output");
  }
  const parsed = JSON.parse(body.slice(start, end + 1));
  return {
    overall_ets_similarity: Number(parsed?.overall_ets_similarity || 0),
    overall_solvability: Number(parsed?.overall_solvability || 0),
    blockers: Array.isArray(parsed?.blockers) ? parsed.blockers.map((x) => String(x || "")) : [],
    question_scores: Array.isArray(parsed?.question_scores) ? parsed.question_scores : [],
  };
}

function createCircuitBreakerState() {
  return {
    history: [],
    active: {},
    events: [],
  };
}

function aggregateTypeStats(entries, type) {
  return (entries || []).reduce((acc, entry) => {
    const stats = entry?.typeStats?.[type] || { generated: 0, accepted: 0, rejected: 0, reasons: {} };
    acc.generated += stats.generated || 0;
    acc.accepted += stats.accepted || 0;
    acc.rejected += stats.rejected || 0;
    Object.entries(stats.reasons || {}).forEach(([reason, count]) => {
      acc.reasons[reason] = (acc.reasons[reason] || 0) + count;
    });
    return acc;
  }, { generated: 0, accepted: 0, rejected: 0, reasons: {} });
}

function getActiveCircuitBreakerTypes(state, round) {
  return new Set(
    Object.entries(state?.active || {})
      .filter(([, info]) => info && info.untilRound >= round)
      .map(([type]) => type),
  );
}

function fallbackTypesForDifficulty(diff, blockedTypes) {
  const base = diff === "easy"
    ? ["3rd-reporting", "1st-embedded", "negation"]
    : diff === "hard"
    ? ["3rd-reporting", "1st-embedded", "relative", "negation", "direct"]
    : ["3rd-reporting", "1st-embedded", "negation", "relative", "direct", "interrogative"];
  const blocked = blockedTypes || new Set();
  return base.filter((type) => !blocked.has(type));
}

function applyCircuitBreakersToSpec(spec, blockedTypes, poolState, globalTypeTargets) {
  const blocked = blockedTypes || new Set();
  if (!Array.isArray(spec) || blocked.size === 0) return spec;
  const rewritten = spec.map((cell) => ({ ...cell }));
  for (const cell of rewritten) {
    if (!blocked.has(cell.type)) continue;
    const fallback = chooseGapWeightedType(
      poolState,
      globalTypeTargets,
      fallbackTypesForDifficulty(cell.difficulty, blocked),
      "3rd-reporting",
    );
    cell.type = fallback;
  }
  return rewritten.reduce((acc, cell) => {
    const existing = acc.find((x) => x.type === cell.type && x.difficulty === cell.difficulty);
    if (existing) existing.count += cell.count;
    else acc.push(cell);
    return acc;
  }, []);
}

function updateCircuitBreakers(state, round, mode, spec, result) {
  if (!state || mode !== "normal" || !result?.typeStats) return;
  state.history.push({
    round,
    mode,
    spec: Array.isArray(spec) ? spec.map((x) => ({ ...x })) : [],
    typeStats: result.typeStats,
  });
  state.history = state.history.slice(-Math.max(CIRCUIT_BREAKER_WINDOW, 6));

  const recent = state.history.slice(-CIRCUIT_BREAKER_WINDOW);
  for (const type of TYPE_LIST) {
    const aggregate = aggregateTypeStats(recent, type);
    const acceptRate = aggregate.generated > 0 ? aggregate.accepted / aggregate.generated : 1;
    const currentlyActive = state.active[type] && state.active[type].untilRound >= round;
    if (
      aggregate.generated >= CIRCUIT_BREAKER_MIN_GENERATED &&
      acceptRate <= CIRCUIT_BREAKER_MIN_ACCEPT_RATE &&
      !currentlyActive
    ) {
      const reasons = Object.entries(aggregate.reasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      const event = {
        triggeredAt: new Date().toISOString(),
        round,
        mode,
        type,
        generated: aggregate.generated,
        accepted: aggregate.accepted,
        rejected: aggregate.rejected,
        acceptRate: Number(acceptRate.toFixed(3)),
        reasons,
        recentRounds: recent.map((entry) => ({
          round: entry.round,
          spec: entry.spec,
          stats: entry.typeStats[type] || null,
        })),
        blockedUntilRound: round + CIRCUIT_BREAKER_COOLDOWN_ROUNDS,
      };
      state.active[type] = {
        sinceRound: round,
        untilRound: round + CIRCUIT_BREAKER_COOLDOWN_ROUNDS,
        lastEvent: event,
      };
      state.events.push(event);
      console.warn(
        `[circuit-breaker] round ${round} type=${type} acceptRate=${event.acceptRate} blockedUntil=${event.blockedUntilRound}`,
      );
    }
  }

  for (const [type, info] of Object.entries(state.active)) {
    if (info && info.untilRound < round) delete state.active[type];
  }
}

function flushCircuitBreakerLog(state) {
  if (!state) return;
  const payload = {
    generated_at: new Date().toISOString(),
    active: state.active,
    events: state.events,
    history: state.history,
  };
  writeFileSync(CIRCUIT_BREAKER_LOG_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function hardValidateQuestion(q) {
  const promptContract = validateStructuredPromptParts(q, { requireStructured: true });
  if (promptContract.fatal.length > 0) return { ok: false, reason: `prompt: ${promptContract.fatal.join("; ")}` };
  if (promptContract.format.length > 0) return { ok: false, reason: `prompt: ${promptContract.format.join("; ")}` };

  const v = validateQuestion(q);
  if (v.fatal.length > 0) return { ok: false, reason: `fatal: ${v.fatal.join("; ")}` };
  // format and content issues are soft warnings, not hard fails
  if (v.format.length > 0) return { ok: false, reason: `format: ${v.format.join("; ")}` };

  // hardFailReasons delegates to validateQuestion().fatal, already checked above
  // Skip redundant call

  try {
    const rq = normalizeRuntimeQuestion(q);
    validateRuntimeQuestion(rq);
    if (hasAmbiguousArrangements(rq)) {
      return { ok: false, reason: "ambiguity: heuristic score exceeded threshold (duplicate chunks or too many mobile prepositional phrases)" };
    }
  } catch (e) {
    return { ok: false, reason: `runtime: ${e.message}` };
  }

  return { ok: true };
}

async function callModelCreative(userPrompt) {
  return callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: 120000,
    payload: {
      model: "deepseek-chat",
      temperature: 0.7,
      max_tokens: 5000,
      messages: [{ role: "user", content: userPrompt }],
    },
  });
}

async function callModelDeterministic(userPrompt) {
  return callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: 120000,
    payload: {
      model: "deepseek-chat",
      temperature: 0,
      max_tokens: 5000,
      messages: [{ role: "user", content: userPrompt }],
    },
  });
}

function errMsg(e) {
  const msg = formatDeepSeekError ? formatDeepSeekError(e) : String(e?.message || e || "");
  return msg || String(e?.code || "unknown_error");
}

async function generateCandidateRound(round, spec, rejectFeedback = "", recentPool = []) {
  // spec: [{type, difficulty, count}, ...]
  const totalCount = spec.reduce((s, x) => s + x.count, 0);
  const out = {
    generated: 0,
    accepted: 0,
    rejected: 0,
    rejectReasons: {},
    questions: [],
    typeStats: Object.fromEntries(
      TYPE_LIST.map((type) => [type, { generated: 0, accepted: 0, rejected: 0, reasons: {} }]),
    ),
  };

  const recentTopics = extractRecentTopics(recentPool);
  const generatedRaw = await callModelCreative(buildGeneratePrompt(round, spec, rejectFeedback, recentTopics));
  const arr = parseJsonArray(generatedRaw);
  if (!Array.isArray(arr) || arr.length < Math.floor(totalCount * 0.7)) {
    throw new Error(`round ${round}: model returned ${arr?.length ?? 0} questions, expected ~${totalCount}`);
  }

  const normalized = arr.map((q, i) => normalizeQuestion(q, `tmp_r${round}_q${i + 1}`));
  out.generated = normalized.length;
  normalized.forEach((q) => {
    const type = resolvedAnswerType(q);
    out.typeStats[type].generated += 1;
  });

  // Prompt Reformatter: convert two-part prompts to single-question TPO style
  const reformatted = await reformatPrompts(normalized);
  const reformatCount = reformatted.filter((q, i) => !(q.prompt_context || "") !== !(normalized[i].prompt_context || "")).length;
  if (reformatCount > 0) console.log(`  reformatter: converted ${reformatCount} two-part prompts to single-question style`);

  // hard filter first
  const hardPassed = [];
  for (const q of reformatted) {
    const hv = hardValidateQuestion(q);
    if (!hv.ok) {
      const type = resolvedAnswerType(q);
      out.rejected += 1;
      out.rejectReasons[hv.reason] = (out.rejectReasons[hv.reason] || 0) + 1;
      out.typeStats[type].rejected += 1;
      out.typeStats[type].reasons[hv.reason] = (out.typeStats[type].reasons[hv.reason] || 0) + 1;
      continue;
    }
    hardPassed.push(q);
  }

  if (hardPassed.length === 0) return out;

  // Topic novelty check BEFORE reviewer — saves 2 API calls per topic-rejected question
  const topicPassed = [];
  for (const q of hardPassed) {
    if (isTopicRepeat(q, recentPool)) {
      const type = resolvedAnswerType(q);
      out.rejected += 1;
      const r = "topic:repeat";
      out.rejectReasons[r] = (out.rejectReasons[r] || 0) + 1;
      out.typeStats[type].rejected += 1;
      out.typeStats[type].reasons[r] = (out.typeStats[type].reasons[r] || 0) + 1;
      continue;
    }
    topicPassed.push(q);
  }

  if (topicPassed.length === 0) return out;

  // AI review score — only on topic-passed questions
  const reviewRaw = await callModelDeterministic(buildReviewPrompt(topicPassed));
  const review = parseReviewJson(reviewRaw);
  const scoreMap = new Map(
    review.question_scores.map((qs) => [String(qs?.id || ""), Number(qs?.score || 0)]),
  );
  const consistencyRaw = await callModelDeterministic(buildConsistencyPrompt(topicPassed));
  const consistency = parseConsistencyJson(consistencyRaw);
  const cMap = new Map(
    consistency.question_scores.map((qs) => [
      String(qs?.id || ""),
      {
        ets: Number(qs?.ets_similarity || 0),
        solvability: Number(qs?.solvability || 0),
      },
    ]),
  );

  for (const q of topicPassed) {
    const score = scoreMap.has(q.id) ? scoreMap.get(q.id) : 0;
    const c = cMap.get(q.id) || { ets: 0, solvability: 0 };
    const blocked = (
      (review.blockers.length > 0 && review.overall_score < MIN_REVIEW_OVERALL) ||
      (consistency.blockers.length > 0 && (
        consistency.overall_ets_similarity < MIN_ETS_SIMILARITY ||
        consistency.overall_solvability < MIN_SOLVABILITY
      ))
    );
    if (blocked || score < MIN_REVIEW_SCORE || c.ets < MIN_ETS_SIMILARITY || c.solvability < MIN_SOLVABILITY) {
      const type = resolvedAnswerType(q);
      out.rejected += 1;
      let r = "";
      if (blocked) {
        const b = [...review.blockers, ...consistency.blockers].filter(Boolean).join("|");
        r = `review:blocker:${b}`;
      } else if (score < MIN_REVIEW_SCORE) {
        r = `review:score<${MIN_REVIEW_SCORE}`;
      } else if (c.ets < MIN_ETS_SIMILARITY) {
        r = `review:ets<${MIN_ETS_SIMILARITY}`;
      } else {
        r = `review:solvability<${MIN_SOLVABILITY}`;
      }
      out.rejectReasons[r] = (out.rejectReasons[r] || 0) + 1;
      out.typeStats[type].rejected += 1;
      out.typeStats[type].reasons[r] = (out.typeStats[type].reasons[r] || 0) + 1;
      continue;
    }
    const type = resolvedAnswerType(q);
    out.accepted += 1;
    out.typeStats[type].accepted += 1;
    out.questions.push(q);
  }

  return out;
}

// Pre-compute per-question style metadata once so profileStyle() is O(n) sums
// instead of re-splitting strings on every retry attempt.
function attachMeta(q) {
  if (q._meta) return q; // already computed
  const wordCount = String(q.answer || "")
    .replace(/[.,!?;:]/g, " ").trim().split(/\s+/).filter(Boolean).length;
  const effectiveChunks = Array.isArray(q.chunks)
    ? q.chunks.filter((c) => c !== q.distractor).length
    : 0;
  q._meta = {
    wordCount,
    effectiveChunks,
    hasDistractor: q.distractor != null,
    isEmbedded: isEmbeddedQuestion(q.grammar_points),
    hasQuestionMark: q.has_question_mark === true,
    answerType: resolvedAnswerType(q),
  };
  return q;
}

function splitPoolByDifficulty(questions) {
  const pool = { easy: [], medium: [], hard: [] };
  questions.forEach((q) => {
    const est = estimateQuestionDifficulty(q);
    pool[est.bucket].push(attachMeta(q));
  });
  pool.easy = shuffle(uniqBy(pool.easy, stableAnswerKey));
  pool.medium = shuffle(uniqBy(pool.medium, stableAnswerKey));
  pool.hard = shuffle(uniqBy(pool.hard, stableAnswerKey));
  return pool;
}

function cloneQuestion(q) {
  const c = JSON.parse(JSON.stringify(q));
  delete c._meta; // _meta is internal; don't persist to output JSON
  return c;
}

/**
 * Per-set assembly no longer uses hard type templates.
 * We keep only difficulty counts and prefer light type diversity within each difficulty bucket.
 */
const SET_TYPE_TARGETS = {
  easy: [
    { type: "any", count: 1 },
  ],
  medium: [
    { type: "any", count: 7 },
  ],
  hard: [
    { type: "any", count: 2 },
  ],
};

/**
 * Pick items from a difficulty pool while respecting type quotas.
 * Falls back to any type in the same pool if a specific type is unavailable.
 */
function pickDiversified(pool, targets) {
  const result = [];
  const usedIds = new Set();
  const totalNeeded = targets.reduce((sum, t) => sum + t.count, 0);
  const typeCounts = {};

  while (result.length < totalNeeded) {
    const remaining = pool.filter((q) => !usedIds.has(q.id));
    if (remaining.length === 0) break;

    const ranked = shuffle(remaining).sort((a, b) => {
      const ta = (a._meta || {}).answerType || "unknown";
      const tb = (b._meta || {}).answerType || "unknown";
      const ca = typeCounts[ta] || 0;
      const cb = typeCounts[tb] || 0;
      if (ca !== cb) return ca - cb;
      return 0;
    });

    const picked = ranked[0];
    result.push(picked);
    usedIds.add(picked.id);
    const type = (picked._meta || {}).answerType || "unknown";
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }

  return result;
}
function composeOneSet(pool, setId, maxRetries = 500) {
  const { easy: eN, medium: mN, hard: hN } = ETS_2026_TARGET_COUNTS_10;

  // Use pre-computed _meta for cheap O(n) profile 锟?no string splitting per attempt
  function profileStyle(items) {
    const total = items.length || 1;
    let qmark = 0, distractor = 0, embedded = 0, sumWords = 0, sumChunks = 0;
    const typeCounts = {};

    for (const q of items) {
      const m = q._meta;
      if (m.hasQuestionMark) qmark++;
      if (m.hasDistractor) distractor++;
      if (m.isEmbedded) embedded++;
      sumWords += m.wordCount;
      sumChunks += m.effectiveChunks;
      const t = m.answerType || "unknown";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    return { total, qmark, distractor, embedded, avgWords: sumWords / total, avgChunks: sumChunks / total, typeCounts, items };
  }

  // TPO style gates: 92% statements, 88% distractors, 63% embedded
  function stylePassStrict(p) {
    // Type monopoly check: no single type should exceed 6 items (3rd-reporting avg is 5.4)
    const maxTypeCount = Math.max(...Object.values(p.typeCounts));
    
    // Prompt uniqueness check: no identical prompts within a 10-item set
    const prompts = p.items.map(q => q.prompt.toLowerCase().trim());
    const uniquePrompts = new Set(prompts);
    const hasDuplicatePrompts = uniquePrompts.size < prompts.length;

    return (
      !hasDuplicatePrompts &&
      p.qmark >= 0 && p.qmark <= 2 &&
      p.distractor >= 7 && p.distractor <= 10 &&
      p.embedded >= 5 && p.embedded <= 8 &&
      p.avgWords >= 9.0 && p.avgWords <= 13.0 &&
      p.avgChunks >= 4.5 && p.avgChunks <= 7.5 &&
      maxTypeCount <= 6
    );
  }

  function stylePassRelaxed(p) {
    const maxTypeCount = Math.max(...Object.values(p.typeCounts));
    const prompts = p.items.map(q => q.prompt.toLowerCase().trim());
    const uniquePrompts = new Set(prompts);
    const hasManyDuplicatePrompts = uniquePrompts.size < prompts.length - 1; // Allow max 1 duplicate in relaxed mode

    return (
      !hasManyDuplicatePrompts &&
      p.qmark >= 0 && p.qmark <= 3 &&
      p.distractor >= 6 && p.distractor <= 10 &&
      p.embedded >= 4 && p.embedded <= 9 &&
      p.avgWords >= 8.5 && p.avgWords <= 14.0 &&
      p.avgChunks >= 4.0 && p.avgChunks <= 8.0 &&
      maxTypeCount <= 8
    );
  }

  // Pre-flight feasibility check: bail early if style gate can never be satisfied.
  // Compute the best-case embedded/distractor counts achievable from this pool.
  function isFeasible() {
    if (
      pool.easy.length < eN ||
      pool.medium.length < mN ||
      pool.hard.length < hN
    ) return false;

    const maxEmbedded =
      Math.min(eN, pool.easy.filter((q) => q._meta.isEmbedded).length) +
      Math.min(mN, pool.medium.filter((q) => q._meta.isEmbedded).length) +
      Math.min(hN, pool.hard.filter((q) => q._meta.isEmbedded).length);
    if (maxEmbedded < 4) return false; // relaxed gate minimum

    const maxDistractor =
      Math.min(eN, pool.easy.filter((q) => q._meta.hasDistractor).length) +
      Math.min(mN, pool.medium.filter((q) => q._meta.hasDistractor).length) +
      Math.min(hN, pool.hard.filter((q) => q._meta.hasDistractor).length);
    if (maxDistractor < 6) return false; // relaxed gate minimum

    return true;
  }

  if (!isFeasible()) {
    console.warn(`  [assembly set ${setId}] isFeasible=false: easy=${pool.easy.length}/${eN} medium=${pool.medium.length}/${mN} hard=${pool.hard.length}/${hN} embedded_max=${
      Math.min(eN, pool.easy.filter(q=>q._meta.isEmbedded).length) +
      Math.min(mN, pool.medium.filter(q=>q._meta.isEmbedded).length) +
      Math.min(hN, pool.hard.filter(q=>q._meta.isEmbedded).length)
    } distractor_max=${
      Math.min(eN, pool.easy.filter(q=>q._meta.hasDistractor).length) +
      Math.min(mN, pool.medium.filter(q=>q._meta.hasDistractor).length) +
      Math.min(hN, pool.hard.filter(q=>q._meta.hasDistractor).length)
    }`);
    return null;
  }

  const diag = { styleStrict: 0, styleRelaxed: 0, schemaOk: 0, diffOk: 0, runtimeOk: 0 };

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    if (
      pool.easy.length < eN ||
      pool.medium.length < mN ||
      pool.hard.length < hN
    ) return null;

    const picked = [
      ...pickDiversified(pool.easy, SET_TYPE_TARGETS.easy),
      ...pickDiversified(pool.medium, SET_TYPE_TARGETS.medium),
      ...pickDiversified(pool.hard, SET_TYPE_TARGETS.hard),
    ];

    // Safety check
    if (picked.length !== 10) continue;

    // 1. Style gate first 锟?cheap, uses pre-computed _meta, no clone needed
    const style = profileStyle(picked);
    const isStrict = attempt < Math.floor(maxRetries * 0.6);
    const styleGate = isStrict ? stylePassStrict : stylePassRelaxed;
    if (!styleGate(style)) {
      if (isStrict) diag.styleStrict++; else diag.styleRelaxed++;
      continue;
    }

    // 2. Clone + re-id only after style passes (avoids wasted deep-clones)
    const merged = shuffle(picked).map(cloneQuestion);
    merged.forEach((q, i) => { q.id = `ets_s${setId}_q${i + 1}`; });

    // 3. Schema + difficulty validation (rare failures; done after cheap gate)
    const set = { set_id: setId, questions: merged };
    const schemaResult = validateQuestionSet(set);
    const diff = evaluateSetDifficultyAgainstTarget(merged);
    if (!schemaResult.ok || !diff.ok || !diff.meetsTargetCount10) {
      diag.schemaOk++;
      continue;
    }

    // 4. Runtime strict check
    let runtimeOk = true;
    for (const q of merged) {
      try {
        const rq = normalizeRuntimeQuestion(q);
        validateRuntimeQuestion(rq);
      } catch (_) {
        runtimeOk = false;
        break;
      }
    }
    if (!runtimeOk) { diag.runtimeOk++; continue; }

    // Consume used questions from pool (by answer key)
    const usedKeys = new Set(picked.map(stableAnswerKey));
    pool.easy = pool.easy.filter((q) => !usedKeys.has(stableAnswerKey(q)));
    pool.medium = pool.medium.filter((q) => !usedKeys.has(stableAnswerKey(q)));
    pool.hard = pool.hard.filter((q) => !usedKeys.has(stableAnswerKey(q)));

    return set;
  }

  // Log detailed failure breakdown
  const negationItems = [...pool.easy, ...pool.medium, ...pool.hard]
    .filter(q => (q._meta || {}).answerType === "negation").length;
  const embeddedItems = [...pool.easy, ...pool.medium, ...pool.hard]
    .filter(q => (q._meta || {}).isEmbedded).length;
  const poolTotal = pool.easy.length + pool.medium.length + pool.hard.length;
  console.warn(`  [assembly set ${setId}] FAILED after ${maxRetries} retries`);
  console.warn(`    pool: easy=${pool.easy.length} medium=${pool.medium.length} hard=${pool.hard.length} total=${poolTotal}`);
  console.warn(`    pool stats: negation=${negationItems} embedded=${embeddedItems} (${Math.round(embeddedItems/poolTotal*100)}%)`);
  console.warn(`    fail breakdown: styleStrict=${diag.styleStrict} styleRelaxed=${diag.styleRelaxed} schema/diff=${diag.schemaOk} runtime=${diag.runtimeOk}`);

  // Sample a failed schema check to show actual errors
  const samplePicked = [
    ...pickDiversified(pool.easy, SET_TYPE_TARGETS.easy),
    ...pickDiversified(pool.medium, SET_TYPE_TARGETS.medium),
    ...pickDiversified(pool.hard, SET_TYPE_TARGETS.hard),
  ];
  if (samplePicked.length === 10) {
    const sampleMerged = shuffle(samplePicked).map(cloneQuestion);
    sampleMerged.forEach((q, i) => { q.id = `sample_q${i + 1}`; });
    const sampleSchema = validateQuestionSet({ set_id: 0, questions: sampleMerged });
    const sampleDiff = evaluateSetDifficultyAgainstTarget(sampleMerged);
    const sampleStyle = profileStyle(samplePicked);
    console.warn(`    sample pick: qmark=${sampleStyle.qmark} distractor=${sampleStyle.distractor} embedded=${sampleStyle.embedded} avgWords=${sampleStyle.avgWords.toFixed(1)} avgChunks=${sampleStyle.avgChunks.toFixed(1)} maxType=${Math.max(...Object.values(sampleStyle.typeCounts))}`);
    if (!sampleSchema.ok) console.warn(`    schema errors: ${sampleSchema.errors.join(" | ")}`);
    if (!sampleDiff.meetsTargetCount10) console.warn(`    diff counts: easy=${sampleDiff.profile.counts.easy} medium=${sampleDiff.profile.counts.medium} hard=${sampleDiff.profile.counts.hard}`);
  }

  return null;
}

function buildFinalSetsFromPool(pool, targetCount) {
  const sets = [];
  for (let i = 1; i <= targetCount; i += 1) {
    const set = composeOneSet(pool, i);
    if (!set) {
      console.warn(`  [assembly] set ${i} could not be assembled 锟?continuing to next`);
      continue;
    }
    sets.push(set);
  }
  return sets;
}

function summarizeRejectReasons(map) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
}

function flushPoolCheckpoint(pool) {
  try {
    const snapshot = uniqBy(pool, stableAnswerKey).map((q) => {
      const c = cloneQuestion(q);
      delete c._meta;
      return c;
    });
    writeFileSync(RESERVE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    console.log(`[checkpoint] saved ${snapshot.length} questions to reserve_pool.json`);
  } catch (_) {
    // non-fatal
  }
}

async function main() {
  loadEnv();
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("ERROR: DEEPSEEK_API_KEY missing");
    process.exit(1);
  }

  console.log("Build Sentence Robust Generator");
  console.log("==============================");
  console.log(`Target sets: ${TARGET_SET_COUNT}`);
  console.log(`Proxy: ${resolveProxyUrl() || "(direct)"}`);

  // Seed pool from questions.json (active bank) + reserve_pool.json (leftovers)
  const acceptedPool = [];
  for (const [label, filePath] of [["questions.json", OUTPUT_PATH], ["reserve_pool.json", RESERVE_PATH]]) {
    try {
      const data = JSON.parse(readFileSync(filePath, "utf8"));
      // questions.json stores sets; reserve_pool.json stores a flat array
      const seeded = Array.isArray(data)
        ? data
        : (data.question_sets || []).flatMap((s) => s.questions || []);
      if (seeded.length > 0) {
        acceptedPool.push(...seeded);
        console.log(`Seeded ${seeded.length} questions from ${label}`);
      }
    } catch (_) {
      // file missing or invalid 锟?skip
    }
  }

  const rejectReasons = {};
  let rollingRejectFeedback = "";
  let statTotalRounds = 0;
  let statTotalGenerated = 0;
  let statTotalAccepted = 0;
  const circuitBreakerState = createCircuitBreakerState();
  const easyTarget = ETS_2026_TARGET_COUNTS_10.easy * TARGET_SET_COUNT;
  const mediumTarget = ETS_2026_TARGET_COUNTS_10.medium * TARGET_SET_COUNT;
  const hardTarget = ETS_2026_TARGET_COUNTS_10.hard * TARGET_SET_COUNT;
  const styleTargets = {
    embeddedMin: 5 * TARGET_SET_COUNT,
    negationMin: 2 * TARGET_SET_COUNT,
    distractorMin: 7 * TARGET_SET_COUNT,
    qmarkMax: 2 * TARGET_SET_COUNT,
  };

  const BUFFER = 1.5;
  const difficultyTargets = {
    easy: Math.ceil(easyTarget * BUFFER),
    medium: Math.ceil(mediumTarget * BUFFER),
    hard: Math.ceil(hardTarget * BUFFER),
  };
  const globalTypeTargetTotal = TARGET_SET_COUNT * 10;
  const globalTypeTargets = Object.fromEntries(
    TYPE_LIST.map((type) => [type, Math.max(1, Math.ceil(globalTypeTargetTotal * TPO_TYPE_TARGET_RATIO[type]))]),
  );

  function computeCoverageGaps(poolState, pool) {
    return {
      diff: {
        easy: Math.max(0, difficultyTargets.easy - pool.easy.length),
        medium: Math.max(0, difficultyTargets.medium - pool.medium.length),
        hard: Math.max(0, difficultyTargets.hard - pool.hard.length),
      },
      style: {
        embedded: Math.max(0, styleTargets.embeddedMin - poolState.style.embedded),
        negation: Math.max(0, styleTargets.negationMin - poolState.style.negation),
        distractor: Math.max(0, styleTargets.distractorMin - poolState.style.distractor),
      },
      type: Object.fromEntries(TYPE_LIST.map((type) => [type, Math.max(0, (globalTypeTargets[type] || 0) - (poolState.typeTotals[type] || 0))])),
    };
  }

  // ── Unified adaptive generation loop ──────────────────────────────────────
  const MAX_ROUNDS = Number(process.env.BS_MAX_ROUNDS) || (8 + TARGET_SET_COUNT * 4);
  const GAP_TOLERANCE = 5;
  const STUCK_ROUNDS = 5;
  console.log(`Max rounds: ${MAX_ROUNDS} (= 8 + ${TARGET_SET_COUNT} sets × 4)`);

  // Total gap: diff + type (covers type-based style needs) + distractor (only style not covered by type)
  // Does NOT double-count negation/embedded which appear in both type and style targets.
  function computeTotalGap(poolState, pool) {
    const diffGap =
      Math.max(0, difficultyTargets.easy - pool.easy.length) +
      Math.max(0, difficultyTargets.medium - pool.medium.length) +
      Math.max(0, difficultyTargets.hard - pool.hard.length);
    const typeGap = TYPE_LIST.reduce((sum, t) =>
      sum + Math.max(0, (globalTypeTargets[t] || 0) - (poolState.typeTotals[t] || 0)), 0);
    const distractorGap = Math.max(0, styleTargets.distractorMin - poolState.style.distractor);
    return { total: diffGap + typeGap + distractorGap, diffGap, typeGap, distractorGap };
  }

  // Decide batch size and targeting based on current gap.
  // Large gap → broad AI-planned batch. Small gap → micro targeted batch (no AI planner needed).
  function scheduleNextBatch(gap, poolState, pool, cbState, roundNum) {
    if (gap.total > 20) {
      return { mode: "broad", batchSize: 10, useAIPlanner: true };
    }
    if (gap.total > 4) {
      return { mode: "medium", batchSize: 5, useAIPlanner: true };
    }
    // Micro mode: directly target the most needed non-blocked type/difficulty
    const blockedTypes = getActiveCircuitBreakerTypes(cbState, roundNum);
    const bestType = TYPE_LIST
      .filter((t) => !blockedTypes.has(t))
      .map((t) => ({ type: t, gap: Math.max(0, (globalTypeTargets[t] || 0) - (poolState.typeTotals[t] || 0)) }))
      .sort((a, b) => b.gap - a.gap)[0];
    const bestDiff = ["hard", "medium", "easy"]
      .find((d) => pool[d].length < difficultyTargets[d]) || "medium";
    return {
      mode: "micro",
      batchSize: 2,
      useAIPlanner: false,
      spec: [{ type: bestType?.type || "3rd-reporting", difficulty: bestDiff, count: 2 }],
    };
  }

  let totalRound = 0;
  let minGapSeen = Infinity;
  let roundsSinceNewMin = 0;

  while (true) {
    const pool = splitPoolByDifficulty(acceptedPool);
    const poolState = computePoolState(acceptedPool);
    const gap = computeTotalGap(poolState, pool);

    if (gap.total <= GAP_TOLERANCE) {
      console.log(`✓ gap satisfied (total=${gap.total} ≤ ${GAP_TOLERANCE}), stopping`);
      break;
    }
    if (totalRound >= MAX_ROUNDS) {
      console.log(`⚠ max rounds (${MAX_ROUNDS}) reached, gap remaining=${gap.total}`);
      break;
    }

    // Stuck detector: abort if gap hasn't reached a new minimum in STUCK_ROUNDS consecutive rounds
    if (gap.total < minGapSeen) {
      minGapSeen = gap.total;
      roundsSinceNewMin = 0;
    } else {
      roundsSinceNewMin++;
      if (roundsSinceNewMin >= STUCK_ROUNDS) {
        console.log(`⚠ stuck for ${STUCK_ROUNDS} rounds without progress (gap=${gap.total}), aborting`);
        break;
      }
    }

    const roundNum = totalRound + 1;
    const schedule = scheduleNextBatch(gap, poolState, pool, circuitBreakerState, roundNum);

    let spec;
    if (schedule.useAIPlanner) {
      try {
        const plannerRaw = await callModelDeterministic(
          buildPlannerPrompt(poolState, difficultyTargets, globalTypeTargets, styleTargets, schedule.batchSize, "normal"),
        );
        const plannedSpec = enforcePlannerStyleGaps(
          parsePlannerSpec(plannerRaw, schedule.batchSize),
          poolState, styleTargets, globalTypeTargets, difficultyTargets, schedule.batchSize,
        );
        const blockedTypes = getActiveCircuitBreakerTypes(circuitBreakerState, roundNum);
        spec = applyCircuitBreakersToSpec(plannedSpec, blockedTypes, poolState, globalTypeTargets);
      } catch (e) {
        console.log(`round ${roundNum}: planner failed (${errMsg(e)}), using fallback`);
        spec = [{ type: "3rd-reporting", difficulty: "medium", count: schedule.batchSize }];
      }
    } else {
      spec = schedule.spec;
    }

    const specLabel = spec.map((s) => `${s.count}×${s.type}/${s.difficulty}`).join(", ");
    console.log(`round ${roundNum} [${schedule.mode}] gap=${gap.total} → [${specLabel}]`);

    try {
      const res = await generateCandidateRound(roundNum, spec, rollingRejectFeedback, acceptedPool);
      acceptedPool.push(...res.questions);
      statTotalRounds += 1;
      statTotalGenerated += res.generated;
      statTotalAccepted += res.accepted;
      Object.entries(res.rejectReasons).forEach(([k, v]) => {
        rejectReasons[k] = (rejectReasons[k] || 0) + v;
      });
      rollingRejectFeedback = buildRejectFeedbackHints(rejectReasons);

      const newPool = splitPoolByDifficulty(acceptedPool);
      const newGap = computeTotalGap(computePoolState(acceptedPool), newPool);
      console.log(
        `round ${roundNum}: generated=${res.generated} accepted=${res.accepted} rejected=${res.rejected} gap=${gap.total}→${newGap.total} | easy=${newPool.easy.length} medium=${newPool.medium.length} hard=${newPool.hard.length}`,
      );
      if (res.rejected > 0) {
        Object.entries(res.rejectReasons).sort((a, b) => b[1] - a[1]).slice(0, 3)
          .forEach(([r, n]) => console.log(`  reject: ${r} (×${n})`));
      }
      updateCircuitBreakers(circuitBreakerState, roundNum, "normal", spec, res);
      flushCircuitBreakerLog(circuitBreakerState);
      flushPoolCheckpoint(acceptedPool);
    } catch (e) {
      console.log(`round ${roundNum}: failed → ${errMsg(e)}`);
      flushPoolCheckpoint(acceptedPool);
    }

    totalRound++;
    await new Promise((r) => setTimeout(r, 3000));
  }

  const dedupedPool = uniqBy(acceptedPool, stableAnswerKey);
  const poolByDiff = splitPoolByDifficulty(dedupedPool);
  console.log(`final pool: easy=${poolByDiff.easy.length} medium=${poolByDiff.medium.length} hard=${poolByDiff.hard.length}`);

  const finalSets = buildFinalSetsFromPool(poolByDiff, TARGET_SET_COUNT);
  if (finalSets.length === 0) {
    console.error("No sets assembled at all 锟?aborting.");
    process.exit(1);
  }
  if (finalSets.length < TARGET_SET_COUNT) {
    console.warn(
      `Warning: only assembled ${finalSets.length}/${TARGET_SET_COUNT} sets. Writing partial output.`,
    );
    console.warn(`Pool snapshot: easy=${poolByDiff.easy.length} medium=${poolByDiff.medium.length} hard=${poolByDiff.hard.length}`);
    console.warn("Top reject reasons:");
    summarizeRejectReasons(rejectReasons).forEach(([k, v]) => console.warn(`- ${k}: ${v}`));
  }

  const output = {
    version: "1.2",
    generated_at: new Date().toISOString(),
    _meta: {
      target_sets: TARGET_SET_COUNT,
      total_rounds: statTotalRounds,
      total_generated: statTotalGenerated,
      total_accepted: statTotalAccepted,
      acceptance_rate: statTotalGenerated > 0 ? Number((statTotalAccepted / statTotalGenerated).toFixed(3)) : 0,
    },
    question_sets: finalSets,
  };

  // global strict validation
  const check = validateAllSets(output, { strict: true });
  if (!check.ok) {
    console.error("Final output failed strict validation.");
    check.failures.forEach((x) => console.error(x));
    check.strictHardFails.forEach((x) => console.error(`${x.label}: ${x.reasons.join("; ")}`));
    check.strictWarnings.forEach((x) => console.error(`${x.label}: ${x.reasons.join("; ")}`));
    process.exit(1);
  }

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Saved ${finalSets.length} set(s) to ${OUTPUT_PATH}`);
  finalSets.forEach((s) => {
    const diff = evaluateSetDifficultyAgainstTarget(s.questions);
    console.log(
      `- set ${s.set_id}: easy=${diff.profile.counts.easy} medium=${diff.profile.counts.medium} hard=${diff.profile.counts.hard}`,
    );
  });

  // Save leftover questions (passed quality gates but not assembled into sets) to reserve pool
  const usedAnswers = new Set(
    finalSets.flatMap((s) => s.questions.map((q) => stableAnswerKey(q)))
  );
  const reserve = uniqBy(
    [...poolByDiff.easy, ...poolByDiff.medium, ...poolByDiff.hard]
      .filter((q) => !usedAnswers.has(stableAnswerKey(q)))
      .map((q) => { const c = cloneQuestion(q); delete c._meta; return c; }),
    stableAnswerKey
  );
  writeFileSync(RESERVE_PATH, `${JSON.stringify(reserve, null, 2)}\n`, "utf8");
  console.log(`Reserve pool: ${reserve.length} questions saved to reserve_pool.json`);

  console.log("Top reject reasons:");
  summarizeRejectReasons(rejectReasons).forEach(([k, v]) => console.log(`- ${k}: ${v}`));
  flushCircuitBreakerLog(circuitBreakerState);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

export {
  autoRepairWordBag,
  resolvedAnswerType,
  createCircuitBreakerState,
  getActiveCircuitBreakerTypes,
  applyCircuitBreakersToSpec,
  updateCircuitBreakers,
};

function writeJobState(updates) {
  const statePath = process.env.BS_JOB_STATE_PATH;
  if (!statePath) return;
  try {
    let state = {};
    try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch (_) {}
    writeFileSync(statePath, JSON.stringify({ ...state, ...updates }, null, 2), "utf8");
  } catch (_) {}
}

if (isDirectRun) {
  // Intercept process.exit to capture failure state when BS_JOB_STATE_PATH is set
  const _origExit = process.exit.bind(process);
  process.exit = (code) => {
    if (code && code !== 0) {
      writeJobState({ status: "failed", finishedAt: new Date().toISOString(), error: `process exited with code ${code}` });
    }
    _origExit(code);
  };

  main()
    .then(() => {
      writeJobState({ status: "done", finishedAt: new Date().toISOString() });
    })
    .catch((e) => {
      const msg = errMsg(e);
      console.error(`Fatal: ${msg}`);
      writeJobState({ status: "failed", finishedAt: new Date().toISOString(), error: msg });
      _origExit(1);
    });
}











