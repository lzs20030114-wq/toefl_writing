#!/usr/bin/env node

/**
 * Generate Listen to a Conversation (LC) questions -- v2
 *
 * Rebuilt based on deep analysis of 11 reference samples.
 *
 * Usage: node scripts/generate-lc.mjs [--count 3] [--with-tts] [--dry-run]
 *        [--difficulty easy|medium|hard] [--skip-audit] [--tts-provider edge|openai]
 *
 * Pipeline:
 *   1. Collect existing conversation situations for deduplication
 *   2. Build prompt with pre-assigned answer positions, difficulty tiers, Q types
 *   3. Call DeepSeek to generate items (batch size <=5 due to token cost)
 *   4. Three-level validation (schema -> profile -> flavor scoring)
 *   5. Batch-level quality checks (answer dist, register metrics, etc.)
 *   6. AI Audit -- independent answer verification (3-layer ambiguity defense)
 *   7. (Optional) Generate TTS audio with multi-voice conversation
 *   8. Save accepted items to staging with full quality metrics
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { buildLCPrompt } = require("../lib/listeningGen/lcPromptBuilder.js");
const { validateLC, validateBatch, scoreFlavor } = require("../lib/listeningGen/lcValidator.js");
const { auditLCBatch } = require("../lib/listeningGen/lcAuditor.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING_DIR = join(__dirname, "..", "data", "listening", "staging");
const BANK_DIR = join(__dirname, "..", "data", "listening", "bank");

// -- Parse CLI args ------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const COUNT = Math.min(parseInt(getArg("count", "3"), 10), 5); // max 5 per batch
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
        content: "You are an ETS-caliber TOEFL question writer specializing in campus conversation listening items. Return only valid JSON, no markdown fencing.",
      },
      { role: "user", content: prompt },
    ],
    temperature: opts.temperature || 0.75,
    max_tokens: opts.maxTokens || 8192,
  };

  const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 120000 });
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

// -- Collect existing situations for deduplication -----------------------
function collectExistingSituations() {
  const situations = [];
  try {
    const bankFile = join(BANK_DIR, "lc.json");
    if (existsSync(bankFile)) {
      const bank = JSON.parse(readFileSync(bankFile, "utf-8"));
      (bank.items || []).forEach(item => {
        if (item.situation) situations.push(item.situation);
      });
    }
    if (existsSync(STAGING_DIR)) {
      for (const f of readdirSync(STAGING_DIR).filter(f => f.startsWith("lc-") && f.endsWith(".json"))) {
        const d = JSON.parse(readFileSync(join(STAGING_DIR, f), "utf-8"));
        (d.items || []).forEach(item => {
          if (item.situation) situations.push(item.situation);
        });
      }
    }
  } catch {}
  return situations;
}

// -- TTS generation with multi-voice conversation ------------------------

function pickVoicePresets(item) {
  const speakers = item.speakers || [];
  if (speakers.length !== 2) return [{ preset: "default" }, { preset: "default" }];

  const s1 = speakers[0];
  const s2 = speakers[1];

  // Determine voice presets based on role and gender
  function voiceForSpeaker(sp) {
    const role = (sp.role || "").toLowerCase();
    const gender = (sp.gender || "").toLowerCase();

    // Staff roles
    if (role.includes("library") || role === "librarian") return "librarian";
    if (role.includes("advisor") || role.includes("counselor")) return "advisor";
    if (role.includes("staff") || role.includes("assistant") || role.includes("clerk") || role.includes("receptionist")) {
      return gender === "female" ? "librarian" : "advisor";
    }

    // Student roles
    if (gender === "male") return "student_male";
    if (gender === "female") return "student_female";
    return "student_female"; // default
  }

  const v1 = voiceForSpeaker(s1);
  let v2 = voiceForSpeaker(s2);

  // Ensure different voices
  if (v1 === v2) {
    v2 = v1 === "student_female" ? "student_male" : "student_female";
  }

  return [
    { name: s1.name, preset: v1 },
    { name: s2.name, preset: v2 },
  ];
}

async function generateTTS(item, id) {
  if (!WITH_TTS) return null;
  try {
    const voiceMap = pickVoicePresets(item);
    const voiceLookup = {};
    for (const v of voiceMap) {
      voiceLookup[v.name] = v.preset;
    }

    // Build segments for multi-voice generation
    const segments = item.conversation.map(t => ({
      text: t.text,
      preset: voiceLookup[t.speaker] || "default",
    }));

    let buffer;
    if (TTS_PROVIDER === "openai") {
      const { generateSpeech } = require("../lib/tts/openaiTts.js");
      const buffers = [];
      for (const seg of segments) {
        const buf = await generateSpeech(seg.text, { preset: seg.preset, format: "mp3" });
        buffers.push(buf);
      }
      buffer = Buffer.concat(buffers);
    } else {
      const { generateConversation } = require("../lib/tts/edgeTts.js");
      buffer = await generateConversation(segments, { format: "mp3" });
    }

    console.log(`   [TTS ${TTS_PROVIDER}] ${buffer.length} bytes, ${segments.length} segments`);

    const { uploadAudio } = require("../lib/tts/storage.js");
    const result = await uploadAudio(`conversation/${id}.mp3`, buffer);
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
  console.log("|  LC v2 -- ETS-Calibrated Conversation Generation Pipeline |");
  console.log("+==========================================================+");
  console.log("");
  console.log(`Count: ${COUNT}  Difficulty: ${DIFFICULTY || "mixed (30/45/25)"}  TTS: ${WITH_TTS ? TTS_PROVIDER : "off"}  Dry-run: ${DRY_RUN}  Audit: ${!SKIP_AUDIT}`);
  console.log("");

  loadEnv();

  // Step 1: Collect existing data for dedup
  const existingSituations = collectExistingSituations();
  if (existingSituations.length > 0) {
    console.log(`   Excluding ${existingSituations.length} existing conversation situations`);
    console.log("");
  }

  // Step 2: Build prompt
  console.log("1. Building prompt...");
  const prompt = buildLCPrompt(COUNT, {
    excludeSituations: existingSituations,
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
    const id = `lc_v2_${timestamp}_${String(i + 1).padStart(3, "0")}`;
    item.id = id;

    const result = validateLC(item);

    if (!result.valid) {
      const reasons = result.errors.join("; ");
      console.log(`  X ${id}: REJECTED -- ${reasons}`);
      rejected.push({ ...item, rejection_reasons: result.errors });
    } else {
      const flavorStr = result.flavor ? `flavor=${result.flavor.total}` : "";
      const diff = item.difficulty || "?";
      const ctx = item.context || "?";
      const q1t = item.questions[0]?.type || "?";
      const q2t = item.questions[1]?.type || "?";
      const turns = item.conversation?.length || 0;
      const words = item.conversation?.reduce((s, t) => s + (t.text || "").split(/\s+/).length, 0) || 0;

      if (result.warnings.length > 0) {
        console.log(`  ~ ${id} [${diff}/${ctx}] ${turns}t/${words}w Q1:${q1t} Q2:${q2t} ${flavorStr}: ${result.warnings.length} warnings`);
        for (const w of result.warnings) console.log(`      ${w}`);
      } else {
        console.log(`  + ${id} [${diff}/${ctx}] ${turns}t/${words}w Q1:${q1t} Q2:${q2t} ${flavorStr}`);
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
    console.log(`  Q type dist: detail=${batch.qTypeDist.detail} main_idea=${batch.qTypeDist.main_idea} inference=${batch.qTypeDist.inference}`);
    console.log(`  Context dist: ${JSON.stringify(batch.contextDist)}`);
    console.log(`  Difficulty: ${JSON.stringify(batch.difficultyDist)}`);
    console.log(`  Register: contractions=${batch.registerMetrics.contractionRate}% fillers=${batch.registerMetrics.fillerRate}% DM=${batch.registerMetrics.discourseMarkerRate}%`);
    console.log(`  Correct-is-longest rate: ${batch.correctIsLongestRate}% (target <= 30%)`);
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
        max_tokens: 2000,
      };
      const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 30000 });
      return typeof result === "string"
        ? result
        : (result?.choices?.[0]?.message?.content || JSON.stringify(result));
    }

    const auditResult = await auditLCBatch(accepted, auditCallAI);

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
    console.log("5. Generating TTS audio (multi-voice conversation)...");
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
    const stagingFile = join(STAGING_DIR, `lc-${timestamp}.json`);
    const output = {
      type: "listenConversation",
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
        context_distribution: batchStats.contextDist,
        difficulty_distribution: batchStats.difficultyDist,
        register_metrics: batchStats.registerMetrics,
        correct_is_longest_rate: batchStats.correctIsLongestRate,
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
    console.log(`Context: ${sample.context} | Difficulty: ${sample.difficulty}`);
    console.log(`Speakers: ${sample.speakers.map(s => `${s.name} (${s.role})`).join(", ")}`);
    console.log(`Turns: ${sample.conversation.length} | Words: ${sample.conversation.reduce((s, t) => s + (t.text || "").split(/\s+/).length, 0)}`);
    console.log(`Flavor: ${sample._flavor?.total}`);
    console.log("");
    // Show first 3 turns
    for (let ti = 0; ti < Math.min(3, sample.conversation.length); ti++) {
      const t = sample.conversation[ti];
      console.log(`  ${t.speaker}: "${t.text.slice(0, 80)}${t.text.length > 80 ? "..." : ""}"`);
    }
    if (sample.conversation.length > 3) {
      console.log(`  ... (${sample.conversation.length - 3} more turns)`);
    }
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

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
