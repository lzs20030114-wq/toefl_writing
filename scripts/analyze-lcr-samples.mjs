#!/usr/bin/env node

/**
 * Deep analysis of LCR reference samples.
 * Produces multi-dimensional quantitative profile for prompt builder calibration.
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const samples = JSON.parse(readFileSync(join(__dirname, "../data/listening/samples/lcr-reference.json"), "utf-8")).samples;

// ────────────────────────────────────────────────────────────
// Utility functions
// ────────────────────────────────────────────────────────────

function wordCount(s) { return s.split(/\s+/).filter(Boolean).length; }
function charCount(s) { return s.replace(/\s/g, "").length; }
function avgWordLen(s) { const ws = s.split(/\s+/).filter(Boolean); return ws.reduce((a, w) => a + w.replace(/[^a-zA-Z]/g, "").length, 0) / ws.length; }
function hasContraction(s) { return /\b\w+'\w+\b/.test(s); }
function endsWithQuestion(s) { return s.trim().endsWith("?"); }
function startsWithI(s) { return /^I[\s']/i.test(s.trim()); }
function getFirstWord(s) { return s.trim().split(/\s+/)[0].replace(/[^a-zA-Z]/g, ""); }

// Discourse markers
const DISCOURSE_MARKERS = [
  "actually", "well", "as a matter of fact", "how about", "maybe",
  "absolutely", "don't worry", "excuse me", "i'm afraid", "oh",
  "let's", "sure", "right", "okay", "so", "just", "honestly",
  "by the way", "you know", "i mean", "look", "listen",
];

function hasDiscourseMarker(s) {
  const lower = s.toLowerCase();
  return DISCOURSE_MARKERS.some(m => lower.startsWith(m) || lower.includes(", " + m));
}
function findDiscourseMarker(s) {
  const lower = s.toLowerCase();
  return DISCOURSE_MARKERS.find(m => lower.startsWith(m) || lower.includes(", " + m)) || null;
}

// Idioms
const IDIOMS = [
  "i'm all ears", "as a matter of fact", "don't worry about it",
  "how about", "absolutely", "i can't tell the difference",
  "so am i", "nearly missed", "i didn't make it",
];
function hasIdiom(s) {
  const lower = s.toLowerCase();
  return IDIOMS.some(id => lower.includes(id));
}

// Shared words between two strings
function sharedContentWords(a, b) {
  const STOP = new Set(["i", "a", "an", "the", "is", "am", "are", "was", "were", "be", "been",
    "do", "does", "did", "have", "has", "had", "will", "would", "can", "could",
    "should", "shall", "may", "might", "must", "to", "of", "in", "on", "at",
    "for", "with", "by", "from", "not", "no", "yes", "it", "that", "this",
    "my", "your", "his", "her", "its", "our", "their", "you", "me", "him",
    "them", "we", "they", "and", "or", "but", "if", "so", "than", "just",
    "about", "up", "out", "don't", "didn't", "isn't", "wasn't", "aren't"]);
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z\s']/g, "").split(/\s+/).filter(w => !STOP.has(w) && w.length > 2));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z\s']/g, "").split(/\s+/).filter(w => !STOP.has(w) && w.length > 2));
  const shared = [...wordsA].filter(w => wordsB.has(w));
  return shared;
}

// Semantic field — rough word association clustering
function getSemanticField(word) {
  const fields = {
    time: ["time", "hour", "minute", "morning", "afternoon", "evening", "night", "tomorrow", "yesterday", "today", "early", "late", "schedule", "available", "soon"],
    location: ["library", "school", "airport", "bus", "stop", "office", "corner", "floor", "section", "post"],
    academic: ["class", "course", "homework", "presentation", "professor", "chemistry", "exam", "grade", "book", "reading"],
    food: ["lunch", "hungry", "sandwich", "cafeteria", "eat", "coffee", "snack"],
    social: ["concert", "ticket", "friend", "invite", "plan", "party"],
    tech: ["printer", "scan", "print", "ink", "computer", "chat", "online", "service"],
    travel: ["flight", "seat", "delayed", "weather", "subway", "pick"],
  };
  const lower = word.toLowerCase();
  for (const [field, words] of Object.entries(fields)) {
    if (words.some(w => lower.includes(w))) return field;
  }
  return "general";
}

// Speech act classification
function classifySpeechAct(s) {
  const lower = s.toLowerCase();
  if (/^(how about|what about|why don't|maybe|perhaps|let's)/.test(lower)) return "suggesting";
  if (/^(i can|i'll|don't worry|let me)/.test(lower)) return "offering_help";
  if (/^(yes|no|actually|as a matter|well,? i)/.test(lower)) return "responding";
  if (/^(use |go to|check |call |try )/.test(lower)) return "instructing";
  if (/\?$/.test(s.trim())) return "questioning";
  if (/^(i'm |i was |i have |it ran|it opens|it's )/.test(lower)) return "informing";
  if (/^(absolutely|sure|okay|right)/.test(lower)) return "affirming";
  if (/^(i understand|i see|okay|well)/.test(lower)) return "acknowledging";
  return "other";
}

// Speaker intent classification
function classifySpeakerIntent(s) {
  const lower = s.toLowerCase();
  if (/^(where|how do i|how can i|what time|when)/.test(lower)) return "seeking_information";
  if (/^(do you want|would you like|shall we)/.test(lower)) return "inviting";
  if (/^(are you done|could you|can you|i need)/.test(lower)) return "requesting";
  if (/^(didn't i|isn't |aren't|wasn't)/.test(lower)) return "seeking_confirmation";
  if (/^(i'm afraid|i'm not available|i'm not)/.test(lower)) return "declining_or_unavailable";
  if (/^(i'm thinking|i have to tell|how did)/.test(lower)) return "sharing_or_prompting";
  if (/^(are you going|do you know)/.test(lower)) return "checking";
  if (/^(excuse me)/.test(lower)) return "polite_inquiry";
  return "other";
}

// ────────────────────────────────────────────────────────────
// Main analysis
// ────────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════");
console.log("  LCR Deep Analysis — 16 Reference Samples");
console.log("═══════════════════════════════════════════════════════════\n");

const analysis = {
  generated_at: new Date().toISOString(),
  sample_count: samples.length,
};

// ── A. DISTRACTOR DEEP DIVE ──────────────────────────────────

console.log("─── A. DISTRACTOR DEEP DIVE ───\n");

const distractorData = [];
const wordTrapDetails = [];
const distractorLexicalOverlap = [];

for (const item of samples) {
  const speakerWords = item.speaker.toLowerCase().replace(/[^a-z\s']/g, "").split(/\s+/).filter(Boolean);
  const answerKeys = ["A", "B", "C", "D"];

  for (const key of answerKeys) {
    if (key === item.answer) continue; // skip correct answer

    const optText = item.options[key];
    const shared = sharedContentWords(item.speaker, optText);
    const optWc = wordCount(optText);
    const optAvgWl = avgWordLen(optText);
    const hasDM = hasDiscourseMarker(optText);
    const hasContr = hasContraction(optText);
    const speechAct = classifySpeechAct(optText);
    const distType = item.distractor_analysis?.[key]?.split("—")[0]?.trim() || "unknown";

    const entry = {
      item_id: item.id,
      key,
      text: optText,
      word_count: optWc,
      avg_word_length: Math.round(optAvgWl * 10) / 10,
      has_discourse_marker: hasDM,
      has_contraction: hasContr,
      speech_act: speechAct,
      distractor_type: distType,
      shared_content_words_with_speaker: shared,
      lexical_overlap_count: shared.length,
    };

    distractorData.push(entry);

    if (shared.length > 0) {
      wordTrapDetails.push({
        item_id: item.id,
        speaker_snippet: item.speaker.slice(0, 50),
        distractor_key: key,
        distractor_text: optText,
        shared_words: shared,
        trap_mechanism: shared.length >= 2 ? "multi_word_association" : "single_word_echo",
      });
    }
  }
}

// Distractor type breakdown
const distTypeCount = {};
for (const d of distractorData) {
  distTypeCount[d.distractor_type] = (distTypeCount[d.distractor_type] || 0) + 1;
}
console.log("Distractor type distribution (48 total distractors):");
for (const [type, count] of Object.entries(distTypeCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type}: ${count} (${Math.round(count / 48 * 100)}%)`);
}

// Lexical overlap analysis
const overlapCounts = distractorData.map(d => d.lexical_overlap_count);
const withOverlap = overlapCounts.filter(c => c > 0).length;
console.log(`\nLexical overlap with speaker sentence:`);
console.log(`  Distractors with ≥1 shared content word: ${withOverlap}/48 (${Math.round(withOverlap / 48 * 100)}%)`);
console.log(`  Word trap details: ${wordTrapDetails.length} instances`);

// Distractor speech act
const distSpeechActs = {};
for (const d of distractorData) {
  distSpeechActs[d.speech_act] = (distSpeechActs[d.speech_act] || 0) + 1;
}
console.log(`\nDistractor speech acts:`);
for (const [act, count] of Object.entries(distSpeechActs).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${act}: ${count}`);
}

// Distractor word count stats
const distWcs = distractorData.map(d => d.word_count);
console.log(`\nDistractor word count: min=${Math.min(...distWcs)} max=${Math.max(...distWcs)} avg=${(distWcs.reduce((a,b)=>a+b,0)/distWcs.length).toFixed(1)}`);

// ── B. CORRECT ANSWER PARADIGMS ──────────────────────────────

console.log("\n─── B. CORRECT ANSWER PARADIGMS ───\n");

const answerParadigms = [];

for (const item of samples) {
  const correctText = item.options[item.answer];
  const speakerIntent = classifySpeakerIntent(item.speaker);
  const answerAct = classifySpeechAct(correctText);
  const shared = sharedContentWords(item.speaker, correctText);
  const dm = findDiscourseMarker(correctText);
  const isQuestion = endsWithQuestion(correctText);

  // Determine response strategy
  let strategy;
  if (shared.length > 0 && !isQuestion) strategy = "direct_topical";
  else if (isQuestion) strategy = "counter_question";
  else if (hasIdiom(correctText)) strategy = "idiomatic";
  else if (dm) strategy = "marker_led_indirect";
  else if (wordCount(correctText) <= 2) strategy = "minimal_response";
  else strategy = "context_shift";

  answerParadigms.push({
    item_id: item.id,
    speaker_intent: speakerIntent,
    speaker_sentence_type: endsWithQuestion(item.speaker) ? "question" : "statement",
    correct_text: correctText,
    correct_speech_act: answerAct,
    correct_word_count: wordCount(correctText),
    response_strategy: strategy,
    discourse_marker: dm,
    is_question: isQuestion,
    shares_content_words: shared.length > 0,
    shared_words: shared,
    has_idiom: hasIdiom(correctText),
    has_contraction: hasContraction(correctText),
    first_word: getFirstWord(correctText),
    pragmatic_function: item.pragmatic_function,
  });
}

// Speaker intent → answer strategy mapping
console.log("Speaker Intent → Answer Strategy mapping:");
const intentStrategyMap = {};
for (const p of answerParadigms) {
  const key = `${p.speaker_intent} → ${p.response_strategy}`;
  intentStrategyMap[key] = (intentStrategyMap[key] || 0) + 1;
}
for (const [k, v] of Object.entries(intentStrategyMap).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}

// Response strategy distribution
const stratCount = {};
for (const p of answerParadigms) {
  stratCount[p.response_strategy] = (stratCount[p.response_strategy] || 0) + 1;
}
console.log(`\nResponse strategy distribution:`);
for (const [s, c] of Object.entries(stratCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${s}: ${c} (${Math.round(c / 16 * 100)}%)`);
}

// First word of correct answer
const firstWords = {};
for (const p of answerParadigms) {
  firstWords[p.first_word] = (firstWords[p.first_word] || 0) + 1;
}
console.log(`\nFirst word of correct answers:`);
for (const [w, c] of Object.entries(firstWords).sort((a, b) => b[1] - a[1])) {
  console.log(`  "${w}": ${c}`);
}

// Counter-questions in correct answers
const counterQs = answerParadigms.filter(p => p.is_question);
console.log(`\nCorrect answers that are questions: ${counterQs.length}/16 (${Math.round(counterQs.length/16*100)}%)`);
for (const q of counterQs) {
  console.log(`  ${q.item_id}: "${q.correct_text}"`);
}

// ── C. OPTION INTERPLAY (within each item) ───────────────────

console.log("\n─── C. OPTION INTERPLAY ───\n");

const interplayData = [];

for (const item of samples) {
  const opts = ["A", "B", "C", "D"].map(k => ({
    key: k,
    text: item.options[k],
    isCorrect: k === item.answer,
    wc: wordCount(item.options[k]),
    sharedWithSpeaker: sharedContentWords(item.speaker, item.options[k]).length,
    speechAct: classifySpeechAct(item.options[k]),
    hasDM: hasDiscourseMarker(item.options[k]),
    startsWithI: startsWithI(item.options[k]),
  }));

  // How many options share words with speaker?
  const optsSharingSpeakerWords = opts.filter(o => o.sharedWithSpeaker > 0).length;

  // Unique speech acts across options
  const uniqueActs = new Set(opts.map(o => o.speechAct)).size;

  // Word count variance
  const wcs = opts.map(o => o.wc);
  const wcRange = Math.max(...wcs) - Math.min(...wcs);
  const correctRank = wcs.filter(w => w < opts.find(o => o.isCorrect).wc).length + 1; // 1=shortest

  interplayData.push({
    item_id: item.id,
    options_sharing_speaker_words: optsSharingSpeakerWords,
    unique_speech_acts: uniqueActs,
    word_count_range: wcRange,
    correct_wc_rank: correctRank, // 1=shortest, 4=longest
    all_start_with_I: opts.every(o => o.startsWithI),
    discourse_marker_count: opts.filter(o => o.hasDM).length,
  });
}

console.log("Option interplay patterns:");
const avgSharing = interplayData.reduce((a, d) => a + d.options_sharing_speaker_words, 0) / interplayData.length;
console.log(`  Avg options sharing words with speaker: ${avgSharing.toFixed(1)}/4`);
const avgUniqueActs = interplayData.reduce((a, d) => a + d.unique_speech_acts, 0) / interplayData.length;
console.log(`  Avg unique speech acts per item: ${avgUniqueActs.toFixed(1)}/4`);
const avgWcRange = interplayData.reduce((a, d) => a + d.word_count_range, 0) / interplayData.length;
console.log(`  Avg word count range within item: ${avgWcRange.toFixed(1)} words`);

const correctRankDist = { 1: 0, 2: 0, 3: 0, 4: 0 };
for (const d of interplayData) correctRankDist[d.correct_wc_rank]++;
console.log(`  Correct answer length rank: shortest=${correctRankDist[1]} 2nd=${correctRankDist[2]} 3rd=${correctRankDist[3]} longest=${correctRankDist[4]}`);

// ── D. CONVERSATION LOGIC CHAIN ─────────────────────────────

console.log("\n─── D. CONVERSATION LOGIC CHAIN ───\n");

const conversationLogic = [];

for (const item of samples) {
  const correctText = item.options[item.answer];

  // What type of conversational move does the correct answer make?
  let moveType;
  if (endsWithQuestion(correctText)) moveType = "advance_by_questioning";
  else if (/i('ll| will| can)/.test(correctText.toLowerCase())) moveType = "advance_by_offering";
  else if (/maybe|perhaps|how about|why don't/i.test(correctText)) moveType = "advance_by_suggesting";
  else if (/^(yes|no|actually|well|i understand|absolutely)/i.test(correctText)) moveType = "respond_then_elaborate";
  else if (/it (ran|opens|was|is|starts)/i.test(correctText)) moveType = "provide_factual_info";
  else moveType = "acknowledge_and_redirect";

  // Does the answer create a natural next turn?
  // i.e., could the speaker naturally say something after this answer?
  const enablesNextTurn = moveType === "advance_by_questioning" || moveType === "advance_by_suggesting" || moveType === "advance_by_offering";

  // Politeness level
  let politeness;
  if (/please|thank|appreciate|excuse/i.test(correctText)) politeness = "formal_polite";
  else if (/don't worry|i understand|sure|maybe/i.test(correctText)) politeness = "casual_warm";
  else if (/absolutely|i'm all ears/i.test(correctText)) politeness = "enthusiastic";
  else politeness = "neutral";

  conversationLogic.push({
    item_id: item.id,
    speaker: item.speaker.slice(0, 40) + "...",
    correct: correctText,
    move_type: moveType,
    enables_next_turn: enablesNextTurn,
    politeness_level: politeness,
  });
}

const moveTypes = {};
for (const c of conversationLogic) {
  moveTypes[c.move_type] = (moveTypes[c.move_type] || 0) + 1;
}
console.log("Conversational move types of correct answers:");
for (const [m, c] of Object.entries(moveTypes).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${m}: ${c} (${Math.round(c / 16 * 100)}%)`);
}
const enablesNext = conversationLogic.filter(c => c.enables_next_turn).length;
console.log(`\nAnswers that enable a natural next turn: ${enablesNext}/16 (${Math.round(enablesNext/16*100)}%)`);

const politenessDist = {};
for (const c of conversationLogic) {
  politenessDist[c.politeness_level] = (politenessDist[c.politeness_level] || 0) + 1;
}
console.log(`\nPoliteness levels:`);
for (const [p, c] of Object.entries(politenessDist).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${p}: ${c}`);
}

// ── E. WORD TRAP TAXONOMY ───────────────────────────────────

console.log("\n─── E. WORD TRAP TAXONOMY ───\n");

// Classify word traps more precisely
const trapTaxonomy = [];
for (const wt of wordTrapDetails) {
  let mechanism;
  const sw = wt.shared_words.join(", ");

  // Check if the shared word appears in a completely different meaning
  if (wt.distractor_text.toLowerCase().includes("tell") && wt.speaker_snippet.toLowerCase().includes("tell")) {
    mechanism = "polysemy_trap"; // same word, different meaning
  } else if (wt.shared_words.length >= 2) {
    mechanism = "topic_cluster_trap"; // multiple related words create false topic match
  } else {
    // Check if the shared word triggers an associated concept
    const speakerField = getSemanticField(wt.shared_words[0]);
    mechanism = "semantic_association_trap"; // word triggers related but wrong concept
  }

  trapTaxonomy.push({
    ...wt,
    mechanism,
  });
}

const mechCount = {};
for (const t of trapTaxonomy) {
  mechCount[t.mechanism] = (mechCount[t.mechanism] || 0) + 1;
}
console.log("Word trap mechanisms:");
for (const [m, c] of Object.entries(mechCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${m}: ${c}`);
}

console.log("\nDetailed word traps:");
for (const t of trapTaxonomy) {
  console.log(`  ${t.item_id} [${t.distractor_key}]: speaker has "${t.shared_words.join(", ")}" → distractor: "${t.distractor_text.slice(0, 50)}"`);
}

// ── F. COMPILE FINAL DEEP PROFILE ───────────────────────────

const deepProfile = {
  generated_at: new Date().toISOString(),
  sample_count: 16,

  distractor_deep_dive: {
    total_distractors: 48,
    type_distribution: distTypeCount,
    lexical_overlap: {
      distractors_with_shared_words: withOverlap,
      rate: Math.round(withOverlap / 48 * 100),
      word_trap_instances: wordTrapDetails.length,
    },
    speech_act_distribution: distSpeechActs,
    word_count_stats: {
      min: Math.min(...distWcs),
      max: Math.max(...distWcs),
      avg: Math.round(distWcs.reduce((a, b) => a + b, 0) / distWcs.length * 10) / 10,
    },
    word_trap_taxonomy: {
      mechanisms: mechCount,
      detailed_examples: trapTaxonomy,
    },
  },

  correct_answer_paradigms: {
    strategy_distribution: stratCount,
    speaker_intent_to_strategy: intentStrategyMap,
    first_word_distribution: firstWords,
    counter_question_rate: Math.round(counterQs.length / 16 * 100),
    counter_questions: counterQs.map(q => ({ id: q.item_id, text: q.correct_text })),
    full_paradigms: answerParadigms,
  },

  option_interplay: {
    avg_options_sharing_speaker_words: Math.round(avgSharing * 10) / 10,
    avg_unique_speech_acts_per_item: Math.round(avgUniqueActs * 10) / 10,
    avg_word_count_range: Math.round(avgWcRange * 10) / 10,
    correct_length_rank_distribution: correctRankDist,
    full_data: interplayData,
  },

  conversation_logic: {
    move_type_distribution: moveTypes,
    enables_next_turn_rate: Math.round(enablesNext / 16 * 100),
    politeness_distribution: politenessDist,
    full_data: conversationLogic,
  },
};

// Write to file
const outPath = join(__dirname, "../data/listening/profile/lcr-deep-analysis-v2.json");
writeFileSync(outPath, JSON.stringify(deepProfile, null, 2));
console.log(`\n═══ Output written to: ${outPath} ═══`);
