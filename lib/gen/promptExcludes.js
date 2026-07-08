"use strict";
/**
 * promptExcludes.js — shared anti-duplication helpers for the generation pipeline.
 *
 * The nightly Claude routine reads each type's generation prompt via
 * scripts/print-bank-prompt.mjs, and scripts/generate-rdl.mjs builds the RDL
 * prompt directly. Both must exclude content that was ALREADY generated — not
 * only what is live in data/**\/bank, but also what is sitting un-merged in
 * data/**\/staging. Hundreds of items backlog there and are invisible to a
 * bank-only exclusion, which makes the model regenerate them.
 *
 * These helpers are pure/synchronous and framework-free so they can be unit
 * tested against a temp directory (no real data/ access required).
 *
 * NOTE: intentionally separate from the sibling lib/gen/contentDedup.js module.
 */

const { readdirSync, readFileSync } = require("fs");
const { join } = require("path");

/**
 * List `<filePrefix>*.json` basenames in a directory, newest first.
 * readdirSync order is unspecified, so we sort explicitly. Filenames encode
 * timestamps/dates (…-20260705-…, WAVE7, 1780213…), so a descending sort is a
 * good "freshest routine files first" heuristic. Missing dir → [].
 */
function listStagingFiles(dir, filePrefix = "") {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((f) => f.endsWith(".json") && (!filePrefix || f.startsWith(filePrefix)))
    .sort()
    .reverse();
}

/**
 * Scan a staging directory for `<filePrefix>*.json` files and return a flat
 * array of their `items[]`, newest file first. Parse failures, directories,
 * and files without an `items` array are silently skipped.
 *
 * @param {string} dir — absolute path to a staging directory
 * @param {string} [filePrefix] — only basenames starting with this are read ("" = every .json)
 * @returns {object[]} concatenated items, newest staging file first
 */
function loadStagingItems(dir, filePrefix = "") {
  const out = [];
  for (const f of listStagingFiles(dir, filePrefix)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {
      continue; // unreadable / not JSON / is a directory
    }
    if (parsed && Array.isArray(parsed.items)) out.push(...parsed.items);
  }
  return out;
}

/**
 * Collect Build-a-Sentence answer strings from a staging directory.
 * BS staging files come in two content shapes —
 *   { question_sets: [ { questions: [ { answer } ] } ] }  and
 *   { items: [ { answer } ] }
 * — while non-content files (state / diagnostics / reserve / circuit-breaker-log,
 * which are bare arrays or objects lacking those keys) are naturally skipped.
 * Newest file first.
 *
 * @param {string} dir — absolute path to data/buildSentence/staging
 * @param {string} [filePrefix]
 * @returns {string[]} answer sentences, newest staging file first
 */
function loadBSStagingAnswers(dir, filePrefix = "") {
  const out = [];
  for (const f of listStagingFiles(dir, filePrefix)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    if (Array.isArray(parsed.question_sets)) {
      for (const set of parsed.question_sets) {
        for (const q of (set && set.questions) || []) {
          if (q && q.answer) out.push(String(q.answer));
        }
      }
    } else if (Array.isArray(parsed.items)) {
      for (const it of parsed.items) {
        if (it && it.answer) out.push(String(it.answer));
      }
    }
  }
  return out;
}

// Function words dropped when summarizing a passage down to its "content words"
// (实词). Deliberately small — the goal is a STABLE topic fingerprint for dedup,
// applied identically to bank and staging so identical content collapses to an
// identical summary.
const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "in", "on", "at", "for", "and", "or", "but", "nor",
  "so", "yet", "with", "by", "from", "as", "into", "about", "over", "under", "after",
  "before", "during", "up", "is", "are", "was", "were", "be", "been", "being", "am",
  "will", "would", "can", "could", "should", "shall", "may", "might", "must", "do",
  "does", "did", "has", "have", "had", "this", "that", "these", "those", "it", "its",
  "he", "she", "they", "we", "you", "i", "his", "her", "their", "our", "your", "my",
  "what", "which", "who", "whom", "whose", "please", "now", "today", "then", "there", "here",
]);

/**
 * Reduce a text to its first `n` content words (lowercased, punctuation stripped,
 * stopwords removed) joined by spaces — a compact, stable topic fingerprint.
 *
 * @param {string} text
 * @param {number} [n=8]
 * @returns {string}
 */
function firstContentWords(text, n = 8) {
  const words = String(text == null ? "" : text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
  return words.slice(0, n).join(" ");
}

/**
 * Build a capped, de-duplicated exclusion list that PRIORITIZES `fresh` values
 * (typically staging — the freshest, highest-duplication-risk content) ahead of
 * `older` ones (typically the live bank tail). Case-insensitive dedup; empties
 * dropped; first occurrence wins.
 *
 * @param {string[]} fresh — highest-priority values, kept at the FRONT
 * @param {string[]} older — lower-priority values, appended after
 * @param {number} cap — maximum length of the returned list
 * @returns {string[]}
 */
function orderedExcludes(fresh, older, cap) {
  const seen = new Set();
  const out = [];
  for (const v of [...(fresh || []), ...(older || [])]) {
    const s = String(v == null ? "" : v).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * RDL exclusion subjects = live bank (rdl-short/rdl-long per variant, tail) ∪
 * staging rdl-* items of the same variant, each summarized to the first 8
 * content words of its text. Staging is taken in full and prioritized; bank
 * contributes its tail; the union is de-duplicated and capped.
 *
 * Shared by scripts/generate-rdl.mjs and scripts/print-bank-prompt.mjs so both
 * paths exclude the same corpus. Reads the live bank directly (NEWBANK_ROOT
 * mirroring is not applied here — RDL had no exclusion before, so there is no
 * regression, and the staging coverage is the main win).
 *
 * @param {string} rootDir — repo root (contains data/)
 * @param {"short"|"long"} variant
 * @param {number} [cap=25]
 * @returns {string[]}
 */
function computeRdlExcludes(rootDir, variant, cap = 25) {
  const bankRel = variant === "short" ? "rdl-short.json" : "rdl-long.json";
  let bankItems = [];
  try {
    const bank = JSON.parse(readFileSync(join(rootDir, "data", "reading", "bank", bankRel), "utf8"));
    bankItems = Array.isArray(bank && bank.items) ? bank.items : [];
  } catch {
    bankItems = [];
  }
  const stagingItems = loadStagingItems(join(rootDir, "data", "reading", "staging"), "rdl-")
    .filter((it) => it && it.variant === variant);
  const toSubject = (it) => firstContentWords(it && it.text, 8);
  const stagingSubjects = stagingItems.map(toSubject).filter(Boolean);
  const bankSubjects = bankItems.slice(-cap).map(toSubject).filter(Boolean);
  return orderedExcludes(stagingSubjects, bankSubjects, cap);
}

module.exports = {
  listStagingFiles,
  loadStagingItems,
  loadBSStagingAnswers,
  firstContentWords,
  orderedExcludes,
  computeRdlExcludes,
};
