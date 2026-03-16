#!/usr/bin/env node
/**
 * Build a Sentence question bank quality review tool.
 *
 * Usage:
 *   node scripts/review-bank.mjs                  # full bank review (JSON output)
 *   node scripts/review-bank.mjs --set 3          # review set 3 only
 *   node scripts/review-bank.mjs --id ets_s3_q5   # review single question
 *   node scripts/review-bank.mjs --summary        # bank summary only (no per-question)
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { validateQuestion } = require("../lib/questionBank/buildSentenceSchema.js");
const { isEmbeddedQuestion, isNegation, TPO_REFERENCE_PROFILE } = require("../lib/questionBank/etsProfile.js");
const { estimateQuestionDifficulty } = require("../lib/questionBank/difficultyControl.js");
const { normalizeRuntimeQuestion, validateRuntimeQuestion } = require("../lib/questionBank/runtimeModel.js");
const { validateStructuredPromptParts } = require("../lib/questionBank/buildSentencePromptContract.js");

const QUESTIONS_PATH = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const T = TPO_REFERENCE_PROFILE;

function parseArgs(argv) {
  const args = { set: null, id: null, summary: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--set" && argv[i + 1]) { args.set = parseInt(argv[i + 1], 10); i++; }
    if (argv[i] === "--id" && argv[i + 1]) { args.id = argv[i + 1]; i++; }
    if (argv[i] === "--summary") args.summary = true;
    if (argv[i] === "--json") args.json = true;
  }
  return args;
}

function reviewQuestion(q) {
  const v = validateQuestion(q);
  let runtimeCheck = "ok";
  try { const rq = normalizeRuntimeQuestion(q); validateRuntimeQuestion(rq); }
  catch (e) { runtimeCheck = e.message; }

  let promptCheck = { fatal: [], format: [] };
  try { promptCheck = validateStructuredPromptParts(q); } catch (_) {}

  const diff = estimateQuestionDifficulty(q);
  const chunks = q.chunks || [];
  const answerWords = (q.answer || "").split(/\s+/).filter(Boolean);
  const multiWordChunks = chunks.filter(c => c.split(/\s+/).length >= 2);

  // Scoring (0-10)
  let score = 10;
  if (v.fatal.length > 0) score -= 5;
  if (runtimeCheck !== "ok") score -= 3;
  if (promptCheck.fatal.length > 0) score -= 2;
  score -= v.format.length * 1;
  score -= v.content.length * 0.5;
  if (multiWordChunks.length > 0) score += 1;
  if (q.distractor && (q.prefilled || []).length > 0) score += 1;
  score = Math.max(0, Math.min(10, score));

  // Duplicate answer check (caller handles cross-set)
  return {
    id: q.id,
    answer: q.answer,
    prompt_kind: q.prompt_task_kind || "",
    prompt_text: (q.prompt_task_text || q.prompt || "").slice(0, 100),
    difficulty: diff.bucket,
    difficulty_score: diff.score,
    has_qmark: !!q.has_question_mark,
    has_distractor: !!q.distractor,
    distractor: q.distractor || null,
    is_embedded: isEmbeddedQuestion(q.grammar_points),
    is_negation: isNegation(q.grammar_points),
    prefilled: q.prefilled || [],
    chunks_count: chunks.length,
    answer_word_count: answerWords.length,
    multi_word_chunks: multiWordChunks.length,
    grammar_points: q.grammar_points || [],
    fatal: v.fatal,
    format_warnings: v.format,
    content_warnings: v.content,
    prompt_fatal: promptCheck.fatal,
    prompt_format: promptCheck.format,
    runtime_check: runtimeCheck,
    score,
  };
}

function reviewSet(set, setIndex) {
  const questions = set.questions || [];
  const reviews = questions.map(q => reviewQuestion(q));
  const avgScore = reviews.length > 0 ? reviews.reduce((s, r) => s + r.score, 0) / reviews.length : 0;

  const stats = {
    set_id: set.set_id,
    question_count: reviews.length,
    difficulty: { easy: 0, medium: 0, hard: 0 },
    qmark: 0, embedded: 0, distractor: 0, negation: 0, prefilled: 0,
    prompt_kinds: {},
    avg_answer_words: 0,
    avg_chunks: 0,
    multi_word_total: 0,
    total_fatal: 0, total_format: 0, total_content: 0,
    score: Math.round(avgScore * 10),
  };

  reviews.forEach(r => {
    stats.difficulty[r.difficulty] = (stats.difficulty[r.difficulty] || 0) + 1;
    if (r.has_qmark) stats.qmark++;
    if (r.is_embedded) stats.embedded++;
    if (r.has_distractor) stats.distractor++;
    if (r.is_negation) stats.negation++;
    if (r.prefilled.length > 0) stats.prefilled++;
    stats.prompt_kinds[r.prompt_kind] = (stats.prompt_kinds[r.prompt_kind] || 0) + 1;
    stats.avg_answer_words += r.answer_word_count;
    stats.avg_chunks += r.chunks_count;
    stats.multi_word_total += r.multi_word_chunks;
    stats.total_fatal += r.fatal.length + r.prompt_fatal.length + (r.runtime_check !== "ok" ? 1 : 0);
    stats.total_format += r.format_warnings.length;
    stats.total_content += r.content_warnings.length;
  });

  const n = reviews.length || 1;
  stats.avg_answer_words = Number((stats.avg_answer_words / n).toFixed(1));
  stats.avg_chunks = Number((stats.avg_chunks / n).toFixed(1));

  return { stats, reviews };
}

function bankSummary(setResults) {
  const allReviews = setResults.flatMap(s => s.reviews);
  const n = allReviews.length || 1;

  const totals = {
    sets: setResults.length,
    questions: allReviews.length,
    qmark: allReviews.filter(r => r.has_qmark).length,
    embedded: allReviews.filter(r => r.is_embedded).length,
    distractor: allReviews.filter(r => r.has_distractor).length,
    negation: allReviews.filter(r => r.is_negation).length,
    prefilled: allReviews.filter(r => r.prefilled.length > 0).length,
    difficulty: { easy: 0, medium: 0, hard: 0 },
    prompt_kinds: {},
    total_fatal: 0,
    total_warnings: 0,
  };

  allReviews.forEach(r => {
    totals.difficulty[r.difficulty] = (totals.difficulty[r.difficulty] || 0) + 1;
    totals.prompt_kinds[r.prompt_kind] = (totals.prompt_kinds[r.prompt_kind] || 0) + 1;
    totals.total_fatal += r.fatal.length + r.prompt_fatal.length + (r.runtime_check !== "ok" ? 1 : 0);
    totals.total_warnings += r.format_warnings.length + r.content_warnings.length;
  });

  const pct = (v) => ((v / n) * 100).toFixed(1);
  const drift = (actual, target) => Math.abs(actual / n - target) > 0.15 ? "DRIFT" : "OK";

  // Cross-set duplicate answers
  const answerMap = {};
  allReviews.forEach(r => {
    const key = r.answer.toLowerCase().trim();
    if (!answerMap[key]) answerMap[key] = [];
    answerMap[key].push(r.id);
  });
  const duplicates = Object.entries(answerMap).filter(([, ids]) => ids.length > 1);

  // Topic grouping (simple: first 3 significant words of answer)
  const topicMap = {};
  allReviews.forEach(r => {
    const words = r.answer.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(w => w.length > 3).slice(0, 3).join(" ");
    if (!topicMap[words]) topicMap[words] = [];
    topicMap[words].push(r.id);
  });
  const topicClusters = Object.entries(topicMap).filter(([, ids]) => ids.length >= 3).sort((a, b) => b[1].length - a[1].length);

  // Weakest and strongest
  const sorted = [...allReviews].sort((a, b) => a.score - b.score);
  const weakest = sorted.slice(0, 5);
  const strongest = sorted.slice(-3).reverse();

  const avgScore = allReviews.reduce((s, r) => s + r.score, 0) / n;

  return {
    totals,
    ratios: {
      qmark: { value: pct(totals.qmark), target: (T.qmarkRatio * 100).toFixed(0), status: drift(totals.qmark, T.qmarkRatio) },
      embedded: { value: pct(totals.embedded), target: (T.embeddedRatio * 100).toFixed(0), status: drift(totals.embedded, T.embeddedRatio) },
      distractor: { value: pct(totals.distractor), target: (T.distractorRatio * 100).toFixed(0), status: drift(totals.distractor, T.distractorRatio) },
      negation: { value: pct(totals.negation), target: (T.negationRatio * 100).toFixed(0), status: drift(totals.negation, T.negationRatio) },
      prefilled: { value: pct(totals.prefilled), target: (T.givenWordRatio * 100).toFixed(0), status: drift(totals.prefilled, T.givenWordRatio) },
    },
    difficulty_pct: {
      easy: pct(totals.difficulty.easy),
      medium: pct(totals.difficulty.medium),
      hard: pct(totals.difficulty.hard),
    },
    duplicates,
    topic_clusters: topicClusters.slice(0, 5),
    weakest: weakest.map(r => ({ id: r.id, score: r.score, issues: [...r.fatal, ...r.prompt_fatal, ...(r.runtime_check !== "ok" ? [r.runtime_check] : []), ...r.format_warnings].slice(0, 3) })),
    strongest: strongest.map(r => ({ id: r.id, score: r.score })),
    bank_score: Math.round(avgScore * 10),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let data;
  try {
    data = JSON.parse(readFileSync(QUESTIONS_PATH, "utf8"));
  } catch (e) {
    console.error(`Cannot read ${QUESTIONS_PATH}: ${e.message}`);
    process.exit(1);
  }

  const sets = data.question_sets || [];

  // Single question review
  if (args.id) {
    for (const set of sets) {
      const q = (set.questions || []).find(q => q.id === args.id);
      if (q) {
        const result = reviewQuestion(q);
        console.log(JSON.stringify({ mode: "question", set_id: set.set_id, ...result }, null, 2));
        return;
      }
    }
    console.error(`Question ${args.id} not found.`);
    process.exit(1);
  }

  // Single set review
  if (args.set != null) {
    const set = sets.find(s => s.set_id === args.set) || sets[args.set - 1];
    if (!set) {
      console.error(`Set ${args.set} not found.`);
      process.exit(1);
    }
    const result = reviewSet(set);
    console.log(JSON.stringify({ mode: "set", ...result }, null, 2));
    return;
  }

  // Full bank review
  const setResults = sets.map((set, i) => reviewSet(set, i));
  const summary = bankSummary(setResults);

  if (args.summary) {
    console.log(JSON.stringify({ mode: "summary", summary }, null, 2));
    return;
  }

  // Full output
  const output = {
    mode: "full",
    generated_at: data.generated_at,
    set_stats: setResults.map(s => s.stats),
    summary,
  };

  // Only include per-question details if not too large
  if (sets.length <= 10) {
    output.questions = setResults.flatMap(s => s.reviews);
  }

  console.log(JSON.stringify(output, null, 2));
}

main();
