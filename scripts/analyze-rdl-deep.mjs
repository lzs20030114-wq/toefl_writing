#!/usr/bin/env node

/**
 * Deep RDL flavor analysis — focuses on question-text mapping,
 * distractor construction, information density, and genre-specific patterns.
 *
 * Usage: node scripts/analyze-rdl-deep.mjs
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

function wc(text) { return text.trim().split(/\s+/).filter(Boolean).length; }
function tokenize(text) { return text.toLowerCase().replace(/[^a-z'\s-]/g, " ").split(/\s+/).filter(w => w.length > 1); }
function sents(text) { return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 1); }

const STOP = new Set("the a an and or but in on at to for of with by from is are was were be been being have has had do does did will would could should may might can it its this that these those they them their he she his her we our you your not no as if so than also very up out all each every both such only own into over after before between through during without who which what when where how there then".split(" "));

function contentWords(text) {
  return tokenize(text).filter(w => !STOP.has(w));
}

const items = loadAll();
const allQ = items.flatMap(i => (i.questions || []).map(q => ({ ...q, _text: i.text, _genre: i.genre, _id: i.id })));

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║   RDL Deep Flavor Analysis — 52 passages, 152 questions    ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

// ═══════════════════════════════════════════════════
// 1. CORRECT ANSWER ↔ PASSAGE MAPPING
// ═══════════════════════════════════════════════════

console.log("━━━ 1. Correct Answer ↔ Passage Text Relationship ━━━\n");

const overlapData = { detail: [], inference: [], main_idea: [], vocabulary_in_context: [] };
const paraphraseTypes = { direct_quote: 0, synonym_paraphrase: 0, synthesis: 0, meta_language: 0 };

allQ.forEach(q => {
  if (!q.correct_answer || !q.options || !q._text) return;
  const correctText = q.options[q.correct_answer] || "";
  const textContent = contentWords(q._text);
  const answerContent = contentWords(correctText);

  if (answerContent.length === 0) return;

  // Lexical overlap: what fraction of answer content words appear in the passage?
  const overlap = answerContent.filter(w => textContent.includes(w)).length;
  const ratio = overlap / answerContent.length;

  const type = q.question_type || "detail";
  if (overlapData[type]) overlapData[type].push(ratio);

  // Classify paraphrase type
  // Check for direct 3+ word sequences
  const passageLower = q._text.toLowerCase();
  const answerLower = correctText.toLowerCase();
  const answerWords = answerLower.split(/\s+/).filter(Boolean);
  let hasLongMatch = false;
  for (let i = 0; i <= answerWords.length - 3; i++) {
    const trigram = answerWords.slice(i, i + 3).join(" ");
    if (passageLower.includes(trigram)) { hasLongMatch = true; break; }
  }

  if (type === "main_idea") paraphraseTypes.meta_language++;
  else if (hasLongMatch && ratio > 0.6) paraphraseTypes.direct_quote++;
  else if (ratio > 0.4) paraphraseTypes.synonym_paraphrase++;
  else paraphraseTypes.synthesis++;
});

for (const [type, ratios] of Object.entries(overlapData)) {
  if (ratios.length === 0) continue;
  const avg = (ratios.reduce((s,v)=>s+v,0)/ratios.length*100).toFixed(1);
  const min = (Math.min(...ratios)*100).toFixed(0);
  const max = (Math.max(...ratios)*100).toFixed(0);
  console.log(`  ${type.padEnd(25)} overlap: avg=${avg}%  range=${min}-${max}%  n=${ratios.length}`);
}

const totalPT = Object.values(paraphraseTypes).reduce((s,v)=>s+v,0);
console.log("\n  Paraphrase strategy:");
for (const [k, v] of Object.entries(paraphraseTypes).sort((a,b)=>b[1]-a[1])) {
  if (v > 0) console.log(`    ${k.padEnd(22)} ${v} (${(v/totalPT*100).toFixed(0)}%)`);
}

// ═══════════════════════════════════════════════════
// 2. DISTRACTOR CONSTRUCTION (reverse-engineered)
// ═══════════════════════════════════════════════════

console.log("\n━━━ 2. Distractor Construction Analysis ━━━\n");

const distractorPatterns = {
  uses_passage_words: 0,    // borrows terms from text
  introduces_new_terms: 0,  // completely fabricated
  reverses_logic: 0,        // opposite of what passage says
  wrong_entity: 0,          // right action but wrong person/place/thing
  plausible_generic: 0,     // sounds reasonable but not in text
};
let totalDistractors = 0;

// Per-type distractor word overlap
const distractorOverlapByType = { detail: [], inference: [], main_idea: [], vocabulary_in_context: [] };

allQ.forEach(q => {
  if (!q.correct_answer || !q.options || !q._text) return;
  const textContent = contentWords(q._text);
  const type = q.question_type || "detail";

  for (const [key, optText] of Object.entries(q.options)) {
    if (key === q.correct_answer) continue;
    totalDistractors++;

    const dContent = contentWords(optText);
    if (dContent.length === 0) continue;

    const overlap = dContent.filter(w => textContent.includes(w)).length;
    const ratio = overlap / dContent.length;

    if (distractorOverlapByType[type]) distractorOverlapByType[type].push(ratio);

    if (ratio > 0.5) distractorPatterns.uses_passage_words++;
    else if (ratio < 0.15) distractorPatterns.introduces_new_terms++;
    else distractorPatterns.plausible_generic++;
  }
});

console.log(`  Total distractors analyzed: ${totalDistractors}\n`);

console.log("  Distractor-passage word overlap by question type:");
for (const [type, ratios] of Object.entries(distractorOverlapByType)) {
  if (ratios.length === 0) continue;
  const avg = (ratios.reduce((s,v)=>s+v,0)/ratios.length*100).toFixed(1);
  console.log(`    ${type.padEnd(25)} avg overlap: ${avg}%  n=${ratios.length}`);
}

console.log("\n  Distractor vocabulary strategy:");
for (const [k, v] of Object.entries(distractorPatterns).sort((a,b)=>b[1]-a[1])) {
  if (v > 0) console.log(`    ${k.padEnd(25)} ${v} (${(v/totalDistractors*100).toFixed(1)}%)`);
}

// ── Correct vs distractor overlap gap ──
console.log("\n  Correct vs distractor overlap gap (key signal for AI to match):");
for (const type of ["detail", "inference", "main_idea"]) {
  const cArr = overlapData[type] || [];
  const dArr = distractorOverlapByType[type] || [];
  if (cArr.length === 0 || dArr.length === 0) continue;
  const cAvg = (cArr.reduce((s,v)=>s+v,0)/cArr.length*100).toFixed(1);
  const dAvg = (dArr.reduce((s,v)=>s+v,0)/dArr.length*100).toFixed(1);
  console.log(`    ${type.padEnd(25)} correct=${cAvg}%  distractor=${dAvg}%  gap=${(cAvg-dAvg).toFixed(1)}pp`);
}

// ═══════════════════════════════════════════════════
// 3. INFORMATION DENSITY
// ═══════════════════════════════════════════════════

console.log("\n━━━ 3. Information Density ━━━\n");

// Count "facts" as: numbers, dates, times, proper nouns, dollar amounts, specific rules
const factCounts = [];
items.forEach(i => {
  let facts = 0;
  const t = i.text;
  facts += (t.match(/\b\d{1,2}:\d{2}\s*(?:AM|PM|a\.m\.|p\.m\.)/gi) || []).length; // times
  facts += (t.match(/\$\d+(?:\.\d{2})?/g) || []).length; // money
  facts += (t.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/gi) || []).length; // dates
  facts += (t.match(/\b(?:Room|Building|Hall|Center|Street|Avenue)\s+\w+/gi) || []).length; // locations
  facts += (t.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g) || []).length; // proper names (approx)
  facts += (t.match(/\b\d+(?:\s*(?:hours?|days?|weeks?|minutes?|percent|%))/gi) || []).length; // durations/quantities
  facts += (t.match(/[•\-\*]\s/g) || []).length; // bullet points as fact indicators
  factCounts.push({ genre: i.genre, facts, wc: wc(i.text), density: facts / wc(i.text) });
});

const avgFacts = factCounts.reduce((s,f) => s + f.facts, 0) / factCounts.length;
const avgDensity = factCounts.reduce((s,f) => s + f.density, 0) / factCounts.length;
console.log(`  Avg extractable facts/passage: ${avgFacts.toFixed(1)}`);
console.log(`  Avg fact density:              ${(avgDensity * 100).toFixed(2)} facts per 100 words`);

// By genre
const factsByGenre = {};
factCounts.forEach(f => {
  if (!factsByGenre[f.genre]) factsByGenre[f.genre] = [];
  factsByGenre[f.genre].push(f);
});
console.log("\n  Fact density by genre:");
for (const [g, arr] of Object.entries(factsByGenre).sort((a,b) => b[1].length - a[1].length)) {
  const avg = (arr.reduce((s,f) => s + f.facts, 0) / arr.length).toFixed(1);
  const den = (arr.reduce((s,f) => s + f.density, 0) / arr.length * 100).toFixed(2);
  console.log(`    ${g.padEnd(15)} avg facts=${avg}  density=${den}/100w  n=${arr.length}`);
}

// ═══════════════════════════════════════════════════
// 4. GENRE-SPECIFIC QUESTION PATTERNS
// ═══════════════════════════════════════════════════

console.log("\n━━━ 4. Genre-Specific Question Patterns ━━━\n");

const qByGenre = {};
allQ.forEach(q => {
  const g = q._genre || "other";
  if (!qByGenre[g]) qByGenre[g] = { types: {}, stems: [], correctLens: [], distractorLens: [] };
  const entry = qByGenre[g];
  const type = q.question_type || "other";
  entry.types[type] = (entry.types[type] || 0) + 1;
  entry.stems.push(q.stem);

  if (q.options && q.correct_answer) {
    entry.correctLens.push(wc(q.options[q.correct_answer] || ""));
    for (const [k, v] of Object.entries(q.options)) {
      if (k !== q.correct_answer) entry.distractorLens.push(wc(v));
    }
  }
});

for (const [g, data] of Object.entries(qByGenre).sort((a,b) => b[1].stems.length - a[1].stems.length)) {
  const total = data.stems.length;
  console.log(`  ${g} (${total} questions):`);

  // Question type breakdown
  const typeParts = Object.entries(data.types).sort((a,b)=>b[1]-a[1]).map(([t,c]) => `${t}:${c}(${(c/total*100).toFixed(0)}%)`);
  console.log(`    Types: ${typeParts.join(", ")}`);

  // Stem patterns
  const stemStarts = {};
  data.stems.forEach(s => {
    const first3 = s.split(/\s+/).slice(0, 3).join(" ").toLowerCase();
    stemStarts[first3] = (stemStarts[first3] || 0) + 1;
  });
  const topStems = Object.entries(stemStarts).sort((a,b)=>b[1]-a[1]).slice(0, 5).map(([s,c]) => `"${s}"(${c})`);
  console.log(`    Top stems: ${topStems.join(", ")}`);

  // Option lengths
  if (data.correctLens.length > 0) {
    const cAvg = (data.correctLens.reduce((s,v)=>s+v,0)/data.correctLens.length).toFixed(1);
    const dAvg = (data.distractorLens.reduce((s,v)=>s+v,0)/data.distractorLens.length).toFixed(1);
    console.log(`    Correct avg: ${cAvg}w  Distractor avg: ${dAvg}w  gap: ${(cAvg-dAvg).toFixed(1)}w`);
  }
  console.log();
}

// ═══════════════════════════════════════════════════
// 5. TEXT OPENING & CLOSING PATTERNS
// ═══════════════════════════════════════════════════

console.log("━━━ 5. Text Opening & Closing Patterns ━━━\n");

const openings = { subject_line: 0, dear_greeting: 0, hi_greeting: 0, title_header: 0, direct_statement: 0 };
const closings = { sign_off_name: 0, contact_info: 0, url_link: 0, call_to_action: 0, deadline_reminder: 0 };

items.forEach(i => {
  const t = i.text;
  const firstLine = t.split("\n")[0].trim();

  if (firstLine.match(/^Subject:/i)) openings.subject_line++;
  else if (firstLine.match(/^Dear\s/i)) openings.dear_greeting++;
  else if (firstLine.match(/^(?:Hi|Hello|Hey)\s/i)) openings.hi_greeting++;
  else if (firstLine.match(/^[A-Z].*(?:Notice|Update|Announcement|Schedule|Menu|Memo|Policy|Guide|Reminder|Welcome|Important)/i)) openings.title_header++;
  else openings.direct_statement++;

  const lastLines = t.split("\n").slice(-5).join(" ").toLowerCase();
  if (lastLines.match(/(?:best|regards|sincerely|warmly|thanks|cheers),?\s*\n?\s*[a-z]/i)) closings.sign_off_name++;
  if (lastLines.match(/(?:email|contact|call|visit|reply|reach)/i)) closings.contact_info++;
  if (lastLines.match(/(?:www\.|\.edu|\.com|\.org|http)/i)) closings.url_link++;
  if (lastLines.match(/(?:sign up|register|rsvp|join us|don't miss|be sure)/i)) closings.call_to_action++;
  if (lastLines.match(/(?:by\s+(?:may|june|april|december|january|september)|deadline|before\s+\w+\s+\d)/i)) closings.deadline_reminder++;
});

console.log("  Opening patterns:");
for (const [k, v] of Object.entries(openings).sort((a,b)=>b[1]-a[1])) {
  if (v > 0) console.log(`    ${k.padEnd(20)} ${v} (${(v/items.length*100).toFixed(0)}%)`);
}
console.log("\n  Closing patterns:");
for (const [k, v] of Object.entries(closings).sort((a,b)=>b[1]-a[1])) {
  if (v > 0) console.log(`    ${k.padEnd(20)} ${v} (${(v/items.length*100).toFixed(0)}%)`);
}

// ═══════════════════════════════════════════════════
// 6. VOCABULARY PROFILE
// ═══════════════════════════════════════════════════

console.log("\n━━━ 6. Vocabulary Profile ━━━\n");

// Most common content words across all texts
const wordFreq = {};
items.forEach(i => {
  const cw = contentWords(i.text);
  cw.forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });
});

const topWords = Object.entries(wordFreq).sort((a,b) => b[1] - a[1]).slice(0, 40);
console.log("  Top 40 content words across all RDL texts:");
const chunks = [];
for (let i = 0; i < topWords.length; i += 5) {
  chunks.push(topWords.slice(i, i + 5).map(([w, c]) => `${w}(${c})`).join(", "));
}
chunks.forEach(c => console.log(`    ${c}`));

// Campus-specific vocabulary
const CAMPUS_WORDS = new Set([
  "campus", "student", "students", "university", "semester", "dorm", "dormitory",
  "library", "bookstore", "locker", "lockers", "registration", "enrolled",
  "professor", "instructor", "course", "class", "classes", "academic",
  "lab", "laboratory", "workshop", "studio", "recreation", "gym",
  "dining", "cafeteria", "meal", "resident", "housing", "hall",
  "fee", "tuition", "credit", "credits", "id", "keycard", "card",
  "volunteer", "volunteers", "shift", "advisor", "office",
]);

let campusWordCount = 0, totalContentCount = 0;
items.forEach(i => {
  const cw = contentWords(i.text);
  totalContentCount += cw.length;
  campusWordCount += cw.filter(w => CAMPUS_WORDS.has(w)).length;
});
console.log(`\n  Campus vocabulary density: ${(campusWordCount/totalContentCount*100).toFixed(1)}% of content words`);

// ═══════════════════════════════════════════════════
// 7. QUESTION STEM VERB ANALYSIS
// ═══════════════════════════════════════════════════

console.log("\n━━━ 7. Question Stem Verb/Action Patterns ━━━\n");

const stemVerbs = {};
allQ.forEach(q => {
  const s = q.stem.toLowerCase();
  // Extract the main action verb pattern
  const patterns = [
    [/what must .* do/, "what must X do"],
    [/what should .* do/, "what should X do"],
    [/what does .* ask/, "what does X ask"],
    [/what will happen/, "what will happen"],
    [/what can be inferred/, "what can be inferred"],
    [/what is the main purpose/, "what is the main purpose"],
    [/what is the primary purpose/, "what is the primary purpose"],
    [/what is one (?:benefit|advantage|privilege)/, "what is one benefit of"],
    [/what is provided/, "what is provided"],
    [/what is (?:implied|suggested)/, "what is implied/suggested"],
    [/which .* (?:not|NOT)/, "which is NOT"],
    [/why does .* mention/, "why does X mention"],
    [/according to/, "according to the X"],
    [/closest in meaning/, "word closest in meaning"],
    [/most nearly means/, "word most nearly means"],
    [/how can|how should/, "how can/should X"],
    [/what is .* policy/, "what is the policy on"],
    [/what (?:are|is) .* expected/, "what is X expected to"],
    [/where (?:will|should|is|are)/, "where will/should X"],
    [/when (?:will|should|is|are|must)/, "when will/should X"],
  ];

  let matched = false;
  for (const [re, label] of patterns) {
    if (re.test(s)) {
      stemVerbs[label] = (stemVerbs[label] || 0) + 1;
      matched = true;
      break;
    }
  }
  if (!matched) stemVerbs["other"] = (stemVerbs["other"] || 0) + 1;
});

for (const [v, c] of Object.entries(stemVerbs).sort((a,b) => b[1] - a[1])) {
  console.log(`  ${v.padEnd(30)} ${c} (${(c/allQ.length*100).toFixed(1)}%)`);
}

// ═══════════════════════════════════════════════════
// 8. ANSWER EXPLANATION PATTERNS
// ═══════════════════════════════════════════════════

console.log("\n━━━ 8. Explanation Language Patterns ━━━\n");

const explVerbs = {};
allQ.forEach(q => {
  if (!q.explanation) return;
  const e = q.explanation.toLowerCase();
  const patterns = [
    [/the (?:email|notice|text|post|passage|announcement|schedule|menu|syllabus) (?:states|says)/, "the X states/says"],
    [/the (?:email|notice|text|post) mentions/, "the X mentions"],
    [/(?:it|this) (?:states|says|mentions|indicates)/, "it states/says"],
    [/implies|implying|implied/, "implies/implying"],
    [/(?:never|not|no) (?:mentioned|stated|included)/, "not mentioned"],
    [/can be inferred/, "can be inferred"],
    [/(?:directly|explicitly) stated/, "directly stated"],
  ];

  for (const [re, label] of patterns) {
    if (re.test(e)) {
      explVerbs[label] = (explVerbs[label] || 0) + 1;
    }
  }
});

for (const [v, c] of Object.entries(explVerbs).sort((a,b) => b[1] - a[1])) {
  console.log(`  ${v.padEnd(25)} ${c}`);
}

// ═══════════════════════════════════════════════════
// SAVE REPORT
// ═══════════════════════════════════════════════════

const report = {
  generated_at: new Date().toISOString(),
  sample_count: items.length,
  question_count: allQ.length,
  correctAnswerOverlap: Object.fromEntries(
    Object.entries(overlapData).map(([k, arr]) => [k, arr.length > 0 ? {
      avg: +(arr.reduce((s,v)=>s+v,0)/arr.length).toFixed(3),
      min: +Math.min(...arr).toFixed(3),
      max: +Math.max(...arr).toFixed(3),
      n: arr.length,
    } : null]).filter(([,v]) => v)
  ),
  paraphraseTypes,
  distractorOverlap: Object.fromEntries(
    Object.entries(distractorOverlapByType).map(([k, arr]) => [k, arr.length > 0 ? {
      avg: +(arr.reduce((s,v)=>s+v,0)/arr.length).toFixed(3),
      n: arr.length,
    } : null]).filter(([,v]) => v)
  ),
  informationDensity: {
    avgFactsPerPassage: +avgFacts.toFixed(1),
    avgDensityPer100Words: +(avgDensity * 100).toFixed(2),
  },
  topContentWords: topWords.slice(0, 20).map(([w, c]) => ({ word: w, count: c })),
  campusVocabularyDensity: +(campusWordCount/totalContentCount).toFixed(3),
};

const reportPath = join(PROFILE_DIR, "rdlDeepFlavor.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nFull report saved to: ${reportPath}`);
