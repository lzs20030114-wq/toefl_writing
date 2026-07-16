#!/usr/bin/env node
/**
 * BS assembler: turn authored {prompt, kind, answer, grammar, diff, distractor?} into
 * schema-valid app questions (chunks/prefilled/prefilled_positions/distractor/has_question_mark),
 * then run the LIVE validator (lib/questionBank/buildSentenceSchema.js) as the schema gate.
 *
 *   node scripts/bs-assemble.mjs <content.json> <out.json>
 *
 * content.json = { "sets":[ { "set_id":1, "items":[
 *   { "prompt":"...", "kind":"statement|ask|report|respond|yesno",
 *     "answer":"They asked whether I had any rope experience.",
 *     "grammar":["indirect question","declarative word order"],
 *     "diff":"easy|medium|hard", "distractor":"did" (optional), "prefilled":"They" (optional) } ] } ] }
 *
 * Guarantees the multiset fatal by PARTITIONING (answer minus prefilled) in order into 4-8 tiles.
 */
const { readFileSync, writeFileSync } = require("fs");
const { validateQuestionSet } = require("../lib/questionBank/buildSentenceSchema.js");
const { shuffleSetQuestions } = require("../lib/gen/setOrder.js");

const FLOATING_ADVERBS = new Set(["yesterday","tomorrow","today","recently","finally","usually","always","often","sometimes","already","probably","certainly","definitely","suddenly","immediately","eventually","perhaps","apparently","afterwards","meanwhile","generally","occasionally"]);
const PROPER = new Set(["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday","January","February","March","April","May","June","July","August","September","October","November","December"]);
const ANCHORABLE = new Set(["I","We","She","He","They","The","My","Our","This","That","Some","His","Her","Their"]);
const wordsOf = s => String(s).trim().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
const tileCase = w => (w === "I" || /^I'(m|ve|ll|d)$/.test(w) || PROPER.has(w)) ? w : w.toLowerCase();

/* Anti-ambiguity tile binding: movable modifiers create alternate valid arrangements when they sit
 * in their own tile ("just", "usually", sentence-final "this year"). Binding them into their host
 * tile mechanically removes the alternate arrangement — uniqueness enforced by tiling, not by
 * hoping a reviewer's imagination fails. */
const SCOPE_ADVERBS = new Set(["just", "usually", "only", "still", "finally", "completely", "really", "also", "almost", "even", "quickly"]);
const TIME_TAIL_2 = /^(this|last|next|every) (year|term|week|semester|month|morning|afternoon|night|fall|spring)$|^(earlier|later) (today|tonight)$/i;
const TIME_TAIL_1 = /^(today|tonight|yesterday|tomorrow|overnight)$/i;
function partition(ws, pairMode = null) {
  if (pairMode === null) pairMode = ws.length >= 7;
  // 1. pre-bind: scope adverb + following word become one group
  const g = [];
  for (let i = 0; i < ws.length; i++) {
    if (SCOPE_ADVERBS.has(ws[i].toLowerCase()) && i + 1 < ws.length) { g.push([ws[i], ws[i + 1]]); i++; }
    else g.push([ws[i]]);
  }
  // 2. time phrases (anywhere, not just sentence-final) bind backwards into their host tile —
  //    a free-floating [this year] tile can relocate wholesale and change meaning.
  for (let i = 1; i + 1 < g.length + 1; i++) {
    if (i + 1 < g.length && g[i].length === 1 && g[i + 1].length === 1
        && TIME_TAIL_2.test(`${g[i][0]} ${g[i + 1][0]}`)) {
      const tail = g.splice(i, 2).flat();
      if (g[i - 1].length === 1) { g[i - 1] = g[i - 1].concat(tail); }      // host + 2 = 3 words
      else { g.splice(i, 0, tail); }                                        // host full → keep as one 2-word tile
    } else if (g[i] && g[i].length === 1 && TIME_TAIL_1.test(g[i][0]) && g[i - 1].length <= 2) {
      g[i - 1] = g[i - 1].concat(g[i]); g.splice(i, 1); i--;
    }
  }
  // 2b. backward-binding particles (first/too/though/instead/anyway) glue to the preceding tile
  const BIND_BACKWARD = new Set(["first", "too", "though", "instead", "anyway", "again"]);
  for (let i = 1; i < g.length; i++) {
    if (g[i].length === 1 && BIND_BACKWARD.has(g[i][0].toLowerCase()) && g[i - 1].length <= 2) {
      g[i - 1] = g[i - 1].concat(g[i]); g.splice(i, 1); i--;
    }
  }
  // 2c. sentences of ≥7 words: pair up adjacent singleton tiles (all-singleton tiles maximise the
  //     rearrangement space — pairing is the strongest mechanical ambiguity reducer). ≤6 words must
  //     stay singletons to satisfy the schema's ≥4 effective tiles.
  if (pairMode) {
    for (let i = 0; i + 1 < g.length && g.length > 4; i++) {
      if (g[i].length === 1 && g[i + 1].length === 1) { g[i] = g[i].concat(g[i + 1]); g.splice(i + 1, 1); }
    }
  }
  // 3. lone floating adverbs merge into a neighbour (legacy rule)
  for (let i = 0; i < g.length; i++) {
    if (g[i].length === 1 && FLOATING_ADVERBS.has(g[i][0].toLowerCase())) {
      if (i > 0 && g[i - 1].length <= 2) { g[i - 1] = g[i - 1].concat(g[i]); g.splice(i, 1); i--; }
      else if (g[i + 1] && g[i + 1].length <= 2) { g[i] = g[i].concat(g[i + 1]); g.splice(i + 1, 1); }
    }
  }
  // 4. squeeze to ≤8 tiles by merging adjacent groups (≤3 words per tile, schema cap)
  let guard = 32;
  while (g.length > 8 && guard--) {
    let merged = false;
    for (let i = 0; i + 1 < g.length && !merged; i++) {
      if (g[i].length + g[i + 1].length <= 2) { g[i] = g[i].concat(g[i + 1]); g.splice(i + 1, 1); merged = true; }
    }
    for (let i = 0; i + 1 < g.length && !merged; i++) {
      if (g[i].length + g[i + 1].length <= 3) { g[i] = g[i].concat(g[i + 1]); g.splice(i + 1, 1); merged = true; }
    }
    if (!merged) break;
  }
  return g.map(t => t.join(" "));
}
/* Distractor diversity: the live quality gate (lib/quality/scoreBatch.mjs) requires ≥4 distinct
 * per 10-item set, no single word >50% — real TPO spreads across the auxiliary family
 * (did/do/does/is/are/was/were/can/have/had/am) plus tense-conflicting picks. A fixed-priority
 * list collapses to all-"did" (the exact regression the gate exists for), so we rotate per set:
 * prefer auxiliaries that CONFLICT with the answer's tense (tempting but ungrammatical). */
const AUX_POOL = ["did", "does", "is", "are", "was", "were", "do", "can", "have", "had", "will", "would", "am", "been", "not"];
function pickDistractor(answerWords, supplied, setUsed) {
  const set = new Set(answerWords.map(w => w.toLowerCase()));
  if (supplied && !set.has(String(supplied).toLowerCase())) return String(supplied).toLowerCase();
  const text = answerWords.join(" ").toLowerCase();
  const past = /\b(\w+ed|was|were|had|did|went|came|took|got|ran|built|sent)\b/.test(text);
  const pref = past ? ["does", "is", "do", "are", "will", "am", "can"] : ["did", "was", "were", "had", "would", "been"];
  const candidates = [...pref, ...AUX_POOL];
  // round-robin: least-used-in-this-set first, must not appear in the answer
  let best = null, bestUse = Infinity;
  for (const c of candidates) {
    if (set.has(c)) continue;
    const u = setUsed.get(c) || 0;
    if (u < bestUse) { best = c; bestUse = u; }
    if (u === 0) break; // first unused preferred candidate wins
  }
  best = best || "did";
  setUsed.set(best, (setUsed.get(best) || 0) + 1);
  return best;
}

/* ── Prefilled anchor selection — distribution-matched to etsProfile.PREFILLED_PROFILE ──
 * That profile (hand-coded from real TPO render samples) warns the old calibration missed 55%
 * of real anchor patterns by always using bare subject pronouns. Real: presence 85%, bare
 * subject pronoun ≤30%, ~25% double anchors, anchors also mid/end-sentence (adverb openers,
 * prep phrases, verb phrases, mid nouns). The previous one-liner here (first-word-if-ANCHORABLE)
 * structurally reproduced the old bug → per-set rotation over anchor TYPES instead. */
const PRON_START = new Set(["I", "We", "She", "He", "They", "It", "You"]);
const NP_START = new Set(["The", "My", "Our", "This", "That", "Some", "A", "An", "Three"]);
const ADV_START = new Set(["Sorry", "Unfortunately", "Apparently", "Actually", "Yes", "No", "Oh", "Luckily", "Honestly", "Sadly"]);
const PREPS = new Set(["at", "from", "for", "with", "about", "during", "between", "until", "near", "by"]);
const VERBS = new Set(["asked", "wanted", "heard", "found", "grabbed", "borrowed", "signed", "checked", "missed", "finished", "recommended", "explained", "posted", "moved", "replaced", "dropped", "booked", "visited", "practiced", "parked", "emailed", "shared", "suggested", "offered", "covers", "closes", "stops", "stays", "opens", "shows", "collect", "meets", "fills", "helps", "sits", "faces", "gets", "runs", "came", "cuts", "conflicts", "drops", "lands", "reaches", "called", "worked", "ordered", "applied", "chose", "picked", "switched", "stopped", "filled"]);
const BANNED_PF = new Set(["not", "him", "her", "them"]);
// rotation plan per 10-item set: 1-2 none, ~3 pronoun, rest spread (matches the 7-type ratio);
// slots marked +end get a second end-tail anchor (~2/10 → ~20% double).
const ANCHOR_PLAN = ["pronoun", "np", "none", "verb", "pronoun+end", "adverb", "prep", "pronoun", "mid+end", "none"];
const uniqSeq = (aWords, seq, start) => {
  const low = aWords.map(w => w.toLowerCase());
  const s = seq.map(w => w.toLowerCase());
  let count = 0;
  for (let i = 0; i + s.length <= low.length; i++) if (s.every((w, k) => low[i + k] === w)) count++;
  return count === 1 && !s.some(w => BANNED_PF.has(w)) ? start : -1;
};
function pickAnchors(aWords, planType) {
  const anchors = []; // {words:[...], pos}
  const tryAdd = (seq, pos) => { if (pos >= 0 && uniqSeq(aWords, seq, pos) === pos) { anchors.push({ words: seq, pos }); return true; } return false; };
  const first = aWords[0];
  const base = planType.split("+")[0];
  if (base === "none") return anchors;
  if (base === "pronoun" && PRON_START.has(first)) tryAdd([first], 0);
  else if (base === "np" && NP_START.has(first) && aWords[1]) tryAdd([first, aWords[1]], 0);
  else if (base === "adverb" && ADV_START.has(first)) tryAdd([first], 0);
  else if (base === "verb") { const i = aWords.findIndex((w, k) => k > 0 && k < aWords.length - 1 && VERBS.has(w.toLowerCase())); if (i > 0) tryAdd([aWords[i]], i); }
  else if (base === "prep") { const i = aWords.findIndex((w, k) => k > 1 && k < aWords.length - 1 && PREPS.has(w.toLowerCase())); if (i > 0 && aWords[i + 1]) tryAdd([aWords[i], aWords[i + 1]], i); }
  else if (base === "mid") { const mid = Math.floor(aWords.length / 2); const i = aWords.findIndex((w, k) => k >= mid - 1 && k < aWords.length - 1 && w.length >= 4 && !VERBS.has(w.toLowerCase()) && !PREPS.has(w.toLowerCase())); if (i > 0) tryAdd([aWords[i]], i); }
  // fallback chain: requested type unavailable → end-tail noun → ANY unique first word (real TPO
  // anchors any opener: "Do", "Apparently", "Sorry" all appear as given words) → none
  if (!anchors.length) { const last = aWords[aWords.length - 1]; if (last.length >= 5) tryAdd([last], aWords.length - 1); }
  if (!anchors.length && PRON_START.has(first)) tryAdd([first], 0);
  if (!anchors.length && NP_START.has(first) && aWords[1]) tryAdd([first, aWords[1]], 0);
  if (!anchors.length && first.length > 1) tryAdd([first], 0);
  // optional end-tail second anchor
  if (planType.endsWith("+end") && anchors.length) {
    const last = aWords[aWords.length - 1];
    if (last.length >= 4 && !anchors.some(a => a.pos >= aWords.length - 1)) tryAdd([last], aWords.length - 1);
  }
  return anchors;
}

function assembleItem(it, sid, idx, setUsed) {
  const answer = it.answer.trim();
  const aWords = wordsOf(answer);
  let anchors;
  if (it.prefilled) { // author override: single word anchor
    const i = aWords.findIndex(w => w.toLowerCase() === String(it.prefilled).toLowerCase());
    anchors = i >= 0 ? [{ words: [aWords[i]], pos: i }] : [];
  } else {
    anchors = pickAnchors(aWords, ANCHOR_PLAN[idx % ANCHOR_PLAN.length]);
  }
  const prefilled = anchors.map(a => a.words.join(" "));
  const prefilled_positions = {};
  for (const a of anchors) prefilled_positions[a.words.join(" ")] = a.pos;
  // rest = answer words minus anchor segments — SPLIT AT ANCHOR BOUNDARIES so no tile spans a
  // fixed anchor slot (a [to by] tile bridging a removed mid-sentence anchor is unrenderable).
  const taken = new Set();
  for (const a of anchors) for (let k = 0; k < a.words.length; k++) taken.add(a.pos + k);
  const segs = []; let cur = [];
  for (let i = 0; i < aWords.length; i++) {
    if (taken.has(i)) { if (cur.length) { segs.push(cur); cur = []; } }
    else cur.push(aWords[i]);
  }
  if (cur.length) segs.push(cur);
  const pairMode = aWords.length >= 7;
  const tiles = segs.flatMap(seg => partition(seg, pairMode)).map(t => t.split(" ").map(tileCase).join(" "));
  const distractor = pickDistractor(aWords, it.distractor, setUsed);
  const chunks = [...tiles, distractor];
  return {
    id: `cg_bs_s${sid}_q${idx + 1}`,
    prompt: it.prompt.trim(),
    prompt_task_kind: it.kind || "statement",
    prompt_task_text: it.prompt.trim(),
    answer,
    chunks,
    prefilled,
    prefilled_positions,
    distractor,
    has_question_mark: answer.endsWith("?"),
    grammar_points: it.grammar && it.grammar.length ? it.grammar : ["declarative word order"],
    difficulty: it.diff || "medium",
  };
}

module.exports = { assembleItem, partition, pickAnchors, pickDistractor, wordsOf, tileCase };
if (require.main !== module) return;
const [, , inF, outF] = process.argv;
if (!inF || !outF) { console.log("usage: node scripts/bs-assemble.cjs <content.json> <out.json>"); process.exit(1); }
const content = JSON.parse(readFileSync(inF, "utf8"));
// Sets ship SCRAMBLED: authored content is easy-first, real papers aren't (see lib/gen/setOrder.js).
// Shuffle after assembly so ANCHOR_PLAN/distractor rotation still follows authoring order.
const question_sets = content.sets.map(s => { const setUsed = new Map(); return { set_id: s.set_id, questions: shuffleSetQuestions(s.items.map((it, i) => assembleItem(it, s.set_id, i, setUsed)), `s${s.set_id}`) }; });
writeFileSync(outF, JSON.stringify({ version: "claudeGen-bs", question_sets }, null, 1));

// RENDER-INTEGRITY GATE: every non-distractor tile must be a CONTIGUOUS span of the answer that
// does not overlap a fixed anchor slot — a tile bridging a removed mid-sentence anchor ("[to by]"
// around an anchored "drop") cannot be laid out in the exam frame. Caught live 2026-06-10.
for (const set of question_sets) {
  for (const q of set.questions) {
    const aw = wordsOf(q.answer).map(w => w.toLowerCase());
    const taken = new Set();
    for (const [seg, pos] of Object.entries(q.prefilled_positions)) {
      const k = seg.split(/\s+/).length;
      for (let i = 0; i < k; i++) taken.add(pos + i);
    }
    for (const c of q.chunks) {
      if (c === q.distractor) continue;
      const cw = c.toLowerCase().split(/\s+/);
      let ok = false;
      for (let i = 0; i + cw.length <= aw.length; i++) {
        if (cw.every((w, k) => aw[i + k] === w) && cw.every((_, k) => !taken.has(i + k))) { ok = true; break; }
      }
      if (!ok) { console.log(`✗ RENDER-INTEGRITY: ${q.id} tile [${c}] not a contiguous non-anchor span`); process.exitCode = 1; }
    }
  }
}
if (process.exitCode === 1) { console.log("✗ render-integrity FAIL — fix tiling/anchors"); process.exit(1); }

// SCHEMA GATE: run the live validator per set
let allOk = true;
console.log(`assembled ${question_sets.length} set(s) → ${outF}`);
for (const set of question_sets) {
  const res = validateQuestionSet(set);
  console.log(`  set ${set.set_id}: ${res.ok ? "✓ schema OK" : "✗ FAIL"} (${set.questions.length} q)`);
  if (!res.ok) { allOk = false; res.errors.forEach(e => console.log(`     - ${e}`)); }
}
console.log(allOk ? "\n✓ all sets pass live schema validation" : "\n✗ schema FAIL — fix content & re-assemble");
process.exit(allOk ? 0 : 1);
