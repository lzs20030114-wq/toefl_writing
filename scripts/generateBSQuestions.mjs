/**
 * Robust Build a Sentence generator pipeline:
 * 1) online candidate generation
 * 2) hard validation (schema/runtime)
 * 3) AI quality scoring filter
 * 4) pool-based set assembly with TPO difficulty mix (1/7/2)
 *
 * Usage:
 *   node scripts/generateBSQuestions.mjs
 *
 * Env:
 *   DEEPSEEK_API_KEY=...
 *   DEEPSEEK_PROXY_URL=http://127.0.0.1:10808   (optional)
 *   BS_TARGET_SETS=6                              (optional)
 *   BS_MAX_ROUNDS=32                              (optional)
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, readdirSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { callDeepSeekViaCurl, resolveProxyUrl, formatDeepSeekError } = require("../lib/ai/deepseekHttp.js");
const { validateQuestionSet, validateQuestion } = require("../lib/questionBank/buildSentenceSchema.js");
const { hardFailReasons, warnings: qualityWarnings } = require("../lib/questionBank/qualityGateBuildSentence.js");
const {
  getStructuredPromptParts,
  validateStructuredPromptParts,
} = require("../lib/questionBank/buildSentencePromptContract.js");
const {
  normalizeRuntimeQuestion,
  validateRuntimeQuestion,
} = require("../lib/questionBank/runtimeModel.js");
const {
  estimateQuestionDifficulty,
  evaluateSetDifficultyAgainstTarget,
  ETS_2026_TARGET_COUNTS_10,
} = require("../lib/questionBank/difficultyControl.js");
const { isEmbeddedQuestion, isNegation, ETS_STYLE_TARGETS } = require("../lib/questionBank/etsProfile.js");
const { validateAllSets } = require("./validate-bank.js");
const { normalizeText, endsWithQuestionMark, uniqBy, shuffle, parseJsonArray, parseReviewJson, parseConsistencyJson } = require("../lib/bsGen/utils.js");
const _cb = require("../lib/bsGen/circuitBreaker.js");
const _pb = require("../lib/bsGen/promptBuilders.js");

const OUTPUT_PATH = process.env.BS_OUTPUT_PATH ? resolve(String(process.env.BS_OUTPUT_PATH)) : resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const RESERVE_PATH = process.env.BS_RESERVE_PATH
  ? resolve(String(process.env.BS_RESERVE_PATH))
  : resolve(__dirname, "..", "data", "buildSentence", "reserve_pool.json");
const CIRCUIT_BREAKER_LOG_PATH = process.env.BS_CIRCUIT_BREAKER_LOG_PATH
  ? resolve(String(process.env.BS_CIRCUIT_BREAKER_LOG_PATH))
  : resolve(__dirname, "..", "data", "buildSentence", "circuit_breaker_log.json");
const DIAGNOSTICS_PATH = process.env.BS_DIAGNOSTICS_PATH
  ? resolve(String(process.env.BS_DIAGNOSTICS_PATH))
  : OUTPUT_PATH.replace(/\.json$/i, ".diagnostics.json");
const ANSWER_HASHES_PATH = resolve(__dirname, "..", "data", "buildSentence", "answer_hashes.json");
const CHECKPOINT_PATH = resolve(__dirname, "..", "data", "buildSentence", "generation_checkpoint.json");
const RUN_HISTORY_PATH = resolve(__dirname, "..", "data", "buildSentence", "run_history.json");
const RESERVE_ARCHIVE_DIR = resolve(__dirname, "..", "data", "buildSentence", "archive");
const RESERVE_POOL_CAP = 500;
const TARGET_SET_COUNT = Number(process.env.BS_TARGET_SETS || 6);
const MIN_REVIEW_SCORE = Number(process.env.BS_MIN_REVIEW_SCORE || 78);
const MIN_REVIEW_OVERALL = Number(process.env.BS_MIN_REVIEW_OVERALL || 84);
const MIN_ETS_SIMILARITY = Number(process.env.BS_MIN_ETS_SIMILARITY || 72);
const MIN_SOLVABILITY = Number(process.env.BS_MIN_SOLVABILITY || 78);
const CIRCUIT_BREAKER_WINDOW = 3;
const CIRCUIT_BREAKER_MIN_GENERATED = 4;
const CIRCUIT_BREAKER_MIN_ACCEPT_RATE = 0.2;
const CIRCUIT_BREAKER_COOLDOWN_ROUNDS = 3;
// Types that must never be circuit-breaker blocked (rare but required for TPO distribution)
const CIRCUIT_BREAKER_EXEMPT_TYPES = new Set(["interrogative"]);

function loadEnv() {
  const paths = [
    resolve(__dirname, "..", ".env.local"),
    resolve(__dirname, "..", ".env"),
  ];
  for (const p of paths) {
    try {
      const txt = readFileSync(p, "utf8");
      txt.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
        if (!m) return;
        if (process.env[m[1]]) return;
        process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch (_) {
      // ignore missing env file
    }
  }
}

// normalizeText, endsWithQuestionMark, uniqBy, shuffle, parseJsonArray → lib/bsGen/utils.js

/**
 * Split a chunk that has more than maxWords into sub-chunks.
 * Strategy: split into ceil and floor halves to keep collocations natural.
 */
function autoSplitChunk(chunk, maxWords = 3) {
  const words = chunk.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [chunk];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

// ── Multi-word chunk control ──────────────────────────────────────────────────
// TPO data: ~77% single-word chunks, ~23% multi-word (1-2 per question).
// These patterns must stay as multi-word units; everything else should be split.

const _NEG_AUX = new Set([
  "did","does","do","has","have","had","is","was","were","will",
  "would","could","should","am","are","can","must",
]);

// Specific aux+word pairs that are legitimate grammar units
const _AUX_PAIRS = new Set([
  "had been","has been","have been","will be","would be","could be","should be",
  "must be","can be","is being","was being","were being",
  "had gone","had done","had finished","had arrived","had started","had received",
  "had decided","had left","had found","had seen","had heard","had told",
  "had made","had taken","had given","had said","had come","had read",
  "had thought","had tried","had needed","had known","had expected","had hoped",
  "had planned","had missed","has finished","has started","has arrived",
  "has gone","have gone","have finished","have decided","have received",
  "have found","will have","would have","could have","should have","might have",
  "been extended","been approved","been submitted","been canceled","been completed",
  "been rescheduled","been delayed","been assigned","is scheduled",
  "was scheduled","were scheduled",
]);

// Common phrasal verbs that must stay intact
const _PHRASAL_VERBS = new Set([
  "find out","pick up","carry out","sign up","point out","give up","set up",
  "look up","come up","take off","put off","turn on","turn off","work out",
  "stand out","run out","hand in","look into","drop off","end up","fill out",
  "get back","give back","go over","hang up","hold on","keep up","move on",
  "pay back","show up","shut down","sit down","stay up","check in","check out",
  "call back","turn up","bring up","go through","look after","take over",
  "go ahead","get up","put down","lay out","come back","go back",
]);

// Fixed collocations that stay as a unit
const _COLLOCATIONS = new Set([
  "no idea","what time","on time","in stock","due to","of course","such as",
  "as well","at least","at last","in fact","in general","so far","at all",
  "in time","on schedule","in advance","by now","at once","in case",
  "all right","right now","in charge","in touch","from now",
]);

/**
 * Returns true if a multi-word chunk must stay as a unit (negation cluster,
 * infinitive, aux+participle, phrasal verb, or fixed collocation).
 */
function isMandatoryMultiWord(chunk) {
  const lower = String(chunk || "").toLowerCase().trim();
  const words = lower.split(/\s+/);
  if (words.length < 2) return false;
  // Negation cluster: aux + "not"
  if (words[words.length - 1] === "not" && _NEG_AUX.has(words[0])) return true;
  // Infinitive: "to" + verb
  if (words[0] === "to" && words.length === 2) return true;
  // Specific aux pairs (aux+participle, passive helpers)
  if (_AUX_PAIRS.has(lower)) return true;
  // Phrasal verbs
  if (_PHRASAL_VERBS.has(lower)) return true;
  // Fixed collocations
  if (_COLLOCATIONS.has(lower)) return true;
  return false;
}

/**
 * Optimize chunk granularity by MERGING adjacent single-word chunks into semantic
 * units (det+noun, prep+noun) to bring effective chunk count down to target.
 *
 * Target EC = max(4, min(7, ceil(R × 0.63))) where R = answer_words − prefilled_words.
 * This matches TPO average EC of 5.8.
 *
 * Phase 0: merge any split mandatory pairs (aux+"not", infinitives, etc.)
 * Phase 1: merge adjacent single-word chunks in priority order (det+noun > prep+noun > other)
 * Phase 2: if MW ratio > 35%, split non-mandatory MW chunks (safety valve)
 */
function optimizeChunkGranularity(chunks, distractor, answer, prefilled) {
  const answerWords = String(answer || "")
    .replace(/[.,!?;:]/g, " ").trim().split(/\s+/).filter(Boolean);
  const prefilledWords = (prefilled || []).join(" ").split(/\s+/).filter(Boolean);
  const R = answerWords.length - prefilledWords.length;
  const targetEC = Math.max(4, Math.min(7, Math.ceil(R * 0.63)));

  let result = [...chunks];
  const getEffective = (arr) => arr.filter((c) => c !== distractor);
  const getEC = (arr) => getEffective(arr).length;
  const getMWCount = (arr) =>
    getEffective(arr).filter((c) => c.split(/\s+/).length > 1).length;

  const answerLower = answerWords.map((w) => w.toLowerCase());

  const DETERMINERS = new Set([
    "the","a","an","this","that","these","those",
    "my","his","her","their","our","its","your",
  ]);
  const PREPOSITIONS = new Set([
    "in","on","at","to","for","from","with","by","about","into",
    "through","during","before","after","between","under","over",
    "above","below","against","among","toward","towards","upon",
    "within","without","until","since","along","across","behind",
    "beside","beyond","outside","inside","around","near",
  ]);

  // --- Phase 0: pre-merge split mandatory pairs (aux+not, infinitives, etc.) ---
  for (let i = 0; i < answerLower.length - 1; i++) {
    const pairStr = `${answerLower[i]} ${answerLower[i + 1]}`;
    if (!isMandatoryMultiWord(pairStr)) continue;

    let idx1 = -1, idx2 = -1;
    for (let j = 0; j < result.length; j++) {
      if (result[j] === distractor) continue;
      if (result[j].split(/\s+/).length > 1) continue;
      if (result[j].toLowerCase() === answerLower[i] && idx1 === -1) {
        idx1 = j;
      } else if (result[j].toLowerCase() === answerLower[i + 1] && idx2 === -1 && idx1 !== -1) {
        idx2 = j;
      }
    }
    if (idx1 >= 0 && idx2 >= 0) {
      const merged = `${result[idx1]} ${result[idx2]}`;
      if (idx1 < idx2) { result.splice(idx2, 1); result[idx1] = merged; }
      else { result.splice(idx1, 1); result[idx2] = merged; }
    }
  }

  // --- Phase 1: merge single-word chunks to reach target EC ---
  if (getEC(result) > targetEC) {
    const candidates = [];
    for (let i = 0; i < answerLower.length - 1; i++) {
      const w1 = answerLower[i];
      const w2 = answerLower[i + 1];
      // Skip prep+det pairs — produces incomplete phrases like "on the"
      if (PREPOSITIONS.has(w1) && DETERMINERS.has(w2)) continue;

      let priority;
      if (DETERMINERS.has(w1)) priority = 1;       // det + noun
      else if (PREPOSITIONS.has(w1)) priority = 2;  // prep + content word
      else priority = 4;                            // any other pair

      candidates.push({ answerIdx: i, w1, w2, priority });
    }
    candidates.sort((a, b) => a.priority - b.priority);

    const usedPositions = new Set();
    for (const cand of candidates) {
      if (getEC(result) <= targetEC) break;
      // Skip overlapping positions in the answer
      if (usedPositions.has(cand.answerIdx) || usedPositions.has(cand.answerIdx - 1)) continue;

      const { w1, w2 } = cand;
      let idx1 = -1, idx2 = -1;
      for (let j = 0; j < result.length; j++) {
        if (result[j] === distractor || result[j].split(/\s+/).length > 1) continue;
        if (result[j].toLowerCase() === w1) { idx1 = j; break; }
      }
      for (let j = 0; j < result.length; j++) {
        if (j === idx1 || result[j] === distractor || result[j].split(/\s+/).length > 1) continue;
        if (result[j].toLowerCase() === w2) { idx2 = j; break; }
      }
      if (idx1 === -1 || idx2 === -1) continue;

      const merged = `${result[idx1]} ${result[idx2]}`;
      if (idx1 < idx2) { result.splice(idx2, 1); result[idx1] = merged; }
      else { result.splice(idx1, 1); result[idx2] = merged; }
      usedPositions.add(cand.answerIdx);
    }
  }

  // --- Phase 2: if MW ratio extremely high, split non-mandatory MW chunks ---
  // Only split if ratio > 60% AND resulting EC stays within targetEC + 1
  let splitIter = 2;
  const maxSplitEC = Math.min(targetEC + 1, 8);
  while (splitIter-- > 0) {
    const eff = getEffective(result);
    if (eff.length === 0) break;
    if (getMWCount(result) / eff.length <= 0.60) break;
    if (getEC(result) >= maxSplitEC) break;

    let didSplit = false;
    for (let j = 0; j < result.length; j++) {
      if (result[j] === distractor) continue;
      const words = result[j].split(/\s+/);
      if (words.length > 1 && !isMandatoryMultiWord(result[j])) {
        result.splice(j, 1, ...words);
        didSplit = true;
        break;
      }
    }
    if (!didSplit) break;
  }

  return result;
}

/**
 * Ensure effective chunk count is at least minCount by splitting longest chunks.
 */
function ensureMinChunkCount(chunks, distractor, minCount = 4) {
  let result = [...chunks];
  let maxIter = 10;
  while (maxIter-- > 0) {
    const effective = result.filter((c) => c !== distractor);
    if (effective.length >= minCount) break;
    // find longest effective chunk to split
    let longestIdx = -1;
    let longestLen = 0;
    result.forEach((c, i) => {
      if (c === distractor) return;
      const wLen = c.split(/\s+/).length;
      if (wLen > longestLen) { longestLen = wLen; longestIdx = i; }
    });
    if (longestIdx < 0 || longestLen < 2) break;
    const words = result[longestIdx].split(/\s+/);
    const mid = Math.ceil(words.length / 2);
    result.splice(longestIdx, 1, words.slice(0, mid).join(" "), words.slice(mid).join(" "));
  }
  return result;
}

function wordCountsFromText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[.,!?;:]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .reduce((acc, word) => {
      acc[word] = (acc[word] || 0) + 1;
      return acc;
    }, {});
}

function subtractWordCounts(base, minus) {
  const out = { ...base };
  Object.entries(minus || {}).forEach(([word, count]) => {
    if (!out[word]) return;
    out[word] = Math.max(0, out[word] - count);
    if (out[word] === 0) delete out[word];
  });
  return out;
}

function chunkWordCounts(chunk) {
  return wordCountsFromText(String(chunk || ""));
}

function canConsumeChunk(counts, chunk) {
  const needed = chunkWordCounts(chunk);
  return Object.entries(needed).every(([word, count]) => (counts[word] || 0) >= count);
}

function consumeChunk(counts, chunk) {
  const out = { ...counts };
  Object.entries(chunkWordCounts(chunk)).forEach(([word, count]) => {
    out[word] = Math.max(0, (out[word] || 0) - count);
    if (out[word] === 0) delete out[word];
  });
  return out;
}

/**
 * Auto-fix: bind standalone floating adverbs to their adjacent verb in the answer.
 * e.g. answer="I discussed yesterday..." chunks=["discussed","yesterday"] → ["discussed yesterday"]
 * Only merges when the adverb is immediately adjacent to a content word in the answer.
 */
const _FLOATING_ADVERBS_SET = new Set([
  "yesterday","today","tomorrow","recently","finally","always","often",
  "sometimes","probably","eventually","suddenly","already","usually",
  "still","again","now","soon","later","early","just","once","twice",
  // Sync with buildSentenceSchema.js FLOATING_ADVERBS:
  "certainly","definitely","immediately","perhaps","apparently",
  "afterwards","meanwhile","generally","occasionally",
]);

function autoFixFloatingAdverbs(answer, chunks, distractor) {
  const answerWords = String(answer || "").toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
  const chunkLower = chunks.map(c => String(c || "").toLowerCase().trim());

  // Pass 1: identify which adverb chunks to merge and with which neighbor
  const mergeMap = new Map(); // adverbIdx → { neighborIdx, mergedChunk }
  for (let i = 0; i < chunks.length; i++) {
    const c = chunkLower[i];
    if (c.split(/\s+/).length !== 1 || !_FLOATING_ADVERBS_SET.has(c) || chunks[i] === distractor) continue;

    const adverb = c;
    const adverbAnswerIdx = answerWords.indexOf(adverb);
    if (adverbAnswerIdx < 0) continue;

    // Try to merge with the word before or after in the answer
    let merged = false;
    for (const neighborAnswerIdx of [adverbAnswerIdx - 1, adverbAnswerIdx + 1]) {
      if (neighborAnswerIdx < 0 || neighborAnswerIdx >= answerWords.length) continue;
      const neighbor = answerWords[neighborAnswerIdx];

      // Strategy 1: find neighbor as a single-word chunk
      let neighborChunkIdx = chunkLower.findIndex((ch, j) =>
        j !== i && !mergeMap.has(j) && chunks[j] !== distractor &&
        ch.split(/\s+/).length === 1 && ch === neighbor
      );

      // Strategy 2: find neighbor as the start/end word of a multi-word chunk
      if (neighborChunkIdx < 0) {
        neighborChunkIdx = chunkLower.findIndex((ch, j) => {
          if (j === i || mergeMap.has(j) || chunks[j] === distractor) return false;
          const chWords = ch.split(/\s+/);
          if (chWords.length < 2) return false;
          // Adverb comes after → neighbor is last word of preceding chunk
          if (neighborAnswerIdx < adverbAnswerIdx) return chWords[chWords.length - 1] === neighbor;
          // Adverb comes before → neighbor is first word of following chunk
          return chWords[0] === neighbor;
        });
      }

      if (neighborChunkIdx < 0) continue;

      // Build merged chunk: append/prepend adverb to the neighbor chunk
      const neighborChunk = chunkLower[neighborChunkIdx];
      const mergedChunk = neighborAnswerIdx < adverbAnswerIdx
        ? `${neighborChunk} ${adverb}`
        : `${adverb} ${neighborChunk}`;

      // Guard: merged chunk must not exceed 3 words
      if (mergedChunk.split(/\s+/).length > 3) continue;

      // Verify contiguous in answer
      const mergedWords = mergedChunk.split(/\s+/);
      let found = false;
      for (let k = 0; k <= answerWords.length - mergedWords.length; k++) {
        if (mergedWords.every((w, wi) => answerWords[k + wi] === w)) { found = true; break; }
      }
      if (!found) continue;

      mergeMap.set(i, { neighborIdx: neighborChunkIdx, mergedChunk });
      merged = true;
      break;
    }
    // Strategy 3 fallback: extract edge word from a multi-word chunk that contains
    // the neighbor, split it off, and merge with the adverb
    if (!merged) {
      for (const neighborAnswerIdx of [adverbAnswerIdx - 1, adverbAnswerIdx + 1]) {
        if (neighborAnswerIdx < 0 || neighborAnswerIdx >= answerWords.length) continue;
        const neighbor = answerWords[neighborAnswerIdx];
        const containerIdx = chunkLower.findIndex((ch, j) => {
          if (j === i || mergeMap.has(j) || chunks[j] === distractor) return false;
          const ws = ch.split(/\s+/);
          if (ws.length < 2) return false;
          const wi = ws.indexOf(neighbor);
          return wi === 0 || wi === ws.length - 1; // edge word only
        });
        if (containerIdx < 0) continue;
        const containerWords = chunkLower[containerIdx].split(/\s+/);
        const mergedChunk = neighborAnswerIdx < adverbAnswerIdx
          ? `${neighbor} ${adverb}` : `${adverb} ${neighbor}`;
        if (mergedChunk.split(/\s+/).length > 3) continue;
        const mergedWords = mergedChunk.split(/\s+/);
        let found = false;
        for (let k = 0; k <= answerWords.length - mergedWords.length; k++) {
          if (mergedWords.every((w, wi) => answerWords[k + wi] === w)) { found = true; break; }
        }
        if (!found) continue;
        const wi = containerWords.indexOf(neighbor);
        const remaining = containerWords.filter((_, idx) => idx !== wi).join(" ");
        mergeMap.set(i, { neighborIdx: containerIdx, mergedChunk, remainingContainer: remaining });
        merged = true;
        break;
      }
    }
  }

  // Pass 2: build result, skipping consumed neighbors and replacing adverbs with merged chunks
  const consumed = new Set();
  // Map consumed neighbor → remaining container (from Strategy 3 splits)
  const remainingMap = new Map();
  for (const [advIdx, entry] of mergeMap) {
    consumed.add(advIdx);
    consumed.add(entry.neighborIdx);
    if (entry.remainingContainer) {
      remainingMap.set(entry.neighborIdx, entry.remainingContainer);
    }
  }

  const result = [];
  for (let i = 0; i < chunks.length; i++) {
    if (mergeMap.has(i)) {
      result.push(mergeMap.get(i).mergedChunk);
    } else if (consumed.has(i)) {
      // If this consumed chunk had a remaining portion (Strategy 3), emit it
      if (remainingMap.has(i)) {
        result.push(remainingMap.get(i));
      }
      // else: fully consumed neighbor — skip
    } else {
      result.push(chunks[i]);
    }
  }

  return result;
}

/**
 * Auto-fix: replace bare pronoun prefilled (he/she/they) with the full subject NP from the answer.
 * e.g. answer="The professor wanted to know..." prefilled=["she"] → prefilled=["the professor"]
 */
// Only ban object pronouns — TPO uses bare subject pronouns (she/he/they) freely
const _BANNED_BARE_PREFILLED = new Set(["him", "her", "them"]);

function autoFixBarePrefilledPronoun(answer, prefilled, chunks, distractor) {
  if (!Array.isArray(prefilled) || prefilled.length === 0) return { prefilled, chunks };
  const pfNorm = prefilled[0].trim().toLowerCase();
  if (!_BANNED_BARE_PREFILLED.has(pfNorm)) return { prefilled, chunks };

  // Extract a 2-word subject NP from the start of the answer
  const answerWords = String(answer || "").toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
  if (answerWords.length < 3) return { prefilled, chunks };

  // Common determiners/possessives that start subject NPs
  const DET = new Set(["the","a","an","my","his","her","their","our","some","this","that","these","those"]);
  if (DET.has(answerWords[0])) {
    const newPf = `${answerWords[0]} ${answerWords[1]}`;
    // Remove the new prefilled words from chunks if they appear
    const newPfWords = newPf.split(/\s+/);
    let newChunks = [...chunks];

    // Try to remove exact phrase match first
    const exactIdx = newChunks.findIndex(c =>
      c !== distractor && c.toLowerCase().trim() === newPf
    );
    if (exactIdx >= 0) {
      newChunks.splice(exactIdx, 1);
    } else {
      // Remove individual words
      for (const w of newPfWords) {
        const idx = newChunks.findIndex(c =>
          c !== distractor && c.toLowerCase().trim() === w
        );
        if (idx >= 0) newChunks.splice(idx, 1);
      }
    }

    return { prefilled: [newPf], chunks: newChunks };
  }

  // If first word is a proper noun or similar, try 2-word NP anyway
  // But safer to just drop prefilled entirely than keep a banned one
  return { prefilled: [], chunks };
}

/**
 * Dedup effective chunks by merging duplicate single-word entries with their
 * answer-adjacent neighbor to form a 2-word chunk.
 * e.g. answer="the student told the professor", chunks has two "the":
 *   → merge second "the" with "professor" → "the professor"
 */
function deduplicateChunks(answer, chunks, distractor) {
  const effective = [];
  const effectiveKeys = [];
  for (const c of chunks) {
    if (c === distractor) continue;
    effective.push(c);
    effectiveKeys.push(c.toLowerCase().trim());
  }
  // Find which keys appear more than once
  const counts = {};
  for (const k of effectiveKeys) counts[k] = (counts[k] || 0) + 1;
  const dups = new Set(Object.keys(counts).filter((k) => counts[k] > 1));
  if (dups.size === 0) return chunks;

  const answerWords = answer.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
  const seen = new Set();
  const result = [];

  for (const c of chunks) {
    if (c === distractor) { result.push(c); continue; }
    const key = c.toLowerCase().trim();
    if (!dups.has(key)) { result.push(c); continue; }
    if (!seen.has(key)) { seen.add(key); result.push(c); continue; }

    // This is a duplicate occurrence — try to merge with an adjacent answer word
    // Find all positions of this word in the answer
    let merged = false;
    for (let pos = 0; pos < answerWords.length; pos++) {
      if (answerWords[pos] !== key) continue;
      for (const nPos of [pos + 1, pos - 1]) {
        if (nPos < 0 || nPos >= answerWords.length) continue;
        const neighbor = answerWords[nPos];
        // Check this neighbor exists as a separate chunk in result
        const nIdx = result.findIndex((rc) =>
          rc !== distractor && rc.toLowerCase().trim() === neighbor
        );
        if (nIdx < 0) continue;
        const mergedChunk = nPos > pos ? `${key} ${neighbor}` : `${neighbor} ${key}`;
        if (mergedChunk.split(/\s+/).length > 3) continue;
        // Verify contiguous in answer
        const mw = mergedChunk.split(/\s+/);
        let found = false;
        for (let k2 = 0; k2 <= answerWords.length - mw.length; k2++) {
          if (mw.every((w, wi) => answerWords[k2 + wi] === w)) { found = true; break; }
        }
        if (!found) continue;
        // Replace the neighbor chunk with the merged version
        result[nIdx] = mergedChunk;
        merged = true;
        break;
      }
      if (merged) break;
    }
    if (!merged) {
      result.push(c); // can't merge — keep duplicate (will still fail validation)
    }
  }
  return result;
}

/**
 * Auto-fix: truncate multi-word distractors to a single word.
 * Keeps the word that is NOT in the answer (the actual distractor).
 * e.g. distractor="did submit" → "did" (if "submit" is in answer)
 */
function autoFixMultiWordDistractor(answer, distractor) {
  if (!distractor) return distractor;
  const words = String(distractor).trim().split(/\s+/);
  if (words.length <= 1) return distractor;

  const answerWordsLower = String(answer || "").toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
  const answerSet = new Set(answerWordsLower);

  // Prefer words NOT in the answer (that's the real distractor)
  const notInAnswer = words.filter(w => !answerSet.has(w.toLowerCase()));
  if (notInAnswer.length === 1) return notInAnswer[0].toLowerCase();
  if (notInAnswer.length > 1) return notInAnswer[0].toLowerCase();

  // All words appear in answer — just take the first one
  return words[0].toLowerCase();
}

function autoRepairWordBag(answer, prefilled, chunks, distractor) {
  const answerCounts = wordCountsFromText(answer);
  const prefilledCounts = wordCountsFromText((prefilled || []).join(" "));
  let remaining = subtractWordCounts(answerCounts, prefilledCounts);
  const repaired = [];

  for (const chunk of (chunks || []).filter((c) => c !== distractor)) {
    if (canConsumeChunk(remaining, chunk)) {
      repaired.push(chunk);
      remaining = consumeChunk(remaining, chunk);
    }
  }

  const missingWords = Object.entries(remaining).flatMap(([word, count]) =>
    Array.from({ length: count }, () => word),
  );

  // Only repair the safest case: exactly one single-word gap remains.
  if (missingWords.length === 1) {
    repaired.push(missingWords[0]);
  }

  return distractor == null ? repaired : [...repaired, distractor];
}

function normalizeQuestion(raw, tempId) {
  const q = raw && typeof raw === "object" ? raw : {};

  // Fix 1: lowercase chunks and distractor BEFORE intermediate processing
  // so ensureMinChunkCount's `c !== distractor` comparison is always case-consistent.
  let chunks = Array.isArray(q.chunks)
    ? q.chunks.map((c) => normalizeText(c).toLowerCase()).filter(Boolean)
    : [];
  let prefilled = Array.isArray(q.prefilled)
    ? q.prefilled.map((c) => normalizeText(c)).filter(Boolean)
    : [];
  const rawPositions = (q.prefilled_positions && typeof q.prefilled_positions === "object" && !Array.isArray(q.prefilled_positions))
    ? q.prefilled_positions
    : {};

  let distractor = normalizeText(q.distractor)?.toLowerCase() || null;
  const answer = normalizeText(q.answer);
  const answerWords = answer.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);

  // Auto-fix: truncate multi-word distractors to single word
  distractor = autoFixMultiWordDistractor(answer, distractor);

  // Auto-fix: strip unsafe distractors (be-verb/do-group/modal swaps) instead of rejecting.
  // checkDistractorSafety would reject these in hardValidateQuestion; auto-stripping here
  // converts the question to a no-distractor item, saving it from total rejection.
  if (distractor) {
    const safetyIssue = checkDistractorSafety({ distractor, answer, has_distractor: true });
    if (safetyIssue) {
      chunks = chunks.filter((c) => c !== distractor);
      distractor = null;
    }
  }

  // Auto-fix: replace banned bare pronoun prefilled with subject NP from answer
  const bareFix = autoFixBarePrefilledPronoun(answer, prefilled, chunks, distractor);
  prefilled = bareFix.prefilled;
  chunks = bareFix.chunks;

  // Auto-fix: truncate prefilled longer than 3 words to 2-word subject NP
  if (prefilled.length > 0) {
    const pfWords = prefilled[0].trim().split(/\s+/);
    if (pfWords.length >= 4) {
      // Keep first 2 words as subject NP; move the rest back to chunks
      const kept = pfWords.slice(0, 2).join(" ");
      const overflow = pfWords.slice(2);
      prefilled = [kept];
      chunks = [...overflow.map(w => w.toLowerCase()), ...chunks];
    }
  }

  // Auto-fix: Split any chunk with >3 words
  chunks = chunks.flatMap((c) => autoSplitChunk(c, 3));

  // Auto-fix: Remove prefilled coverage from chunks.
  // AI often duplicates prefilled words into chunks in two ways:
  //   (a) exact phrase match: prefilled=["the report"], chunks includes "the report"
  //   (b) split words: prefilled=["the report"], chunks includes "the" and "report" separately
  // Strategy: greedily consume prefilled words from chunks (single-word first).
  if (prefilled.length > 0) {
    // Build a word-level budget of what prefilled covers
    const prefilledWordBudget = [];
    prefilled.forEach((pf) => {
      pf.toLowerCase().split(/\s+/).filter(Boolean).forEach((w) => prefilledWordBudget.push(w));
    });
    // Remove exact-phrase matches first
    const prefilledPhraseSet = new Set(prefilled.map((p) => p.toLowerCase()));
    chunks = chunks.filter((c) => !prefilledPhraseSet.has(c.toLowerCase()));
    // Then remove single-word chunks that are covered by the prefilled budget
    const budget = [...prefilledWordBudget];
    chunks = chunks.filter((c) => {
      const cWords = c.toLowerCase().split(/\s+/);
      if (cWords.length === 1) {
        const idx = budget.indexOf(cWords[0]);
        if (idx !== -1) { budget.splice(idx, 1); return false; }
      }
      return true;
    });
  }

  // Repair the most common deterministic word-bag failures before validation.
  chunks = autoRepairWordBag(answer, prefilled, chunks, distractor);

  // Auto-fix: bind floating adverbs to adjacent verb (must happen after word-bag repair)
  chunks = autoFixFloatingAdverbs(answer, chunks, distractor);

  // Auto-fix: Ensure at least 4 effective chunks
  chunks = ensureMinChunkCount(chunks, distractor, 4);

  // Auto-fix: Optimize chunk granularity — merge single-word chunks into semantic
  // units (det+noun, prep+noun) to reach TPO-calibrated target EC (~5.8 avg).
  // Also pre-merges split mandatory pairs (aux+not) and splits excess MW if ratio > 35%.
  chunks = optimizeChunkGranularity(chunks, distractor, answer, prefilled);

  // Auto-fix: deduplicate chunks by merging duplicate entries with answer neighbors
  chunks = deduplicateChunks(answer, chunks, distractor);

  // Auto-fix: Correct prefilled_positions based on actual answer text.
  // Fix 2: fallback lookup is case-insensitive so AI key-case mismatches don't lose positions.
  const rawPositionsLower = Object.fromEntries(
    Object.entries(rawPositions).map(([k, v]) => [k.toLowerCase(), v])
  );
  const correctedPositions = {};
  prefilled.forEach((pf) => {
    const pfWords = pf.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
    if (pfWords.length === 0) return;

    let found = false;
    for (let i = 0; i <= answerWords.length - pfWords.length; i++) {
      const slice = answerWords.slice(i, i + pfWords.length);
      if (slice.every((w, idx) => w === pfWords[idx])) {
        correctedPositions[pf] = i;
        found = true;
        break;
      }
    }
    // Fallback: case-insensitive key lookup on original AI-provided positions
    if (!found) {
      const fallback = rawPositionsLower[pf.toLowerCase()];
      if (fallback !== undefined) correctedPositions[pf] = fallback;
    }
  });

  // Auto-fix: drop any prefilled item that couldn't be located in the answer.
  // If AI invents a prefilled phrase not present in answer, discard it silently
  // (question becomes harder but word bag stays valid).
  const validPrefilled = prefilled.filter((pf) => correctedPositions[pf] !== undefined);

  const promptParts = getStructuredPromptParts(q);
  const promptContract = validateStructuredPromptParts(q, { requireStructured: false });
  const renderedPrompt = promptParts.hasStructured ? promptContract.renderedPrompt : normalizeText(q.prompt);

  return {
    id: normalizeText(q.id) || tempId,
    prompt: renderedPrompt,
    ...(promptParts.hasStructured
      ? {
          prompt_context: promptParts.context,
          prompt_task_kind: promptParts.taskKind,
          prompt_task_text: promptParts.taskText,
        }
      : {}),
    answer,
    chunks,
    prefilled: validPrefilled,
    prefilled_positions: correctedPositions,
    distractor,
    has_question_mark: endsWithQuestionMark(answer),
    grammar_points: Array.isArray(q.grammar_points)
      ? q.grammar_points.map((g) => normalizeText(g)).filter(Boolean)
      : [],
  };
}

/**
 * Post-normalization: redistribute prefilled positions to match TPO distribution.
 * TPO: 53% start (pos 0), 31% mid, 16% end.
 * Currently all AI-generated questions have prefilled at position 0.
 * This function deterministically moves some prefilled items to mid/end positions
 * by swapping the current prefilled with a suitable chunk from the answer.
 */
function maybeReassignPrefilledPosition(q) {
  // Only process questions with single prefilled at position 0
  if (!q.prefilled || q.prefilled.length === 0) return q;
  if (!q.prefilled_positions || Object.keys(q.prefilled_positions).length === 0) return q;
  const currentPos = Object.values(q.prefilled_positions)[0];
  if (currentPos !== 0) return q; // already non-start

  // Decide target: 53% keep start, 31% mid, 16% end
  const r = Math.random();
  if (r < 0.53) return q; // keep at start

  const targetRegion = r < 0.84 ? "mid" : "end"; // 0.53-0.84 = mid (31%), 0.84-1.0 = end (16%)

  const answerWords = q.answer.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
  const oldPrefilled = q.prefilled[0];
  const BANNED = new Set(["not", "him", "her", "them"]);

  // Map each effective chunk to its position in the answer
  const chunkInfos = [];
  const usedPositions = new Set();
  const effectiveChunks = (q.chunks || []).filter(
    (c) => c.toLowerCase().trim() !== (q.distractor || "").toLowerCase().trim()
  );

  for (const chunk of effectiveChunks) {
    const cWords = chunk.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
    for (let i = 0; i <= answerWords.length - cWords.length; i++) {
      if (usedPositions.has(i)) continue;
      if (cWords.every((w, j) => w === answerWords[i + j])) {
        chunkInfos.push({ chunk, pos: i, len: cWords.length });
        for (let j = i; j < i + cWords.length; j++) usedPositions.add(j);
        break;
      }
    }
  }

  // Find candidates for new prefilled based on target region
  let candidates;
  if (targetRegion === "mid") {
    candidates = chunkInfos.filter((c) => c.pos > 0 && c.pos + c.len < answerWords.length);
  } else {
    candidates = chunkInfos.filter((c) => c.pos + c.len >= answerWords.length);
  }

  // Filter: must be 1-3 words, not banned, not a standalone function word
  const FUNCTION_WORDS = new Set(["a", "an", "the", "is", "was", "are", "were", "be", "to", "of", "in", "on", "at", "for", "and", "or", "but"]);
  candidates = candidates.filter((c) => {
    if (c.len >= 4) return false;
    const norm = c.chunk.toLowerCase().trim();
    if (BANNED.has(norm)) return false;
    if (c.len === 1 && FUNCTION_WORDS.has(norm)) return false;
    return true;
  });

  if (candidates.length === 0) return q; // can't reassign

  // Prefer 2-word chunks for mid, 1-2 word for end
  candidates.sort((a, b) => {
    if (targetRegion === "mid") {
      // Prefer 2-word phrases (like "found out", "wanted to")
      const aPref = a.len === 2 ? 0 : a.len === 1 ? 1 : 2;
      const bPref = b.len === 2 ? 0 : b.len === 1 ? 1 : 2;
      if (aPref !== bPref) return aPref - bPref;
    }
    return a.len - b.len;
  });

  const chosen = candidates[0];

  // Swap: chosen chunk → prefilled, old prefilled → chunk
  const newChunks = q.chunks.filter((c) => c !== chosen.chunk);
  // Add old prefilled as a single chunk (lowercase)
  newChunks.push(oldPrefilled.toLowerCase());

  return {
    ...q,
    prefilled: [chosen.chunk],
    prefilled_positions: { [chosen.chunk]: chosen.pos },
    chunks: newChunks,
  };
}

function stableAnswerKey(q) {
  return normalizeText(q.answer).toLowerCase();
}

// ── Global answer deduplication ──
function hashAnswer(q) {
  return createHash("sha256").update(stableAnswerKey(q)).digest("hex");
}
function loadAnswerHashes() {
  try { return new Set(JSON.parse(readFileSync(ANSWER_HASHES_PATH, "utf8"))); }
  catch (_) { return new Set(); }
}
function saveAnswerHashes(hashSet) {
  writeFileSync(ANSWER_HASHES_PATH, JSON.stringify([...hashSet]) + "\n", "utf8");
}

// ── Generation checkpointing ──
function saveCheckpoint(data) {
  try { writeFileSync(CHECKPOINT_PATH, JSON.stringify(data) + "\n", "utf8"); }
  catch (_) { /* non-fatal */ }
}
function loadCheckpoint() {
  try { return JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8")); }
  catch (_) { return null; }
}
function deleteCheckpoint() {
  try { if (existsSync(CHECKPOINT_PATH)) unlinkSync(CHECKPOINT_PATH); }
  catch (_) { /* non-fatal */ }
}

// P1.3: Cross-run metrics log — append-only run history
function appendRunHistory(entry) {
  let history = [];
  try { history = JSON.parse(readFileSync(RUN_HISTORY_PATH, "utf8")); } catch (_) {}
  if (!Array.isArray(history)) history = [];
  history.push(entry);
  writeFileSync(RUN_HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

function checkAcceptanceTrend() {
  let history = [];
  try { history = JSON.parse(readFileSync(RUN_HISTORY_PATH, "utf8")); } catch (_) {}
  if (!Array.isArray(history) || history.length < 3) return;
  const recent = history.slice(-5);
  const rates = recent.map(r => r.acceptance_rate).filter(r => typeof r === "number");
  if (rates.length < 3) return;
  // Warn if last 3 runs all have acceptance rate below 15%
  const last3 = rates.slice(-3);
  if (last3.every(r => r < 0.15)) {
    console.warn(`[trend-warning] Last ${last3.length} runs had low acceptance rates: ${last3.map(r => (r * 100).toFixed(1) + "%").join(", ")}`);
    console.warn(`  Consider: diversify topics, adjust quality thresholds, or review reject reasons.`);
  }
  // Warn if acceptance rate is declining over last 3+
  if (rates.length >= 3) {
    const declining = rates.every((r, i) => i === 0 || r <= rates[i - 1]);
    if (declining && rates[rates.length - 1] < rates[0] * 0.5) {
      console.warn(`[trend-warning] Acceptance rate declining: ${rates.map(r => (r * 100).toFixed(1) + "%").join(" → ")}`);
    }
  }
}

/**
 * Classify a question's answer into one of 6 TPO structural types.
 * Used for quota tracking and targeted generation.
 */
function classifyAnswerType(q) {
  const a = String(q.answer || "").toLowerCase();
  const gps = (Array.isArray(q?.grammar_points) ? q.grammar_points : []).map((x) => String(x || "").toLowerCase()).join(" | ");
  // Interrogative frame: polite information-seeking question with embedded clause
  if (
    /^(can you tell me|could you tell me|do you know|would you mind telling me|could you explain|can you remind me)\b/i.test(q.answer) ||
    /\b(interrogative frame|polite question frame)\b/.test(gps)
  )
    return "interrogative";
  // 1st-person embedded — check BEFORE 3rd-reporting to prevent "I asked..." being misclassified
  if (
    /\b(1st-embedded|1st person|1st-person)\b/.test(gps) ||
    /\b(have no idea|had no idea|don't understand|didn't understand|couldn't understand|found out|would love to know|can't decide|don't know|didn't know|do not know|did not know|does not know)\b/.test(a) ||
    (/^i\b/i.test(a) && /\b(what|when|where|who|how|whether|if)\b/.test(a) && !/^i (did not|didn't|do not|don't|have not|haven't|could not|couldn't|am not|was not|wasn't|are not|aren't)\b/i.test(a))
  )
    return "1st-embedded";
  // 3rd-person reporting (only after ruling out 1st-person)
  if (
    /\b(wanted to know|asked|inquired|was curious|were curious|needed to know|was wondering|were wondering|wants to know|needs to know|curious about)\b/.test(a) ||
    /\b(3rd-reporting|reporting verb|indirect question)\b/.test(gps)
  )
    return "3rd-reporting";
  // Relative/contact clause
  if (
    /\bthe \w+.*(?: i | you | he | she | we | they )|\b(?:that|which|who|whom) (?:i |you |he |she |we |they )/i.test(a) ||
    /\b(relative clause|contact clause)\b/.test(gps)
  )
    return "relative";
  // Negation
  if (/\b(did not|didn't|have not|haven't|could not|couldn't|was not|wasn't|is not|isn't|am not|are not|aren't|has not|hasn't|do not|don't|no longer|not able|were not|weren't)\b/.test(a))
    return "negation";
  return "direct";
}

/**
 * Per-set quota: how many questions of each type 脳 difficulty per 10-question set.
 * Derived from statistical analysis of 60 real TPO questions across 6 sets.
 * Difficulty distribution per set: easy=1, medium=7, hard=2.
 * Type distribution within each difficulty: from TPO analysis.
 *
 * easy  (1/set):  negation锟?5%, 3rd-reporting锟?8%, interrogative锟?8%, 1st-embedded锟?%
 * medium (7/set): 3rd-reporting锟?8%, negation锟?2%, 1st-embedded锟?2%, interrogative锟?%, direct锟?%, relative锟?%
 * hard  (2/set):  3rd-reporting锟?5%, 1st-embedded锟?5%, relative锟?9%, interrogative锟?3%, direct锟?3%, negation锟?%
 */
const TYPE_LIST = ["negation", "3rd-reporting", "1st-embedded", "interrogative", "direct", "relative"];
const EMBEDDED_HEAVY_TYPES = new Set(["3rd-reporting", "1st-embedded", "interrogative"]);
const NON_EMBEDDED_TYPES = new Set(TYPE_LIST.filter((type) => !EMBEDDED_HEAVY_TYPES.has(type)));
const RELIABLE_NON_EMBEDDED_TYPES = new Set(["direct", "relative"]);
const WILLING_TYPES = ["3rd-reporting", "negation", "1st-embedded"]; // AI generates naturally
const TPO_TYPE_TARGET_RATIO = Object.freeze({
  "negation": 0.183,
  "3rd-reporting": 0.417,
  "1st-embedded": 0.15,
  "interrogative": 0.1,
  "direct": 0.067,
  "relative": 0.083,
});

// buildRejectFeedbackHints → lib/bsGen/promptBuilders.js
const buildRejectFeedbackHints = _pb.buildRejectFeedbackHints;

// TYPE_DIFFICULTY_HINTS, SCENARIO_POOL, PERSONA_POOL → lib/bsGen/promptBuilders.js

// Common words that carry no topic signal — filtered out before similarity comparison
const TOPIC_STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "have", "has", "had", "will", "would", "could", "should",
  "what", "how", "when", "where", "who", "whom", "which", "that", "this",
  "to", "of", "and", "or", "but", "for", "with", "from", "about", "into",
  "you", "your", "yours", "i", "me", "my", "he", "she", "they", "them", "their", "it",
  "not", "no", "any", "some", "if", "then", "than", "so", "very", "just",
  "tell", "told", "asked", "ask", "want", "wanted", "know", "find", "out",
  "say", "said", "wonder", "wondering", "need", "needs",
]);

/**
 * Extract meaningful topic words from a question's prompts and answer.
 * Excludes stopwords and short function words.
 */
function extractTopicWords(q) {
  const text = [
    String(q.prompt_context || ""),
    String(q.prompt_task_text || q.prompt || ""),
    String(q.answer || ""),
  ].join(" ").toLowerCase().replace(/[^a-z\s]/g, " ");
  return new Set(
    text.split(/\s+/).filter((w) => w.length > 4 && !TOPIC_STOPWORDS.has(w))
  );
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Returns true if candidate question is too topically similar to recent pool questions.
 * Only compares against the most recent TOPIC_REPEAT_WINDOW questions — comparing against
 * the entire pool causes over-rejection as the pool grows large (100+ questions).
 * Threshold 0.45: share >45% of meaningful topic words → reject as topic repeat.
 */
const TOPIC_REPEAT_WINDOW = 40;
function isTopicRepeat(q, pool, threshold = 0.45) {
  if (!pool || pool.length === 0) return false;
  const words = extractTopicWords(q);
  if (words.size < 2) return false; // too few topic words to compare reliably
  const recent = pool.slice(-TOPIC_REPEAT_WINDOW);
  for (const existing of recent) {
    if (jaccardSimilarity(words, extractTopicWords(existing)) >= threshold) return true;
  }
  return false;
}

/**
 * Extract recent topic phrases from the accepted pool to help the AI avoid repetition.
 * Returns up to 20 short context/topic strings used in recent questions.
 */
function extractRecentTopics(pool, maxQuestions = 30) {
  const recent = pool.slice(-maxQuestions);
  const topics = [];
  for (const q of recent) {
    // Prefer prompt_context; fall back to first few words of prompt_task_text
    const ctx = String(q.prompt_context || "").trim();
    const task = String(q.prompt_task_text || q.prompt || "").trim();
    const phrase = ctx || task;
    if (phrase) topics.push(phrase);
  }
  // Deduplicate and limit
  return [...new Set(topics)].slice(0, 20);
}

// buildGeneratePrompt → lib/bsGen/promptBuilders.js
const buildGeneratePrompt = _pb.buildGeneratePrompt;

// buildTrapSpecialistPrompt → lib/bsGen/promptBuilders.js
const buildTrapSpecialistPrompt = _pb.buildTrapSpecialistPrompt;
const AMBIGUITY_FUNCTION_WORDS = new Set([
  "the", "a", "an", "to", "of", "and", "or", "but", "from", "that", "this", "it",
  "in", "on", "at", "for", "with", "by", "as", "if", "then", "than", "so", "be",
  "is", "are", "was", "were", "am", "do", "does", "did", "have", "has", "had",
  "before", "after", "about", "into", "over", "under", "already", "please",
]);

const AMBIGUITY_PREP_START_WORDS = new Set([
  "to", "in", "on", "at", "for", "with", "from", "about", "into", "over", "under", "before", "after", "by",
]);

/**
 * Heuristic ambiguity check on a runtime question (with answerOrder + bank).
 * Returns true if the chunk set is structurally prone to multiple valid orderings.
 *
 * Scoring (threshold 0.35):
 *   - Duplicate chunks in bank   +0.22 each
 *   - Single function-word chunks beyond 3  +0.05 each
 *   - Prepositional-start chunks beyond 1   +0.12 each
 */
function hasAmbiguousArrangements(rq) {
  const answerOrder = Array.isArray(rq?.answerOrder) ? rq.answerOrder : [];
  const bank = Array.isArray(rq?.bank) ? rq.bank : [];
  if (answerOrder.length > 8) return false;

  const seen = new Map();
  bank.forEach((chunk) => {
    const key = String(chunk || "").toLowerCase();
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  const duplicateChunks = [...seen.values()].filter((n) => n > 1).length;

  const functionLike = answerOrder.filter((chunk) => {
    const ws = String(chunk || "").toLowerCase().split(/\s+/).filter(Boolean);
    return ws.length === 1 && AMBIGUITY_FUNCTION_WORDS.has(ws[0]);
  }).length;

  const prepStarts = answerOrder.filter((chunk) => {
    const ws = String(chunk || "").toLowerCase().split(/\s+/).filter(Boolean);
    return ws.length > 0 && AMBIGUITY_PREP_START_WORDS.has(ws[0]);
  }).length;

  const score =
    0.05 +
    duplicateChunks * 0.22 +
    Math.max(0, functionLike - 3) * 0.05 +
    Math.max(0, prepStarts - 1) * 0.12;

  return score > 0.35;
}

/**
 * Improved classification using the AI-provided answer_type, 
 * falling back to regex if missing.
 */
function getAnswerType(q) {
  if (q.answer_type && q.answer_type !== "unknown") return q.answer_type;
  return classifyAnswerType(q);
}

function resolvedAnswerType(q) {
  const type = getAnswerType(q);
  return TYPE_LIST.includes(type) ? type : classifyAnswerType(q);
}

/**
 * Compute current pool type脳difficulty counts plus style-feature coverage.
 */
function computePoolState(pool) {
  const state = {};
  for (const diff of ["easy", "medium", "hard"]) {
    state[diff] = {};
    for (const type of TYPE_LIST) {
      state[diff][type] = 0;
    }
  }
  state.typeTotals = Object.fromEntries(TYPE_LIST.map((type) => [type, 0]));
  state.style = {
    total: 0,
    embedded: 0,
    negation: 0,
    distractor: 0,
    qmark: 0,
  };
  for (const q of pool) {
    const meta = attachMeta(q)._meta || {};
    const type = meta.answerType || classifyAnswerType(q);
    const diff = (estimateQuestionDifficulty(q) || {}).bucket || "medium";
    if (state[diff] && type in state[diff]) {
      state[diff][type]++;
    }
    if (type in state.typeTotals) state.typeTotals[type] += 1;
    state.style.total += 1;
    if (meta.isEmbedded) state.style.embedded += 1;
    if (isNegation(q.grammar_points)) state.style.negation += 1;
    if (meta.hasDistractor) state.style.distractor += 1;
    if (meta.hasQuestionMark) state.style.qmark += 1;
  }
  return state;
}

function getDifficultyCounts(poolState) {
  return Object.fromEntries(
    ["easy", "medium", "hard"].map((diff) => [
      diff,
      TYPE_LIST.reduce((sum, type) => sum + ((poolState?.[diff] || {})[type] || 0), 0),
    ]),
  );
}

function clonePoolState(poolState) {
  return JSON.parse(JSON.stringify(poolState || {}));
}

function incrementPoolStateWithQuestion(poolState, q) {
  const next = poolState || computePoolState([]);
  const meta = attachMeta(q)._meta || {};
  const type = meta.answerType || resolvedAnswerType(q);
  const diff = (estimateQuestionDifficulty(q) || {}).bucket || "medium";
  if (next[diff] && type in next[diff]) next[diff][type] += 1;
  if (next.typeTotals && type in next.typeTotals) next.typeTotals[type] += 1;
  if (next.style) {
    next.style.total += 1;
    if (meta.isEmbedded) next.style.embedded += 1;
    if (isNegation(q.grammar_points)) next.style.negation += 1;
    if (meta.hasDistractor) next.style.distractor += 1;
    if (meta.hasQuestionMark) next.style.qmark += 1;
  }
  return next;
}

function incrementPoolStateWithCell(poolState, type, diff) {
  const next = poolState || computePoolState([]);
  if (next[diff] && type in next[diff]) next[diff][type] += 1;
  if (next.typeTotals && type in next.typeTotals) next.typeTotals[type] += 1;
  if (next.style) {
    next.style.total += 1;
    if (EMBEDDED_HEAVY_TYPES.has(type)) next.style.embedded += 1;
    if (type === "negation") next.style.negation += 1; // cell-level: no grammar_points, use type
    next.style.distractor += 1;
    if (type === "interrogative") next.style.qmark += 1;
  }
  return next;
}

function getSlotInventory(poolState) {
  const inventory = {};
  for (const diff of ["easy", "medium", "hard"]) {
    const bucket = poolState?.[diff] || {};
    const embedded = TYPE_LIST
      .filter((type) => EMBEDDED_HEAVY_TYPES.has(type))
      .reduce((sum, type) => sum + (bucket[type] || 0), 0);
    const nonEmbedded = TYPE_LIST
      .filter((type) => NON_EMBEDDED_TYPES.has(type))
      .reduce((sum, type) => sum + (bucket[type] || 0), 0);
    inventory[diff] = {
      total: embedded + nonEmbedded,
      embedded,
      nonEmbedded,
      negation: bucket.negation || 0,
    };
  }
  return inventory;
}

function computeAssemblyState(poolState, targetSetCount = TARGET_SET_COUNT) {
  const diffCounts = getDifficultyCounts(poolState);
  const total = poolState?.style?.total || 0;
  const embedded = poolState?.style?.embedded || 0;
  const negation = poolState?.style?.negation || 0;
  const distractor = poolState?.style?.distractor || 0;
  const qmark = poolState?.style?.qmark || 0;
  const nonEmbedded = Math.max(0, total - embedded);
  const nonNegation = Math.max(0, total - negation);

  const need = {
    easy: ETS_2026_TARGET_COUNTS_10.easy * targetSetCount,
    medium: ETS_2026_TARGET_COUNTS_10.medium * targetSetCount,
    hard: ETS_2026_TARGET_COUNTS_10.hard * targetSetCount,
    embeddedMin: (ETS_STYLE_TARGETS.embeddedMin || 0) * targetSetCount,
    embeddedMax: (ETS_STYLE_TARGETS.embeddedMax || 8) * targetSetCount,
    negationMin: (ETS_STYLE_TARGETS.negationMin || 0) * targetSetCount,
    negationMax: (ETS_STYLE_TARGETS.negationMax || 4) * targetSetCount,
    distractorMin: (ETS_STYLE_TARGETS.distractorMin || 0) * targetSetCount,
    nonEmbeddedMin: Math.max(0, (10 - (ETS_STYLE_TARGETS.embeddedMax || 8)) * targetSetCount),
    nonNegationMin: Math.max(0, (10 - (ETS_STYLE_TARGETS.negationMax || 4)) * targetSetCount),
    qmarkMax: Math.ceil((ETS_STYLE_TARGETS.qmarkMax || 2) * targetSetCount * 0.7),
  };
  const slotInventory = getSlotInventory(poolState);

  const assemblableBy = {
    easy: Math.floor(diffCounts.easy / ETS_2026_TARGET_COUNTS_10.easy),
    medium: Math.floor(diffCounts.medium / ETS_2026_TARGET_COUNTS_10.medium),
    hard: Math.floor(diffCounts.hard / ETS_2026_TARGET_COUNTS_10.hard),
    embedded: need.embeddedMin > 0 ? Math.floor(embedded / (ETS_STYLE_TARGETS.embeddedMin || 1)) : targetSetCount,
    negation: need.negationMin > 0 ? Math.floor(negation / (ETS_STYLE_TARGETS.negationMin || 1)) : targetSetCount,
    negationCap: need.nonNegationMin > 0 ? Math.floor(nonNegation / Math.max(1, 10 - (ETS_STYLE_TARGETS.negationMax || 4))) : targetSetCount,
    distractor: need.distractorMin > 0 ? Math.floor(distractor / (ETS_STYLE_TARGETS.distractorMin || 1)) : targetSetCount,
    nonEmbedded: need.nonEmbeddedMin > 0 ? Math.floor(nonEmbedded / (10 - (ETS_STYLE_TARGETS.embeddedMax || 8))) : targetSetCount,
  };

  const assemblableSets = Math.max(0, Math.min(...Object.values(assemblableBy)));
  const remainingSets = Math.max(0, targetSetCount - assemblableSets);
  const deficits = {
    easy: Math.max(0, need.easy - diffCounts.easy),
    medium: Math.max(0, need.medium - diffCounts.medium),
    hard: Math.max(0, need.hard - diffCounts.hard),
    embedded: Math.max(0, need.embeddedMin - embedded),
    negation: Math.max(0, need.negationMin - negation),
    distractor: Math.max(0, need.distractorMin - distractor),
    nonEmbedded: Math.max(0, need.nonEmbeddedMin - nonEmbedded),
    assemblableSets: remainingSets,
  };

  // Remaining-pool-aware composition check: after assemblable sets consume their
  // share, will the leftover pool have enough non-embedded for the remaining sets?
  // Only activates when pool is mature enough (≥3 sets assemblable) to avoid
  // over-correcting in early rounds when the pool is still small.
  if (remainingSets > 0 && assemblableSets >= 3 && total >= targetSetCount * 7) {
    const perSetNonEmbeddedAvg = 10 - ((ETS_STYLE_TARGETS.embeddedMin || 5) + (ETS_STYLE_TARGETS.embeddedMax || 8)) / 2;
    const consumedNonEmbedded = Math.round(assemblableSets * perSetNonEmbeddedAvg);
    const remainingNonEmbedded = Math.max(0, nonEmbedded - consumedNonEmbedded);
    const neededNonEmbedded = Math.ceil(remainingSets * perSetNonEmbeddedAvg);
    const ratioDeficit = Math.max(0, neededNonEmbedded - remainingNonEmbedded);
    if (ratioDeficit > deficits.nonEmbedded) {
      deficits.nonEmbedded = ratioDeficit;
    }
  }

  const embeddedOverflow = Math.max(0, embedded - need.embeddedMax);
  const negationOverflow = Math.max(0, negation - need.negationMax);
  const qmarkOverflow = Math.max(0, qmark - need.qmarkMax);

  // Ratio-based soft overflow: when embedded ratio exceeds safe assembly threshold
  // (75%), flag it even if absolute count is below embeddedMax. This prevents the
  // pool from becoming too embedded-heavy for the remaining sets.
  const embeddedRatio = total > 0 ? embedded / total : 0;
  const softEmbeddedOverflow = (embeddedRatio > 0.75 && remainingSets > 0)
    ? Math.max(1, Math.ceil(embedded - total * 0.73))
    : 0;
  const effectiveEmbeddedOverflow = Math.max(embeddedOverflow, softEmbeddedOverflow);
  const remainingRecipe = {
    sets: remainingSets,
    diff: {
      easy: deficits.easy,
      medium: deficits.medium,
      hard: deficits.hard,
    },
    style: {
      embeddedMin: deficits.embedded,
      negationMin: deficits.negation,
      distractorMin: deficits.distractor,
      nonEmbeddedMin: deficits.nonEmbedded,
      embeddedCapacity: Math.max(0, need.embeddedMax - embedded),
      negationCapacity: Math.max(0, need.negationMax - negation),
      qmarkCapacity: Math.max(0, need.qmarkMax - qmark),
    },
  };
  const limitingFactors = [
    { key: "hard_shortage", gap: deficits.hard, priority: deficits.hard * 8 },
    { key: "medium_shortage", gap: deficits.medium, priority: deficits.medium * 6 },
    { key: "embedded_shortage", gap: deficits.embedded, priority: deficits.embedded * 7 },
    { key: "non_embedded_shortage", gap: deficits.nonEmbedded, priority: deficits.nonEmbedded * 7 },
    { key: "embedded_overflow", gap: effectiveEmbeddedOverflow, priority: effectiveEmbeddedOverflow * 7 },
    { key: "negation_shortage", gap: deficits.negation, priority: deficits.negation * 5 },
    { key: "negation_overflow", gap: negationOverflow, priority: negationOverflow * 6 },
    { key: "distractor_shortage", gap: deficits.distractor, priority: deficits.distractor * 3 },
    { key: "easy_shortage", gap: deficits.easy, priority: deficits.easy * 2 },
  ]
    .filter((item) => item.gap > 0)
    .sort((a, b) => b.priority - a.priority);
  const progressRatios = {
    easy: need.easy > 0 ? Math.min(1, diffCounts.easy / need.easy) : 1,
    medium: need.medium > 0 ? Math.min(1, diffCounts.medium / need.medium) : 1,
    hard: need.hard > 0 ? Math.min(1, diffCounts.hard / need.hard) : 1,
    embedded: need.embeddedMin > 0 ? Math.min(1, embedded / need.embeddedMin) : 1,
    nonEmbedded: need.nonEmbeddedMin > 0 ? Math.min(1, nonEmbedded / need.nonEmbeddedMin) : 1,
    distractor: need.distractorMin > 0 ? Math.min(1, distractor / need.distractorMin) : 1,
    negation: need.negationMin > 0
      ? (
        negation < need.negationMin
          ? Math.min(1, negation / need.negationMin)
          : (negation <= need.negationMax ? 1 : Math.max(0, need.negationMax / Math.max(1, negation)))
      )
      : 1,
  };
  const progressWeights = {
    easy: ETS_2026_TARGET_COUNTS_10.easy,
    medium: ETS_2026_TARGET_COUNTS_10.medium,
    hard: ETS_2026_TARGET_COUNTS_10.hard,
    embedded: Math.max(1, ETS_STYLE_TARGETS.embeddedMin || 5),
    nonEmbedded: Math.max(1, 10 - (ETS_STYLE_TARGETS.embeddedMax || 8)),
    distractor: Math.max(1, ETS_STYLE_TARGETS.distractorMin || 7),
    negation: Math.max(1, ETS_STYLE_TARGETS.negationMin || 2),
  };
  const progressWeightTotal = Object.values(progressWeights).reduce((sum, value) => sum + value, 0);
  const assemblyProgressScore = Object.entries(progressRatios).reduce(
    (sum, [key, ratio]) => sum + ratio * (progressWeights[key] || 1),
    0,
  ) / Math.max(1, progressWeightTotal);

  return {
    total,
    diffCounts,
    embedded,
    negation,
    distractor,
    qmark,
    nonEmbedded,
    need,
    slotInventory,
    assemblableBy,
    assemblableSets,
    remainingSets,
    remainingRecipe,
    deficits,
    embeddedOverflow: effectiveEmbeddedOverflow,
    negationOverflow,
    qmarkOverflow,
    limitingFactors,
    progressRatios,
    assemblyProgressScore,
  };
}

function isCircuitBreakerCriticalType(type, assemblyState) {
  if (!assemblyState) return false;
  if (type === "negation" && assemblyState.deficits.negation > 0) return true;
  if (EMBEDDED_HEAVY_TYPES.has(type) && assemblyState.deficits.embedded > 0) return true;
  if (NON_EMBEDDED_TYPES.has(type) && (assemblyState.deficits.nonEmbedded > 0 || assemblyState.embeddedOverflow > 0)) {
    return true;
  }
  return false;
}

function evaluatePoolBalance(q, poolState, assemblyState, phase, difficultyTargets, primaryRepairTarget = null) {
  if (phase !== "assembly" || !poolState || !assemblyState) return { ok: true };

  const meta = attachMeta(q)._meta || {};
  const type = meta.answerType || resolvedAnswerType(q);
  const diff = (estimateQuestionDifficulty(q) || {}).bucket || "medium";
  const diffCounts = getDifficultyCounts(poolState);
  const diffDeficits = Object.fromEntries(
    ["easy", "medium", "hard"].map((bucket) => [bucket, Math.max(0, (difficultyTargets?.[bucket] || 0) - (diffCounts[bucket] || 0))]),
  );
  const maxOtherDiffGap = Math.max(
    ...Object.entries(diffDeficits)
      .filter(([bucket]) => bucket !== diff)
      .map(([, gap]) => gap),
    0,
  );

  if (assemblyState.embeddedOverflow > 0 && meta.isEmbedded) {
    return { ok: false, reason: "pool:embedded_overflow" };
  }
  if (assemblyState.negationOverflow > 0 && type === "negation") {
    return { ok: false, reason: "pool:negation_overflow" };
  }
  if (diffDeficits[diff] === 0 && maxOtherDiffGap >= 3 && !isCircuitBreakerCriticalType(type, assemblyState)) {
    return { ok: false, reason: `pool:difficulty_surplus:${diff}` };
  }
  if (assemblyState.qmarkOverflow > 0 && meta.hasQuestionMark) {
    return { ok: false, reason: "pool:qmark_overflow" };
  }

  return { ok: true };
}

function computeQuestionAssemblyValue(q, poolState, assemblyState, options = {}) {
  if (!poolState || !assemblyState) return 0;
  const strongTargeting = options?.strongTargeting === true;
  const typeReliability = options?.typeReliability || {};
  const nextPoolState = incrementPoolStateWithQuestion(clonePoolState(poolState), q);
  const nextAssemblyState = computeAssemblyState(nextPoolState);
  const meta = attachMeta(q)._meta || {};
  const type = meta.answerType || resolvedAnswerType(q);
  const diff = (estimateQuestionDifficulty(q) || {}).bucket || "medium";

  let score = 0;
  score += (nextAssemblyState.assemblableSets - assemblyState.assemblableSets) * 160;
  score += (assemblyState.deficits[diff] - nextAssemblyState.deficits[diff]) * (strongTargeting ? 18 : 10);
  score += (assemblyState.deficits.embedded - nextAssemblyState.deficits.embedded) * (meta.isEmbedded ? (strongTargeting ? 16 : 8) : 0);
  score += (assemblyState.deficits.nonEmbedded - nextAssemblyState.deficits.nonEmbedded) * (NON_EMBEDDED_TYPES.has(type) ? (strongTargeting ? 16 : 8) : 0);
  score += (assemblyState.deficits.negation - nextAssemblyState.deficits.negation) * (type === "negation" ? 10 : 0);
  score += (assemblyState.deficits.distractor - nextAssemblyState.deficits.distractor) * 3;
  score += (assemblyState.embeddedOverflow - nextAssemblyState.embeddedOverflow) * 14;
  score += (assemblyState.negationOverflow - nextAssemblyState.negationOverflow) * 14;
  score += ((typeReliability[type] || 0.7) - 0.7) * 24;

  if (strongTargeting && assemblyState.deficits[diff] === 0) score -= 24;
  if (strongTargeting && assemblyState.deficits.embedded > 0 && !meta.isEmbedded && assemblyState.deficits.nonEmbedded <= 0) score -= 22;
  if (strongTargeting && assemblyState.deficits.nonEmbedded > 0 && meta.isEmbedded) score -= 30;
  if (strongTargeting && diff === "easy" && assemblyState.deficits.easy === 0) score -= 24;
  if (meta.isEmbedded && assemblyState.embeddedOverflow > 0) score -= 36;
  if (type === "negation" && assemblyState.negationOverflow > 0) score -= 34;
  if (meta.hasQuestionMark && assemblyState.qmarkOverflow > 0) score -= 40;

  return Math.round(score * 100) / 100;
}

/**
 * Build planner prompt: AI analyzes pool gaps and outputs a mixed batch spec.
 */
function chooseGapWeightedType(poolState, globalTypeTargets, candidates, fallback) {
  const totals = poolState?.typeTotals || {};
  const ranked = (Array.isArray(candidates) ? candidates : []).map((type) => ({
    type,
    have: totals[type] || 0,
    softNeed: (totals[type] || 0) === 0 ? 2 : (totals[type] || 0) <= 1 ? 1 : 0,
  })).sort((a, b) => {
    if (b.softNeed !== a.softNeed) return b.softNeed - a.softNeed;
    return a.have - b.have;
  });
  return ranked[0]?.type || fallback;
}


// buildPlannerPrompt → lib/bsGen/promptBuilders.js (wrapper to inject TYPE_LIST)
function buildPlannerPrompt(poolState, difficultyTargets, globalTypeTargets, styleTargets = null, targetTotal = 10, mode = "normal") {
  return _pb.buildPlannerPrompt(poolState, difficultyTargets, globalTypeTargets, TYPE_LIST, styleTargets, targetTotal);
}

/**
 * Parse planner AI output into a validated spec array totaling exactly 10 questions.
 */
function parsePlannerSpec(text, targetTotal = 10) {
  try {
    const arr = parseJsonArray(text);
    if (!Array.isArray(arr) || arr.length === 0) throw new Error("empty");
    const valid = arr
      .filter((x) => x && typeof x.type === "string" && typeof x.difficulty === "string" && Number(x.count) > 0)
      .map((x) => ({ type: String(x.type), difficulty: String(x.difficulty), count: Number(x.count) }));
    if (valid.length === 0) throw new Error("no valid items");
    if (targetTotal <= 1) {
      const top = valid.sort((a, b) => b.count - a.count)[0];
      return [{ type: top.type, difficulty: top.difficulty, count: 1 }];
    }

    const ranked = valid.sort((a, b) => b.count - a.count);
    if (ranked.length >= targetTotal) {
      return ranked.slice(0, targetTotal).map((x) => ({ type: x.type, difficulty: x.difficulty, count: 1 }));
    }

    const normalized = ranked.map((x) => ({ ...x, count: 1 }));
    let remaining = targetTotal - normalized.length;
    let cursor = 0;
    while (remaining > 0 && normalized.length > 0) {
      normalized[cursor % normalized.length].count += 1;
      remaining -= 1;
      cursor += 1;
    }
    return normalized;
  } catch (_) {
    return [{ type: "3rd-reporting", difficulty: "medium", count: targetTotal }];
  }
}

function enforcePlannerStyleGaps(spec, poolState, styleTargets, globalTypeTargets = null, difficultyTargets = null, targetTotal = 10) {
  const out = Array.isArray(spec) ? spec.map((x) => ({ ...x })) : [];
  if (out.length === 0) return out;

  const style = poolState?.style || { embedded: 0, negation: 0, distractor: 0, qmark: 0 };
  const typeTotals = poolState?.typeTotals || Object.fromEntries(TYPE_LIST.map((type) => [type, 0]));
  const totalPool = style.total || 0;
  const bootstrapPhase = totalPool < Math.ceil(TARGET_SET_COUNT * 10 * 0.2);
  const embeddedGap = Math.max(0, (styleTargets?.embeddedMin || 0) - style.embedded);
  const negationGap = Math.max(0, (styleTargets?.negationMin || 0) - style.negation);
  const missingTypes = new Set(TYPE_LIST.filter((type) => (typeTotals[type] || 0) === 0));

  const total = out.reduce((sum, x) => sum + x.count, 0);
  if (total !== targetTotal) return out;

  const difficultyGapOrder = ["easy", "medium", "hard"].sort((a, b) => {
    const aHave = TYPE_LIST.reduce((sum, type) => sum + ((poolState?.[a] || {})[type] || 0), 0);
    const bHave = TYPE_LIST.reduce((sum, type) => sum + ((poolState?.[b] || {})[type] || 0), 0);
    const aGap = Math.max(0, (difficultyTargets?.[a] || 0) - aHave);
    const bGap = Math.max(0, (difficultyTargets?.[b] || 0) - bHave);
    return bGap - aGap;
  });

  const replaceOne = (preferredType, preferredDifficulty = null) => {
    const donor = out
      .filter((x) => x.count > 1)
      .sort((a, b) => {
        const aPenalty = missingTypes.has(a.type) ? 0 : 1;
        const bPenalty = missingTypes.has(b.type) ? 0 : 1;
        if (aPenalty !== bPenalty) return bPenalty - aPenalty;
        return b.count - a.count;
      })[0];
    if (!donor) {
      if (out.length === 1 && targetTotal === 1) {
        out[0] = { type: preferredType, difficulty: preferredDifficulty || difficultyGapOrder[0] || "medium", count: 1 };
      }
      return;
    }
    donor.count -= 1;
    const targetDifficulty = preferredDifficulty || difficultyGapOrder[0] || "medium";
    const existing = out.find((x) => x.type === preferredType && x.difficulty === targetDifficulty);
    if (existing) {
      existing.count += 1;
    } else {
      out.push({ type: preferredType, difficulty: targetDifficulty, count: 1 });
    }
  };

  // Qmark (interrogative) control — ratio-based (proven in R18/R20)
  const qmarkPoolRatio = totalPool > 0 ? style.qmark / totalPool : 0;
  const interrogativePlanned = out
    .filter((x) => x.type === "interrogative")
    .reduce((sum, x) => sum + x.count, 0);
  if (interrogativePlanned === 0 && qmarkPoolRatio < 0.08) {
    replaceOne("interrogative", "medium");
  }
  // Strip ALL interrogative if pool already has enough qmark items (>= 10%)
  if (qmarkPoolRatio >= 0.10) {
    let replaced = 0;
    for (const item of out) {
      if (item.type === "interrogative") {
        item.type = "1st-embedded";
        replaced++;
      }
    }
    if (replaced > 0) {
      console.log(`  [planner-fix] replaced ${replaced} interrogative → 1st-embedded (qmark pool ratio ${(qmarkPoolRatio * 100).toFixed(0)}%)`);
    }
  }

  if (!bootstrapPhase && embeddedGap > 0) {
    const embeddedPlanned = out
      .filter((x) => x.type === "3rd-reporting" || x.type === "1st-embedded" || x.type === "interrogative")
      .reduce((sum, x) => sum + x.count, 0);
    if (embeddedPlanned < Math.min(6, embeddedGap)) {
      replaceOne("1st-embedded", "medium");
      if (qmarkPoolRatio < 0.08) replaceOne("interrogative", "medium");
      else replaceOne("1st-embedded", "medium");
    }
  }

  // Cap negation to max 1 per batch, and skip entirely if pool already at 22%+ (target 20%)
  const negPoolRatio = totalPool > 0 ? style.negation / totalPool : 0;
  const negPlanned = out
    .filter((x) => x.type === "negation")
    .reduce((sum, x) => sum + x.count, 0);
  if (negPoolRatio >= 0.22 && negPlanned > 0) {
    // Pool already has enough negation — remove all and redistribute
    let excess = negPlanned;
    for (const item of out) {
      if (item.type === "negation" && excess > 0) {
        const trim = Math.min(item.count, excess);
        item.count -= trim;
        excess -= trim;
      }
    }
    const redistributed = negPlanned - excess;
    if (redistributed > 0) {
      const existing3rd = out.find((x) => x.type === "3rd-reporting" && x.difficulty === "medium");
      if (existing3rd) existing3rd.count += redistributed;
      else out.push({ type: "3rd-reporting", difficulty: "medium", count: redistributed });
    }
  } else if (negPlanned > 1) {
    // Trim excess negation, redistribute to other types
    let excess = negPlanned - 1;
    for (const item of out) {
      if (item.type === "negation" && item.count > 1 && excess > 0) {
        const trim = Math.min(item.count - 1, excess);
        item.count -= trim;
        excess -= trim;
      }
    }
    // Add trimmed count as 3rd-reporting (most common type)
    const redistributed = negPlanned - 1 - excess;
    if (redistributed > 0) {
      const existing3rd = out.find((x) => x.type === "3rd-reporting" && x.difficulty === "medium");
      if (existing3rd) existing3rd.count += redistributed;
      else out.push({ type: "3rd-reporting", difficulty: "medium", count: redistributed });
    }
  } else if (negationGap > 0 && negPlanned === 0) {
    replaceOne("negation", "medium");
  }

  const scarceTypes = (bootstrapPhase ? ["direct", "relative", "3rd-reporting"] : TYPE_LIST)
    .filter((type) => missingTypes.has(type))
    .sort((a, b) => (typeTotals[a] || 0) - (typeTotals[b] || 0));

  for (const type of scarceTypes) {
    const planned = out.filter((x) => x.type === type).reduce((sum, x) => sum + x.count, 0);
    if (planned > 0) continue;
    replaceOne(type, difficultyGapOrder[0] || "medium");
  }

  return out.filter((x) => x.count > 0);
}

// ── Prompt Reformatter ───────────────────────────────────────────────────────
// Dedicated pass: converts two-part prompts (context + short task) into
// single direct questions (TPO authentic style). Only fires on questions
// where prompt_context is non-empty AND task_kind is ask/report/respond.

// buildPromptReformatterPrompt → lib/bsGen/promptBuilders.js
const buildPromptReformatterPrompt = _pb.buildPromptReformatterPrompt;

/**
 * Reformat two-part prompts into single-question TPO style.
 * Returns the same question list with prompt fields updated.
 * Falls back to original on any error.
 */
async function reformatPrompts(questions) {
  const toReformat = questions.filter(q => {
    const kind = (q.prompt_task_kind || "").toLowerCase();
    if (!["ask", "report", "respond", "yesno", "statement"].includes(kind)) return false;
    const ctx = (q.prompt_context || "").trim();
    if (ctx) return true; // Case 1: has separate context sentence
    // Case 2: context is empty but prompt_task_text contains multiple sentences
    const task = (q.prompt_task_text || "").trim();
    const sentences = task.split(/(?<=[.!?])\s+/).filter(Boolean);
    return sentences.length >= 2;
  });
  if (toReformat.length === 0) return questions;

  let updates;
  try {
    const raw = await callModelDeterministic(buildPromptReformatterPrompt(toReformat));
    const arr = parseJsonArray(raw);
    if (!Array.isArray(arr)) throw new Error("not an array");
    updates = new Map(arr.map(u => [String(u.id || ""), u]));
  } catch (e) {
    console.log(`  reformatter: failed (${e.message}), using originals`);
    return questions;
  }

  return questions.map(q => {
    const u = updates.get(q.id);
    if (!u) return q;
    const newCtx  = String(u.prompt_context  ?? q.prompt_context  ?? "").trim();
    const newTask = String(u.prompt_task_text ?? q.prompt_task_text ?? "").trim();
    if (!newTask) return q; // safety: never blank out the task
    // Clear prompt so validator doesn't flag the mismatch after reformatting
    return { ...q, prompt_context: newCtx, prompt_task_text: newTask, prompt: "" };
  });
}
// ─────────────────────────────────────────────────────────────────────────────

// buildReviewPrompt → lib/bsGen/promptBuilders.js
const buildReviewPrompt = _pb.buildReviewPrompt;

// buildConsistencyPrompt, parseReviewJson, parseConsistencyJson → lib/bsGen/
const buildConsistencyPrompt = _pb.buildConsistencyPrompt;
// parseReviewJson, parseConsistencyJson → lib/bsGen/utils.js (imported at top)

// Circuit breaker functions → lib/bsGen/circuitBreaker.js
const createCircuitBreakerState = _cb.createCircuitBreakerState;
const getActiveCircuitBreakerTypes = _cb.getActiveCircuitBreakerTypes;
function applyCircuitBreakersToSpec(spec, blockedTypes, poolState, globalTypeTargets) {
  return _cb.applyCircuitBreakersToSpec(spec, blockedTypes, poolState, globalTypeTargets, chooseGapWeightedType);
}
const updateCircuitBreakers = _cb.updateCircuitBreakers;
const flushCircuitBreakerLog = _cb.flushCircuitBreakerLog;

/**
 * Deterministic distractor safety check.
 * Catches the most common reviewer-blocker trigger: distractor can replace
 * or be inserted alongside an existing word to form a plausible sentence.
 * Returns null if safe, or a reason string if unsafe.
 */
function checkDistractorSafety(q) {
  if (!q.distractor || q.has_distractor === false) return null;
  const dist = String(q.distractor).toLowerCase().trim();
  const answerLower = String(q.answer || "").toLowerCase().replace(/[.,!?;:]/g, "");
  const answerWords = answerLower.split(/\s+/).filter(Boolean);

  // 1. Distractor is a direct tense/form swap of an AUXILIARY/BE/MODAL word in the answer.
  //    e.g. distractor="is" when answer contains "was" — trivial swap creates valid sentence.
  //    Regular verb variants (submit↔submitted, open↔opened) are NOT caught here —
  //    they are often GOOD distractors (base vs participle in passive/perfect constructions).
  const BE_VERBS = new Set(["is", "was", "are", "were", "be", "been", "being"]);
  const DO_GROUP = new Set(["do", "does", "did"]);
  const HAS_GROUP = new Set(["has", "have", "had"]);
  const MODAL_PAIRS = [["can", "could"], ["will", "would"], ["shall", "should"], ["may", "might"]];

  for (const ansWord of answerWords) {
    if (ansWord === dist) continue;
    // be-verb swaps: is↔was, are↔were, etc.
    if (BE_VERBS.has(dist) && BE_VERBS.has(ansWord)) {
      return `"${dist}" directly swaps with "${ansWord}" in answer (be-verb tense change produces valid sentence)`;
    }
    // do-group swaps: do↔did↔does
    if (DO_GROUP.has(dist) && DO_GROUP.has(ansWord)) {
      return `"${dist}" directly swaps with "${ansWord}" in answer (do-group tense change produces valid sentence)`;
    }
    // has/have/had swaps
    if (HAS_GROUP.has(dist) && HAS_GROUP.has(ansWord)) {
      return `"${dist}" directly swaps with "${ansWord}" in answer (have-group tense change produces valid sentence)`;
    }
    // modal pairs: can↔could, will↔would, etc.
    for (const pair of MODAL_PAIRS) {
      if (pair.includes(dist) && pair.includes(ansWord)) {
        return `"${dist}" directly swaps with "${ansWord}" in answer (modal swap produces valid sentence)`;
      }
    }
  }

  // 2. Distractor "did"/"do"/"does" when answer has negation "did not"/"do not" etc.
  //    The distractor is redundant — it's already semantically present.
  const DO_DISTRACTORS = new Set(["did", "do", "does"]);
  if (DO_DISTRACTORS.has(dist)) {
    // Check if the answer already has an auxiliary from the same do-group
    const hasDoAux = answerWords.some((w) => DO_DISTRACTORS.has(w));
    // "did"/"do" as distractor is OK when it can't be inserted — typically safe.
    // But if the answer already uses the same word, it's problematic.
    if (hasDoAux && answerWords.includes(dist)) {
      return `"${dist}" already appears in the answer — distractor is a duplicate`;
    }
  }

  return null;
}

function hardValidateQuestion(q) {
  const promptContract = validateStructuredPromptParts(q, { requireStructured: true });
  if (promptContract.fatal.length > 0) return { ok: false, reason: `prompt: ${promptContract.fatal.join("; ")}` };
  if (promptContract.format.length > 0) return { ok: false, reason: `prompt: ${promptContract.format.join("; ")}` };

  // prompt_task_text must be a single sentence for ask/report/respond types.
  // Background context must be embedded inside the question, not prepended as a separate sentence.
  const taskKind = normalizeText(q.prompt_task_kind).toLowerCase();
  if (["ask", "report", "respond", "yesno", "statement"].includes(taskKind)) {
    const taskText = normalizeText(q.prompt_task_text);
    const sentences = taskText.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length >= 2) {
      return { ok: false, reason: "prompt_task_text: must be a single sentence — embed background context into the question itself" };
    }
  }

  // Negation cluster must not be split: ["did","not"] is invalid — must be ["did not"]
  const NEG_AUX = ["did", "does", "do", "has", "have", "had", "is", "was", "were", "will", "would", "could", "should"];
  const effectiveChunks = (q.chunks || []).filter((c) => c !== q.distractor);
  const hasStandaloneNot = effectiveChunks.some((c) => normalizeText(c).toLowerCase() === "not");
  const hasPrecedingAux = effectiveChunks.some((c) => NEG_AUX.includes(normalizeText(c).toLowerCase()));
  if (hasStandaloneNot && hasPrecedingAux) {
    return { ok: false, reason: 'chunks: negation must be a single chunk — use "did not" not ["did","not"]' };
  }

  // Hard gate: effective chunks ≤ 7 for easy/medium, ≤ 8 for hard (TPO avg 5.8)
  const ecCount = effectiveChunks.length;
  const answerLen = String(q.answer || "").replace(/[.,!?;:]/g, " ").trim().split(/\s+/).filter(Boolean).length;
  const isHardCandidate = answerLen >= 10; // hard questions are 10-13 words
  const ecLimit = isHardCandidate ? 8 : 7;
  if (ecCount > ecLimit) {
    return { ok: false, reason: `chunks:too_many_effective (${ecCount} > ${ecLimit})` };
  }

  const v = validateQuestion(q);
  if (v.fatal.length > 0) return { ok: false, reason: `fatal: ${v.fatal.join("; ")}` };
  // format and content issues are soft warnings, not hard fails
  if (v.format.length > 0) return { ok: false, reason: `format: ${v.format.join("; ")}` };

  // hardFailReasons delegates to validateQuestion().fatal, already checked above
  // Skip redundant call

  try {
    const rq = normalizeRuntimeQuestion(q);
    validateRuntimeQuestion(rq);
    if (hasAmbiguousArrangements(rq)) {
      return { ok: false, reason: "ambiguity: heuristic score exceeded threshold (duplicate chunks or too many mobile prepositional phrases)" };
    }
  } catch (e) {
    return { ok: false, reason: `runtime: ${e.message}` };
  }

  // Deterministic distractor safety: catch the most common reviewer-blocker trigger
  // before sending to the expensive AI reviewer.
  const distractorIssue = checkDistractorSafety(q);
  if (distractorIssue) {
    return { ok: false, reason: `distractor:unsafe: ${distractorIssue}` };
  }

  return { ok: true };
}

async function callOpenAICompatibleRelay({ apiKey, baseUrl, model, temperature, maxTokens, userPrompt, timeoutMs = 120000 }) {
  const url = `${String(baseUrl || "").replace(/\/$/, "")}/chat/completions`;
  const body = JSON.stringify({
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: userPrompt }],
  });
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };

  const RETRYABLE = new Set([429, 500, 502, 503, 504]);
  const FAIL_FAST_STATUSES = new Set([502, 503, 504]);
  const relayConfigs = getRelayConfigs();
  const hasBackupRelay = relayConfigs.length > 1;
  const MAX_ATTEMPTS = hasBackupRelay ? 2 : 4;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Relay API ${res.status}: ${text.slice(0, 300)}`);
        const shouldFailFastToNextRelay = hasBackupRelay && FAIL_FAST_STATUSES.has(res.status);
        if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS && !shouldFailFastToNextRelay) {
          const delay = res.status === 429 ? attempt * 15000 : attempt * 5000;
          console.warn(`  [relay] attempt ${attempt} got ${res.status}, retrying in ${delay / 1000}s…`);
          lastErr = err;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error(`Relay response missing content: ${JSON.stringify(data).slice(0, 200)}`);
      }
      return content;
    } catch (e) {
      clearTimeout(timer);
      // Retry on network/abort errors too (except final attempt)
      const errorCode = e?.code || e?.cause?.code || "";
      const isRetryableNetworkError = (
        e?.name === "AbortError" ||
        errorCode === "ECONNRESET" ||
        errorCode === "ECONNREFUSED" ||
        errorCode === "ETIMEDOUT" ||
        errorCode === "UND_ERR_CONNECT_TIMEOUT" ||
        String(e?.message || "").toLowerCase().includes("fetch failed")
      );
      if (attempt < MAX_ATTEMPTS && isRetryableNetworkError) {
        const delay = attempt * 5000;
        console.warn(`  [relay] attempt ${attempt} network error (${e.message}), retrying in ${delay / 1000}s…`);
        lastErr = e;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * Build ordered list of relay configs from env vars.
 * Primary:  CLAUDE_RELAY_API_KEY  + CLAUDE_RELAY_BASE_URL
 * Backup N: CLAUDE_RELAY_API_KEY_N + CLAUDE_RELAY_BASE_URL_N  (N = 2, 3, …)
 */
// Track relays permanently disabled due to quota/auth errors (by index)
const _deadRelays = new Set();

function isQuotaOrAuthError(status, body) {
  if (status === 401 || status === 402 || status === 403) return true;
  // Some relays return 200 with error body, or 4xx with quota message
  const lower = String(body || "").toLowerCase();
  return /insufficient.*(balance|quota|credit)|quota.*(exceeded|exhausted)|billing|payment required|no.*(balance|credit)/i.test(lower);
}

function getRelayConfigs() {
  const model = process.env.CLAUDE_GENERATOR_MODEL || "claude-sonnet-4-6";
  const configs = [];
  if (process.env.CLAUDE_RELAY_API_KEY) {
    configs.push({ apiKey: process.env.CLAUDE_RELAY_API_KEY, baseUrl: process.env.CLAUDE_RELAY_BASE_URL || "https://api.yuegle.com/v1", model });
  }
  for (let n = 2; n <= 5; n++) {
    const key = process.env[`CLAUDE_RELAY_API_KEY_${n}`];
    if (!key) continue;
    configs.push({ apiKey: key, baseUrl: process.env[`CLAUDE_RELAY_BASE_URL_${n}`] || "https://api.yuegle.com/v1", model });
  }
  return configs;
}

function getActiveRelayCount() {
  return getRelayConfigs().length - _deadRelays.size;
}

async function callRelayChain({ userPrompt, temperature, maxTokens, timeoutMs, purpose }) {
  const relays = getRelayConfigs();
  if (relays.length === 0) return null;

  let lastErr;
  let triedAny = false;
  for (let i = 0; i < relays.length; i++) {
    if (_deadRelays.has(i)) continue; // skip quota-exhausted relays
    triedAny = true;
    const { apiKey, baseUrl, model } = relays[i];
    try {
      const activeCount = relays.length - _deadRelays.size;
      console.log(`  [${purpose}] using relay ${i + 1}/${relays.length}${_deadRelays.size > 0 ? ` (${activeCount} active)` : ""}: ${baseUrl}`);
      return await callOpenAICompatibleRelay({ apiKey, baseUrl, model, temperature, maxTokens, userPrompt, timeoutMs });
    } catch (e) {
      lastErr = e;
      _lastModelFailureReason = `${purpose}: ${errMsg(e)}`;
      // Detect quota/auth errors and permanently disable this relay
      const statusMatch = e.message.match(/Relay API (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1]) : 0;
      if (isQuotaOrAuthError(status, e.message)) {
        _deadRelays.add(i);
        console.warn(`  [${purpose}] ⚠ relay ${i + 1}/${relays.length} (${baseUrl}) disabled — quota/auth error (${status}). ${relays.length - _deadRelays.size} relay(s) remaining.`);
      } else if (i < relays.length - 1) {
        console.warn(`  [${purpose}] relay ${i + 1}/${relays.length} failed (${e.message.slice(0, 120)}), trying next relay…`);
      }
    }
  }
  if (!triedAny) {
    throw new Error(`All ${relays.length} relay(s) disabled due to quota/auth errors`);
  }
  throw lastErr;
}

async function callModelCreative(userPrompt) {
  // Generator: always DeepSeek V3.2 — empirically better at structured BS question
  // generation (fewer prompt/answer mismatches, better chunk design).
  // Claude relay is reserved for the reviewer role (callModelDeterministic).
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY required for generator (callModelCreative)");
  }
  console.log("  [creative] using DeepSeek V3.2 (deepseek-chat)");
  return callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: 180000,
    payload: {
      model: "deepseek-chat",
      temperature: 0.7,
      max_tokens: 8000,
      messages: [{ role: "user", content: userPrompt }],
    },
  });
}

async function callModelDeterministic(userPrompt) {
  // Reviewer: Claude Sonnet via relay (best English grammar judgment for cross-model review).
  // Fallback: DeepSeek V3.2 if all relays are down.
  if (getActiveRelayCount() > 0) {
    try {
      return await callRelayChain({
        userPrompt,
        temperature: 0,
        maxTokens: 5000,
        timeoutMs: 120000,
        purpose: "deterministic",
      });
    } catch (e) {
      if (!process.env.DEEPSEEK_API_KEY) throw e;
      console.warn(`  [deterministic] all relays failed (${errMsg(e)}), falling back to DeepSeek…`);
    }
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("No model available for reviewer: all relays down and no DEEPSEEK_API_KEY");
  }
  return callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: 120000,
    payload: {
      model: "deepseek-chat",
      temperature: 0,
      max_tokens: 5000,
      messages: [{ role: "user", content: userPrompt }],
    },
  });
}

function errMsg(e) {
  const msg = formatDeepSeekError ? formatDeepSeekError(e) : String(e?.message || e || "");
  return msg || String(e?.code || "unknown_error");
}

async function generateCandidateRound(round, spec, rejectFeedback = "", recentPool = [], options = {}) {
  // spec: [{type, difficulty, count}, ...]
  const totalCount = spec.reduce((s, x) => s + x.count, 0);
  const out = {
    generated: 0,
    accepted: 0,
    rejected: 0,
    rejectReasons: {},
    questions: [],
    typeStats: Object.fromEntries(
      TYPE_LIST.map((type) => [type, { generated: 0, accepted: 0, rejected: 0, reasons: {} }]),
    ),
  };

  const recentTopics = extractRecentTopics(recentPool);
  const promptFeedback = [rejectFeedback, options?.generationHints].filter(Boolean).join("\n");
  const generatedRaw = await callModelCreative(buildGeneratePrompt(round, spec, promptFeedback, recentTopics));
  const arr = parseJsonArray(generatedRaw);
  if (!Array.isArray(arr) || arr.length < Math.floor(totalCount * 0.7)) {
    throw new Error(`round ${round}: model returned ${arr?.length ?? 0} questions, expected ~${totalCount}`);
  }

  // Batch-level sanity: distractor and prefilled rates must not be 0% or 100%
  if (arr.length >= 5) {
    const distractorCount = arr.filter((q) => q.has_distractor === true || q.distractor != null).length;
    const prefilledCount = arr.filter((q) => Array.isArray(q.prefilled) && q.prefilled.length > 0).length;
    const distractorRate = distractorCount / arr.length;
    const prefilledRate = prefilledCount / arr.length;
    if (distractorRate < 0.6 || distractorRate > 0.99) {
      console.warn(`  [warn] round ${round}: distractor rate ${Math.round(distractorRate * 100)}% is out of range (60-99%) — proceeding anyway`);
    }
    if (prefilledRate < 0.6 || prefilledRate > 0.99) {
      console.warn(`  [warn] round ${round}: prefilled rate ${Math.round(prefilledRate * 100)}% is out of range (60-99%) — proceeding anyway`);
    }
  }

  const normalized = arr.map((q, i) => normalizeQuestion(q, `tmp_r${round}_q${i + 1}`));

  // Post-normalization: redistribute prefilled positions (TPO: 53% start, 31% mid, 16% end)
  const positionAdjusted = normalized.map((q) => maybeReassignPrefilledPosition(q));

  out.generated = positionAdjusted.length;
  positionAdjusted.forEach((q) => {
    const type = resolvedAnswerType(q);
    out.typeStats[type].generated += 1;
  });

  // Prompt Reformatter: convert two-part prompts to single-question TPO style
  const reformatted = await reformatPrompts(positionAdjusted);
  const reformatCount = reformatted.filter((q, i) => !(q.prompt_context || "") !== !(positionAdjusted[i].prompt_context || "")).length;
  if (reformatCount > 0) console.log(`  reformatter: converted ${reformatCount} two-part prompts to single-question style`);

  // hard filter first
  const hardPassed = [];
  for (const q of reformatted) {
    const hv = hardValidateQuestion(q);
    if (!hv.ok) {
      const type = resolvedAnswerType(q);
      out.rejected += 1;
      out.rejectReasons[hv.reason] = (out.rejectReasons[hv.reason] || 0) + 1;
      out.typeStats[type].rejected += 1;
      out.typeStats[type].reasons[hv.reason] = (out.typeStats[type].reasons[hv.reason] || 0) + 1;
      continue;
    }
    hardPassed.push(q);
  }

  if (hardPassed.length === 0) return out;

  // Topic novelty check BEFORE reviewer — saves 2 API calls per topic-rejected question
  const topicPassed = [];
  for (const q of hardPassed) {
    if (isTopicRepeat(q, recentPool)) {
      const type = resolvedAnswerType(q);
      out.rejected += 1;
      const r = "topic:repeat";
      out.rejectReasons[r] = (out.rejectReasons[r] || 0) + 1;
      out.typeStats[type].rejected += 1;
      out.typeStats[type].reasons[r] = (out.typeStats[type].reasons[r] || 0) + 1;
      continue;
    }
    topicPassed.push(q);
  }

  if (topicPassed.length === 0) return out;

  // Global answer dedup: reject exact duplicates from prior runs
  const dedupPassed = [];
  const answerHashSet = options?.globalAnswerHashes;
  for (const q of topicPassed) {
    if (answerHashSet && answerHashSet.has(hashAnswer(q))) {
      const reason = "dedup:global_hash";
      out.rejected += 1;
      out.rejectReasons[reason] = (out.rejectReasons[reason] || 0) + 1;
      continue;
    }
    dedupPassed.push(q);
  }
  if (dedupPassed.length === 0) return out;

  // Pool-level prefilled diversity gate:
  // 1. No-prefilled quota: reject prefilled=[] when pool exceeds 10% (TPO: ~8%)
  // 2. "i" quota: reject prefilled=["i"] when pool exceeds 15% (TPO: ~10% of all prefilled)
  // 3. 1-word quota: reject any 1-word prefilled when pool exceeds 65% (TPO: ~55%)
  const noPfCount = recentPool.filter((q) => !Array.isArray(q.prefilled) || q.prefilled.length === 0).length;
  const noPfRatio = recentPool.length > 0 ? noPfCount / recentPool.length : 0;
  const noPfQuotaExceeded = noPfRatio >= 0.15;

  const prefilledPoolItems = recentPool.filter((q) => Array.isArray(q.prefilled) && q.prefilled.length > 0);
  const oneWordICount = prefilledPoolItems.filter((q) => {
    const pf = q.prefilled[0].trim().toLowerCase();
    return pf === "i" || pf === "i'm" || pf === "i've" || pf === "i'll" || pf === "i'd";
  }).length;
  const oneWordAllCount = prefilledPoolItems.filter((q) => {
    return q.prefilled[0].trim().split(/\s+/).length === 1;
  }).length;
  const poolIRatio = prefilledPoolItems.length > 0 ? oneWordICount / prefilledPoolItems.length : 0;
  const pool1wRatio = prefilledPoolItems.length > 0 ? oneWordAllCount / prefilledPoolItems.length : 0;
  const iQuotaExceeded = poolIRatio >= 0.15;
  const oneWordQuotaExceeded = pool1wRatio >= 0.65;

  const prefilledPassed = [];
  for (const q of dedupPassed) {
    // Gate: no-prefilled quota (TPO 8%, cap at 10%)
    if (noPfQuotaExceeded && (!Array.isArray(q.prefilled) || q.prefilled.length === 0)) {
      const type = resolvedAnswerType(q);
      const reason = "pool:no_prefilled_quota";
      out.rejected += 1;
      out.rejectReasons[reason] = (out.rejectReasons[reason] || 0) + 1;
      out.typeStats[type].rejected += 1;
      out.typeStats[type].reasons[reason] = (out.typeStats[type].reasons[reason] || 0) + 1;
      continue;
    }
    if (Array.isArray(q.prefilled) && q.prefilled.length > 0) {
      const pf = q.prefilled[0].trim().toLowerCase();
      const pfWordCount = pf.split(/\s+/).length;
      const isI = pf === "i" || pf === "i'm" || pf === "i've" || pf === "i'll" || pf === "i'd";
      if (iQuotaExceeded && isI) {
        const type = resolvedAnswerType(q);
        const reason = "pool:i_quota_exceeded";
        out.rejected += 1;
        out.rejectReasons[reason] = (out.rejectReasons[reason] || 0) + 1;
        out.typeStats[type].rejected += 1;
        out.typeStats[type].reasons[reason] = (out.typeStats[type].reasons[reason] || 0) + 1;
        continue;
      }
      if (oneWordQuotaExceeded && pfWordCount === 1 && !isI) {
        const type = resolvedAnswerType(q);
        const reason = "pool:1word_quota_exceeded";
        out.rejected += 1;
        out.rejectReasons[reason] = (out.rejectReasons[reason] || 0) + 1;
        out.typeStats[type].rejected += 1;
        out.typeStats[type].reasons[reason] = (out.typeStats[type].reasons[reason] || 0) + 1;
        continue;
      }
    }
    prefilledPassed.push(q);
  }

  if (prefilledPassed.length === 0) return out;

  // Pool-balance gate BEFORE reviewer — prevents late-stage overproduction that blocks assembly.
  const balancePassed = [];
  let workingPoolState = options?.poolState ? clonePoolState(options.poolState) : null;
  let workingAssemblyState = options?.assemblyState || null;
  for (const q of prefilledPassed) {
    const gate = evaluatePoolBalance(
      q,
      workingPoolState,
      workingAssemblyState,
      options?.phase,
      options?.difficultyTargets,
      options?.primaryRepairTarget,
    );
    if (!gate.ok) {
      const type = resolvedAnswerType(q);
      out.rejected += 1;
      out.rejectReasons[gate.reason] = (out.rejectReasons[gate.reason] || 0) + 1;
      out.typeStats[type].rejected += 1;
      out.typeStats[type].reasons[gate.reason] = (out.typeStats[type].reasons[gate.reason] || 0) + 1;
      continue;
    }
    const assemblyValue = computeQuestionAssemblyValue(q, workingPoolState, workingAssemblyState, {
      strongTargeting: options?.strongTargeting,
      typeReliability: options?.typeReliability,
    });
    const qDiff = (estimateQuestionDifficulty(q) || {}).bucket || "medium";
    const fillsDiffGap = (workingAssemblyState?.deficits?.[qDiff] || 0) > 0;
    if (options?.strongTargeting && assemblyValue <= 0 && !fillsDiffGap) {
      const type = resolvedAnswerType(q);
      const reason = "pool:low_assembly_value";
      out.rejected += 1;
      out.rejectReasons[reason] = (out.rejectReasons[reason] || 0) + 1;
      out.typeStats[type].rejected += 1;
      out.typeStats[type].reasons[reason] = (out.typeStats[type].reasons[reason] || 0) + 1;
      continue;
    }
    q._assemblyValue = assemblyValue;
    balancePassed.push(q);
    if (workingPoolState) {
      workingPoolState = incrementPoolStateWithQuestion(workingPoolState, q);
      workingAssemblyState = computeAssemblyState(workingPoolState);
    }
  }

  if (balancePassed.length === 0) return out;
  balancePassed.sort((a, b) => (b._assemblyValue || 0) - (a._assemblyValue || 0));

  // AI review score — only on topic-passed questions
  const reviewRaw = await callModelDeterministic(buildReviewPrompt(balancePassed));
  const review = parseReviewJson(reviewRaw);
  const scoreMap = new Map(
    review.question_scores.map((qs) => [String(qs?.id || ""), Number(qs?.score || 0)]),
  );
  const consistencyRaw = await callModelDeterministic(buildConsistencyPrompt(balancePassed));
  const consistency = parseConsistencyJson(consistencyRaw);
  const cMap = new Map(
    consistency.question_scores.map((qs) => [
      String(qs?.id || ""),
      {
        ets: Number(qs?.ets_similarity || 0),
        solvability: Number(qs?.solvability || 0),
      },
    ]),
  );

  // Build per-item blocker set: extract item IDs mentioned in blocker strings.
  // Only block the specific items mentioned, not the entire batch.
  // IMPORTANT: filter out blockers the reviewer explicitly retracted/rescinded.
  const RETRACT_PATTERN = /\b(NOT a[\w\s-]*blocker|not a[\w\s-]*blocker|Retracting|RETRACTED|Rescind|rescind|Withdrawing|SELF[- ]CORRECTION|re-evaluat\w+:\s*no[\w\s-]*blocker|no[\w\s]*blocker[\w\s]*confirmed|removing from blockers|Score deduction only)\b/i;
  const rawBlockerTexts = [...review.blockers, ...consistency.blockers].filter(Boolean);
  const allBlockerTexts = [];
  for (const b of rawBlockerTexts) {
    // Split multi-item blockers (separated by |) and evaluate each segment
    const segments = b.split("|").map((s) => s.trim()).filter(Boolean);
    const keptSegments = segments.filter((seg) => !RETRACT_PATTERN.test(seg));
    if (keptSegments.length > 0) {
      allBlockerTexts.push(keptSegments.join("|"));
    }
  }
  const perItemBlockerIds = new Set();
  const unmatchedBlockers = [];
  for (const b of allBlockerTexts) {
    const ids = b.match(/tmp_r\d+_q\d+/g);
    if (ids && ids.length > 0) {
      ids.forEach((id) => perItemBlockerIds.add(id));
    } else {
      // Blocker without specific item ID — applies to whole batch
      unmatchedBlockers.push(b);
    }
  }

  // Whole-batch blockers (no item IDs) still block all items, but only if overall scores are low
  const batchBlocked = unmatchedBlockers.length > 0 && (
    (review.overall_score < MIN_REVIEW_OVERALL) ||
    (consistency.overall_ets_similarity < MIN_ETS_SIMILARITY) ||
    (consistency.overall_solvability < MIN_SOLVABILITY)
  );

  for (const q of balancePassed) {
    const score = scoreMap.has(q.id) ? scoreMap.get(q.id) : 0;
    const c = cMap.get(q.id) || { ets: 0, solvability: 0 };
    const itemBlocked = perItemBlockerIds.has(q.id) || batchBlocked;
    if (itemBlocked || score < MIN_REVIEW_SCORE || c.ets < MIN_ETS_SIMILARITY || c.solvability < MIN_SOLVABILITY) {
      const type = resolvedAnswerType(q);
      out.rejected += 1;
      let r = "";
      if (itemBlocked) {
        // Include only the blockers relevant to this item
        const relevantBlockers = allBlockerTexts.filter((b) =>
          b.includes(q.id) || (!b.match(/tmp_r\d+_q\d+/) && batchBlocked)
        );
        r = `review:blocker:${relevantBlockers.join("|") || "batch-level"}`;
      } else if (score < MIN_REVIEW_SCORE) {
        r = `review:score<${MIN_REVIEW_SCORE}`;
      } else if (c.ets < MIN_ETS_SIMILARITY) {
        r = `review:ets<${MIN_ETS_SIMILARITY}`;
      } else {
        r = `review:solvability<${MIN_SOLVABILITY}`;
      }
      out.rejectReasons[r] = (out.rejectReasons[r] || 0) + 1;
      out.typeStats[type].rejected += 1;
      out.typeStats[type].reasons[r] = (out.typeStats[type].reasons[r] || 0) + 1;
      continue;
    }
    const type = resolvedAnswerType(q);
    out.accepted += 1;
    out.typeStats[type].accepted += 1;
    out.questions.push(q);
  }

  return out;
}

// Pre-compute per-question style metadata once so profileStyle() is O(n) sums
// instead of re-splitting strings on every retry attempt.
function attachMeta(q) {
  if (q._meta) return q; // already computed
  const wordCount = String(q.answer || "")
    .replace(/[.,!?;:]/g, " ").trim().split(/\s+/).filter(Boolean).length;
  const effectiveChunks = Array.isArray(q.chunks)
    ? q.chunks.filter((c) => c !== q.distractor).length
    : 0;
  q._meta = {
    wordCount,
    effectiveChunks,
    hasDistractor: q.distractor != null,
    isEmbedded: isEmbeddedQuestion(q.grammar_points),
    hasQuestionMark: q.has_question_mark === true,
    answerType: resolvedAnswerType(q),
  };
  return q;
}

function splitPoolByDifficulty(questions) {
  const pool = { easy: [], medium: [], hard: [] };
  questions.forEach((q) => {
    const est = estimateQuestionDifficulty(q);
    pool[est.bucket].push(attachMeta(q));
  });
  pool.easy = shuffle(uniqBy(pool.easy, stableAnswerKey));
  pool.medium = shuffle(uniqBy(pool.medium, stableAnswerKey));
  pool.hard = shuffle(uniqBy(pool.hard, stableAnswerKey));
  return pool;
}

function cloneQuestion(q) {
  const c = JSON.parse(JSON.stringify(q));
  delete c._meta; // _meta is internal; don't persist to output JSON
  return c;
}

/**
 * Per-set assembly no longer uses hard type templates.
 * We keep only difficulty counts and prefer light type diversity within each difficulty bucket.
 */
const SET_TYPE_TARGETS = {
  easy: [
    { type: "any", count: 1 },
  ],
  medium: [
    { type: "any", count: 7 },
  ],
  hard: [
    { type: "any", count: 2 },
  ],
};

/**
 * Pick items from a difficulty pool while respecting type quotas.
 * Falls back to any type in the same pool if a specific type is unavailable.
 */
function pickDiversified(pool, targets) {
  const result = [];
  const usedIds = new Set();
  const totalNeeded = targets.reduce((sum, t) => sum + t.count, 0);
  const typeCounts = {};

  while (result.length < totalNeeded) {
    const remaining = pool.filter((q) => !usedIds.has(q.id));
    if (remaining.length === 0) break;

    const ranked = shuffle(remaining).sort((a, b) => {
      const ta = (a._meta || {}).answerType || "unknown";
      const tb = (b._meta || {}).answerType || "unknown";
      const ca = typeCounts[ta] || 0;
      const cb = typeCounts[tb] || 0;
      if (ca !== cb) return ca - cb;
      return 0;
    });

    const picked = ranked[0];
    result.push(picked);
    usedIds.add(picked.id);
    const type = (picked._meta || {}).answerType || "unknown";
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }

  return result;
}
function flattenDifficultyPool(pool) {
  return [...(pool.easy || []), ...(pool.medium || []), ...(pool.hard || [])];
}

function composeOneSet(pool, setId, maxRetries = 500, capture = null) {
  const { easy: eN, medium: mN, hard: hN } = ETS_2026_TARGET_COUNTS_10;
  const targetSetCount = TARGET_SET_COUNT;
  const isLastSet = setId === targetSetCount;

  // Use pre-computed _meta for cheap O(n) profile 锟?no string splitting per attempt
  function profileStyle(items) {
    const total = items.length || 1;
    let qmark = 0, distractor = 0, embedded = 0, sumWords = 0, sumChunks = 0;
    const typeCounts = {};

    for (const q of items) {
      const m = q._meta;
      if (m.hasQuestionMark) qmark++;
      if (m.hasDistractor) distractor++;
      if (m.isEmbedded) embedded++;
      sumWords += m.wordCount;
      sumChunks += m.effectiveChunks;
      const t = m.answerType || "unknown";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    return { total, qmark, distractor, embedded, avgWords: sumWords / total, avgChunks: sumChunks / total, typeCounts, items };
  }

  // TPO style gates: 92% statements, 88% distractors, 63% embedded
  function stylePassStrict(p) {
    // Type monopoly check: no single type should exceed 6 items (3rd-reporting avg is 5.4)
    const maxTypeCount = Math.max(...Object.values(p.typeCounts));
    
    // Prompt uniqueness check: no identical prompts within a 10-item set
    const prompts = p.items.map(q => q.prompt.toLowerCase().trim());
    const uniquePrompts = new Set(prompts);
    const hasDuplicatePrompts = uniquePrompts.size < prompts.length;

    return (
      !hasDuplicatePrompts &&
      p.qmark >= 0 && p.qmark <= 2 &&
      p.distractor >= 7 && p.distractor <= 10 &&
      p.embedded >= 5 && p.embedded <= 9 &&
      p.avgWords >= 9.0 && p.avgWords <= 13.0 &&
      p.avgChunks >= 4.5 && p.avgChunks <= 7.5 &&
      maxTypeCount <= 6
    );
  }

  function stylePassRelaxed(p) {
    const maxTypeCount = Math.max(...Object.values(p.typeCounts));
    const prompts = p.items.map(q => q.prompt.toLowerCase().trim());
    const uniquePrompts = new Set(prompts);
    const hasManyDuplicatePrompts = uniquePrompts.size < prompts.length - 1; // Allow max 1 duplicate in relaxed mode
    // Last set uses lower embedded/distractor thresholds to avoid deadlock
    const embMin = isLastSet ? 2 : 4;
    const distMin = isLastSet ? 4 : 6;

    return (
      !hasManyDuplicatePrompts &&
      p.qmark >= 0 && p.qmark <= 3 &&
      p.distractor >= distMin && p.distractor <= 10 &&
      p.embedded >= embMin && p.embedded <= 9 &&
      p.avgWords >= 8.5 && p.avgWords <= 14.0 &&
      p.avgChunks >= 4.0 && p.avgChunks <= 8.0 &&
      maxTypeCount <= 8
    );
  }

  // Pre-flight feasibility check: bail early if style gate can never be satisfied.
  // Compute the best-case embedded/distractor counts achievable from this pool.
  function isFeasible() {
    if (
      pool.easy.length < eN ||
      pool.medium.length < mN ||
      pool.hard.length < hN
    ) return false;

    const maxEmbedded =
      Math.min(eN, pool.easy.filter((q) => q._meta.isEmbedded).length) +
      Math.min(mN, pool.medium.filter((q) => q._meta.isEmbedded).length) +
      Math.min(hN, pool.hard.filter((q) => q._meta.isEmbedded).length);
    // Last set uses lower thresholds to avoid infeasible deadlock
    if (maxEmbedded < (isLastSet ? 2 : 4)) return false;

    const maxDistractor =
      Math.min(eN, pool.easy.filter((q) => q._meta.hasDistractor).length) +
      Math.min(mN, pool.medium.filter((q) => q._meta.hasDistractor).length) +
      Math.min(hN, pool.hard.filter((q) => q._meta.hasDistractor).length);
    if (maxDistractor < (isLastSet ? 4 : 6)) return false;

    return true;
  }

  function populateCapture(base = {}) {
    if (!capture) return;
    const all = flattenDifficultyPool(pool);
    const poolState = computePoolState(all);
    const assemblyState = computeAssemblyState(poolState);
    const embeddedMax =
      Math.min(eN, pool.easy.filter((q) => q._meta.isEmbedded).length) +
      Math.min(mN, pool.medium.filter((q) => q._meta.isEmbedded).length) +
      Math.min(hN, pool.hard.filter((q) => q._meta.isEmbedded).length);
    const distractorMax =
      Math.min(eN, pool.easy.filter((q) => q._meta.hasDistractor).length) +
      Math.min(mN, pool.medium.filter((q) => q._meta.hasDistractor).length) +
      Math.min(hN, pool.hard.filter((q) => q._meta.hasDistractor).length);
    capture.data = {
      setId,
      pool: {
        easy: pool.easy.length,
        medium: pool.medium.length,
        hard: pool.hard.length,
        total: all.length,
      },
      assemblyState: {
        assemblableSets: assemblyState.assemblableSets,
        remainingSets: assemblyState.remainingSets,
        deficits: assemblyState.deficits,
        embeddedOverflow: assemblyState.embeddedOverflow,
        qmarkOverflow: assemblyState.qmarkOverflow,
        limitingFactors: assemblyState.limitingFactors,
      },
      maxStyleCapacity: {
        embedded: embeddedMax,
        distractor: distractorMax,
      },
      ...base,
    };
  }

  if (!isFeasible()) {
    console.warn(`  [assembly set ${setId}] isFeasible=false: easy=${pool.easy.length}/${eN} medium=${pool.medium.length}/${mN} hard=${pool.hard.length}/${hN} embedded_max=${
      Math.min(eN, pool.easy.filter(q=>q._meta.isEmbedded).length) +
      Math.min(mN, pool.medium.filter(q=>q._meta.isEmbedded).length) +
      Math.min(hN, pool.hard.filter(q=>q._meta.isEmbedded).length)
    } distractor_max=${
      Math.min(eN, pool.easy.filter(q=>q._meta.hasDistractor).length) +
      Math.min(mN, pool.medium.filter(q=>q._meta.hasDistractor).length) +
      Math.min(hN, pool.hard.filter(q=>q._meta.hasDistractor).length)
    }`);
    populateCapture({ reason: "infeasible_precheck" });
    return null;
  }

  const diag = { styleStrict: 0, styleRelaxed: 0, schemaOk: 0, diffOk: 0, runtimeOk: 0 };
  let bestValid = null;

  function scoreRemainingPoolAfterPick(picked) {
    const usedKeys = new Set(picked.map(stableAnswerKey));
    const remainingPool = {
      easy: pool.easy.filter((q) => !usedKeys.has(stableAnswerKey(q))),
      medium: pool.medium.filter((q) => !usedKeys.has(stableAnswerKey(q))),
      hard: pool.hard.filter((q) => !usedKeys.has(stableAnswerKey(q))),
    };
    const remainingNeed = Math.max(0, targetSetCount - setId);
    if (remainingNeed <= 0) return { score: 0 };

    const remainingAll = flattenDifficultyPool(remainingPool);
    const remainingPoolState = computePoolState(remainingAll);
    const remainingAssemblyState = computeAssemblyState(remainingPoolState, remainingNeed);
    const score =
      remainingAssemblyState.assemblableSets * 500 +
      remainingAssemblyState.assemblyProgressScore * 140 -
      remainingAssemblyState.deficits.hard * 22 -
      remainingAssemblyState.deficits.medium * 11 -
      remainingAssemblyState.deficits.embedded * 18 -
      remainingAssemblyState.deficits.nonEmbedded * 14 -
      remainingAssemblyState.deficits.negation * 8 -
      remainingAssemblyState.negationOverflow * 14 -
      remainingAssemblyState.embeddedOverflow * 18;
    return { score };
  }

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    if (
      pool.easy.length < eN ||
      pool.medium.length < mN ||
      pool.hard.length < hN
    ) return null;

    const picked = [
      ...pickDiversified(pool.easy, SET_TYPE_TARGETS.easy),
      ...pickDiversified(pool.medium, SET_TYPE_TARGETS.medium),
      ...pickDiversified(pool.hard, SET_TYPE_TARGETS.hard),
    ];

    // Safety check
    if (picked.length !== 10) continue;

    // 1. Style gate first 锟?cheap, uses pre-computed _meta, no clone needed
    const style = profileStyle(picked);
    const isStrict = attempt < Math.floor(maxRetries * 0.6);
    const styleGate = isStrict ? stylePassStrict : stylePassRelaxed;
    if (!styleGate(style)) {
      if (isStrict) diag.styleStrict++; else diag.styleRelaxed++;
      continue;
    }

    // 2. Clone + re-id only after style passes (avoids wasted deep-clones)
    const merged = shuffle(picked).map(cloneQuestion);
    merged.forEach((q, i) => { q.id = `ets_s${setId}_q${i + 1}`; });

    // 3. Schema + difficulty validation (rare failures; done after cheap gate)
    //    Last set uses relaxed style overrides aligned with stylePassRelaxed thresholds
    const set = { set_id: setId, questions: merged };
    const schemaOpts = (isLastSet && !isStrict) ? {
      styleOverrides: { distractorMin: 4, embeddedMin: 2, negationMin: 1, negationMax: 4, qmarkMax: 3 },
    } : {};
    const schemaResult = validateQuestionSet(set, schemaOpts);
    const diff = evaluateSetDifficultyAgainstTarget(merged);
    if (!schemaResult.ok || !diff.ok || !diff.meetsTargetCount10) {
      diag.schemaOk++;
      continue;
    }

    // 4. Runtime strict check
    let runtimeOk = true;
    for (const q of merged) {
      try {
        const rq = normalizeRuntimeQuestion(q);
        validateRuntimeQuestion(rq);
      } catch (_) {
        runtimeOk = false;
        break;
      }
    }
    if (!runtimeOk) { diag.runtimeOk++; continue; }

    const candidate = scoreRemainingPoolAfterPick(picked);
    if (!bestValid || candidate.score > bestValid.score) {
      bestValid = { set, picked, score: candidate.score };
    }
  }

  if (bestValid) {
    const usedKeys = new Set(bestValid.picked.map(stableAnswerKey));
    pool.easy = pool.easy.filter((q) => !usedKeys.has(stableAnswerKey(q)));
    pool.medium = pool.medium.filter((q) => !usedKeys.has(stableAnswerKey(q)));
    pool.hard = pool.hard.filter((q) => !usedKeys.has(stableAnswerKey(q)));
    return bestValid.set;
  }

  // Log detailed failure breakdown
  const negationItems = [...pool.easy, ...pool.medium, ...pool.hard]
    .filter(q => (q._meta || {}).answerType === "negation").length;
  const embeddedItems = [...pool.easy, ...pool.medium, ...pool.hard]
    .filter(q => (q._meta || {}).isEmbedded).length;
  const poolTotal = pool.easy.length + pool.medium.length + pool.hard.length;
  console.warn(`  [assembly set ${setId}] FAILED after ${maxRetries} retries`);
  console.warn(`    pool: easy=${pool.easy.length} medium=${pool.medium.length} hard=${pool.hard.length} total=${poolTotal}`);
  console.warn(`    pool stats: negation=${negationItems} embedded=${embeddedItems} (${Math.round(embeddedItems/poolTotal*100)}%)`);
  console.warn(`    fail breakdown: styleStrict=${diag.styleStrict} styleRelaxed=${diag.styleRelaxed} schema/diff=${diag.schemaOk} runtime=${diag.runtimeOk}`);

  // Sample a failed schema check to show actual errors
  const samplePicked = [
    ...pickDiversified(pool.easy, SET_TYPE_TARGETS.easy),
    ...pickDiversified(pool.medium, SET_TYPE_TARGETS.medium),
    ...pickDiversified(pool.hard, SET_TYPE_TARGETS.hard),
  ];
  if (samplePicked.length === 10) {
    const sampleMerged = shuffle(samplePicked).map(cloneQuestion);
    sampleMerged.forEach((q, i) => { q.id = `sample_q${i + 1}`; });
    const sampleSchema = validateQuestionSet({ set_id: 0, questions: sampleMerged });
    const sampleDiff = evaluateSetDifficultyAgainstTarget(sampleMerged);
    const sampleStyle = profileStyle(samplePicked);
    console.warn(`    sample pick: qmark=${sampleStyle.qmark} distractor=${sampleStyle.distractor} embedded=${sampleStyle.embedded} avgWords=${sampleStyle.avgWords.toFixed(1)} avgChunks=${sampleStyle.avgChunks.toFixed(1)} maxType=${Math.max(...Object.values(sampleStyle.typeCounts))}`);
    if (!sampleSchema.ok) console.warn(`    schema errors: ${sampleSchema.errors.join(" | ")}`);
    if (!sampleDiff.meetsTargetCount10) console.warn(`    diff counts: easy=${sampleDiff.profile.counts.easy} medium=${sampleDiff.profile.counts.medium} hard=${sampleDiff.profile.counts.hard}`);
    populateCapture({
      reason: "retry_exhausted",
      failBreakdown: {
        styleStrict: diag.styleStrict,
        styleRelaxed: diag.styleRelaxed,
        schemaDiff: diag.schemaOk,
        runtime: diag.runtimeOk,
      },
      sample: {
        style: {
          qmark: sampleStyle.qmark,
          distractor: sampleStyle.distractor,
          embedded: sampleStyle.embedded,
          avgWords: Number(sampleStyle.avgWords.toFixed(1)),
          avgChunks: Number(sampleStyle.avgChunks.toFixed(1)),
          maxType: Math.max(...Object.values(sampleStyle.typeCounts)),
        },
        schemaErrors: sampleSchema.ok ? [] : sampleSchema.errors,
        diffCounts: sampleDiff.meetsTargetCount10 ? null : sampleDiff.profile.counts,
      },
    });
  } else {
    populateCapture({
      reason: "retry_exhausted",
      failBreakdown: {
        styleStrict: diag.styleStrict,
        styleRelaxed: diag.styleRelaxed,
        schemaDiff: diag.schemaOk,
        runtime: diag.runtimeOk,
      },
    });
  }

  return null;
}

/**
 * Post-process a 10-question set to align distractor and prefilled rates with TPO targets.
 * TPO: distractor ~88% (8-9/10), prefilled ~85% (8-9/10).
 * If the generator produced 100% on either, strip 1 question's field deterministically.
 * Mutates question clones — originals in pool are untouched.
 */
function normalizeSetStyleRates(questions) {
  const qs = questions.map((q) => ({ ...q, chunks: [...(q.chunks || [])] }));
  const n = qs.length;
  if (n < 5) return qs;

  // ── Distractor: if all have distractor, strip 1 ──────────────────────────
  const distractorCount = qs.filter((q) => q.distractor != null).length;
  if (distractorCount === n) {
    // Pick the best candidate: prefer negation sentences (they're the canonical no-distractor case)
    const candidates = qs
      .map((q, i) => ({ i, q }))
      .filter(({ q }) => q.distractor != null)
      .sort((a, b) => {
        const aNeg = (a.q.grammar_points || []).some((g) => /negat|negative/i.test(g)) ? 0 : 1;
        const bNeg = (b.q.grammar_points || []).some((g) => /negat|negative/i.test(g)) ? 0 : 1;
        const aLen = String(a.q.answer || "").split(/\s+/).length;
        const bLen = String(b.q.answer || "").split(/\s+/).length;
        return (aNeg - bNeg) || (aLen - bLen); // prefer negation, then shorter answer
      });
    if (candidates.length > 0) {
      const { i, q } = candidates[0];
      qs[i] = { ...q, has_distractor: false, distractor: null, chunks: q.chunks.filter((c) => c !== q.distractor) };
      console.log(`  [normalize] stripped distractor from ${q.id} (was: "${q.distractor}") to align rate`);
    }
  }

  // ── Prefilled: if all 10 have prefilled, strip 1 ─────────────────────────
  const prefilledCount = qs.filter((q) => Array.isArray(q.prefilled) && q.prefilled.length > 0).length;
  if (prefilledCount === n) {
    // Pick the best candidate: prefer short answers (≤8 words) with 1-word prefilled
    const candidates = qs
      .map((q, i) => ({ i, q }))
      .filter(({ q }) => Array.isArray(q.prefilled) && q.prefilled.length > 0)
      .sort((a, b) => {
        const aWords = String(a.q.answer || "").split(/\s+/).length;
        const bWords = String(b.q.answer || "").split(/\s+/).length;
        const aPfLen = (a.q.prefilled || []).join(" ").split(/\s+/).length;
        const bPfLen = (b.q.prefilled || []).join(" ").split(/\s+/).length;
        return (aPfLen - bPfLen) || (aWords - bWords); // prefer 1-word prefilled, then shorter
      });
    // Find a candidate where stripping prefilled won't push EC over limit
    for (const { i, q } of candidates) {
      const dist = (q.distractor || "").toLowerCase().trim();
      const currentEC = q.chunks.filter((c) => c.toLowerCase().trim() !== dist).length;
      const pfWordCount = (q.prefilled || []).join(" ").split(/\s+/).length;
      if (currentEC + pfWordCount > 8) continue; // would exceed EC limit
      const addBackChunks = [...(q.prefilled || [])];
      const newChunks = [...q.chunks, ...addBackChunks];
      qs[i] = { ...q, prefilled: [], prefilled_positions: {}, chunks: newChunks };
      console.log(`  [normalize] stripped prefilled [${addBackChunks.join(", ")}] from ${q.id} to align rate`);
      break;
    }
  }

  return qs;
}

function buildFinalSetsFromPool(pool, targetCount) {
  const sets = [];
  const diagnostics = [];
  for (let i = 1; i <= targetCount; i += 1) {
    const capture = {};
    const set = composeOneSet(pool, i, 500, capture);
    if (!set) {
      if (capture.data) diagnostics.push(capture.data);
      console.warn(`  [assembly] set ${i} could not be assembled 锟?continuing to next`);
      continue;
    }
    set.questions = normalizeSetStyleRates(set.questions);
    sets.push(set);
  }
  return { sets, diagnostics };
}

function summarizeRejectReasons(map) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
}

function flushPoolCheckpoint(pool) {
  try {
    const snapshot = uniqBy(pool, stableAnswerKey).map((q) => {
      const c = cloneQuestion(q);
      delete c._meta;
      return c;
    });
    writeFileSync(RESERVE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    console.log(`[checkpoint] saved ${snapshot.length} questions to reserve_pool.json`);
  } catch (_) {
    // non-fatal
  }
}

// ── Post-generation rule checks and auto-fixes ───────────────────────────────
// Mirrors the checks in /api/admin/staging/[runId]/review/route.js
// Applied to final sets before writing, so deployed questions are clean.

const _PREP_FRAGMENT = /^(of|in|at|for|on|to|by|with|from|into|after|before|during|about|all|per)\s+(the|a|an|our|your|their|his|her|my|its)\b/i;
const _STANDALONE_ADVERBS = new Set([
  "yesterday","today","tomorrow","recently","finally","always","often",
  "sometimes","probably","eventually","suddenly","already","usually",
  "still","again","now","soon","later","early","just","once","twice",
]);

function escapeRegexStr(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function postGenerationRuleCheck(sets) {
  let fixCount = 0;
  for (const set of sets) {
    // Track distractor count per set for Fix 3 guard
    const getSetDistractorCount = () => (set.questions || []).filter((q) => q.distractor != null).length;

    for (const q of set.questions || []) {
      // Fix 1: contextViolations — ask/report/respond with non-empty prompt_context
      if (
        ["ask", "report", "respond", "yesno", "statement"].includes(q.prompt_task_kind) &&
        String(q.prompt_context || "").trim() !== ""
      ) {
        q.prompt_context = "";
        q.prompt = String(q.prompt_task_text || "").trim();
        fixCount++;
        console.log(`  [post-fix] cleared prompt_context on ${q.id}`);
      }

      // Fix 2: prepFragments — split "of the" / "in the" etc. into individual words
      // Guard: skip if splitting would push effective chunk count above 8
      // Guard: skip if splitting would introduce duplicate chunks in the bank
      {
        const effectiveBefore = (q.chunks || []).filter((c) => c !== q.distractor).length;
        const newChunks = [];
        let changed = false;
        let effectiveAfter = effectiveBefore;
        for (const chunk of q.chunks || []) {
          if (chunk !== q.distractor && _PREP_FRAGMENT.test(chunk.trim())) {
            const parts = chunk.trim().split(/\s+/);
            // Check if any split part already exists in the current bank
            const existingSet = new Set(newChunks.map((c) => c.toLowerCase()));
            for (const c of (q.chunks || [])) {
              if (c !== chunk) existingSet.add(c.toLowerCase());
            }
            const wouldDuplicate = parts.some((p) => existingSet.has(p.toLowerCase()));
            if (!wouldDuplicate && effectiveAfter + (parts.length - 1) <= 8) {
              newChunks.push(...parts);
              effectiveAfter += parts.length - 1;
              changed = true;
            } else {
              newChunks.push(chunk); // skip: would overflow or duplicate
            }
          } else {
            newChunks.push(chunk);
          }
        }
        if (changed) {
          q.chunks = newChunks;
          fixCount++;
          console.log(`  [post-fix] split prep-fragment chunks on ${q.id}`);
        }
      }

      // Fix 3: answerErrors — distractor word appears in answer (remove distractor)
      // Guard: skip if set is already at distractorMin to avoid failing validateQuestionSet
      if (q.distractor) {
        const re = new RegExp(`\\b${escapeRegexStr(q.distractor)}\\b`, "i");
        if (re.test(q.answer)) {
          if (getSetDistractorCount() > (ETS_STYLE_TARGETS.distractorMin ?? 7)) {
            q.chunks = (q.chunks || []).filter((c) => c !== q.distractor);
            q.distractor = null;
            q.has_distractor = false;
            fixCount++;
            console.log(`  [post-fix] removed bad distractor from ${q.id} (appeared in answer)`);
          } else {
            console.warn(`  [post-fix] SKIPPED distractor removal on ${q.id} (set at distractorMin)`);
          }
        }
      }

      // Fix 4: standaloneNot — standalone "not" chunk alongside an aux chunk
      // Attempt to merge with the preceding aux in the answer
      // Guard: skip if merge would drop effective chunk count below 4
      {
        const effectiveChunks = (q.chunks || []).filter((c) => c !== q.distractor);
        const hasStandaloneNot = effectiveChunks.some((c) => c.trim().toLowerCase() === "not");
        const hasPrecedingAux = effectiveChunks.some((c) =>
          _NEG_AUX.has(c.trim().toLowerCase())
        );
        if (hasStandaloneNot && hasPrecedingAux && effectiveChunks.length - 1 >= 4) {
          // Find which aux word precedes "not" in the answer
          const answerWords = q.answer.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
          const notIdx = answerWords.indexOf("not");
          if (notIdx > 0) {
            const auxWord = answerWords[notIdx - 1];
            if (_NEG_AUX.has(auxWord)) {
              const merged = `${auxWord} not`;
              // Remove standalone "not" and standalone aux, add merged chunk
              q.chunks = [
                ...(q.chunks || []).filter((c) => c !== q.distractor && c.trim().toLowerCase() !== "not" && c.trim().toLowerCase() !== auxWord),
                merged,
                ...(q.distractor ? [q.distractor] : []),
              ];
              fixCount++;
              console.log(`  [post-fix] merged standalone not → "${merged}" on ${q.id}`);
            }
          }
        }
      }

      // Log (no auto-fix): standaloneAdverbs — standalone time/frequency adverbs
      {
        const effectiveChunks = (q.chunks || []).filter((c) => c !== q.distractor);
        const badAdverbs = effectiveChunks.filter((c) => {
          const w = c.trim().split(/\s+/);
          return w.length === 1 && _STANDALONE_ADVERBS.has(w[0].toLowerCase());
        });
        if (badAdverbs.length > 0) {
          console.log(`  [post-fix] WARNING standalone adverb(s) on ${q.id}: ${badAdverbs.join(", ")} — needs manual review`);
        }
      }

      // Fix 5: standalone articles — merge "the"/"a"/"an" with next word in answer order
      {
        const articles = new Set(["the", "a", "an"]);
        const effectiveChunks = (q.chunks || []).filter((c) => c !== q.distractor);
        const hasStandaloneArticle = effectiveChunks.some((c) => articles.has(c.trim().toLowerCase()));
        if (hasStandaloneArticle && effectiveChunks.length - 1 >= 4) {
          const answerWords = q.answer.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
          const newChunks = [];
          const skipSet = new Set();
          for (let ci = 0; ci < (q.chunks || []).length; ci++) {
            if (skipSet.has(ci)) continue;
            const c = q.chunks[ci];
            if (c === q.distractor || !articles.has(c.trim().toLowerCase())) {
              newChunks.push(c);
              continue;
            }
            // Find next word after this article in the answer
            const artIdx = answerWords.indexOf(c.trim().toLowerCase());
            if (artIdx >= 0 && artIdx + 1 < answerWords.length) {
              const nextWord = answerWords[artIdx + 1];
              // Find the chunk that starts with nextWord
              const nextChunkIdx = (q.chunks || []).findIndex((nc, ni) =>
                ni > ci && !skipSet.has(ni) && nc !== q.distractor &&
                nc.trim().toLowerCase().startsWith(nextWord)
              );
              if (nextChunkIdx >= 0) {
                newChunks.push(`${c.trim()} ${q.chunks[nextChunkIdx].trim()}`);
                skipSet.add(nextChunkIdx);
                fixCount++;
                console.log(`  [post-fix] merged standalone article "${c}" → "${c.trim()} ${q.chunks[nextChunkIdx].trim()}" on ${q.id}`);
                continue;
              }
            }
            newChunks.push(c); // couldn't merge, keep as-is
          }
          if (skipSet.size > 0) q.chunks = newChunks;
        }
      }

      // Fix 6: normalize grammar_points labels
      {
        const NORM_MAP = {
          "embedded_question": "embedded question",
          "embedded_clause": "embedded question",
          "embedded_wh_clause": "embedded question",
          "embedded_whether_clause": "embedded question",
          "embedded_if_clause": "embedded question",
          "embedded-wh-clause": "embedded question",
          "embedded-wh": "embedded question",
          "embedded-question": "embedded question",
          "embedded wh-clause": "embedded question",
          "embedded if-clause": "embedded question",
          "relative_clause": "relative clause",
          "contact_clause": "contact clause",
          "past_perfect": "past perfect",
          "past_perfect_passive": "past perfect passive",
          "present_simple": "present tense",
          "simple_present": "present tense",
          "simple present": "present tense",
          "present simple": "present tense",
          "past_simple": "past tense",
          "simple_past": "past tense",
          "simple past": "past tense",
          "past simple": "past tense",
          "passive_voice": "passive voice",
          "passive-voice": "passive voice",
          "passive": "passive voice",
          "simple past passive": "passive voice",
          "passive modal": "passive voice",
          "present perfect passive": "passive voice",
          "3rd-person-reporting": "3rd person reporting",
          "3rd-reporting": "3rd person reporting",
          "3rd_person_reporting": "3rd person reporting",
          "reported speech": "indirect speech",
          "reporting": "indirect speech",
          "interrogative_frame": "interrogative",
          "interrogative-frame": "interrogative",
          "interrogative frame": "interrogative",
          "prepositional_phrase": "prepositional phrase",
          "prepositional phrases": "prepositional phrase",
          "adjective_complement": "adjective complement",
          "subject-verb agreement": "subject-verb agreement",
          "future time": "future",
          "simple future": "future",
          "future in the past": "future in the past",
          "past continuous": "past progressive",
          "past progressive passive": "past progressive",
          "present progressive": "present progressive",
          "direct statement": "direct",
          "1st person": "1st person",
          "1st-person": "1st person",
        };
        if (Array.isArray(q.grammar_points)) {
          q.grammar_points = q.grammar_points.map(gp => NORM_MAP[gp] || NORM_MAP[gp.toLowerCase()] || gp);
          // Deduplicate after normalization
          q.grammar_points = [...new Set(q.grammar_points)];
        }
      }
    }
  }

  // Fix 7: contraction conversion — per-set selection, ~35% overall, ≥1 per set with negation
  {
    const CONTRACTION_MAP = new Map([
      ["did not", "didn't"], ["do not", "don't"], ["does not", "doesn't"],
      ["have not", "haven't"], ["has not", "hasn't"], ["had not", "hadn't"],
      ["is not", "isn't"], ["are not", "aren't"],
      ["was not", "wasn't"], ["were not", "weren't"],
      ["will not", "won't"], ["would not", "wouldn't"],
      ["could not", "couldn't"], ["should not", "shouldn't"],
    ]);

    // Collect candidates per set
    const perSet = [];
    let totalCandidates = 0;
    for (let si = 0; si < sets.length; si++) {
      const setCandidates = [];
      for (const q of sets[si].questions || []) {
        const ansLower = q.answer.toLowerCase();
        for (const [full, contr] of CONTRACTION_MAP) {
          if (ansLower.includes(full)) {
            setCandidates.push({ q, full, contr, setIdx: si });
            break;
          }
        }
      }
      perSet.push(setCandidates);
      totalCandidates += setCandidates.length;
    }

    // Per-set selection: shuffle, try all until target succeed (at least 1)
    const selected = [];
    const setTargets = {};
    for (let si = 0; si < perSet.length; si++) {
      const sc = perSet[si];
      if (sc.length === 0) continue;
      for (let i = sc.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sc[i], sc[j]] = [sc[j], sc[i]];
      }
      setTargets[si] = Math.max(1, Math.round(sc.length * 0.35));
      selected.push(...sc);
    }

    let contrCount = 0;
    const setSuccesses = {};
    for (const { q, full, contr, setIdx } of selected) {
      if ((setSuccesses[setIdx] || 0) >= setTargets[setIdx]) continue;
      const auxWord = full.split(" ")[0]; // e.g. "did"
      const answerWords = q.answer.split(/\s+/);

      // Find "aux not" position in answer
      let auxIdx = -1;
      for (let i = 0; i < answerWords.length - 1; i++) {
        if (
          answerWords[i].toLowerCase() === auxWord &&
          answerWords[i + 1].toLowerCase().replace(/[.,!?;:]$/, "") === "not"
        ) {
          auxIdx = i;
          break;
        }
      }
      if (auxIdx < 0) continue;

      // Build contracted word (preserve capitalisation of original aux)
      const isUpper = answerWords[auxIdx][0] === answerWords[auxIdx][0].toUpperCase();
      let contracted = contr;
      if (isUpper) contracted = contr[0].toUpperCase() + contr.slice(1);
      // Carry any trailing punctuation from "not"
      const trailing = answerWords[auxIdx + 1].replace(/^not/i, "");

      // ── Determine strategy BEFORE modifying anything ──
      const chunks = q.chunks || [];
      const prefilledArr = q.prefilled || [];
      const prefilledPos = q.prefilled_positions || {};

      // Is "aux not" part of prefilled?
      const prefilledKey = Object.keys(prefilledPos).find(
        (k) => k.toLowerCase() === full || k.toLowerCase() === `${auxWord} not`
      );
      const isInPrefilled = !!prefilledKey;

      // Is "aux not" (or longer like "did not know") a chunk?
      const singleChunkIdx = chunks.findIndex(
        (c) => c !== q.distractor && (c.trim().toLowerCase() === full || c.trim().toLowerCase().startsWith(full + " "))
      );

      // Are "aux" and "not" separate chunks?
      const auxCI = chunks.findIndex((c) => c !== q.distractor && c.trim().toLowerCase() === auxWord);
      const notCI = chunks.findIndex((c) => c !== q.distractor && c.trim().toLowerCase() === "not");
      const areSeparate = auxCI >= 0 && notCI >= 0;

      // Need at least one viable strategy
      if (!isInPrefilled && singleChunkIdx < 0 && !areSeparate) continue;

      // Guard: if separate chunks, merging drops effective count — check floor
      if (areSeparate && !isInPrefilled && singleChunkIdx < 0) {
        const effective = chunks.filter((c) => c !== q.distractor).length;
        if (effective - 1 < 4) continue;
      }

      // ── Apply answer change ──
      answerWords.splice(auxIdx, 2, contracted + trailing);
      q.answer = answerWords.join(" ");

      // ── Shift prefilled_positions entries that came after auxIdx+1 ──
      const newPos = {};
      for (const [word, pos] of Object.entries(prefilledPos)) {
        if (word === prefilledKey) {
          // This prefilled entry IS the negation — update key & keep position
          newPos[contracted] = pos;
        } else {
          newPos[word] = pos > auxIdx + 1 ? pos - 1 : pos;
        }
      }
      q.prefilled_positions = newPos;

      // Update prefilled array
      if (isInPrefilled) {
        const pi = prefilledArr.indexOf(prefilledKey);
        if (pi >= 0) prefilledArr[pi] = contracted;
      }

      // ── Update chunks ──
      if (singleChunkIdx >= 0) {
        const orig = chunks[singleChunkIdx].trim();
        if (orig.toLowerCase() === full) {
          chunks[singleChunkIdx] = contracted;
        } else {
          // "did not know" → "didn't know"
          chunks[singleChunkIdx] = contracted + orig.slice(full.length);
        }
      } else if (areSeparate && !isInPrefilled) {
        // Remove both chunks, add contraction
        const toRemove = new Set([auxCI, notCI]);
        q.chunks = chunks.filter((_, i) => !toRemove.has(i));
        q.chunks.push(contracted);
      }
      // If isInPrefilled and no chunk to fix, answer + prefilled are already updated — done

      contrCount++;
      fixCount++;
      setSuccesses[setIdx] = (setSuccesses[setIdx] || 0) + 1;
      console.log(`  [post-fix] contraction "${full}" → "${contr}" on ${q.id}`);
    }
    if (totalCandidates > 0) {
      console.log(`  [contraction] converted ${contrCount}/${totalCandidates} negation items (${(contrCount / totalCandidates * 100).toFixed(0)}%)`);
    }
  }

  if (fixCount > 0) {
    console.log(`[post-generation-fix] applied ${fixCount} rule fix(es) across ${sets.length} set(s)`);
  } else {
    console.log(`[post-generation-fix] no issues found in ${sets.length} set(s)`);
  }
}

// ─── D approach: post-assembly prompt rewrite ───────────────────────────────
// After sets are assembled with ask/report/respond prompts, rewrite ~2 items
// per set to yesno and ~2 to statement. This decouples answer structure from
// prompt format — the generator never sees yesno/statement, so answer quality
// (especially embedded rate) is never compromised.

const YESNO_TARGET_PER_SET = 0;   // yesno removed: leaks answer content (60% word overlap)
const STATEMENT_TARGET_PER_SET = 2;

function buildPromptRewritePrompt(yesnoItems, statementItems) {
  const yesnoSection = yesnoItems.map(q => ({
    id: q.id,
    answer: q.answer,
    grammar_points: q.grammar_points,
    current_prompt: q.prompt_task_text || q.prompt,
  }));
  const statementSection = statementItems.map(q => ({
    id: q.id,
    answer: q.answer,
    grammar_points: q.grammar_points,
    current_prompt: q.prompt_task_text || q.prompt,
  }));

  return `You are a TOEFL iBT prompt rewriter. You will rewrite prompts for existing questions WITHOUT changing the answers.

## TASK:
For each item below, generate a NEW prompt in the specified format. The ANSWER stays exactly the same.

## YESNO FORMAT (${yesnoItems.length} items):
Rewrite each prompt as a YES/NO question:
- MUST start with an auxiliary verb: Did/Do/Does/Are/Is/Can/Could/Would/Will/Have/Has/Were/Was
- MUST end with "?"
- The question should be NATURALLY ANSWERABLE by the given answer
- Keep it conversational and natural — imagine a real TOEFL dialogue

Examples:
  answer: "The manager wanted to know when the report was due."
  → yesno prompt: "Did the manager ask about the report deadline?"

  answer: "I am not sure what time the event starts."
  → yesno prompt: "Do you know when the event begins?"

  answer: "She did not understand why the deadline had been changed."
  → yesno prompt: "Did she understand the reason for the schedule change?"

ITEMS TO REWRITE AS YESNO:
${JSON.stringify(yesnoSection, null, 2)}

## STATEMENT FORMAT (${statementItems.length} items):
Rewrite each prompt as a CONTEXT-SETTING declarative sentence:
- MUST be a natural declarative sentence ending with "."
- It should paint a mini-scene that makes the answer a natural response
- NEVER use "Complete the sentence" or any meta-instruction
- The prompt sets the CONTEXT, the answer is the student's RESPONSE

Examples:
  answer: "The professor asked whether the experiment had been approved."
  → statement prompt: "The professor called the research assistant into her office."

  answer: "I have no idea where they are going."
  → statement prompt: "Your roommate asked about the group's weekend plans."

  answer: "She did not know why the meeting was postponed."
  → statement prompt: "The intern seemed confused after the team meeting."

ITEMS TO REWRITE AS STATEMENT:
${JSON.stringify(statementSection, null, 2)}

## OUTPUT:
Return ONLY a JSON array of objects: [{"id": "...", "prompt_task_kind": "yesno"|"statement", "prompt_task_text": "..."}]
No markdown fences. No explanation.`.trim();
}

async function rewriteSetPrompts(sets) {
  console.log(`\n[prompt-rewrite] rewriting prompts for ${sets.length} set(s)...`);

  // Collect all items to rewrite across all sets in one batch
  const allYesno = [];
  const allStatement = [];
  const allQuestionMap = new Map(); // id → question ref

  for (let si = 0; si < sets.length; si++) {
    const questions = sets[si].questions;
    const candidates = questions.filter(q =>
      !q.has_question_mark &&
      ["ask", "report", "respond"].includes(q.prompt_task_kind)
    );

    const existingYesno = questions.filter(q => q.prompt_task_kind === "yesno").length;
    const existingStatement = questions.filter(q => q.prompt_task_kind === "statement").length;
    const yesnoNeeded = Math.max(0, YESNO_TARGET_PER_SET - existingYesno);
    const statementNeeded = Math.max(0, STATEMENT_TARGET_PER_SET - existingStatement);

    if (yesnoNeeded + statementNeeded === 0) {
      console.log(`  set ${si + 1}: already has ${existingYesno} yesno + ${existingStatement} statement`);
      continue;
    }
    if (candidates.length < yesnoNeeded + statementNeeded) {
      console.log(`  set ${si + 1}: not enough candidates (${candidates.length}), skipping`);
      continue;
    }

    // Prefer non-embedded candidates for rewrite to preserve embedded rate
    const nonEmbedded = candidates.filter(q => !isEmbeddedQuestion(q.grammar_points));
    const embeddedCands = candidates.filter(q => isEmbeddedQuestion(q.grammar_points));
    const ordered = [...shuffle(nonEmbedded), ...shuffle(embeddedCands)];
    for (let i = 0; i < yesnoNeeded; i++) allYesno.push(ordered[i]);
    for (let i = 0; i < statementNeeded; i++) allStatement.push(ordered[yesnoNeeded + i]);
    questions.forEach(q => allQuestionMap.set(q.id, q));
  }

  const totalTarget = allYesno.length + allStatement.length;
  if (totalTarget === 0) {
    console.log("[prompt-rewrite] nothing to rewrite");
    return;
  }
  console.log(`  batch: ${allYesno.length} yesno + ${allStatement.length} statement = ${totalTarget} items`);

  // Wait 10s after generation phase to avoid rate limiting
  await new Promise(r => setTimeout(r, 10000));

  // Single batched API call with retry
  let totalRewritten = 0;
  let _rewriteRetryPrompt = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const prompt = _rewriteRetryPrompt || buildPromptRewritePrompt(allYesno, allStatement);
      _rewriteRetryPrompt = null;
      const raw = await callDeepSeekViaCurl({
        apiKey: process.env.DEEPSEEK_API_KEY,
        proxyUrl: resolveProxyUrl(),
        timeoutMs: 120000,
        payload: {
          model: "deepseek-chat",
          temperature: 0,
          max_tokens: 5000,
          messages: [{ role: "user", content: prompt }],
        },
      });

      const text = String(raw || "");
      const arrStart = text.indexOf("[");
      const arrEnd = text.lastIndexOf("]");
      if (arrStart < 0 || arrEnd <= arrStart) {
        console.log(`  attempt ${attempt + 1}: no JSON array in response (len=${text.length})`);
        if (text.length < 300) console.log(`    response: ${text}`);
        if (attempt === 0) { await new Promise(r => setTimeout(r, 10000)); continue; }
        break;
      }
      const rewrites = JSON.parse(text.slice(arrStart, arrEnd + 1));
      console.log(`  attempt ${attempt + 1}: got ${rewrites.length} rewrites from API`);

      const rejectFeedback = [];
      for (const rw of rewrites) {
        const q = allQuestionMap.get(rw.id);
        if (!q) {
          console.log(`    id "${rw.id}" not found`);
          continue;
        }
        const newKind = String(rw.prompt_task_kind || "").trim().toLowerCase();
        const newText = String(rw.prompt_task_text || rw.prompt_text || rw.promptTaskText || rw.task_text || rw.text || "").trim();
        if (!newText) {
          console.log(`    ${rw.id} skipped: empty prompt_task_text (keys: ${Object.keys(rw).join(",")})`);
          rejectFeedback.push({ id: rw.id, reason: "empty prompt_task_text" });
          continue;
        }

        const testQ = { ...q, prompt_task_kind: newKind, prompt_task_text: newText, prompt_context: "" };
        const check = validateStructuredPromptParts(testQ);
        if (check.fatal.length > 0) {
          console.log(`    ${rw.id} rejected: ${check.fatal.join("; ")}`);
          rejectFeedback.push({ id: rw.id, reason: check.fatal.join("; "), attempted: newText.slice(0, 80) });
          continue;
        }

        q.prompt_task_kind = newKind;
        q.prompt_task_text = newText;
        q.prompt_context = "";
        q.prompt = newText;
        totalRewritten++;
      }
      console.log(`  applied ${totalRewritten}/${totalTarget} rewrites`);

      // P2.2: If all rewrites rejected on first attempt, retry with rejection feedback
      if (totalRewritten === 0 && attempt === 0 && rejectFeedback.length > 0) {
        console.log(`  all rejected, retrying with feedback...`);
        const feedbackLines = rejectFeedback.slice(0, 6).map(
          f => `  - ${f.id}: "${f.attempted || "(empty)"}" → rejected: ${f.reason}`
        ).join("\n");
        const retryNote = `\n\nIMPORTANT: Your previous rewrite attempt was FULLY REJECTED. Common mistakes:\n${feedbackLines}\n\nRules:\n- yesno prompt MUST be a yes/no question ending with "?"\n- statement prompt MUST be a declarative sentence ending with "."\n- prompt must NOT contain meta-instructions like "Complete the sentence"\n- prompt must relate to the answer content\n- Return field name exactly as "prompt_task_text"`;
        // Inject feedback into next attempt's prompt
        const origPrompt = buildPromptRewritePrompt(allYesno, allStatement);
        const feedbackPrompt = origPrompt + retryNote;
        // Store for next iteration
        _rewriteRetryPrompt = feedbackPrompt;
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      break;
    } catch (e) {
      console.log(`  attempt ${attempt + 1} failed: ${e.message}`);
      if (attempt === 0) await new Promise(r => setTimeout(r, 10000));
    }
  }

  // Per-set summary
  for (let si = 0; si < sets.length; si++) {
    const qs = sets[si].questions;
    const yn = qs.filter(q => q.prompt_task_kind === "yesno").length;
    const st = qs.filter(q => q.prompt_task_kind === "statement").length;
    console.log(`  set ${si + 1}: yesno=${yn} statement=${st}`);
  }
  console.log(`[prompt-rewrite] total: ${totalRewritten} prompts rewritten`);
}

// ─── Fix 8: post-assembly overlap detection and prompt rewrite ──────────────
// Detects questions where prompt leaks >30% content words from the answer,
// then rewrites their prompts using generic/abstract phrasing (TPO style).
// No questions are rejected — originals are kept if rewrite fails.

const OVERLAP_THRESHOLD = 0.30;
const OVERLAP_STOPWORDS = new Set([
  "the","a","an","is","are","was","were","do","does","did","have","has","had",
  "i","you","she","he","it","we","they","my","your","her","his","that","this",
  "in","on","at","to","of","for","and","or","not","if","whether","be","been",
  "being","by","with","from","about","would","could","should","will","can","may",
  "what","how","where","when","why","who","whom","which","yes","no","some","just",
  "very","much","also","so","but","then","than","all","any","its",
]);

function overlapContentWords(text) {
  return text.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !OVERLAP_STOPWORDS.has(w));
}

function computeOverlapRate(prompt, answer) {
  const pWords = overlapContentWords(prompt || "");
  const aWords = overlapContentWords(answer);
  if (aWords.length === 0) return 0;
  return aWords.filter(w => pWords.includes(w)).length / aWords.length;
}

function buildOverlapRewritePrompt(items) {
  const data = items.map(q => ({
    id: q.id,
    answer: q.answer,
    current_prompt: q.prompt_task_text || q.prompt,
    prompt_task_kind: q.prompt_task_kind,
    overlap_words: (() => {
      const pW = overlapContentWords(q.prompt_task_text || q.prompt);
      const aW = overlapContentWords(q.answer);
      return aW.filter(w => pW.includes(w));
    })(),
  }));

  return `You are a TOEFL iBT prompt rewriter. Rewrite each prompt to REMOVE content word overlap with the answer.

## PRINCIPLE: Generic → Specific
The prompt should use GENERIC/ABSTRACT words. The answer reveals the SPECIFIC details.
The student should NOT be able to guess answer words from reading the prompt.

## EXAMPLES:
BAD:  prompt: "Your neighbor apologized for the early morning construction noise."
      answer: "I didn't hear the construction noise this morning."
      overlap: [construction, noise, morning] — 60%

GOOD: prompt: "Your neighbor apologized for causing a disturbance."
      answer: "I didn't hear the construction noise this morning."
      overlap: [] — 0%

BAD:  prompt: "Your roommate was looking for the package that arrived yesterday."
      answer: "I found out where the package that arrived yesterday is kept."
      overlap: [package, arrived, yesterday] — 50%

GOOD: prompt: "Your roommate could not locate a delivery."
      answer: "I found out where the package that arrived yesterday is kept."
      overlap: [] — 0%

## RULES:
1. Replace specific nouns with generic terms (construction noise → disturbance, package → delivery, book club → event)
2. Remove temporal details that appear in the answer (yesterday, next week, this morning)
3. Keep the same prompt_task_kind — do NOT change it
4. For "ask" kind: must start with What/How/Where/Why/When and end with "?"
5. For "report" kind: must start with Report/Describe/Explain/Summarize/Mention/State/Say/Express and end with "."
6. For "respond" kind: must start with Tell/Respond/Reply/Answer/Share/Say/Express/Inform and end with "."
7. For "statement" kind: must be a declarative context sentence ending with "."
8. The rewritten prompt must still make sense as a prompt for the given answer

## ITEMS TO REWRITE (${items.length}):
${JSON.stringify(data, null, 2)}

## OUTPUT:
Return ONLY a JSON array: [{"id": "...", "prompt_task_kind": "...", "prompt_task_text": "..."}]
No markdown fences. No explanation.`.trim();
}

async function rewriteHighOverlapPrompts(sets) {
  const allQuestions = sets.flatMap(s => s.questions);
  const highOverlap = allQuestions.filter(q => computeOverlapRate(q.prompt, q.answer) > OVERLAP_THRESHOLD);

  console.log(`\n[overlap-rewrite] checking ${allQuestions.length} questions for >${(OVERLAP_THRESHOLD * 100).toFixed(0)}% content overlap...`);
  console.log(`  found ${highOverlap.length} questions above threshold`);

  if (highOverlap.length === 0) return;

  const qMap = new Map(highOverlap.map(q => [q.id, q]));

  // Wait to avoid rate limiting
  await new Promise(r => setTimeout(r, 5000));

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const prompt = buildOverlapRewritePrompt(highOverlap.filter(q => computeOverlapRate(q.prompt, q.answer) > OVERLAP_THRESHOLD));
      const remaining = highOverlap.filter(q => computeOverlapRate(q.prompt, q.answer) > OVERLAP_THRESHOLD).length;
      if (remaining === 0) break;

      const raw = await callDeepSeekViaCurl({
        apiKey: process.env.DEEPSEEK_API_KEY,
        proxyUrl: resolveProxyUrl(),
        timeoutMs: 120000,
        payload: {
          model: "deepseek-chat",
          temperature: 0.3,
          max_tokens: 8000,
          messages: [{ role: "user", content: prompt }],
        },
      });

      const text = String(raw || "");
      const arrStart = text.indexOf("[");
      const arrEnd = text.lastIndexOf("]");
      if (arrStart < 0 || arrEnd <= arrStart) {
        console.log(`  attempt ${attempt + 1}: no JSON array in response`);
        if (attempt === 0) { await new Promise(r => setTimeout(r, 10000)); continue; }
        break;
      }

      const rewrites = JSON.parse(text.slice(arrStart, arrEnd + 1));
      console.log(`  attempt ${attempt + 1}: got ${rewrites.length} rewrites`);

      let applied = 0, rejected = 0;
      for (const rw of rewrites) {
        const q = qMap.get(rw.id);
        if (!q) continue;

        const newKind = String(rw.prompt_task_kind || "").trim().toLowerCase();
        const newText = String(rw.prompt_task_text || "").trim();
        if (!newText) { rejected++; continue; }

        // Validate
        const testQ = { ...q, prompt_task_kind: newKind, prompt_task_text: newText, prompt_context: "" };
        const check = validateStructuredPromptParts(testQ);
        if (check.fatal.length > 0) {
          console.log(`    ${rw.id}: rejected — ${check.fatal.join("; ")}`);
          rejected++;
          continue;
        }

        // Check if overlap actually improved
        const oldRate = computeOverlapRate(q.prompt, q.answer);
        const newRate = computeOverlapRate(newText, q.answer);
        if (newRate >= oldRate) {
          console.log(`    ${rw.id}: no improvement (${(oldRate * 100).toFixed(0)}% → ${(newRate * 100).toFixed(0)}%)`);
          rejected++;
          continue;
        }

        q.prompt_task_kind = newKind;
        q.prompt_task_text = newText;
        q.prompt_context = "";
        q.prompt = newText;
        applied++;
        console.log(`    ${rw.id}: ${(oldRate * 100).toFixed(0)}% → ${(newRate * 100).toFixed(0)}%`);
      }

      console.log(`  applied: ${applied}, rejected: ${rejected}`);
      if (applied > 0 || attempt > 0) break;
      await new Promise(r => setTimeout(r, 10000));
    } catch (e) {
      console.log(`  attempt ${attempt + 1} failed: ${e.message}`);
      if (attempt === 0) await new Promise(r => setTimeout(r, 10000));
    }
  }

  const stillHigh = allQuestions.filter(q => computeOverlapRate(q.prompt, q.answer) > OVERLAP_THRESHOLD).length;
  console.log(`[overlap-rewrite] done. Remaining >${(OVERLAP_THRESHOLD * 100).toFixed(0)}%: ${stillHigh}`);
}

async function main() {
  loadEnv();
  _cb.init({
    window: CIRCUIT_BREAKER_WINDOW,
    minGenerated: CIRCUIT_BREAKER_MIN_GENERATED,
    minAcceptRate: CIRCUIT_BREAKER_MIN_ACCEPT_RATE,
    cooldownRounds: CIRCUIT_BREAKER_COOLDOWN_ROUNDS,
    exemptTypes: CIRCUIT_BREAKER_EXEMPT_TYPES,
    logPath: CIRCUIT_BREAKER_LOG_PATH,
    typeList: TYPE_LIST,
  });
  const hasRelay = getRelayConfigs().length > 0;
  const hasDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);
  if (!hasDeepSeek) {
    console.error("ERROR: DEEPSEEK_API_KEY required (generator uses DeepSeek)");
    _lastFailureReason = "未配置 DEEPSEEK_API_KEY（generator 需要 DeepSeek）";
    process.exit(1);
  }

  console.log("Build Sentence Robust Generator");
  console.log("==============================");
  console.log(`Target sets: ${TARGET_SET_COUNT}`);
  console.log(`Generator: DeepSeek V3.2 (deepseek-chat)`);
  console.log(`Reviewer: ${hasRelay ? `Claude relay → ${process.env.CLAUDE_GENERATOR_MODEL || "claude-sonnet-4-6"} (${getRelayConfigs().map((x) => x.baseUrl).join(", ")})` : "DeepSeek (no relay configured)"}`);
  console.log(`Reviewer fallback: ${hasRelay && hasDeepSeek ? "DeepSeek enabled" : "none"}`);
  console.log(`Proxy: ${resolveProxyUrl() || "(direct)"}`);

  // Seed pool from questions.json (active bank) + reserve_pool.json (leftovers)
  // Filter out legacy questions with multi-sentence prompts so they are regenerated fresh.
  function hasLegacyMultiSentencePrompt(q) {
    const kind = (q.prompt_task_kind || "").toLowerCase();
    if (!["ask", "report", "respond", "yesno", "statement"].includes(kind)) return false;
    const ctx = (q.prompt_context || "").trim();
    if (ctx) return true; // separate context sentence — old two-part format
    const task = (q.prompt_task_text || "").trim();
    const sentences = task.split(/(?<=[.!?])\s+/).filter(Boolean);
    return sentences.length >= 2; // background embedded in task_text as multiple sentences
  }

  // ── CLI flags ──
  const cliArgs = process.argv.slice(2);
  const resumeFlag = cliArgs.includes("--resume");

  // ── Global answer dedup ──
  const globalAnswerHashes = loadAnswerHashes();

  // ── Checkpoint resume ──
  let checkpoint = null;
  if (resumeFlag) {
    checkpoint = loadCheckpoint();
    if (checkpoint?.version === 1 && checkpoint.targetSetCount === TARGET_SET_COUNT) {
      console.log(`Resuming from checkpoint: round ${checkpoint.totalRound}, pool ${checkpoint.acceptedPool?.length || 0} questions`);
      // Merge checkpoint hashes into global set
      if (checkpoint.globalAnswerHashes) checkpoint.globalAnswerHashes.forEach(h => globalAnswerHashes.add(h));
    } else {
      if (checkpoint) console.log("Checkpoint incompatible (different target), starting fresh.");
      checkpoint = null;
    }
  }

  const acceptedPool = [];
  if (checkpoint) {
    acceptedPool.push(...(checkpoint.acceptedPool || []));
  } else {
    for (const [label, filePath] of [["questions.json", OUTPUT_PATH], ["reserve_pool.json", RESERVE_PATH]]) {
      try {
        const data = JSON.parse(readFileSync(filePath, "utf8"));
        const seeded = Array.isArray(data)
          ? data
          : (data.question_sets || []).flatMap((s) => s.questions || []);
        const clean = seeded.filter(q => !hasLegacyMultiSentencePrompt(q));
        const dropped = seeded.length - clean.length;
        if (clean.length > 0) {
          acceptedPool.push(...clean);
          console.log(`Seeded ${clean.length} questions from ${label}${dropped > 0 ? ` (dropped ${dropped} with legacy multi-sentence prompts)` : ""}`);
        }
      } catch (_) {
        // file missing or invalid — skip
      }
    }
    // P2.4: Archive recycling — if reserve_pool was empty/small, backfill from newest archive
    try {
      const reserveCount = acceptedPool.length;
      if (reserveCount < 20 && existsSync(RESERVE_ARCHIVE_DIR)) {
        const archives = readdirSync(RESERVE_ARCHIVE_DIR)
          .filter(f => f.startsWith("reserve_") && f.endsWith(".json"))
          .sort()
          .reverse(); // newest first
        for (const archiveFile of archives.slice(0, 3)) {
          try {
            const archivePath = resolve(RESERVE_ARCHIVE_DIR, archiveFile);
            const archiveData = JSON.parse(readFileSync(archivePath, "utf8"));
            if (Array.isArray(archiveData) && archiveData.length > 0) {
              const clean = archiveData.filter(q => !hasLegacyMultiSentencePrompt(q));
              acceptedPool.push(...clean);
              console.log(`Recycled ${clean.length} questions from archive/${archiveFile}`);
            }
          } catch (_) { /* skip corrupt archive */ }
        }
      }
    } catch (_) { /* archive dir missing — fine */ }
  }

  // Register all seeded/restored answers into global hash set
  acceptedPool.forEach(q => globalAnswerHashes.add(hashAnswer(q)));
  console.log(`Global answer hashes: ${globalAnswerHashes.size} loaded`);
  checkAcceptanceTrend();

  const runStartTime = Date.now();
  const rejectReasons = checkpoint?.rejectReasons || {};
  let rollingRejectFeedback = checkpoint?.rollingRejectFeedback || "";
  let statTotalRounds = checkpoint?.statTotalRounds || 0;
  let statTotalGenerated = checkpoint?.statTotalGenerated || 0;
  let statTotalAccepted = checkpoint?.statTotalAccepted || 0;
  const circuitBreakerState = checkpoint?.circuitBreakerState || createCircuitBreakerState();
  const easyTarget = ETS_2026_TARGET_COUNTS_10.easy * TARGET_SET_COUNT;
  const mediumTarget = ETS_2026_TARGET_COUNTS_10.medium * TARGET_SET_COUNT;
  const hardTarget = ETS_2026_TARGET_COUNTS_10.hard * TARGET_SET_COUNT;
  const styleTargets = {
    embeddedMin: 5 * TARGET_SET_COUNT,
    negationMin: 2 * TARGET_SET_COUNT,
    distractorMin: 7 * TARGET_SET_COUNT,
    qmarkMax: 2 * TARGET_SET_COUNT,
  };

  const BUFFER = 1.5;
  const difficultyTargets = {
    easy: Math.ceil(easyTarget * BUFFER),
    medium: Math.ceil(mediumTarget * BUFFER),
    hard: Math.ceil(hardTarget * BUFFER),
  };
  const globalTypeTargetTotal = TARGET_SET_COUNT * 10;
  const globalTypeTargets = Object.fromEntries(
    TYPE_LIST.map((type) => [type, Math.max(1, Math.ceil(globalTypeTargetTotal * TPO_TYPE_TARGET_RATIO[type]))]),
  );
  const diagnosticsState = {
    generated_at: new Date().toISOString(),
    targetSets: TARGET_SET_COUNT,
    outputPath: OUTPUT_PATH,
    rounds: [],
    final: null,
  };
  const specCooldowns = {};
  const specFamilyCooldowns = {};

  function flushDiagnostics() {
    try {
      writeFileSync(DIAGNOSTICS_PATH, `${JSON.stringify(diagnosticsState, null, 2)}\n`, "utf8");
    } catch (_) {
      // non-fatal
    }
  }

  // ── Graceful stop signal ─────────────────────────────────────────────────
  let _gracefulStopRequested = false;

  async function checkStopSignal() {
    // Check if a .stop file was created in the repo via admin UI
    const ghToken = process.env.GITHUB_TOKEN;
    const ghRepo = process.env.GITHUB_REPOSITORY;
    const outputPath = process.env.BS_OUTPUT_PATH || "";
    const runId = outputPath.match(/(\d+)\.json$/)?.[1];
    if (!ghToken || !ghRepo || !runId) return false;
    try {
      const url = `https://api.github.com/repos/${ghRepo}/contents/data/buildSentence/staging/${runId}.stop`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json" },
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  // ── Unified adaptive generation loop ──────────────────────────────────────
  const MAX_ROUNDS = Number(process.env.BS_MAX_ROUNDS) || (8 + TARGET_SET_COUNT * 4);
  const GAP_TOLERANCE = 5;
  const STUCK_ROUNDS = 5;
  console.log(`Max rounds: ${MAX_ROUNDS} (= 8 + ${TARGET_SET_COUNT} sets × 4)`);

  // Total gap: diff + type (covers type-based style needs) + distractor (only style not covered by type)
  // Does NOT double-count negation/embedded which appear in both type and style targets.
  function computeTotalGap(poolState, pool) {
    const assemblyState = computeAssemblyState(poolState);
    const diffGap =
      Math.max(0, difficultyTargets.easy - pool.easy.length) +
      Math.max(0, difficultyTargets.medium - pool.medium.length) +
      Math.max(0, difficultyTargets.hard - pool.hard.length);
    const distractorGap = Math.max(0, styleTargets.distractorMin - poolState.style.distractor);
    const diversityGap = TYPE_LIST.reduce((sum, t) => sum + (((poolState.typeTotals[t] || 0) === 0) ? 1 : 0), 0);
    const assemblyBlockingGap =
      Math.max(0, assemblyState.deficits.embedded) +
      Math.max(0, assemblyState.deficits.nonEmbedded) +
      Math.max(0, assemblyState.embeddedOverflow) +
      Math.max(0, assemblyState.deficits.negation) +
      Math.max(0, assemblyState.negationOverflow);
    return {
      total: diffGap + distractorGap + assemblyBlockingGap + diversityGap,
      diffGap,
      typeGap: diversityGap,
      distractorGap,
      assemblyBlockingGap,
    };
  }

  function formatGap(gap) {
    return `${gap.total} (diff=${gap.diffGap} diversity=${gap.typeGap} distractor=${gap.distractorGap} assembly=${gap.assemblyBlockingGap || 0})`;
  }

  function formatAssemblyState(state) {
    return `sets=${state.assemblableSets}/${TARGET_SET_COUNT} neg=${state.negation} nonEmb=${state.nonEmbedded} emb=${state.embedded}`;
  }

  function formatAssemblyProgress(state) {
    return `${((state?.assemblyProgressScore || 0) * 100).toFixed(0)}%`;
  }

  function formatLimitingFactors(state, count = 2) {
    const top = (state?.limitingFactors || []).slice(0, count).map((item) => item.key);
    return top.length > 0 ? top.join(",") : "none";
  }

  function computeTypeReliability(rounds, window = 6) {
    const recent = (rounds || []).slice(-window).filter((round) => round?.result?.typeStats);
    const stats = Object.fromEntries(TYPE_LIST.map((type) => [type, {
      generated: 0,
      accepted: 0,
      blockers: 0,
      hardFails: 0,
    }]));
    for (const round of recent) {
      const typeStats = round.result.typeStats || {};
      for (const type of TYPE_LIST) {
        const s = typeStats[type] || {};
        stats[type].generated += s.generated || 0;
        stats[type].accepted += s.accepted || 0;
        const reasons = s.reasons || {};
        for (const [reason, count] of Object.entries(reasons)) {
          if (/^review:blocker:/.test(reason)) stats[type].blockers += count;
          if (/^fatal:|^runtime:|^format:|^chunks:/.test(reason)) stats[type].hardFails += count;
        }
      }
    }

    return Object.fromEntries(TYPE_LIST.map((type) => {
      const s = stats[type];
      if (s.generated === 0) return [type, 0.8];
      const acceptRate = s.accepted / s.generated;
      const blockerRate = s.blockers / s.generated;
      const hardFailRate = s.hardFails / s.generated;
      const reliability = Math.max(0.2, Math.min(1.25, 0.35 + acceptRate * 0.95 - blockerRate * 0.45 - hardFailRate * 0.35));
      return [type, Math.round(reliability * 100) / 100];
    }));
  }

  function computeAssemblyMomentum(rounds, window = 5) {
    const recent = (rounds || []).slice(-window).filter((round) => round?.result && round?.nextAssemblyState);
    const totals = {
      windowCount: recent.length,
      accepted: 0,
      generated: 0,
      poolGrowth: 0,
      deltaAssemblable: 0,
      deltaProgress: 0,
      zeroGainRounds: 0,
      zeroProgressRounds: 0,
    };
    for (const round of recent) {
      const accepted = round.result.accepted || 0;
      const delta = (round.nextAssemblyState?.assemblableSets || 0) - (round.assemblyState?.assemblableSets || 0);
      const progressDelta = (round.nextAssemblyState?.assemblyProgressScore || 0) - (round.assemblyState?.assemblyProgressScore || 0);
      totals.accepted += accepted;
      totals.generated += round.result.generated || 0;
      totals.poolGrowth += accepted;
      totals.deltaAssemblable += delta;
      totals.deltaProgress += progressDelta;
      if (accepted > 0 && delta <= 0) totals.zeroGainRounds += 1;
      if (accepted > 0 && progressDelta <= 0.005) totals.zeroProgressRounds += 1;
    }
    totals.acceptedGainRate = totals.accepted > 0
      ? (totals.deltaAssemblable + totals.deltaProgress * 2.5) / totals.accepted
      : 0;
    return totals;
  }

  function computePhaseSignals(poolState, assemblyState, rounds) {
    const total = poolState?.style?.total || 0;
    const embeddedRatio = total > 0 ? (assemblyState.embedded / total) : 0;
    const remainingThreshold = Math.max(2, Math.ceil(TARGET_SET_COUNT * 0.1));
    const momentum = computeAssemblyMomentum(rounds);
    const previousRound = (rounds || []).slice(-1)[0] || null;
    const previousStrong = previousRound?.phaseSignals?.strongTargeting === true;
    const previousRepair = previousRound?.phaseSignals?.repairMode === true;
    const strongReasons = [];
    const repairReasons = [];
    const strongGateReady =
      total >= Math.ceil(TARGET_SET_COUNT * 10 * 0.45) &&
      (assemblyState.assemblableSets >= 1 || total >= Math.ceil(TARGET_SET_COUNT * 10 * 0.75));
    const repairGateReady =
      total >= Math.ceil(TARGET_SET_COUNT * 10 * 0.2) ||
      assemblyState.assemblableSets >= 1;

    if (strongGateReady) {
      if (assemblyState.remainingSets <= remainingThreshold) strongReasons.push("remaining_sets");
      if (assemblyState.assemblableSets >= TARGET_SET_COUNT - remainingThreshold) strongReasons.push("near_completion");
      if (momentum.windowCount >= 4 && momentum.poolGrowth > 0 && momentum.deltaAssemblable <= 0 && momentum.deltaProgress <= 0.03) {
        strongReasons.push("assembly_stagnation");
      }
      if (momentum.windowCount >= 4 && momentum.poolGrowth > 0 && momentum.acceptedGainRate <= 0.03) {
        strongReasons.push("low_gain_rate");
      }
      if (total >= Math.ceil(TARGET_SET_COUNT * 10 * 1.15)) strongReasons.push("pool_oversupply");
    }

    if (strongReasons.length > 0) repairReasons.push(...strongReasons);
    if (repairGateReady && assemblyState.deficits.nonEmbedded > 0 && embeddedRatio >= 0.72 && total >= Math.ceil(TARGET_SET_COUNT * 10 * 0.35)) {
      repairReasons.push("non_embedded_shortage");
    }
    if (repairGateReady && assemblyState.deficits.embedded > 0 && total >= Math.ceil(TARGET_SET_COUNT * 10 * 0.2)) {
      repairReasons.push("embedded_shortage");
    }
    if (repairGateReady && assemblyState.embeddedOverflow > 0 && total >= Math.ceil(TARGET_SET_COUNT * 10 * 0.35)) {
      repairReasons.push("embedded_overflow");
    }
    if (repairGateReady && assemblyState.negationOverflow > 0 && total >= Math.ceil(TARGET_SET_COUNT * 10 * 0.35)) {
      repairReasons.push("negation_overflow");
    }
    if (repairGateReady && total >= Math.ceil(TARGET_SET_COUNT * 10 * 0.7)) repairReasons.push("pool_size");
    if (repairGateReady && assemblyState.assemblableSets >= Math.max(1, TARGET_SET_COUNT - 3)) repairReasons.push("assemblable_near_target");
    if (previousStrong && strongGateReady && total >= Math.ceil(TARGET_SET_COUNT * 10 * 0.5) && strongReasons.length > 0) {
      strongReasons.push("sticky_last_mile");
      repairReasons.push("sticky_last_mile");
    } else if (previousRepair && repairGateReady && repairReasons.length > 0) {
      repairReasons.push("sticky_repair");
    }

    return {
      strongTargeting: strongReasons.length > 0,
      repairMode: repairReasons.length > 0,
      strongGateReady,
      repairGateReady,
      strongReasons: [...new Set(strongReasons)],
      repairReasons: [...new Set(repairReasons)],
      momentum,
    };
  }

  function isAssemblyPhase(poolState, assemblyState, phaseSignals) {
    if (phaseSignals?.repairMode) return true;
    const total = poolState?.style?.total || 0;
    const embeddedRatio = total > 0 ? (assemblyState.embedded / total) : 0;
    return (
      (assemblyState.deficits.embedded > 0 && total >= Math.ceil(TARGET_SET_COUNT * 10 * 0.2)) ||
      (assemblyState.deficits.nonEmbedded > 0 && embeddedRatio >= 0.72 && total >= Math.ceil(TARGET_SET_COUNT * 10 * 0.35)) ||
      (assemblyState.embeddedOverflow > 0 && total >= Math.ceil(TARGET_SET_COUNT * 10 * 0.35)) ||
      (assemblyState.negationOverflow > 0 && total >= Math.ceil(TARGET_SET_COUNT * 10 * 0.35)) ||
      total >= Math.ceil(TARGET_SET_COUNT * 10 * 0.7) ||
      assemblyState.assemblableSets >= Math.max(1, TARGET_SET_COUNT - 3)
    );
  }

  function limiterToFocus(limiterKey) {
    switch (limiterKey) {
      case "embedded_shortage":
        return "embedded";
      case "non_embedded_shortage":
      case "embedded_overflow":
        return "nonEmbedded";
      case "hard_shortage":
        return "hard";
      case "medium_shortage":
        return "medium";
      case "negation_shortage":
      case "negation_overflow":
        return "negation";
      default:
        return "balanced";
    }
  }

  function scoreAssemblyCell(type, diff, workingPoolState, typeReliability, focus, blockedTypes, forcedAvoidTypes, strongTargeting) {
    const currentAssemblyState = computeAssemblyState(workingPoolState);
    const critical = isCircuitBreakerCriticalType(type, currentAssemblyState);
    if ((blockedTypes || new Set()).has(type) && !critical) return -1e6;
    if ((forcedAvoidTypes || new Set()).has(type) && !critical) return -1e5;

    const nextPoolState = incrementPoolStateWithCell(clonePoolState(workingPoolState), type, diff);
    const nextAssemblyState = computeAssemblyState(nextPoolState);
    const totalBefore = Math.max(1, workingPoolState?.style?.total || 0);
    const typeCountBefore = (workingPoolState?.typeTotals || {})[type] || 0;
    const typeShareBefore = typeCountBefore / totalBefore;
    const bootstrapPhase = totalBefore < Math.ceil(TARGET_SET_COUNT * 10 * 0.2);
    const topLimiter = currentAssemblyState.limitingFactors[0]?.key || "";
    const negationCapacity = currentAssemblyState.remainingRecipe?.style?.negationCapacity ?? Infinity;

    let score = 0;
    score += (nextAssemblyState.assemblableSets - currentAssemblyState.assemblableSets) * 240;
    score += (currentAssemblyState.deficits[diff] - nextAssemblyState.deficits[diff]) * (strongTargeting ? 24 : 11);
    score += (currentAssemblyState.deficits.embedded - nextAssemblyState.deficits.embedded) * (EMBEDDED_HEAVY_TYPES.has(type) ? (strongTargeting ? 18 : 9) : 0);
    score += (currentAssemblyState.deficits.nonEmbedded - nextAssemblyState.deficits.nonEmbedded) * (NON_EMBEDDED_TYPES.has(type) ? (strongTargeting ? 18 : 9) : 0);
    score += (currentAssemblyState.deficits.negation - nextAssemblyState.deficits.negation) * (type === "negation" ? 14 : 0);
    score += (currentAssemblyState.deficits.distractor - nextAssemblyState.deficits.distractor) * 3;
    score += (currentAssemblyState.embeddedOverflow - nextAssemblyState.embeddedOverflow) * 18;
    score += (currentAssemblyState.negationOverflow - nextAssemblyState.negationOverflow) * 18;
    score += ((typeReliability?.[type] || 0.8) - 0.75) * 30;
    if (typeCountBefore === 0) score += 3;
    if (typeCountBefore <= 1) score += 2;
    if (typeShareBefore > 0.32) score -= 10;
    if (typeShareBefore > 0.42) score -= 18;

    if (focus === "hard" && diff === "hard") score += 16;
    if (focus === "medium" && diff === "medium") score += 12;
    if (focus === "embedded" && EMBEDDED_HEAVY_TYPES.has(type)) score += 18;
    if (focus === "nonEmbedded" && NON_EMBEDDED_TYPES.has(type)) score += 18;
    if (focus === "negation" && type === "negation") score += 14;
    if (focus === "balanced") score += 4;

    if (topLimiter === "embedded_shortage") {
      if (EMBEDDED_HEAVY_TYPES.has(type) && diff === "medium") score += 28;
      else if (EMBEDDED_HEAVY_TYPES.has(type)) score += 10;
      else score -= 24;
      if (type === "negation") score -= 56;
      if (diff === "hard" && type === "negation") score -= 36;
      if (NON_EMBEDDED_TYPES.has(type) && currentAssemblyState.deficits.nonEmbedded <= Math.max(2, Math.ceil(currentAssemblyState.deficits.embedded * 0.4))) {
        score -= 34;
      }
    }
    if (topLimiter === "medium_shortage" && diff === "medium") score += 10;
    if (negationCapacity <= Math.max(1, currentAssemblyState.remainingSets) && type === "negation") score -= 24;

    if (strongTargeting && currentAssemblyState.deficits[diff] === 0) score -= 32;
    if (strongTargeting && diff === "easy" && currentAssemblyState.deficits.easy === 0) score -= 28;
    if (strongTargeting && currentAssemblyState.deficits.embedded > 0 && NON_EMBEDDED_TYPES.has(type) && currentAssemblyState.deficits.nonEmbedded <= 0) score -= 30;
    if (strongTargeting && currentAssemblyState.deficits.nonEmbedded > 0 && EMBEDDED_HEAVY_TYPES.has(type)) score -= 40;
    if (currentAssemblyState.embeddedOverflow > 0 && EMBEDDED_HEAVY_TYPES.has(type)) score -= 36;
    if (currentAssemblyState.negationOverflow > 0 && type === "negation") score -= 40;
    if (type === "interrogative" && currentAssemblyState.qmark >= styleTargets.qmarkMax) score -= 60;
    if (type === "interrogative" && currentAssemblyState.qmark >= Math.max(1, styleTargets.qmarkMax - 1)) score -= 30;
    if (type === "direct" && currentAssemblyState.deficits.nonEmbedded <= 0 && !strongTargeting) score -= 3;
    if (bootstrapPhase && diff === "hard") score -= 35;
    if (bootstrapPhase && type === "negation" && diff !== "medium") score -= 25;
    if (bootstrapPhase && type === "interrogative") score -= 18;
    if (bootstrapPhase && EMBEDDED_HEAVY_TYPES.has(type) && diff === "hard") score -= 28;

    return score;
  }

  function buildAssemblySpecCandidate(poolState, blockedTypes, batchSize, focus, typeReliability, strongTargeting, forcedAvoidTypes = new Set()) {
    const spec = [];
    let workingPoolState = clonePoolState(poolState);
    const diffOptions = strongTargeting ? ["hard", "medium", "easy"] : ["hard", "medium", "easy"];

    for (let i = 0; i < batchSize; i += 1) {
      const rankedCells = [];
      for (const type of TYPE_LIST) {
        for (const diff of diffOptions) {
          rankedCells.push({
            type,
            diff,
            score: scoreAssemblyCell(type, diff, workingPoolState, typeReliability, focus, blockedTypes, forcedAvoidTypes, strongTargeting),
          });
        }
      }
      rankedCells.sort((a, b) => b.score - a.score);
      const chosen = rankedCells[0] || { type: "3rd-reporting", diff: "medium" };
      const existing = spec.find((cell) => cell.type === chosen.type && cell.difficulty === chosen.diff);
      if (existing) existing.count += 1;
      else spec.push({ type: chosen.type, difficulty: chosen.diff, count: 1 });
      workingPoolState = incrementPoolStateWithCell(workingPoolState, chosen.type, chosen.diff);
    }

    spec._focus = focus;
    return spec;
  }

  function evaluateAssemblySpec(spec, poolState, baseAssemblyState, strongTargeting) {
    let workingPoolState = clonePoolState(poolState);
    for (const cell of spec || []) {
      for (let i = 0; i < cell.count; i += 1) {
        workingPoolState = incrementPoolStateWithCell(workingPoolState, cell.type, cell.difficulty);
      }
    }
    const nextAssemblyState = computeAssemblyState(workingPoolState);
    const totalCells = (spec || []).reduce((sum, cell) => sum + (cell.count || 0), 0);
    const negationCells = (spec || []).reduce((sum, cell) => sum + (cell.type === "negation" ? cell.count || 0 : 0), 0);
    const embeddedCells = (spec || []).reduce((sum, cell) => sum + (EMBEDDED_HEAVY_TYPES.has(cell.type) ? cell.count || 0 : 0), 0);
    const mediumCells = (spec || []).reduce((sum, cell) => sum + (cell.difficulty === "medium" ? cell.count || 0 : 0), 0);
    const topLimiter = baseAssemblyState.limitingFactors[0]?.key || "";
    let score = 0;
    score += (nextAssemblyState.assemblableSets - baseAssemblyState.assemblableSets) * 320;
    score += (baseAssemblyState.deficits.hard - nextAssemblyState.deficits.hard) * 20;
    score += (baseAssemblyState.deficits.medium - nextAssemblyState.deficits.medium) * 11;
    score += (baseAssemblyState.deficits.embedded - nextAssemblyState.deficits.embedded) * 18;
    score += (baseAssemblyState.deficits.nonEmbedded - nextAssemblyState.deficits.nonEmbedded) * 18;
    score += (baseAssemblyState.deficits.negation - nextAssemblyState.deficits.negation) * 8;
    score += (baseAssemblyState.embeddedOverflow - nextAssemblyState.embeddedOverflow) * 22;
    score += (baseAssemblyState.negationOverflow - nextAssemblyState.negationOverflow) * 18;
    if (topLimiter === "embedded_shortage") {
      score += embeddedCells * 18;
      score += mediumCells * 6;
      if (embeddedCells < Math.ceil(Math.max(1, totalCells) * 0.5)) score -= 140;
      if (negationCells >= Math.ceil(Math.max(1, totalCells) * 0.35)) score -= 130;
    }
    if (topLimiter === "medium_shortage" && mediumCells < Math.ceil(Math.max(1, totalCells) * 0.5)) score -= 80;
    if ((baseAssemblyState.remainingRecipe?.style?.negationCapacity ?? Infinity) <= Math.max(1, baseAssemblyState.remainingSets) && negationCells > 0) {
      score -= negationCells * 18;
    }
    if (strongTargeting) {
      score += (baseAssemblyState.remainingRecipe.diff.hard - nextAssemblyState.remainingRecipe.diff.hard) * 16;
      score += (baseAssemblyState.remainingRecipe.diff.medium - nextAssemblyState.remainingRecipe.diff.medium) * 10;
      score += (baseAssemblyState.remainingRecipe.style.embeddedMin - nextAssemblyState.remainingRecipe.style.embeddedMin) * 16;
      score += (baseAssemblyState.remainingRecipe.style.nonEmbeddedMin - nextAssemblyState.remainingRecipe.style.nonEmbeddedMin) * 14;
      score -= Math.max(0, nextAssemblyState.embeddedOverflow) * 12;
      score -= Math.max(0, nextAssemblyState.negationOverflow) * 12;
    }
    return { score, nextAssemblyState };
  }

  function chooseAssemblyDrivenSpec(poolState, assemblyState, blockedTypes, batchSize, typeReliability, strongTargeting = false, forcedAvoidTypes = new Set()) {
    const blocked = blockedTypes || new Set();
    const topLimiter = assemblyState.limitingFactors[0]?.key || "";
    const secondLimiter = assemblyState.limitingFactors[1]?.key || "";
    const primaryFocus = limiterToFocus(topLimiter);
    const secondaryFocus = limiterToFocus(secondLimiter);
    const focuses = [primaryFocus];
    if (primaryFocus === "embedded" && assemblyState.deficits.medium > 0) focuses.push("medium");
    if (primaryFocus === "medium" && assemblyState.deficits.embedded > 0) focuses.push("embedded");
    if (secondaryFocus !== primaryFocus && secondaryFocus !== "balanced") focuses.push(secondaryFocus);
    focuses.push("balanced");

    const candidates = [...new Set(focuses)].map((focus) =>
      buildAssemblySpecCandidate(poolState, blocked, batchSize, focus, typeReliability, strongTargeting, forcedAvoidTypes),
    );
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        focus: candidate._focus || "balanced",
        ...evaluateAssemblySpec(candidate, poolState, assemblyState, strongTargeting),
      }))
      .map((entry) => ({
        ...entry,
        score: entry.score + (entry.focus === primaryFocus ? 35 : 0) + (entry.focus === secondaryFocus ? 10 : 0),
      }))
      .sort((a, b) => b.score - a.score);
    const selected = ranked[0]?.candidate || [{ type: "3rd-reporting", difficulty: "medium", count: batchSize }];
    selected._selection = ranked[0]
      ? {
          focus: ranked[0].focus,
          score: Math.round(ranked[0].score * 100) / 100,
          projectedAssemblableSets: ranked[0].nextAssemblyState?.assemblableSets || assemblyState.assemblableSets,
        }
      : null;
    return selected;
  }

  function specFamilyKey(spec) {
    const cells = Array.isArray(spec) ? spec : [];
    const total = cells.reduce((sum, cell) => sum + (cell.count || 0), 0);
    if (total <= 0) return "empty";
    const negation = cells.reduce((sum, cell) => sum + (cell.type === "negation" ? cell.count || 0 : 0), 0);
    const embedded = cells.reduce((sum, cell) => sum + (EMBEDDED_HEAVY_TYPES.has(cell.type) ? cell.count || 0 : 0), 0);
    const nonEmbedded = cells.reduce((sum, cell) => sum + (NON_EMBEDDED_TYPES.has(cell.type) ? cell.count || 0 : 0), 0);
    const hard = cells.reduce((sum, cell) => sum + (cell.difficulty === "hard" ? cell.count || 0 : 0), 0);
    const medium = cells.reduce((sum, cell) => sum + (cell.difficulty === "medium" ? cell.count || 0 : 0), 0);
    const typeMode = negation / total >= 0.5
      ? "negation-heavy"
      : embedded / total >= 0.5
        ? "embedded-heavy"
        : nonEmbedded / total >= 0.5
          ? "nonembedded-heavy"
          : "mixed";
    const diffMode = hard / total >= 0.5
      ? "hard-heavy"
      : medium / total >= 0.5
        ? "medium-heavy"
        : "mixed-diff";
    return `${typeMode}|${diffMode}`;
  }

  function isSpecFamilyCoolingDown(familyKey, roundNum) {
    return familyKey && specFamilyCooldowns[familyKey] && specFamilyCooldowns[familyKey] >= roundNum;
  }

  function dominantSpecTypes(spec) {
    const cells = Array.isArray(spec) ? spec : [];
    const maxCount = Math.max(0, ...cells.map((cell) => cell.count || 0));
    return new Set(cells.filter((cell) => (cell.count || 0) >= Math.max(1, maxCount)).map((cell) => cell.type));
  }

  function specSignature(spec) {
    return (Array.isArray(spec) ? spec : [])
      .map((cell) => `${cell.type}:${cell.difficulty}:${cell.count}`)
      .sort()
      .join("|");
  }

  function isSpecCoolingDown(signature, roundNum) {
    return signature && specCooldowns[signature] && specCooldowns[signature] >= roundNum;
  }

  function buildAssemblyGenerationHints(assemblyState, spec, primaryRepairTarget = null) {
    if (!assemblyState) return "";
    const hints = [];
    if (primaryRepairTarget === "embedded" || (!primaryRepairTarget && assemblyState.deficits.embedded > 0)) {
      hints.push("ASSEMBLY REPAIR MODE: This batch MUST replenish embedded-question inventory.");
      hints.push("Prioritize 3rd-reporting, 1st-embedded, or interrogative items with clean reported-speech structure.");
      hints.push("Avoid overproducing direct/relative-only batches unless non-embedded shortage is the explicit repair target.");
    }
    if (primaryRepairTarget === "nonEmbedded" || (!primaryRepairTarget && assemblyState.deficits.nonEmbedded > 0)) {
      hints.push("ASSEMBLY REPAIR MODE: This batch MUST prioritize non-embedded items.");
      hints.push("Generate DIRECT statements or RELATIVE / contact-clause items only.");
      hints.push("Do NOT use embedded-question / reporting-verb frames such as asked, wondered, wanted to know, needed to know, was curious.");
      hints.push("Target zero embedded-question items in this batch.");
    }
    if (assemblyState.remainingSets <= Math.max(2, Math.ceil(TARGET_SET_COUNT * 0.1))) {
      const recipe = assemblyState.remainingRecipe;
      hints.push(`LAST-MILE MODE: prioritize the remaining recipe only (medium=${recipe.diff.medium}, hard=${recipe.diff.hard}, easy=${recipe.diff.easy}, nonEmbedded=${recipe.style.nonEmbeddedMin}, negation=${recipe.style.negationMin}).`);
      hints.push("Do NOT optimize for broad global coverage in this batch.");
    }
    if (Array.isArray(spec) && spec.every((cell) => RELIABLE_NON_EMBEDDED_TYPES.has(cell.type))) {
      hints.push("For this batch, every item must be structurally non-embedded.");
    }
    return hints.length > 0 ? `\n## ASSEMBLY REPAIR PRIORITY:\n- ${hints.join("\n- ")}` : "";
  }

  // Decide batch size and targeting based on current gap.
  // Large gap → broad AI-planned batch. Small gap → micro targeted batch (no AI planner needed).
  function scheduleNextBatch(gap, poolState, pool, assemblyState, cbState, roundNum, phaseSignals, typeReliability) {
    const blockedTypes = getActiveCircuitBreakerTypes(cbState, roundNum);
    const total = poolState?.style?.total || 0;
    const plannerAllowed = total < Math.ceil(TARGET_SET_COUNT * 10 * 0.2) && assemblyState.assemblableSets === 0;
    if (isAssemblyPhase(poolState, assemblyState, phaseSignals)) {
      const strongTargeting = phaseSignals?.strongTargeting === true;
      const batchSize = strongTargeting ? Math.max(3, Math.min(5, assemblyState.remainingSets <= 1 ? 4 : 5)) : (gap.total > 12 ? 5 : 4);
      const primaryRepairTarget = limiterToFocus(assemblyState.limitingFactors[0]?.key || "");
      return {
        phase: "assembly",
        mode: strongTargeting ? "last-mile" : (gap.total > 12 ? "assembly-medium" : "assembly-precision"),
        batchSize,
        useAIPlanner: false,
        strongTargeting,
        primaryRepairTarget,
        spec: chooseAssemblyDrivenSpec(poolState, assemblyState, blockedTypes, batchSize, typeReliability, strongTargeting),
      };
    }
    if (gap.total > 20) {
      if (plannerAllowed) {
        return { phase: "broad", mode: "broad", batchSize: 10, useAIPlanner: true, strongTargeting: false, primaryRepairTarget: null };
      }
      return {
        phase: "broad",
        mode: "guided-broad",
        batchSize: 8,
        useAIPlanner: false,
        strongTargeting: false,
        primaryRepairTarget: null,
        spec: chooseAssemblyDrivenSpec(poolState, assemblyState, blockedTypes, 8, typeReliability, false),
      };
    }
    if (gap.total > 4) {
      if (plannerAllowed) {
        return { phase: "broad", mode: "medium", batchSize: 5, useAIPlanner: true, strongTargeting: false, primaryRepairTarget: null };
      }
      return {
        phase: "broad",
        mode: "guided-medium",
        batchSize: 5,
        useAIPlanner: false,
        strongTargeting: false,
        primaryRepairTarget: null,
        spec: chooseAssemblyDrivenSpec(poolState, assemblyState, blockedTypes, 5, typeReliability, false),
      };
    }
    // Micro mode: directly target the most needed non-blocked type/difficulty
    const bestType = TYPE_LIST
      .filter((t) => !blockedTypes.has(t))
      .map((t) => ({ type: t, gap: Math.max(0, (globalTypeTargets[t] || 0) - (poolState.typeTotals[t] || 0)) }))
      .sort((a, b) => b.gap - a.gap)[0];
    const bestDiff = ["hard", "medium", "easy"]
      .find((d) => pool[d].length < difficultyTargets[d]) || "medium";
    return {
      phase: "broad",
      mode: "micro",
      batchSize: 2,
      useAIPlanner: false,
      strongTargeting: false,
      primaryRepairTarget: null,
      spec: [{ type: bestType?.type || "3rd-reporting", difficulty: bestDiff, count: 2 }],
    };
  }

  let totalRound = checkpoint?.totalRound || 0;
  let minGapSeen = checkpoint?.minGapSeen ?? Infinity;
  let roundsSinceNewMin = checkpoint?.roundsSinceNewMin || 0;

  while (true) {
    const pool = splitPoolByDifficulty(acceptedPool);
    const poolState = computePoolState(acceptedPool);
    const gap = computeTotalGap(poolState, pool);
    const assemblyState = computeAssemblyState(poolState);
    const typeReliability = computeTypeReliability(diagnosticsState.rounds);
    const phaseSignals = computePhaseSignals(poolState, assemblyState, diagnosticsState.rounds);

    if (gap.total <= GAP_TOLERANCE) {
      console.log(`✓ gap satisfied (${formatGap(gap)} ≤ tolerance ${GAP_TOLERANCE}), assembly=${formatAssemblyState(assemblyState)}, stopping`);
      break;
    }
    if (totalRound >= MAX_ROUNDS) {
      console.log(`⚠ max rounds (${MAX_ROUNDS}) reached, gap remaining=${formatGap(gap)}, assembly=${formatAssemblyState(assemblyState)}`);
      break;
    }

    // Stuck detector: abort if gap hasn't reached a new minimum in STUCK_ROUNDS consecutive rounds
    if (gap.total < minGapSeen) {
      minGapSeen = gap.total;
      roundsSinceNewMin = 0;
    } else {
      roundsSinceNewMin++;
      if (roundsSinceNewMin >= STUCK_ROUNDS) {
        console.log(`⚠ stuck for ${STUCK_ROUNDS} rounds without progress (gap=${gap.total}), aborting`);
        break;
      }
    }

    const roundNum = totalRound + 1;
    const schedule = scheduleNextBatch(gap, poolState, pool, assemblyState, circuitBreakerState, roundNum, phaseSignals, typeReliability);

    let spec;
    if (schedule.useAIPlanner) {
      try {
        const plannerRaw = await callModelDeterministic(
          buildPlannerPrompt(poolState, difficultyTargets, globalTypeTargets, styleTargets, schedule.batchSize, "normal"),
        );
        const plannedSpec = enforcePlannerStyleGaps(
          parsePlannerSpec(plannerRaw, schedule.batchSize),
          poolState, styleTargets, globalTypeTargets, difficultyTargets, schedule.batchSize,
        );
        const blockedTypes = getActiveCircuitBreakerTypes(circuitBreakerState, roundNum);
        spec = applyCircuitBreakersToSpec(plannedSpec, blockedTypes, poolState, globalTypeTargets);
      } catch (e) {
        console.log(`round ${roundNum}: planner failed (${errMsg(e)}), using fallback`);
        spec = [{ type: "3rd-reporting", difficulty: "medium", count: schedule.batchSize }];
      }
    } else {
      spec = schedule.spec;
    }

    let signature = specSignature(spec);
    let familyKey = specFamilyKey(spec);
    if (isSpecCoolingDown(signature, roundNum)) {
      const totalPool = poolState?.style?.total || 0;
      if (totalPool < Math.ceil(TARGET_SET_COUNT * 10 * 0.2)) {
        const fallbackDifficulty = pool.medium.length < difficultyTargets.medium ? "medium" : "easy";
        spec = [
          { type: "3rd-reporting", difficulty: fallbackDifficulty, count: Math.max(2, Math.ceil(schedule.batchSize / 2)) },
          { type: "1st-embedded", difficulty: "medium", count: Math.max(1, Math.floor(schedule.batchSize / 4)) },
          { type: "relative", difficulty: "medium", count: Math.max(1, schedule.batchSize - Math.max(2, Math.ceil(schedule.batchSize / 2)) - Math.max(1, Math.floor(schedule.batchSize / 4))) },
        ].filter((cell) => cell.count > 0);
      } else {
        const dominantType = [...(spec || [])].sort((a, b) => b.count - a.count)[0]?.type;
        const forcedAvoid = new Set(dominantType ? [dominantType] : []);
        spec = chooseAssemblyDrivenSpec(
          poolState,
          assemblyState,
          getActiveCircuitBreakerTypes(circuitBreakerState, roundNum),
          schedule.batchSize,
          typeReliability,
          schedule.strongTargeting,
          forcedAvoid,
        );
      }
      signature = specSignature(spec);
      familyKey = specFamilyKey(spec);
    }

    if (isSpecFamilyCoolingDown(familyKey, roundNum) && !schedule.useAIPlanner) {
      const forcedAvoid = dominantSpecTypes(spec);
      spec = chooseAssemblyDrivenSpec(
        poolState,
        assemblyState,
        getActiveCircuitBreakerTypes(circuitBreakerState, roundNum),
        schedule.batchSize,
        typeReliability,
        schedule.strongTargeting,
        forcedAvoid,
      );
      signature = specSignature(spec);
      familyKey = specFamilyKey(spec);
    }

    const specLabel = spec.map((s) => `${s.count}×${s.type}/${s.difficulty}`).join(", ");
    const momentumLabel = phaseSignals.momentum.windowCount > 0
      ? ` yield=${phaseSignals.momentum.acceptedGainRate.toFixed(2)}`
      : "";
    const selectionLabel = spec?._selection
      ? ` focus=${spec._selection.focus} proj=${spec._selection.projectedAssemblableSets}/${TARGET_SET_COUNT}`
      : "";
    const repairTargetLabel = schedule.primaryRepairTarget ? ` target=${schedule.primaryRepairTarget}` : "";
    console.log(
      `round ${roundNum} [${schedule.mode}] gap=${formatGap(gap)} assembly=${formatAssemblyState(assemblyState)} progress=${formatAssemblyProgress(assemblyState)} limiting=${formatLimitingFactors(assemblyState)}${repairTargetLabel}${momentumLabel}${selectionLabel} → [${specLabel}]`,
    );

    try {
      const res = await generateCandidateRound(roundNum, spec, rollingRejectFeedback, acceptedPool, {
        phase: schedule.phase,
        poolState,
        assemblyState,
        difficultyTargets,
        strongTargeting: schedule.strongTargeting,
        primaryRepairTarget: schedule.primaryRepairTarget,
        typeReliability,
        generationHints: schedule.phase === "assembly" ? buildAssemblyGenerationHints(assemblyState, spec, schedule.primaryRepairTarget) : "",
        globalAnswerHashes,
      });
      acceptedPool.push(...res.questions);
      res.questions.forEach(q => globalAnswerHashes.add(hashAnswer(q)));
      statTotalRounds += 1;
      statTotalGenerated += res.generated;
      statTotalAccepted += res.accepted;
      Object.entries(res.rejectReasons).forEach(([k, v]) => {
        rejectReasons[k] = (rejectReasons[k] || 0) + v;
      });
      rollingRejectFeedback = buildRejectFeedbackHints(rejectReasons);

      const newPool = splitPoolByDifficulty(acceptedPool);
      const newPoolState = computePoolState(acceptedPool);
      const newGap = computeTotalGap(newPoolState, newPool);
      const newAssemblyState = computeAssemblyState(newPoolState);
      const deltaAssemblable = newAssemblyState.assemblableSets - assemblyState.assemblableSets;
      const deltaProgress = newAssemblyState.assemblyProgressScore - assemblyState.assemblyProgressScore;
      const acceptedGainRate = res.accepted > 0 ? (deltaAssemblable + deltaProgress * 2.5) / res.accepted : 0;
      console.log(
        `round ${roundNum}: generated=${res.generated} accepted=${res.accepted} rejected=${res.rejected} gap=${formatGap(gap)} → ${formatGap(newGap)} assembly=${formatAssemblyState(newAssemblyState)} progress=${formatAssemblyProgress(newAssemblyState)} Δasm=${deltaAssemblable >= 0 ? "+" : ""}${deltaAssemblable} Δprog=${deltaProgress >= 0 ? "+" : ""}${deltaProgress.toFixed(3)} yield=${acceptedGainRate.toFixed(2)} | easy=${newPool.easy.length} medium=${newPool.medium.length} hard=${newPool.hard.length}`,
      );
      if (res.accepted > 0 && deltaAssemblable <= 0 && deltaProgress <= 0.005) {
        console.log(`  [assembly] accepted but zero assembly gain; limiting=${formatLimitingFactors(newAssemblyState)}`);
      }
      if (res.rejected > 0) {
        Object.entries(res.rejectReasons).sort((a, b) => b[1] - a[1])
          .forEach(([r, n]) => console.log(`  reject: ${r} (×${n})`));
      }
      if (res.accepted === 0 || newGap.total >= gap.total) {
        specCooldowns[signature] = roundNum + 2;
      }
      if (
        res.accepted === 0 ||
        (res.accepted > 0 && deltaAssemblable <= 0 && deltaProgress <= 0.01)
      ) {
        specFamilyCooldowns[familyKey] = roundNum + 3;
      }
      diagnosticsState.rounds.push({
        round: roundNum,
        phase: schedule.phase,
        mode: schedule.mode,
        gap,
        assemblyState,
        spec,
        specSelection: spec?._selection || null,
        result: {
          generated: res.generated,
          accepted: res.accepted,
          rejected: res.rejected,
          rejectReasons: res.rejectReasons,
          typeStats: res.typeStats,
          deltaAssemblable,
          deltaProgress,
          acceptedGainRate,
        },
        nextGap: newGap,
        nextAssemblyState: newAssemblyState,
        phaseSignals,
        typeReliability,
      });
      updateCircuitBreakers(circuitBreakerState, roundNum, "normal", spec, res);
      flushCircuitBreakerLog(circuitBreakerState);
      flushPoolCheckpoint(acceptedPool);
      flushDiagnostics();
      saveCheckpoint({
        version: 1, targetSetCount: TARGET_SET_COUNT, totalRound, minGapSeen, roundsSinceNewMin,
        acceptedPool: acceptedPool.map(q => { const c = cloneQuestion(q); delete c._meta; return c; }),
        circuitBreakerState, rejectReasons, rollingRejectFeedback,
        statTotalRounds, statTotalGenerated, statTotalAccepted,
        globalAnswerHashes: [...globalAnswerHashes],
      });
    } catch (e) {
      console.log(`round ${roundNum}: failed → ${errMsg(e)}`);
      specCooldowns[signature] = roundNum + 2;
      specFamilyCooldowns[familyKey] = roundNum + 3;
      diagnosticsState.rounds.push({
        round: roundNum,
        phase: schedule.phase,
        mode: schedule.mode,
        gap,
        assemblyState,
        spec,
        specSelection: spec?._selection || null,
        error: errMsg(e),
        phaseSignals,
        typeReliability,
      });
      flushPoolCheckpoint(acceptedPool);
      flushDiagnostics();
    }

    totalRound++;

    // Check for graceful stop signal (admin UI "优雅停止" button)
    if (!_gracefulStopRequested && await checkStopSignal()) {
      _gracefulStopRequested = true;
      console.log(`🛑 graceful stop signal received — will assemble available questions and save`);
      break;
    }

    await new Promise((r) => setTimeout(r, 3000));
  }

  const dedupedPool = uniqBy(acceptedPool, stableAnswerKey);
  const poolByDiff = splitPoolByDifficulty(dedupedPool);
  const finalPoolState = computePoolState(dedupedPool);
  const finalAssemblyState = computeAssemblyState(finalPoolState);
  console.log(`final pool: easy=${poolByDiff.easy.length} medium=${poolByDiff.medium.length} hard=${poolByDiff.hard.length}`);

  const finalAssembly = buildFinalSetsFromPool(poolByDiff, TARGET_SET_COUNT);
  const finalSets = finalAssembly.sets;
  diagnosticsState.final = {
    pool: {
      easy: poolByDiff.easy.length,
      medium: poolByDiff.medium.length,
      hard: poolByDiff.hard.length,
    },
    assemblyState: finalAssemblyState,
    assembledSets: finalSets.length,
    targetSets: TARGET_SET_COUNT,
    assemblyDiagnostics: finalAssembly.diagnostics,
    topRejectReasons: summarizeRejectReasons(rejectReasons),
  };
  flushDiagnostics();
  if (finalSets.length === 0) {
    const topReasons = summarizeRejectReasons(rejectReasons).slice(0, 3).map(([k, v]) => `${k}(×${v})`).join(", ");
    const providerHint = _lastModelFailureReason ? `；最近一次模型错误：${_lastModelFailureReason}` : "";
    _lastFailureReason = `题目池为空，无法组套。主要拒绝原因：${topReasons || "未知"}${providerHint}`;
    console.error("No sets assembled at all — aborting.");
    process.exit(1);
  }
  if (finalSets.length < TARGET_SET_COUNT) {
    console.warn(
      `Warning: only assembled ${finalSets.length}/${TARGET_SET_COUNT} sets. Writing partial output.`,
    );
    console.warn(`Pool snapshot: easy=${poolByDiff.easy.length} medium=${poolByDiff.medium.length} hard=${poolByDiff.hard.length}`);
    if (finalAssembly.diagnostics.length > 0) {
      const firstDiag = finalAssembly.diagnostics[0];
      const blockers = (firstDiag.assemblyState?.limitingFactors || []).slice(0, 3).map((x) => x.key).join(", ");
      console.warn(`Assembly diagnostics: reason=${firstDiag.reason} limiting=${blockers || "none"} remaining=${firstDiag.assemblyState?.remainingSets ?? "?"}`);
    }
    console.warn("Top reject reasons:");
    summarizeRejectReasons(rejectReasons).forEach(([k, v]) => console.warn(`- ${k}: ${v}`));
  }

  // Apply deterministic rule fixes to final sets (contextViolations, prepFragments,
  // answerErrors, standaloneNot) before writing to disk.
  postGenerationRuleCheck(finalSets);

  // D approach: rewrite ~2 prompts per set to yesno and ~2 to statement
  await rewriteSetPrompts(finalSets);

  // Fix 8: detect and rewrite prompts with high content overlap
  await rewriteHighOverlapPrompts(finalSets);

  const output = {
    version: "1.2",
    generated_at: new Date().toISOString(),
    _meta: {
      target_sets: TARGET_SET_COUNT,
      total_rounds: statTotalRounds,
      total_generated: statTotalGenerated,
      total_accepted: statTotalAccepted,
      acceptance_rate: statTotalGenerated > 0 ? Number((statTotalAccepted / statTotalGenerated).toFixed(3)) : 0,
    },
    question_sets: finalSets,
  };

  // global strict validation (last set uses relaxed style targets matching assembly)
  const check = validateAllSets(output, {
    strict: true,
    lastSetStyleOverrides: { distractorMin: 4, embeddedMin: 2, negationMin: 1, negationMax: 4, qmarkMax: 3 },
  });
  if (!check.ok) {
    const allErrors = [
      ...check.failures,
      ...check.strictHardFails.map((x) => `${x.label}: ${x.reasons.join("; ")}`),
    ];
    _lastFailureReason = `最终验证失败：${allErrors.slice(0, 3).join(" | ")}`;
    console.error("Final output failed strict validation.");
    check.failures.forEach((x) => console.error(x));
    check.strictHardFails.forEach((x) => console.error(`${x.label}: ${x.reasons.join("; ")}`));
    check.strictWarnings.forEach((x) => console.error(`${x.label}: ${x.reasons.join("; ")}`));
    process.exit(1);
  }

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Saved ${finalSets.length} set(s) to ${OUTPUT_PATH}`);
  finalSets.forEach((s) => {
    const diff = evaluateSetDifficultyAgainstTarget(s.questions);
    console.log(
      `- set ${s.set_id}: easy=${diff.profile.counts.easy} medium=${diff.profile.counts.medium} hard=${diff.profile.counts.hard}`,
    );
  });

  // Save leftover questions (passed quality gates but not assembled into sets) to reserve pool
  const usedAnswers = new Set(
    finalSets.flatMap((s) => s.questions.map((q) => stableAnswerKey(q)))
  );
  const reserve = uniqBy(
    [...poolByDiff.easy, ...poolByDiff.medium, ...poolByDiff.hard]
      .filter((q) => !usedAnswers.has(stableAnswerKey(q)))
      .map((q) => { const c = cloneQuestion(q); delete c._meta; return c; }),
    stableAnswerKey
  );

  // P1.2: Reserve pool cap — archive excess beyond RESERVE_POOL_CAP
  if (reserve.length > RESERVE_POOL_CAP) {
    const kept = reserve.slice(0, RESERVE_POOL_CAP);
    const archived = reserve.slice(RESERVE_POOL_CAP);
    try { mkdirSync(RESERVE_ARCHIVE_DIR, { recursive: true }); } catch (_) {}
    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
    const archivePath = resolve(RESERVE_ARCHIVE_DIR, `reserve_${ts}.json`);
    writeFileSync(archivePath, `${JSON.stringify(archived, null, 2)}\n`, "utf8");
    console.log(`Reserve pool overflow: archived ${archived.length} questions to ${basename(archivePath)}`);
    writeFileSync(RESERVE_PATH, `${JSON.stringify(kept, null, 2)}\n`, "utf8");
    console.log(`Reserve pool: ${kept.length} questions saved (capped at ${RESERVE_POOL_CAP})`);
  } else {
    writeFileSync(RESERVE_PATH, `${JSON.stringify(reserve, null, 2)}\n`, "utf8");
    console.log(`Reserve pool: ${reserve.length} questions saved to reserve_pool.json`);
  }

  // Persist global answer hashes and clean up checkpoint
  saveAnswerHashes(globalAnswerHashes);
  console.log(`Global answer hashes: ${globalAnswerHashes.size} saved`);
  deleteCheckpoint();

  console.log("Top reject reasons:");
  const topRejects = summarizeRejectReasons(rejectReasons);
  topRejects.forEach(([k, v]) => console.log(`- ${k}: ${v}`));
  flushCircuitBreakerLog(circuitBreakerState);

  // P1.3: Append run metrics to persistent history
  const runDuration = Math.round((Date.now() - runStartTime) / 1000);
  appendRunHistory({
    timestamp: new Date().toISOString(),
    target_sets: TARGET_SET_COUNT,
    assembled_sets: finalSets.length,
    total_rounds: statTotalRounds,
    total_generated: statTotalGenerated,
    total_accepted: statTotalAccepted,
    acceptance_rate: statTotalGenerated > 0 ? Number((statTotalAccepted / statTotalGenerated).toFixed(3)) : 0,
    reserve_pool_size: reserve.length,
    global_hashes: globalAnswerHashes.size,
    duration_seconds: runDuration,
    top_reject_reasons: Object.fromEntries(topRejects.slice(0, 5)),
    circuit_breaker_events: (circuitBreakerState?.events || []).length,
  });
  console.log(`Run history: appended to run_history.json (${runDuration}s)`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

export {
  autoRepairWordBag,
  normalizeQuestion,
  resolvedAnswerType,
  createCircuitBreakerState,
  getActiveCircuitBreakerTypes,
  applyCircuitBreakersToSpec,
  updateCircuitBreakers,
};

function writeJobState(updates) {
  const statePath = process.env.BS_JOB_STATE_PATH;
  if (!statePath) return;
  try {
    let state = {};
    try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch (_) {}
    writeFileSync(statePath, JSON.stringify({ ...state, ...updates }, null, 2), "utf8");
  } catch (_) {}
}

let _lastFailureReason = null;
let _lastModelFailureReason = null;

if (isDirectRun) {
  // Intercept process.exit to capture failure state when BS_JOB_STATE_PATH is set
  const _origExit = process.exit.bind(process);
  process.exit = (code) => {
    if (code && code !== 0) {
      writeJobState({ status: "failed", finishedAt: new Date().toISOString(), error: _lastFailureReason || `process exited with code ${code}` });
    }
    _origExit(code);
  };

  main()
    .then(() => {
      writeJobState({ status: "done", finishedAt: new Date().toISOString() });
    })
    .catch((e) => {
      const msg = errMsg(e);
      console.error(`Fatal: ${msg}`);
      writeJobState({ status: "failed", finishedAt: new Date().toISOString(), error: msg });
      _origExit(1);
    });
}











