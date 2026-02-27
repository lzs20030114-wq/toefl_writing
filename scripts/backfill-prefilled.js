/**
 * backfill-prefilled.js
 *
 * Adds prefilled (given word) hints to questions in questions.json that currently have none.
 * Length weights are derived from 32 TPO reference questions:
 *   1-word ~10%, 2-word ~56%, 3-word ~34%
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { validateQuestion } = require("../lib/questionBank/buildSentenceSchema");

const DATA_PATH = path.resolve(__dirname, "../data/buildSentence/questions.json");

// ── word utils ────────────────────────────────────────────────────────────────

function words(s) {
  return String(s || "")
    .replace(/[.,!?;:]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// ── validity rules (mirrored from save-build-sentence-bank.js) ───────────────

const FUNCTION_WORDS = new Set([
  "the", "a", "an", "to", "of", "and", "or", "but", "from", "that", "this", "it",
  "in", "on", "at", "for", "with", "by", "as", "if", "then", "than", "so", "be",
  "is", "are", "was", "were", "am", "do", "does", "did", "have", "has", "had",
  "before", "after", "about", "into", "over", "under", "already", "please",
]);

const PREP_START_WORDS = new Set([
  "to", "in", "on", "at", "for", "with", "from", "about", "into", "over", "under", "before", "after", "by",
]);

function isValidSpan(spanWords) {
  if (spanWords.length < 1 || spanWords.length > 3) return false;
  if (spanWords.some((w) => /[.,!?;:]/.test(w))) return false;
  if (spanWords.length === 1 && FUNCTION_WORDS.has(spanWords[0].toLowerCase())) return false;
  const first = spanWords[0].toLowerCase();
  if (PREP_START_WORDS.has(first)) return false;
  const joined = spanWords.join(" ").toLowerCase();
  if (/^(to|in|on|at|for|with|from|about|into|over|under|before|after|by)\s+(a|an|the)$/.test(joined)) return false;
  return true;
}

// ── weighted length selection (TPO-calibrated) ────────────────────────────────

const LEN_WEIGHTS = { 1: 0.10, 2: 0.56, 3: 0.34 };

function chooseWeightedLength(possibleLens) {
  const total = possibleLens.reduce((s, l) => s + (LEN_WEIGHTS[l] || 0), 0);
  if (total === 0) return possibleLens[Math.floor(Math.random() * possibleLens.length)];
  let r = Math.random() * total;
  for (const l of possibleLens) {
    r -= LEN_WEIGHTS[l] || 0;
    if (r <= 0) return l;
  }
  return possibleLens[possibleLens.length - 1];
}

// ── start position: 20% front / 60% mid / 20% back ───────────────────────────

function pickStart(n) {
  const maxStart = Math.max(0, n - 2);
  if (maxStart === 0) return 0;
  const frontEnd = Math.max(0, Math.floor(maxStart * 0.2));
  const backStart = Math.max(0, Math.floor(maxStart * 0.8));
  const front = [], mid = [], back = [];
  for (let i = 0; i <= maxStart; i++) {
    if (i <= frontEnd) front.push(i);
    else if (i >= backStart) back.push(i);
    else mid.push(i);
  }
  const roll = Math.random();
  const bucket = roll < 0.2 ? front : roll < 0.8 ? mid : back;
  const pool = bucket.length > 0 ? bucket : Array.from({ length: maxStart + 1 }, (_, i) => i);
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── chunk restructuring ───────────────────────────────────────────────────────

/**
 * Remove the prefilled word span from the existing chunks by splitting any
 * chunk that overlaps with [spanStart, spanStart+spanLen).
 * The distractor chunk is passed through unchanged.
 */
function splitChunks(chunks, distractor, spanStart, spanLen) {
  const distractorNorm = String(distractor || "").trim().toLowerCase();
  let wordPos = 0;
  const result = [];

  for (const chunk of chunks) {
    const chunkLower = String(chunk || "").trim().toLowerCase();

    if (chunkLower === distractorNorm) {
      result.push(chunk);
      continue;
    }

    const chunkWords = words(chunk);
    const chunkStart = wordPos;
    const chunkEnd = wordPos + chunkWords.length;
    wordPos = chunkEnd;

    const spanEnd = spanStart + spanLen;

    if (chunkEnd <= spanStart || chunkStart >= spanEnd) {
      // No overlap — keep as-is
      result.push(chunk);
    } else {
      // Split around the prefilled span
      const before = chunkWords.slice(0, Math.max(0, spanStart - chunkStart));
      const after = chunkWords.slice(Math.min(chunkWords.length, spanEnd - chunkStart));
      if (before.length > 0) result.push(before.join(" "));
      if (after.length > 0) result.push(after.join(" "));
    }
  }

  return result;
}

// ── main per-question logic ───────────────────────────────────────────────────

function addPrefilled(question) {
  const q = question;

  // Already has prefilled — skip
  if (Array.isArray(q.prefilled) && q.prefilled.length > 0) return q;

  const ansWords = words(q.answer);
  const n = ansWords.length;
  if (n < 5) return q; // too short to give a hint

  const distractorNorm = String(q.distractor || "").trim().toLowerCase();

  for (let attempt = 0; attempt < 100; attempt++) {
    const start = pickStart(n);
    const maxLen = Math.min(3, n - start - 1); // leave at least 1 word after
    if (maxLen < 1) continue;

    const possibleLens = [];
    for (let len = 1; len <= maxLen; len++) {
      const remaining = n - len;
      if (remaining >= 4) possibleLens.push(len);
    }
    if (possibleLens.length === 0) continue;

    const len = chooseWeightedLength(possibleLens);
    const span = ansWords.slice(start, start + len);
    const spanText = span.join(" ").toLowerCase();

    // Must not be the distractor
    if (spanText === distractorNorm) continue;

    // Span validity (no function-only single word, no prep-start, etc.)
    if (!isValidSpan(span)) continue;

    // Build updated chunks
    const newChunks = splitChunks(q.chunks, q.distractor, start, len);

    return {
      ...q,
      prefilled: [spanText],
      prefilled_positions: { [spanText]: start },
      chunks: newChunks,
    };
  }

  return q; // couldn't find valid span — leave unchanged
}

// ── run ───────────────────────────────────────────────────────────────────────

const raw = fs.readFileSync(DATA_PATH, "utf8");
const data = JSON.parse(raw);

let modified = 0;
let skipped = 0;
let alreadyHad = 0;
const failedIds = [];

data.question_sets = data.question_sets.map((set) => ({
  ...set,
  questions: set.questions.map((q) => {
    if (Array.isArray(q.prefilled) && q.prefilled.length > 0) {
      alreadyHad++;
      return q;
    }

    const updated = addPrefilled(q);

    if (Array.isArray(updated.prefilled) && updated.prefilled.length > 0) {
      // Quick schema sanity check (per-question fatal errors only)
      const { fatal } = validateQuestion(updated);
      if (fatal.length > 0) {
        console.warn(`[SCHEMA FAIL] ${q.id}: ${fatal.join("; ")}`);
        failedIds.push(q.id);
        skipped++;
        return q; // revert to original
      }
      modified++;
      console.log(`  ✓ ${q.id}: prefilled="${updated.prefilled[0]}" pos=${updated.prefilled_positions[updated.prefilled[0]]}`);
      return updated;
    } else {
      console.warn(`  ✗ ${q.id}: no valid span found`);
      failedIds.push(q.id);
      skipped++;
      return q;
    }
  }),
}));

data.generated_at = new Date().toISOString();

fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");

console.log("\n────────────────────────────────");
console.log(`Already had prefilled : ${alreadyHad}`);
console.log(`Newly added           : ${modified}`);
console.log(`Skipped (no span/fail): ${skipped}`);
if (failedIds.length > 0) console.log(`Failed IDs: ${failedIds.join(", ")}`);
console.log("questions.json updated.");
