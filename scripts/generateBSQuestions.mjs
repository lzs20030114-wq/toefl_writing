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

const { callDeepSeekViaCurl, resolveProxyUrl } = require("../lib/ai/deepseekHttp.js");
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
const TARGET_SET_COUNT = Number(process.env.BS_TARGET_SETS || 6);
const CANDIDATE_ROUNDS = Number(process.env.BS_CANDIDATE_ROUNDS || 40);
const EASY_BOOST_ROUNDS = Number(process.env.BS_EASY_BOOST_ROUNDS || 16);
const HARD_BOOST_ROUNDS = Number(process.env.BS_HARD_BOOST_ROUNDS || 16);
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
  let chunks = Array.isArray(q.chunks)
    ? q.chunks.map((c) => normalizeText(c).toLowerCase()).filter(Boolean)
    : [];
  const prefilled = Array.isArray(q.prefilled)
    ? q.prefilled.map((c) => normalizeText(c)).filter(Boolean)
    : [];
  const prefilled_positions = (q.prefilled_positions && typeof q.prefilled_positions === "object" && !Array.isArray(q.prefilled_positions))
    ? q.prefilled_positions
    : {};

  const distractor = normalizeText(q.distractor)?.toLowerCase() || null;

  // Auto-fix: split any chunk with >3 words
  chunks = chunks.flatMap((c) => autoSplitChunk(c, 3));

  // Auto-fix: ensure at least 4 effective chunks (TPO minimum)
  chunks = ensureMinChunkCount(chunks, distractor, 4);

  const answer = normalizeText(q.answer);
  return {
    id: normalizeText(q.id) || tempId,
    prompt: normalizeText(q.prompt),
    answer,
    chunks,
    prefilled,
    prefilled_positions,
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

function buildGeneratePrompt(round, mode = "balanced", rejectFeedback = "") {
  const difficultySection = mode === "easy"
    ? `
Difficulty target for this 10-question batch:
- all 10 should be EASY/MEDIUM (lower end)
- answer length 7-10 words
- effective chunks 5-6
- distractor: include in about 5 items (extra auxiliary did/do/does, always single word)
- straightforward indirect questions with simple clause structure
`
    : mode === "hard"
      ? `
Difficulty target for this 10-question batch:
- all 10 should be HARD
- answer length 11-15 words
- effective chunks 7-8
- include distractor in at least 8 items (always single word, mostly did/do/does)
- include embedded question in at least 7 items
- multi-layer nesting (3+ grammar layers: indirect question + passive progressive / perfect + negation / ability expression)
- complex but natural sentence structure
`
    : `
Difficulty distribution target (TPO standard):
- 0-1 easy
- 7-8 medium
- 2-3 hard
TPO is significantly harder than ETS examples. Almost no easy items.
Hard item profile (Layer 3, 3+ grammar layers):
- answer length 11-15 words
- effective chunks 7-8
- has distractor (extra auxiliary)
- multi-layer nesting examples:
  * indirect question + passive progressive: "He found out where the new road was being built."
  * indirect question + present perfect + negation: "She wanted to know if I had finished the proposal yet."
  * indirect question + ability expression: "He wanted to know how we were able to make improvements."
Easy item profile (max 1):
- answer length 7-9 words
- effective chunks 5-6
- simple negation or single-layer structure
Medium item profile (majority):
- answer length 9-13 words
- effective chunks 6-7
- has distractor (usually extra auxiliary did/do/does)
- indirect question with declarative word order
`;

  return `
You are a TOEFL iBT Writing Task 1 "Build a Sentence" item writer.
All rules below are based on statistical analysis of 6 TPO real exam sets (60 items).
TPO represents actual test difficulty and is much harder than ETS examples.
Return ONLY a JSON array with exactly 10 question objects.

Required schema for each item:
{
  "id": "tmp_r${round}_q1",
  "prompt": "conversational context sentence (5-15 words, ends with ? or .)",
  "answer": "the correct sentence to build (7-15 words, concentrated 9-13)",
  "chunks": ["lowercase chunk", "..."],
  "prefilled": ["word1"] or [],
  "prefilled_positions": {"word1": 0} or {},
  "distractor": null or "lowercase distractor word not in answer",
  "has_question_mark": true/false,
  "grammar_points": ["grammar point 1", "grammar point 2"]
}

## CRITICAL: 92% of answers are STATEMENTS (has_question_mark=false)
- Statements: 8-9 items (indirect questions in declarative form, e.g. "She wanted to know if...")
- Questions: 1-2 items ONLY (only for "Can/Could you tell me...?")

## Sentence type distribution (TPO core):
### Indirect/embedded questions (DECLARATIVE form): 6-8 items (CORE). Lead-in verb distribution (must diversify):
- wanted to know: 3-4 items (47% of embedded questions)
- asked (me): 1 item
- wants to know: 1 item
- was curious about / curious if: 1 item
- other (was wondering, found out, would love to know, needed to know): 1-2 items
Clause word distribution: if(32%), what(21%), where(18%), why(13%), when(8%), how(5%), who(5%)

### Negation structures: 2-3 items
At least 1 combined with indirect question (e.g. "I did not understand what he said")
Types: did not, do not, have not, was not, could not, no longer, have no

### Relative clause / contact clause: 1-2 items
TPO specialty: omitted relative pronoun (contact clause)
- The bookstore [that] I stopped by...
- The desk [that] you ordered...

### Other: 0-1 items (comparative, passive, find/make + object + complement)

## Prompt patterns (must follow this distribution):
- "What did [Name] ask you?": 3-4 items (37%), directly elicits indirect question answers
- "Did you enjoy/finish/attend...?": 2 items
- "Where/Why did you...?": 2 items
- Other narrative/comment: 2 items
Use diverse names: Matthew, Mariana, Julian, Alison, Emma, Professor Cho, etc.

## Distractor rules (MAJOR CHANGE): 88% have distractors.
CRITICAL: Distractor must ALWAYS be a SINGLE WORD (never a phrase).
### Distractor strategies (by priority):
1. EXTRA AUXILIARY (at least 5 items): did, do, does
   THE core TPO distractor! "did" alone appears in ~1/3 of ALL questions.
   Place extra did/do/does in indirect questions
   to tempt examinees into using inverted (direct question) word order.
   Example: answer "She wanted to know if I went anywhere interesting", distractor "did"
2. Tense/form variant (1-2 items): staying/stay, gone/going, choose/chose, taken/took
3. Similar function word (1 item): which/what, where/when, no/not/none
4. Extra structure word (0-1 items): that, because, was

## Prefilled rules:
About 60% of items (6) should have prefilled. TPO prefers mid/end positions:
- Opening subject + collocation: "He wanted to know", "Unfortunately, I"
- Sentence-end modifiers: "yet", "weekends", "quickly"
- Mid-sentence connectors: "when", "about"
- 0-4 prefilled per item
- prefilled_positions: 0-indexed word position in answer
- Prefilled words must NOT appear in chunks
- chunks (minus distractor) + prefilled = ALL answer words (excluding punctuation)

## Chunk rules (TPO style) IMPORTANT
- Effective chunk count (excluding distractor): 4-8, TARGET 5-7. This is the PRIMARY constraint.
- Each chunk max 3 words, all lowercase
- Use a MIX of single-word and multi-word chunks to hit the 5-7 target:
  * Each item should have 2-4 multi-word chunks (natural collocations like "to know", "wanted to", "no longer", "the bookstore", "last week", "had no idea")
  * Remaining chunks are single words
  * Do NOT make all chunks single-word; that exceeds the chunk count limit.
- chunks (minus distractor) + prefilled = all answer words (excluding punctuation)
- Distractor must be a SINGLE WORD??never a phrase

## Scene distribution:
- Relaying someone's question (What did XXX ask you?): 3-4 items
- Work/projects (interviews, project updates, meetings, reports): 2-3 items
- Daily life (shopping, restaurants, gym, transportation): 2 items
- Campus/study (assignments, workshops, seminars): 1 item
- Social (parties, concerts, travel): 1 item

## Grammar point labeling (difficulty estimator depends on these):
- Indirect/embedded questions: must include "embedded question" or "indirect question"
- Negation: must include "negation"
- Relative/contact clause: must include "relative clause" or "contact clause"
- Passive voice: must include "passive voice"
- You may append details: "embedded question (wanted to know + if)", "negation (did not)"

## Answer uniqueness:
- Each item must have exactly one grammatically correct arrangement
- Indirect question clauses MUST use declarative word order (no inversion)
- The distractor did/do/does cannot be inserted into the correct answer

${difficultySection}
${rejectFeedback}
Before returning JSON, self-check every item:
1. chunk count and chunk length constraints
2. chunks (minus distractor) + prefilled = answer words exactly
3. distractor not in answer
4. prefilled_positions match actual word positions in answer
5. prefilled words do NOT appear in chunks
6. only one valid arrangement exists

No markdown. No extra explanation. JSON array only.
`.trim();
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

async function generateCandidateRound(round, mode = "balanced", rejectFeedback = "") {
  const out = {
    generated: 0,
    accepted: 0,
    rejected: 0,
    rejectReasons: {},
    questions: [],
  };

  const generatedRaw = await callModel(buildGeneratePrompt(round, mode, rejectFeedback));
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

function splitPoolByDifficulty(questions) {
  const pool = { easy: [], medium: [], hard: [] };
  questions.forEach((q) => {
    const est = estimateQuestionDifficulty(q);
    pool[est.bucket].push(q);
  });
  pool.easy = shuffle(uniqBy(pool.easy, stableAnswerKey));
  pool.medium = shuffle(uniqBy(pool.medium, stableAnswerKey));
  pool.hard = shuffle(uniqBy(pool.hard, stableAnswerKey));
  return pool;
}

function cloneQuestion(q) {
  return JSON.parse(JSON.stringify(q));
}

function composeOneSet(pool, setId, maxRetries = 500) {
  function profileStyle(items) {
    const total = items.length || 1;
    const qmark = items.filter((q) => q.has_question_mark === true).length;
    const distractor = items.filter((q) => q.distractor != null).length;
    const embedded = items.filter((q) => isEmbeddedQuestion(q.grammar_points)).length;
    const avgWords = items.reduce((sum, q) => (
      sum + String(q?.answer || "").replace(/[.,!?;:]/g, " ").trim().split(/\s+/).filter(Boolean).length
    ), 0) / total;
    const avgChunks = items.reduce((sum, q) => (
      sum + (Array.isArray(q?.chunks) ? q.chunks.filter((c) => c !== q?.distractor).length : 0)
    ), 0) / total;
    return { total, qmark, distractor, embedded, avgWords, avgChunks };
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

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    if (
      pool.easy.length < ETS_2026_TARGET_COUNTS_10.easy ||
      pool.medium.length < ETS_2026_TARGET_COUNTS_10.medium ||
      pool.hard.length < ETS_2026_TARGET_COUNTS_10.hard
    ) {
      return null;
    }

    const easyPick = shuffle(pool.easy).slice(0, ETS_2026_TARGET_COUNTS_10.easy);
    const mediumPick = shuffle(pool.medium).slice(0, ETS_2026_TARGET_COUNTS_10.medium);
    const hardPick = shuffle(pool.hard).slice(0, ETS_2026_TARGET_COUNTS_10.hard);
    const merged = shuffle([...easyPick, ...mediumPick, ...hardPick]).map(cloneQuestion);

    // re-id for final bank
    merged.forEach((q, i) => {
      q.id = `ets_s${setId}_q${i + 1}`;
    });

    const set = { set_id: setId, questions: merged };
    const schemaOk = validateQuestionSet(set).ok;
    const diff = evaluateSetDifficultyAgainstTarget(merged);
    if (!schemaOk || !diff.ok || !diff.meetsTargetCount10) continue;
    const style = profileStyle(merged);
    const styleGate = attempt < Math.floor(maxRetries * 0.6) ? stylePassStrict : stylePassRelaxed;
    if (!styleGate(style)) continue;

    // runtime strict check
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

    // consume used questions from pool (by answer key)
    const usedKeys = new Set(merged.map(stableAnswerKey));
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

  const acceptedPool = [];
  const rejectReasons = {};
  let rollingRejectFeedback = "";

  for (let round = 1; round <= CANDIDATE_ROUNDS; round += 1) {
    try {
      const res = await generateCandidateRound(round, "balanced", rollingRejectFeedback);
      acceptedPool.push(...res.questions);
      Object.entries(res.rejectReasons).forEach(([k, v]) => {
        rejectReasons[k] = (rejectReasons[k] || 0) + v;
      });
      rollingRejectFeedback = buildRejectFeedbackHints(rejectReasons);
      const pool = splitPoolByDifficulty(acceptedPool);
      console.log(
        `round ${round}: generated=${res.generated} accepted=${res.accepted} rejected=${res.rejected} | pool easy=${pool.easy.length} medium=${pool.medium.length} hard=${pool.hard.length}`,
      );

      const canBuildTargetSets =
        pool.easy.length >= ETS_2026_TARGET_COUNTS_10.easy * TARGET_SET_COUNT &&
        pool.medium.length >= ETS_2026_TARGET_COUNTS_10.medium * TARGET_SET_COUNT &&
        pool.hard.length >= ETS_2026_TARGET_COUNTS_10.hard * TARGET_SET_COUNT;
      if (canBuildTargetSets && acceptedPool.length > TARGET_SET_COUNT * 14) {
        console.log("pool is large enough, stopping early");
        break;
      }
    } catch (e) {
      console.log(`round ${round}: failed -> ${e.message}`);
    }
  }

  let boostedPool = splitPoolByDifficulty(acceptedPool);
  const easyTarget = ETS_2026_TARGET_COUNTS_10.easy * TARGET_SET_COUNT;
  const hardTarget = ETS_2026_TARGET_COUNTS_10.hard * TARGET_SET_COUNT;
  if (boostedPool.easy.length < easyTarget && EASY_BOOST_ROUNDS > 0) {
    console.log(`easy pool insufficient (${boostedPool.easy.length}/${easyTarget}), starting easy boost rounds...`);
    for (let i = 1; i <= EASY_BOOST_ROUNDS; i += 1) {
      try {
        const res = await generateCandidateRound(1000 + i, "easy", rollingRejectFeedback);
        acceptedPool.push(...res.questions);
        Object.entries(res.rejectReasons).forEach(([k, v]) => {
          rejectReasons[k] = (rejectReasons[k] || 0) + v;
        });
        rollingRejectFeedback = buildRejectFeedbackHints(rejectReasons);
        boostedPool = splitPoolByDifficulty(acceptedPool);
        console.log(
          `easy-boost ${i}: accepted=${res.accepted} rejected=${res.rejected} | pool easy=${boostedPool.easy.length} medium=${boostedPool.medium.length} hard=${boostedPool.hard.length}`,
        );
        if (boostedPool.easy.length >= easyTarget) break;
      } catch (e) {
        console.log(`easy-boost ${i}: failed -> ${e.message}`);
      }
    }
  }

  boostedPool = splitPoolByDifficulty(acceptedPool);
  if (boostedPool.hard.length < hardTarget && HARD_BOOST_ROUNDS > 0) {
    console.log(`hard pool insufficient (${boostedPool.hard.length}/${hardTarget}), starting hard boost rounds...`);
    for (let i = 1; i <= HARD_BOOST_ROUNDS; i += 1) {
      try {
        const res = await generateCandidateRound(2000 + i, "hard", rollingRejectFeedback);
        acceptedPool.push(...res.questions);
        Object.entries(res.rejectReasons).forEach(([k, v]) => {
          rejectReasons[k] = (rejectReasons[k] || 0) + v;
        });
        rollingRejectFeedback = buildRejectFeedbackHints(rejectReasons);
        boostedPool = splitPoolByDifficulty(acceptedPool);
        console.log(
          `hard-boost ${i}: accepted=${res.accepted} rejected=${res.rejected} | pool easy=${boostedPool.easy.length} medium=${boostedPool.medium.length} hard=${boostedPool.hard.length}`,
        );
        if (boostedPool.hard.length >= hardTarget) break;
      } catch (e) {
        console.log(`hard-boost ${i}: failed -> ${e.message}`);
      }
    }
  }

  const dedupedPool = uniqBy(acceptedPool, stableAnswerKey);
  const poolByDiff = splitPoolByDifficulty(dedupedPool);
  console.log(`final pool: easy=${poolByDiff.easy.length} medium=${poolByDiff.medium.length} hard=${poolByDiff.hard.length}`);

  const finalSets = buildFinalSetsFromPool(poolByDiff, TARGET_SET_COUNT);
  if (finalSets.length === 0) {
    console.error("No valid set could be assembled from candidate pool.");
    console.error("Top reject reasons:");
    summarizeRejectReasons(rejectReasons).forEach(([k, v]) => console.error(`- ${k}: ${v}`));
    process.exit(1);
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

  console.log("Top reject reasons:");
  summarizeRejectReasons(rejectReasons).forEach(([k, v]) => console.log(`- ${k}: ${v}`));
}

main().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});


