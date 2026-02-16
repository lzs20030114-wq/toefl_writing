/**
 * Robust Build a Sentence generator pipeline:
 * 1) online candidate generation
 * 2) hard validation (schema/runtime)
 * 3) AI quality scoring filter
 * 4) pool-based set assembly with exact difficulty mix (2/5/3)
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
const { validateAllSets } = require("./validate-bank.js");

const OUTPUT_PATH = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const TARGET_SET_COUNT = Number(process.env.BS_TARGET_SETS || 6);
const CANDIDATE_ROUNDS = Number(process.env.BS_CANDIDATE_ROUNDS || 40);
const EASY_BOOST_ROUNDS = Number(process.env.BS_EASY_BOOST_ROUNDS || 16);
const MIN_REVIEW_SCORE = Number(process.env.BS_MIN_REVIEW_SCORE || 78);
const MIN_REVIEW_OVERALL = Number(process.env.BS_MIN_REVIEW_OVERALL || 84);

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

function normalizeQuestion(raw, tempId) {
  const q = raw && typeof raw === "object" ? raw : {};
  const chunks = Array.isArray(q.chunks)
    ? q.chunks.map((c) => normalizeText(c).toLowerCase()).filter(Boolean)
    : [];
  const prefilled = Array.isArray(q.prefilled)
    ? q.prefilled.map((c) => normalizeText(c).toLowerCase()).filter(Boolean)
    : [];
  const prefilled_positions = (q.prefilled_positions && typeof q.prefilled_positions === "object")
    ? q.prefilled_positions
    : {};

  const answer = normalizeText(q.answer);
  return {
    id: normalizeText(q.id) || tempId,
    prompt: normalizeText(q.prompt),
    answer,
    chunks,
    prefilled,
    prefilled_positions,
    distractor: normalizeText(q.distractor) || null,
    has_question_mark: typeof q.has_question_mark === "boolean" ? q.has_question_mark : endsWithQuestionMark(answer),
    grammar_points: Array.isArray(q.grammar_points)
      ? q.grammar_points.map((g) => normalizeText(g)).filter(Boolean)
      : [],
  };
}

function stableAnswerKey(q) {
  return normalizeText(q.answer).toLowerCase();
}

function buildGeneratePrompt(round, mode = "balanced") {
  const difficultySection = mode === "easy"
    ? `
Difficulty target for this 10-question batch:
- all 10 should be EASY
- answer length 7-9 words
- effective chunks exactly 5
- distractor must be null
- simple syntax and high-frequency campus vocabulary
`
    : `
Difficulty distribution target for this 10-question batch:
- 2 easy
- 5 medium
- 3 hard
Reflect difficulty in sentence length, chunk complexity, and distractor usage.
Hard item profile (important):
- answer length 11-13 words
- effective chunks 7
- at least one 3-word chunk
- include distractor in about half of hard items
- include embedded-question structure and less frequent collocations
Easy item profile:
- answer length 7-9 words
- effective chunks 5
- no distractor
- straightforward syntax and high-frequency vocabulary
`;

  return `
You are generating TOEFL iBT Writing Task 1 "Build a Sentence" items.
Return ONLY a JSON array with exactly 10 question objects.

Required schema for each item:
{
  "id": "tmp_r${round}_q1",
  "prompt": "short campus context sentence",
  "answer": "final natural sentence, 7-13 words, ends with ? or .",
  "chunks": ["lowercase chunk", "..."],
  "prefilled": [],
  "prefilled_positions": {},
  "distractor": null or "lowercase chunk not in answer",
  "has_question_mark": true/false,
  "grammar_points": ["...","..."]
}

Hard constraints:
- chunk count excluding distractor: 5-7
- each chunk max 3 words
- chunks lowercase
- chunks (+prefilled) must reconstruct answer words exactly
- distractor must not appear in answer
- at least 6 questions with has_question_mark=true
- exactly 2 or 3 questions with non-null distractor
- at least 5 questions include "embedded question" in grammar_points
- at least 1 question include "passive voice" in grammar_points
- avoid ambiguous order; each item should have one clear best order

${difficultySection}
Before returning JSON, self-check every item against chunk-count and chunk-length constraints.

No markdown. No extra explanation. JSON array only.
`.trim();
}

function buildReviewPrompt(questions) {
  return `
You are a strict TOEFL item quality reviewer.
Review the 10 Build a Sentence items and return ONLY JSON:
{
  "overall_score": 0-100,
  "blockers": ["critical issue..."],
  "question_scores": [
    {"id":"...", "score":0-100, "issues":["..."]}
  ]
}

Blocker examples:
- multiple valid chunk orders
- grammar incorrect
- distractor could be a valid answer chunk
- prompt/answer mismatch

Scoring:
- >=85 means production ready
- <78 means reject that question

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

function hardValidateQuestion(q) {
  const v = validateQuestion(q);
  if (v.fatal.length > 0) return { ok: false, reason: `fatal: ${v.fatal.join("; ")}` };
  if (v.format.length > 0) return { ok: false, reason: `format: ${v.format.join("; ")}` };
  if (v.content.length > 0) return { ok: false, reason: `content: ${v.content.join("; ")}` };

  const hard = hardFailReasons(q);
  if (hard.length > 0) return { ok: false, reason: `hard-fail: ${hard.join("; ")}` };
  const warn = qualityWarnings(q);
  if (warn.length > 0) return { ok: false, reason: `warning: ${warn.join("; ")}` };

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

async function generateCandidateRound(round, mode = "balanced") {
  const out = {
    generated: 0,
    accepted: 0,
    rejected: 0,
    rejectReasons: {},
    questions: [],
  };

  const generatedRaw = await callModel(buildGeneratePrompt(round, mode));
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

  for (const q of hardPassed) {
    const score = scoreMap.has(q.id) ? scoreMap.get(q.id) : 0;
    const blocked = review.blockers.length > 0 && review.overall_score < MIN_REVIEW_OVERALL;
    if (blocked || score < MIN_REVIEW_SCORE) {
      out.rejected += 1;
      const r = blocked
        ? `review:blocker:${review.blockers.join("|")}`
        : `review:score<${MIN_REVIEW_SCORE}`;
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

  for (let round = 1; round <= CANDIDATE_ROUNDS; round += 1) {
    try {
      const res = await generateCandidateRound(round, "balanced");
      acceptedPool.push(...res.questions);
      Object.entries(res.rejectReasons).forEach(([k, v]) => {
        rejectReasons[k] = (rejectReasons[k] || 0) + v;
      });
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
  if (boostedPool.easy.length < easyTarget && EASY_BOOST_ROUNDS > 0) {
    console.log(`easy pool insufficient (${boostedPool.easy.length}/${easyTarget}), starting easy boost rounds...`);
    for (let i = 1; i <= EASY_BOOST_ROUNDS; i += 1) {
      try {
        const res = await generateCandidateRound(1000 + i, "easy");
        acceptedPool.push(...res.questions);
        Object.entries(res.rejectReasons).forEach(([k, v]) => {
          rejectReasons[k] = (rejectReasons[k] || 0) + v;
        });
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
