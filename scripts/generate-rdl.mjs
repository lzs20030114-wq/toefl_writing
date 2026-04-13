#!/usr/bin/env node

/**
 * Generate Read in Daily Life questions using DeepSeek.
 *
 * Usage: node scripts/generate-rdl.mjs [--count 5] [--genre email] [--dry-run]
 *
 * Pipeline:
 *   1. Build prompt with genre specs + ETS flavor constraints
 *   2. Call DeepSeek to generate text + questions
 *   3. Validate items individually + as batch
 *   4. Save accepted items to staging
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { buildRDLPrompt } = require("../lib/readingGen/rdlPromptBuilder.js");
const { validateRDLItem, validateRDLBatch } = require("../lib/readingGen/rdlValidator.js");
const { auditRDLItem } = require("../lib/readingGen/answerAuditor.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING_DIR = join(__dirname, "..", "data", "reading", "staging");

// ── Parse CLI args ──
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const MAX_BATCH = 10; // DeepSeek truncates JSON for large batches
const COUNT = Math.min(parseInt(getArg("count", "5"), 10), MAX_BATCH);
const GENRE = getArg("genre", "");
const DRY_RUN = args.includes("--dry-run");

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

  const payload = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "You are a TOEFL reading question writer specializing in daily-life campus scenarios. Return only valid JSON, no markdown fencing." },
      { role: "user", content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 8000,
  };

  const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 90000 });
  const content = typeof result === "string" ? result : (result?.choices?.[0]?.message?.content || JSON.stringify(result));
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
 * Attempt to extract complete JSON objects from a truncated array.
 * Splits by top-level "},{" boundaries and parses each chunk individually.
 */
function salvagePartialJson(text) {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("[");
  if (start < 0) return [];

  const body = cleaned.slice(start + 1); // remove opening [
  const items = [];

  // Find each complete top-level object by tracking brace depth
  let depth = 0;
  let objStart = -1;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{" && depth === 0) objStart = i;
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "}" && depth === 0 && objStart >= 0) {
      const chunk = body.slice(objStart, i + 1);
      try {
        items.push(JSON.parse(chunk));
      } catch { /* skip malformed */ }
      objStart = -1;
    }
  }

  return items;
}

function countWords(text) { return text.trim().split(/\s+/).filter(Boolean).length; }

// ── Main pipeline ──
async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   Read in Daily Life — Generation Pipeline      ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`Count: ${COUNT}  Genre: ${GENRE || "(mixed)"}  Dry-run: ${DRY_RUN}\n`);

  // Step 1: Build prompt
  console.log("1. Building prompt...");
  const genres = GENRE ? [GENRE] : [];
  const prompt = buildRDLPrompt(COUNT, { genres });

  if (DRY_RUN) {
    console.log("\n── PROMPT ──\n");
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
    // Try to salvage partial JSON — extract whatever complete items we got
    console.log(`   JSON parse failed: ${err.message}`);
    console.log("   Attempting partial salvage...");
    try {
      const partialItems = salvagePartialJson(responseText);
      if (partialItems.length > 0) {
        rawItems = partialItems;
        console.log(`   Salvaged ${partialItems.length} complete items from truncated response`);
      } else {
        console.error("   Could not salvage any items. Response (first 500 chars):", responseText.substring(0, 500));
        process.exit(1);
      }
    } catch {
      console.error("   Salvage failed too. Response (first 500 chars):", responseText.substring(0, 500));
      process.exit(1);
    }
  }

  console.log(`   Received ${rawItems.length} items\n`);

  // Step 3: Validate
  console.log("3. Validating...\n");
  const runId = Date.now();
  const accepted = [];
  const rejected = [];

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    const id = `rdl_gen_${runId}_${String(i + 1).padStart(3, "0")}`;

    // Add computed fields
    const item = {
      id,
      text: raw.text || "",
      word_count: raw.text ? countWords(raw.text) : 0,
      genre: raw.genre || "other",
      format_metadata: raw.format_metadata || {},
      questions: (raw.questions || []).map((q, qi) => ({
        qid: `${id}_q${qi + 1}`,
        question_type: q.question_type || "detail",
        stem: q.stem || "",
        options: q.options || {},
        correct_answer: q.correct_answer || "A",
        explanation: q.explanation || "",
      })),
      question_count: (raw.questions || []).length,
      difficulty: raw.difficulty || "easy",
    };

    const validation = validateRDLItem(item);

    if (!validation.pass) {
      rejected.push({ id, reason: validation.errors.join("; ") });
      console.log(`  ✗ ${id} (${item.genre}): ${validation.errors.join("; ")}`);
      continue;
    }

    if (validation.warnings.length > 0) {
      console.log(`  ⚠ ${id} (${item.genre}, ${item.word_count}w): ${validation.warnings.length} warnings`);
      validation.warnings.forEach(w => console.log(`      ${w}`));
    } else {
      console.log(`  ✓ ${id} (${item.genre}, ${item.word_count}w): OK`);
    }

    accepted.push(item);
  }

  // Batch validation
  if (accepted.length > 0) {
    const batchResult = validateRDLBatch(accepted);
    if (batchResult.warnings.length > 0) {
      console.log("\n  Batch warnings:");
      batchResult.warnings.forEach(w => console.log(`    ⚠ ${w}`));
    }
    console.log(`  Answer distribution: A=${batchResult.answerDistribution.A} B=${batchResult.answerDistribution.B} C=${batchResult.answerDistribution.C} D=${batchResult.answerDistribution.D}`);
  }

  console.log(`\n── Results ──`);
  console.log(`  Accepted: ${accepted.length}/${rawItems.length}`);
  console.log(`  Rejected: ${rejected.length}/${rawItems.length}`);
  console.log(`  Acceptance rate: ${(accepted.length / rawItems.length * 100).toFixed(0)}%`);

  if (accepted.length === 0) {
    console.log("\nNo items accepted.");
    process.exit(1);
  }

  // Step 4: AI Answer Audit
  const SKIP_AUDIT = args.includes("--skip-audit");
  if (!SKIP_AUDIT) {
    console.log("\n4. Running AI answer audit...\n");
    const audited = [];
    for (const item of accepted) {
      const audit = await auditRDLItem(item);
      if (audit.error) {
        console.log(`  ⚠ ${item.id}: audit error — ${audit.error}`);
        item._audit = { error: audit.error };
        audited.push(item);
        continue;
      }

      const icon = audit.criticalFlags > 0 ? "🔴" : "✅";
      console.log(`  ${icon} ${item.id}: ${audit.matches}/${audit.totalQuestions} match` +
        (audit.criticalFlags ? ` | ${audit.criticalFlags} CRITICAL` : "") +
        (audit.guessable ? ` | ${audit.guessable} guessable` : ""));

      audit.results.forEach(r => {
        r.flags.filter(f => f.severity === "critical").forEach(f => {
          console.log(`      🔴 ${f.type}: ${f.detail.substring(0, 100)}`);
        });
      });

      if (audit.criticalFlags > 0) {
        // Mark the specific questions that have mismatches
        item._audit = { status: "flagged", mismatches: audit.mismatches, details: audit.results.filter(r => !r.match) };
        item._auditFlagged = true;
      } else {
        item._audit = { status: "passed", accuracy: audit.matches + "/" + audit.totalQuestions };
      }
      audited.push(item);
    }

    const flagged = audited.filter(i => i._auditFlagged);
    const clean = audited.filter(i => !i._auditFlagged);
    console.log(`\n  Audit result: ${clean.length} clean, ${flagged.length} flagged`);
    accepted.length = 0;
    accepted.push(...clean); // Only keep clean items
    if (flagged.length > 0) {
      console.log(`  ⚠ ${flagged.length} items removed due to answer mismatches`);
    }
  }

  // Step 5: Save to staging
  mkdirSync(STAGING_DIR, { recursive: true });
  const stagingFile = join(STAGING_DIR, `rdl-${runId}.json`);

  const output = {
    type: "readInDailyLife",
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
    console.log("\n── Sample ──");
    console.log(`Genre: ${s.genre} | Words: ${s.word_count}`);
    console.log(`Text: ${s.text.substring(0, 150)}...`);
    s.questions.forEach((q, i) => {
      console.log(`  Q${i+1} (${q.question_type}): ${q.stem}`);
      console.log(`    Answer: ${q.correct_answer}. ${q.options[q.correct_answer]}`);
    });
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
