#!/usr/bin/env node
/**
 * Deep analysis of LAT (Listen to an Academic Talk) reference samples.
 *
 * Analyzes 11 reference samples to extract patterns for:
 *   - Transcript structure, length, register
 *   - Question type distribution, stem patterns
 *   - Discourse marker usage
 *   - Topic/subject distribution
 *   - Answer position balance
 *   - Distractor characteristics
 *
 * Outputs: data/listening/profile/lat-deep-analysis.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const samples = JSON.parse(
  readFileSync(join(__dirname, "../data/listening/samples/lat-reference.json"), "utf-8")
).samples;

function wc(s) { return s.split(/\s+/).filter(Boolean).length; }
function avg(arr) { return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : 0; }
function median(arr) { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function pct(n, total) { return Math.round(n / total * 100); }

console.log("=== LAT Deep Analysis -- " + samples.length + " Reference Samples ===\n");

// -- 1. Transcript text analysis --
console.log("--- 1. TRANSCRIPT TEXT ---\n");

const wordCounts = samples.map(s => s.word_count || wc(s.transcript));
console.log("Word count: min=" + Math.min(...wordCounts) + " max=" + Math.max(...wordCounts) + " avg=" + avg(wordCounts) + " median=" + median(wordCounts));

const sentCounts = samples.map(s => s.transcript.split(/[.!?]+/).filter(x => x.trim().length > 5).length);
console.log("Sentence count: min=" + Math.min(...sentCounts) + " max=" + Math.max(...sentCounts) + " avg=" + avg(sentCounts));

// Structure: hook -> concept -> example -> significance
const structurePatterns = {
  starts_with_question: 0,
  starts_with_so: 0,
  starts_with_let_me: 0,
  starts_with_okay: 0,
  starts_with_other: 0,
};
for (const s of samples) {
  const first50 = s.transcript.slice(0, 60).toLowerCase();
  if (first50.includes("?")) structurePatterns.starts_with_question++;
  else if (first50.startsWith("so")) structurePatterns.starts_with_so++;
  else if (first50.startsWith("let me")) structurePatterns.starts_with_let_me++;
  else if (first50.startsWith("okay") || first50.startsWith("alright")) structurePatterns.starts_with_okay++;
  else structurePatterns.starts_with_other++;
}
console.log("\nOpening patterns:");
for (const [k, v] of Object.entries(structurePatterns)) {
  if (v > 0) console.log("  " + k + ": " + v + " (" + pct(v, samples.length) + "%)");
}

// Discourse markers
const DISCOURSE_MARKERS = ["so", "now", "actually", "let me", "here's the thing", "here's the key", "what's interesting", "what's really interesting", "okay", "alright", "right", "well", "basically"];
const dmCounts = {};
let totalDMCount = 0;
for (const s of samples) {
  const t = s.transcript.toLowerCase();
  for (const dm of DISCOURSE_MARKERS) {
    const regex = new RegExp("\\b" + dm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = t.match(regex);
    if (matches) {
      dmCounts[dm] = (dmCounts[dm] || 0) + matches.length;
      totalDMCount += matches.length;
    }
  }
}
console.log("\nDiscourse markers (total: " + totalDMCount + "):");
for (const [k, v] of Object.entries(dmCounts).sort((a, b) => b[1] - a[1])) {
  console.log("  \"" + k + "\": " + v);
}

// Register markers
const registerMarkers = {
  uses_you: 0,
  rhetorical_questions: 0,
  contractions: 0,
  real_world_examples: 0,
  has_analogy: 0,
  addresses_class: 0,
};
for (const s of samples) {
  const t = s.transcript;
  const tl = t.toLowerCase();
  if (/\byou\b/i.test(t)) registerMarkers.uses_you++;
  if ((t.match(/\?/g) || []).length > 0) registerMarkers.rhetorical_questions++;
  if (/\b(don't|isn't|it's|that's|here's|what's|you're|they're|I'm|can't|won't|didn't|doesn't|wouldn't|we're|I've|you've|I'll|there's|let's|who's|he's|she's|we've)\b/.test(t)) registerMarkers.contractions++;
  if (/\b(for example|for instance|like|such as|imagine|think about|consider)\b/i.test(t)) registerMarkers.real_world_examples++;
  if (/\b(just like|same (way|principle)|similar to|think of it as|borrowed|works the same)\b/i.test(t)) registerMarkers.has_analogy++;
  if (/\b(class|you all|everyone|folks|today we|last time|next (session|week|time)|for (next|our next))\b/i.test(t)) registerMarkers.addresses_class++;
}
console.log("\nRegister markers:");
for (const [k, v] of Object.entries(registerMarkers)) {
  console.log("  " + k + ": " + v + "/" + samples.length + " (" + pct(v, samples.length) + "%)");
}

// Topic/subject distribution
const subjectCounts = {};
samples.forEach(s => { subjectCounts[s.subject] = (subjectCounts[s.subject] || 0) + 1; });
console.log("\nSubject distribution:");
for (const [k, v] of Object.entries(subjectCounts).sort((a, b) => b[1] - a[1])) {
  console.log("  " + k + ": " + v + " (" + pct(v, samples.length) + "%)");
}

// -- 2. Question analysis --
console.log("\n--- 2. QUESTIONS ---\n");

const allQuestions = samples.flatMap(s => s.questions);
console.log("Total questions: " + allQuestions.length);

const qPerTalk = samples.map(s => s.questions.length);
console.log("Questions per talk: min=" + Math.min(...qPerTalk) + " max=" + Math.max(...qPerTalk) + " avg=" + avg(qPerTalk) + " median=" + median(qPerTalk));
const qCountDist = {};
qPerTalk.forEach(n => { qCountDist[n] = (qCountDist[n] || 0) + 1; });
console.log("  Distribution: " + JSON.stringify(qCountDist));

const qTypeCounts = {};
allQuestions.forEach(q => { qTypeCounts[q.type] = (qTypeCounts[q.type] || 0) + 1; });
console.log("\nQuestion type distribution:");
for (const [k, v] of Object.entries(qTypeCounts).sort((a, b) => b[1] - a[1])) {
  console.log("  " + k + ": " + v + " (" + pct(v, allQuestions.length) + "%)");
}

// Question position patterns
console.log("\nQuestion position patterns:");
const positionTypes = {};
for (const s of samples) {
  for (let qi = 0; qi < s.questions.length; qi++) {
    const key = "Q" + (qi + 1);
    if (!positionTypes[key]) positionTypes[key] = {};
    const t = s.questions[qi].type;
    positionTypes[key][t] = (positionTypes[key][t] || 0) + 1;
  }
}
for (const [pos, types] of Object.entries(positionTypes)) {
  console.log("  " + pos + ": " + JSON.stringify(types));
}

// Stem patterns
const stemPatterns = {};
allQuestions.forEach(q => {
  const stem = q.stem.toLowerCase();
  let pattern;
  if (stem.startsWith("what is the lecture mainly")) pattern = "What is the lecture mainly about?";
  else if (stem.startsWith("what is the main") || stem.startsWith("what is the primary")) pattern = "What is the main/primary...?";
  else if (stem.startsWith("according to the professor")) pattern = "According to the professor...?";
  else if (stem.startsWith("why does the professor mention")) pattern = "Why does the professor mention...?";
  else if (stem.startsWith("why does the professor")) pattern = "Why does the professor [verb]...?";
  else if (stem.startsWith("what does the professor say")) pattern = "What does the professor say/imply...?";
  else if (stem.startsWith("what does the professor imply")) pattern = "What does the professor imply...?";
  else if (stem.startsWith("what did")) pattern = "What did [experiment/study] show?";
  else if (stem.startsWith("what happened")) pattern = "What happened when...?";
  else if (stem.startsWith("what will")) pattern = "What will the class discuss next?";
  else if (stem.startsWith("what attitude")) pattern = "What attitude does the professor...?";
  else pattern = "Other: " + q.stem.slice(0, 50);
  stemPatterns[pattern] = (stemPatterns[pattern] || 0) + 1;
});
console.log("\nStem patterns:");
for (const [k, v] of Object.entries(stemPatterns).sort((a, b) => b[1] - a[1])) {
  console.log("  " + k + ": " + v);
}

// Answer position distribution
const answerDist = { A: 0, B: 0, C: 0, D: 0 };
allQuestions.forEach(q => { if (answerDist[q.answer] !== undefined) answerDist[q.answer]++; });
console.log("\nAnswer distribution: A=" + answerDist.A + " B=" + answerDist.B + " C=" + answerDist.C + " D=" + answerDist.D);
console.log("  Total: " + allQuestions.length);

// Option word counts
const optWcs = allQuestions.flatMap(q => ["A", "B", "C", "D"].map(k => wc(q.options[k])));
const correctWcs = allQuestions.map(q => wc(q.options[q.answer]));
const distractorWcs = allQuestions.flatMap(q => ["A", "B", "C", "D"].filter(k => k !== q.answer).map(k => wc(q.options[k])));
console.log("\nOption word counts:");
console.log("  All options: avg=" + avg(optWcs) + " min=" + Math.min(...optWcs) + " max=" + Math.max(...optWcs));
console.log("  Correct: avg=" + avg(correctWcs));
console.log("  Distractors: avg=" + avg(distractorWcs));

// Correct is longest?
let correctLongest = 0;
for (const q of allQuestions) {
  const wcs = ["A", "B", "C", "D"].map(k => wc(q.options[k]));
  const correctWc = wc(q.options[q.answer]);
  if (correctWc >= Math.max(...wcs)) correctLongest++;
}
console.log("  Correct is longest: " + correctLongest + "/" + allQuestions.length + " (" + pct(correctLongest, allQuestions.length) + "%)");

// -- 3. Transcript structure analysis --
console.log("\n--- 3. TRANSCRIPT STRUCTURE ---\n");

let hasHookIntro = 0;
let hasConceptDefined = 0;
let hasExample = 0;
let hasSignificance = 0;
let hasNextTopicPreview = 0;

for (const s of samples) {
  const t = s.transcript.toLowerCase();
  // Hook: question or engaging opener
  if (/\?/.test(t.slice(0, 100))) hasHookIntro++;
  // Concept defined: explicit naming
  if (/\b(called|known as|refers to|term|coined|this is)\b/.test(t)) hasConceptDefined++;
  // Example: experiment, analogy, illustration
  if (/\b(example|experiment|for instance|imagine|think about|study|tested|found that)\b/.test(t)) hasExample++;
  // Broader significance
  if (/\b(implication|beyond|this (means|isn't just)|so (even|whenever|next)|inspired|real-world)\b/.test(t)) hasSignificance++;
  // Next topic preview
  if (/\b(next (session|week|time|class)|we'll (discuss|look|talk)|for (next|thursday|our next))\b/.test(t)) hasNextTopicPreview++;
}
console.log("Structure elements:");
console.log("  Hook/intro (question in first 100 chars): " + hasHookIntro + "/" + samples.length + " (" + pct(hasHookIntro, samples.length) + "%)");
console.log("  Concept explicitly defined/named: " + hasConceptDefined + "/" + samples.length + " (" + pct(hasConceptDefined, samples.length) + "%)");
console.log("  Contains experiment/example: " + hasExample + "/" + samples.length + " (" + pct(hasExample, samples.length) + "%)");
console.log("  Broader significance/implication: " + hasSignificance + "/" + samples.length + " (" + pct(hasSignificance, samples.length) + "%)");
console.log("  Next topic preview: " + hasNextTopicPreview + "/" + samples.length + " (" + pct(hasNextTopicPreview, samples.length) + "%)");

// -- Save profile --
mkdirSync(join(__dirname, "../data/listening/profile"), { recursive: true });

const profile = {
  generated_at: new Date().toISOString(),
  sample_count: samples.length,
  transcript_text: {
    word_count: {
      min: Math.min(...wordCounts),
      max: Math.max(...wordCounts),
      avg: avg(wordCounts),
      median: median(wordCounts),
    },
    sentence_count: {
      min: Math.min(...sentCounts),
      max: Math.max(...sentCounts),
      avg: avg(sentCounts),
    },
    opening_patterns: structurePatterns,
    discourse_markers: dmCounts,
    discourse_markers_total: totalDMCount,
    discourse_markers_per_talk: avg(samples.map(s => {
      let count = 0;
      const tl = s.transcript.toLowerCase();
      for (const dm of DISCOURSE_MARKERS) {
        const regex = new RegExp("\\b" + dm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        const matches = tl.match(regex);
        if (matches) count += matches.length;
      }
      return count;
    })),
    register_markers: registerMarkers,
    register_marker_rates: Object.fromEntries(
      Object.entries(registerMarkers).map(([k, v]) => [k, pct(v, samples.length)])
    ),
    subject_distribution: subjectCounts,
    structure_elements: {
      hook_intro: { count: hasHookIntro, rate: pct(hasHookIntro, samples.length) },
      concept_defined: { count: hasConceptDefined, rate: pct(hasConceptDefined, samples.length) },
      example_experiment: { count: hasExample, rate: pct(hasExample, samples.length) },
      broader_significance: { count: hasSignificance, rate: pct(hasSignificance, samples.length) },
      next_topic_preview: { count: hasNextTopicPreview, rate: pct(hasNextTopicPreview, samples.length) },
    },
  },
  questions: {
    total: allQuestions.length,
    per_talk: { min: Math.min(...qPerTalk), max: Math.max(...qPerTalk), avg: avg(qPerTalk), median: median(qPerTalk), distribution: qCountDist },
    type_distribution: qTypeCounts,
    type_rates: Object.fromEntries(
      Object.entries(qTypeCounts).map(([k, v]) => [k, pct(v, allQuestions.length)])
    ),
    position_patterns: positionTypes,
    stem_patterns: stemPatterns,
    answer_distribution: answerDist,
    option_word_count: {
      all_avg: avg(optWcs),
      all_min: Math.min(...optWcs),
      all_max: Math.max(...optWcs),
      correct_avg: avg(correctWcs),
      distractor_avg: avg(distractorWcs),
    },
    correct_is_longest_rate: pct(correctLongest, allQuestions.length),
  },
};

const outPath = join(__dirname, "../data/listening/profile/lat-deep-analysis.json");
writeFileSync(outPath, JSON.stringify(profile, null, 2));
console.log("\n=== Saved to: " + outPath + " ===");
