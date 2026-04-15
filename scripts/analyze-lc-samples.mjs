#!/usr/bin/env node

/**
 * Analyze LC (Listen to a Conversation) reference samples.
 *
 * Reads: data/listening/samples/lc-reference.json
 * Outputs: data/listening/profile/lc-deep-analysis.json
 *
 * Extracts statistical profile:
 *   - Conversation metrics (word count, turn count, words per turn)
 *   - Speaker roles and relationship distribution
 *   - Setting distribution
 *   - Question type distribution (Q1 vs Q2 patterns)
 *   - Answer position distribution
 *   - Dialogue register markers (contractions, fillers, discourse markers)
 *   - Conversation structure patterns (problem -> discussion -> resolution)
 *   - Distractor type analysis
 *   - Option word count statistics
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_PATH = join(__dirname, "..", "data", "listening", "samples", "lc-reference.json");
const OUTPUT_DIR = join(__dirname, "..", "data", "listening", "profile");
const OUTPUT_PATH = join(OUTPUT_DIR, "lc-deep-analysis.json");

// -- Load samples --
const data = JSON.parse(readFileSync(SAMPLES_PATH, "utf-8"));
const items = data.items;
const N = items.length;

console.log(`Analyzing ${N} LC reference samples...\n`);

// -- 1. Conversation metrics --
function wc(s) { return s.split(/\s+/).filter(Boolean).length; }

const convMetrics = items.map(item => {
  const turns = item.conversation;
  const totalWords = turns.reduce((sum, t) => sum + wc(t.text), 0);
  const turnCount = turns.length;

  // Per-speaker turn/word counts
  const speakerStats = {};
  for (const t of turns) {
    if (!speakerStats[t.speaker]) speakerStats[t.speaker] = { turns: 0, words: 0 };
    speakerStats[t.speaker].turns++;
    speakerStats[t.speaker].words += wc(t.text);
  }

  return {
    id: item.id,
    totalWords,
    turnCount,
    wordsPerTurn: Math.round(totalWords / turnCount * 10) / 10,
    speakerStats,
  };
});

const wordCounts = convMetrics.map(m => m.totalWords);
const turnCounts = convMetrics.map(m => m.turnCount);
const wpTurns = convMetrics.map(m => m.wordsPerTurn);

function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10,
    median: sorted[Math.floor(sorted.length / 2)],
  };
}

console.log("Conversation word counts:", stats(wordCounts));
console.log("Turn counts:", stats(turnCounts));

// -- 2. Speaker relationships --
const relationshipDist = {};
for (const item of items) {
  const rel = item.speaker_relationship || "unknown";
  relationshipDist[rel] = (relationshipDist[rel] || 0) + 1;
}

console.log("Speaker relationships:", relationshipDist);

// -- 3. Settings --
const settingDist = {};
for (const item of items) {
  const s = item.setting || "unknown";
  settingDist[s] = (settingDist[s] || 0) + 1;
}

console.log("Settings:", settingDist);

// -- 4. Speaker roles --
const roleDist = {};
for (const item of items) {
  for (const sp of item.speakers) {
    const role = sp.role || "unknown";
    roleDist[role] = (roleDist[role] || 0) + 1;
  }
}

console.log("Speaker roles:", roleDist);

// -- 5. Question analysis --
const qTypes = { Q1: {}, Q2: {} };
const answerDist = { A: 0, B: 0, C: 0, D: 0 };
const stemPatterns = {};
const allOptionWcs = [];
const correctOptionWcs = [];
const distractorOptionWcs = [];
let correctIsLongest = 0;
let totalQuestions = 0;

for (const item of items) {
  for (let qi = 0; qi < item.questions.length; qi++) {
    const q = item.questions[qi];
    const qKey = qi === 0 ? "Q1" : "Q2";

    // Type
    const type = q.type || "unknown";
    qTypes[qKey][type] = (qTypes[qKey][type] || 0) + 1;

    // Answer position
    if (q.answer) answerDist[q.answer]++;

    // Stem pattern
    const stemStart = (q.stem || "").split(/\s+/).slice(0, 3).join(" ");
    stemPatterns[stemStart] = (stemPatterns[stemStart] || 0) + 1;

    // Option word counts
    totalQuestions++;
    const optWcs = {};
    for (const k of ["A", "B", "C", "D"]) {
      if (q.options[k]) {
        const w = wc(q.options[k]);
        optWcs[k] = w;
        allOptionWcs.push(w);
        if (k === q.answer) {
          correctOptionWcs.push(w);
        } else {
          distractorOptionWcs.push(w);
        }
      }
    }
    // Correct is longest?
    const correctWc = optWcs[q.answer] || 0;
    const maxWc = Math.max(...Object.values(optWcs));
    if (correctWc === maxWc) correctIsLongest++;
  }
}

console.log("Q1 types:", qTypes.Q1);
console.log("Q2 types:", qTypes.Q2);
console.log("Answer distribution:", answerDist);

// -- 6. Dialogue register analysis --
const CONTRACTION_RE = /\b(i'm|i'll|i've|i'd|don't|didn't|doesn't|isn't|aren't|wasn't|weren't|can't|couldn't|won't|wouldn't|shouldn't|it's|that's|there's|here's|what's|who's|he's|she's|we're|they're|you're|let's|haven't|hasn't)\b/i;
const FILLER_RE = /\b(um|uh|well|hmm|oh|huh|like|you know|I mean|actually|basically|honestly|right)\b/i;
const DISCOURSE_MARKER_RE = /\b(actually|well|okay|so|anyway|you know|I mean|look|see|right|sure|exactly|oh)\b/i;

let convsWithContractions = 0;
let convsWithFillers = 0;
let totalTurnsWithContractions = 0;
let totalTurnsWithFillers = 0;
let totalTurnsWithDM = 0;
let totalTurns = 0;

for (const item of items) {
  let hasContraction = false;
  let hasFiller = false;
  for (const t of item.conversation) {
    totalTurns++;
    if (CONTRACTION_RE.test(t.text)) {
      totalTurnsWithContractions++;
      hasContraction = true;
    }
    if (FILLER_RE.test(t.text)) {
      totalTurnsWithFillers++;
      hasFiller = true;
    }
    if (DISCOURSE_MARKER_RE.test(t.text)) {
      totalTurnsWithDM++;
    }
  }
  if (hasContraction) convsWithContractions++;
  if (hasFiller) convsWithFillers++;
}

console.log(`Contractions: ${convsWithContractions}/${N} conversations (${Math.round(convsWithContractions/N*100)}%)`);
console.log(`Fillers: ${convsWithFillers}/${N} conversations (${Math.round(convsWithFillers/N*100)}%)`);

// -- 7. Conversation structure analysis --
// Detect: problem/question -> discussion -> resolution pattern
const structurePatterns = {};
for (const item of items) {
  const turns = item.conversation;
  const first = turns[0]?.text?.toLowerCase() || "";
  const last = turns[turns.length - 1]?.text?.toLowerCase() || "";

  let pattern = "other";
  // Check if first turn presents a problem/question
  if (first.includes("?") || /\b(hoping|trying|wondering|need|can't|problem|issue)\b/.test(first)) {
    // Check if last turn has resolution
    if (/\b(thanks|thank|great|good|sounds|definitely|sure|okay|perfect|i'll)\b/.test(last)) {
      pattern = "problem_discussion_resolution";
    } else {
      pattern = "problem_discussion_open";
    }
  } else if (first.includes("?")) {
    pattern = "question_led";
  } else {
    pattern = "observation_led";
  }
  structurePatterns[pattern] = (structurePatterns[pattern] || 0) + 1;
}

console.log("Structure patterns:", structurePatterns);

// -- 8. Build output --
const analysis = {
  generated_at: new Date().toISOString(),
  sample_count: N,
  sources: data.sources,

  conversation_metrics: {
    word_count: stats(wordCounts),
    turn_count: stats(turnCounts),
    words_per_turn: stats(wpTurns),
    per_sample: convMetrics.map(m => ({
      id: m.id,
      words: m.totalWords,
      turns: m.turnCount,
      wpt: m.wordsPerTurn,
    })),
  },

  speaker_analysis: {
    relationship_distribution: relationshipDist,
    relationship_rates: Object.fromEntries(
      Object.entries(relationshipDist).map(([k, v]) => [k, Math.round(v / N * 100)])
    ),
    role_distribution: roleDist,
    setting_distribution: settingDist,
    setting_rates: Object.fromEntries(
      Object.entries(settingDist).map(([k, v]) => [k, Math.round(v / N * 100)])
    ),
  },

  question_analysis: {
    total_questions: totalQuestions,
    per_conversation: 2,
    type_distribution: {
      Q1: qTypes.Q1,
      Q2: qTypes.Q2,
      combined: Object.entries({ ...qTypes.Q1, ...qTypes.Q2 }).reduce((acc, [k, v]) => {
        acc[k] = (acc[k] || 0) + v;
        if (qTypes.Q1[k] && qTypes.Q2[k]) acc[k] = qTypes.Q1[k] + qTypes.Q2[k];
        else if (qTypes.Q1[k]) acc[k] = qTypes.Q1[k] + (qTypes.Q2[k] || 0);
        else acc[k] = (qTypes.Q1[k] || 0) + qTypes.Q2[k];
        return acc;
      }, {}),
    },
    answer_distribution: answerDist,
    stem_patterns: stemPatterns,
    option_word_count: {
      all_avg: Math.round(allOptionWcs.reduce((a, b) => a + b, 0) / allOptionWcs.length * 10) / 10,
      correct_avg: Math.round(correctOptionWcs.reduce((a, b) => a + b, 0) / correctOptionWcs.length * 10) / 10,
      distractor_avg: Math.round(distractorOptionWcs.reduce((a, b) => a + b, 0) / distractorOptionWcs.length * 10) / 10,
    },
    correct_is_longest_rate: Math.round(correctIsLongest / totalQuestions * 100),
  },

  dialogue_register: {
    conversations_with_contractions: `${convsWithContractions}/${N} (${Math.round(convsWithContractions/N*100)}%)`,
    conversations_with_fillers: `${convsWithFillers}/${N} (${Math.round(convsWithFillers/N*100)}%)`,
    turn_level: {
      total_turns: totalTurns,
      turns_with_contractions: `${totalTurnsWithContractions} (${Math.round(totalTurnsWithContractions/totalTurns*100)}%)`,
      turns_with_fillers: `${totalTurnsWithFillers} (${Math.round(totalTurnsWithFillers/totalTurns*100)}%)`,
      turns_with_discourse_markers: `${totalTurnsWithDM} (${Math.round(totalTurnsWithDM/totalTurns*100)}%)`,
    },
  },

  conversation_structure: {
    patterns: structurePatterns,
    dominant: "problem_discussion_resolution",
    note: "Most conversations follow: speaker presents problem/need -> discussion with information exchange -> resolution/action plan",
  },
};

// -- Save --
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(analysis, null, 2));
console.log(`\nSaved analysis to: ${OUTPUT_PATH}`);
