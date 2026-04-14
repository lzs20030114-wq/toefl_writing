#!/usr/bin/env node

/**
 * Generate Academic Passage questions using DeepSeek.
 *
 * Usage: node scripts/generate-ap.mjs [--count 3] [--skip-audit] [--dry-run]
 *
 * Pipeline:
 *   1. Build prompt with topic diversity + rhetorical pattern assignment
 *   2. Call DeepSeek to generate passage + 5 questions
 *   3. Validate (schema + profile + quality)
 *   4. Optional AI answer audit
 *   5. Save to staging
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { buildAPPrompt } = require("../lib/readingGen/apPromptBuilder.js");
const { validateAPItem, validateAPBatch } = require("../lib/readingGen/apValidator.js");
const { auditRDLItem } = require("../lib/readingGen/answerAuditor.js"); // Reuse RDL auditor — same logic

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING_DIR = join(__dirname, "..", "data", "reading", "staging");

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const MAX_BATCH = 5; // AP is token-heavy, keep batches small
const COUNT = Math.min(parseInt(getArg("count", "3"), 10), MAX_BATCH);
const DRY_RUN = args.includes("--dry-run");
const SKIP_AUDIT = args.includes("--skip-audit");

function loadEnv() {
  try {
    const envPath = join(__dirname, "..", ".env.local");
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
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
      { role: "system", content: "You are a TOEFL academic reading question writer. Return only valid JSON, no markdown fencing." },
      { role: "user", content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 8192, // DeepSeek max; AP is token-heavy
  };

  const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 120000 });
  return typeof result === "string" ? result : (result?.choices?.[0]?.message?.content || JSON.stringify(result));
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

function countWords(text) { return text.trim().split(/\s+/).filter(Boolean).length; }

async function main() {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║   Academic Passage — Generation Pipeline          ║");
  console.log("╚════════════════════════════════════════════════════╝\n");
  console.log(`Count: ${COUNT}  Audit: ${SKIP_AUDIT ? "skip" : "enabled"}  Dry-run: ${DRY_RUN}\n`);

  // Step 1: Collect existing subjects for deduplication
  const existingSubjects = [];
  try {
    const stagingFiles = readdirSync(STAGING_DIR).filter(f => f.startsWith("ap-") && f.endsWith(".json"));
    for (const f of stagingFiles) {
      const d = JSON.parse(readFileSync(join(STAGING_DIR, f), "utf-8"));
      (d.items || []).forEach(item => {
        existingSubjects.push(item.subtopic || item.topic || "");
      });
    }
  } catch {}
  if (existingSubjects.length > 0) {
    console.log(`Excluding ${existingSubjects.length} existing subjects\n`);
  }

  // Step 2: Build prompt
  console.log("1. Building prompt...");
  const prompt = buildAPPrompt(COUNT, { excludeSubjects: existingSubjects });

  if (DRY_RUN) {
    console.log("\n── PROMPT ──\n");
    console.log(prompt);
    return;
  }

  // Step 3: Call DeepSeek
  console.log("2. Calling DeepSeek...");
  let responseText;
  try {
    responseText = await callDeepSeek(prompt);
  } catch (err) {
    console.error("DeepSeek call failed:", err.message);
    process.exit(1);
  }

  if (!responseText || responseText.length < 20) {
    console.error("Empty/short response");
    process.exit(1);
  }

  let rawItems;
  try {
    rawItems = parseJsonResponse(responseText);
  } catch (err) {
    console.log(`   JSON parse failed: ${err.message}. Salvaging...`);
    rawItems = salvagePartialJson(responseText);
    if (rawItems.length > 0) {
      console.log(`   Salvaged ${rawItems.length} items`);
    } else {
      console.error("   No items salvaged. Response:", responseText.substring(0, 300));
      process.exit(1);
    }
  }

  console.log(`   Received ${rawItems.length} passages\n`);

  // Step 4: Validate
  console.log("3. Validating...\n");
  const runId = Date.now();
  const accepted = [];
  const rejected = [];

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    const id = `ap_gen_${runId}_${String(i + 1).padStart(3, "0")}`;

    // Normalize
    const item = {
      id,
      passage: raw.passage || "",
      word_count: raw.passage ? countWords(raw.passage) : 0,
      paragraphs: raw.paragraphs || [],
      paragraph_count: (raw.paragraphs || []).length,
      topic: raw.topic || "other",
      subtopic: raw.subtopic || "",
      difficulty: raw.difficulty || "medium",
      questions: (raw.questions || []).map((q, qi) => ({
        qid: `${id}_q${qi + 1}`,
        question_type: q.question_type || "factual_detail",
        stem: q.stem || "",
        options: q.options || {},
        correct_answer: q.correct_answer || "A",
        explanation: q.explanation || "",
      })),
      question_count: (raw.questions || []).length,
    };

    const validation = validateAPItem(item);

    if (!validation.pass) {
      rejected.push({ id, reason: validation.errors.join("; ") });
      console.log(`  ✗ ${id} (${item.topic}): ${validation.errors.join("; ")}`);
      continue;
    }

    if (validation.warnings.length > 0) {
      console.log(`  ⚠ ${id} (${item.topic}, ${item.word_count}w, ${item.questions.length}Q): ${validation.warnings.length} warnings`);
      validation.warnings.slice(0, 3).forEach(w => console.log(`      ${w}`));
    } else {
      console.log(`  ✓ ${id} (${item.topic}, ${item.word_count}w): OK`);
    }

    accepted.push(item);
  }

  // Batch validation
  if (accepted.length > 0) {
    const batchResult = validateAPBatch(accepted);
    if (batchResult.warnings.length > 0) {
      console.log("\n  Batch warnings:");
      batchResult.warnings.forEach(w => console.log(`    ⚠ ${w}`));
    }
    console.log(`  Answer distribution: A=${batchResult.answerDistribution.A} B=${batchResult.answerDistribution.B} C=${batchResult.answerDistribution.C} D=${batchResult.answerDistribution.D}`);
  }

  // Step 5: AI Answer Audit
  if (!SKIP_AUDIT && accepted.length > 0) {
    console.log("\n4. Running AI answer audit...\n");
    const clean = [];

    for (const item of accepted) {
      // Reuse RDL auditor — it works for any item with text + questions
      const auditItem = { ...item, text: item.passage }; // answerAuditor expects `text`
      const audit = await auditRDLItem(auditItem);

      if (audit.error) {
        console.log(`  ⚠ ${item.id}: audit error — ${audit.error}`);
        clean.push(item);
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
        rejected.push({ id: item.id, reason: `audit: ${audit.mismatches} answer mismatches` });
      } else {
        clean.push(item);
      }
    }

    const flagged = accepted.length - clean.length;
    console.log(`\n  Audit: ${clean.length} clean, ${flagged} flagged`);
    accepted.length = 0;
    accepted.push(...clean);
  }

  console.log(`\n── Results ──`);
  console.log(`  Accepted: ${accepted.length}/${rawItems.length}`);
  console.log(`  Rejected: ${rejected.length}/${rawItems.length}`);
  console.log(`  Acceptance rate: ${rawItems.length > 0 ? (accepted.length / rawItems.length * 100).toFixed(0) : 0}%`);

  if (accepted.length === 0) {
    console.log("\nNo items accepted.");
    process.exit(1);
  }

  // Step 6: Save to staging
  mkdirSync(STAGING_DIR, { recursive: true });
  const stagingFile = join(STAGING_DIR, `ap-${runId}.json`);

  const output = {
    type: "academicPassage",
    generated_at: new Date().toISOString(),
    total_generated: rawItems.length,
    total_accepted: accepted.length,
    acceptance_rate: +(accepted.length / rawItems.length).toFixed(2),
    items: accepted,
    rejected: rejected.map(({ raw, ...r }) => r),
  };

  writeFileSync(stagingFile, JSON.stringify(output, null, 2));
  console.log(`\nStaging file: ${stagingFile}`);

  // Print a sample
  if (accepted.length > 0) {
    const s = accepted[0];
    console.log("\n── Sample ──");
    console.log(`Topic: ${s.topic} / ${s.subtopic} | Words: ${s.word_count} | Paragraphs: ${s.paragraph_count}`);
    console.log(`Passage: ${s.passage.substring(0, 150)}...`);
    s.questions.forEach((q, i) => {
      console.log(`  Q${i + 1} [${q.question_type}]: ${q.stem.substring(0, 60)}... → ${q.correct_answer}`);
    });
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
