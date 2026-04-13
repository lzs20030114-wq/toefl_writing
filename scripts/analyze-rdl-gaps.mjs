#!/usr/bin/env node

/**
 * RDL Gap Analysis — Dimensions missed in previous rounds.
 *
 * Covers: question positioning, option inter-relationships, negation patterns,
 * multi-sentence synthesis, stem specificity, option grammar, genre-specific
 * distractor strategies, and answer confidence signals.
 *
 * Usage: node scripts/analyze-rdl-gaps.mjs
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
function sents(t) { return t.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 1); }

const items = loadAll();
const allQ = items.flatMap(i => (i.questions || []).map((q, qi) => ({ ...q, _text: i.text, _genre: i.genre, _id: i.id, _qIndex: qi })));

console.log("╔═════════════════════════════════════════════════════════════╗");
console.log("║    RDL Gap Analysis — Previously Overlooked Dimensions     ║");
console.log("╚═════════════════════════════════════════════════════════════╝\n");
console.log(`Total: ${items.length} passages, ${allQ.length} questions\n`);

// ═══════════════════════════════════════════════════
// 1. QUESTION POSITIONING — Where in the text?
// ═══════════════════════════════════════════════════

console.log("━━━ 1. Question Positioning (which part of text does the answer come from?) ━━━\n");

const positionBuckets = { first_third: 0, middle_third: 0, last_third: 0, whole_text: 0, not_in_text: 0 };
const orderedCount = { ordered: 0, unordered: 0 };

items.forEach(item => {
  const text = item.text.toLowerCase();
  const textLen = text.length;
  const questions = item.questions || [];
  const positions = [];

  questions.forEach(q => {
    if (!q.correct_answer || !q.options) return;
    const answer = (q.options[q.correct_answer] || "").toLowerCase();
    const answerCW = contentWords(answer);

    // Find where most answer words appear in the text
    let bestPos = -1;
    let bestScore = 0;
    const chunkSize = Math.floor(textLen / 3);

    for (let third = 0; third < 3; third++) {
      const start = third * chunkSize;
      const end = third === 2 ? textLen : (third + 1) * chunkSize;
      const chunk = text.substring(start, end);
      const chunkCW = contentWords(chunk);
      const score = answerCW.filter(w => chunkCW.includes(w)).length;
      if (score > bestScore) { bestScore = score; bestPos = third; }
    }

    if (q.question_type === "main_idea") {
      positionBuckets.whole_text++;
      positions.push(-1);
    } else if (bestScore === 0) {
      positionBuckets.not_in_text++;
      positions.push(-1);
    } else {
      if (bestPos === 0) positionBuckets.first_third++;
      else if (bestPos === 1) positionBuckets.middle_third++;
      else positionBuckets.last_third++;
      positions.push(bestPos);
    }
  });

  // Check if questions are ordered by text position
  const validPositions = positions.filter(p => p >= 0);
  if (validPositions.length >= 2) {
    let isOrdered = true;
    for (let i = 1; i < validPositions.length; i++) {
      if (validPositions[i] < validPositions[i-1]) { isOrdered = false; break; }
    }
    if (isOrdered) orderedCount.ordered++;
    else orderedCount.unordered++;
  }
});

const totalPos = Object.values(positionBuckets).reduce((s,v)=>s+v,0);
console.log("  Answer source location:");
for (const [k, v] of Object.entries(positionBuckets)) {
  console.log(`    ${k.padEnd(15)} ${v} (${(v/totalPos*100).toFixed(0)}%)`);
}
console.log(`\n  Question ordering: ${orderedCount.ordered} ordered / ${orderedCount.unordered} unordered (${(orderedCount.ordered/(orderedCount.ordered+orderedCount.unordered)*100).toFixed(0)}% follow text order)`);

// ═══════════════════════════════════════════════════
// 2. OPTION INTER-RELATIONSHIPS
// ═══════════════════════════════════════════════════

console.log("\n━━━ 2. Option Inter-Relationships (how similar are the 4 options to each other?) ━━━\n");

const optionPairOverlaps = [];
const optionSetDiversity = [];

allQ.forEach(q => {
  if (!q.options) return;
  const opts = Object.values(q.options).map(o => new Set(contentWords(o)));

  // Pairwise overlap between all options
  const pairScores = [];
  for (let i = 0; i < opts.length; i++) {
    for (let j = i+1; j < opts.length; j++) {
      const intersection = [...opts[i]].filter(w => opts[j].has(w)).length;
      const union = new Set([...opts[i], ...opts[j]]).size;
      if (union > 0) pairScores.push(intersection / union);
    }
  }
  if (pairScores.length > 0) {
    const avg = pairScores.reduce((s,v)=>s+v,0)/pairScores.length;
    optionPairOverlaps.push(avg);
  }

  // How many unique content words across all 4 options?
  const allOptWords = new Set();
  opts.forEach(s => s.forEach(w => allOptWords.add(w)));
  const totalOptWords = opts.reduce((s,o)=>s+o.size,0);
  if (totalOptWords > 0) optionSetDiversity.push(allOptWords.size / totalOptWords);
});

const avgPairOverlap = optionPairOverlaps.reduce((s,v)=>s+v,0)/optionPairOverlaps.length;
const avgDiversity = optionSetDiversity.reduce((s,v)=>s+v,0)/optionSetDiversity.length;
console.log(`  Avg pairwise option overlap (Jaccard): ${(avgPairOverlap*100).toFixed(1)}%`);
console.log(`  Avg option set word diversity: ${(avgDiversity*100).toFixed(1)}% unique words`);
console.log("  (Low overlap + high diversity = options are sufficiently different)");

// ═══════════════════════════════════════════════════
// 3. NEGATION PATTERNS ("NOT" questions)
// ═══════════════════════════════════════════════════

console.log("\n━━━ 3. Negation / NOT Questions ━━━\n");

const notQuestions = allQ.filter(q => q.stem.match(/\bNOT\b|\bnot\b.*(?:mentioned|included|true|stated|accepted)/i));
console.log(`  Total NOT questions: ${notQuestions.length} (${(notQuestions.length/allQ.length*100).toFixed(1)}%)`);

if (notQuestions.length > 0) {
  // In NOT questions, distractors ARE true and correct is the false one
  // Check: do the 3 true options (distractors) have higher passage overlap?
  let trueHigher = 0;
  notQuestions.forEach(q => {
    if (!q.options || !q.correct_answer || !q._text) return;
    const textCW = contentWords(q._text);
    const correctCW = contentWords(q.options[q.correct_answer] || "");
    const correctOverlap = correctCW.filter(w => textCW.includes(w)).length / (correctCW.length || 1);
    const distractorOverlaps = Object.entries(q.options)
      .filter(([k]) => k !== q.correct_answer)
      .map(([, v]) => {
        const cw = contentWords(v);
        return cw.filter(w => textCW.includes(w)).length / (cw.length || 1);
      });
    const avgDistOverlap = distractorOverlaps.reduce((s,v)=>s+v,0)/distractorOverlaps.length;
    if (avgDistOverlap > correctOverlap) trueHigher++;
  });

  console.log(`  In NOT questions, true options (distractors) have higher text overlap: ${trueHigher}/${notQuestions.length} (${(trueHigher/notQuestions.length*100).toFixed(0)}%)`);
  console.log("  (Expected: distractors paraphrase true facts, correct answer is fabricated/absent)");

  // Stem patterns for NOT questions
  const notStems = {};
  notQuestions.forEach(q => {
    if (q.stem.match(/NOT mentioned/i)) notStems["NOT mentioned"] = (notStems["NOT mentioned"]||0)+1;
    else if (q.stem.match(/NOT accepted/i)) notStems["NOT accepted"] = (notStems["NOT accepted"]||0)+1;
    else if (q.stem.match(/NOT (?:a |an )?(?:benefit|feature|requirement)/i)) notStems["NOT a benefit/feature"] = (notStems["NOT a benefit/feature"]||0)+1;
    else if (q.stem.match(/NOT offered/i)) notStems["NOT offered"] = (notStems["NOT offered"]||0)+1;
    else notStems["other NOT"] = (notStems["other NOT"]||0)+1;
  });
  console.log("  NOT question stem patterns:");
  for (const [k,v] of Object.entries(notStems).sort((a,b)=>b[1]-a[1])) {
    console.log(`    ${k.padEnd(25)} ${v}`);
  }
}

// ═══════════════════════════════════════════════════
// 4. MULTI-SENTENCE vs SINGLE-SENTENCE ANSWERS
// ═══════════════════════════════════════════════════

console.log("\n━━━ 4. Answer Source Scope (single sentence vs multi-sentence) ━━━\n");

const scopeCounts = { single_sentence: 0, multi_sentence: 0, whole_text: 0 };

allQ.forEach(q => {
  if (!q.options || !q.correct_answer || !q._text) return;
  if (q.question_type === "main_idea") { scopeCounts.whole_text++; return; }
  if (q.question_type === "vocabulary_in_context") { scopeCounts.single_sentence++; return; }

  const answerCW = contentWords(q.options[q.correct_answer] || "");
  if (answerCW.length === 0) return;

  const textSents = sents(q._text);
  const sentScores = textSents.map(s => {
    const sCW = contentWords(s);
    return answerCW.filter(w => sCW.includes(w)).length;
  });

  const maxScore = Math.max(...sentScores);
  if (maxScore === 0) { scopeCounts.whole_text++; return; }

  // How many sentences contribute significantly? (>30% of max)
  const significantSents = sentScores.filter(s => s > maxScore * 0.3).length;
  if (significantSents <= 1) scopeCounts.single_sentence++;
  else scopeCounts.multi_sentence++;
});

const totalScope = Object.values(scopeCounts).reduce((s,v)=>s+v,0);
for (const [k, v] of Object.entries(scopeCounts)) {
  console.log(`  ${k.padEnd(20)} ${v} (${(v/totalScope*100).toFixed(0)}%)`);
}

// ═══════════════════════════════════════════════════
// 5. STEM SPECIFICITY — names, references, quotes
// ═══════════════════════════════════════════════════

console.log("\n━━━ 5. Stem Specificity ━━━\n");

let hasName = 0, hasQuotedWord = 0, referencesGenre = 0, hasConditional = 0;
allQ.forEach(q => {
  const s = q.stem;
  if (s.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/) || s.match(/\bMs\.\s|Mr\.\s|Dr\.\s/)) hasName++;
  if (s.match(/"[^"]+"|"[^"]+"/)) hasQuotedWord++;
  if (s.match(/\b(?:email|notice|announcement|post|passage|schedule|menu|syllabus|message)\b/i)) referencesGenre++;
  if (s.match(/\bif\b|\bbefore\b|\bafter\b|\bwhen\b/i)) hasConditional++;
});
console.log(`  Names person/entity:  ${hasName} (${(hasName/allQ.length*100).toFixed(0)}%)`);
console.log(`  Quotes a word/phrase: ${hasQuotedWord} (${(hasQuotedWord/allQ.length*100).toFixed(0)}%)`);
console.log(`  References genre:     ${referencesGenre} (${(referencesGenre/allQ.length*100).toFixed(0)}%)`);
console.log(`  Has conditional:      ${hasConditional} (${(hasConditional/allQ.length*100).toFixed(0)}%)`);

// ═══════════════════════════════════════════════════
// 6. OPTION GRAMMATICAL OPENING PATTERNS
// ═══════════════════════════════════════════════════

console.log("\n━━━ 6. Option Grammatical Opening Patterns ━━━\n");

const optStarts = { gerund_ing: 0, infinitive_to: 0, noun_phrase: 0, pronoun_it_they: 0, article_the_a: 0, prep_by_in: 0, verb_base: 0, other: 0 };
let totalOpts = 0;

allQ.forEach(q => {
  if (!q.options) return;
  for (const opt of Object.values(q.options)) {
    totalOpts++;
    const first = opt.trim().split(/\s/)[0].toLowerCase();
    const second = opt.trim().split(/\s/)[1]?.toLowerCase() || "";

    if (first.endsWith("ing") && first.length > 4) optStarts.gerund_ing++;
    else if (first === "to" && second.match(/^[a-z]/)) optStarts.infinitive_to++;
    else if (first === "it" || first === "they" || first === "he" || first === "she" || first === "students" || first === "the") {
      if (first === "the" || first === "a" || first === "an") optStarts.article_the_a++;
      else optStarts.pronoun_it_they++;
    }
    else if (first === "by" || first === "in" || first === "at" || first === "from" || first === "through") optStarts.prep_by_in++;
    else if (first.match(/^[a-z]+$/) && !first.endsWith("ing") && !first.endsWith("ed")) optStarts.noun_phrase++;
    else optStarts.other++;
  }
});

for (const [k, v] of Object.entries(optStarts).sort((a,b)=>b[1]-a[1])) {
  if (v > 0) console.log(`  ${k.padEnd(20)} ${v} (${(v/totalOpts*100).toFixed(1)}%)`);
}

// Within-question parallelism: how often do all 4 options share the same start pattern?
let parallelCount = 0;
allQ.forEach(q => {
  if (!q.options) return;
  const starts = Object.values(q.options).map(o => {
    const f = o.trim().split(/\s/)[0].toLowerCase();
    if (f.endsWith("ing") && f.length > 4) return "gerund";
    if (f === "to") return "infinitive";
    if (f === "the" || f === "a" || f === "an") return "article";
    if (f === "it" || f === "they" || f === "he" || f === "she") return "pronoun";
    if (f === "by" || f === "in" || f === "at") return "prep";
    return "other";
  });
  if (new Set(starts).size <= 2) parallelCount++;
});
console.log(`\n  Questions with strong parallelism (≤2 start types): ${parallelCount} (${(parallelCount/allQ.length*100).toFixed(0)}%)`);

// ═══════════════════════════════════════════════════
// 7. GENRE-SPECIFIC DISTRACTOR STRATEGIES
// ═══════════════════════════════════════════════════

console.log("\n━━━ 7. Genre-Specific Distractor Strategies ━━━\n");

const genreDistractorProfile = {};

allQ.forEach(q => {
  if (!q.options || !q.correct_answer || !q._text) return;
  const g = q._genre || "other";
  if (!genreDistractorProfile[g]) genreDistractorProfile[g] = {
    uses_passage: 0, introduces_new: 0, plausible_generic: 0,
    correctIsLongest: 0, total: 0, questions: 0,
  };
  const gp = genreDistractorProfile[g];
  gp.questions++;

  const textCW = contentWords(q._text);
  const correctCW = contentWords(q.options[q.correct_answer] || "");
  const correctLen = wc(q.options[q.correct_answer] || "");
  let maxLen = 0;
  let onlyLongest = true;

  for (const [key, val] of Object.entries(q.options)) {
    const len = wc(val);
    if (len > maxLen) maxLen = len;
    if (key === q.correct_answer) continue;
    gp.total++;

    const dCW = contentWords(val);
    const overlap = dCW.length > 0 ? dCW.filter(w => textCW.includes(w)).length / dCW.length : 0;

    if (overlap > 0.5) gp.uses_passage++;
    else if (overlap < 0.15) gp.introduces_new++;
    else gp.plausible_generic++;
  }

  // Check if correct is the only longest
  const allLens = Object.values(q.options).map(o => wc(o));
  if (correctLen === maxLen && allLens.filter(l => l === maxLen).length === 1) {
    gp.correctIsLongest++;
  }
});

for (const [g, gp] of Object.entries(genreDistractorProfile).sort((a,b) => b[1].total - a[1].total)) {
  if (gp.total < 3) continue;
  console.log(`  ${g} (${gp.total} distractors across ${gp.questions} questions):`);
  console.log(`    uses_passage:     ${(gp.uses_passage/gp.total*100).toFixed(0)}%`);
  console.log(`    plausible_generic:${(gp.plausible_generic/gp.total*100).toFixed(0)}%`);
  console.log(`    introduces_new:   ${(gp.introduces_new/gp.total*100).toFixed(0)}%`);
  console.log(`    correct_longest:  ${(gp.correctIsLongest/gp.questions*100).toFixed(0)}% of questions`);
  console.log();
}

// ═══════════════════════════════════════════════════
// 8. TEMPORAL/CONDITIONAL LANGUAGE IN TEXTS
// ═══════════════════════════════════════════════════

console.log("━━━ 8. Temporal/Conditional Language in Texts ━━━\n");

let hasBefore = 0, hasAfter = 0, hasIf = 0, hasMust = 0, hasDeadline = 0, hasConsequence = 0;
items.forEach(i => {
  const t = i.text.toLowerCase();
  if (t.match(/\bbefore\b/)) hasBefore++;
  if (t.match(/\bafter\b/)) hasAfter++;
  if (t.match(/\bif\b/)) hasIf++;
  if (t.match(/\bmust\b|\brequired\b|\bmandatory\b/)) hasMust++;
  if (t.match(/\bdeadline\b|\bby\s+\w+\s+\d/)) hasDeadline++;
  if (t.match(/\bwill be\b.*\b(?:charged|penalized|fined|returned|removed|deactivated|donated)/)) hasConsequence++;
});
const n = items.length;
console.log(`  Contains "before":     ${hasBefore} (${(hasBefore/n*100).toFixed(0)}%)`);
console.log(`  Contains "after":      ${hasAfter} (${(hasAfter/n*100).toFixed(0)}%)`);
console.log(`  Contains "if":         ${hasIf} (${(hasIf/n*100).toFixed(0)}%)`);
console.log(`  Contains "must/required": ${hasMust} (${(hasMust/n*100).toFixed(0)}%)`);
console.log(`  Has explicit deadline: ${hasDeadline} (${(hasDeadline/n*100).toFixed(0)}%)`);
console.log(`  Has consequence clause:${hasConsequence} (${(hasConsequence/n*100).toFixed(0)}%)`);

// How many questions test temporal/conditional understanding?
const temporalQ = allQ.filter(q => q.stem.match(/before|after|if|when|deadline|happens/i)).length;
console.log(`\n  Questions testing temporal/conditional: ${temporalQ} (${(temporalQ/allQ.length*100).toFixed(1)}%)`);

// ═══════════════════════════════════════════════════
// 9. "TRICK" PATTERNS — Common traps in distractors
// ═══════════════════════════════════════════════════

console.log("\n━━━ 9. Distractor Trap Patterns ━━━\n");

let dateSwap = 0, entitySwap = 0, exaggeration = 0, partialTruth = 0;
let totalDist = 0;

allQ.forEach(q => {
  if (!q.options || !q.correct_answer || !q._text) return;
  const correct = q.options[q.correct_answer] || "";

  for (const [key, val] of Object.entries(q.options)) {
    if (key === q.correct_answer) continue;
    totalDist++;
    const d = val.toLowerCase();
    const c = correct.toLowerCase();

    // Date/time swap: distractor has a date/time that's in the passage but wrong for this question
    if (d.match(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i) ||
        d.match(/\d{1,2}:\d{2}/)) {
      if (q._text.toLowerCase().includes(d.match(/(?:january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}:\d{2})/i)?.[0] || "___NOMATCH")) {
        dateSwap++;
      }
    }

    // Entity swap: distractor mentions a person/place from the passage in wrong context
    const passageNames = (q._text.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g) || []).map(n => n.toLowerCase());
    const distNames = (val.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g) || []).map(n => n.toLowerCase());
    if (distNames.some(dn => passageNames.includes(dn))) entitySwap++;

    // Exaggeration: "all", "always", "never", "only", "every", "completely"
    if (d.match(/\b(?:all|always|never|only|every|completely|exclusively|entirely|guaranteed)\b/)) exaggeration++;

    // Partial truth: shares 60%+ words with correct but changes key detail
    const dCW = contentWords(val);
    const cCW = contentWords(correct);
    if (cCW.length > 0) {
      const overlap = dCW.filter(w => cCW.includes(w)).length / cCW.length;
      if (overlap > 0.4 && overlap < 0.9) partialTruth++;
    }
  }
});

console.log(`  Date/time swap:    ${dateSwap} (${(dateSwap/totalDist*100).toFixed(1)}%) — uses a real date from text in wrong context`);
console.log(`  Entity swap:       ${entitySwap} (${(entitySwap/totalDist*100).toFixed(1)}%) — mentions real name in wrong relationship`);
console.log(`  Exaggeration:      ${exaggeration} (${(exaggeration/totalDist*100).toFixed(1)}%) — uses absolute words (all/always/never/only)`);
console.log(`  Partial truth:     ${partialTruth} (${(partialTruth/totalDist*100).toFixed(1)}%) — shares 40-90% words with correct answer`);

// ═══════════════════════════════════════════════════
// 10. EXPLANATION ANALYSIS — How answers are justified
// ═══════════════════════════════════════════════════

console.log("\n━━━ 10. Explanation Structure Analysis ━━━\n");

let explWithQuote = 0, explWithNegation = 0, explTotal = 0;
const explLens = [];
const explStartPatterns = {};

allQ.forEach(q => {
  if (!q.explanation || q.explanation.length < 5) return;
  explTotal++;
  const e = q.explanation;
  explLens.push(wc(e));

  if (e.match(/['""']/)) explWithQuote++;
  if (e.match(/\bnot\b|\bnever\b|\bnowhere\b/i)) explWithNegation++;

  // First few words pattern
  const start = e.split(/\s+/).slice(0, 3).join(" ").toLowerCase();
  if (start.match(/^the (?:email|notice|text|post|announcement|passage)/)) explStartPatterns["The X states/mentions"] = (explStartPatterns["The X states/mentions"]||0)+1;
  else if (start.match(/^(?:sam|maria|alex|mark|ms\.|mr\.|dr\.)/i)) explStartPatterns["Person name..."] = (explStartPatterns["Person name..."]||0)+1;
  else if (start.match(/^(?:this|it|the correct)/)) explStartPatterns["This/It implies"] = (explStartPatterns["This/It implies"]||0)+1;
  else if (start.match(/^(?:since|because|as)/)) explStartPatterns["Since/Because..."] = (explStartPatterns["Since/Because..."]||0)+1;
  else explStartPatterns["Other"] = (explStartPatterns["Other"]||0)+1;
});

if (explTotal > 0) {
  const avgLen = explLens.reduce((s,v)=>s+v,0)/explLens.length;
  console.log(`  Explanations analyzed: ${explTotal}`);
  console.log(`  Avg explanation length: ${avgLen.toFixed(0)} words`);
  console.log(`  Contains quote: ${explWithQuote} (${(explWithQuote/explTotal*100).toFixed(0)}%)`);
  console.log(`  Contains negation: ${explWithNegation} (${(explWithNegation/explTotal*100).toFixed(0)}%)`);
  console.log("  Start patterns:");
  for (const [k,v] of Object.entries(explStartPatterns).sort((a,b)=>b[1]-a[1])) {
    console.log(`    ${k.padEnd(25)} ${v} (${(v/explTotal*100).toFixed(0)}%)`);
  }
}

// ═══════════════════════════════════════════════════
// 11. CROSS-QUESTION COVERAGE within same item
// ═══════════════════════════════════════════════════

console.log("\n━━━ 11. Cross-Question Coverage Within Same Item ━━━\n");

let allDifferentParts = 0, someSamePart = 0;
items.forEach(item => {
  const qs = item.questions || [];
  if (qs.length < 2) return;

  const textSents = sents(item.text);
  const qSentTargets = qs.map(q => {
    if (!q.options || !q.correct_answer) return -1;
    if (q.question_type === "main_idea") return -1;
    const aCW = contentWords(q.options[q.correct_answer] || "");
    let bestSent = -1, bestScore = 0;
    textSents.forEach((s, si) => {
      const sCW = contentWords(s);
      const score = aCW.filter(w => sCW.includes(w)).length;
      if (score > bestScore) { bestScore = score; bestSent = si; }
    });
    return bestSent;
  });

  const validTargets = qSentTargets.filter(t => t >= 0);
  if (new Set(validTargets).size === validTargets.length) allDifferentParts++;
  else someSamePart++;
});

console.log(`  All questions target different parts: ${allDifferentParts} items (${(allDifferentParts/(allDifferentParts+someSamePart)*100).toFixed(0)}%)`);
console.log(`  Some questions overlap on same part:  ${someSamePart} items (${(someSamePart/(allDifferentParts+someSamePart)*100).toFixed(0)}%)`);

// ═══════════════════════════════════════════════════
// SAVE
// ═══════════════════════════════════════════════════

const report = {
  generated_at: new Date().toISOString(),
  questionPositioning: positionBuckets,
  questionOrdering: orderedCount,
  optionInterRelationship: {
    avgPairwiseOverlap: +avgPairOverlap.toFixed(3),
    avgWordDiversity: +avgDiversity.toFixed(3),
  },
  notQuestionCount: notQuestions.length,
  answerScope: scopeCounts,
  stemSpecificity: { hasName, hasQuotedWord, referencesGenre, hasConditional },
  distractorTraps: { dateSwap, entitySwap, exaggeration, partialTruth, total: totalDist },
  temporalConditional: { hasBefore, hasAfter, hasIf, hasMust, hasDeadline, hasConsequence, temporalQ },
};

const reportPath = join(PROFILE_DIR, "rdlGapAnalysis.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport saved to: ${reportPath}`);
