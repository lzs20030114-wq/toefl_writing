#!/usr/bin/env node
/**
 * Apply per-set contraction conversion to the question bank.
 * First expands any existing contractions, then re-applies with per-set selection.
 */
import { readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { normalizeRuntimeQuestion, validateRuntimeQuestion } = require("../lib/questionBank/runtimeModel");

const BANK = "data/buildSentence/questions.json";
const d = JSON.parse(readFileSync(BANK, "utf8"));

const CONTRACTION_MAP = new Map([
  ["did not", "didn't"], ["do not", "don't"], ["does not", "doesn't"],
  ["have not", "haven't"], ["has not", "hasn't"], ["had not", "hadn't"],
  ["is not", "isn't"], ["are not", "aren't"],
  ["was not", "wasn't"], ["were not", "weren't"],
  ["will not", "won't"], ["would not", "wouldn't"],
  ["could not", "couldn't"], ["should not", "shouldn't"],
]);
const EXPAND_MAP = new Map([...CONTRACTION_MAP].map(([f, c]) => [c, f]));

function escapeRe(s) {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

// ── Step 1: Expand existing contractions back to full form ──
let expanded = 0;
for (const set of d.question_sets) {
  for (const q of set.questions) {
    for (const [contr, full] of EXPAND_MAP) {
      const re = new RegExp(escapeRe(contr), "i");
      if (!re.test(q.answer)) continue;

      // Find contraction position in answer
      const words = q.answer.split(/\s+/);
      const [aux] = full.split(" ");
      let expandIdx = -1;
      for (let i = 0; i < words.length; i++) {
        const wClean = words[i].replace(/[.,!?;:]$/, "");
        if (wClean.toLowerCase() === contr) {
          expandIdx = i;
          const trail = words[i].slice(wClean.length);
          const isUp = words[i][0] === words[i][0].toUpperCase();
          words.splice(i, 1, isUp ? aux[0].toUpperCase() + aux.slice(1) : aux, "not" + trail);
          break;
        }
      }
      q.answer = words.join(" ");

      // Expand in chunks
      for (let ci = 0; ci < (q.chunks || []).length; ci++) {
        const c = q.chunks[ci].trim().toLowerCase();
        if (c === contr) q.chunks[ci] = full;
        else if (c.startsWith(contr + " ")) q.chunks[ci] = full + q.chunks[ci].trim().slice(contr.length);
      }

      // Shift ALL prefilled_positions after the expansion point (+1 since we added a word)
      const pp = q.prefilled_positions || {};
      const pk = Object.keys(pp).find((k) => k.toLowerCase() === contr);
      if (pk) {
        // Contraction was in prefilled — update key and shift others
        const pos = pp[pk];
        delete pp[pk];
        pp[full] = pos;
        const pi = (q.prefilled || []).indexOf(pk);
        if (pi >= 0) q.prefilled[pi] = full;
        for (const [w2] of Object.entries(pp)) {
          if (w2 !== full && pp[w2] > pos) pp[w2] = pp[w2] + 1;
        }
      } else if (expandIdx >= 0) {
        // Contraction was in chunks — shift all prefilled positions after expandIdx
        for (const [w2] of Object.entries(pp)) {
          if (pp[w2] > expandIdx) pp[w2] = pp[w2] + 1;
        }
      }
      expanded++;
      break;
    }
  }
}
console.log(`Expanded ${expanded} contractions back to full form`);

// ── Step 2: Per-set contraction selection (try-until-target) ──
let total = 0;
const selected = []; // {q, full, contr, target} — target = how many this set wants
for (const set of d.question_sets) {
  const sc = [];
  for (const q of set.questions) {
    const a = q.answer.toLowerCase();
    for (const [full, contr] of CONTRACTION_MAP) {
      if (a.includes(full)) { sc.push({ q, full, contr }); break; }
    }
  }
  total += sc.length;
  if (sc.length === 0) continue;
  // Shuffle
  for (let i = sc.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sc[i], sc[j]] = [sc[j], sc[i]];
  }
  const target = Math.max(1, Math.round(sc.length * 0.35));
  // Push ALL candidates but mark with the target — apply loop will stop after enough succeed
  sc.forEach((c, i) => selected.push({ ...c, setId: set.set_id, target, rank: i }));
}

let applied = 0;
let failed = 0;
const setSuccesses = {}; // setId → count of successful contractions
for (const { q, full, contr, setId, target } of selected) {
  // Skip if this set already reached its target
  if ((setSuccesses[setId] || 0) >= target) continue;
  const auxWord = full.split(" ")[0];
  const answerWords = q.answer.split(/\s+/);

  let auxIdx = -1;
  for (let i = 0; i < answerWords.length - 1; i++) {
    if (
      answerWords[i].toLowerCase() === auxWord &&
      answerWords[i + 1].toLowerCase().replace(/[.,!?;:]$/, "") === "not"
    ) { auxIdx = i; break; }
  }
  if (auxIdx < 0) continue;

  const isUpper = answerWords[auxIdx][0] === answerWords[auxIdx][0].toUpperCase();
  let contracted = contr;
  if (isUpper) contracted = contr[0].toUpperCase() + contr.slice(1);
  const trailing = answerWords[auxIdx + 1].replace(/^not/i, "");

  const chunks = q.chunks || [];
  const prefilledPos = q.prefilled_positions || {};
  const prefilledKey = Object.keys(prefilledPos).find((k) => k.toLowerCase() === full);
  const singleChunkIdx = chunks.findIndex(
    (c) => c !== q.distractor && (c.trim().toLowerCase() === full || c.trim().toLowerCase().startsWith(full + " "))
  );
  const auxCI = chunks.findIndex((c) => c !== q.distractor && c.trim().toLowerCase() === auxWord);
  const notCI = chunks.findIndex((c) => c !== q.distractor && c.trim().toLowerCase() === "not");
  const areSeparate = auxCI >= 0 && notCI >= 0;

  if (!prefilledKey && singleChunkIdx < 0 && !areSeparate) continue;
  if (areSeparate && !prefilledKey && singleChunkIdx < 0) {
    if (chunks.filter((c) => c !== q.distractor).length - 1 < 4) continue;
  }

  // Save for rollback
  const origA = q.answer;
  const origC = [...chunks];
  const origPP = { ...prefilledPos };
  const origPr = [...(q.prefilled || [])];

  // Apply answer
  answerWords.splice(auxIdx, 2, contracted + trailing);
  q.answer = answerWords.join(" ");

  // Shift prefilled_positions
  const newPos = {};
  for (const [w, p] of Object.entries(prefilledPos)) {
    if (w === prefilledKey) newPos[contracted] = p;
    else newPos[w] = p > auxIdx + 1 ? p - 1 : p;
  }
  q.prefilled_positions = newPos;
  if (prefilledKey) {
    const pi = (q.prefilled || []).indexOf(prefilledKey);
    if (pi >= 0) q.prefilled[pi] = contracted;
  }

  // Update chunks
  if (singleChunkIdx >= 0) {
    const orig = chunks[singleChunkIdx].trim();
    if (orig.toLowerCase() === full) chunks[singleChunkIdx] = contracted;
    else chunks[singleChunkIdx] = contracted + orig.slice(full.length);
  } else if (areSeparate && !prefilledKey) {
    q.chunks = chunks.filter((_, i) => i !== auxCI && i !== notCI);
    q.chunks.push(contracted);
  }

  // Validate — rollback on failure
  try {
    const rq = normalizeRuntimeQuestion(q);
    validateRuntimeQuestion(rq);
    applied++;
    setSuccesses[setId] = (setSuccesses[setId] || 0) + 1;
  } catch (e) {
    q.answer = origA;
    q.chunks.splice(0, q.chunks.length, ...origC);
    q.prefilled_positions = origPP;
    q.prefilled = origPr;
    failed++;
    console.log("FAIL:", q.id, e.message);
  }
}

writeFileSync(BANK, JSON.stringify(d, null, 2) + "\n");
console.log(`\nPer-set result: ${applied}/${total} (${(applied / total * 100).toFixed(1)}%) | failed: ${failed}`);

// Stats
const setStats = d.question_sets.map((s) => ({
  id: s.set_id,
  neg: s.questions.filter((q) => /\b(not|n't)\b/i.test(q.answer)).length,
  con: s.questions.filter((q) => /\b\w+n't\b/i.test(q.answer)).length,
}));
const zero = setStats.filter((s) => s.neg > 0 && s.con === 0);
console.log("Sets with negation but 0 contractions:", zero.length);
const buckets = {};
setStats.forEach((s) => { buckets[s.con] = (buckets[s.con] || 0) + 1; });
console.log("Distribution:", Object.entries(buckets).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}contr:${v}sets`).join(" | "));
