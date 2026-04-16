#!/usr/bin/env node

/**
 * Generate Speaking practice items — v2
 *
 * Rebuilt based on deep ETS reference analysis (5 repeat + 5 interview reference sets).
 *
 * Usage:
 *   node scripts/generate-speaking.mjs --type repeat    [--count 3] [--with-tts] [--dry-run]
 *   node scripts/generate-speaking.mjs --type interview [--count 3] [--dry-run]
 *
 * Pipeline:
 *   1. Collect existing data for deduplication
 *   2. Build prompt with scenario/topic assignment + reference examples
 *   3. Call DeepSeek to generate sets
 *   4. Three-level validation (schema -> profile -> flavor scoring)
 *   5. Batch-level quality checks
 *   6. (Optional) Generate TTS audio for repeat sentences
 *   7. Save accepted items to staging with full quality metrics
 *
 * Merge staging:
 *   node scripts/generate-speaking.mjs --merge repeat
 *   node scripts/generate-speaking.mjs --merge interview
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { buildRepeatPrompt, SCENARIO_POOL } = require("../lib/speakingGen/repeatPromptBuilder.js");
const { buildInterviewPrompt, TOPIC_POOL } = require("../lib/speakingGen/interviewPromptBuilder.js");
const {
  validateRepeatSet,
  validateInterviewSet,
  validateBatch,
  scoreRepeatFlavor,
  scoreInterviewFlavor,
  REPEAT_TIMING,
} = require("../lib/speakingGen/speakingValidator.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data", "speaking");
const STAGING_DIR = join(DATA_DIR, "staging");
const BANK_DIR = join(DATA_DIR, "bank");

// ── Parse CLI args ──

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const MAX_BATCH = 10;
const TYPE = getArg("type", "repeat"); // "repeat" | "interview"
const COUNT = Math.min(parseInt(getArg("count", "3"), 10), MAX_BATCH);
const DRY_RUN = args.includes("--dry-run");
const WITH_TTS = args.includes("--with-tts");
const MERGE = getArg("merge", null); // "repeat" | "interview"

if (MERGE) {
  await mergeStaging(MERGE);
  process.exit(0);
}

if (!["repeat", "interview"].includes(TYPE)) {
  console.error(`Invalid --type "${TYPE}". Must be "repeat" or "interview".`);
  process.exit(1);
}

// ── Load .env.local ──

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

// ── DeepSeek caller ──

async function callDeepSeek(prompt) {
  const { callDeepSeekViaCurl } = require("../lib/ai/deepseekHttp.js");
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set.");

  const systemMsg = TYPE === "repeat"
    ? "You are an ETS-caliber TOEFL content writer specializing in Listen & Repeat sentences. All sentences are spoken by staff/authority figures. Return only valid JSON, no markdown fencing."
    : "You are an ETS-caliber TOEFL content writer specializing in interview questions. Create progressive, open-ended questions. Return only valid JSON, no markdown fencing.";

  const payload = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: prompt },
    ],
    temperature: 0.75,
    max_tokens: 4096,
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

// ── Collect existing data for deduplication ──

function collectExistingRepeatData() {
  const sentences = [];
  const scenarios = [];
  try {
    const bankFile = join(BANK_DIR, "repeat.json");
    if (existsSync(bankFile)) {
      const bank = JSON.parse(readFileSync(bankFile, "utf-8"));
      for (const set of (bank.items || [])) {
        if (set.scenario) scenarios.push(set.scenario);
        for (const s of (set.sentences || [])) {
          if (s.sentence) sentences.push(s.sentence);
        }
      }
    }
    if (existsSync(STAGING_DIR)) {
      for (const f of readdirSync(STAGING_DIR).filter(f => f.startsWith("rpt-") && f.endsWith(".json"))) {
        const d = JSON.parse(readFileSync(join(STAGING_DIR, f), "utf-8"));
        for (const set of (d.items || [])) {
          if (set.scenario) scenarios.push(set.scenario);
          for (const s of (set.sentences || [])) {
            if (s.sentence) sentences.push(s.sentence);
          }
        }
      }
    }
  } catch {}
  return { sentences, scenarios };
}

function collectExistingInterviewData() {
  const questions = [];
  const topics = [];
  try {
    const bankFile = join(BANK_DIR, "interview.json");
    if (existsSync(bankFile)) {
      const bank = JSON.parse(readFileSync(bankFile, "utf-8"));
      for (const set of (bank.items || [])) {
        if (set.topic) topics.push(set.topic);
        for (const q of (set.questions || [])) {
          if (q.question) questions.push(q.question);
        }
      }
    }
    if (existsSync(STAGING_DIR)) {
      for (const f of readdirSync(STAGING_DIR).filter(f => f.startsWith("intv-") && f.endsWith(".json"))) {
        const d = JSON.parse(readFileSync(join(STAGING_DIR, f), "utf-8"));
        for (const set of (d.items || [])) {
          if (set.topic) topics.push(set.topic);
          for (const q of (set.questions || [])) {
            if (q.question) questions.push(q.question);
          }
        }
      }
    }
  } catch {}
  return { questions, topics };
}

// ── TTS generation for repeat sentences ──

const TTS_VOICE_MAP = {
  easy:   { preset: "lcr_staff_female", rate_override: "-5%" },
  medium: { preset: "lcr_staff_male",   rate_override: "-8%" },
  hard:   { preset: "lcr_campus_female", rate_override: "-12%" },
};

async function generateRepeatTTS(set) {
  if (!WITH_TTS) return;
  try {
    const { generateSpeech } = require("../lib/tts/edgeTts.js");
    const { uploadAudio } = require("../lib/tts/storage.js");

    for (const s of (set.sentences || [])) {
      const voiceCfg = TTS_VOICE_MAP[s.difficulty] || TTS_VOICE_MAP.medium;
      const buffer = await generateSpeech(s.sentence, {
        preset: voiceCfg.preset,
        rate: voiceCfg.rate_override,
        format: "mp3",
      });
      console.log(`      TTS [${voiceCfg.preset}/${s.difficulty}] ${buffer.length} bytes`);
      const audioPath = `speaking/repeat/${s.id || set.id + "_s"}.mp3`;
      const result = await uploadAudio(audioPath, buffer);
      s.audio_url = result.url;
    }
  } catch (err) {
    console.log(`      TTS failed: ${err.message}`);
  }
}

// ── Merge staging into bank ──

async function mergeStaging(type) {
  const prefix = type === "repeat" ? "rpt" : "intv";
  const bankFile = join(BANK_DIR, type === "repeat" ? "repeat.json" : "interview.json");

  console.log(`\nMerging ${type} staging into bank...\n`);

  // Load existing bank
  let bank = { type: type === "repeat" ? "listenAndRepeat" : "takeAnInterview", version: 2, items: [] };
  if (existsSync(bankFile)) {
    bank = JSON.parse(readFileSync(bankFile, "utf-8"));
  }

  // Collect staging files
  if (!existsSync(STAGING_DIR)) {
    console.log("No staging directory found.");
    return;
  }
  const stagingFiles = readdirSync(STAGING_DIR)
    .filter(f => f.startsWith(`${prefix}-`) && f.endsWith(".json"))
    .sort();

  if (stagingFiles.length === 0) {
    console.log("No staging files to merge.");
    return;
  }

  let added = 0;
  const existingIds = new Set((bank.items || []).map(item => item.id));

  for (const f of stagingFiles) {
    const data = JSON.parse(readFileSync(join(STAGING_DIR, f), "utf-8"));
    for (const item of (data.items || [])) {
      if (!existingIds.has(item.id)) {
        bank.items.push(item);
        existingIds.add(item.id);
        added++;
      }
    }
    console.log(`  + ${f}: ${(data.items || []).length} items`);
  }

  bank.updated_at = new Date().toISOString();
  bank.total_items = bank.items.length;

  mkdirSync(BANK_DIR, { recursive: true });
  writeFileSync(bankFile, JSON.stringify(bank, null, 2));
  console.log(`\nMerged ${added} new items. Bank total: ${bank.items.length}`);
  console.log(`Bank file: ${bankFile}`);
  console.log(`\nYou can now delete staging files if satisfied.`);
}

// ── Main pipeline ──

async function main() {
  const label = TYPE === "repeat" ? "Listen & Repeat" : "Take an Interview";
  console.log("+========================================================+");
  console.log(`|   Speaking v2 -- ${label} Generation Pipeline`.padEnd(57) + "|");
  console.log("+========================================================+\n");
  console.log(`Type: ${TYPE}  Count: ${COUNT}  TTS: ${WITH_TTS}  Dry-run: ${DRY_RUN}\n`);

  loadEnv();

  // Step 1: Collect existing data for dedup
  let existingData;
  if (TYPE === "repeat") {
    existingData = collectExistingRepeatData();
    if (existingData.sentences.length > 0) {
      console.log(`   Found ${existingData.sentences.length} existing sentences, ${existingData.scenarios.length} scenarios\n`);
    }
  } else {
    existingData = collectExistingInterviewData();
    if (existingData.questions.length > 0) {
      console.log(`   Found ${existingData.questions.length} existing questions, ${existingData.topics.length} topics\n`);
    }
  }

  // Step 2: Build prompt
  console.log("1. Building prompt...");
  let promptResult;
  if (TYPE === "repeat") {
    promptResult = buildRepeatPrompt(COUNT, {
      excludeScenarios: existingData.scenarios,
    });
    console.log(`   Scenarios: ${promptResult.scenarios.join(", ")}`);
  } else {
    promptResult = buildInterviewPrompt(COUNT, {
      excludeTopics: existingData.topics,
    });
    console.log(`   Topics: ${promptResult.topics.join(", ")}`);
  }

  if (DRY_RUN) {
    console.log("\n-- PROMPT (dry-run) --\n");
    console.log(promptResult.prompt);
    console.log("\n-- END PROMPT --");
    return;
  }

  // Step 3: Call DeepSeek
  console.log("\n2. Calling DeepSeek...");
  let responseText;
  try {
    responseText = await callDeepSeek(promptResult.prompt);
  } catch (err) {
    console.error("   DeepSeek call failed:", err.message);
    process.exit(1);
  }

  if (!responseText || responseText.length < 10) {
    console.error("   Empty/short response from DeepSeek");
    process.exit(1);
  }

  let rawItems;
  try {
    rawItems = parseJsonResponse(responseText);
  } catch (err) {
    console.log(`   JSON parse failed: ${err.message}`);
    console.log("   Attempting partial salvage...");
    rawItems = salvagePartialJson(responseText);
    if (rawItems.length === 0) {
      console.error("   Could not salvage any items. Response (first 500 chars):");
      console.error("   " + responseText.substring(0, 500));
      process.exit(1);
    }
    console.log(`   Salvaged ${rawItems.length} complete items`);
  }
  if (!Array.isArray(rawItems)) rawItems = [rawItems];
  console.log(`   Received ${rawItems.length} set(s)\n`);

  // Step 4: Three-level validation
  console.log("3. Validating (schema -> profile -> flavor)...\n");
  const timestamp = Date.now();
  const accepted = [];
  const rejected = [];

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    const prefix = TYPE === "repeat" ? "rpt" : "intv";
    const id = raw.id || `${prefix}_v2_${timestamp}_${String(i + 1).padStart(3, "0")}`;
    const set = { ...raw, id };

    if (TYPE === "repeat") {
      // Normalize sentences
      if (Array.isArray(set.sentences)) {
        set.sentences = set.sentences.map((s, si) => ({
          ...s,
          id: s.id || `${id}_s${si + 1}`,
          word_count: s.word_count || (s.sentence ? s.sentence.trim().split(/\s+/).length : 0),
          timing_seconds: s.timing_seconds || REPEAT_TIMING[s.difficulty] || 10,
        }));
      }

      const result = validateRepeatSet(set);
      if (!result.valid) {
        rejected.push({ id, reason: result.errors.join("; ") });
        console.log(`  x ${id}: ${result.errors.join("; ")}`);
        continue;
      }

      const flavorStr = result.flavor ? `flavor=${result.flavor.total}` : "";
      const scenario = set.scenario || "?";
      if (result.warnings.length > 0) {
        console.log(`  ~ ${id} [${scenario}] ${flavorStr}: ${result.warnings.length} warnings`);
        for (const w of result.warnings) console.log(`      ${w}`);
      } else {
        console.log(`  + ${id} [${scenario}] ${flavorStr}: OK -- ${(set.sentences || []).length} sentences`);
      }
      set._flavor = result.flavor;
      accepted.push(set);

    } else {
      // Interview: normalize questions
      if (Array.isArray(set.questions)) {
        set.questions = set.questions.map((q, qi) => ({
          ...q,
          id: q.id || `${id}_q${qi + 1}`,
          position: q.position || `Q${qi + 1}`,
          word_count: q.word_count || (q.question ? q.question.trim().split(/\s+/).length : 0),
        }));
      }

      const result = validateInterviewSet(set);
      if (!result.valid) {
        rejected.push({ id, reason: result.errors.join("; ") });
        console.log(`  x ${id}: ${result.errors.join("; ")}`);
        continue;
      }

      const flavorStr = result.flavor ? `flavor=${result.flavor.total}` : "";
      const topic = set.topic || "?";
      if (result.warnings.length > 0) {
        console.log(`  ~ ${id} [${topic}] ${flavorStr}: ${result.warnings.length} warnings`);
        for (const w of result.warnings) console.log(`      ${w}`);
      } else {
        console.log(`  + ${id} [${topic}] ${flavorStr}: OK -- ${(set.questions || []).length} questions`);
      }
      set._flavor = result.flavor;
      accepted.push(set);
    }
  }

  // Step 5: Batch quality checks
  if (accepted.length > 1) {
    const batchResult = validateBatch(accepted, TYPE);
    console.log(`\n-- Batch Quality --`);
    console.log(`  Avg flavor score: ${batchResult.avgFlavor} ${batchResult.avgFlavor >= 0.65 ? "OK" : batchResult.avgFlavor >= 0.45 ? "WARN" : "LOW"} (target >= 0.65)`);
    if (batchResult.stats.difficulty_distribution) {
      console.log(`  Difficulty dist: ${JSON.stringify(batchResult.stats.difficulty_distribution)}`);
    }
    if (batchResult.stats.category_distribution) {
      console.log(`  Category dist: ${JSON.stringify(batchResult.stats.category_distribution)}`);
    }
    if (batchResult.warnings.length > 0) {
      console.log("  Batch warnings:");
      for (const w of batchResult.warnings) console.log(`    ~ ${w}`);
    }
  }

  console.log(`\n-- Results --`);
  console.log(`  Accepted: ${accepted.length}/${rawItems.length}`);
  console.log(`  Rejected: ${rejected.length}/${rawItems.length}`);
  console.log(`  Acceptance rate: ${rawItems.length > 0 ? Math.round(accepted.length / rawItems.length * 100) : 0}%`);

  if (accepted.length === 0) {
    console.log("\nNo items accepted.");
    process.exit(1);
  }

  // Step 6: Optional TTS for repeat
  if (WITH_TTS && TYPE === "repeat" && accepted.length > 0) {
    console.log("\n4. Generating TTS audio...\n");
    for (const set of accepted) {
      console.log(`   Set ${set.id} (${set.scenario || "?"}):`);
      await generateRepeatTTS(set);
    }
  }

  // Step 7: Save to staging
  mkdirSync(STAGING_DIR, { recursive: true });
  const prefix = TYPE === "repeat" ? "rpt" : "intv";
  const stagingFile = join(STAGING_DIR, `${prefix}-${timestamp}.json`);

  // Compute batch stats for metadata
  const batchStats = accepted.length > 1
    ? validateBatch(accepted, TYPE)
    : { avgFlavor: accepted[0]?._flavor?.total || 0, warnings: [], stats: {} };

  const output = {
    type: TYPE === "repeat" ? "listenAndRepeat" : "takeAnInterview",
    version: 2,
    generated_at: new Date().toISOString(),
    total_generated: rawItems.length,
    total_accepted: accepted.length,
    acceptance_rate: Math.round(accepted.length / rawItems.length * 100) / 100,
    tts_generated: WITH_TTS && TYPE === "repeat",
    batch_quality: {
      avg_flavor: batchStats.avgFlavor,
      ...batchStats.stats,
    },
    items: accepted.map(item => {
      const { _flavor, ...rest } = item;
      return { ...rest, flavor_score: _flavor?.total };
    }),
    rejected,
  };

  writeFileSync(stagingFile, JSON.stringify(output, null, 2));
  console.log(`\nStaging file: ${stagingFile}`);

  // Print a sample
  if (accepted.length > 0) {
    const s = accepted[0];
    console.log(`\n-- Sample --`);
    if (TYPE === "repeat") {
      console.log(`Scenario: ${s.scenario || "?"} | Role: ${s.speaker_role || "?"} | Flavor: ${s._flavor?.total}`);
      (s.sentences || []).forEach((sent, i) => {
        console.log(`  S${i + 1} (${sent.difficulty}, ${sent.timing_seconds}s): ${sent.sentence}`);
      });
    } else {
      console.log(`Topic: ${s.topic || "?"} | Category: ${s.category || "?"} | Flavor: ${s._flavor?.total}`);
      console.log(`Intro: ${s.intro || "?"}`);
      (s.questions || []).forEach((q, i) => {
        console.log(`  ${q.position} (${q.difficulty}): ${q.question}`);
      });
    }
  }

  // Quality report summary
  console.log("\n+------ Quality Report ------+");
  console.log(`| Type:       ${TYPE.padEnd(16)}|`);
  console.log(`| Generated:  ${String(rawItems.length).padEnd(16)}|`);
  console.log(`| Accepted:   ${String(accepted.length).padEnd(16)}|`);
  console.log(`| Rejected:   ${String(rejected.length).padEnd(16)}|`);
  console.log(`| Avg Flavor: ${String(batchStats.avgFlavor).padEnd(16)}|`);
  console.log(`| TTS:        ${String(WITH_TTS && TYPE === "repeat").padEnd(16)}|`);
  console.log("+----------------------------+");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
