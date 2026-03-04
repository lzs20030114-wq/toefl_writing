/**
 * Deduplicates questions.json and reserve_pool.json.
 *
 * Duplicate detection keys (all must match to be considered duplicate):
 *   1. Normalized answer (lowercase, collapsed whitespace)
 *   2. Sorted chunk set (order-independent)
 *
 * Usage:
 *   node scripts/dedup-questions.js
 */

const fs = require("fs");
const path = require("path");

const QUESTIONS_PATH = path.resolve(__dirname, "../data/buildSentence/questions.json");
const RESERVE_PATH = path.resolve(__dirname, "../data/buildSentence/reserve_pool.json");

function normalizeAnswer(a) {
  return String(a || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function chunkSetKey(chunks) {
  return [...(chunks || [])].map((c) => String(c).toLowerCase().trim()).sort().join("|");
}

function dedupKey(q) {
  return `${normalizeAnswer(q.answer)}__${chunkSetKey(q.chunks)}`;
}

function dedupArray(questions) {
  const seen = new Map(); // key -> first question seen
  const dupes = [];
  for (const q of questions) {
    const k = dedupKey(q);
    if (seen.has(k)) {
      dupes.push({ kept: seen.get(k).id, removed: q.id, answer: q.answer });
    } else {
      seen.set(k, q);
    }
  }
  return { unique: [...seen.values()], dupes };
}

function processQuestionsJson(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  let totalBefore = 0;
  let totalAfter = 0;
  let totalDupes = 0;

  for (const set of raw.question_sets || []) {
    const before = (set.questions || []).length;
    const { unique, dupes } = dedupArray(set.questions || []);
    set.questions = unique;
    totalBefore += before;
    totalAfter += unique.length;
    totalDupes += dupes.length;
    if (dupes.length > 0) {
      console.log(`  Set ${set.set_id}: removed ${dupes.length} duplicate(s)`);
      dupes.forEach((d) => console.log(`    - removed ${d.removed || "(no id)"}: "${d.answer}"`));
    }
  }

  // Also dedup across sets (same answer in multiple sets)
  const allAnswers = new Map();
  let crossSetDupes = 0;
  for (const set of raw.question_sets || []) {
    const kept = [];
    for (const q of set.questions || []) {
      const k = dedupKey(q);
      if (allAnswers.has(k)) {
        console.log(`  Cross-set dupe in ${set.set_id}: "${q.answer}" (already in ${allAnswers.get(k)})`);
        crossSetDupes++;
      } else {
        allAnswers.set(k, set.set_id);
        kept.push(q);
      }
    }
    set.questions = kept;
  }

  console.log(`questions.json: ${totalBefore} → ${totalAfter - crossSetDupes} questions (removed ${totalDupes + crossSetDupes} dupes)`);
  fs.writeFileSync(filePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}

function processReservePool(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log("reserve_pool.json: not found, skipping");
    return;
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const questions = Array.isArray(raw) ? raw : [];
  const before = questions.length;
  const { unique, dupes } = dedupArray(questions);
  if (dupes.length > 0) {
    console.log(`reserve_pool.json: removed ${dupes.length} duplicate(s)`);
    dupes.forEach((d) => console.log(`  - removed: "${d.answer}"`));
  }
  console.log(`reserve_pool.json: ${before} → ${unique.length} questions`);
  fs.writeFileSync(filePath, `${JSON.stringify(unique, null, 2)}\n`, "utf8");
}

console.log("Deduplicating question bank...");
processQuestionsJson(QUESTIONS_PATH);
processReservePool(RESERVE_PATH);
console.log("Done.");
