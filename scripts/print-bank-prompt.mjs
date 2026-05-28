#!/usr/bin/env node
// Print the project's calibrated generation prompt for a given bank type.
// Used by the Claude routine to read "what should I generate?" without having
// to interpret the prompt-builder source code itself.
//
// Usage:
//   node scripts/print-bank-prompt.mjs <bank>
//   <bank> ∈ { bs, disc, email, ap, ctw, rdl-short, rdl-long }
//
// Each call returns a self-contained block of instructions for that bank.
// All distribution rules, schema details, anti-duplication lists are baked in.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "..");

// ESM modules
import { genPrompt as bsGenPrompt } from "../lib/bsGen/prompts.mjs";
import {
  buildDiscGenSystemPrompt,
  buildDiscGenUserPrompt,
  DISC_OPENING_STYLES,
  DISC_COURSE_LIST,
  DISC_STUDENT_NAMES,
  pickOpeningStyle,
} from "../lib/ai/prompts/academicWriting.js";
import { EMAIL_CATEGORIES, buildEmailGenPrompt } from "../lib/ai/prompts/emailWriting.js";

// CommonJS modules (reading prompt builders)
const { buildAPPrompt } = require("../lib/readingGen/apPromptBuilder.js");
const { buildCTWPrompt } = require("../lib/readingGen/ctwPromptBuilder.js");
const { buildRDLPrompt, buildShortRDLPrompt } = require("../lib/readingGen/rdlPromptBuilder.js");

function readJSON(rel) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));
}

function loadBSExistingAnswers(limit = 100) {
  // Real DeepSeek pipeline (appendBSSets.mjs main()) passes the FULL existing
  // answer list to the prompt. We sample a recent slice to keep the prompt
  // length manageable for the routine.
  try {
    const j = readJSON("data/buildSentence/questions.json");
    const sets = j.question_sets || [];
    const all = sets.flatMap((s) => (s.questions || []).map((q) => q.answer).filter(Boolean));
    return all.slice(-limit);
  } catch {
    return [];
  }
}

function loadADExistingTopics(limit = 40) {
  try {
    const items = readJSON("data/academicWriting/prompts.json");
    return (items || []).slice(-limit).map((q) => {
      const text = String(q?.professor?.text || "").trim();
      return text.slice(0, 80);
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function loadEmailRecentNames(limit = 40) {
  try {
    const items = readJSON("data/emailWriting/prompts.json");
    return Array.from(new Set((items || []).slice(-limit).map((q) => String(q?.to || "").trim()).filter(Boolean)));
  } catch {
    return [];
  }
}

function loadEmailRecentSubjects(limit = 20) {
  try {
    const items = readJSON("data/emailWriting/prompts.json");
    return (items || []).slice(-limit).map((q) => String(q?.subject || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function loadEmailRecentVerbs(limit = 20) {
  try {
    const items = readJSON("data/emailWriting/prompts.json");
    const verbs = (items || []).slice(-limit).flatMap((q) =>
      (q.goals || []).map((g) => String(g || "").trim().split(/\s+/)[0]).filter(Boolean),
    );
    return Array.from(new Set(verbs));
  } catch {
    return [];
  }
}

function loadReadingExcludeSubjects(file, limit = 30) {
  try {
    const j = readJSON(file);
    const items = j.items || [];
    return items.slice(-limit).map((it) => `${it.topic}/${it.subtopic || ""}`.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Dispatch on bank ────────────────────────────────────────────────────

const bank = String(process.argv[2] || "").trim();

function printBS() {
  const existing = loadBSExistingAnswers(100);
  console.log(bsGenPrompt(1, existing));
}

function printDisc() {
  // System prompt: full rules. Few-shot examples optional — we attach last 4
  // real TPO references for style anchoring.
  let fewShot = [];
  try {
    const tpo = readJSON("data/academicWriting/real_tpo_reference.json");
    fewShot = (tpo || []).slice(0, 4);
  } catch {}

  const systemPrompt = buildDiscGenSystemPrompt(fewShot);

  console.log("# ===== SYSTEM PROMPT (rules) =====\n");
  console.log(systemPrompt);
  console.log("\n# ===== ALLOWED COURSE LIST =====\n");
  console.log(DISC_COURSE_LIST.join(", "));
  console.log("\n# ===== ALLOWED STUDENT NAMES (use Claire/Paul ~35%; rest from this pool) =====\n");
  console.log(DISC_STUDENT_NAMES.join(", "));
  console.log("\n# ===== OPENING STYLES (pick one per item, weighted) =====\n");
  for (const o of DISC_OPENING_STYLES) {
    console.log(`- weight=${o.weight}  style=${o.style}: ${o.instruction}`);
  }
  console.log("\n# ===== RECENT PROFESSOR-POST PREFIXES (avoid topic overlap) =====\n");
  for (const t of loadADExistingTopics(30)) console.log(`- ${t}`);
  console.log("\n# ===== INSTRUCTION =====\n");
  console.log("Generate N Discussion items (caller will tell you N). For EACH item:");
  console.log("1. Pick a course (vary across the batch; bias toward under-represented from the bank-stats summary).");
  console.log("2. Pick two student names from the allowed pool — different names per item.");
  console.log("3. Pick one opening style at random respecting the weights.");
  console.log("4. Pick whether s2 references s1 by name (about 37% of real TPO does this).");
  console.log("5. Compose the full item following the SYSTEM PROMPT rules above.");
  console.log("6. Output a JSON array; each element matches:");
  console.log('   {"course":"...","professor":{"name":"Professor","text":"..."},"students":[{"name":"...","text":"..."},{"name":"...","text":"..."}]}');
}

function printEmail() {
  const avoid = {
    names: loadEmailRecentNames(15),
    subjects: loadEmailRecentSubjects(10),
    verbPatterns: loadEmailRecentVerbs(15),
  };
  console.log("# ===== EMAIL CATEGORIES (pick across the batch, weighted) =====\n");
  for (const cat of EMAIL_CATEGORIES) {
    console.log(`- weight=${cat.weight}  topic="${cat.topic}"  name=${cat.name}`);
    console.log(`  examples: ${cat.examples}`);
    console.log(`  tones: ${cat.tones}`);
  }
  console.log("\n# ===== PER-CATEGORY PROMPT (resolve one for the category you pick) =====\n");
  console.log("--- For category Academic (A) ---");
  console.log(buildEmailGenPrompt(EMAIL_CATEGORIES[0], avoid));
  console.log("\n# ===== INSTRUCTION =====\n");
  console.log("Generate N Email items (caller will tell you N). For EACH item:");
  console.log("1. Pick one EMAIL_CATEGORY (vary across the batch; bias toward under-represented).");
  console.log("2. Use the category's specific prompt (same structure as the Academic example above, with the chosen category's name/topic/examples/tones).");
  console.log("3. Apply the AVOID rules (names, subjects, verbs) consistently.");
  console.log("4. Output a JSON array; each element matches:");
  console.log('   {"topic":"...","scenario":"...","direction":"Write an email to ...","goals":["...","...","..."],"to":"...","subject":"..."}');
}

function printAP() {
  const excludeSubjects = loadReadingExcludeSubjects("data/reading/bank/ap.json", 30);
  console.log(buildAPPrompt(5, { excludeSubjects }));
}

function printCTW() {
  const excludeSubjects = loadReadingExcludeSubjects("data/reading/bank/ctw.json", 30);
  console.log(buildCTWPrompt(6, { excludeSubjects }));
}

function printRDLShort() {
  console.log(buildShortRDLPrompt(4, {}));
}

function printRDLLong() {
  console.log(buildRDLPrompt(2, {}));
}

const handlers = {
  bs: printBS,
  disc: printDisc,
  email: printEmail,
  ap: printAP,
  ctw: printCTW,
  "rdl-short": printRDLShort,
  "rdl-long": printRDLLong,
};

if (!bank || !handlers[bank]) {
  console.error(`Usage: node scripts/print-bank-prompt.mjs <bank>`);
  console.error(`Valid banks: ${Object.keys(handlers).join(", ")}`);
  process.exit(1);
}

handlers[bank]();
