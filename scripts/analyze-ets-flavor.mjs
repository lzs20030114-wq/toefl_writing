#!/usr/bin/env node

/**
 * Deep analysis of ETS "flavor" — what makes real TOEFL questions feel authentic.
 *
 * Analyzes collected samples across 6 dimensions:
 *   1. Lexical Profile (word frequency, academic vocabulary, word length)
 *   2. Syntactic Profile (sentence structure, passive voice, clause complexity)
 *   3. Discourse Profile (transitions, hedging, evidence language, rhetorical patterns)
 *   4. Question Stem Patterns (wording conventions, stem types)
 *   5. Option Construction (parallelism, length balance, distractor engineering)
 *   6. Task-specific Features (CTW blank patterns, RDL register, AP paragraph structure)
 *
 * Usage: node scripts/analyze-ets-flavor.mjs
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, "..", "data", "reading", "samples");
const PROFILE_DIR = join(__dirname, "..", "data", "reading", "profile");

// ═══════════════════════════════════════════════════════════
// Data Loading
// ═══════════════════════════════════════════════════════════

function loadItems(taskDir) {
  const dirPath = join(SAMPLES_DIR, taskDir);
  const items = [];
  try {
    for (const file of readdirSync(dirPath).filter(f => f.endsWith(".json"))) {
      const data = JSON.parse(readFileSync(join(dirPath, file), "utf-8"));
      if (Array.isArray(data.items)) items.push(...data.items);
    }
  } catch { }
  return items;
}

// ═══════════════════════════════════════════════════════════
// Word-level tools
// ═══════════════════════════════════════════════════════════

function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^a-z'\s-]/g, " ").split(/\s+/).filter(w => w.length > 0);
}

function sentences(text) {
  if (!text) return [];
  return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 1);
}

function countWords(text) { return tokenize(text).length; }

// ═══════════════════════════════════════════════════════════
// 1. LEXICAL PROFILE
// ═══════════════════════════════════════════════════════════

// AWL (Academic Word List) - Coxhead's 570 word families, sublist 1-3 (most frequent)
const AWL_CORE = new Set([
  "analyze", "analysis", "analytical", "approach", "area", "assess", "assessment", "assume",
  "authority", "available", "benefit", "concept", "consist", "constitute", "context",
  "contract", "create", "data", "define", "definition", "derive", "distribute", "distribution",
  "economic", "economy", "environment", "environmental", "establish", "estimate", "evident",
  "evidence", "export", "factor", "finance", "financial", "formula", "function", "identify",
  "income", "indicate", "individual", "interpret", "involve", "issue", "labor", "legal",
  "legislate", "legislation", "major", "method", "occur", "percent", "period", "policy",
  "principle", "proceed", "process", "require", "research", "respond", "response", "role",
  "section", "sector", "significant", "similar", "source", "specific", "structure", "theory",
  "vary", "variable", "achieve", "acquire", "administrate", "affect", "appropriate", "aspect",
  "assist", "category", "chapter", "commission", "community", "complex", "compute", "conclude",
  "conduct", "consequence", "construct", "consume", "credit", "culture", "design", "distinct",
  "element", "equate", "evaluate", "feature", "final", "focus", "impact", "injure", "institute",
  "invest", "item", "journal", "maintain", "normal", "obtain", "participate", "perceive",
  "positive", "potential", "previous", "primary", "purchase", "range", "region", "regulate",
  "relevant", "reside", "resource", "restrict", "secure", "seek", "select", "site", "strategy",
  "survey", "text", "tradition", "transfer", "technique", "technology",
  // Additional academic verbs common in TOEFL
  "suggest", "demonstrate", "contribute", "enhance", "emerge", "evolve", "generate",
  "hypothesize", "implement", "interact", "modify", "monitor", "phenomenon", "predict",
  "adapt", "coordinate", "fundamental", "mechanism", "network", "perspective", "proportion",
  "regulate", "simulate", "sustain", "transform", "utilize",
]);

// High-frequency function words (not interesting for analysis)
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
  "by", "from", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "shall",
  "it", "its", "this", "that", "these", "those", "they", "them", "their", "he", "she",
  "his", "her", "we", "our", "you", "your", "i", "my", "me", "not", "no", "as", "if",
  "so", "than", "then", "also", "just", "about", "more", "most", "very", "up", "out",
  "all", "each", "every", "both", "such", "only", "own", "into", "over", "after", "before",
  "between", "through", "during", "without", "within", "along", "among", "across",
  "who", "which", "what", "when", "where", "how", "there", "here",
]);

function lexicalProfile(text) {
  const words = tokenize(text);
  const contentWords = words.filter(w => !STOP_WORDS.has(w));
  const awlWords = contentWords.filter(w => AWL_CORE.has(w));
  const longWords = words.filter(w => w.length >= 7);
  const veryLongWords = words.filter(w => w.length >= 10);

  // Word length distribution
  const lengths = words.map(w => w.length);
  const avgLen = lengths.length > 0 ? lengths.reduce((s, l) => s + l, 0) / lengths.length : 0;

  // Lexical density: content words / total words
  const lexicalDensity = words.length > 0 ? contentWords.length / words.length : 0;

  // Type-token ratio
  const types = new Set(words);
  const ttr = words.length > 0 ? types.size / words.length : 0;

  return {
    totalWords: words.length,
    uniqueWords: types.size,
    ttr: +ttr.toFixed(3),
    lexicalDensity: +lexicalDensity.toFixed(3),
    awlCount: awlWords.length,
    awlRatio: words.length > 0 ? +(awlWords.length / words.length).toFixed(3) : 0,
    awlWords: [...new Set(awlWords)].sort(),
    avgWordLength: +avgLen.toFixed(1),
    longWordRatio: words.length > 0 ? +(longWords.length / words.length).toFixed(3) : 0,
    veryLongWordRatio: words.length > 0 ? +(veryLongWords.length / words.length).toFixed(3) : 0,
  };
}

// ═══════════════════════════════════════════════════════════
// 2. SYNTACTIC PROFILE
// ═══════════════════════════════════════════════════════════

const PASSIVE_PATTERNS = [
  /\b(?:is|are|was|were|been|being)\s+\w+ed\b/gi,
  /\b(?:is|are|was|were|been|being)\s+\w+en\b/gi,
  /\bconsidered\s+to\b/gi,
  /\bknown\s+(?:to|as|for)\b/gi,
  /\b(?:is|are|was|were)\s+(?:called|named|termed|referred|regarded|seen|found|shown|thought|believed|expected|supposed|assumed|considered|required|needed|used|made|given|taken|designed|built|created|developed|produced|based|derived|involved)\b/gi,
];

const RELATIVE_CLAUSE_MARKERS = /\b(?:which|that|who|whom|whose|where|when)\b/gi;
const CONDITIONAL_PATTERNS = /\b(?:if|unless|provided|assuming|whether)\b/gi;
const COMPARISON_PATTERNS = /\b(?:more|less|most|least|than|as\s+\w+\s+as|compared|unlike|similar|different)\b/gi;

function syntacticProfile(text) {
  const sents = sentences(text);
  const sentLengths = sents.map(s => countWords(s));

  // Passive voice
  let passiveCount = 0;
  for (const pat of PASSIVE_PATTERNS) {
    pat.lastIndex = 0;
    const matches = text.match(pat);
    if (matches) passiveCount += matches.length;
  }

  // Relative clauses
  const relClauses = (text.match(RELATIVE_CLAUSE_MARKERS) || []).length;

  // Conditionals
  const conditionals = (text.match(CONDITIONAL_PATTERNS) || []).length;

  // Comparisons
  const comparisons = (text.match(COMPARISON_PATTERNS) || []).length;

  // Sentence complexity: commas + semicolons per sentence as proxy
  const punctPerSent = sents.map(s => {
    const commas = (s.match(/,/g) || []).length;
    const semis = (s.match(/;/g) || []).length;
    const colons = (s.match(/:/g) || []).length;
    const dashes = (s.match(/—|--/g) || []).length;
    return commas + semis + colons + dashes;
  });

  // Questions in passage
  const questions = sents.filter(s => s.trim().endsWith("?")).length;

  // Sentence length variation (coefficient of variation)
  const meanLen = sentLengths.length > 0 ? sentLengths.reduce((s, v) => s + v, 0) / sentLengths.length : 0;
  const stdLen = sentLengths.length > 0 ? Math.sqrt(sentLengths.reduce((s, v) => s + (v - meanLen) ** 2, 0) / sentLengths.length) : 0;
  const cv = meanLen > 0 ? stdLen / meanLen : 0;

  return {
    sentenceCount: sents.length,
    avgSentLength: +meanLen.toFixed(1),
    sentLengthCV: +cv.toFixed(3),  // variation: higher = more varied sentence lengths
    minSentLength: sentLengths.length > 0 ? Math.min(...sentLengths) : 0,
    maxSentLength: sentLengths.length > 0 ? Math.max(...sentLengths) : 0,
    passiveCount,
    passivePerSent: sents.length > 0 ? +(passiveCount / sents.length).toFixed(2) : 0,
    relativeClauseCount: relClauses,
    conditionalCount: conditionals,
    comparisonCount: comparisons,
    avgPunctPerSent: punctPerSent.length > 0 ? +(punctPerSent.reduce((s, v) => s + v, 0) / punctPerSent.length).toFixed(2) : 0,
    questionCount: questions,
  };
}

// ═══════════════════════════════════════════════════════════
// 3. DISCOURSE PROFILE
// ═══════════════════════════════════════════════════════════

// Hedging language (tentative/cautious expressions — signature of academic writing)
const HEDGE_WORDS = [
  "may", "might", "could", "possibly", "perhaps", "likely", "unlikely",
  "suggest", "suggests", "suggested", "appear", "appears", "appeared",
  "seem", "seems", "seemed", "tend", "tends", "tended",
  "approximately", "roughly", "about", "around",
  "some", "certain", "particular", "often", "generally", "typically",
  "relatively", "somewhat", "partly", "partially",
  "potential", "potentially", "probable", "probably",
  "indicate", "indicates", "implied", "imply",
];

// Evidence/authority markers
const EVIDENCE_PATTERNS = [
  /\bstudies?\s+(?:show|suggest|indicate|reveal|demonstrate|have shown|found)\b/gi,
  /\bresearch(?:ers?)?\s+(?:show|suggest|indicate|found|discovered|have)\b/gi,
  /\bscientists?\s+(?:believe|found|discovered|determined|observed|noted|have)\b/gi,
  /\baccording\s+to\b/gi,
  /\bexperiments?\s+(?:show|suggest|demonstrate|revealed|confirmed)\b/gi,
  /\bevidence\s+(?:suggest|shows|indicates)\b/gi,
  /\bit\s+(?:is|was)\s+(?:believed|thought|considered|known|estimated|assumed)\b/gi,
  /\b(?:historians?|experts?|scholars?|biologists?|psychologists?)\s+(?:believe|argue|suggest|note|observe|have)\b/gi,
];

// Transition/discourse markers
const TRANSITIONS = {
  addition: ["also", "furthermore", "moreover", "in addition", "additionally", "as well"],
  contrast: ["however", "but", "although", "though", "nevertheless", "despite", "in contrast", "while", "whereas", "on the other hand", "yet", "instead", "rather"],
  cause_effect: ["because", "therefore", "consequently", "as a result", "thus", "hence", "due to", "since", "so that", "leads to", "results in", "caused by"],
  example: ["for example", "for instance", "such as", "including", "like", "specifically", "in particular"],
  sequence: ["first", "second", "third", "finally", "then", "next", "subsequently", "meanwhile", "eventually", "initially", "later"],
  emphasis: ["in fact", "indeed", "especially", "particularly", "notably", "importantly", "significantly"],
  conclusion: ["in conclusion", "overall", "in summary", "ultimately", "in general"],
};

function discourseProfile(text) {
  const lower = text.toLowerCase();
  const words = tokenize(text);

  // Hedging
  const hedgeCount = HEDGE_WORDS.reduce((count, h) => {
    const regex = new RegExp(`\\b${h}\\b`, "gi");
    return count + (text.match(regex) || []).length;
  }, 0);

  // Evidence markers
  let evidenceCount = 0;
  const evidenceExamples = [];
  for (const pat of EVIDENCE_PATTERNS) {
    pat.lastIndex = 0;
    const matches = text.match(pat);
    if (matches) {
      evidenceCount += matches.length;
      evidenceExamples.push(...matches.slice(0, 2));
    }
  }

  // Transition analysis
  const transitionCounts = {};
  let totalTransitions = 0;
  for (const [category, markers] of Object.entries(TRANSITIONS)) {
    let count = 0;
    for (const marker of markers) {
      const regex = new RegExp(`\\b${marker.replace(/\s+/g, "\\s+")}\\b`, "gi");
      count += (text.match(regex) || []).length;
    }
    transitionCounts[category] = count;
    totalTransitions += count;
  }

  // Information structure: does each paragraph start with a topic sentence?
  // Heuristic: first sentence of paragraph is significantly shorter than average
  // (topic sentences tend to be concise)

  // Rhetorical questions
  const rhetoricalQ = (text.match(/\?\s/g) || []).length;

  // Definition patterns ("X is/are defined as", "known as", "referred to as", "called")
  const definitions = (text.match(/\b(?:defined as|known as|referred to as|called|termed|means|is\s+a\b)/gi) || []).length;

  return {
    hedgeCount,
    hedgeRatio: words.length > 0 ? +(hedgeCount / words.length).toFixed(4) : 0,
    evidenceCount,
    evidenceExamples: evidenceExamples.slice(0, 5),
    transitionCounts,
    totalTransitions,
    transitionRatio: words.length > 0 ? +(totalTransitions / words.length).toFixed(4) : 0,
    rhetoricalQuestions: rhetoricalQ,
    definitionPatterns: definitions,
  };
}

// ═══════════════════════════════════════════════════════════
// 4. QUESTION STEM PATTERNS
// ═══════════════════════════════════════════════════════════

function analyzeStems(questions) {
  const stems = questions.map(q => q.stem);
  const patterns = {
    // Main idea patterns
    mainly_about: 0,
    main_purpose: 0,
    best_states: 0,
    // Detail patterns
    according_to: 0,
    mentioned_in: 0,
    states_that: 0,
    // Negative factual
    not_mentioned: 0,
    except: 0,
    // Inference
    can_be_inferred: 0,
    most_likely: 0,
    suggests_that: 0,
    // Vocabulary
    closest_in_meaning: 0,
    word_phrase: 0,
    // Rhetorical purpose
    why_does_author: 0,
    purpose_of: 0,
    author_mentions: 0,
    // Paragraph relationship
    how_does_paragraph: 0,
    relationship_between: 0,
  };

  for (const stem of stems) {
    const s = stem.toLowerCase();
    if (s.includes("mainly about") || s.includes("mainly discuss")) patterns.mainly_about++;
    if (s.includes("main purpose") || s.includes("primary purpose")) patterns.main_purpose++;
    if (s.includes("best states") || s.includes("best describes")) patterns.best_states++;
    if (s.includes("according to")) patterns.according_to++;
    if (s.includes("mentioned in") || s.includes("stated in")) patterns.mentioned_in++;
    if (s.includes("states that") || s.includes("says that")) patterns.states_that++;
    if (s.includes("not ") && (s.includes("mention") || s.includes("true") || s.includes("stated"))) patterns.not_mentioned++;
    if (s.includes("except") || s.includes("not true")) patterns.except++;
    if (s.includes("infer") || s.includes("inferred")) patterns.can_be_inferred++;
    if (s.includes("most likely") || s.includes("probably")) patterns.most_likely++;
    if (s.includes("suggest") || s.includes("imply") || s.includes("implied")) patterns.suggests_that++;
    if (s.includes("closest in meaning") || s.includes("most nearly means")) patterns.closest_in_meaning++;
    if (s.includes("word") || s.includes("phrase")) patterns.word_phrase++;
    if (s.includes("why does the author") || s.includes("why did the author")) patterns.why_does_author++;
    if (s.includes("purpose of") || s.includes("purpose for")) patterns.purpose_of++;
    if (s.includes("author mention") || s.includes("author include")) patterns.author_mentions++;
    if (s.includes("how does paragraph") || s.includes("how do paragraphs")) patterns.how_does_paragraph++;
    if (s.includes("relationship") || s.includes("relate to") || s.includes("connect")) patterns.relationship_between++;
  }

  // Stem length analysis
  const stemLengths = stems.map(s => countWords(s));
  const avgStemLen = stemLengths.length > 0 ? stemLengths.reduce((a, b) => a + b, 0) / stemLengths.length : 0;

  // Stem starts with...
  const stemStarts = {};
  for (const stem of stems) {
    const firstWord = stem.split(/\s+/)[0].toLowerCase();
    stemStarts[firstWord] = (stemStarts[firstWord] || 0) + 1;
  }

  return {
    totalQuestions: questions.length,
    patterns,
    avgStemWordCount: +avgStemLen.toFixed(1),
    stemStarts: Object.fromEntries(
      Object.entries(stemStarts).sort((a, b) => b[1] - a[1]).slice(0, 10)
    ),
  };
}

// ═══════════════════════════════════════════════════════════
// 5. OPTION CONSTRUCTION ANALYSIS
// ═══════════════════════════════════════════════════════════

function analyzeOptions(questions) {
  const results = {
    totalQuestions: questions.length,
    optionLengths: { A: [], B: [], C: [], D: [] },
    correctIsLongest: 0,
    correctIsShortest: 0,
    allSameLength: 0,
    grammaticalParallelism: 0,  // options start with same POS
    correctAnswerDist: { A: 0, B: 0, C: 0, D: 0 },
    optionStartPatterns: {},
  };

  for (const q of questions) {
    if (!q.options || !q.correct_answer) continue;

    const lengths = {};
    for (const [key, val] of Object.entries(q.options)) {
      lengths[key] = countWords(val);
      results.optionLengths[key].push(countWords(val));
    }

    const correctLen = lengths[q.correct_answer] || 0;
    const allLens = Object.values(lengths);
    const maxLen = Math.max(...allLens);
    const minLen = Math.min(...allLens);

    if (correctLen === maxLen && allLens.filter(l => l === maxLen).length === 1) {
      results.correctIsLongest++;
    }
    if (correctLen === minLen && allLens.filter(l => l === minLen).length === 1) {
      results.correctIsShortest++;
    }
    if (maxLen === minLen) results.allSameLength++;

    results.correctAnswerDist[q.correct_answer]++;

    // Check grammatical parallelism: do all options start the same way?
    const starts = Object.values(q.options).map(o => {
      const first = o.trim().split(/\s/)[0].toLowerCase();
      if (first.match(/^(to|a|an|the|by|it|they|he|she|we)\b/)) return first;
      if (first.endsWith("ing")) return "GERUND";
      if (first.endsWith("ed")) return "PAST";
      return "OTHER";
    });
    if (new Set(starts).size <= 2) results.grammaticalParallelism++;

    // Option start word frequency
    for (const opt of Object.values(q.options)) {
      const start = opt.trim().split(/\s/)[0].toLowerCase();
      results.optionStartPatterns[start] = (results.optionStartPatterns[start] || 0) + 1;
    }
  }

  // Compute averages
  const avgByPosition = {};
  for (const [pos, lens] of Object.entries(results.optionLengths)) {
    avgByPosition[pos] = lens.length > 0 ? +(lens.reduce((s, l) => s + l, 0) / lens.length).toFixed(1) : 0;
  }

  return {
    totalQuestions: results.totalQuestions,
    correctIsLongestPct: results.totalQuestions > 0 ? +(results.correctIsLongest / results.totalQuestions * 100).toFixed(1) : 0,
    correctIsShortestPct: results.totalQuestions > 0 ? +(results.correctIsShortest / results.totalQuestions * 100).toFixed(1) : 0,
    allSameLengthPct: results.totalQuestions > 0 ? +(results.allSameLength / results.totalQuestions * 100).toFixed(1) : 0,
    grammaticalParallelismPct: results.totalQuestions > 0 ? +(results.grammaticalParallelism / results.totalQuestions * 100).toFixed(1) : 0,
    avgOptionLengthByPosition: avgByPosition,
    correctAnswerDist: results.correctAnswerDist,
    topOptionStarts: Object.fromEntries(
      Object.entries(results.optionStartPatterns).sort((a, b) => b[1] - a[1]).slice(0, 15)
    ),
  };
}

// ═══════════════════════════════════════════════════════════
// 6. DISTRACTOR STRATEGY DEEP DIVE (AP only)
// ═══════════════════════════════════════════════════════════

function analyzeDistractors(questions) {
  const byType = {};  // question_type -> distractor_pattern -> count
  const byCorrectLen = { longer: 0, shorter: 0, equal: 0 };
  const distractorExamples = {};

  for (const q of questions) {
    if (!q.distractor_analysis || !q.options || !q.correct_answer) continue;

    const qt = q.question_type || "unknown";
    if (!byType[qt]) byType[qt] = {};

    const correctLen = countWords(q.options[q.correct_answer] || "");

    for (const [key, pattern] of Object.entries(q.distractor_analysis)) {
      byType[qt][pattern] = (byType[qt][pattern] || 0) + 1;

      const distractorLen = countWords(q.options[key] || "");
      if (distractorLen > correctLen) byCorrectLen.longer++;
      else if (distractorLen < correctLen) byCorrectLen.shorter++;
      else byCorrectLen.equal++;

      if (!distractorExamples[pattern]) distractorExamples[pattern] = [];
      if (distractorExamples[pattern].length < 3) {
        distractorExamples[pattern].push({
          stem: q.stem.substring(0, 60) + "...",
          distractor: q.options[key].substring(0, 60),
          correct: q.options[q.correct_answer].substring(0, 60),
        });
      }
    }
  }

  return { byType, byCorrectLen, distractorExamples };
}

// ═══════════════════════════════════════════════════════════
// CTW-specific: Blank Word Analysis
// ═══════════════════════════════════════════════════════════

function analyzeCTWBlanks(items) {
  const allBlanks = items.flatMap(i => i.blanks || []);
  const words = allBlanks.map(b => b.original_word.toLowerCase());

  // Frequency: how many blanks are common/function words vs content words?
  const functionBlanks = words.filter(w => STOP_WORDS.has(w));
  const contentBlanks = words.filter(w => !STOP_WORDS.has(w));
  const awlBlanks = contentBlanks.filter(w => AWL_CORE.has(w));

  // Word ending patterns (morphological)
  const endings = {};
  for (const w of words) {
    if (w.endsWith("ing")) endings["ing"] = (endings["ing"] || 0) + 1;
    else if (w.endsWith("tion") || w.endsWith("sion")) endings["tion/sion"] = (endings["tion/sion"] || 0) + 1;
    else if (w.endsWith("ed")) endings["ed"] = (endings["ed"] || 0) + 1;
    else if (w.endsWith("ly")) endings["ly"] = (endings["ly"] || 0) + 1;
    else if (w.endsWith("er") || w.endsWith("or")) endings["er/or"] = (endings["er/or"] || 0) + 1;
    else if (w.endsWith("al") || w.endsWith("ful") || w.endsWith("ous")) endings["adj_suffix"] = (endings["adj_suffix"] || 0) + 1;
    else endings["other"] = (endings["other"] || 0) + 1;
  }

  // Difficulty by fragment ratio: less shown = harder
  const fragmentRatios = allBlanks.map(b => b.displayed_fragment.length / b.original_word.length);
  const hardBlanks = allBlanks.filter(b => b.displayed_fragment.length / b.original_word.length < 0.35);
  const easyBlanks = allBlanks.filter(b => b.displayed_fragment.length / b.original_word.length >= 0.45);

  return {
    totalBlanks: allBlanks.length,
    functionWordBlanks: functionBlanks.length,
    functionWordPct: +(functionBlanks.length / allBlanks.length * 100).toFixed(1),
    contentWordBlanks: contentBlanks.length,
    awlBlanks: awlBlanks.length,
    awlBlankPct: contentBlanks.length > 0 ? +(awlBlanks.length / contentBlanks.length * 100).toFixed(1) : 0,
    endings,
    hardBlankCount: hardBlanks.length,
    easyBlankCount: easyBlanks.length,
    hardBlankExamples: hardBlanks.slice(0, 5).map(b => `${b.displayed_fragment}... → ${b.original_word}`),
    allBlankWords: words,
  };
}

// ═══════════════════════════════════════════════════════════
// RDL-specific: Register Analysis
// ═══════════════════════════════════════════════════════════

function analyzeRDLRegister(items) {
  const informal = {
    contractions: 0,  // don't, can't, we're
    exclamations: 0,  // !
    questions: 0,     // ?
    imperatives: 0,   // "bring", "check", "visit"
    emojis: 0,
    slang: 0,         // "gonna", "gotta", "wanna"
    abbreviations: 0, // "P.M.", "AM", "info"
  };

  const formal = {
    passiveVoice: 0,
    longSentences: 0, // >20 words
    nominalizations: 0, // -tion, -ment, -ness
  };

  for (const item of items) {
    const text = item.text;
    informal.contractions += (text.match(/\b\w+'(?:t|re|ve|ll|d|s|m)\b/gi) || []).length;
    informal.exclamations += (text.match(/!/g) || []).length;
    informal.questions += (text.match(/\?/g) || []).length;
    informal.abbreviations += (text.match(/\b(?:[A-Z]\.){2,}|\b(?:AM|PM|RSVP|ID|info)\b/g) || []).length;

    for (const pat of PASSIVE_PATTERNS) {
      pat.lastIndex = 0;
      formal.passiveVoice += (text.match(pat) || []).length;
    }
    formal.longSentences += sentences(text).filter(s => countWords(s) > 20).length;
    formal.nominalizations += (text.match(/\b\w+(?:tion|ment|ness|ity|ance|ence)\b/gi) || []).length;
  }

  // Genre-specific formality score
  const genreFormality = {};
  for (const item of items) {
    const genre = item.genre || "other";
    const text = item.text;
    const contractions = (text.match(/\b\w+'(?:t|re|ve|ll|d|s|m)\b/gi) || []).length;
    const exclamations = (text.match(/!/g) || []).length;
    const passives = PASSIVE_PATTERNS.reduce((c, p) => { p.lastIndex = 0; return c + (text.match(p) || []).length; }, 0);
    const formalityScore = passives - contractions - exclamations;
    if (!genreFormality[genre]) genreFormality[genre] = [];
    genreFormality[genre].push(formalityScore);
  }

  return { informal, formal, genreFormality };
}

// ═══════════════════════════════════════════════════════════
// AP-specific: Paragraph Structure
// ═══════════════════════════════════════════════════════════

function analyzeAPStructure(items) {
  const patterns = {
    introTypes: {},       // how paragraphs begin
    topicSentenceLen: [], // first sentence length per paragraph
    paraLengths: [],      // words per paragraph
    paraCount: [],        // paragraphs per passage
  };

  for (const item of items) {
    const paras = item.paragraphs || [];
    patterns.paraCount.push(paras.length);

    for (const para of paras) {
      patterns.paraLengths.push(countWords(para));
      const firstSent = sentences(para)[0] || "";
      patterns.topicSentenceLen.push(countWords(firstSent));

      // Categorize paragraph opening
      const lower = firstSent.toLowerCase().trim();
      if (lower.match(/^(however|but|although|yet|in contrast|on the other hand|despite|nevertheless)/)) {
        patterns.introTypes["contrast"] = (patterns.introTypes["contrast"] || 0) + 1;
      } else if (lower.match(/^(in addition|furthermore|moreover|also|similarly|likewise)/)) {
        patterns.introTypes["addition"] = (patterns.introTypes["addition"] || 0) + 1;
      } else if (lower.match(/^(for example|for instance|one|a|an|in one|in a)/)) {
        patterns.introTypes["example"] = (patterns.introTypes["example"] || 0) + 1;
      } else if (lower.match(/^(as a result|therefore|consequently|thus|because|since|this)/)) {
        patterns.introTypes["cause_effect"] = (patterns.introTypes["cause_effect"] || 0) + 1;
      } else {
        patterns.introTypes["statement"] = (patterns.introTypes["statement"] || 0) + 1;
      }
    }
  }

  const avg = arr => arr.length > 0 ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1) : 0;

  return {
    avgParaCount: avg(patterns.paraCount),
    avgParaLength: avg(patterns.paraLengths),
    avgTopicSentenceLen: avg(patterns.topicSentenceLen),
    paragraphIntroTypes: patterns.introTypes,
  };
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

function main() {
  const ctwItems = loadItems("completeTheWords");
  const rdlItems = loadItems("readInDailyLife");
  const apItems = loadItems("academicPassage");

  const allAPQuestions = apItems.flatMap(i => i.questions || []);
  const allRDLQuestions = rdlItems.flatMap(i => i.questions || []);
  const allQuestions = [...allAPQuestions, ...allRDLQuestions];

  // Aggregate passage texts
  const apTexts = apItems.map(i => i.passage);
  const ctwTexts = ctwItems.map(i => i.passage);

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          ETS TOEFL 2026 Reading — Flavor Analysis       ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // ── 1. LEXICAL PROFILE ──
  console.log("━━━ 1. LEXICAL PROFILE (Academic Passages) ━━━\n");
  const apLexical = apTexts.map(lexicalProfile);
  const avgAWL = apLexical.reduce((s, l) => s + l.awlRatio, 0) / apLexical.length;
  const avgLD = apLexical.reduce((s, l) => s + l.lexicalDensity, 0) / apLexical.length;
  const avgWL = apLexical.reduce((s, l) => s + l.avgWordLength, 0) / apLexical.length;
  const avgLong = apLexical.reduce((s, l) => s + l.longWordRatio, 0) / apLexical.length;

  console.log(`  AWL coverage:       ${(avgAWL * 100).toFixed(1)}% (words from Academic Word List)`);
  console.log(`  Lexical density:    ${(avgLD * 100).toFixed(1)}% (content words / total)`);
  console.log(`  Avg word length:    ${avgWL.toFixed(1)} characters`);
  console.log(`  Long words (≥7ch):  ${(avgLong * 100).toFixed(1)}%`);
  console.log(`  TTR range:          ${Math.min(...apLexical.map(l => l.ttr)).toFixed(3)} — ${Math.max(...apLexical.map(l => l.ttr)).toFixed(3)}`);

  // Collect all AWL words found
  const allAWL = new Set(apLexical.flatMap(l => l.awlWords));
  console.log(`  AWL words found:    ${[...allAWL].sort().join(", ")}`);
  console.log();

  // ── 2. SYNTACTIC PROFILE ──
  console.log("━━━ 2. SYNTACTIC PROFILE (Academic Passages) ━━━\n");
  const apSyntax = apTexts.map(syntacticProfile);
  const avgPassive = apSyntax.reduce((s, p) => s + p.passivePerSent, 0) / apSyntax.length;
  const avgRelC = apSyntax.reduce((s, p) => s + p.relativeClauseCount, 0) / apSyntax.length;
  const avgCond = apSyntax.reduce((s, p) => s + p.conditionalCount, 0) / apSyntax.length;
  const avgComp = apSyntax.reduce((s, p) => s + p.comparisonCount, 0) / apSyntax.length;
  const avgPunct = apSyntax.reduce((s, p) => s + p.avgPunctPerSent, 0) / apSyntax.length;
  const avgCV = apSyntax.reduce((s, p) => s + p.sentLengthCV, 0) / apSyntax.length;

  console.log(`  Passive voice/sent: ${avgPassive.toFixed(2)}`);
  console.log(`  Relative clauses:   ${avgRelC.toFixed(1)} per passage`);
  console.log(`  Conditionals:       ${avgCond.toFixed(1)} per passage`);
  console.log(`  Comparisons:        ${avgComp.toFixed(1)} per passage`);
  console.log(`  Punct complexity:   ${avgPunct.toFixed(2)} commas/semis per sentence`);
  console.log(`  Sent length CV:     ${avgCV.toFixed(3)} (variation coefficient)`);
  console.log(`  Sent length range:  ${Math.min(...apSyntax.map(s => s.minSentLength))} — ${Math.max(...apSyntax.map(s => s.maxSentLength))} words`);
  console.log();

  // ── 3. DISCOURSE PROFILE ──
  console.log("━━━ 3. DISCOURSE PROFILE (Academic Passages) ━━━\n");
  const apDiscourse = apTexts.map(discourseProfile);
  const avgHedge = apDiscourse.reduce((s, d) => s + d.hedgeRatio, 0) / apDiscourse.length;
  const avgEvid = apDiscourse.reduce((s, d) => s + d.evidenceCount, 0) / apDiscourse.length;
  const avgTrans = apDiscourse.reduce((s, d) => s + d.totalTransitions, 0) / apDiscourse.length;
  const avgDef = apDiscourse.reduce((s, d) => s + d.definitionPatterns, 0) / apDiscourse.length;

  console.log(`  Hedging ratio:      ${(avgHedge * 100).toFixed(2)}% of words are hedges`);
  console.log(`  Evidence markers:   ${avgEvid.toFixed(1)} per passage`);
  console.log(`  Transitions total:  ${avgTrans.toFixed(1)} per passage`);
  console.log(`  Definition markers: ${avgDef.toFixed(1)} per passage`);

  // Transition breakdown
  const transAgg = {};
  for (const d of apDiscourse) {
    for (const [cat, count] of Object.entries(d.transitionCounts)) {
      transAgg[cat] = (transAgg[cat] || 0) + count;
    }
  }
  console.log(`  Transition types:`);
  for (const [cat, count] of Object.entries(transAgg).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat.padEnd(15)} ${count}`);
  }

  // Evidence examples
  const evidExamples = apDiscourse.flatMap(d => d.evidenceExamples);
  if (evidExamples.length > 0) {
    console.log(`  Evidence examples:  ${[...new Set(evidExamples)].slice(0, 5).join(" | ")}`);
  }
  console.log();

  // ── 4. QUESTION STEM PATTERNS ──
  console.log("━━━ 4. QUESTION STEM PATTERNS ━━━\n");
  const stemAnalysis = analyzeStems(allAPQuestions);
  console.log(`  Academic Passage (${stemAnalysis.totalQuestions} questions):`);
  for (const [pat, count] of Object.entries(stemAnalysis.patterns).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pat.padEnd(25)} ${count}`);
  }
  console.log(`  Avg stem length:    ${stemAnalysis.avgStemWordCount} words`);
  console.log(`  Stem starts with:   ${Object.entries(stemAnalysis.stemStarts).map(([k, v]) => `${k}(${v})`).join(", ")}`);
  console.log();

  const rdlStemAnalysis = analyzeStems(allRDLQuestions);
  console.log(`  Read in Daily Life (${rdlStemAnalysis.totalQuestions} questions):`);
  for (const [pat, count] of Object.entries(rdlStemAnalysis.patterns).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pat.padEnd(25)} ${count}`);
  }
  console.log(`  Avg stem length:    ${rdlStemAnalysis.avgStemWordCount} words`);
  console.log();

  // ── 5. OPTION CONSTRUCTION ──
  console.log("━━━ 5. OPTION CONSTRUCTION ━━━\n");
  const apOptions = analyzeOptions(allAPQuestions);
  console.log(`  Academic Passage:`);
  console.log(`    Correct is longest:    ${apOptions.correctIsLongestPct}%`);
  console.log(`    Correct is shortest:   ${apOptions.correctIsShortestPct}%`);
  console.log(`    All same length:       ${apOptions.allSameLengthPct}%`);
  console.log(`    Grammatical parallel:  ${apOptions.grammaticalParallelismPct}%`);
  console.log(`    Avg option len by pos: A=${apOptions.avgOptionLengthByPosition.A} B=${apOptions.avgOptionLengthByPosition.B} C=${apOptions.avgOptionLengthByPosition.C} D=${apOptions.avgOptionLengthByPosition.D}`);
  console.log(`    Answer distribution:   A=${apOptions.correctAnswerDist.A} B=${apOptions.correctAnswerDist.B} C=${apOptions.correctAnswerDist.C} D=${apOptions.correctAnswerDist.D}`);
  console.log();

  const rdlOptions = analyzeOptions(allRDLQuestions);
  console.log(`  Read in Daily Life:`);
  console.log(`    Correct is longest:    ${rdlOptions.correctIsLongestPct}%`);
  console.log(`    Correct is shortest:   ${rdlOptions.correctIsShortestPct}%`);
  console.log(`    Grammatical parallel:  ${rdlOptions.grammaticalParallelismPct}%`);
  console.log(`    Answer distribution:   A=${rdlOptions.correctAnswerDist.A} B=${rdlOptions.correctAnswerDist.B} C=${rdlOptions.correctAnswerDist.C} D=${rdlOptions.correctAnswerDist.D}`);
  console.log();

  // ── 6. DISTRACTOR DEEP DIVE ──
  console.log("━━━ 6. DISTRACTOR STRATEGY (Academic Passage) ━━━\n");
  const distractorAnalysis = analyzeDistractors(allAPQuestions);
  console.log("  By question type:");
  for (const [qt, patterns] of Object.entries(distractorAnalysis.byType).sort()) {
    const total = Object.values(patterns).reduce((s, v) => s + v, 0);
    const parts = Object.entries(patterns).sort((a, b) => b[1] - a[1]).map(([p, c]) => `${p}:${c}`).join(", ");
    console.log(`    ${qt.padEnd(25)} (${total}) ${parts}`);
  }
  console.log(`\n  Distractor vs correct length: longer=${distractorAnalysis.byCorrectLen.longer} shorter=${distractorAnalysis.byCorrectLen.shorter} equal=${distractorAnalysis.byCorrectLen.equal}`);
  console.log();

  // ── 7. CTW BLANK ANALYSIS ──
  console.log("━━━ 7. COMPLETE THE WORDS — Blank Analysis ━━━\n");
  const ctwBlanks = analyzeCTWBlanks(ctwItems);
  console.log(`  Total blanks:       ${ctwBlanks.totalBlanks}`);
  console.log(`  Function words:     ${ctwBlanks.functionWordBlanks} (${ctwBlanks.functionWordPct}%)`);
  console.log(`  Content words:      ${ctwBlanks.contentWordBlanks}`);
  console.log(`  AWL blanks:         ${ctwBlanks.awlBlanks} (${ctwBlanks.awlBlankPct}% of content)`);
  console.log(`  Hard blanks (<35%): ${ctwBlanks.hardBlankCount}`);
  console.log(`  Easy blanks (>45%): ${ctwBlanks.easyBlankCount}`);
  console.log(`  Morphological endings:`);
  for (const [ending, count] of Object.entries(ctwBlanks.endings).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${ending.padEnd(15)} ${count}`);
  }
  if (ctwBlanks.hardBlankExamples.length > 0) {
    console.log(`  Hard blank examples: ${ctwBlanks.hardBlankExamples.join(", ")}`);
  }
  console.log();

  // ── 8. RDL REGISTER ──
  console.log("━━━ 8. READ IN DAILY LIFE — Register Analysis ━━━\n");
  const rdlRegister = analyzeRDLRegister(rdlItems);
  console.log(`  Informal markers:`);
  for (const [k, v] of Object.entries(rdlRegister.informal)) {
    if (v > 0) console.log(`    ${k.padEnd(18)} ${v}`);
  }
  console.log(`  Formal markers:`);
  for (const [k, v] of Object.entries(rdlRegister.formal)) {
    if (v > 0) console.log(`    ${k.padEnd(18)} ${v}`);
  }
  console.log();

  // ── 9. AP PARAGRAPH STRUCTURE ──
  console.log("━━━ 9. ACADEMIC PASSAGE — Paragraph Structure ━━━\n");
  const apStructure = analyzeAPStructure(apItems);
  console.log(`  Avg paragraphs:     ${apStructure.avgParaCount}`);
  console.log(`  Avg para length:    ${apStructure.avgParaLength} words`);
  console.log(`  Avg topic sent len: ${apStructure.avgTopicSentenceLen} words`);
  console.log(`  Para intro types:`);
  for (const [type, count] of Object.entries(apStructure.paragraphIntroTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type.padEnd(15)} ${count}`);
  }
  console.log();

  // ── SAVE FULL REPORT ──
  const fullReport = {
    generated_at: new Date().toISOString(),
    sample_counts: {
      completeTheWords: ctwItems.length,
      readInDailyLife: rdlItems.length,
      academicPassage: apItems.length,
      totalQuestions: allQuestions.length,
    },
    lexicalProfile: {
      awlCoverageAvg: +(avgAWL * 100).toFixed(1),
      lexicalDensityAvg: +(avgLD * 100).toFixed(1),
      avgWordLength: +avgWL.toFixed(1),
      longWordRatio: +(avgLong * 100).toFixed(1),
      awlWordsFound: [...allAWL].sort(),
    },
    syntacticProfile: {
      passivePerSentAvg: +avgPassive.toFixed(2),
      relativeClausesPerPassage: +avgRelC.toFixed(1),
      conditionalsPerPassage: +avgCond.toFixed(1),
      comparisonsPerPassage: +avgComp.toFixed(1),
      punctComplexityPerSent: +avgPunct.toFixed(2),
      sentLengthVariation: +avgCV.toFixed(3),
    },
    discourseProfile: {
      hedgeRatio: +(avgHedge * 100).toFixed(2),
      evidenceMarkersPerPassage: +avgEvid.toFixed(1),
      transitionsPerPassage: +avgTrans.toFixed(1),
      definitionsPerPassage: +avgDef.toFixed(1),
      transitionBreakdown: transAgg,
    },
    questionStems: { academicPassage: stemAnalysis, readInDailyLife: rdlStemAnalysis },
    optionConstruction: { academicPassage: apOptions, readInDailyLife: rdlOptions },
    distractorStrategies: distractorAnalysis,
    ctwBlankProfile: ctwBlanks,
    rdlRegister: rdlRegister,
    apParagraphStructure: apStructure,
  };

  const reportPath = join(PROFILE_DIR, "etsFlavor.json");
  writeFileSync(reportPath, JSON.stringify(fullReport, null, 2));
  console.log(`Full report saved to: ${reportPath}`);
}

main();
