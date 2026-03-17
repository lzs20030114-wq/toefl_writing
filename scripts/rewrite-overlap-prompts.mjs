#!/usr/bin/env node
/**
 * Detect and rewrite prompts with >30% content word overlap with the answer.
 * Uses DeepSeek to rewrite prompts with generic/abstract phrasing (TPO style).
 * No questions are deleted — originals kept if rewrite fails.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../lib/ai/deepseekHttp.js");
const { validateStructuredPromptParts } = require("../lib/questionBank/buildSentencePromptContract");

// Load env
for (const p of [resolve(__dirname, "..", ".env.local"), resolve(__dirname, "..", ".env")]) {
  try {
    readFileSync(p, "utf8").split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
    });
  } catch {}
}

const BANK = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const d = JSON.parse(readFileSync(BANK, "utf8"));

const THRESHOLD = parseFloat(process.argv[2] || "0.30");
const BATCH_SIZE = 30;

const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","do","does","did","have","has","had",
  "i","you","she","he","it","we","they","my","your","her","his","that","this",
  "in","on","at","to","of","for","and","or","not","if","whether","be","been",
  "being","by","with","from","about","would","could","should","will","can","may",
  "what","how","where","when","why","who","whom","which","yes","no","some","just",
  "very","much","also","so","but","then","than","all","any","its",
]);

function contentWords(text) {
  return text.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function overlapRate(prompt, answer) {
  const pW = contentWords(prompt || "");
  const aW = contentWords(answer);
  if (aW.length === 0) return 0;
  return aW.filter(w => pW.includes(w)).length / aW.length;
}

// Collect high-overlap questions
const highOverlap = [];
for (const set of d.question_sets) {
  for (const q of set.questions) {
    const rate = overlapRate(q.prompt, q.answer);
    if (rate > THRESHOLD) highOverlap.push({ q, rate });
  }
}
console.log(`Found ${highOverlap.length} questions with >${(THRESHOLD * 100).toFixed(0)}% content overlap`);
if (highOverlap.length === 0) { console.log("Nothing to do."); process.exit(0); }

// Show distribution
const byKind = {};
for (const { q, rate } of highOverlap) {
  const k = q.prompt_task_kind;
  if (!byKind[k]) byKind[k] = [];
  byKind[k].push(rate);
}
for (const [k, rates] of Object.entries(byKind)) {
  console.log(`  ${k}: ${rates.length} questions, avg ${(rates.reduce((a, b) => a + b, 0) / rates.length * 100).toFixed(1)}%`);
}

function buildRewritePrompt(items) {
  const data = items.map(({ q }) => ({
    id: q.id,
    answer: q.answer,
    current_prompt: q.prompt_task_text || q.prompt,
    prompt_task_kind: q.prompt_task_kind,
    overlap_words: (() => {
      const pW = contentWords(q.prompt_task_text || q.prompt);
      const aW = contentWords(q.answer);
      return [...new Set(aW.filter(w => pW.includes(w)))];
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
1. Replace specific nouns/adjectives from "overlap_words" with generic terms (construction noise → disturbance, package → delivery, book club → event, community center → local venue)
2. Remove temporal details that appear in the answer (yesterday, next week, this morning)
3. Keep the same prompt_task_kind — do NOT change it
4. For "ask" kind: must start with What/How/Where/Why/When and end with "?"
5. For "report" kind: must start with Report/Describe/Explain/Summarize/Mention/State/Say/Express and end with "."
6. For "respond" kind: must start with Tell/Respond/Reply/Answer/Share/Say/Express/Inform and end with "."
7. For "statement" kind: must be a declarative context sentence ending with "." — do NOT start with "Complete"
8. The rewritten prompt must still make sense as a prompt for the given answer

## ITEMS TO REWRITE (${items.length}):
${JSON.stringify(data, null, 2)}

## OUTPUT:
Return ONLY a JSON array: [{"id": "...", "prompt_task_kind": "...", "prompt_task_text": "..."}]
No markdown fences. No explanation.`.trim();
}

async function rewriteBatch(items) {
  const prompt = buildRewritePrompt(items);
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
  if (arrStart < 0 || arrEnd <= arrStart) throw new Error("No JSON array in response");
  return JSON.parse(text.slice(arrStart, arrEnd + 1));
}

async function main() {
  const qMap = new Map(highOverlap.map(({ q }) => [q.id, q]));
  let totalApplied = 0;
  let totalRejected = 0;
  let totalImproved = 0;

  for (let i = 0; i < highOverlap.length; i += BATCH_SIZE) {
    const batch = highOverlap.slice(i, i + BATCH_SIZE);
    console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} items`);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rewrites = await rewriteBatch(batch);
        console.log(`  Got ${rewrites.length} rewrites`);

        for (const rw of rewrites) {
          const q = qMap.get(rw.id);
          if (!q) continue;

          const newKind = String(rw.prompt_task_kind || "").trim().toLowerCase();
          const newText = String(rw.prompt_task_text || "").trim();
          if (!newText) { totalRejected++; continue; }

          // Validate
          const testQ = { ...q, prompt_task_kind: newKind, prompt_task_text: newText, prompt_context: "" };
          const check = validateStructuredPromptParts(testQ);
          if (check.fatal.length > 0) {
            console.log(`  ${rw.id}: rejected — ${check.fatal.join("; ")}`);
            totalRejected++;
            continue;
          }

          // Check improvement
          const oldRate = overlapRate(q.prompt, q.answer);
          const newRate = overlapRate(newText, q.answer);
          if (newRate >= oldRate) {
            console.log(`  ${rw.id}: no improvement (${(oldRate * 100).toFixed(0)}% → ${(newRate * 100).toFixed(0)}%)`);
            totalRejected++;
            continue;
          }

          q.prompt_task_kind = newKind;
          q.prompt_task_text = newText;
          q.prompt_context = "";
          q.prompt = newText;
          totalApplied++;
          if (newRate <= THRESHOLD) totalImproved++;
          console.log(`  ${rw.id}: ${(oldRate * 100).toFixed(0)}% → ${(newRate * 100).toFixed(0)}% (${q.prompt_task_kind})`);
        }
        break;
      } catch (e) {
        console.log(`  Attempt ${attempt + 1} failed: ${e.message}`);
        if (attempt === 0) await new Promise(r => setTimeout(r, 5000));
      }
    }

    if (i + BATCH_SIZE < highOverlap.length) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  writeFileSync(BANK, JSON.stringify(d, null, 2) + "\n");

  // Final stats
  const remaining = d.question_sets.flatMap(s => s.questions)
    .filter(q => overlapRate(q.prompt, q.answer) > THRESHOLD).length;

  console.log(`\n=== OVERLAP REWRITE COMPLETE ===`);
  console.log(`Applied: ${totalApplied}/${highOverlap.length}`);
  console.log(`Rejected: ${totalRejected}`);
  console.log(`Now below threshold: ${totalImproved}`);
  console.log(`Still above ${(THRESHOLD * 100).toFixed(0)}%: ${remaining}`);
}

main().catch(e => { console.error(e); process.exit(1); });
