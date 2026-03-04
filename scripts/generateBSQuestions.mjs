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
 *   BS_CANDIDATE_ROUNDS=40                        (optional)
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { callDeepSeekViaCurl, resolveProxyUrl, formatDeepSeekError } = require("../lib/ai/deepseekHttp.js");
const { validateQuestionSet, validateQuestion } = require("../lib/questionBank/buildSentenceSchema.js");
const { hardFailReasons, warnings: qualityWarnings } = require("../lib/questionBank/qualityGateBuildSentence.js");
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

const OUTPUT_PATH = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const RESERVE_PATH = resolve(__dirname, "..", "data", "buildSentence", "reserve_pool.json");
const TARGET_SET_COUNT = Number(process.env.BS_TARGET_SETS || 6);
const CANDIDATE_ROUNDS = Number(process.env.BS_CANDIDATE_ROUNDS || 40);
const ADAPTIVE_BOOST_ROUNDS = Number(process.env.BS_ADAPTIVE_BOOST_ROUNDS || 80);
const MIN_REVIEW_SCORE = Number(process.env.BS_MIN_REVIEW_SCORE || 78);
const MIN_REVIEW_OVERALL = Number(process.env.BS_MIN_REVIEW_OVERALL || 84);
const MIN_ETS_SIMILARITY = Number(process.env.BS_MIN_ETS_SIMILARITY || 72);
const MIN_SOLVABILITY = Number(process.env.BS_MIN_SOLVABILITY || 78);

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

  return {
    id: normalizeText(q.id) || tempId,
    prompt: normalizeText(q.prompt),
    answer,
    chunks,
    prefilled,
    prefilled_positions: correctedPositions,
    distractor,
    has_question_mark: typeof q.has_question_mark === "boolean" ? q.has_question_mark : endsWithQuestionMark(answer),
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
  // Interrogative frame: answer starts with Can/Could you tell me
  if (/^(can you tell me|could you tell me)/i.test(q.answer)) return "interrogative";
  // 3rd-person reporting
  if (/\b(wanted to know|asked me|asked him|asked her|asked us|was curious|were curious|needed to know|was wondering|were wondering|wants to know|needs to know|curious about)\b/.test(a))
    return "3rd-reporting";
  // 1st-person embedded
  if (/\b(have no idea|had no idea|don't understand|didn't understand|couldn't understand|found out|would love to know|can't decide|don't know|didn't know|do not know|did not know|does not know)\b/.test(a))
    return "1st-embedded";
  // Negation
  if (/\b(did not|didn't|have not|haven't|could not|couldn't|was not|wasn't|is not|isn't|am not|are not|aren't|has not|hasn't|do not|don't|no longer|not able|were not|weren't)\b/.test(a))
    return "negation";
  // Relative/contact clause
  if (/\bthe \w+.*(?: i | you | he | she | we | they )|\b(?:that|which|who) (?:i |you |he |she |we |they )/i.test(a))
    return "relative";
  return "direct";
}

/**
 * Per-set quota: how many questions of each type × difficulty per 10-question set.
 * Derived from statistical analysis of 60 real TPO questions across 6 sets.
 * Difficulty distribution per set: easy=1, medium=7, hard=2.
 * Type distribution within each difficulty: from TPO analysis.
 *
 * easy  (1/set):  negation≈55%, 3rd-reporting≈18%, interrogative≈18%, 1st-embedded≈9%
 * medium (7/set): 3rd-reporting≈58%, negation≈12%, 1st-embedded≈12%, interrogative≈6%, direct≈6%, relative≈6%
 * hard  (2/set):  3rd-reporting≈25%, 1st-embedded≈25%, relative≈19%, interrogative≈13%, direct≈13%, negation≈6%
 */
const TYPE_QUOTAS_PER_SET = {
  easy: {
    "negation":      0.55,
    "3rd-reporting": 0.18,
    "interrogative": 0.18,
    "1st-embedded":  0.09,
    "direct":        0,
    "relative":      0,
  },
  medium: {
    "3rd-reporting": 0.58,
    "negation":      0.12,
    "1st-embedded":  0.12,
    "interrogative": 0.06,
    "direct":        0.06,
    "relative":      0.06,
  },
  hard: {
    "3rd-reporting": 0.25,
    "1st-embedded":  0.25,
    "relative":      0.19,
    "interrogative": 0.13,
    "direct":        0.13,
    "negation":      0.05,
  },
};

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
  });

  const uniq = [...new Set(hints)];
  if (uniq.length === 0) return "";
  return `\nRecent rejection feedback (must fix):\n- ${uniq.join("\n- ")}\n`;
}

// Type × difficulty specific instructions for targeted generation
const TYPE_DIFFICULTY_HINTS = {
  "negation": {
    easy: `ALL 10 answers: simple negative statement, 7-10 words.
Structure: "I did not [verb]…" / "I could not [verb]…" / "I am not [adj]…" / "I have not [past-p] yet."
NO embedded questions. NO relative clauses. Direct and clear.
Prompt: YES/NO question ("Did you attend…?", "Have you…?", "Are you going…?")
Distractor: "did" or "do" or morphological variant (e.g. "going" for "go").`,
    medium: `ALL 10 answers: negative statement 9-12 words, optionally with short embedded element.
Examples:
- "Unfortunately, I could not attend due to a prior commitment."
- "I did not understand what the manager explained."
- "I have not received the workshop details yet."
Prompt: direct question or narrative context. Distractor: "did"/"do" or morphological variant.`,
    hard: `ALL 10 answers: negation + embedded/perfect complexity, 11-14 words.
Examples:
- "I had not realized how quickly the project deadline was approaching."
- "I did not understand why the meeting had been postponed again."
Include past perfect negation or negation + embedded clause.
Distractor: morphological variant (e.g. "realized/realize", "approaching/approach").`,
  },
  "3rd-reporting": {
    easy: `ALL 10 answers: short third-person reporting, 8-10 words.
Structure: "[Name] wanted to know if [short clause]." / "[Name] asked me what time…"
Examples:
- "He wants to know if you need a ride."
- "She asked me what time the meeting starts."
Prompt: "What did [Name] ask/want?" Distractor: "did" or "do".`,
    medium: `ALL 10 answers: third-person reporting, 10-13 words.
Structure: "[Name/They] [wanted to know / asked / was curious / needed to know] [wh/if clause]"
Vary subjects: he / she / they / the manager / the professor / some colleagues
Vary wh-words across the batch: if(3), what(2), where(2), why(2), when(1)
Declarative word order in clause (NO inversion). Distractor: "did"/"do" for most.`,
    hard: `ALL 10 answers: third-person reporting with complex embedded clause, 12-15 words.
Complexity options:
- Past perfect in clause: "He wanted to know where all the files had gone."
- Passive in clause: "She wanted to know when the report would be submitted."
- whom: "She wanted to know whom I would give the presentation to."
- Two-layer: "The manager wanted to know how we had been able to finish on time."
Distractor: morphological variant or "whom/who", "where/when" function-word swap.`,
  },
  "1st-embedded": {
    easy: `ALL 10 answers: first-person "no idea" structure, 8-10 words.
Examples:
- "I have no idea where they are going."
- "I have no idea what time the event starts."
Prompt: direct question the speaker can't answer ("Do you know…?", "Where is…?")
Distractor: "do" or "did".`,
    medium: `ALL 10 answers: first-person embedded, 10-13 words.
Examples:
- "I don't understand why he decided to quit the team."
- "I found out where the new office supplies are kept."
- "I can't decide which project topic is the most important."
- "I have no idea who will be leading the committee."
Distractor: "did"/"does" or function-word variant.`,
    hard: `ALL 10 answers: complex first-person embedded, 12-15 words.
Examples:
- "I would love to know which restaurant you enjoyed the most." (superlative)
- "I have not been told who will be responsible for the final report." (passive + embedded)
- "We just found out where the new library equipment is being stored." (passive progressive)
Include passive voice OR superlative OR perfect aspect in embedded clause.
Distractor: morphological variant (e.g. "enjoyed/enjoy", "stored/store").`,
  },
  "interrogative": {
    easy: `ALL 10 answers use "Can you tell me…?" or "Could you tell me…?" frame, 8-11 words.
Examples:
- "Can you tell me what your plans are for tomorrow?"
- "Can you tell me if the professor covered any new material?"
Prompt: conversational comment that leads to a question.
Distractor: "did"/"do" or "can".`,
    medium: `ALL 10 answers use interrogative frame, 10-13 words, moderate embedded complexity.
Examples:
- "Could you tell me how you are feeling about the new policy?"
- "Can you tell me what you did not enjoy about the presentation?"
Distractor: morphological variant or "can"/"could" swap.`,
    hard: `ALL 10 answers use interrogative frame with complex embedded question, 12-14 words.
Examples:
- "Can you tell me why you decided to choose this particular research topic?"
- "Could you tell me how the project team managed to finish ahead of schedule?"
- "Did he ask you why you chose this particular career path?"
Distractor: morphological variant (e.g. "decided/decide", "managed/manage").`,
  },
  "direct": {
    medium: `ALL 10 answers: direct declarative statement (no reporting verb, no negation), 9-12 words.
Describe a situation, location, preference, or fact.
Examples:
- "I found the work environment at this company to be much more relaxed."
- "The store next to the post office sells all types of winter apparel."
Prompt: direct question about what happened or what the speaker did.
Distractor: morphological variant (e.g. "relaxed/relax", "sells/sold").`,
    hard: `ALL 10 answers: complex direct statement, 12-15 words, with prepositional depth or comparative.
Examples:
- "This coffee tastes better than all of the other brands I have tried."
- "I found it in the back of the furniture section at the local superstore."
- "The library is only temporarily closed in town for major structural renovations."
Distractor: morphological variant or comparative swap ("better/good", "only/once").`,
  },
  "relative": {
    medium: `ALL 10 answers: contact/relative clause structure, 9-12 words.
"The [noun] [I/you] [verb]…" (contact clause — omitted relative pronoun, object only)
Examples:
- "The bookstore I stopped by had the novel in stock."
- "The diner that opened last week serves many delicious entrees."
Prompt: question about where/what the speaker found.
Distractor: morphological variant (e.g. "stopped/stop", "opened/open").`,
    hard: `ALL 10 answers: relative/contact clause with additional complexity, 12-15 words.
Combine relative clause with:
- Passive: "The desk you ordered is scheduled to arrive on Friday."
- Comparative: "This coffee tastes better than all the other brands I've tried."
- Long modifier: "The store I found near the post office sells winter apparel at a discount."
Distractor: passive helper swap or morphological variant ("scheduled/schedule", "ordered/order").`,
  },
};

function buildGeneratePrompt(round, type = "3rd-reporting", difficulty = "medium", rejectFeedback = "") {
  const hints = (TYPE_DIFFICULTY_HINTS[type] || {})[difficulty] || "";
  const difficultySpec = difficulty === "easy"
    ? "Answer length: 7-10 words. Effective chunks: 5-6. Distractor in ~5 items."
    : difficulty === "medium"
    ? "Answer length: 9-13 words. Effective chunks: 6-7. Distractor in 7-9 items."
    : "Answer length: 11-15 words. Effective chunks: 7-8. Distractor in 8-10 items. Include ≥1 morphological distractor.";

  return `
You are a TOEFL iBT Writing Task 1 "Build a Sentence" item writer.
Based on statistical analysis of 6 real TPO exam sets (60 items).
Return ONLY a JSON array with exactly 10 question objects.

## BATCH FOCUS (overrides general distribution below)
Type: ${type.toUpperCase()} | Difficulty: ${difficulty.toUpperCase()}
${hints}
${difficultySpec}

## Schema (each item):
{
  "id": "tmp_r${round}_q1",
  "prompt": "conversational context (5-15 words)",
  "answer": "correct sentence to build (7-15 words)",
  "chunks": ["lowercase chunk", "..."],
  "prefilled": ["word"] or [],
  "prefilled_positions": {"word": 0} or {},
  "distractor": null or "single lowercase word not in answer",
  "has_question_mark": true/false,
  "grammar_points": ["tag1", "tag2"]
}

## PROMPT-ANSWER LOGIC (critical):
- If answer is "[X] wanted to know / asked / wondered [wh-clause]", prompt MUST ask "What did X ask/want?" — NEVER the direct form of the wh-clause.
- WRONG: prompt="Where did you go?" answer="Emma wanted to know where I went."
- RIGHT: prompt="What did Emma want to know?" answer="Emma wanted to know where I went."
- If answer is a direct 1st-person reply, prompt should be a direct question to that person.

## Distractor rules:
- ALWAYS single word, NEVER a phrase.
- PASSIVE VOICE: NEVER use "did" — use morphological variant ("gets", "have", "been") instead.
- Distribution: ~50% extra auxiliary (did/do/does), ~30% morphological variant (staying/stay, chose/choose), ~20% function word (which/what, no/not, who/whom).

## Prefilled rules (~60% of items have prefilled):
- Common: opening subject+verb ("He wanted to know", "Unfortunately, I"), end modifier ("yet", "quickly"), mid pivot ("when", "about").
- prefilled_positions: 0-indexed word position in answer.
- Prefilled words must NOT appear in chunks.
- chunks (minus distractor) + prefilled = ALL answer words exactly.

## Chunk rules:
- Effective chunk count (excl. distractor): 4-8, TARGET 5-7.
- Max 3 words per chunk, all lowercase.
- Mix single-word and multi-word chunks (2-4 multi-word collocations per item).
- chunks (minus distractor) + prefilled = all answer words exactly.

## Grammar point labels:
- embedded/indirect question → "embedded question"
- negation → "negation"
- relative/contact clause → "relative clause" or "contact clause"
- passive → "passive voice"

## Answer uniqueness:
- Exactly one correct arrangement.
- Indirect question clauses: declarative word order (NO inversion).
- Distractor did/do/does must NOT be insertable into the answer.

${rejectFeedback}
Self-check before returning:
1. chunks (minus distractor) + prefilled = answer words exactly
2. distractor not in answer
3. prefilled_positions match actual word positions
4. prefilled words not in chunks
5. only one valid arrangement

No markdown. No explanation. JSON array only.
`.trim();
}

/**
 * Find the (type, difficulty) cell with the lowest fill ratio in the pool.
 * scaledQuotas: { easy: { "negation": N, ... }, medium: {...}, hard: {...} }
 * Returns { type, difficulty } for the next generation round.
 */
function typeFromDeficit(pool, scaledQuotas) {
  // Count current pool by type × difficulty
  const counts = {};
  for (const diff of ["easy", "medium", "hard"]) {
    counts[diff] = {};
    for (const type of Object.keys(TYPE_QUOTAS_PER_SET.easy)) {
      counts[diff][type] = 0;
    }
  }
  for (const q of pool) {
    const meta = q._meta || {};
    const type = meta.answerType || classifyAnswerType(q);
    const diff = (estimateQuestionDifficulty(q) || {}).bucket || "medium";
    if (counts[diff] && type in counts[diff]) {
      counts[diff][type]++;
    }
  }

  let minRatio = Infinity;
  let target = { type: "3rd-reporting", difficulty: "medium" };

  for (const [diff, typeMap] of Object.entries(scaledQuotas)) {
    for (const [type, quota] of Object.entries(typeMap)) {
      if (quota <= 0) continue;
      const current = counts[diff][type] || 0;
      const ratio = current / quota;
      if (ratio < minRatio) {
        minRatio = ratio;
        target = { type, difficulty: diff };
      }
    }
  }

  return target;
}

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

function hardValidateQuestion(q) {
  const v = validateQuestion(q);
  if (v.fatal.length > 0) return { ok: false, reason: `fatal: ${v.fatal.join("; ")}` };
  // format and content issues are soft warnings, not hard fails
  if (v.format.length > 0) return { ok: false, reason: `format: ${v.format.join("; ")}` };

  // hardFailReasons delegates to validateQuestion().fatal, already checked above
  // Skip redundant call

  try {
    const rq = normalizeRuntimeQuestion(q);
    validateRuntimeQuestion(rq);
  } catch (e) {
    return { ok: false, reason: `runtime: ${e.message}` };
  }

  return { ok: true };
}

async function callModel(userPrompt) {
  return callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: 120000,
    payload: {
      model: "deepseek-chat",
      temperature: 0.35,
      max_tokens: 5000,
      messages: [{ role: "user", content: userPrompt }],
    },
  });
}

function errMsg(e) {
  const msg = formatDeepSeekError ? formatDeepSeekError(e) : String(e?.message || e || "");
  return msg || String(e?.code || "unknown_error");
}

async function generateCandidateRound(round, type = "3rd-reporting", difficulty = "medium", rejectFeedback = "") {
  const out = {
    generated: 0,
    accepted: 0,
    rejected: 0,
    rejectReasons: {},
    questions: [],
  };

  const generatedRaw = await callModel(buildGeneratePrompt(round, type, difficulty, rejectFeedback));
  const arr = parseJsonArray(generatedRaw);
  if (!Array.isArray(arr) || arr.length !== 10) {
    throw new Error(`round ${round}: model did not return 10 questions`);
  }

  const normalized = arr.map((q, i) => normalizeQuestion(q, `tmp_r${round}_q${i + 1}`));
  out.generated = normalized.length;

  // hard filter first
  const hardPassed = [];
  for (const q of normalized) {
    const hv = hardValidateQuestion(q);
    if (!hv.ok) {
      out.rejected += 1;
      out.rejectReasons[hv.reason] = (out.rejectReasons[hv.reason] || 0) + 1;
      continue;
    }
    hardPassed.push(q);
  }

  if (hardPassed.length === 0) return out;

  // set-level schema gate (soft; for logging only in this stage)
  const setGate = validateQuestionSet({ set_id: round, questions: hardPassed.slice(0, Math.min(10, hardPassed.length)) });
  if (!setGate.ok) {
    setGate.errors.forEach((e) => {
      out.rejectReasons[`set-gate:${e}`] = (out.rejectReasons[`set-gate:${e}`] || 0) + 1;
    });
  }

  // AI review score
  const reviewRaw = await callModel(buildReviewPrompt(hardPassed));
  const review = parseReviewJson(reviewRaw);
  const scoreMap = new Map(
    review.question_scores.map((qs) => [String(qs?.id || ""), Number(qs?.score || 0)]),
  );
  const consistencyRaw = await callModel(buildConsistencyPrompt(hardPassed));
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

  for (const q of hardPassed) {
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
      continue;
    }
    out.accepted += 1;
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
    answerType: classifyAnswerType(q),
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

function composeOneSet(pool, setId, maxRetries = 500) {
  const { easy: eN, medium: mN, hard: hN } = ETS_2026_TARGET_COUNTS_10;

  // Use pre-computed _meta for cheap O(n) profile — no string splitting per attempt
  function profileStyle(items) {
    const total = items.length || 1;
    let qmark = 0, distractor = 0, embedded = 0, sumWords = 0, sumChunks = 0;
    for (const q of items) {
      const m = q._meta;
      if (m.hasQuestionMark) qmark++;
      if (m.hasDistractor) distractor++;
      if (m.isEmbedded) embedded++;
      sumWords += m.wordCount;
      sumChunks += m.effectiveChunks;
    }
    return { total, qmark, distractor, embedded, avgWords: sumWords / total, avgChunks: sumChunks / total };
  }

  // TPO style gates: 92% statements, 88% distractors, 63% embedded
  function stylePassStrict(p) {
    return (
      p.qmark >= 0 && p.qmark <= 2 &&
      p.distractor >= 7 && p.distractor <= 10 &&
      p.embedded >= 5 && p.embedded <= 8 &&
      p.avgWords >= 9.0 && p.avgWords <= 13.0 &&
      p.avgChunks >= 4.5 && p.avgChunks <= 7.5
    );
  }

  function stylePassRelaxed(p) {
    return (
      p.qmark >= 0 && p.qmark <= 3 &&
      p.distractor >= 6 && p.distractor <= 10 &&
      p.embedded >= 4 && p.embedded <= 9 &&
      p.avgWords >= 8.5 && p.avgWords <= 14.0 &&
      p.avgChunks >= 4.0 && p.avgChunks <= 8.0
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

  if (!isFeasible()) return null;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    if (
      pool.easy.length < eN ||
      pool.medium.length < mN ||
      pool.hard.length < hN
    ) return null;

    const picked = [
      ...shuffle(pool.easy).slice(0, eN),
      ...shuffle(pool.medium).slice(0, mN),
      ...shuffle(pool.hard).slice(0, hN),
    ];

    // 1. Style gate first — cheap, uses pre-computed _meta, no clone needed
    const style = profileStyle(picked);
    const styleGate = attempt < Math.floor(maxRetries * 0.6) ? stylePassStrict : stylePassRelaxed;
    if (!styleGate(style)) continue;

    // 2. Clone + re-id only after style passes (avoids wasted deep-clones)
    const merged = shuffle(picked).map(cloneQuestion);
    merged.forEach((q, i) => { q.id = `ets_s${setId}_q${i + 1}`; });

    // 3. Schema + difficulty validation (rare failures; done after cheap gate)
    const set = { set_id: setId, questions: merged };
    const schemaOk = validateQuestionSet(set).ok;
    const diff = evaluateSetDifficultyAgainstTarget(merged);
    if (!schemaOk || !diff.ok || !diff.meetsTargetCount10) continue;

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
    if (!runtimeOk) continue;

    // Consume used questions from pool (by answer key)
    const usedKeys = new Set(picked.map(stableAnswerKey));
    pool.easy = pool.easy.filter((q) => !usedKeys.has(stableAnswerKey(q)));
    pool.medium = pool.medium.filter((q) => !usedKeys.has(stableAnswerKey(q)));
    pool.hard = pool.hard.filter((q) => !usedKeys.has(stableAnswerKey(q)));

    return set;
  }
  return null;
}

function buildFinalSetsFromPool(pool, targetCount) {
  const sets = [];
  for (let i = 1; i <= targetCount; i += 1) {
    const set = composeOneSet(pool, i);
    if (!set) break;
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
  console.log(`Candidate rounds: ${CANDIDATE_ROUNDS}`);
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
      // file missing or invalid — skip
    }
  }

  const rejectReasons = {};
  let rollingRejectFeedback = "";
  const easyTarget = ETS_2026_TARGET_COUNTS_10.easy * TARGET_SET_COUNT;
  const mediumTarget = ETS_2026_TARGET_COUNTS_10.medium * TARGET_SET_COUNT;
  const hardTarget = ETS_2026_TARGET_COUNTS_10.hard * TARGET_SET_COUNT;

  // Scale type quotas to target set count (with 1.5x buffer for rejection overhead)
  const BUFFER = 1.5;
  const scaledQuotas = {};
  for (const [diff, typeMap] of Object.entries(TYPE_QUOTAS_PER_SET)) {
    const diffTarget = diff === "easy" ? easyTarget : diff === "medium" ? mediumTarget : hardTarget;
    scaledQuotas[diff] = {};
    for (const [type, ratio] of Object.entries(typeMap)) {
      scaledQuotas[diff][type] = Math.ceil(diffTarget * ratio * BUFFER);
    }
  }

  for (let round = 1; round <= CANDIDATE_ROUNDS; round += 1) {
    try {
      const { type, difficulty } = typeFromDeficit(acceptedPool, scaledQuotas);
      const res = await generateCandidateRound(round, type, difficulty, rollingRejectFeedback);
      acceptedPool.push(...res.questions);
      Object.entries(res.rejectReasons).forEach(([k, v]) => {
        rejectReasons[k] = (rejectReasons[k] || 0) + v;
      });
      rollingRejectFeedback = buildRejectFeedbackHints(rejectReasons);
      const pool = splitPoolByDifficulty(acceptedPool);
      console.log(
        `round ${round} [${type}/${difficulty}]: generated=${res.generated} accepted=${res.accepted} rejected=${res.rejected} | pool easy=${pool.easy.length} medium=${pool.medium.length} hard=${pool.hard.length}`,
      );

      const canBuildTargetSets =
        pool.easy.length >= easyTarget &&
        pool.medium.length >= mediumTarget &&
        pool.hard.length >= hardTarget;
      if (canBuildTargetSets && acceptedPool.length > TARGET_SET_COUNT * 14) {
        console.log("pool is large enough, stopping early");
        break;
      }
    } catch (e) {
      console.log(`round ${round}: failed -> ${errMsg(e)}`);
      flushPoolCheckpoint(acceptedPool);
    }
    // Brief pause between rounds to avoid proxy rate limiting
    await new Promise((r) => setTimeout(r, 3000));
  }

  let boostedPool = splitPoolByDifficulty(acceptedPool);
  if (
    (boostedPool.easy.length < easyTarget ||
      boostedPool.medium.length < mediumTarget ||
      boostedPool.hard.length < hardTarget) &&
    ADAPTIVE_BOOST_ROUNDS > 0
  ) {
    console.log(
      `pool insufficient (easy ${boostedPool.easy.length}/${easyTarget}, medium ${boostedPool.medium.length}/${mediumTarget}, hard ${boostedPool.hard.length}/${hardTarget}), starting adaptive boost rounds...`,
    );
    for (let i = 1; i <= ADAPTIVE_BOOST_ROUNDS; i += 1) {
      boostedPool = splitPoolByDifficulty(acceptedPool);
      const { type, difficulty } = typeFromDeficit(acceptedPool, scaledQuotas);
      const allFilled = Object.entries(scaledQuotas).every(([diff, typeMap]) =>
        Object.entries(typeMap).every(([t, quota]) => {
          const cnt = acceptedPool.filter((q) => {
            const at = (q._meta || {}).answerType || classifyAnswerType(q);
            const db = (estimateQuestionDifficulty(q) || {}).bucket || "medium";
            return at === t && db === diff;
          }).length;
          return cnt >= quota / BUFFER; // check against un-buffered quota
        })
      );
      if (allFilled) break;
      try {
        const res = await generateCandidateRound(3000 + i, type, difficulty, rollingRejectFeedback);
        acceptedPool.push(...res.questions);
        Object.entries(res.rejectReasons).forEach(([k, v]) => {
          rejectReasons[k] = (rejectReasons[k] || 0) + v;
        });
        rollingRejectFeedback = buildRejectFeedbackHints(rejectReasons);
        boostedPool = splitPoolByDifficulty(acceptedPool);
        console.log(
          `boost ${i} [${type}/${difficulty}]: accepted=${res.accepted} rejected=${res.rejected} | pool easy=${boostedPool.easy.length} medium=${boostedPool.medium.length} hard=${boostedPool.hard.length}`,
        );
        if (
          boostedPool.easy.length >= easyTarget &&
          boostedPool.medium.length >= mediumTarget &&
          boostedPool.hard.length >= hardTarget
        ) {
          break;
        }
      } catch (e) {
        console.log(`boost ${i} [${type}/${difficulty}]: failed -> ${errMsg(e)}`);
        flushPoolCheckpoint(acceptedPool);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  const dedupedPool = uniqBy(acceptedPool, stableAnswerKey);
  const poolByDiff = splitPoolByDifficulty(dedupedPool);
  console.log(`final pool: easy=${poolByDiff.easy.length} medium=${poolByDiff.medium.length} hard=${poolByDiff.hard.length}`);

  const finalSets = buildFinalSetsFromPool(poolByDiff, TARGET_SET_COUNT);
  if (finalSets.length === 0) {
    console.error("No sets assembled at all — aborting.");
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
}

main().catch((e) => {
  console.error(`Fatal: ${errMsg(e)}`);
  process.exit(1);
});


