/**
 * appendBSSets.mjs
 * 在现有 questions.json 基础上追加新题组，确保与已有题目不重复。
 *
 * Usage:
 *   BS_APPEND_SETS=5 node scripts/appendBSSets.mjs
 *
 * Env:
 *   DEEPSEEK_API_KEY=...
 *   DEEPSEEK_PROXY_URL=http://127.0.0.1:10808  (optional)
 *   BS_APPEND_SETS=5                            (default 5)
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { callDeepSeekViaCurl, resolveProxyUrl, formatDeepSeekError } = require("../lib/ai/deepseekHttp.js");
const { validateQuestionSet, validateQuestion } = require("../lib/questionBank/buildSentenceSchema.js");
const { normalizeRuntimeQuestion, validateRuntimeQuestion } = require("../lib/questionBank/runtimeModel.js");
const { estimateQuestionDifficulty, evaluateSetDifficultyAgainstTarget, ETS_2026_TARGET_COUNTS_10 } = require("../lib/questionBank/difficultyControl.js");
const { isEmbeddedQuestion } = require("../lib/questionBank/etsProfile.js");
const { validateAllSets } = require("./validate-bank.js");

const OUTPUT_PATH = resolve(__dirname, "../data/buildSentence/questions.json");
const APPEND_SETS = Number(process.env.BS_APPEND_SETS || 5);
const CANDIDATE_ROUNDS = Number(process.env.BS_CANDIDATE_ROUNDS || 50);
const MIN_REVIEW_SCORE = Number(process.env.BS_MIN_REVIEW_SCORE || 78);
const MIN_REVIEW_OVERALL = Number(process.env.BS_MIN_REVIEW_OVERALL || 84);
const MIN_ETS_SIMILARITY = Number(process.env.BS_MIN_ETS_SIMILARITY || 72);
const MIN_SOLVABILITY = Number(process.env.BS_MIN_SOLVABILITY || 78);

// ── env loading ──────────────────────────────────────────────
function loadEnv() {
  for (const p of [resolve(__dirname, "../.env.local"), resolve(__dirname, "../.env")]) {
    try {
      readFileSync(p, "utf8").split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch (_) {}
  }
}

// ── utilities ────────────────────────────────────────────────
const norm = (s) => String(s || "").trim();
const answerKey = (q) => norm(q.answer).toLowerCase();
const endsQ = (s) => norm(s).endsWith("?");

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function uniqByAnswer(list) {
  const seen = new Set();
  return list.filter((q) => { const k = answerKey(q); if (seen.has(k)) return false; seen.add(k); return true; });
}

function parseJsonArray(text) {
  const s = body => { const i = body.indexOf("["), j = body.lastIndexOf("]"); if (i < 0 || j <= i) throw new Error("no JSON array"); return JSON.parse(body.slice(i, j + 1)); };
  return s(String(text || ""));
}

function parseJsonObject(text) {
  const b = String(text || ""), i = b.indexOf("{"), j = b.lastIndexOf("}");
  if (i < 0 || j <= i) throw new Error("no JSON object");
  return JSON.parse(b.slice(i, j + 1));
}

function autoSplitChunk(c, max = 3) {
  const ws = c.split(/\s+/).filter(Boolean);
  if (ws.length <= max) return [c];
  const mid = Math.ceil(ws.length / 2);
  return [ws.slice(0, mid).join(" "), ws.slice(mid).join(" ")];
}

function ensureMinChunks(chunks, distractor, min = 4) {
  let r = [...chunks];
  for (let n = 10; n-- > 0;) {
    const eff = r.filter(c => c !== distractor);
    if (eff.length >= min) break;
    let li = -1, ll = 0;
    r.forEach((c, i) => { if (c === distractor) return; const w = c.split(/\s+/).length; if (w > ll) { ll = w; li = i; } });
    if (li < 0 || ll < 2) break;
    const ws = r[li].split(/\s+/), mid = Math.ceil(ws.length / 2);
    r.splice(li, 1, ws.slice(0, mid).join(" "), ws.slice(mid).join(" "));
  }
  return r;
}

function normalizeQ(raw, tid) {
  const q = raw && typeof raw === "object" ? raw : {};
  let chunks = (Array.isArray(q.chunks) ? q.chunks : []).map(c => norm(c).toLowerCase()).filter(Boolean);
  const distractor = norm(q.distractor)?.toLowerCase() || null;
  chunks = chunks.flatMap(c => autoSplitChunk(c, 3));
  chunks = ensureMinChunks(chunks, distractor, 4);
  const answer = norm(q.answer);
  return {
    id: norm(q.id) || tid,
    prompt: norm(q.prompt),
    answer,
    chunks,
    prefilled: Array.isArray(q.prefilled) ? q.prefilled.map(c => norm(c)).filter(Boolean) : [],
    prefilled_positions: (q.prefilled_positions && typeof q.prefilled_positions === "object" && !Array.isArray(q.prefilled_positions)) ? q.prefilled_positions : {},
    distractor,
    has_question_mark: typeof q.has_question_mark === "boolean" ? q.has_question_mark : endsQ(answer),
    grammar_points: Array.isArray(q.grammar_points) ? q.grammar_points.map(g => norm(g)).filter(Boolean) : [],
  };
}

function hardValidate(q) {
  const v = validateQuestion(q);
  if (v.fatal.length > 0) return { ok: false, reason: `fatal: ${v.fatal.join("; ")}` };
  if (v.format.length > 0) return { ok: false, reason: `format: ${v.format.join("; ")}` };
  try { validateRuntimeQuestion(normalizeRuntimeQuestion(q)); } catch (e) { return { ok: false, reason: `runtime: ${e.message}` }; }
  return { ok: true };
}

// ── prompts ──────────────────────────────────────────────────
function genPrompt(round, existingAnswers) {
  const excluded = existingAnswers.length > 0
    ? `\n## CRITICAL: Do NOT reproduce any of these existing answer sentences (already in the bank):\n${existingAnswers.map(a => `- ${a}`).join("\n")}\nAll 10 new answers MUST be clearly different from the above.\n`
    : "";
  return `
You are a TOEFL iBT Writing Task 1 "Build a Sentence" item writer.
Return ONLY a JSON array with exactly 10 question objects.

Required schema for each item:
{
  "id": "tmp_r${round}_q1",
  "prompt": "conversational context sentence (5-15 words, ends with ? or .)",
  "answer": "the correct sentence to build (7-15 words, concentrated 9-13)",
  "chunks": ["lowercase chunk", "..."],
  "prefilled": ["word1"] or [],
  "prefilled_positions": {"word1": 0} or {},
  "distractor": null or "lowercase single-word distractor not in answer",
  "has_question_mark": true/false,
  "grammar_points": ["grammar point 1"]
}

## Difficulty distribution (TPO standard):
- 0-1 easy (7-9 words, 5-6 chunks, simple structure)
- 7-8 medium (9-13 words, 6-7 chunks, embedded question or negation)
- 2-3 hard (11-15 words, 7-8 chunks, multi-layer: indirect+passive+perfect / indirect+negation)

## 92% of answers are STATEMENTS (has_question_mark=false)
Indirect/embedded questions use DECLARATIVE word order (no inversion).

## Sentence type distribution:
- Indirect/embedded questions: 6-8 items (wanted to know, asked, was curious, was wondering, found out, needed to know)
- Negation: 2-3 items (did not, have not, could not, no longer, have no idea)
- Contact/relative clause: 1-2 items (omitted relative pronoun)
- Other: 0-1 items

## Distractor rules:
- 88% of items have a distractor (single word only, never a phrase)
- Mainly: did, do, does (extra auxiliary to tempt direct-question word order)
- Distractor must NOT appear in answer

## Chunk rules:
- Effective chunk count (excluding distractor): 4-8, TARGET 5-7
- Each chunk max 3 words, all lowercase
- chunks (minus distractor) + prefilled = all answer words exactly

## Prompt patterns:
- "What did [Name] ask you?" — 3-4 items
- "Did you enjoy/finish/attend...?" — 2 items
- "Where/Why did you...?" — 1-2 items
- Other — 1-2 items
Use diverse names: Matthew, Mariana, Julian, Alison, Emma, Professor Cho, etc.

${excluded}

Self-check before returning:
1. chunks (minus distractor) + prefilled = answer words exactly
2. distractor not in answer, distractor is single word
3. prefilled_positions match actual word positions
4. exactly one valid arrangement exists
5. indirect questions use declarative word order

No markdown. JSON array only.
`.trim();
}

function reviewPrompt(qs) {
  return `You are a strict TOEFL TPO item quality reviewer.
Return ONLY JSON: {"overall_score":0-100,"blockers":["..."],"question_scores":[{"id":"...","score":0-100,"issues":["..."]}]}
Blockers ONLY for: ambiguous order, ungrammatical answer, distractor valid in answer, inverted indirect question.
Items:\n${JSON.stringify(qs, null, 2)}`.trim();
}

function consistencyPrompt(qs) {
  return `You are a TPO Build-a-Sentence auditor.
Return ONLY JSON: {"overall_ets_similarity":0-100,"overall_solvability":0-100,"blockers":["..."],"question_scores":[{"id":"...","ets_similarity":0-100,"solvability":0-100,"issues":["..."]}]}
Blockers ONLY for: ambiguous order, ungrammatical, distractor valid in answer, inverted indirect question.
Items:\n${JSON.stringify(qs, null, 2)}`.trim();
}

// ── AI call ──────────────────────────────────────────────────
async function callModel(prompt) {
  return callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: 120000,
    payload: { model: "deepseek-chat", temperature: 0.35, max_tokens: 5000, messages: [{ role: "user", content: prompt }] },
  });
}

const errMsg = (e) => (formatDeepSeekError ? formatDeepSeekError(e) : String(e?.message || e || "unknown"));

// ── generation round ─────────────────────────────────────────
async function generateRound(round, existingKeys, existingAnswers) {
  const out = { accepted: [], rejected: 0, reasons: {} };

  const raw = await callModel(genPrompt(round, existingAnswers));
  const arr = parseJsonArray(raw);
  if (!Array.isArray(arr) || arr.length !== 10) throw new Error(`round ${round}: not 10 items`);

  const normalized = arr.map((q, i) => normalizeQ(q, `tmp_r${round}_q${i + 1}`));

  // deduplicate against existing bank + within this round
  const roundSeen = new Set(existingKeys);
  const hardPassed = [];
  for (const q of normalized) {
    const k = answerKey(q);
    if (roundSeen.has(k)) { out.rejected++; out.reasons["dup:existing"] = (out.reasons["dup:existing"] || 0) + 1; continue; }
    const hv = hardValidate(q);
    if (!hv.ok) { out.rejected++; out.reasons[hv.reason] = (out.reasons[hv.reason] || 0) + 1; continue; }
    roundSeen.add(k);
    hardPassed.push(q);
  }

  if (hardPassed.length === 0) return out;

  // AI quality check
  const [reviewRaw, consistencyRaw] = await Promise.all([
    callModel(reviewPrompt(hardPassed)),
    callModel(consistencyPrompt(hardPassed)),
  ]);
  const review = parseJsonObject(reviewRaw);
  const consistency = parseJsonObject(consistencyRaw);
  const scoreMap = new Map((review.question_scores || []).map(s => [s.id, Number(s.score || 0)]));
  const cMap = new Map((consistency.question_scores || []).map(s => [s.id, { ets: Number(s.ets_similarity || 0), sol: Number(s.solvability || 0) }]));

  const reviewBlocked = (review.blockers || []).length > 0 && Number(review.overall_score || 0) < MIN_REVIEW_OVERALL;
  const consBlocked = (consistency.blockers || []).length > 0 && (Number(consistency.overall_ets_similarity || 0) < MIN_ETS_SIMILARITY || Number(consistency.overall_solvability || 0) < MIN_SOLVABILITY);

  for (const q of hardPassed) {
    const score = scoreMap.get(q.id) || 0;
    const c = cMap.get(q.id) || { ets: 0, sol: 0 };
    if (reviewBlocked || consBlocked || score < MIN_REVIEW_SCORE || c.ets < MIN_ETS_SIMILARITY || c.sol < MIN_SOLVABILITY) {
      out.rejected++;
      const r = reviewBlocked || consBlocked ? "review:blocked" : score < MIN_REVIEW_SCORE ? `score<${MIN_REVIEW_SCORE}` : c.ets < MIN_ETS_SIMILARITY ? `ets<${MIN_ETS_SIMILARITY}` : `sol<${MIN_SOLVABILITY}`;
      out.reasons[r] = (out.reasons[r] || 0) + 1;
      continue;
    }
    out.accepted.push(q);
  }
  return out;
}

// ── set assembly ─────────────────────────────────────────────
function splitByDiff(questions) {
  const pool = { easy: [], medium: [], hard: [] };
  questions.forEach(q => pool[estimateQuestionDifficulty(q).bucket].push(q));
  pool.easy = shuffle(uniqByAnswer(pool.easy));
  pool.medium = shuffle(uniqByAnswer(pool.medium));
  pool.hard = shuffle(uniqByAnswer(pool.hard));
  return pool;
}

function profileStyle(items) {
  const n = items.length || 1;
  return {
    qmark: items.filter(q => q.has_question_mark).length,
    distractor: items.filter(q => q.distractor != null).length,
    embedded: items.filter(q => isEmbeddedQuestion(q.grammar_points)).length,
    avgWords: items.reduce((s, q) => s + norm(q.answer).replace(/[.,!?;:]/g, " ").split(/\s+/).filter(Boolean).length, 0) / n,
    avgChunks: items.reduce((s, q) => s + (Array.isArray(q.chunks) ? q.chunks.filter(c => c !== q.distractor).length : 0), 0) / n,
  };
}

function styleOk(p, relaxed = false) {
  return relaxed
    ? p.qmark <= 3 && p.distractor >= 6 && p.embedded >= 4 && p.avgWords >= 8.5 && p.avgWords <= 14 && p.avgChunks >= 4 && p.avgChunks <= 8
    : p.qmark <= 2 && p.distractor >= 7 && p.embedded >= 5 && p.avgWords >= 9 && p.avgWords <= 13 && p.avgChunks >= 4.5 && p.avgChunks <= 7.5;
}

function composeSet(pool, setId, maxRetries = 500) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (pool.easy.length < ETS_2026_TARGET_COUNTS_10.easy || pool.medium.length < ETS_2026_TARGET_COUNTS_10.medium || pool.hard.length < ETS_2026_TARGET_COUNTS_10.hard) return null;
    const merged = shuffle([
      ...shuffle(pool.easy).slice(0, ETS_2026_TARGET_COUNTS_10.easy),
      ...shuffle(pool.medium).slice(0, ETS_2026_TARGET_COUNTS_10.medium),
      ...shuffle(pool.hard).slice(0, ETS_2026_TARGET_COUNTS_10.hard),
    ]).map((q, i) => ({ ...JSON.parse(JSON.stringify(q)), id: `ets_s${setId}_q${i + 1}` }));

    const set = { set_id: setId, questions: merged };
    const diff = evaluateSetDifficultyAgainstTarget(merged);
    if (!validateQuestionSet(set).ok || !diff.ok || !diff.meetsTargetCount10) continue;
    if (!styleOk(profileStyle(merged), attempt >= Math.floor(maxRetries * 0.6))) continue;
    let rtOk = true;
    for (const q of merged) { try { validateRuntimeQuestion(normalizeRuntimeQuestion(q)); } catch { rtOk = false; break; } }
    if (!rtOk) continue;

    const used = new Set(merged.map(answerKey));
    pool.easy = pool.easy.filter(q => !used.has(answerKey(q)));
    pool.medium = pool.medium.filter(q => !used.has(answerKey(q)));
    pool.hard = pool.hard.filter(q => !used.has(answerKey(q)));
    return set;
  }
  return null;
}

// ── main ─────────────────────────────────────────────────────
async function main() {
  loadEnv();
  if (!process.env.DEEPSEEK_API_KEY) { console.error("ERROR: DEEPSEEK_API_KEY missing"); process.exit(1); }

  // Load existing bank
  const existing = JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
  const existingSets = Array.isArray(existing.question_sets) ? existing.question_sets : [];
  const nextSetId = existingSets.length + 1;
  const existingKeys = new Set(existingSets.flatMap(s => s.questions.map(answerKey)));
  const existingAnswers = [...existingKeys]; // for prompt reference
  console.log(`Existing sets: ${existingSets.length} | Existing unique answers: ${existingKeys.size}`);
  console.log(`Will append ${APPEND_SETS} new sets (set IDs: ${nextSetId}–${nextSetId + APPEND_SETS - 1})`);

  const easyTarget = ETS_2026_TARGET_COUNTS_10.easy * APPEND_SETS;
  const mediumTarget = ETS_2026_TARGET_COUNTS_10.medium * APPEND_SETS;
  const hardTarget = ETS_2026_TARGET_COUNTS_10.hard * APPEND_SETS;

  const pool = [];
  const rejectLog = {};

  for (let round = 1; round <= CANDIDATE_ROUNDS; round++) {
    try {
      const res = await generateRound(round, existingKeys, existingAnswers);
      // Add newly accepted to existingKeys to prevent inter-round dups
      res.accepted.forEach(q => existingKeys.add(answerKey(q)));
      pool.push(...res.accepted);
      Object.entries(res.reasons).forEach(([k, v]) => { rejectLog[k] = (rejectLog[k] || 0) + v; });
      const p = splitByDiff(pool);
      console.log(`round ${round}: accepted=${res.accepted.length} rejected=${res.rejected} | pool easy=${p.easy.length} medium=${p.medium.length} hard=${p.hard.length}`);
      if (p.easy.length >= easyTarget && p.medium.length >= mediumTarget && p.hard.length >= hardTarget && pool.length > APPEND_SETS * 14) {
        console.log("pool sufficient, stopping early");
        break;
      }
    } catch (e) {
      console.log(`round ${round}: error -> ${errMsg(e)}`);
    }
  }

  const poolByDiff = splitByDiff(pool);
  console.log(`Final pool: easy=${poolByDiff.easy.length} medium=${poolByDiff.medium.length} hard=${poolByDiff.hard.length}`);

  const newSets = [];
  for (let i = 0; i < APPEND_SETS; i++) {
    const set = composeSet(poolByDiff, nextSetId + i);
    if (!set) { console.error(`Could not assemble set ${nextSetId + i} (pool exhausted)`); break; }
    newSets.push(set);
    console.log(`  set ${set.set_id}: assembled OK`);
  }

  if (newSets.length !== APPEND_SETS) {
    console.error(`Only built ${newSets.length}/${APPEND_SETS} sets. Aborting.`);
    console.error("Reject reasons:", JSON.stringify(rejectLog, null, 2));
    process.exit(1);
  }

  // 只验证新生成的题组（不对现有老题做严格校验）
  const newOnly = { version: "1.3", generated_at: new Date().toISOString(), question_sets: newSets };
  const check = validateAllSets(newOnly, { strict: true });
  if (!check.ok) {
    console.error("New sets validation failed:");
    [...check.failures, ...check.strictHardFails.map(x => `${x.label}: ${x.reasons.join("; ")}`)].forEach(x => console.error(x));
    process.exit(1);
  }
  // 警告只打印不中断
  check.strictWarnings.forEach(x => console.warn(`WARN ${x.label}: ${x.reasons.join("; ")}`));

  const merged = {
    version: "1.3",
    generated_at: new Date().toISOString(),
    question_sets: [...existingSets, ...newSets],
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2) + "\n", "utf8");
  console.log(`\n✅ Saved ${merged.question_sets.length} total sets to ${OUTPUT_PATH}`);
  newSets.forEach(s => {
    const d = evaluateSetDifficultyAgainstTarget(s.questions);
    console.log(`  set ${s.set_id}: easy=${d.profile.counts.easy} medium=${d.profile.counts.medium} hard=${d.profile.counts.hard}`);
  });
  console.log("\nReject reasons:", JSON.stringify(rejectLog, null, 2));
}

main().catch(e => { console.error(`Fatal: ${errMsg(e)}`); process.exit(1); });
