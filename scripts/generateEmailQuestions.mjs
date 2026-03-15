#!/usr/bin/env node
/**
 * Generate TOEFL Email Writing (Task 2) questions using DeepSeek.
 *
 * Usage:
 *   DEEPSEEK_API_KEY=... node scripts/generateEmailQuestions.mjs [count]
 *
 * Staging mode (GitHub Actions):
 *   EMAIL_OUTPUT_PATH=... EMAIL_TARGET_COUNT=10 node scripts/generateEmailQuestions.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, formatDeepSeekError } = require("../lib/ai/deepseekHttp.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_PATH = path.join(__dirname, "..", "data", "emailWriting", "prompts.json");
const OUTPUT_PATH = process.env.EMAIL_OUTPUT_PATH ? path.resolve(process.env.EMAIL_OUTPUT_PATH) : null;
const STATE_PATH = process.env.EMAIL_JOB_STATE_PATH ? path.resolve(process.env.EMAIL_JOB_STATE_PATH) : null;

const TARGET_COUNT = parseInt(process.env.EMAIL_TARGET_COUNT || process.argv[2], 10) || 10;
const MAX_RETRIES = 3;

// ── Topic categories with weights ────────────────────────────────────────────
const TOPIC_CATEGORIES = [
  { name: "校园学业", weight: 30, recipients: "professor, academic advisor, TA, librarian, department head" },
  { name: "职场工作", weight: 20, recipients: "manager, supervisor, HR representative, colleague, client" },
  { name: "社区公共", weight: 15, recipients: "city council, building management, organization director, committee chair" },
  { name: "同学社交", weight: 15, recipients: "classmate, friend, roommate, study group member, club president" },
  { name: "消费服务", weight: 10, recipients: "hotel reservations, airline support, store manager, customer service" },
  { name: "住房生活", weight: 10, recipients: "landlord, roommate, property management, neighbor, housing office" },
];

function pickCategory(existing, idx) {
  const counts = {};
  TOPIC_CATEGORIES.forEach((c) => { counts[c.name] = 0; });
  existing.forEach((q) => {
    const t = q.topic || "校园学业";
    if (counts[t] !== undefined) counts[t]++;
  });

  const totalWeight = TOPIC_CATEGORIES.reduce((s, c) => s + c.weight, 0);
  const totalExisting = existing.length || 1;

  const candidates = TOPIC_CATEGORIES.map((c) => ({
    ...c,
    deficit: c.weight / totalWeight - counts[c.name] / totalExisting,
  })).sort((a, b) => b.deficit - a.deficit);

  const top = candidates.slice(0, 3);
  return top[idx % top.length];
}

// ── Prompts ──────────────────────────────────────────────────────────────────
function buildSystemPrompt() {
  return `You are an expert TOEFL Writing Task 2 (email writing) question designer.
Generate a realistic TOEFL-style email writing prompt.

## Output Format (strict JSON)
{
  "topic": "<category in Chinese: 校园学业/职场工作/社区公共/同学社交/消费服务/住房生活>",
  "scenario": "<2-4 sentences. Second person ('You...'). Specific situation with concrete details — names, courses, dates, places. 150-350 characters. No contractions.>",
  "direction": "Write an email to <Recipient Name>. In your email, do the following:",
  "goals": ["<verb + specific action>", "<verb + specific action>", "<verb + specific action>"],
  "to": "<Recipient name or title>",
  "subject": "<professional subject line, 3-8 words>"
}

## Rules
1. Scenario MUST include concrete details (course names, event names, specific dates or timeframes)
2. Each goal MUST begin with a verb (Explain, Describe, Ask, Suggest, Request, Thank, Propose, etc.)
3. The 3 goals should be diverse — typically: explain/describe + ask/request + suggest/propose
4. Recipient should have a realistic name (Professor Smith, Dr. Lee, Manager Johnson, etc.)
5. The scenario should be realistic for a college student or young professional
6. Be creative with situations — avoid generic topics. Think specific incidents, not vague scenarios.
7. Subject line should be concise and professional
8. Do NOT use contractions in the scenario`;
}

function buildUserPrompt({ category, existingSubjects }) {
  let prompt = `Generate a TOEFL email writing question in the "${category.name}" category.\nThe email should be addressed to one of: ${category.recipients}`;
  if (existingSubjects.length > 0) {
    prompt += `\n\nExisting subjects to AVOID (do NOT duplicate these topics):\n${existingSubjects.slice(-20).map((s) => `- ${s}`).join("\n")}`;
  }
  prompt += "\n\nReturn ONLY the JSON object.";
  return prompt;
}

// ── Validation ───────────────────────────────────────────────────────────────
function validate(q) {
  const errors = [];
  if (!q.scenario || q.scenario.length < 100) errors.push(`scenario too short (${(q.scenario || "").length})`);
  if (q.scenario && q.scenario.length > 500) errors.push(`scenario too long (${q.scenario.length})`);
  if (!q.direction || !q.direction.includes("Write an email")) errors.push("invalid direction");
  if (!Array.isArray(q.goals) || q.goals.length !== 3) errors.push("need exactly 3 goals");
  else {
    for (let i = 0; i < 3; i++) {
      if (!q.goals[i] || q.goals[i].length < 15) errors.push(`goal ${i + 1} too short`);
    }
  }
  if (!q.to) errors.push("missing recipient");
  if (!q.subject || q.subject.length < 5) errors.push("missing/short subject");
  return errors;
}

// ── Generation ───────────────────────────────────────────────────────────────
async function generateOne({ category, existingSubjects }) {
  const result = await callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: process.env.DEEPSEEK_PROXY_URL || process.env.HTTPS_PROXY || "",
    payload: {
      model: "deepseek-chat",
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt({ category, existingSubjects }) },
      ],
      temperature: 0.85,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    },
  });

  const content = typeof result === "string" ? result : "";
  if (!content) throw new Error("Empty response");

  try {
    return JSON.parse(content);
  } catch {
    const first = content.indexOf("{");
    const last = content.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(content.slice(first, last + 1));
    throw new Error("Failed to parse JSON");
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("ERROR: DEEPSEEK_API_KEY required");
    process.exit(1);
  }

  console.log(`\n🎯 Generating ${TARGET_COUNT} Email Writing questions...\n`);

  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf-8").replace(/^\uFEFF/, ""));
  } catch { /* empty bank */ }

  let nextIdNum = 1;
  for (const q of existing) {
    const n = parseInt(String(q.id).replace(/^em/, ""), 10);
    if (Number.isFinite(n) && n >= nextIdNum) nextIdNum = n + 1;
  }

  const generated = [];
  let failures = 0;

  for (let i = 0; i < TARGET_COUNT; i++) {
    const category = pickCategory([...existing, ...generated], i);
    const existingSubjects = [...existing, ...generated].map((q) => q.subject).filter(Boolean);

    let question = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const raw = await generateOne({ category, existingSubjects });
        raw.topic = raw.topic || category.name;
        const errors = validate(raw);
        if (errors.length > 0) {
          console.warn(`  ⚠ Validation failed (attempt ${attempt + 1}): ${errors.join(", ")}`);
          continue;
        }
        raw.id = `em${nextIdNum}`;
        question = raw;
        break;
      } catch (err) {
        console.warn(`  ⚠ Error (attempt ${attempt + 1}): ${formatDeepSeekError(err)}`);
      }
    }

    if (question) {
      generated.push(question);
      nextIdNum++;
      console.log(`  ✅ ${question.id} [${question.topic}] "${question.subject}"`);
    } else {
      failures++;
      console.error(`  ❌ Failed after ${MAX_RETRIES} attempts`);
    }
  }

  if (generated.length === 0) {
    console.error("\n❌ No questions generated");
    if (STATE_PATH) fs.writeFileSync(STATE_PATH, JSON.stringify({ error: "No questions generated", timestamp: new Date().toISOString() }));
    process.exit(1);
  }

  const meta = { total_generated: TARGET_COUNT, total_accepted: generated.length, failures, generated_at: new Date().toISOString() };

  if (OUTPUT_PATH) {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ questions: generated, _meta: meta }, null, 2));
    console.log(`\n✅ Wrote ${generated.length} questions to staging: ${OUTPUT_PATH}`);
  } else {
    const merged = [...existing, ...generated];
    fs.writeFileSync(PROMPTS_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");
    console.log(`\n✅ Added ${generated.length} questions. Total: ${merged.length}`);
  }

  if (STATE_PATH) {
    fs.writeFileSync(STATE_PATH, JSON.stringify({ status: "completed", ...meta }, null, 2));
  }

  // Print topic distribution
  const all = [...existing, ...generated];
  const counts = {};
  all.forEach((q) => { counts[q.topic || "?"] = (counts[q.topic || "?"] || 0) + 1; });
  console.log("\n📊 Topic distribution:");
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`   ${t}: ${n}`));
}

main().catch((err) => {
  console.error("Fatal:", err);
  if (STATE_PATH) fs.writeFileSync(STATE_PATH, JSON.stringify({ error: err.message, timestamp: new Date().toISOString() }));
  process.exit(1);
});
