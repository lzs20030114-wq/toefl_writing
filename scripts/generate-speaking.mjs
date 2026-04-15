#!/usr/bin/env node

/**
 * Generate Speaking practice items using DeepSeek.
 *
 * Usage:
 *   node scripts/generate-speaking.mjs --type repeat  [--count 5] [--dry-run]
 *   node scripts/generate-speaking.mjs --type interview [--count 5] [--dry-run]
 *
 * Pipeline:
 *   1. Build prompt (repeat sentences or interview questions)
 *   2. Call DeepSeek to generate sets
 *   3. Validate items individually + batch
 *   4. Save accepted items to staging
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { buildRepeatPrompt } = require("../lib/speakingGen/repeatPromptBuilder.js");
const { buildInterviewPrompt } = require("../lib/speakingGen/interviewPromptBuilder.js");
const {
  validateRepeatSet,
  validateInterviewSet,
  validateBatch,
} = require("../lib/speakingGen/speakingValidator.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING_DIR = join(__dirname, "..", "data", "speaking", "staging");

// ── Parse CLI args ──
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const MAX_BATCH = 10;
const TYPE = getArg("type", "repeat"); // "repeat" | "interview"
const COUNT = Math.min(parseInt(getArg("count", "5"), 10), MAX_BATCH);
const DRY_RUN = args.includes("--dry-run");

if (!["repeat", "interview"].includes(TYPE)) {
  console.error(`Invalid --type "${TYPE}". Must be "repeat" or "interview".`);
  process.exit(1);
}

// ── Load env + DeepSeek ──
function loadEnv() {
  try {
    const envPath = join(__dirname, "..", ".env.local");
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, "utf-8");
      for (const line of envContent.split("\n")) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m && !process.env[m[1].trim()]) {
          process.env[m[1].trim()] = m[2].trim();
        }
      }
    }
  } catch {}
}

async function callDeepSeek(prompt) {
  loadEnv();
  const { callDeepSeekViaCurl } = require("../lib/ai/deepseekHttp.js");
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");

  const systemMsg = TYPE === "repeat"
    ? "You are a TOEFL speaking practice content creator specializing in pronunciation and listening exercises. Return only valid JSON, no markdown fencing."
    : "You are a TOEFL speaking interview question writer. Create natural, progressive interview questions. Return only valid JSON, no markdown fencing.";

  const payload = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 8000,
  };

  const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 90000 });
  const content = typeof result === "string"
    ? result
    : (result?.choices?.[0]?.message?.content || JSON.stringify(result));
  return content;
}

function parseJsonResponse(text) {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  return JSON.parse(cleaned);
}

/**
 * Salvage partial JSON — extract complete objects from truncated array.
 */
function salvagePartialJson(text) {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("[");
  if (start < 0) return [];

  const body = cleaned.slice(start + 1);
  const items = [];
  let depth = 0;
  let objStart = -1;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{" && depth === 0) objStart = i;
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "}" && depth === 0 && objStart >= 0) {
      const chunk = body.slice(objStart, i + 1);
      try { items.push(JSON.parse(chunk)); } catch { /* skip */ }
      objStart = -1;
    }
  }

  return items;
}

// ── Main pipeline ──
async function main() {
  const label = TYPE === "repeat" ? "Listen & Repeat" : "Take an Interview";
  console.log("+" + "=".repeat(54) + "+");
  console.log(`|   Speaking — ${label} Generation Pipeline`.padEnd(55) + "|");
  console.log("+" + "=".repeat(54) + "+\n");
  console.log(`Type: ${TYPE}  Count: ${COUNT}  Dry-run: ${DRY_RUN}\n`);

  // Step 1: Build prompt
  console.log("1. Building prompt...");
  const prompt = TYPE === "repeat"
    ? buildRepeatPrompt(COUNT)
    : buildInterviewPrompt(COUNT);

  if (DRY_RUN) {
    console.log("\n-- PROMPT --\n");
    console.log(prompt);
    return;
  }

  // Step 2: Call DeepSeek
  console.log("2. Calling DeepSeek...");
  let responseText;
  try {
    responseText = await callDeepSeek(prompt);
  } catch (err) {
    console.error("DeepSeek call failed:", err.message);
    process.exit(1);
  }

  if (!responseText || responseText.length < 10) {
    console.error("Empty/short response from DeepSeek");
    process.exit(1);
  }

  let rawItems;
  try {
    rawItems = parseJsonResponse(responseText);
  } catch (err) {
    console.log(`   JSON parse failed: ${err.message}`);
    console.log("   Attempting partial salvage...");
    try {
      const partial = salvagePartialJson(responseText);
      if (partial.length > 0) {
        rawItems = partial;
        console.log(`   Salvaged ${partial.length} complete items from truncated response`);
      } else {
        console.error("   Could not salvage any items. Response (first 500 chars):", responseText.substring(0, 500));
        process.exit(1);
      }
    } catch {
      console.error("   Salvage failed. Response (first 500 chars):", responseText.substring(0, 500));
      process.exit(1);
    }
  }

  if (!Array.isArray(rawItems)) rawItems = [rawItems];
  console.log(`   Received ${rawItems.length} set(s)\n`);

  // Step 3: Validate
  console.log("3. Validating...\n");
  const runId = Date.now();
  const accepted = [];
  const rejected = [];

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    const id = raw.id || `${TYPE === "repeat" ? "rpt" : "intv"}_gen_${runId}_${String(i + 1).padStart(3, "0")}`;

    // Normalize the set
    const set = { ...raw, id };

    if (TYPE === "repeat") {
      // Ensure sentences have IDs
      if (Array.isArray(set.sentences)) {
        set.sentences = set.sentences.map((s, si) => ({
          ...s,
          id: s.id || `${id}_s${si + 1}`,
          word_count: s.word_count || (s.sentence ? s.sentence.trim().split(/\s+/).length : 0),
        }));
      }
      const validation = validateRepeatSet(set);
      if (!validation.pass) {
        rejected.push({ id, reason: validation.errors.join("; ") });
        console.log(`  x ${id}: ${validation.errors.join("; ")}`);
        continue;
      }
      if (validation.warnings.length > 0) {
        console.log(`  ~ ${id} (${set.topic || "?"}): ${validation.warnings.length} warnings`);
        validation.warnings.forEach(w => console.log(`      ${w}`));
      } else {
        console.log(`  + ${id} (${set.topic || "?"}): OK — ${(set.sentences || []).length} sentences`);
      }
    } else {
      // Interview
      if (Array.isArray(set.questions)) {
        set.questions = set.questions.map((q, qi) => ({
          ...q,
          id: q.id || `${id}_q${qi + 1}`,
          word_count: q.word_count || (q.question ? q.question.trim().split(/\s+/).length : 0),
        }));
      }
      const validation = validateInterviewSet(set);
      if (!validation.pass) {
        rejected.push({ id, reason: validation.errors.join("; ") });
        console.log(`  x ${id}: ${validation.errors.join("; ")}`);
        continue;
      }
      if (validation.warnings.length > 0) {
        console.log(`  ~ ${id} (${set.topic || "?"}): ${validation.warnings.length} warnings`);
        validation.warnings.forEach(w => console.log(`      ${w}`));
      } else {
        console.log(`  + ${id} (${set.topic || "?"}): OK — ${(set.questions || []).length} questions`);
      }
    }

    accepted.push(set);
  }

  // Batch validation
  if (accepted.length > 1) {
    const batchResult = validateBatch(accepted, TYPE);
    if (batchResult.warnings.length > 0) {
      console.log("\n  Batch warnings:");
      batchResult.warnings.forEach(w => console.log(`    ~ ${w}`));
    }
  }

  console.log(`\n-- Results --`);
  console.log(`  Accepted: ${accepted.length}/${rawItems.length}`);
  console.log(`  Rejected: ${rejected.length}/${rawItems.length}`);
  console.log(`  Acceptance rate: ${(accepted.length / rawItems.length * 100).toFixed(0)}%`);

  if (accepted.length === 0) {
    console.log("\nNo items accepted.");
    process.exit(1);
  }

  // Step 4: Save to staging
  mkdirSync(STAGING_DIR, { recursive: true });
  const prefix = TYPE === "repeat" ? "rpt" : "intv";
  const stagingFile = join(STAGING_DIR, `${prefix}-${runId}.json`);

  const output = {
    type: TYPE === "repeat" ? "listenAndRepeat" : "takeAnInterview",
    generated_at: new Date().toISOString(),
    total_generated: rawItems.length,
    total_accepted: accepted.length,
    acceptance_rate: +(accepted.length / rawItems.length).toFixed(2),
    items: accepted,
    rejected,
  };

  writeFileSync(stagingFile, JSON.stringify(output, null, 2));
  console.log(`\nStaging file: ${stagingFile}`);

  // Print a sample
  if (accepted.length > 0) {
    const s = accepted[0];
    console.log("\n-- Sample --");
    console.log(`Topic: ${s.topic || "?"}`);
    if (TYPE === "repeat") {
      (s.sentences || []).forEach((sent, i) => {
        console.log(`  S${i + 1} (${sent.difficulty}): ${sent.sentence}`);
      });
    } else {
      (s.questions || []).forEach((q, i) => {
        console.log(`  Q${i + 1} (${q.category}/${q.difficulty}): ${q.question}`);
      });
    }
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
