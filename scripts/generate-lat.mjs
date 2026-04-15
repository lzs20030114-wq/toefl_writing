#!/usr/bin/env node

/**
 * Generate Listen to an Academic Talk (LAT) questions using DeepSeek.
 *
 * Usage: node scripts/generate-lat.mjs [--count 10] [--with-tts] [--dry-run] [--skip-audit]
 *
 * Pipeline:
 *   1. Build prompt for academic talk listening questions
 *   2. Call DeepSeek to generate items
 *   3. Validate structure and quality
 *   4. (Optional) Generate TTS audio for lecture
 *   5. Save accepted items to staging
 *
 * 2026 TOEFL Listening Task:
 *   - Hear a short academic lecture (100-250 words)
 *   - Answer 3-5 MCQ about main idea, detail, inference, function, organization, attitude
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { buildLATPrompt } = require("../lib/listeningGen/latPromptBuilder.js");
const { validateLAT, validateBatchDistribution } = require("../lib/listeningGen/latValidator.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING_DIR = join(__dirname, "..", "data", "listening", "staging");
const BANK_DIR = join(__dirname, "..", "data", "listening", "bank");

// ── Parse CLI args ──
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const COUNT = Math.min(parseInt(getArg("count", "10"), 10), 15);
const DRY_RUN = args.includes("--dry-run");
const WITH_TTS = args.includes("--with-tts");

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
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY not set. Add it to .env.local or export it.");
  }

  const payload = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "You are a TOEFL listening question writer. Return only valid JSON, no markdown fencing." },
      { role: "user", content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 8192,
  };

  const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 150000 });
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

// ── TTS generation (optional) ──
async function generateTTS(item, id) {
  if (!WITH_TTS) return null;

  try {
    const { generateSpeech, estimateCost } = require("../lib/tts/openaiTts.js");
    const { uploadAudio } = require("../lib/tts/storage.js");

    const est = estimateCost(item.lecture);
    console.log(`   TTS for ${id}: ${est.chars} chars, ~$${est.cost.toFixed(4)}`);

    const buffer = await generateSpeech(item.lecture, {
      voice: "onyx", // deeper voice for professor
      model: "tts-1-hd",
      format: "mp3",
    });

    const result = await uploadAudio(`academic-talk/${id}.mp3`, buffer);
    return result.url;
  } catch (err) {
    console.log(`   TTS failed for ${id}: ${err.message}`);
    return null;
  }
}

// ── Main pipeline ──
async function main() {
  console.log("========================================================");
  console.log("   Listen to an Academic Talk (LAT) — Generation Pipeline");
  console.log("========================================================\n");
  console.log(`Count: ${COUNT}  TTS: ${WITH_TTS}  Dry-run: ${DRY_RUN}\n`);

  loadEnv();

  // Collect existing IDs to avoid duplication
  const existingIds = new Set();
  try {
    const bankFile = join(BANK_DIR, "lat.json");
    if (existsSync(bankFile)) {
      const bank = JSON.parse(readFileSync(bankFile, "utf-8"));
      (bank.items || bank || []).forEach(item => existingIds.add(item.id));
    }
    if (existsSync(STAGING_DIR)) {
      for (const f of readdirSync(STAGING_DIR).filter(f => f.startsWith("lat-") && f.endsWith(".json"))) {
        const d = JSON.parse(readFileSync(join(STAGING_DIR, f), "utf-8"));
        (d.items || []).forEach(item => existingIds.add(item.id));
      }
    }
  } catch {}
  if (existingIds.size > 0) {
    console.log(`   Excluding ${existingIds.size} existing items`);
  }

  // Step 1: Build prompt
  console.log("1. Building prompt...");
  const prompt = buildLATPrompt(COUNT, { excludeIds: [...existingIds] });

  if (DRY_RUN) {
    console.log("\n-- PROMPT (dry-run) --\n");
    console.log(prompt);
    console.log("\n-- END PROMPT --");
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

  let parsed;
  try {
    parsed = parseJsonResponse(rawResponse.content);
  } catch {
    console.log("   JSON parse failed, attempting salvage...");
    parsed = salvagePartialJson(rawResponse.content);
  }
  console.log(`   Received ${parsed.length} items\n`);

  // Step 3: Validate
  console.log("3. Validating...\n");
  const accepted = [];
  const rejected = [];
  const timestamp = Date.now();

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    const id = `lat_gen_${timestamp}_${String(i + 1).padStart(3, "0")}`;
    item.id = id;

    const result = validateLAT(item);

    if (!result.valid) {
      const reasons = result.errors.join("; ");
      console.log(`  X ${id}: ${reasons}`);
      rejected.push({ ...item, rejection_reasons: result.errors });
    } else if (result.warnings.length > 0) {
      console.log(`  ~ ${id} (${item.subject}): OK (${result.warnings.length} warnings: ${result.warnings.join(", ")})`);
      accepted.push(item);
    } else {
      console.log(`  + ${id} (${item.subject}): OK`);
      accepted.push(item);
    }
  }

  // Check answer distribution
  const dist = validateBatchDistribution(accepted);
  console.log(`  Answer distribution: A=${dist.distribution.A} B=${dist.distribution.B} C=${dist.distribution.C} D=${dist.distribution.D}`);

  // Step 4: Optional TTS
  if (WITH_TTS && accepted.length > 0) {
    console.log("\n4. Generating TTS audio...\n");
    for (const item of accepted) {
      const audioUrl = await generateTTS(item, item.id);
      if (audioUrl) item.audio_url = audioUrl;
    }
  }

  // Step 5: Save staging
  console.log(`\n-- Results --`);
  console.log(`  Accepted: ${accepted.length}/${parsed.length}`);
  console.log(`  Rejected: ${rejected.length}/${parsed.length}`);
  console.log(`  Acceptance rate: ${parsed.length > 0 ? Math.round(accepted.length / parsed.length * 100) : 0}%`);

  if (accepted.length > 0) {
    mkdirSync(STAGING_DIR, { recursive: true });
    const stagingFile = join(STAGING_DIR, `lat-${timestamp}.json`);
    const output = {
      type: "listenAcademicTalk",
      generated_at: new Date().toISOString(),
      total_generated: parsed.length,
      total_accepted: accepted.length,
      acceptance_rate: Math.round(accepted.length / parsed.length * 100) / 100,
      tts_generated: WITH_TTS,
      items: accepted,
      rejected,
    };
    writeFileSync(stagingFile, JSON.stringify(output, null, 2));
    console.log(`\nStaging file: ${stagingFile}`);

    // Show sample
    const sample = accepted[0];
    console.log(`\n-- Sample --`);
    console.log(`Subject: ${sample.subject} | Topic: ${sample.subtopic}`);
    console.log(`Lecture: "${sample.lecture?.slice(0, 120)}..."`);
    console.log(`Questions: ${sample.questions?.length || 0}`);
    if (sample.questions?.[0]) {
      const q = sample.questions[0];
      console.log(`  Q1 (${q.question_type}): ${q.question}`);
      console.log(`  Answer: ${q.answer} — ${q.explanation?.slice(0, 80)}...`);
    }
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
