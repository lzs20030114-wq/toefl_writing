#!/usr/bin/env node

/**
 * Analyze collected reading samples and generate a statistical profile.
 *
 * Usage: node scripts/analyze-reading-samples.mjs
 *
 * Reads:  data/reading/samples/{completeTheWords,readInDailyLife,academicPassage}/*.json
 * Writes: data/reading/profile/readingEtsProfile.json
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, "..", "data", "reading", "samples");
const PROFILE_DIR = join(__dirname, "..", "data", "reading", "profile");

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function loadItems(taskDir) {
  const dirPath = join(SAMPLES_DIR, taskDir);
  const items = [];
  try {
    for (const file of readdirSync(dirPath).filter((f) => f.endsWith(".json"))) {
      const data = JSON.parse(readFileSync(join(dirPath, file), "utf-8"));
      if (Array.isArray(data.items)) items.push(...data.items);
    }
  } catch { /* dir missing */ }
  return items;
}

function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sentences(text) {
  if (!text) return [];
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

function stats(arr) {
  if (arr.length === 0) return { min: 0, max: 0, mean: 0, median: 0, stdev: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const median = arr.length % 2 === 0
    ? (sorted[arr.length / 2 - 1] + sorted[arr.length / 2]) / 2
    : sorted[Math.floor(arr.length / 2)];
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: +mean.toFixed(1),
    median: +median.toFixed(1),
    stdev: +Math.sqrt(variance).toFixed(2),
  };
}

function distribution(arr) {
  const counts = {};
  for (const v of arr) {
    counts[v] = (counts[v] || 0) + 1;
  }
  const total = arr.length;
  const result = {};
  for (const [k, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    result[k] = { count: c, pct: +(c / total * 100).toFixed(1) };
  }
  return result;
}

/** Simple syllable count heuristic */
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 2) return 1;
  let count = w.match(/[aeiouy]+/g)?.length || 1;
  if (w.endsWith("e") && !w.endsWith("le")) count--;
  return Math.max(1, count);
}

/** Flesch-Kincaid Grade Level */
function fleschKincaid(text) {
  const sents = sentences(text);
  const ws = text.split(/\s+/).filter(Boolean);
  if (sents.length === 0 || ws.length === 0) return 0;
  const totalSyllables = ws.reduce((s, w) => s + syllables(w), 0);
  return +(0.39 * (ws.length / sents.length) + 11.8 * (totalSyllables / ws.length) - 15.59).toFixed(1);
}

/** Type-token ratio (vocabulary diversity) */
function ttr(text) {
  const ws = text.toLowerCase().replace(/[^a-z'\s]/g, "").split(/\s+/).filter(Boolean);
  if (ws.length === 0) return 0;
  return +(new Set(ws).size / ws.length).toFixed(3);
}

// ────────────────────────────────────────────────────────
// Analysis: Complete the Words
// ────────────────────────────────────────────────────────

function analyzeCTW(items) {
  if (items.length === 0) return { sample_count: 0 };

  const wordCounts = items.map((i) => countWords(i.passage));
  const sentCounts = items.map((i) => sentences(i.passage).length);
  const avgSentLens = items.map((i) => {
    const s = sentences(i.passage);
    return s.length > 0 ? countWords(i.passage) / s.length : 0;
  });
  const fkScores = items.map((i) => fleschKincaid(i.passage));
  const ttrScores = items.map((i) => ttr(i.passage));

  // Blank word analysis
  const allBlanks = items.flatMap((i) => i.blanks || []);
  const blankWordLengths = allBlanks.map((b) => b.original_word.length);
  const fragmentRatios = allBlanks.map((b) => b.displayed_fragment.length / b.original_word.length);

  // Simple POS heuristic based on suffixes
  const posGuess = (word) => {
    const w = word.toLowerCase();
    if (["the", "a", "an", "this", "that", "these", "those"].includes(w)) return "determiner";
    if (["is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did"].includes(w)) return "aux_verb";
    if (["in", "on", "at", "from", "to", "with", "by", "for", "of", "through", "across", "into"].includes(w)) return "preposition";
    if (["and", "but", "or", "however", "although", "because", "while", "yet", "so"].includes(w)) return "conjunction";
    if (["he", "she", "it", "they", "them", "his", "her", "its", "their", "we", "our", "my", "your"].includes(w)) return "pronoun";
    if (w.endsWith("ly")) return "adverb";
    if (w.endsWith("ing") || w.endsWith("ed") || w.endsWith("es") || w.endsWith("s")) return "verb_or_noun";
    if (w.endsWith("tion") || w.endsWith("ment") || w.endsWith("ness") || w.endsWith("ity")) return "noun";
    if (w.endsWith("ful") || w.endsWith("ous") || w.endsWith("ive") || w.endsWith("al")) return "adjective";
    return "other";
  };

  const posDist = distribution(allBlanks.map((b) => posGuess(b.original_word)));
  const topicDist = distribution(items.map((i) => i.topic || "other"));
  const diffDist = distribution(items.map((i) => i.difficulty || "medium"));

  return {
    sample_count: items.length,
    total_blanks: allBlanks.length,
    passage_word_count: stats(wordCounts),
    sentence_count: stats(sentCounts),
    avg_sentence_length: stats(avgSentLens),
    flesch_kincaid_grade: stats(fkScores),
    type_token_ratio: stats(ttrScores),
    blank_word_length: stats(blankWordLengths),
    fragment_ratio: stats(fragmentRatios),
    blank_pos_distribution: posDist,
    topic_distribution: topicDist,
    difficulty_distribution: diffDist,
  };
}

// ────────────────────────────────────────────────────────
// Analysis: Read in Daily Life
// ────────────────────────────────────────────────────────

function analyzeRDL(items) {
  if (items.length === 0) return { sample_count: 0 };

  const wordCounts = items.map((i) => countWords(i.text));
  const questionCounts = items.map((i) => (i.questions || []).length);
  const allQuestions = items.flatMap((i) => i.questions || []);

  const genreDist = distribution(items.map((i) => i.genre || "other"));
  const qTypeDist = distribution(allQuestions.map((q) => q.question_type || "other"));
  const diffDist = distribution(items.map((i) => i.difficulty || "medium"));

  // Short vs long text
  const shortTexts = items.filter((i) => countWords(i.text) <= 60);
  const longTexts = items.filter((i) => countWords(i.text) > 60);

  // Correct answer position distribution
  const answerPosDist = distribution(allQuestions.map((q) => q.correct_answer || "?"));

  // Average option length
  const optionLengths = allQuestions.flatMap((q) => {
    if (!q.options) return [];
    return Object.values(q.options).map((o) => countWords(o));
  });

  return {
    sample_count: items.length,
    total_questions: allQuestions.length,
    text_word_count: stats(wordCounts),
    questions_per_text: stats(questionCounts),
    short_texts: shortTexts.length,
    long_texts: longTexts.length,
    genre_distribution: genreDist,
    question_type_distribution: qTypeDist,
    difficulty_distribution: diffDist,
    correct_answer_position: answerPosDist,
    option_word_count: stats(optionLengths),
  };
}

// ────────────────────────────────────────────────────────
// Analysis: Academic Passage
// ────────────────────────────────────────────────────────

function analyzeAP(items) {
  if (items.length === 0) return { sample_count: 0 };

  const wordCounts = items.map((i) => countWords(i.passage));
  const paraCounts = items.map((i) => (i.paragraphs || []).length);
  const sentCounts = items.map((i) => sentences(i.passage).length);
  const fkScores = items.map((i) => fleschKincaid(i.passage));
  const ttrScores = items.map((i) => ttr(i.passage));

  const allQuestions = items.flatMap((i) => i.questions || []);
  const qTypeDist = distribution(allQuestions.map((q) => q.question_type || "other"));
  const topicDist = distribution(items.map((i) => i.topic || "other"));
  const diffDist = distribution(items.map((i) => i.difficulty || "medium"));

  // Distractor pattern analysis
  const allDistractors = allQuestions.flatMap((q) => {
    if (!q.distractor_analysis) return [];
    return Object.values(q.distractor_analysis);
  });
  const distractorDist = distribution(allDistractors);

  // Correct answer position
  const answerPosDist = distribution(allQuestions.map((q) => q.correct_answer || "?"));

  // Option length analysis
  const optionLengths = allQuestions.flatMap((q) => {
    if (!q.options) return [];
    return Object.values(q.options).map((o) => countWords(o));
  });

  // Correct vs distractor option lengths
  const correctLengths = allQuestions.map((q) => {
    if (!q.options || !q.correct_answer) return 0;
    return countWords(q.options[q.correct_answer] || "");
  });
  const distractorLengths = allQuestions.flatMap((q) => {
    if (!q.options || !q.correct_answer) return [];
    return Object.entries(q.options)
      .filter(([k]) => k !== q.correct_answer)
      .map(([, v]) => countWords(v));
  });

  return {
    sample_count: items.length,
    total_questions: allQuestions.length,
    passage_word_count: stats(wordCounts),
    paragraph_count: stats(paraCounts),
    sentence_count: stats(sentCounts),
    flesch_kincaid_grade: stats(fkScores),
    type_token_ratio: stats(ttrScores),
    question_type_distribution: qTypeDist,
    topic_distribution: topicDist,
    difficulty_distribution: diffDist,
    distractor_pattern_distribution: distractorDist,
    correct_answer_position: answerPosDist,
    option_word_count: stats(optionLengths),
    correct_option_word_count: stats(correctLengths),
    distractor_option_word_count: stats(distractorLengths),
  };
}

// ────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────

function main() {
  const ctwItems = loadItems("completeTheWords");
  const rdlItems = loadItems("readInDailyLife");
  const apItems = loadItems("academicPassage");

  const profile = {
    generated_at: new Date().toISOString(),
    completeTheWords: analyzeCTW(ctwItems),
    readInDailyLife: analyzeRDL(rdlItems),
    academicPassage: analyzeAP(apItems),
  };

  // Write profile
  mkdirSync(PROFILE_DIR, { recursive: true });
  const outPath = join(PROFILE_DIR, "readingEtsProfile.json");
  writeFileSync(outPath, JSON.stringify(profile, null, 2));

  // Print dashboard
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║        TOEFL 2026 Reading Sample Profile        ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  printSection("Complete the Words", profile.completeTheWords);
  printSection("Read in Daily Life", profile.readInDailyLife);
  printSection("Academic Passage", profile.academicPassage);

  console.log(`\nProfile written to: ${outPath}`);
}

function printSection(title, data) {
  console.log(`── ${title} ──`);
  console.log(`  Samples: ${data.sample_count}`);
  if (data.sample_count === 0) { console.log("  (no data)\n"); return; }

  if (data.total_blanks != null) console.log(`  Total blanks: ${data.total_blanks}`);
  if (data.total_questions != null) console.log(`  Total questions: ${data.total_questions}`);

  if (data.passage_word_count) printStats("  Passage words", data.passage_word_count);
  if (data.text_word_count) printStats("  Text words", data.text_word_count);
  if (data.sentence_count) printStats("  Sentences", data.sentence_count);
  if (data.paragraph_count) printStats("  Paragraphs", data.paragraph_count);
  if (data.avg_sentence_length) printStats("  Avg sent len", data.avg_sentence_length);
  if (data.flesch_kincaid_grade) printStats("  FK grade", data.flesch_kincaid_grade);
  if (data.type_token_ratio) printStats("  TTR", data.type_token_ratio);
  if (data.blank_word_length) printStats("  Blank word len", data.blank_word_length);
  if (data.fragment_ratio) printStats("  Fragment ratio", data.fragment_ratio);
  if (data.questions_per_text) printStats("  Qs per text", data.questions_per_text);
  if (data.option_word_count) printStats("  Option words", data.option_word_count);

  if (data.correct_option_word_count && data.distractor_option_word_count) {
    printStats("  Correct opt wc", data.correct_option_word_count);
    printStats("  Distract opt wc", data.distractor_option_word_count);
  }

  if (data.short_texts != null) console.log(`  Short/Long: ${data.short_texts}/${data.long_texts}`);

  if (data.topic_distribution) printDist("  Topics", data.topic_distribution);
  if (data.genre_distribution) printDist("  Genres", data.genre_distribution);
  if (data.question_type_distribution) printDist("  Q types", data.question_type_distribution);
  if (data.difficulty_distribution) printDist("  Difficulty", data.difficulty_distribution);
  if (data.blank_pos_distribution) printDist("  Blank POS", data.blank_pos_distribution);
  if (data.distractor_pattern_distribution) printDist("  Distractor patterns", data.distractor_pattern_distribution);
  if (data.correct_answer_position) printDist("  Answer position", data.correct_answer_position);

  console.log();
}

function printStats(label, s) {
  console.log(`  ${label.padEnd(20)} min=${s.min} max=${s.max} mean=${s.mean} median=${s.median} sd=${s.stdev}`);
}

function printDist(label, d) {
  const parts = Object.entries(d)
    .map(([k, v]) => `${k}:${v.count}(${v.pct}%)`)
    .join(", ");
  console.log(`  ${label}: ${parts}`);
}

main();
