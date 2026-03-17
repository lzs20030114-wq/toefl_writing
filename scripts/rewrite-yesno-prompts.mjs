#!/usr/bin/env node
/**
 * Rewrite all yesno prompts in the bank to ask/report/respond style.
 * yesno prompts leak answer content (60% word overlap) — replace with
 * contextual situation prompts that don't reveal the answer.
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

// Collect all yesno questions
const yesnoQuestions = [];
for (const set of d.question_sets) {
  for (const q of set.questions) {
    if (q.prompt_task_kind === "yesno") {
      yesnoQuestions.push(q);
    }
  }
}
console.log(`Found ${yesnoQuestions.length} yesno prompts to rewrite`);
if (yesnoQuestions.length === 0) { console.log("Nothing to do."); process.exit(0); }

const BATCH_SIZE = 30;
const KINDS = ["ask", "report", "respond"];

function buildRewritePrompt(items) {
  const data = items.map(q => ({
    id: q.id,
    answer: q.answer,
    grammar_points: q.grammar_points,
    current_prompt: q.prompt,
  }));

  return `You are a TOEFL iBT prompt rewriter. Rewrite each prompt as a CONTEXTUAL SITUATION description.

## CRITICAL RULE:
The new prompt must NOT contain content words from the answer. It should describe a SITUATION or SCENARIO — who is speaking, where, and what topic — without revealing what the answer actually says.

## BAD (leaks answer):
  answer: "The cafe that opened last week has excellent coffee."
  prompt: "Does the cafe that opened last week have excellent coffee?" ← WRONG, repeats answer

## GOOD (contextual):
  answer: "The cafe that opened last week has excellent coffee."
  prompt: "Tell your friend about the new place you tried." ← gives situation only
  kind: "respond"

  answer: "The customer didn't know whether the prescription was ready for pickup."
  prompt: "Report what happened when the customer visited the pharmacy."
  kind: "report"

  answer: "She was curious whether the new schedule had been posted."
  prompt: "What did your colleague ask about?"
  kind: "ask"

## FORMAT:
Use ONLY kind "ask" — a question starting with What/How/Where/Why/When and ending with "?".
Examples of good "ask" prompts:
- "What did your colleague mention about the project?"
- "What was the update about the construction?"
- "How did your friend describe the restaurant?"
- "What did the customer want to know?"

IMPORTANT: Every prompt MUST start with What/How/Where/Why/When and end with "?".

## ITEMS TO REWRITE (${items.length}):
${JSON.stringify(data, null, 2)}

## OUTPUT:
Return ONLY a JSON array: [{"id": "...", "prompt_task_kind": "ask"|"report"|"respond", "prompt_task_text": "..."}]
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
  const qMap = new Map(yesnoQuestions.map(q => [q.id, q]));
  let totalRewritten = 0;
  let totalFailed = 0;

  for (let i = 0; i < yesnoQuestions.length; i += BATCH_SIZE) {
    const batch = yesnoQuestions.slice(i, i + BATCH_SIZE);
    console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} items`);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rewrites = await rewriteBatch(batch);
        console.log(`  Got ${rewrites.length} rewrites`);

        let batchOk = 0;
        for (const rw of rewrites) {
          const q = qMap.get(rw.id);
          if (!q) continue;

          const newKind = String(rw.prompt_task_kind || "").trim().toLowerCase();
          const newText = String(rw.prompt_task_text || "").trim();
          if (!newText || !KINDS.includes(newKind)) {
            console.log(`  ${rw.id}: invalid kind="${newKind}" or empty text`);
            totalFailed++;
            continue;
          }

          // Validate
          const testQ = { ...q, prompt_task_kind: newKind, prompt_task_text: newText, prompt_context: "" };
          const check = validateStructuredPromptParts(testQ);
          if (check.fatal.length > 0) {
            console.log(`  ${rw.id}: rejected — ${check.fatal.join("; ")}`);
            totalFailed++;
            continue;
          }

          // Check content leak — reject if >40% content word overlap
          const stopwords = new Set(["the","a","an","is","are","was","were","do","does","did","have","has","had","i","you","she","he","it","we","they","my","your","her","his","that","this","in","on","at","to","of","for","and","or","not","if","whether","be","been","being","by","with","from","about","would","could","should","will","can","may"]);
          const pWords = newText.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(w => !stopwords.has(w));
          const aWords = q.answer.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(w => !stopwords.has(w));
          const overlap = aWords.filter(w => pWords.includes(w)).length;
          const leakRate = aWords.length > 0 ? overlap / aWords.length : 0;
          if (leakRate > 0.4) {
            console.log(`  ${rw.id}: leak ${(leakRate * 100).toFixed(0)}% — "${newText.slice(0, 60)}"`);
            totalFailed++;
            continue;
          }

          q.prompt_task_kind = newKind;
          q.prompt_task_text = newText;
          q.prompt_context = "";
          q.prompt = newText;
          batchOk++;
          totalRewritten++;
        }
        console.log(`  Applied: ${batchOk}/${batch.length}`);
        break;
      } catch (e) {
        console.log(`  Attempt ${attempt + 1} failed: ${e.message}`);
        if (attempt === 0) await new Promise(r => setTimeout(r, 5000));
      }
    }

    // Rate limit pause between batches
    if (i + BATCH_SIZE < yesnoQuestions.length) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  writeFileSync(BANK, JSON.stringify(d, null, 2) + "\n");
  console.log(`\n=== Done: ${totalRewritten}/${yesnoQuestions.length} rewritten, ${totalFailed} failed ===`);

  // Verify remaining yesno count
  const remaining = d.question_sets.flatMap(s => s.questions).filter(q => q.prompt_task_kind === "yesno").length;
  console.log(`Remaining yesno in bank: ${remaining}`);
}

main().catch(e => { console.error(e); process.exit(1); });
