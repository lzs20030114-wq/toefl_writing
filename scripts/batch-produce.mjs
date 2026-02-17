#!/usr/bin/env node
/**
 * Build a Sentence batch production tool.
 *
 * Usage:
 *   node scripts/batch-produce.mjs
 *   node scripts/batch-produce.mjs --sets 10
 *   node scripts/batch-produce.mjs --append
 *   node scripts/batch-produce.mjs --sets 4 --append
 *   node scripts/batch-produce.mjs --dry-run
 *   node scripts/batch-produce.mjs --validate-only
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const OUTPUT_PATH = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const VALIDATE_SCRIPT = resolve(__dirname, "validate-bank.js");

function parseArgs(argv) {
  const args = { sets: 6, append: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--sets" && argv[i + 1]) {
      args.sets = Math.max(1, parseInt(argv[i + 1], 10) || 6);
      i += 1;
      continue;
    }
    if (argv[i] === "--append") args.append = true;
    if (argv[i] === "--dry-run" || argv[i] === "--validate-only") args.dryRun = true;
  }
  return args;
}

function loadEnv() {
  const paths = [resolve(__dirname, "..", ".env.local"), resolve(__dirname, "..", ".env")];
  for (const p of paths) {
    try {
      const txt = readFileSync(p, "utf8");
      txt.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
        if (!m) return;
        if (process.env[m[1]]) return;
        process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch {
      // Ignore missing env files.
    }
  }
}

function printStats(data) {
  const { isEmbeddedQuestion } = require("../lib/questionBank/etsProfile.js");
  const { estimateQuestionDifficulty } = require("../lib/questionBank/difficultyControl.js");
  const sets = data.question_sets || [];

  let total = 0;
  let prefilled = 0;
  let distractor = 0;
  let qmark = 0;
  let embedded = 0;
  let negation = 0;
  let totalChunks = 0;
  let multiWord = 0;
  const answerLens = [];

  sets.forEach((set) => {
    set.questions.forEach((q) => {
      total += 1;
      if (q.prefilled.length > 0) prefilled += 1;
      if (q.distractor) distractor += 1;
      if (q.has_question_mark) qmark += 1;
      if (isEmbeddedQuestion(q.grammar_points)) embedded += 1;
      if ((q.grammar_points || []).join(" ").toLowerCase().includes("negation")) negation += 1;

      q.chunks.forEach((c) => {
        totalChunks += 1;
        if (c.split(/\s+/).length >= 2) multiWord += 1;
      });
      answerLens.push(q.answer.split(/\s+/).length);
    });
  });

  const pct = (n, d) => `${Math.round((n / (d || 1)) * 100)}%`;
  const avg = (arr) => (arr.reduce((a, b) => a + b, 0) / (arr.length || 1)).toFixed(1);
  const bar = "=".repeat(50);

  console.log(`\n${bar}`);
  console.log(`QUESTION BANK REPORT - ${total} questions, ${sets.length} sets`);
  console.log(bar);
  console.log(`Prefilled     ${prefilled}/${total} (${pct(prefilled, total)}) [ETS target: 55%]`);
  console.log(`Distractor    ${distractor}/${total} (${pct(distractor, total)}) [ETS target: 30%]`);
  console.log(`Question mark ${qmark}/${total} (${pct(qmark, total)}) [ETS target: 57%]`);
  console.log(`Embedded Q    ${embedded}/${total} (${pct(embedded, total)}) [ETS target: 43%]`);
  console.log(`Negation      ${negation}/${total} (${pct(negation, total)}) [ETS target: 11%]`);
  console.log(`Multi-word    ${multiWord}/${totalChunks} (${pct(multiWord, totalChunks)}) [target: ~60%]`);
  console.log(`Avg answer    ${avg(answerLens)} words [ETS: 8-12]`);
  console.log("-".repeat(50));

  sets.forEach((set) => {
    const diff = { easy: 0, medium: 0, hard: 0 };
    set.questions.forEach((q) => {
      diff[estimateQuestionDifficulty(q).bucket] += 1;
    });
    const setPrefilled = set.questions.filter((q) => q.prefilled.length > 0).length;
    const setDistractor = set.questions.filter((q) => q.distractor).length;
    const setQmark = set.questions.filter((q) => q.has_question_mark).length;
    const setEmbedded = set.questions.filter((q) => isEmbeddedQuestion(q.grammar_points)).length;
    console.log(
      `Set ${String(set.set_id).padStart(2)}: E${diff.easy}/M${diff.medium}/H${diff.hard} pf=${setPrefilled} dt=${setDistractor} qm=${setQmark} em=${setEmbedded}`,
    );
  });
  console.log(`${bar}\n`);
}

function validateExisting() {
  if (!existsSync(OUTPUT_PATH)) {
    console.log("No existing question bank found.");
    return null;
  }

  const data = JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
  const sets = data.question_sets || [];
  console.log(`\nExisting bank: ${sets.length} set(s), generated at ${data.generated_at || "unknown"}`);

  try {
    execSync(`node "${VALIDATE_SCRIPT}" --strict`, { stdio: "pipe" });
    console.log("Existing bank validation: PASSED");
  } catch (e) {
    console.log("Existing bank validation: FAILED");
    console.log(e.stderr?.toString() || e.stdout?.toString() || "");
  }

  printStats(data);
  return data;
}

async function generate(targetSets) {
  const rounds = Number(process.env.BS_CANDIDATE_ROUNDS) || Math.max(8, targetSets * 5);

  console.log(`\nGenerating ${targetSets} new set(s)...`);
  console.log(`Candidate rounds: ${rounds}`);

  const env = {
    ...process.env,
    BS_TARGET_SETS: String(targetSets),
    BS_CANDIDATE_ROUNDS: String(rounds),
  };

  const genScript = resolve(__dirname, "generateBSQuestions.mjs");

  try {
    const result = execSync(`node "${genScript}"`, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30 * 60 * 1000,
      cwd: resolve(__dirname, ".."),
    });
    console.log(result.toString());
  } catch (e) {
    const stdout = e.stdout?.toString() || "";
    const stderr = e.stderr?.toString() || "";
    console.log(stdout);
    if (stderr) console.error(stderr);
    throw new Error("Generation failed. See output above.");
  }

  const newData = JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
  return newData.question_sets || [];
}

function mergeSets(existingSets, newSets) {
  const maxId = existingSets.length > 0 ? Math.max(...existingSets.map((s) => s.set_id)) : 0;
  const renumbered = newSets.map((set, i) => ({
    ...set,
    set_id: maxId + i + 1,
    questions: set.questions.map((q, qi) => ({
      ...q,
      id: `ets_s${maxId + i + 1}_q${qi + 1}`,
    })),
  }));
  return [...existingSets, ...renumbered];
}

function finalValidate() {
  console.log("Running final strict validation...");
  try {
    execSync(`node "${VALIDATE_SCRIPT}" --strict`, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();

  console.log("==================================================");
  console.log("Build a Sentence - Batch Production Tool");
  console.log("==================================================");
  console.log(`Mode: ${args.dryRun ? "validate-only" : args.append ? "append" : "overwrite"}`);
  console.log(`Target sets: ${args.sets}`);

  const existingData = validateExisting();
  const existingSets = existingData?.question_sets || [];

  if (args.dryRun) {
    console.log("Dry-run mode: no generation performed.");
    process.exit(0);
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("ERROR: DEEPSEEK_API_KEY not found in environment or .env.local");
    process.exit(1);
  }

  let newSets;
  try {
    newSets = await generate(args.sets);
  } catch (e) {
    console.error(`Generation failed: ${e.message}`);
    process.exit(1);
  }

  if (newSets.length === 0) {
    console.error("No sets were generated.");
    process.exit(1);
  }

  console.log(`Generated ${newSets.length} new set(s).`);

  const finalSets = args.append && existingSets.length > 0
    ? mergeSets(existingSets, newSets)
    : newSets;

  if (args.append && existingSets.length > 0) {
    console.log(`Merged: ${existingSets.length} existing + ${newSets.length} new = ${finalSets.length} total sets`);
  }

  const output = {
    version: "1.2",
    generated_at: new Date().toISOString(),
    question_sets: finalSets,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`Saved ${finalSets.length} set(s) to ${OUTPUT_PATH}`);

  const valid = finalValidate();
  if (!valid) {
    console.error("FINAL VALIDATION FAILED. Check output above.");
    process.exit(1);
  }

  const finalData = JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
  printStats(finalData);

  console.log("Done. Ready to commit and deploy.");
}

main().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
