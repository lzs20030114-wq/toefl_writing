#!/usr/bin/env node
/**
 * Deep analysis of LA (Listen to an Announcement) reference samples.
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const samples = JSON.parse(readFileSync(join(__dirname, "../data/listening/samples/la-reference.json"), "utf-8")).samples;

function wc(s) { return s.split(/\s+/).filter(Boolean).length; }
function avg(arr) { return arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length*10)/10 : 0; }
function pct(n, total) { return Math.round(n/total*100); }

console.log("═══ LA Deep Analysis — " + samples.length + " Reference Samples ═══\n");

// ── 1. Announcement text analysis ──
console.log("─── 1. ANNOUNCEMENT TEXT ───\n");

const wordCounts = samples.map(s => s.word_count || wc(s.announcement));
console.log("Word count: min=" + Math.min(...wordCounts) + " max=" + Math.max(...wordCounts) + " avg=" + avg(wordCounts) + " median=" + wordCounts.sort((a,b)=>a-b)[Math.floor(wordCounts.length/2)]);

const sentCounts = samples.map(s => s.announcement.split(/[.!?]+/).filter(x => x.trim().length > 5).length);
console.log("Sentence count: min=" + Math.min(...sentCounts) + " max=" + Math.max(...sentCounts) + " avg=" + avg(sentCounts));

// Opening patterns
const openings = samples.map(s => {
  const first20 = s.announcement.slice(0, 50).toLowerCase();
  if (first20.startsWith("attention")) return "Attention...";
  if (first20.startsWith("good")) return "Good morning/afternoon...";
  if (first20.startsWith("this is")) return "This is a reminder...";
  return "Other: " + s.announcement.slice(0, 30);
});
const openingCounts = {};
openings.forEach(o => openingCounts[o] = (openingCounts[o] || 0) + 1);
console.log("\nOpening patterns:");
for (const [k, v] of Object.entries(openingCounts).sort((a,b)=>b[1]-a[1])) {
  console.log("  " + k + ": " + v + " (" + pct(v, samples.length) + "%)");
}

// Context/topic distribution
const contextCounts = {};
samples.forEach(s => { contextCounts[s.context] = (contextCounts[s.context] || 0) + 1; });
console.log("\nContext distribution:");
for (const [k, v] of Object.entries(contextCounts).sort((a,b)=>b[1]-a[1])) {
  console.log("  " + k + ": " + v + " (" + pct(v, samples.length) + "%)");
}

// Speaker role
const roleCounts = {};
samples.forEach(s => { roleCounts[s.speaker_role] = (roleCounts[s.speaker_role] || 0) + 1; });
console.log("\nSpeaker roles:");
for (const [k, v] of Object.entries(roleCounts).sort((a,b)=>b[1]-a[1])) {
  console.log("  " + k + ": " + v + " (" + pct(v, samples.length) + "%)");
}

// Key information types embedded
let hasDate = 0, hasTime = 0, hasLocation = 0, hasDeadline = 0, hasRequirement = 0, hasContact = 0;
for (const s of samples) {
  const t = s.announcement.toLowerCase();
  if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|march|april|january|february)\b/.test(t)) hasDate++;
  if (/\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?|am|pm)\b/i.test(s.announcement)) hasTime++;
  if (/\b(building|hall|room|center|auditorium|lounge|atrium|studio|office|lot)\b/.test(t)) hasLocation++;
  if (/\b(deadline|by\s+(friday|thursday|march|april)|must be submitted|due)\b/.test(t)) hasDeadline++;
  if (/\b(required|must|please (note|ensure|bring|be aware)|you (are|will) (need|be required))\b/.test(t)) hasRequirement++;
  if (/\b(website|portal|sign up|register|email|call)\b/.test(t)) hasContact++;
}
console.log("\nInformation types embedded:");
console.log("  Has specific date: " + hasDate + "/" + samples.length + " (" + pct(hasDate, samples.length) + "%)");
console.log("  Has specific time: " + hasTime + "/" + samples.length + " (" + pct(hasTime, samples.length) + "%)");
console.log("  Has location: " + hasLocation + "/" + samples.length + " (" + pct(hasLocation, samples.length) + "%)");
console.log("  Has deadline: " + hasDeadline + "/" + samples.length + " (" + pct(hasDeadline, samples.length) + "%)");
console.log("  Has requirement: " + hasRequirement + "/" + samples.length + " (" + pct(hasRequirement, samples.length) + "%)");
console.log("  Has action channel: " + hasContact + "/" + samples.length + " (" + pct(hasContact, samples.length) + "%)");

// ── 2. Question analysis ──
console.log("\n─── 2. QUESTIONS ───\n");

const allQuestions = samples.flatMap(s => s.questions);
console.log("Total questions: " + allQuestions.length);
console.log("Questions per announcement: " + avg(samples.map(s => s.questions.length)));

const qTypeCounts = {};
allQuestions.forEach(q => { qTypeCounts[q.type] = (qTypeCounts[q.type] || 0) + 1; });
console.log("\nQuestion type distribution:");
for (const [k, v] of Object.entries(qTypeCounts).sort((a,b)=>b[1]-a[1])) {
  console.log("  " + k + ": " + v + " (" + pct(v, allQuestions.length) + "%)");
}

// Question stem patterns
const stemPatterns = {};
allQuestions.forEach(q => {
  const stem = q.stem.toLowerCase();
  let pattern;
  if (stem.startsWith("what is the main") || stem.startsWith("what is the primary")) pattern = "What is the main/primary purpose...";
  else if (stem.startsWith("what can be inferred")) pattern = "What can be inferred...";
  else if (stem.startsWith("what must") || stem.startsWith("what should")) pattern = "What must/should students do...";
  else if (stem.startsWith("what is")) pattern = "What is [specific detail]...";
  else if (stem.startsWith("what are")) pattern = "What are [detail]...";
  else if (stem.startsWith("how")) pattern = "How [method/process]...";
  else if (stem.startsWith("why")) pattern = "Why [reason]...";
  else if (stem.startsWith("which")) pattern = "Which [specific item]...";
  else if (stem.startsWith("who")) pattern = "Who [person]...";
  else pattern = "Other: " + q.stem.slice(0, 40);
  stemPatterns[pattern] = (stemPatterns[pattern] || 0) + 1;
});
console.log("\nQuestion stem patterns:");
for (const [k, v] of Object.entries(stemPatterns).sort((a,b)=>b[1]-a[1])) {
  console.log("  " + k + ": " + v);
}

// Answer position distribution
const answerDist = { A: 0, B: 0, C: 0, D: 0 };
allQuestions.forEach(q => { if (answerDist[q.answer] !== undefined) answerDist[q.answer]++; });
console.log("\nAnswer distribution: A=" + answerDist.A + " B=" + answerDist.B + " C=" + answerDist.C + " D=" + answerDist.D);

// Option word count
const optWcs = allQuestions.flatMap(q => ["A","B","C","D"].map(k => wc(q.options[k])));
const correctWcs = allQuestions.map(q => wc(q.options[q.answer]));
const distractorWcs = allQuestions.flatMap(q => ["A","B","C","D"].filter(k=>k!==q.answer).map(k => wc(q.options[k])));
console.log("\nOption word counts:");
console.log("  All options: avg=" + avg(optWcs) + " min=" + Math.min(...optWcs) + " max=" + Math.max(...optWcs));
console.log("  Correct: avg=" + avg(correctWcs));
console.log("  Distractors: avg=" + avg(distractorWcs));

// Correct is longest?
let correctLongest = 0;
for (const q of allQuestions) {
  const wcs = ["A","B","C","D"].map(k => wc(q.options[k]));
  const correctWc = wc(q.options[q.answer]);
  if (correctWc >= Math.max(...wcs)) correctLongest++;
}
console.log("  Correct is longest: " + correctLongest + "/" + allQuestions.length + " (" + pct(correctLongest, allQuestions.length) + "%)");

// ── 3. Q1 vs Q2 pattern ──
console.log("\n─── 3. Q1 vs Q2 PATTERN ───\n");

const q1Types = {}, q2Types = {};
for (const s of samples) {
  if (s.questions[0]) q1Types[s.questions[0].type] = (q1Types[s.questions[0].type] || 0) + 1;
  if (s.questions[1]) q2Types[s.questions[1].type] = (q2Types[s.questions[1].type] || 0) + 1;
}
console.log("Q1 types: " + JSON.stringify(q1Types));
console.log("Q2 types: " + JSON.stringify(q2Types));

// ── Save profile ──
const profile = {
  generated_at: new Date().toISOString(),
  sample_count: samples.length,
  announcement_text: {
    word_count: { min: Math.min(...wordCounts), max: Math.max(...wordCounts), avg: avg(wordCounts), median: wordCounts.sort((a,b)=>a-b)[Math.floor(wordCounts.length/2)] },
    sentence_count: { min: Math.min(...sentCounts), max: Math.max(...sentCounts), avg: avg(sentCounts) },
    opening_patterns: openingCounts,
    context_distribution: contextCounts,
    speaker_roles: roleCounts,
    info_types: { date: hasDate, time: hasTime, location: hasLocation, deadline: hasDeadline, requirement: hasRequirement, action_channel: hasContact },
    info_type_rates: { date: pct(hasDate,samples.length), time: pct(hasTime,samples.length), location: pct(hasLocation,samples.length), deadline: pct(hasDeadline,samples.length), requirement: pct(hasRequirement,samples.length), action_channel: pct(hasContact,samples.length) },
  },
  questions: {
    total: allQuestions.length,
    per_announcement: avg(samples.map(s => s.questions.length)),
    type_distribution: qTypeCounts,
    stem_patterns: stemPatterns,
    answer_distribution: answerDist,
    option_word_count: { all_avg: avg(optWcs), correct_avg: avg(correctWcs), distractor_avg: avg(distractorWcs) },
    correct_is_longest_rate: pct(correctLongest, allQuestions.length),
    q1_types: q1Types,
    q2_types: q2Types,
  },
};

const outPath = join(__dirname, "../data/listening/profile/la-deep-analysis.json");
writeFileSync(outPath, JSON.stringify(profile, null, 2));
console.log("\n═══ Saved to: " + outPath + " ═══");
