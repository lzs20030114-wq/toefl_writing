#!/usr/bin/env node
/**
 * Deduplicate Build Sentence question bank.
 *
 * 1. Finds all question pairs with answer similarity >= threshold
 * 2. Clusters them into groups
 * 3. Keeps 1 per cluster (the one from the earliest set), removes the rest
 * 4. Rebuilds sets — removes affected questions, merges underfilled sets
 * 5. Re-IDs everything cleanly
 *
 * Usage:
 *   node scripts/dedup-bs-bank.mjs              # dry-run (report only)
 *   node scripts/dedup-bs-bank.mjs --apply      # apply changes
 */

import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BANK_PATH = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const SIMILARITY_THRESHOLD = 0.75;
const SET_SIZE = 10;

const applyMode = process.argv.includes("--apply");

// ── Similarity helpers ──

function normalizeAnswer(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function wordSet(s) {
  return new Set(normalizeAnswer(s).split(" ").filter(Boolean));
}

function jaccardWords(a, b) {
  const wa = wordSet(a), wb = wordSet(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  wa.forEach(w => { if (wb.has(w)) inter++; });
  return inter / (wa.size + wb.size - inter);
}

function levenshteinSim(a, b) {
  const na = normalizeAnswer(a), nb = normalizeAnswer(b);
  const la = na.length, lb = nb.length;
  if (la === 0 || lb === 0) return 0;
  // Optimization: if lengths differ too much, skip
  if (Math.abs(la - lb) / Math.max(la, lb) > 0.4) return 0;
  const dp = Array.from({ length: la + 1 }, () => new Uint16Array(lb + 1));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++)
    for (let j = 1; j <= lb; j++)
      dp[i][j] = na[i - 1] === nb[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return 1 - dp[la][lb] / Math.max(la, lb);
}

function similarity(a, b) {
  return Math.max(jaccardWords(a, b), levenshteinSim(a, b));
}

// ── Load bank ──
const bank = JSON.parse(readFileSync(BANK_PATH, "utf8"));
const sets = bank.question_sets;

// Flatten all questions with location info
const allQ = [];
sets.forEach(s => {
  s.questions.forEach((q, i) => {
    allQ.push({ ...q, _setId: s.set_id, _idx: i });
  });
});

console.log(`Loaded ${allQ.length} questions from ${sets.length} sets\n`);

// ── Find similar pairs ──
const pairs = [];
for (let i = 0; i < allQ.length; i++) {
  for (let j = i + 1; j < allQ.length; j++) {
    const sim = similarity(allQ[i].answer, allQ[j].answer);
    if (sim >= SIMILARITY_THRESHOLD) {
      pairs.push({ i, j, sim });
    }
  }
}

console.log(`Found ${pairs.length} pairs with similarity >= ${SIMILARITY_THRESHOLD}\n`);

// ── Cluster via union-find ──
const parent = allQ.map((_, idx) => idx);
function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
function union(a, b) { parent[find(a)] = find(b); }

pairs.forEach(p => union(p.i, p.j));

const clusters = new Map();
for (let i = 0; i < allQ.length; i++) {
  const root = find(i);
  if (!clusters.has(root)) clusters.set(root, []);
  clusters.get(root).push(i);
}

// Only clusters with 2+ members
const dupClusters = [...clusters.values()].filter(c => c.length >= 2);
dupClusters.sort((a, b) => b.length - a.length);

// ── Decide which to keep vs remove ──
const removeIds = new Set();

console.log("=== Duplicate Clusters ===\n");
dupClusters.forEach((indices, ci) => {
  // Keep the one from the earliest set (lowest set_id)
  indices.sort((a, b) => allQ[a]._setId - allQ[b]._setId || allQ[a]._idx - allQ[b]._idx);
  const keepIdx = indices[0];
  const removeIndices = indices.slice(1);

  console.log(`Cluster ${ci + 1} (${indices.length} questions) — keep [套${allQ[keepIdx]._setId} q${allQ[keepIdx]._idx + 1}]`);
  console.log(`  KEEP: "${allQ[keepIdx].answer}"`);
  for (const ri of removeIndices) {
    const q = allQ[ri];
    const sim = similarity(allQ[keepIdx].answer, q.answer);
    console.log(`  DEL:  "${q.answer}" [套${q._setId} q${q._idx + 1}] (sim=${(sim * 100).toFixed(1)}%)`);
    removeIds.add(q.id);
  }
  console.log();
});

console.log(`Total to remove: ${removeIds.size} questions\n`);

if (!applyMode) {
  console.log("Dry run — no changes written. Use --apply to apply.\n");

  // Preview what sets would look like after removal
  let under10 = 0;
  for (const s of sets) {
    const remaining = s.questions.filter(q => !removeIds.has(q.id));
    if (remaining.length < SET_SIZE) {
      under10++;
      console.log(`  Set ${s.set_id}: ${remaining.length}/${s.questions.length} remaining`);
    }
  }
  console.log(`\nSets with < ${SET_SIZE} questions after dedup: ${under10}`);
  process.exit(0);
}

// ── Apply: remove duplicates, rebuild sets ──
console.log("Applying dedup...\n");

// Back up
const backupPath = BANK_PATH.replace(".json", `.backup-${Date.now()}.json`);
copyFileSync(BANK_PATH, backupPath);
console.log(`Backup saved to ${backupPath}`);

// Remove flagged questions from each set
for (const s of sets) {
  s.questions = s.questions.filter(q => !removeIds.has(q.id));
}

// Collect orphan questions from underfilled sets
const fullSets = [];
const orphans = [];

for (const s of sets) {
  if (s.questions.length >= SET_SIZE) {
    // If overfull, take first SET_SIZE
    if (s.questions.length > SET_SIZE) {
      orphans.push(...s.questions.slice(SET_SIZE));
      s.questions = s.questions.slice(0, SET_SIZE);
    }
    fullSets.push(s);
  } else {
    orphans.push(...s.questions);
  }
}

// Assemble orphans into new sets
while (orphans.length >= SET_SIZE) {
  const batch = orphans.splice(0, SET_SIZE);
  fullSets.push({ set_id: 0, questions: batch });
}

// If leftover orphans < SET_SIZE, still include them as a smaller set
if (orphans.length > 0) {
  fullSets.push({ set_id: 0, questions: orphans });
}

// Re-number sets and questions
fullSets.forEach((s, si) => {
  s.set_id = si + 1;
  s.questions.forEach((q, qi) => {
    q.id = `ets_s${s.set_id}_q${qi + 1}`;
  });
});

const newTotal = fullSets.reduce((n, s) => n + s.questions.length, 0);

bank.question_sets = fullSets;
bank.generated_at = new Date().toISOString();
writeFileSync(BANK_PATH, JSON.stringify(bank, null, 2) + "\n", "utf8");

console.log(`\nDone! ${sets.length} sets → ${fullSets.length} sets, ${allQ.length} → ${newTotal} questions`);
console.log(`Removed ${removeIds.size} duplicate questions`);
const smallSets = fullSets.filter(s => s.questions.length < SET_SIZE);
if (smallSets.length > 0) {
  console.log(`Note: ${smallSets.length} set(s) have < ${SET_SIZE} questions: ${smallSets.map(s => `set ${s.set_id} (${s.questions.length}q)`).join(", ")}`);
}
