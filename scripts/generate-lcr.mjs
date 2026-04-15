#!/usr/bin/env node

/**
 * Generate Listen and Choose a Response (LCR) questions — v2
 *
 * Rebuilt based on deep ETS flavor analysis (16 reference samples).
 *
 * Usage: node scripts/generate-lcr.mjs [--count 10] [--with-tts] [--dry-run] [--difficulty easy|medium|hard]
 *
 * Pipeline:
 *   1. Collect existing speaker sentences for deduplication
 *   2. Build prompt with pre-assigned answer positions, difficulty tiers, paradigms
 *   3. Call DeepSeek to generate items
 *   4. Three-level validation (schema → profile → flavor scoring)
 *   5. Batch-level quality checks (answer dist, contraction rate, paradigm dist)
 *   6. (Optional) Generate TTS audio for speaker sentences
 *   7. Save accepted items to staging with full quality metrics
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { buildLCRPrompt } = require("../lib/listeningGen/lcrPromptBuilder.js");
const { validateLCR, validateBatch, scoreFlavor } = require("../lib/listeningGen/lcrValidator.js");
const { auditLCRBatch } = require("../lib/listeningGen/lcrAuditor.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING_DIR = join(__dirname, "..", "data", "listening", "staging");
const BANK_DIR = join(__dirname, "..", "data", "listening", "bank");

// ── Parse CLI args ──
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const COUNT = Math.min(parseInt(getArg("count", "10"), 10), 12);
const DRY_RUN = args.includes("--dry-run");
const WITH_TTS = args.includes("--with-tts");
const SKIP_AUDIT = args.includes("--skip-audit");
const DIFFICULTY = getArg("difficulty", null); // null = mixed (30/45/25)

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

  const payload = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "You are an ETS-caliber TOEFL question writer. Return only valid JSON, no markdown fencing." },
      { role: "user", content: prompt },
    ],
    temperature: 0.75,
    max_tokens: 8192,
  };

  const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 120000 });
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

// ── Collect existing speakers for deduplication ──
function collectExistingSpeakers() {
  const speakers = [];
  try {
    // From bank
    const bankFile = join(BANK_DIR, "lcr.json");
    if (existsSync(bankFile)) {
      const bank = JSON.parse(readFileSync(bankFile, "utf-8"));
      (bank.items || []).forEach(item => {
        if (item.speaker) speakers.push(item.speaker);
      });
    }
    // From staging
    if (existsSync(STAGING_DIR)) {
      for (const f of readdirSync(STAGING_DIR).filter(f => f.startsWith("lcr-") && f.endsWith(".json"))) {
        const d = JSON.parse(readFileSync(join(STAGING_DIR, f), "utf-8"));
        (d.items || []).forEach(item => {
          if (item.speaker) speakers.push(item.speaker);
        });
      }
    }
  } catch {}
  return speakers;
}

// ── TTS generation with smart voice selection ──
// Default: Edge TTS (free, high quality)
// Optional: OpenAI TTS (paid, highest quality) via --tts-provider openai

const TTS_PROVIDER = getArg("tts-provider", "edge"); // "edge" or "openai"

function pickVoicePreset(item) {
  const ctx = (item.context || "").toLowerCase();
  // Alternate male/female for variety
  const isFemale = Math.random() < 0.5;
  if (ctx.includes("academic") || ctx.includes("classroom")) {
    return isFemale ? "lcr_staff_female" : "lcr_campus_male";
  }
  if (ctx.includes("daily") || ctx.includes("social")) {
    return isFemale ? "lcr_campus_female" : "lcr_campus_male";
  }
  return isFemale ? "lcr_campus_female" : "lcr_campus_male";
}

async function generateTTS(item, id) {
  if (!WITH_TTS) return null;
  try {
    const preset = pickVoicePreset(item);
    let buffer;

    if (TTS_PROVIDER === "openai") {
      const { generateSpeech } = require("../lib/tts/openaiTts.js");
      buffer = await generateSpeech(item.speaker, { preset, format: "mp3" });
    } else {
      const { generateSpeech } = require("../lib/tts/edgeTts.js");
      buffer = await generateSpeech(item.speaker, { preset, format: "mp3" });
    }

    console.log(`   🔊 [${TTS_PROVIDER}/${preset}] ${buffer.length} bytes`);

    const { uploadAudio } = require("../lib/tts/storage.js");
    const result = await uploadAudio(`choose-response/${id}.mp3`, buffer);
    return result.url;
  } catch (err) {
    console.log(`   ⚠ TTS failed for ${id}: ${err.message}`);
    return null;
  }
}

// ── Main pipeline ──
async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   LCR v2 — ETS-Calibrated Generation Pipeline          ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");
  console.log(`Count: ${COUNT}  Difficulty: ${DIFFICULTY || "mixed (30/45/25)"}  TTS: ${WITH_TTS}  Dry-run: ${DRY_RUN}\n`);

  loadEnv();

  // Step 1: Collect existing data for dedup
  const existingSpeakers = collectExistingSpeakers();
  if (existingSpeakers.length > 0) {
    console.log(`   Excluding ${existingSpeakers.length} existing speaker sentences\n`);
  }

  // Step 2: Build prompt
  console.log("1. Building prompt...");
  const prompt = buildLCRPrompt(COUNT, {
    excludeSpeakers: existingSpeakers,
    difficultyOverride: DIFFICULTY,
  });

  if (DRY_RUN) {
    console.log("\n── PROMPT (dry-run) ──\n");
    console.log(prompt);
    console.log("\n── END PROMPT ──");
    return;
  }

  // Step 3: Call DeepSeek
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

  // Step 4: Three-level validation
  console.log("3. Validating (schema → profile → flavor)...\n");
  const accepted = [];
  const rejected = [];
  const timestamp = Date.now();

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    const id = `lcr_v2_${timestamp}_${String(i + 1).padStart(3, "0")}`;
    item.id = id;

    const result = validateLCR(item);

    if (!result.valid) {
      const reasons = result.errors.join("; ");
      console.log(`  ✗ ${id}: ${reasons}`);
      rejected.push({ ...item, rejection_reasons: result.errors });
    } else {
      const flavorStr = result.flavor ? `flavor=${result.flavor.total}` : "";
      const paradigm = item.answer_paradigm || "?";
      const diff = item.difficulty || "?";

      if (result.warnings.length > 0) {
        console.log(`  ⚠ ${id} [${diff}/${paradigm}] ${flavorStr}: ${result.warnings.length} warnings`);
        for (const w of result.warnings) console.log(`      ${w}`);
      } else {
        console.log(`  ✓ ${id} [${diff}/${paradigm}] ${flavorStr}`);
      }
      item._flavor = result.flavor;
      accepted.push(item);
    }
  }

  // Step 5: Batch-level quality checks
  if (accepted.length > 0) {
    const batch = validateBatch(accepted);
    console.log(`\n── Batch Quality ──`);
    console.log(`  Answer distribution: A=${batch.distribution.A} B=${batch.distribution.B} C=${batch.distribution.C} D=${batch.distribution.D} ${batch.balanced ? "✓" : "⚠ UNBALANCED"}`);
    console.log(`  Avg flavor score: ${batch.avgFlavor} ${batch.avgFlavor >= 0.70 ? "✓" : batch.avgFlavor >= 0.50 ? "⚠" : "✗"} (target ≥0.70)`);
    console.log(`  Contraction rate: ${batch.contractionRate}% (ETS target: 62%)`);
    console.log(`  Discourse marker rate: ${batch.dmRate}% (ETS target: 37%)`);
    console.log(`  Paradigms: ${JSON.stringify(batch.paradigmDist)}`);
    console.log(`  Difficulty: ${JSON.stringify(batch.difficultyDist)}`);
  }

  // Step 6: AI Audit — independent answer verification
  if (!SKIP_AUDIT && accepted.length > 0) {
    console.log("\n4. AI Audit (independent answer verification)...\n");

    async function auditCallAI(prompt) {
      const { callDeepSeekViaCurl } = require("../lib/ai/deepseekHttp.js");
      const apiKey = process.env.DEEPSEEK_API_KEY;
      const payload = {
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are an expert English conversation analyst. Return only valid JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      };
      const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 30000 });
      return typeof result === "string" ? result : (result?.choices?.[0]?.message?.content || JSON.stringify(result));
    }

    const auditResult = await auditLCRBatch(accepted, auditCallAI);

    for (const f of auditResult.flagged) {
      const ar = f.audit_result;
      if (ar.ambiguous) {
        console.log(`  🔴 ${f.id}: AMBIGUOUS — AI found multiple valid options`);
        console.log(`      Our: ${ar.ourAnswer}, AI: ${ar.aiAnswer} | Ratings: ${JSON.stringify(ar.ratings)}`);
      } else {
        console.log(`  🔴 ${f.id}: MISMATCH — AI chose ${ar.aiAnswer}, we chose ${ar.ourAnswer}`);
        console.log(`      Reasoning: ${ar.reasoning?.slice(0, 80)}`);
      }
    }
    if (auditResult.errors > 0) {
      console.log(`  ⚠ ${auditResult.errors} audit calls failed (items kept)`);
    }

    const beforeAudit = accepted.length;
    // Replace accepted with only clean items
    accepted.length = 0;
    accepted.push(...auditResult.clean);
    const removed = beforeAudit - accepted.length;

    console.log(`\n  Audit: ${accepted.length} clean, ${auditResult.flagged.length} flagged/removed, ${auditResult.errors} errors`);
    // Add flagged to rejected
    rejected.push(...auditResult.flagged);
  } else if (SKIP_AUDIT) {
    console.log("\n4. AI Audit: SKIPPED (--skip-audit)");
  }

  // Step 7: Optional TTS
  if (WITH_TTS && accepted.length > 0) {
    console.log("\n5. Generating TTS audio...\n");
    for (const item of accepted) {
      const audioUrl = await generateTTS(item, item.id);
      if (audioUrl) item.audio_url = audioUrl;
    }
  }

  // Step 8: Save staging
  console.log(`\n── Results ──`);
  console.log(`  Accepted: ${accepted.length}/${parsed.length}`);
  console.log(`  Rejected: ${rejected.length}/${parsed.length}`);
  console.log(`  Acceptance rate: ${parsed.length > 0 ? Math.round(accepted.length / parsed.length * 100) : 0}%`);

  if (accepted.length > 0) {
    // Compute batch stats for staging metadata
    const batchStats = validateBatch(accepted);

    mkdirSync(STAGING_DIR, { recursive: true });
    const stagingFile = join(STAGING_DIR, `lcr-${timestamp}.json`);
    const output = {
      type: "listenChooseResponse",
      version: 2,
      generated_at: new Date().toISOString(),
      total_generated: parsed.length,
      total_accepted: accepted.length,
      acceptance_rate: Math.round(accepted.length / parsed.length * 100) / 100,
      tts_generated: WITH_TTS,
      batch_quality: {
        avg_flavor: batchStats.avgFlavor,
        answer_distribution: batchStats.distribution,
        balanced: batchStats.balanced,
        contraction_rate: batchStats.contractionRate,
        dm_rate: batchStats.dmRate,
        paradigm_distribution: batchStats.paradigmDist,
        difficulty_distribution: batchStats.difficultyDist,
      },
      items: accepted.map(item => {
        const { _flavor, ...rest } = item;
        return { ...rest, flavor_score: _flavor?.total };
      }),
      rejected,
    };
    writeFileSync(stagingFile, JSON.stringify(output, null, 2));
    console.log(`\nStaging file: ${stagingFile}`);

    // Show sample
    const sample = accepted[0];
    console.log(`\n── Sample ──`);
    console.log(`Context: ${sample.context} | Difficulty: ${sample.difficulty} | Paradigm: ${sample.answer_paradigm}`);
    console.log(`Speaker: "${sample.speaker}"`);
    for (const key of ["A", "B", "C", "D"]) {
      const marker = key === sample.answer ? "→" : " ";
      const dtype = sample.distractor_types?.[key] || "";
      console.log(`  ${marker} ${key}. ${sample.options[key]}${dtype ? `  [${dtype}]` : ""}`);
    }
    console.log(`Flavor: ${sample._flavor?.total} | Explanation: ${sample.explanation?.slice(0, 80)}...`);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
