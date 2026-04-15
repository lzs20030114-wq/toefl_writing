#!/usr/bin/env node

/**
 * Generate Listen to an Academic Talk (LAT) questions -- v2
 *
 * Rebuilt based on deep analysis of 11 reference samples.
 *
 * Usage: node scripts/generate-lat.mjs [--count 2] [--with-tts] [--dry-run]
 *        [--difficulty easy|medium|hard] [--skip-audit] [--tts-provider edge|openai]
 *
 * Pipeline:
 *   1. Collect existing topics for deduplication
 *   2. Build prompt with pre-assigned answer positions, difficulty tiers, Q types
 *   3. Call DeepSeek to generate items (batch size <=3 due to heavy token cost)
 *   4. Three-level validation (schema -> profile -> flavor scoring)
 *   5. Batch-level quality checks (answer dist, register metrics, etc.)
 *   6. AI Audit -- independent answer verification (3-layer ambiguity defense)
 *   7. (Optional) Generate TTS audio with lecture voice
 *   8. Save accepted items to staging with full quality metrics
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { buildLATPrompt } = require("../lib/listeningGen/latPromptBuilder.js");
const { validateLAT, validateBatch, scoreFlavor } = require("../lib/listeningGen/latValidator.js");
const { auditLATBatch } = require("../lib/listeningGen/latAuditor.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING_DIR = join(__dirname, "..", "data", "listening", "staging");
const BANK_DIR = join(__dirname, "..", "data", "listening", "bank");

// -- Parse CLI args ------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const COUNT = Math.min(parseInt(getArg("count", "2"), 10), 3); // max 3 per batch (lectures are very token-heavy)
const DRY_RUN = args.includes("--dry-run");
const WITH_TTS = args.includes("--with-tts");
const SKIP_AUDIT = args.includes("--skip-audit");
const DIFFICULTY = getArg("difficulty", null);
const TTS_PROVIDER = getArg("tts-provider", "edge");

// -- Load .env.local -----------------------------------------------------
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

// -- DeepSeek caller -----------------------------------------------------
async function callDeepSeek(prompt, opts = {}) {
  const { callDeepSeekViaCurl } = require("../lib/ai/deepseekHttp.js");

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set. Add it to .env.local or export it.");

  const payload = {
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "You are an ETS-caliber TOEFL question writer specializing in academic lecture listening items. Return only valid JSON, no markdown fencing.",
      },
      { role: "user", content: prompt },
    ],
    temperature: opts.temperature || 0.75,
    max_tokens: opts.maxTokens || 8192,
  };

  const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 180000 });
  const content = typeof result === "string"
    ? result
    : (result?.choices?.[0]?.message?.content || JSON.stringify(result));
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

// -- Collect existing topics for deduplication --------------------------
function collectExistingTopics() {
  const topics = [];
  try {
    const bankFile = join(BANK_DIR, "lat.json");
    if (existsSync(bankFile)) {
      const bank = JSON.parse(readFileSync(bankFile, "utf-8"));
      (bank.items || []).forEach(item => {
        if (item.topic) topics.push(item.topic);
      });
    }
    if (existsSync(STAGING_DIR)) {
      for (const f of readdirSync(STAGING_DIR).filter(f => f.startsWith("lat-") && f.endsWith(".json"))) {
        const d = JSON.parse(readFileSync(join(STAGING_DIR, f), "utf-8"));
        (d.items || []).forEach(item => {
          if (item.topic) topics.push(item.topic);
        });
      }
    }
  } catch {}
  return topics;
}

// -- TTS generation with lecture voice ----------------------------------

async function generateTTS(item, id) {
  if (!WITH_TTS) return null;
  try {
    // Alternate between lecture_male and lecture_female
    const presetIndex = parseInt(id.split("_").pop(), 10) || 0;
    const preset = presetIndex % 2 === 0 ? "lecture_male" : "lecture_female";

    let buffer;
    if (TTS_PROVIDER === "openai") {
      const { generateSpeech } = require("../lib/tts/openaiTts.js");
      buffer = await generateSpeech(item.transcript, { preset, format: "mp3" });
    } else {
      const { generateSpeech } = require("../lib/tts/edgeTts.js");
      buffer = await generateSpeech(item.transcript, { preset, format: "mp3" });
    }

    console.log(`   [TTS ${TTS_PROVIDER}] ${buffer.length} bytes, preset: ${preset}`);

    const { uploadAudio } = require("../lib/tts/storage.js");
    const result = await uploadAudio(`lecture/${id}.mp3`, buffer);
    return result.url;
  } catch (err) {
    console.log(`   TTS failed for ${id}: ${err.message}`);
    return null;
  }
}

// -- Main pipeline -------------------------------------------------------
async function main() {
  console.log("");
  console.log("+==========================================================+");
  console.log("|  LAT v2 -- ETS-Calibrated Academic Talk Generation       |");
  console.log("+==========================================================+");
  console.log("");
  console.log(`Count: ${COUNT}  Difficulty: ${DIFFICULTY || "mixed (30/45/25)"}  TTS: ${WITH_TTS ? TTS_PROVIDER : "off"}  Dry-run: ${DRY_RUN}  Audit: ${!SKIP_AUDIT}`);
  console.log("");

  loadEnv();

  // Step 1: Collect existing data for dedup
  const existingTopics = collectExistingTopics();
  if (existingTopics.length > 0) {
    console.log(`   Excluding ${existingTopics.length} existing lecture topics`);
    console.log("");
  }

  // Step 2: Build prompt
  console.log("1. Building prompt...");
  const prompt = buildLATPrompt(COUNT, {
    excludeTopics: existingTopics,
    difficultyOverride: DIFFICULTY,
  });

  if (DRY_RUN) {
    console.log("\n-- PROMPT (dry-run) --\n");
    console.log(prompt);
    console.log("\n-- END PROMPT --");
    return;
  }

  // Step 3: Call DeepSeek
  console.log("2. Calling DeepSeek...");
  let rawResponse;
  try {
    rawResponse = await callDeepSeek(prompt);
  } catch (err) {
    console.error("   DeepSeek call failed:", err.message);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = parseJsonResponse(rawResponse.content);
  } catch {
    console.log("   JSON parse failed, attempting salvage...");
    parsed = salvagePartialJson(rawResponse.content);
  }
  console.log(`   Received ${parsed.length} items`);
  console.log("");

  // Step 4: Three-level validation
  console.log("3. Validating (schema -> profile -> flavor)...");
  console.log("");
  const accepted = [];
  const rejected = [];
  const timestamp = Date.now();

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    const id = `lat_v2_${timestamp}_${String(i + 1).padStart(3, "0")}`;
    item.id = id;

    const result = validateLAT(item);

    if (!result.valid) {
      const reasons = result.errors.join("; ");
      console.log(`  X ${id}: REJECTED -- ${reasons}`);
      rejected.push({ ...item, rejection_reasons: result.errors });
    } else {
      const flavorStr = result.flavor ? `flavor=${result.flavor.total}` : "";
      const diff = item.difficulty || "?";
      const subj = item.subject || "?";
      const words = wc(item.transcript || "");
      const qTypes = item.questions.map(q => q.type || "?").join(",");

      if (result.warnings.length > 0) {
        console.log(`  ~ ${id} [${diff}/${subj}] ${words}w Q:${qTypes} ${flavorStr}: ${result.warnings.length} warnings`);
        for (const w of result.warnings) console.log(`      ${w}`);
      } else {
        console.log(`  + ${id} [${diff}/${subj}] ${words}w Q:${qTypes} ${flavorStr}`);
      }
      item._flavor = result.flavor;
      accepted.push(item);
    }
  }

  // Step 5: Batch-level quality checks
  if (accepted.length > 0) {
    const batch = validateBatch(accepted);
    console.log("");
    console.log("-- Batch Quality --");
    console.log(`  Answer distribution: A=${batch.distribution.A} B=${batch.distribution.B} C=${batch.distribution.C} D=${batch.distribution.D} ${batch.balanced ? "OK" : "UNBALANCED"}`);
    console.log(`  Avg flavor score: ${batch.avgFlavor} ${batch.avgFlavor >= 0.65 ? "OK" : batch.avgFlavor >= 0.45 ? "~" : "LOW"} (target >= 0.65)`);
    console.log(`  Q type dist: ${JSON.stringify(batch.qTypeDist)}`);
    console.log(`  Subject dist: ${JSON.stringify(batch.subjectDist)}`);
    console.log(`  Difficulty: ${JSON.stringify(batch.difficultyDist)}`);
    console.log(`  Register: contractions=${batch.registerMetrics.contractionRate}% DM=${batch.registerMetrics.discourseMarkerRate}% you=${batch.registerMetrics.youAddressRate}% questions=${batch.registerMetrics.questionRate}%`);
    console.log(`  Correct-is-longest rate: ${batch.correctIsLongestRate}% (target <= 30%)`);
    console.log(`  Avg word count: ${batch.avgWordCount} (target 180-220)`);
  }

  // Step 6: AI Audit
  if (!SKIP_AUDIT && accepted.length > 0) {
    console.log("");
    console.log("4. AI Audit (independent answer verification)...");
    console.log("");

    async function auditCallAI(prompt) {
      const { callDeepSeekViaCurl } = require("../lib/ai/deepseekHttp.js");
      const apiKey = process.env.DEEPSEEK_API_KEY;
      const payload = {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "You are an expert TOEFL listening comprehension evaluator. Return only valid JSON.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 3000,
      };
      const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 60000 });
      return typeof result === "string"
        ? result
        : (result?.choices?.[0]?.message?.content || JSON.stringify(result));
    }

    const auditResult = await auditLATBatch(accepted, auditCallAI);

    for (const f of auditResult.flagged) {
      const ar = f.audit_result;
      if (ar.ambiguous) {
        console.log(`  !! ${f.id}: AMBIGUOUS -- AI found multiple valid options`);
        for (const d of (ar.details || [])) {
          if (d.ambiguous || !d.match) {
            console.log(`      Q${d.questionIndex + 1}: Our=${d.ourAnswer} AI=${d.aiAnswer} Ratings=${JSON.stringify(d.ratings)}`);
          }
        }
      } else {
        console.log(`  !! ${f.id}: MISMATCH -- AI disagrees on answer`);
        for (const d of (ar.details || [])) {
          if (!d.match) {
            console.log(`      Q${d.questionIndex + 1}: Our=${d.ourAnswer} AI=${d.aiAnswer} -- ${d.reasoning?.slice(0, 80)}`);
          }
        }
      }
    }
    if (auditResult.errors > 0) {
      console.log(`  ** ${auditResult.errors} audit calls failed (items kept)`);
    }

    accepted.length = 0;
    accepted.push(...auditResult.clean);

    console.log("");
    console.log(`  Audit: ${accepted.length} clean, ${auditResult.flagged.length} flagged/removed, ${auditResult.errors} errors`);
    rejected.push(...auditResult.flagged);
  } else if (SKIP_AUDIT) {
    console.log("");
    console.log("4. AI Audit: SKIPPED (--skip-audit)");
  }

  // Step 7: Optional TTS
  if (WITH_TTS && accepted.length > 0) {
    console.log("");
    console.log("5. Generating TTS audio (lecture voice)...");
    console.log("");
    for (const item of accepted) {
      const audioUrl = await generateTTS(item, item.id);
      if (audioUrl) item.audio_url = audioUrl;
    }
  }

  // Step 8: Save staging
  console.log("");
  console.log("-- Results --");
  console.log(`  Accepted: ${accepted.length}/${parsed.length}`);
  console.log(`  Rejected: ${rejected.length}/${parsed.length}`);
  console.log(`  Acceptance rate: ${parsed.length > 0 ? Math.round(accepted.length / parsed.length * 100) : 0}%`);

  if (accepted.length > 0) {
    const batchStats = validateBatch(accepted);

    mkdirSync(STAGING_DIR, { recursive: true });
    const stagingFile = join(STAGING_DIR, `lat-${timestamp}.json`);
    const output = {
      type: "listenAcademicTalk",
      version: 2,
      generated_at: new Date().toISOString(),
      total_generated: parsed.length,
      total_accepted: accepted.length,
      acceptance_rate: Math.round(accepted.length / parsed.length * 100) / 100,
      tts_generated: WITH_TTS,
      tts_provider: WITH_TTS ? TTS_PROVIDER : null,
      batch_quality: {
        avg_flavor: batchStats.avgFlavor,
        answer_distribution: batchStats.distribution,
        balanced: batchStats.balanced,
        q_type_distribution: batchStats.qTypeDist,
        subject_distribution: batchStats.subjectDist,
        difficulty_distribution: batchStats.difficultyDist,
        register_metrics: batchStats.registerMetrics,
        correct_is_longest_rate: batchStats.correctIsLongestRate,
        avg_word_count: batchStats.avgWordCount,
      },
      items: accepted.map(item => {
        const { _flavor, _audit, ...rest } = item;
        return { ...rest, flavor_score: _flavor?.total };
      }),
      rejected: rejected.map(item => {
        const { _flavor, _audit, ...rest } = item;
        return rest;
      }),
    };
    writeFileSync(stagingFile, JSON.stringify(output, null, 2));
    console.log(`\nStaging file: ${stagingFile}`);

    // Show sample
    const sample = accepted[0];
    console.log("");
    console.log("-- Sample --");
    console.log(`Subject: ${sample.subject} | Topic: ${sample.topic} | Difficulty: ${sample.difficulty}`);
    console.log(`Words: ${wc(sample.transcript)} | Flavor: ${sample._flavor?.total}`);
    console.log("");
    // Show first 150 chars of transcript
    console.log(`  "${sample.transcript.slice(0, 150)}..."`);
    console.log("");
    for (let qi = 0; qi < sample.questions.length; qi++) {
      const q = sample.questions[qi];
      console.log(`  Q${qi + 1} (${q.type}): ${q.stem}`);
      for (const key of ["A", "B", "C", "D"]) {
        const marker = key === q.answer ? "->" : "  ";
        const dtype = q.distractor_types?.[key] || "";
        console.log(`    ${marker} ${key}. ${q.options[key]}${dtype ? `  [${dtype}]` : ""}`);
      }
    }
  } else {
    console.log("\nNo items accepted. Try adjusting generation parameters or review rejected items.");
  }
}

function wc(s) { return s.split(/\s+/).filter(Boolean).length; }

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
