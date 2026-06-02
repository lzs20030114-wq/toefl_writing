/**
 * Answer Auditor — AI-powered verification of generated questions.
 *
 * Uses DeepSeek as a "second examiner" to independently answer each question
 * WITHOUT seeing the marked correct answer. If the AI's answer differs from
 * the marked answer, the question is flagged for review.
 *
 * Also checks:
 * - Whether the AI can answer WITHOUT the passage (guessability test)
 * - Whether multiple options could be correct (ambiguity test)
 * - Whether the explanation matches the marked answer
 */

const { join } = require("path");
const { readFileSync, existsSync } = require("fs");

function loadEnv() {
  try {
    const envPath = join(__dirname, "..", "..", ".env.local");
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
      }
    }
  } catch {}
}

async function callAI(prompt, maxTokens = 2000) {
  loadEnv();
  const { callDeepSeekViaCurl } = require("../ai/deepseekHttp.js");
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");

  const payload = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "You are a TOEFL reading comprehension expert. Answer precisely and concisely. Return only valid JSON." },
      { role: "user", content: prompt },
    ],
    temperature: 0.1, // Low temperature for deterministic answers
    max_tokens: maxTokens,
  };

  const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 30000 });
  return typeof result === "string" ? result : (result?.choices?.[0]?.message?.content || JSON.stringify(result));
}

function parseJson(text) {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  return JSON.parse(cleaned);
}

/**
 * Audit a single RDL item's questions.
 *
 * @param {object} item — RDL item with text and questions
 * @returns {Promise<object>} audit results
 */
async function auditRDLItem(item) {
  const results = [];

  // ── Step 1: Answer WITH the passage (verify correctness) ──
  const withPassagePrompt = buildAnswerPrompt(item.text, item.questions);
  let withPassageAnswers;
  try {
    const raw = await callAI(withPassagePrompt);
    withPassageAnswers = parseJson(raw);
  } catch (err) {
    return { id: item.id, error: "AI call failed: " + err.message, results: [] };
  }

  // ── Step 2: Answer WITHOUT the passage (guessability test) ──
  const withoutPassagePrompt = buildGuessabilityPrompt(item.questions);
  let withoutPassageAnswers;
  try {
    const raw = await callAI(withoutPassagePrompt);
    withoutPassageAnswers = parseJson(raw);
  } catch {
    withoutPassageAnswers = {}; // Non-critical, continue
  }

  // ── Step 3: Compare results ──
  for (let i = 0; i < item.questions.length; i++) {
    const q = item.questions[i];
    const qKey = `Q${i + 1}`;
    const markedAnswer = q.correct_answer;
    const aiAnswer = withPassageAnswers[qKey]?.answer || withPassageAnswers[qKey] || "?";
    const aiConfidence = withPassageAnswers[qKey]?.confidence || "unknown";
    const aiReasoning = withPassageAnswers[qKey]?.reasoning || "";
    const guessedAnswer = withoutPassageAnswers[qKey]?.answer || withoutPassageAnswers[qKey] || "?";

    const flags = [];

    // Flag 1: AI disagrees with marked answer
    if (aiAnswer !== markedAnswer && aiAnswer !== "?") {
      flags.push({
        type: "ANSWER_MISMATCH",
        severity: "critical",
        detail: `AI says ${aiAnswer}, marked ${markedAnswer}. AI reasoning: ${aiReasoning}`,
      });
    }

    // Flag 2: Guessable without passage
    if (guessedAnswer === markedAnswer) {
      flags.push({
        type: "GUESSABLE",
        severity: "warning",
        detail: `Can be answered without reading the passage (guessed ${guessedAnswer})`,
      });
    }

    // Flag 3: Low confidence
    if (aiConfidence === "low" || aiConfidence === "uncertain") {
      flags.push({
        type: "AMBIGUOUS",
        severity: "warning",
        detail: `AI confidence is ${aiConfidence}: ${aiReasoning}`,
      });
    }

    results.push({
      question: qKey,
      stem: q.stem.substring(0, 80),
      type: q.question_type,
      markedAnswer,
      aiAnswer,
      aiConfidence,
      guessedAnswer,
      match: aiAnswer === markedAnswer,
      guessable: guessedAnswer === markedAnswer,
      flags,
    });
  }

  return {
    id: item.id,
    genre: item.genre,
    totalQuestions: item.questions.length,
    matches: results.filter(r => r.match).length,
    mismatches: results.filter(r => !r.match).length,
    guessable: results.filter(r => r.guessable).length,
    criticalFlags: results.flatMap(r => r.flags).filter(f => f.severity === "critical").length,
    results,
  };
}

function buildAnswerPrompt(text, questions) {
  const qBlocks = questions.map((q, i) => {
    const opts = Object.entries(q.options).map(([k, v]) => `  ${k}. ${v}`).join("\n");
    return `Q${i + 1}. ${q.stem}\n${opts}`;
  }).join("\n\n");

  return `Read the following passage and answer each question by choosing the BEST option (A, B, C, or D).

## PASSAGE
${text}

## QUESTIONS
${qBlocks}

## INSTRUCTIONS
For each question, analyze the passage carefully and select the best answer.
Return a JSON object with this format:
{
  "Q1": { "answer": "B", "confidence": "high", "reasoning": "The passage states that..." },
  "Q2": { "answer": "D", "confidence": "high", "reasoning": "..." },
  "Q3": { "answer": "A", "confidence": "medium", "reasoning": "..." }
}

Confidence levels: "high" (clearly supported), "medium" (requires inference), "low" (uncertain/ambiguous).
Return ONLY the JSON, no other text.`;
}

function buildGuessabilityPrompt(questions) {
  const qBlocks = questions.map((q, i) => {
    const opts = Object.entries(q.options).map(([k, v]) => `  ${k}. ${v}`).join("\n");
    return `Q${i + 1}. ${q.stem}\n${opts}`;
  }).join("\n\n");

  return `Answer the following reading comprehension questions using ONLY common sense and general knowledge. You have NOT read the passage — you must GUESS based on the options alone.

## QUESTIONS
${qBlocks}

## INSTRUCTIONS
For each question, pick the answer that seems most likely to be correct based on common sense alone.
Return a JSON object:
{
  "Q1": { "answer": "B" },
  "Q2": { "answer": "A" },
  "Q3": { "answer": "C" }
}

Return ONLY the JSON.`;
}

/**
 * Audit a CTW item — verify that blank words have unique solutions.
 */
async function auditCTWItem(item) {
  const prompt = `You are given a C-test passage where some words have their endings removed. For each blank, determine the ONLY correct word that fits.

## PASSAGE (with blanks)
${item.blanked_text}

## INSTRUCTIONS
For each numbered blank, provide the complete word. Return JSON:
{
  "1": "word1",
  "2": "word2",
  ...
  "10": "word10"
}

Return ONLY the JSON.`;

  let aiAnswers;
  try {
    const raw = await callAI(prompt);
    aiAnswers = parseJson(raw);
  } catch (err) {
    return { id: item.id, error: "AI call failed: " + err.message, results: [] };
  }

  const results = [];
  item.blanks.forEach((b, i) => {
    const key = String(i + 1);
    const aiWord = (aiAnswers[key] || "").toLowerCase().replace(/[^a-z]/g, "");
    const correctWord = b.original_word.toLowerCase().replace(/[^a-z]/g, "");
    const match = aiWord === correctWord;

    const flags = [];
    if (!match && aiWord) {
      // Check if the AI's answer is also plausible
      flags.push({
        type: "BLANK_MISMATCH",
        severity: aiWord.startsWith(b.displayed_fragment.toLowerCase()) ? "critical" : "info",
        detail: `AI says "${aiWord}", expected "${correctWord}" (fragment: "${b.displayed_fragment}")`,
      });
    }

    results.push({
      blank: i + 1,
      fragment: b.displayed_fragment,
      expected: b.original_word,
      aiAnswer: aiAnswers[key] || "?",
      match,
      flags,
    });
  });

  return {
    id: item.id,
    totalBlanks: item.blanks.length,
    matches: results.filter(r => r.match).length,
    mismatches: results.filter(r => !r.match).length,
    criticalFlags: results.flatMap(r => r.flags).filter(f => f.severity === "critical").length,
    results,
  };
}

// ── Merge-gate helpers ─────────────────────────────────────────────────────
//
// generate-*.mjs audit at generation time, but a large share of the bank arrives
// via merge-staging.mjs from "*-routine-*" staging files that never ran an audit.
// These helpers let the merge path (and a one-off backfill — scripts/audit-bank.mjs)
// run the same answer-correctness check the generators do, with concurrency limiting.

// Question types the generic second-examiner prompt CANNOT verify:
//   • insert_text          — options are slot labels ("Slot 1"…"Slot 4") whose meaning
//     lives in [■] markers embedded in the passage; buildAnswerPrompt never explains
//     the marker→slot mapping, so an independent examiner can only guess.
//   • paragraph_relationship — depends on paragraph numbering ("paragraph 3") that the
//     flat passage text handed to the auditor doesn't carry.
// Auditing them yields false ANSWER_MISMATCH noise. They still pass schema + profile
// validation upstream; we simply don't answer-audit them here.
const UNAUDITABLE_AP_TYPES = new Set(["insert_text", "paragraph_relationship"]);

// Default CTW ambiguity tolerance: a 10-blank C-test may carry up to this many ambiguous
// blanks before the item is rejected. 2 ⇒ tolerate ≤2/10 (the real-exam-normal 1-2 short/
// function-word cases), reject ≥3/10 (a pervasively under-constrained passage). Mirrors the
// ctwValidator single-char-fragment risk line and the real exam's cumulative scoring.
const CTW_DEFAULT_AMBIGUITY_LIMIT = 2;

/**
 * Audit an Academic Passage item. AP stores its body under `passage` (the auditor
 * expects `text`) and mixes in question types the generic prompt can't verify, so we
 * map the field and drop the unauditable questions before delegating to the RDL
 * auditor. Returns the auditRDLItem shape, plus `skipped` (count of unauditable
 * questions) and — when nothing is left to audit — `note`.
 */
async function auditAPItem(item) {
  const all = item.questions || [];
  const auditable = all.filter((q) => !UNAUDITABLE_AP_TYPES.has(q.question_type));
  const skipped = all.length - auditable.length;
  if (auditable.length === 0) {
    return {
      id: item.id, totalQuestions: 0, matches: 0, mismatches: 0,
      guessable: 0, criticalFlags: 0, skipped, results: [],
      note: "no auditable questions (all insert_text/paragraph_relationship)",
    };
  }
  const audit = await auditRDLItem({ ...item, text: item.passage || item.text, questions: auditable });
  audit.skipped = skipped;
  return audit;
}

/**
 * Audit one reading item and return a keep/reject decision.
 *   type: "ap" | "rdl" | "ctw"
 * Returns { ok, reason, audit }. ok === false ⇒ REJECT (mis-keyed or ambiguous).
 *
 * A critical flag is the reject trigger, mirroring generate-rdl.mjs / generate-ap.mjs:
 *   AP/RDL → ANSWER_MISMATCH    (the independent examiner picked a different answer)
 *   CTW    → BLANK_MISMATCH/crit (a blank has >1 word that fits the shown fragment)
 *
 * AI/transport failures DON'T reject by default (failOpen): a flaky DeepSeek call
 * shouldn't drop a structurally-valid item, and the error is surfaced in the result.
 * The backfill passes failOpen:false so unverifiable items show up as errors instead
 * of silently counting as clean.
 */
async function gateReadingItem(type, item, { retries = 1, failOpen = true, ctwLimit = CTW_DEFAULT_AMBIGUITY_LIMIT } = {}) {
  let audit = { error: "not run" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500)); // brief backoff before retry
    try {
      audit = type === "ctw" ? await auditCTWItem(item)
            : type === "ap"  ? await auditAPItem(item)
            :                  await auditRDLItem(item);
    } catch (e) {
      audit = { error: e && e.message ? e.message : String(e) };
    }
    if (!audit.error) break;
  }
  if (audit.error) {
    return { ok: !!failOpen, reason: "audit error: " + audit.error, audit };
  }
  const crit = audit.criticalFlags || 0;
  // Reject threshold differs by type to match how the REAL exam treats each:
  //   AP/RDL — single-answer multiple choice. The real exam guarantees exactly one
  //     correct option; a mismatch means the key is wrong → reject on the FIRST (limit 0).
  //   CTW — a C-test. The real exam (e.g. DET "Read and Complete") reveals only
  //     floor(len/2) letters and grades each blank by exact match, so the odd short/function
  //     word ("t_"→two/the) is INHERENTLY ambiguous — yet it ships those and absorbs them
  //     across many cumulatively-scored blanks; it never discards a passage over one. So we
  //     TOLERATE up to `ctwLimit` ambiguous blanks and reject only a pervasively-ambiguous
  //     passage. (A per-blank-strict gate would be stricter than the real exam — see the
  //     "Lesson D" note in ctwValidator.js.) Tunable via merge-staging's CTW_AMBIGUITY_LIMIT.
  const limit = type === "ctw" ? Math.max(0, ctwLimit) : 0;
  if (crit > limit) {
    const reason = type === "ctw"
      ? `${crit} ambiguous blank(s) (tolerance ${limit})`
      : `${audit.mismatches} answer mismatch(es)`;
    return { ok: false, reason, audit };
  }
  return { ok: true, reason: "", audit };
}

/**
 * Concurrency-limited audit of many items of the SAME type. Returns an array of
 * { item, ok, reason, audit } aligned to `items`. `onResult(result, index)` (if
 * given) fires as each item finishes, for streaming progress logs. Concurrency is
 * capped because each AP/RDL audit makes 2 DeepSeek calls (CTW makes 1).
 */
async function auditItems(type, items, { concurrency = 5, retries = 1, failOpen = true, ctwLimit = CTW_DEFAULT_AMBIGUITY_LIMIT, onResult } = {}) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(concurrency || 5, items.length || 1));
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const r = await gateReadingItem(type, items[i], { retries, failOpen, ctwLimit });
      const out = { item: items[i], ok: r.ok, reason: r.reason, audit: r.audit };
      results[i] = out;
      if (onResult) { try { onResult(out, i); } catch {} }
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

module.exports = {
  auditRDLItem,
  auditCTWItem,
  auditAPItem,
  gateReadingItem,
  auditItems,
  UNAUDITABLE_AP_TYPES,
  CTW_DEFAULT_AMBIGUITY_LIMIT,
};
