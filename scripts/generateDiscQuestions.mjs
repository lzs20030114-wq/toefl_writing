#!/usr/bin/env node
/**
 * Generate new TOEFL Academic Discussion (Task 3) questions
 * using DeepSeek with the pattern-based prompt derived from 60 real questions.
 *
 * Usage:
 *   DEEPSEEK_API_KEY=... node scripts/generateDiscQuestions.mjs [count]
 *
 * Default: generate 10 new questions.
 * Questions are appended to data/academicWriting/prompts.json.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, formatDeepSeekError } = require("../lib/ai/deepseekHttp.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_PATH = path.join(__dirname, "..", "data", "academicWriting", "prompts.json");

// Import generation prompt builders
const {
  DISC_COURSE_LIST,
  DISC_STUDENT_NAMES,
  buildDiscGenSystemPrompt,
  buildDiscGenUserPrompt,
  pickOpeningStyle,
} = await import("../lib/ai/prompts/academicWriting.js");

// ── Config ──────────────────────────────────────────────────────────
const TARGET_COUNT = parseInt(process.argv[2], 10) || 10;
const MAX_RETRIES = 3;
const QUESTION_TYPES = ["binary", "open", "which", "statement"];

// ── Load existing data ──────────────────────────────────────────────
function loadExisting() {
  try {
    const raw = fs.readFileSync(PROMPTS_PATH, "utf-8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveData(data) {
  fs.writeFileSync(PROMPTS_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ── Name selection (weighted toward Claire/Paul like real TOEFL) ───
function pickStudentNames(rng) {
  // 35% chance: Claire + Paul (like real TOEFL)
  if (rng < 0.35) return ["Claire", "Paul"];

  // Otherwise pick from diverse pool, avoiding duplicates
  const pool = DISC_STUDENT_NAMES.filter(n => n !== "Claire" && n !== "Paul");
  const shuffled = pool.sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

// ── Course distribution (match real TOEFL proportions) ─────────────
function pickCourseForBatch(existing, batchIdx, batchSize) {
  // Count existing per course
  const counts = {};
  for (const c of DISC_COURSE_LIST) counts[c] = 0;
  for (const q of existing) {
    const c = q.course || "social studies";
    if (counts[c] !== undefined) counts[c]++;
  }

  // Weighted distribution matching real TOEFL proportions
  const weights = {
    sociology: 11, "political science": 9, business: 8,
    "history and culture": 6, "social studies": 5, education: 5,
    "environmental science": 5, psychology: 5, "public policy": 3,
    "public health": 1, "computer science": 1, "technology and media": 1,
  };

  // Pick courses that are underrepresented relative to target proportion
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const totalExisting = existing.length;

  const candidates = DISC_COURSE_LIST.map(c => {
    const targetProp = (weights[c] || 1) / totalWeight;
    const currentProp = totalExisting > 0 ? (counts[c] || 0) / totalExisting : 0;
    const deficit = targetProp - currentProp;
    return { course: c, deficit };
  });

  candidates.sort((a, b) => b.deficit - a.deficit);

  // Pick from top 4 candidates with some randomness
  const topN = candidates.slice(0, 4);
  return topN[batchIdx % topN.length].course;
}

// ── Existing topic extraction (for dedup) ───────────────────────────
function extractTopicSummaries(data) {
  return data.map(q => {
    const text = q.professor?.text || "";
    // First sentence as topic summary
    const first = text.split(/[.?!]/).filter(Boolean)[0]?.trim() || "";
    return first.length > 30 ? first.slice(0, 60) + "..." : first;
  }).filter(Boolean);
}

// ── Validation ──────────────────────────────────────────────────────
function validateQuestion(q) {
  const errors = [];

  if (!q.course || typeof q.course !== "string") errors.push("missing course");
  if (!q.professor?.name) errors.push("missing professor name");
  if (!q.professor?.text) errors.push("missing professor text");

  const pt = q.professor?.text || "";
  if (pt.length < 150) errors.push(`professor text too short (${pt.length})`);
  if (pt.length > 800) errors.push(`professor text too long (${pt.length})`);
  if (!pt.includes("?")) errors.push("professor text has no question");

  if (!Array.isArray(q.students) || q.students.length !== 2) {
    errors.push("need exactly 2 students");
  } else {
    for (let i = 0; i < 2; i++) {
      const s = q.students[i];
      if (!s?.name) errors.push(`student ${i + 1} missing name`);
      if (!s?.text) errors.push(`student ${i + 1} missing text`);
      const sl = (s?.text || "").length;
      if (sl < 150) errors.push(`student ${i + 1} text too short (${sl})`);
      if (sl > 800) errors.push(`student ${i + 1} text too long (${sl})`);
    }
  }

  return errors;
}

// ── Call DeepSeek ───────────────────────────────────────────────────
async function generateOne({ course, studentNames, questionType, existingTopics, openingStyle, s2ReferencesS1 }) {
  const systemPrompt = buildDiscGenSystemPrompt();
  const userPrompt = buildDiscGenUserPrompt({ course, existingTopics, studentNames, questionType, openingStyle, s2ReferencesS1 });

  const result = await callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: process.env.DEEPSEEK_PROXY_URL || process.env.HTTPS_PROXY || "",
    payload: {
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.9,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    },
  });

  // callDeepSeekViaCurl returns the content string directly
  const content = typeof result === "string" ? result : "";
  if (!content) throw new Error("Empty response from DeepSeek");

  // Parse JSON (lenient)
  let json;
  try {
    json = JSON.parse(content);
  } catch {
    const first = content.indexOf("{");
    const last = content.lastIndexOf("}");
    if (first >= 0 && last > first) {
      json = JSON.parse(content.slice(first, last + 1));
    } else {
      throw new Error("Failed to parse JSON: " + content.slice(0, 200));
    }
  }

  return json;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("ERROR: DEEPSEEK_API_KEY required");
    process.exit(1);
  }

  console.log(`\n🎯 Generating ${TARGET_COUNT} Academic Discussion questions...\n`);

  let existing = loadExisting();
  const existingIds = new Set(existing.map(q => q.id));
  let nextIdNum = 1;
  for (const q of existing) {
    const n = parseInt(String(q.id).replace(/^ad/, ""), 10);
    if (Number.isFinite(n) && n >= nextIdNum) nextIdNum = n + 1;
  }

  const generated = [];
  let failures = 0;

  for (let i = 0; i < TARGET_COUNT; i++) {
    const course = pickCourseForBatch([...existing, ...generated], i, TARGET_COUNT);
    const studentNames = pickStudentNames(Math.random());
    const questionType = QUESTION_TYPES[i % QUESTION_TYPES.length];
    const existingTopics = extractTopicSummaries([...existing, ...generated]).slice(-20);
    const openingStyle = pickOpeningStyle();
    // 40% chance S2 references S1 by name (matching real TOEFL)
    const s2ReferencesS1 = Math.random() < 0.4;

    let question = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const raw = await generateOne({ course, studentNames, questionType, existingTopics, openingStyle, s2ReferencesS1 });

        // Ensure course field, normalized to lowercase
        raw.course = (raw.course || course).toLowerCase();

        const errors = validateQuestion(raw);
        if (errors.length > 0) {
          console.warn(`  ⚠ Validation failed (attempt ${attempt + 1}): ${errors.join(", ")}`);
          continue;
        }

        raw.id = `ad${nextIdNum}`;
        question = raw;
        break;
      } catch (err) {
        console.warn(`  ⚠ Generation error (attempt ${attempt + 1}): ${formatDeepSeekError(err)}`);
      }
    }

    if (question) {
      generated.push(question);
      nextIdNum++;
      console.log(`  ✅ ${question.id} [${question.course}] "${question.professor.text.slice(0, 60)}..."`);
    } else {
      failures++;
      console.error(`  ❌ Failed after ${MAX_RETRIES} attempts for ${course}`);
    }
  }

  // Save
  if (generated.length > 0) {
    const merged = [...existing, ...generated];
    saveData(merged);
    console.log(`\n✅ Added ${generated.length} questions (${failures} failed)`);
    console.log(`   Total in bank: ${merged.length}`);

    // Print course distribution
    const counts = {};
    for (const q of merged) {
      counts[q.course || "?"] = (counts[q.course || "?"] || 0) + 1;
    }
    console.log("\n📊 Course distribution:");
    for (const [c, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${c}: ${n}`);
    }
  } else {
    console.error("\n❌ No questions generated successfully");
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
