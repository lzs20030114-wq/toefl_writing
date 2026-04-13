#!/usr/bin/env node

/**
 * RDL Pitfall Analysis — Identify what AI generation gets WRONG.
 *
 * Analyzes dimensions that directly affect generation quality:
 * 1. Option specificity gradient — are correct answers more/less specific?
 * 2. Guessability — can you answer without reading the passage?
 * 3. Q1/Q2/Q3 position patterns — is there a fixed formula?
 * 4. Proper noun & numeric density — how much concrete detail?
 * 5. Passage "actionability" — instructions/rules vs pure info
 * 6. Distractor semantic category match — do all options describe the same type of thing?
 * 7. Stem-to-passage keyword anchoring — how stems locate the answer
 * 8. Option absolute vs hedged language
 * 9. Explanation evidence patterns — how explanations quote/reference
 * 10. Cross-item vocabulary reuse — do different passages use the same vocabulary?
 *
 * Usage: node scripts/analyze-rdl-pitfalls.mjs
 */

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, "..", "data", "reading", "samples", "readInDailyLife");
const PROFILE_DIR = join(__dirname, "..", "data", "reading", "profile");

function loadAll() {
  const items = [];
  for (const f of readdirSync(DIR).filter(f => f.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(join(DIR, f), "utf-8"));
    if (Array.isArray(d.items)) items.push(...d.items);
  }
  return items;
}

function wc(t) { return t.trim().split(/\s+/).filter(Boolean).length; }
function contentWords(t) {
  const STOP = new Set("the a an and or but in on at to for of with by from is are was were be been being have has had do does did will would could should may might can it its this that these those they them their he she his her we our you your not no as if so than also very up out all each every both such only own into over after before between through during without who which what when where how there then".split(" "));
  return t.toLowerCase().replace(/[^a-z'\s-]/g, " ").split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
}

const items = loadAll();
const allQ = items.flatMap(i => (i.questions || []).map((q, qi) => ({ ...q, _text: i.text, _genre: i.genre, _id: i.id, _qIndex: qi })));

console.log("╔════════════════════════════════════════════════════════════╗");
console.log("║  RDL Pitfall Analysis — What AI Gets Wrong & How to Fix  ║");
console.log("╚════════════════════════════════════════════════════════════╝\n");

// ═══════════════════════════════════════════════════
// 1. OPTION SPECIFICITY — correct vs distractors
// ═══════════════════════════════════════════════════

console.log("━━━ 1. Option Specificity Gradient ━━━\n");

// Count specific markers: numbers, proper nouns, dates, quoted terms
function specificityScore(text) {
  let score = 0;
  score += (text.match(/\d/g) || []).length * 2; // numbers are very specific
  score += (text.match(/\b[A-Z][a-z]{2,}/g) || []).length; // proper nouns
  score += (text.match(/\$\d/g) || []).length * 3; // money = very specific
  score += (text.match(/\b(?:AM|PM)\b/g) || []).length * 2; // times
  score += (text.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/gi) || []).length * 2;
  return score;
}

let correctMoreSpecific = 0, distractorMoreSpecific = 0, sameSpecificity = 0;
const correctSpecScores = [], distractorSpecScores = [];

allQ.forEach(q => {
  if (!q.options || !q.correct_answer) return;
  const cSpec = specificityScore(q.options[q.correct_answer] || "");
  correctSpecScores.push(cSpec);

  const dSpecs = Object.entries(q.options)
    .filter(([k]) => k !== q.correct_answer)
    .map(([, v]) => specificityScore(v));
  const avgDSpec = dSpecs.reduce((s, v) => s + v, 0) / dSpecs.length;
  dSpecs.forEach(d => distractorSpecScores.push(d));

  if (cSpec > avgDSpec + 0.5) correctMoreSpecific++;
  else if (avgDSpec > cSpec + 0.5) distractorMoreSpecific++;
  else sameSpecificity++;
});

console.log(`  Correct is more specific:    ${correctMoreSpecific} (${(correctMoreSpecific/allQ.length*100).toFixed(0)}%)`);
console.log(`  Distractor is more specific: ${distractorMoreSpecific} (${(distractorMoreSpecific/allQ.length*100).toFixed(0)}%)`);
console.log(`  Same specificity:            ${sameSpecificity} (${(sameSpecificity/allQ.length*100).toFixed(0)}%)`);
console.log(`  Avg correct specificity:     ${(correctSpecScores.reduce((s,v)=>s+v,0)/correctSpecScores.length).toFixed(1)}`);
console.log(`  Avg distractor specificity:  ${(distractorSpecScores.reduce((s,v)=>s+v,0)/distractorSpecScores.length).toFixed(1)}`);

// ═══════════════════════════════════════════════════
// 2. GUESSABILITY — can you answer without the passage?
// ═══════════════════════════════════════════════════

console.log("\n━━━ 2. Guessability Analysis (can answer be guessed without passage?) ━━━\n");

// Heuristic: if the correct answer contains very generic/common sense info, it's guessable
// Signals of guessability: correct answer is the most "reasonable" sounding, uses hedging
const REASONABLE_MARKERS = /\b(?:to inform|to provide|to explain|to announce|it aims|designed to|intended to|in order to|for the purpose)\b/i;
const EXTREME_MARKERS = /\b(?:all|always|never|only|exclusively|every|none|completely|impossible|guaranteed|must always)\b/i;

let guessableCount = 0, notGuessable = 0;
const guessableByType = {};

allQ.forEach(q => {
  if (!q.options || !q.correct_answer) return;
  const correct = q.options[q.correct_answer];
  const type = q.question_type || "other";

  // A question is "guessable" if:
  // 1. Correct answer sounds like common sense / generic
  // 2. Distractors contain extreme/absolute language
  const correctIsReasonable = REASONABLE_MARKERS.test(correct);
  const distractorsHaveExtremes = Object.entries(q.options)
    .filter(([k]) => k !== q.correct_answer)
    .some(([, v]) => EXTREME_MARKERS.test(v));

  const guessable = correctIsReasonable || distractorsHaveExtremes;
  if (guessable) {
    guessableCount++;
    guessableByType[type] = (guessableByType[type] || 0) + 1;
  } else {
    notGuessable++;
  }
});

console.log(`  Potentially guessable: ${guessableCount} (${(guessableCount/allQ.length*100).toFixed(0)}%)`);
console.log(`  Not guessable:         ${notGuessable} (${(notGuessable/allQ.length*100).toFixed(0)}%)`);
console.log("  By type:", Object.entries(guessableByType).map(([k,v]) => `${k}:${v}`).join(", "));
console.log("  (Guessable = correct sounds like common sense OR distractors use extreme language)");

// ═══════════════════════════════════════════════════
// 3. Q1/Q2/Q3 POSITION PATTERNS
// ═══════════════════════════════════════════════════

console.log("\n━━━ 3. Q1/Q2/Q3 Question Type Patterns ━━━\n");

const posPatterns = { Q1: {}, Q2: {}, Q3: {} };
items.forEach(item => {
  (item.questions || []).forEach((q, i) => {
    const pos = `Q${i + 1}`;
    if (posPatterns[pos]) {
      const type = q.question_type || "other";
      posPatterns[pos][type] = (posPatterns[pos][type] || 0) + 1;
    }
  });
});

for (const [pos, types] of Object.entries(posPatterns)) {
  const total = Object.values(types).reduce((s, v) => s + v, 0);
  const parts = Object.entries(types).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}:${(c/total*100).toFixed(0)}%`);
  console.log(`  ${pos}: ${parts.join(", ")}`);
}

// Check for fixed formulas
const typeSequences = {};
items.forEach(item => {
  const seq = (item.questions || []).map(q => q.question_type || "?").join("→");
  typeSequences[seq] = (typeSequences[seq] || 0) + 1;
});
console.log("\n  Most common Q-type sequences:");
const topSeqs = Object.entries(typeSequences).sort((a, b) => b[1] - a[1]).slice(0, 8);
for (const [seq, count] of topSeqs) {
  console.log(`    ${seq.padEnd(45)} ${count} (${(count/items.length*100).toFixed(0)}%)`);
}

// ═══════════════════════════════════════════════════
// 4. PROPER NOUN & NUMERIC DENSITY
// ═══════════════════════════════════════════════════

console.log("\n━━━ 4. Proper Noun & Numeric Density per Passage ━━━\n");

const propNounCounts = [];
const numericCounts = [];
const uniqueNameSets = [];

items.forEach(i => {
  const t = i.text;
  const names = t.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
  const numbers = t.match(/\b\d+(?:\.\d+)?(?:\s*(?:%|percent|dollars?))?\b/g) || [];
  propNounCounts.push(names.length);
  numericCounts.push(numbers.length);
  uniqueNameSets.push(new Set(names.map(n => n.toLowerCase())).size);
});

const avgNames = propNounCounts.reduce((s, v) => s + v, 0) / items.length;
const avgNums = numericCounts.reduce((s, v) => s + v, 0) / items.length;
const avgUniqueNames = uniqueNameSets.reduce((s, v) => s + v, 0) / items.length;
console.log(`  Avg proper noun phrases/passage: ${avgNames.toFixed(1)} (${avgUniqueNames.toFixed(1)} unique)`);
console.log(`  Avg numeric values/passage:      ${avgNums.toFixed(1)}`);
console.log(`  Range names: ${Math.min(...propNounCounts)}-${Math.max(...propNounCounts)}`);
console.log(`  Range numbers: ${Math.min(...numericCounts)}-${Math.max(...numericCounts)}`);

// ═══════════════════════════════════════════════════
// 5. PASSAGE "ACTIONABILITY"
// ═══════════════════════════════════════════════════

console.log("\n━━━ 5. Passage Actionability (instructions vs information) ━━━\n");

let instructional = 0, informational = 0, mixed = 0;
const INSTRUCTION_MARKERS = /\b(?:please|must|should|required|make sure|be sure|ensure|do not|don't|bring|submit|complete|register|sign up|pick up|drop off|contact|visit|email|call|log in|scan|RSVP|check)\b/i;
const INFO_MARKERS = /\b(?:is hosting|will be held|takes place|is located|operates|offers|provides|features|includes|welcomes)\b/i;

items.forEach(i => {
  const t = i.text;
  const instrCount = (t.match(new RegExp(INSTRUCTION_MARKERS.source, "gi")) || []).length;
  const infoCount = (t.match(new RegExp(INFO_MARKERS.source, "gi")) || []).length;

  if (instrCount > infoCount * 1.5) instructional++;
  else if (infoCount > instrCount * 1.5) informational++;
  else mixed++;
});

console.log(`  Instructional (tells reader to DO things):  ${instructional} (${(instructional/items.length*100).toFixed(0)}%)`);
console.log(`  Informational (describes events/services):  ${informational} (${(informational/items.length*100).toFixed(0)}%)`);
console.log(`  Mixed (both):                               ${mixed} (${(mixed/items.length*100).toFixed(0)}%)`);

// ═══════════════════════════════════════════════════
// 6. DISTRACTOR SEMANTIC CATEGORY MATCH
// ═══════════════════════════════════════════════════

console.log("\n━━━ 6. Do All 4 Options Describe the Same Type of Thing? ━━━\n");

// Classify option type: action, reason, time, location, person, object, state
function optionCategory(text) {
  const t = text.toLowerCase().trim();
  if (t.match(/^(?:to |by |in order to )/)) return "action/purpose";
  if (t.match(/^(?:because|since|due to|it |they |he |she )/)) return "reason/explanation";
  if (t.match(/^(?:on |at |before |after |by |during |within )\d/)) return "time";
  if (t.match(/^(?:in the |at the |inside |near |next to )/)) return "location";
  if (t.match(/^\$?\d/)) return "quantity/price";
  if (t.match(/^(?:a |an |the |their |her |his |its )/)) return "noun_phrase";
  if (t.match(/ing\b/)) return "gerund_action";
  return "other";
}

let allSameCategory = 0, mostlySame = 0, mixed2 = 0;
allQ.forEach(q => {
  if (!q.options) return;
  const cats = Object.values(q.options).map(optionCategory);
  const unique = new Set(cats);
  if (unique.size === 1) allSameCategory++;
  else if (unique.size === 2) mostlySame++;
  else mixed2++;
});

console.log(`  All 4 options same category:  ${allSameCategory} (${(allSameCategory/allQ.length*100).toFixed(0)}%)`);
console.log(`  3-4 options same (2 cats):    ${mostlySame} (${(mostlySame/allQ.length*100).toFixed(0)}%)`);
console.log(`  Mixed categories (3+):        ${mixed2} (${(mixed2/allQ.length*100).toFixed(0)}%)`);

// ═══════════════════════════════════════════════════
// 7. STEM KEYWORD ANCHORING
// ═══════════════════════════════════════════════════

console.log("\n━━━ 7. Stem-to-Passage Keyword Anchoring ━━━\n");

// How many content words in the stem also appear in the passage?
const stemOverlaps = [];
allQ.forEach(q => {
  if (!q.stem || !q._text) return;
  const stemCW = contentWords(q.stem);
  const textCW = new Set(contentWords(q._text));
  if (stemCW.length === 0) return;
  const overlap = stemCW.filter(w => textCW.has(w)).length / stemCW.length;
  stemOverlaps.push(overlap);
});

const avgStemOverlap = stemOverlaps.reduce((s, v) => s + v, 0) / stemOverlaps.length;
console.log(`  Avg stem-passage word overlap: ${(avgStemOverlap*100).toFixed(1)}%`);
console.log(`  (Stems use passage vocabulary to help locate the answer area)`);

// Do stems ever quote passage phrases?
let stemQuotesPassage = 0;
allQ.forEach(q => {
  if (!q.stem || !q._text) return;
  const stemWords = q.stem.toLowerCase().split(/\s+/);
  const textLower = q._text.toLowerCase();
  for (let i = 0; i <= stemWords.length - 3; i++) {
    const trigram = stemWords.slice(i, i + 3).join(" ");
    if (trigram.length > 8 && textLower.includes(trigram)) {
      stemQuotesPassage++;
      break;
    }
  }
});
console.log(`  Stems containing 3+ word passage phrase: ${stemQuotesPassage} (${(stemQuotesPassage/allQ.length*100).toFixed(0)}%)`);

// ═══════════════════════════════════════════════════
// 8. ABSOLUTE vs HEDGED LANGUAGE IN OPTIONS
// ═══════════════════════════════════════════════════

console.log("\n━━━ 8. Absolute vs Hedged Language in Options ━━━\n");

const ABSOLUTES = /\b(?:all|always|never|only|exclusively|every|none|completely|impossible|guaranteed|must always|no one|everyone|nothing|everything)\b/i;
const HEDGES = /\b(?:may|might|could|possibly|some|certain|likely|probably|generally|often|sometimes|tends? to|appears?|seems?)\b/i;

let correctAbsolute = 0, correctHedged = 0, correctNeutral = 0;
let distractorAbsolute = 0, distractorHedged = 0, distractorNeutral = 0;

allQ.forEach(q => {
  if (!q.options || !q.correct_answer) return;
  for (const [key, val] of Object.entries(q.options)) {
    const isAbsolute = ABSOLUTES.test(val);
    const isHedged = HEDGES.test(val);
    if (key === q.correct_answer) {
      if (isAbsolute) correctAbsolute++;
      else if (isHedged) correctHedged++;
      else correctNeutral++;
    } else {
      if (isAbsolute) distractorAbsolute++;
      else if (isHedged) distractorHedged++;
      else distractorNeutral++;
    }
  }
});

const cTotal = correctAbsolute + correctHedged + correctNeutral;
const dTotal = distractorAbsolute + distractorHedged + distractorNeutral;
console.log("  Correct answers:");
console.log(`    Absolute: ${correctAbsolute} (${(correctAbsolute/cTotal*100).toFixed(0)}%)  Hedged: ${correctHedged} (${(correctHedged/cTotal*100).toFixed(0)}%)  Neutral: ${correctNeutral} (${(correctNeutral/cTotal*100).toFixed(0)}%)`);
console.log("  Distractors:");
console.log(`    Absolute: ${distractorAbsolute} (${(distractorAbsolute/dTotal*100).toFixed(0)}%)  Hedged: ${distractorHedged} (${(distractorHedged/dTotal*100).toFixed(0)}%)  Neutral: ${distractorNeutral} (${(distractorNeutral/dTotal*100).toFixed(0)}%)`);
console.log("  (If distractors use more absolutes than correct, students can exploit this as a tell)");

// ═══════════════════════════════════════════════════
// 9. CROSS-ITEM VOCABULARY REUSE
// ═══════════════════════════════════════════════════

console.log("\n━━━ 9. Cross-Item Vocabulary Diversity ━━━\n");

// Do different passages use the same words? (indicates vocabulary pool breadth)
const passageWordSets = items.map(i => new Set(contentWords(i.text)));
let pairwiseOverlaps = [];
for (let i = 0; i < Math.min(passageWordSets.length, 30); i++) {
  for (let j = i + 1; j < Math.min(passageWordSets.length, 30); j++) {
    const intersection = [...passageWordSets[i]].filter(w => passageWordSets[j].has(w)).length;
    const union = new Set([...passageWordSets[i], ...passageWordSets[j]]).size;
    if (union > 0) pairwiseOverlaps.push(intersection / union);
  }
}

const avgCrossOverlap = pairwiseOverlaps.reduce((s, v) => s + v, 0) / pairwiseOverlaps.length;
console.log(`  Avg pairwise passage vocabulary overlap: ${(avgCrossOverlap*100).toFixed(1)}%`);
console.log(`  (Low = good vocabulary diversity across passages)`);

// Most shared words across passages (appear in 10+ passages)
const wordPassageCount = {};
passageWordSets.forEach(ws => {
  ws.forEach(w => { wordPassageCount[w] = (wordPassageCount[w] || 0) + 1; });
});
const ubiquitousWords = Object.entries(wordPassageCount)
  .filter(([, c]) => c >= 10)
  .sort((a, b) => b[1] - a[1]);
console.log(`  Words appearing in 10+ passages: ${ubiquitousWords.length}`);
console.log(`  Top shared: ${ubiquitousWords.slice(0, 15).map(([w, c]) => `${w}(${c})`).join(", ")}`);

// ═══════════════════════════════════════════════════
// 10. PASSAGE COMPLEXITY CONSISTENCY
// ═══════════════════════════════════════════════════

console.log("\n━━━ 10. Passage Internal Complexity Variation ━━━\n");

// Does sentence complexity vary within a passage? (good = varied, bad = monotonous)
const intraPassageCV = [];
items.forEach(i => {
  const sentLens = i.text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 1).map(s => wc(s));
  if (sentLens.length < 3) return;
  const mean = sentLens.reduce((s, v) => s + v, 0) / sentLens.length;
  const std = Math.sqrt(sentLens.reduce((s, v) => s + (v - mean) ** 2, 0) / sentLens.length);
  intraPassageCV.push(mean > 0 ? std / mean : 0);
});

const avgCV = intraPassageCV.reduce((s, v) => s + v, 0) / intraPassageCV.length;
console.log(`  Avg intra-passage sentence length CV: ${avgCV.toFixed(3)}`);
console.log(`  (0.3-0.5 = good variety, <0.2 = monotonous, >0.6 = chaotic)`);
console.log(`  Range: ${Math.min(...intraPassageCV).toFixed(3)} - ${Math.max(...intraPassageCV).toFixed(3)}`);

// ═══════════════════════════════════════════════════
// SUMMARY: AI GENERATION PITFALL CHECKLIST
// ═══════════════════════════════════════════════════

console.log("\n━━━ GENERATION PITFALL CHECKLIST ━━━\n");
console.log("  Based on the above analysis, AI-generated RDL items must avoid these pitfalls:\n");

const pitfalls = [
  { check: "Correct answer is consistently the most specific option", risk: correctMoreSpecific > distractorMoreSpecific ? "HIGH" : "LOW", value: `${(correctMoreSpecific/allQ.length*100).toFixed(0)}% correct more specific` },
  { check: "Questions guessable without reading passage", risk: guessableCount > allQ.length * 0.3 ? "HIGH" : "MEDIUM", value: `${(guessableCount/allQ.length*100).toFixed(0)}% guessable` },
  { check: "Distractors use absolute language (tells)", risk: distractorAbsolute > correctAbsolute * 2 ? "HIGH" : "LOW", value: `correct ${(correctAbsolute/cTotal*100).toFixed(0)}% vs distractor ${(distractorAbsolute/dTotal*100).toFixed(0)}% absolute` },
  { check: "Q-type sequence is too predictable", risk: topSeqs[0]?.[1] > items.length * 0.3 ? "HIGH" : "LOW", value: `most common: "${topSeqs[0]?.[0]}" at ${topSeqs[0]?.[1]} times` },
  { check: "Options don't match same semantic category", risk: mixed2 > allQ.length * 0.3 ? "MEDIUM" : "LOW", value: `${(mixed2/allQ.length*100).toFixed(0)}% mixed categories` },
  { check: "Stems don't anchor to passage vocabulary", risk: avgStemOverlap < 0.3 ? "MEDIUM" : "LOW", value: `${(avgStemOverlap*100).toFixed(0)}% stem-passage overlap` },
  { check: "Passage sentence complexity is monotonous", risk: avgCV < 0.25 ? "MEDIUM" : "LOW", value: `avg CV=${avgCV.toFixed(3)}` },
];

pitfalls.forEach(p => {
  const icon = p.risk === "HIGH" ? "🔴" : p.risk === "MEDIUM" ? "🟡" : "🟢";
  console.log(`  ${icon} [${p.risk}] ${p.check}`);
  console.log(`         ${p.value}`);
});

// Save
const report = {
  generated_at: new Date().toISOString(),
  optionSpecificity: { correctMoreSpecific, distractorMoreSpecific, sameSpecificity },
  guessability: { guessableCount, total: allQ.length, rate: +(guessableCount/allQ.length).toFixed(3) },
  qPositionPatterns: posPatterns,
  topTypeSequences: topSeqs.map(([seq, count]) => ({ sequence: seq, count })),
  passageDetail: { avgNames: +avgNames.toFixed(1), avgNumbers: +avgNums.toFixed(1) },
  actionability: { instructional, informational, mixed },
  optionCategoryMatch: { allSame: allSameCategory, mostlySame, mixed: mixed2 },
  stemAnchoring: { avgOverlap: +avgStemOverlap.toFixed(3), quotesPassage: stemQuotesPassage },
  absoluteVsHedged: { correct: { absolute: correctAbsolute, hedged: correctHedged, neutral: correctNeutral }, distractor: { absolute: distractorAbsolute, hedged: distractorHedged, neutral: distractorNeutral } },
  crossItemOverlap: +avgCrossOverlap.toFixed(3),
  sentenceComplexityCV: +avgCV.toFixed(3),
  pitfalls,
};

writeFileSync(join(PROFILE_DIR, "rdlPitfallAnalysis.json"), JSON.stringify(report, null, 2));
console.log(`\nReport saved to: ${join(PROFILE_DIR, "rdlPitfallAnalysis.json")}`);
