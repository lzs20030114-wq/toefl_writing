#!/usr/bin/env node

/**
 * Generate Complete the Words questions using DeepSeek.
 *
 * Usage: node scripts/generate-ctw.mjs [--count 10] [--difficulty medium] [--dry-run]
 *
 * Pipeline:
 *   1. Build prompt with ETS flavor constraints
 *   2. Call DeepSeek to generate passages
 *   3. Apply C-test blanking algorithm (mechanical, no AI)
 *   4. Validate against ETS profile
 *   5. Save accepted items to staging
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { buildCTWPrompt } = require("../lib/readingGen/ctwPromptBuilder.js");
const { processPassage } = require("../lib/readingGen/cTestBlanker.js");
const { validateCTWItem } = require("../lib/readingGen/ctwValidator.js");
const { estimateDifficulty } = require("../lib/readingGen/ctwDifficulty.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING_DIR = join(__dirname, "..", "data", "reading", "staging");

// ── Parse CLI args ──
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const COUNT = parseInt(getArg("count", "10"), 10);
// Difficulty is now calculated post-hoc from blank words — prompt always uses "medium"
const DIFFICULTY = "medium";
const DRY_RUN = args.includes("--dry-run");

// ── DeepSeek caller ──
async function callDeepSeek(prompt) {
  const { callDeepSeekViaCurl } = require("../lib/ai/deepseekHttp.js");

  // Load .env.local if available
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

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY not set. Add it to .env.local or export it.");
  }

  const payload = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "You are a TOEFL academic passage writer. Return only valid JSON, no markdown fencing." },
      { role: "user", content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 4000,
  };

  const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 60000 });

  // callDeepSeekViaCurl returns the content string directly (or an object)
  const content = typeof result === "string" ? result : (result?.choices?.[0]?.message?.content || JSON.stringify(result));
  return { content };
}

function parseJsonResponse(text) {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  return JSON.parse(cleaned);
}

function salvagePartialJson(text) {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("[");
  if (start < 0) return [];
  const body = cleaned.slice(start + 1);
  const items = [];
  let depth = 0, objStart = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{" && depth === 0) objStart = i;
    if (body[i] === "{") depth++;
    if (body[i] === "}") depth--;
    if (body[i] === "}" && depth === 0 && objStart >= 0) {
      try { items.push(JSON.parse(body.slice(objStart, i + 1))); } catch {}
      objStart = -1;
    }
  }
  return items;
}

// ── Main pipeline ──
async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   Complete the Words — Generation Pipeline  ║");
  console.log("╚══════════════════════════════════════════════╝\n");
  console.log(`Count: ${COUNT}  Difficulty: ${DIFFICULTY}  Dry-run: ${DRY_RUN}\n`);

  // Step 1: Build prompt (with deduplication)
  console.log("1. Building prompt...");

  // Collect subjects from existing staging files to avoid repetition
  const existingSubjects = [];
  try {
    const stagingFiles = readdirSync(STAGING_DIR).filter(f => f.startsWith("ctw-") && f.endsWith(".json"));
    for (const f of stagingFiles) {
      const d = JSON.parse(readFileSync(join(STAGING_DIR, f), "utf-8"));
      (d.items || []).forEach(item => {
        const first = item.passage.split(/[.!?]/)[0].trim();
        const match = first.match(/^(.+?)\s+(?:is|are|has|have|was|were)\b/i);
        const subject = match ? match[1].replace(/^the\s+/i, "").trim() : first.split(/\s+/).slice(0, 4).join(" ");
        existingSubjects.push(subject);
      });
    }
  } catch {}
  if (existingSubjects.length > 0) {
    console.log(`   Excluding ${existingSubjects.length} existing subjects: ${existingSubjects.slice(0, 5).join(", ")}${existingSubjects.length > 5 ? "..." : ""}`);
  }

  const prompt = buildCTWPrompt(COUNT, { difficulty: DIFFICULTY, excludeSubjects: existingSubjects });

  if (DRY_RUN) {
    console.log("\n── PROMPT (dry-run) ──\n");
    console.log(prompt);
    console.log("\n── END PROMPT ──");
    return;
  }

  // Step 2: Call DeepSeek
  console.log("2. Calling DeepSeek...");
  let rawResponse;
  try {
    rawResponse = await callDeepSeek(prompt);
  } catch (err) {
    console.error("DeepSeek call failed:", err.message);
    process.exit(1);
  }

  const responseText = rawResponse?.content || rawResponse?.choices?.[0]?.message?.content || "";
  if (!responseText) {
    console.error("Empty response from DeepSeek");
    process.exit(1);
  }

  let passages;
  try {
    passages = parseJsonResponse(responseText);
  } catch (err) {
    console.log(`   JSON parse failed: ${err.message}. Attempting salvage...`);
    try {
      passages = salvagePartialJson(responseText);
      if (passages.length > 0) {
        console.log(`   Salvaged ${passages.length} items from truncated response`);
      } else {
        console.error("   No items salvaged. Response:", responseText.substring(0, 500));
        process.exit(1);
      }
    } catch {
      console.error("   Salvage failed. Response:", responseText.substring(0, 500));
      process.exit(1);
    }
  }

  console.log(`   Received ${passages.length} passages\n`);

  // Step 3: Apply C-test blanking + validate
  console.log("3. Processing & validating...\n");
  const accepted = [];
  const rejected = [];
  const runId = Date.now();

  for (let i = 0; i < passages.length; i++) {
    const raw = passages[i];
    const id = `ctw_gen_${runId}_${String(i + 1).padStart(3, "0")}`;

    // Apply blanking
    const { item, error: blankError } = processPassage(raw, id);
    if (blankError) {
      rejected.push({ id, reason: `blanking: ${blankError}`, raw });
      console.log(`  ✗ ${id}: ${blankError}`);
      continue;
    }

    // Validate against ETS profile
    const validation = validateCTWItem(item);
    if (!validation.pass) {
      rejected.push({ id, reason: validation.errors.join("; "), raw, warnings: validation.warnings });
      console.log(`  ✗ ${id}: ${validation.errors.join("; ")}`);
      continue;
    }

    // Estimate difficulty from blank words (not from prompt)
    const diffResult = estimateDifficulty(item);
    item.difficulty = diffResult.difficulty;
    item._diffScore = diffResult.score;

    if (validation.warnings.length > 0) {
      console.log(`  ⚠ ${id} [${diffResult.difficulty} ${diffResult.score}]: OK (${validation.warnings.length} warnings: ${validation.warnings.join(", ")})`);
    } else {
      console.log(`  ✓ ${id} [${diffResult.difficulty} ${diffResult.score}]: OK`);
    }

    accepted.push({ ...item, _warnings: validation.warnings });
  }

  // Difficulty distribution
  const diffDist = { easy: 0, medium: 0, hard: 0 };
  accepted.forEach(i => diffDist[i.difficulty]++);

  console.log(`\n── Results ──`);
  console.log(`  Accepted: ${accepted.length}/${passages.length}`);
  console.log(`  Rejected: ${rejected.length}/${passages.length}`);
  console.log(`  Acceptance rate: ${(accepted.length / passages.length * 100).toFixed(0)}%`);
  console.log(`  Difficulty: easy=${diffDist.easy} medium=${diffDist.medium} hard=${diffDist.hard}`);

  if (accepted.length === 0) {
    console.log("\nNo items accepted. Check rejections above.");
    process.exit(1);
  }

  // Step 4: Save to staging
  mkdirSync(STAGING_DIR, { recursive: true });
  const stagingFile = join(STAGING_DIR, `ctw-${runId}.json`);

  const output = {
    type: "completeTheWords",
    generated_at: new Date().toISOString(),
    difficulty: DIFFICULTY,
    total_generated: passages.length,
    total_accepted: accepted.length,
    acceptance_rate: +(accepted.length / passages.length).toFixed(2),
    items: accepted.map(({ _warnings, ...item }) => item),
    rejected: rejected.map(({ raw, ...r }) => r),
  };

  writeFileSync(stagingFile, JSON.stringify(output, null, 2));
  console.log(`\nStaging file: ${stagingFile}`);

  // Print a sample
  if (accepted.length > 0) {
    const sample = accepted[0];
    console.log("\n── Sample (first accepted item) ──");
    console.log(`Topic: ${sample.topic} / ${sample.subtopic}`);
    console.log(`Words: ${sample.word_count}`);
    console.log(`Passage: ${sample.passage.substring(0, 200)}...`);
    console.log(`Blanked: ${sample.blanked_text.substring(0, 200)}...`);
    console.log(`Blanks: ${sample.blanks.map(b => `${b.displayed_fragment}→${b.original_word}`).join(", ")}`);
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
