#!/usr/bin/env node
// Comprehensive BS audit + cleanup in one pass.
// 1. Audit every today's BS item against L1-L4 standards
// 2. Manually-curated bad-item list (extended after word-by-word review)
// 3. Drop bad items, repack into 10-item sets
// 4. Move leftovers to reserve_pool
// 5. Report stats

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const require = createRequire(import.meta.url);
const { validateQuestion } = require(resolve(ROOT, "lib/questionBank/buildSentenceSchema.js"));
const { classifyPrefilledType } = await import(pathToFileURL(resolve(ROOT, "lib/quality/scoreBatch.mjs")).href);

// ── Curated bad-item list (from word-by-word audit) ────────────────────
const KNOWN_BAD_IDS = new Set([
  "ets_s71_q6",   // L2: 3 effective chunks (too few)
  "ets_s72_q3",   // L4: prompt-answer topic mismatch (financial aid → bus schedule)
]);

// ── AI-ism / vague reference patterns ──────────────────────────────────
const AI_TONE_RE = /\b(in accordance with|pursuant to|aforementioned|hereinafter|heretofore|leverage the|synergize|stakeholders|deliverables|paradigm shift)\b/i;
const VAGUE_RE = /\b(the matter|the issue|the situation|the thing|that thing|the topic|the aforementioned)\b/i;

function auditOne(q) {
  const reasons = [];
  const v = validateQuestion(q);
  if (v.fatal.length) reasons.push("FATAL: " + v.fatal.slice(0, 2).join("|"));
  if (v.format.length) reasons.push("FORMAT: " + v.format.slice(0, 2).join("|"));

  // Topic match heuristic — too noisy in practice (real TPO often has
  // prompt "lab equipment" → answer "microscope" which is semantically
  // correct but lexically disjoint). Removed; rely on KNOWN_BAD_IDS for
  // hand-curated topic mismatches like s72_q3.

  // AI-ism / vague
  if (AI_TONE_RE.test(q.answer || "")) reasons.push("AI-ism in answer");
  if (VAGUE_RE.test(q.prompt || "") || VAGUE_RE.test(q.answer || "")) reasons.push("vague reference");

  // Word count
  const ansWords = String(q.answer || "").trim().split(/\s+/).filter(Boolean).length;
  if (ansWords < 7 || ansWords > 15) reasons.push(`answer ${ansWords} words not in 7-15`);

  return { pass: reasons.length === 0 && !KNOWN_BAD_IDS.has(q.id), reasons };
}

// ── Load bank ──────────────────────────────────────────────────────────
const bsPath = resolve(ROOT, "data/buildSentence/questions.json");
const reservePath = resolve(ROOT, "data/buildSentence/reserve_pool.json");
const bs = JSON.parse(readFileSync(bsPath, "utf8"));
const allSets = bs.question_sets || [];

const historicalSets = allSets.filter((s) => s.set_id < 70);
const todaySets = allSets.filter((s) => s.set_id >= 70);
console.log("Historical sets:", historicalSets.length, "(untouched)");
console.log("Today's sets:", todaySets.length, "set_ids:", todaySets.map((s) => s.set_id).join(","));

// ── Per-item audit ────────────────────────────────────────────────────
const auditResults = [];
for (const set of todaySets) {
  for (const q of set.questions) {
    const a = auditOne(q);
    auditResults.push({ ...q, _set_id: set.set_id, _audit: a });
  }
}
const passItems = auditResults.filter((r) => r._audit.pass);
const failItems = auditResults.filter((r) => !r._audit.pass);

console.log("\nPer-item audit:");
console.log(`  Pass: ${passItems.length}/${auditResults.length} (${Math.round(passItems.length/auditResults.length*100)}%)`);
console.log(`  Fail: ${failItems.length}/${auditResults.length}`);
failItems.forEach((f) => {
  console.log(`    ✗ ${f.id} (set ${f._set_id}): ${f._audit.reasons.join("; ")}`);
  console.log(`      prompt: "${f.prompt}"`);
  console.log(`      answer: "${f.answer}"`);
});

// ── Per-set L5 batch diversity ────────────────────────────────────────
console.log("\nPer-set L5 (batch diversity) audit:");
for (const set of todaySets) {
  const items = set.questions;
  const N = items.length;
  const pfTypes = items.map((it) => {
    const pf = (it.prefilled || [])[0];
    return pf ? (classifyPrefilledType(pf) || "?") : "empty";
  });
  const pfCounts = {};
  pfTypes.forEach((t) => pfCounts[t] = (pfCounts[t] || 0) + 1);
  const distinctTypes = Object.keys(pfCounts).length;
  const topFrac = Math.round(Math.max(...Object.values(pfCounts)) / N * 100);
  const topType = Object.entries(pfCounts).sort((a, b) => b[1] - a[1])[0];
  const empty = pfCounts.empty || 0;
  const pass = distinctTypes >= 4 && topFrac <= 60;
  const tag = pass ? "✓" : "✗";
  console.log(`  ${tag} set ${set.set_id}: types ${distinctTypes}/4 (top ${topType ? topType.join("=") : "?"} ${topFrac}%, empty ${empty})`);
}

// ── Repack ────────────────────────────────────────────────────────────
console.log("\nRepacking pass items into 10-item sets...");
const newSets = [];
let nextSetId = 70;
for (let i = 0; i + 10 <= passItems.length; i += 10) {
  const slice = passItems.slice(i, i + 10);
  const setItems = slice.map((q, qi) => {
    const { _set_id, _audit, ...rest } = q;
    return { ...rest, id: `ets_s${nextSetId}_q${qi + 1}` };
  });
  newSets.push({ set_id: nextSetId, questions: setItems });
  nextSetId++;
}
const leftovers = passItems.slice(newSets.length * 10).map(q => {
  const { _set_id, _audit, ...rest } = q;
  return rest;
});

console.log(`  ${newSets.length} sets of 10 (set_ids ${newSets[0]?.set_id || 0}-${newSets[newSets.length-1]?.set_id || 0})`);
console.log(`  ${leftovers.length} leftover items (going to reserve_pool)`);

// ── Write back ────────────────────────────────────────────────────────
const finalBank = {
  ...bs,
  version: bs.version || "1.3",
  generated_at: new Date().toISOString(),
  question_sets: [...historicalSets, ...newSets],
};
writeFileSync(bsPath, JSON.stringify(finalBank, null, 2) + "\n", "utf8");
console.log(`\n✅ Updated ${bsPath}: ${finalBank.question_sets.length} sets total`);

// Append leftovers to reserve_pool
if (leftovers.length > 0) {
  let reserve = { items: [] };
  try {
    reserve = JSON.parse(readFileSync(reservePath, "utf8"));
    if (!Array.isArray(reserve.items)) reserve.items = [];
  } catch {}
  const existing = new Set(reserve.items.map(q => q.id));
  const toAdd = leftovers.filter(q => !existing.has(q.id));
  reserve.items.push(...toAdd);
  reserve.updated_at = new Date().toISOString();
  writeFileSync(reservePath, JSON.stringify(reserve, null, 2) + "\n", "utf8");
  console.log(`✅ Added ${toAdd.length} items to reserve_pool (total: ${reserve.items.length})`);
}

console.log("\nFinal:");
console.log(`  ${historicalSets.length} historical sets + ${newSets.length} new sets = ${finalBank.question_sets.length} sets`);
console.log(`  ${finalBank.question_sets.length * 10} BS questions total`);
console.log(`  ${leftovers.length} in reserve`);
console.log(`  ${failItems.length} dropped (bad)`);
