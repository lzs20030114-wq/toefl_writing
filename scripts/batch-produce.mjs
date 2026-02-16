#!/usr/bin/env node
/**
 * Build a Sentence 题库批量生产脚本
 *
 * 用法：
 *   node scripts/batch-produce.mjs                    # 默认生成 6 套
 *   node scripts/batch-produce.mjs --sets 10          # 生成 10 套
 *   node scripts/batch-produce.mjs --append           # 追加到现有题库（不覆盖）
 *   node scripts/batch-produce.mjs --sets 4 --append  # 追加 4 套
 *   node scripts/batch-produce.mjs --dry-run          # 只验证现有题库，不生成
 *   node scripts/batch-produce.mjs --validate-only    # 同 --dry-run
 *
 * 环境变量（可选）：
 *   DEEPSEEK_API_KEY        必须，API密钥（自动从 .env.local / .env 读取）
 *   DEEPSEEK_PROXY_URL      代理地址
 *   BS_CANDIDATE_ROUNDS     每批候选轮数（默认按套数自动计算）
 *   BS_EASY_BOOST_ROUNDS    easy补充轮数（默认16）
 *   BS_HARD_BOOST_ROUNDS    hard补充轮数（默认16）
 *
 * 流程：
 *   1. 读取现有题库（如有）
 *   2. 调用 AI 批量生成候选题
 *   3. 多层验证筛选（schema → runtime → AI审核 → 风格门控）
 *   4. 按 3easy/5medium/2hard 组装成套
 *   5. 全局严格验证
 *   6. 输出统计报告
 *   7. 写入 data/buildSentence/questions.json
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

/* ─── 参数解析 ─── */
function parseArgs(argv) {
  const args = {
    sets: 6,
    append: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sets" && argv[i + 1]) {
      args.sets = Math.max(1, parseInt(argv[i + 1], 10) || 6);
      i++;
    }
    if (argv[i] === "--append") args.append = true;
    if (argv[i] === "--dry-run" || argv[i] === "--validate-only") args.dryRun = true;
  }
  return args;
}

/* ─── 环境变量加载 ─── */
function loadEnv() {
  const paths = [
    resolve(__dirname, "..", ".env.local"),
    resolve(__dirname, "..", ".env"),
  ];
  for (const p of paths) {
    try {
      const txt = readFileSync(p, "utf8");
      txt.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
        if (!m) return;
        if (process.env[m[1]]) return;
        process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch (_) {}
  }
}

/* ─── 验证现有题库 ─── */
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

  // 统计
  printStats(data);
  return data;
}

/* ─── 统计报告 ─── */
function printStats(data) {
  const { isEmbeddedQuestion } = require("../lib/questionBank/etsProfile.js");
  const { estimateQuestionDifficulty } = require("../lib/questionBank/difficultyControl.js");
  const sets = data.question_sets || [];
  let total = 0, pf = 0, dt = 0, qm = 0, em = 0, neg = 0;
  let totalChunks = 0, multiWord = 0;
  const answerLens = [];

  sets.forEach((s) =>
    s.questions.forEach((q) => {
      total++;
      if (q.prefilled.length > 0) pf++;
      if (q.distractor) dt++;
      if (q.has_question_mark) qm++;
      if (isEmbeddedQuestion(q.grammar_points)) em++;
      if ((q.grammar_points || []).join(" ").toLowerCase().includes("negation")) neg++;
      q.chunks.forEach((c) => {
        totalChunks++;
        if (c.split(/\s+/).length >= 2) multiWord++;
      });
      answerLens.push(q.answer.split(/\s+/).length);
    })
  );

  const pct = (n, d) => `${Math.round((n / (d || 1)) * 100)}%`;
  const avg = (arr) => (arr.reduce((a, b) => a + b, 0) / (arr.length || 1)).toFixed(1);

  console.log(`\n${"═".repeat(50)}`);
  console.log(`  QUESTION BANK REPORT — ${total} questions, ${sets.length} sets`);
  console.log(`${"═".repeat(50)}`);
  console.log(`  Prefilled     ${pf}/${total} (${pct(pf, total)})   [ETS target: 55%]`);
  console.log(`  Distractor    ${dt}/${total} (${pct(dt, total)})   [ETS target: 30%]`);
  console.log(`  Question mark ${qm}/${total} (${pct(qm, total)})   [ETS target: 57%]`);
  console.log(`  Embedded Q    ${em}/${total} (${pct(em, total)})   [ETS target: 43%]`);
  console.log(`  Negation      ${neg}/${total} (${pct(neg, total)})   [ETS target: 11%]`);
  console.log(`  Multi-word    ${multiWord}/${totalChunks} (${pct(multiWord, totalChunks)})   [target: ~60%]`);
  console.log(`  Avg answer    ${avg(answerLens)} words      [ETS: 8-12]`);
  console.log(`${"─".repeat(50)}`);

  sets.forEach((s) => {
    const qs = s.questions;
    const diff = { easy: 0, medium: 0, hard: 0 };
    qs.forEach((q) => {
      diff[estimateQuestionDifficulty(q).bucket]++;
    });
    const sPf = qs.filter((q) => q.prefilled.length > 0).length;
    const sDt = qs.filter((q) => q.distractor).length;
    const sQm = qs.filter((q) => q.has_question_mark).length;
    const sEm = qs.filter((q) => isEmbeddedQuestion(q.grammar_points)).length;
    console.log(
      `  Set ${String(s.set_id).padStart(2)}: E${diff.easy}/M${diff.medium}/H${diff.hard}  pf=${sPf} dt=${sDt} qm=${sQm} em=${sEm}`
    );
  });

  console.log(`${"═".repeat(50)}\n`);
}

/* ─── 生成 ─── */
async function generate(targetSets, existingSets = []) {
  const startSetId = existingSets.length > 0
    ? Math.max(...existingSets.map((s) => s.set_id)) + 1
    : 1;

  // 自动计算候选轮数：每套约需 4-5 轮
  const rounds = Number(process.env.BS_CANDIDATE_ROUNDS) || Math.max(8, targetSets * 5);

  console.log(`\nGenerating ${targetSets} new set(s)...`);
  console.log(`Candidate rounds: ${rounds}`);
  console.log(`Starting set ID: ${startSetId}`);

  // 设置环境变量，调用现有生成管线
  const env = {
    ...process.env,
    BS_TARGET_SETS: String(targetSets),
    BS_CANDIDATE_ROUNDS: String(rounds),
  };

  // 先生成到临时文件，避免破坏现有数据
  const tmpPath = OUTPUT_PATH + ".tmp";
  const genScript = resolve(__dirname, "generateBSQuestions.mjs");

  try {
    const result = execSync(`node "${genScript}"`, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30 * 60 * 1000, // 30 分钟超时
      cwd: resolve(__dirname, ".."),
    });
    console.log(result.toString());
  } catch (e) {
    const stdout = e.stdout?.toString() || "";
    const stderr = e.stderr?.toString() || "";
    console.log(stdout);
    if (stderr) console.error(stderr);
    throw new Error("Generation failed — see output above");
  }

  // 读取生成结果
  const newData = JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
  return newData.question_sets || [];
}

/* ─── 合并 ─── */
function mergeSets(existingSets, newSets) {
  // 重新编号新的 set_id，避免冲突
  const maxId = existingSets.length > 0
    ? Math.max(...existingSets.map((s) => s.set_id))
    : 0;
  const renumbered = newSets.map((s, i) => ({
    ...s,
    set_id: maxId + i + 1,
    questions: s.questions.map((q, qi) => ({
      ...q,
      id: `ets_s${maxId + i + 1}_q${qi + 1}`,
    })),
  }));
  return [...existingSets, ...renumbered];
}

/* ─── 最终验证 ─── */
function finalValidate() {
  console.log("Running final strict validation...");
  try {
    execSync(`node "${VALIDATE_SCRIPT}" --strict`, { stdio: "inherit" });
    return true;
  } catch (_) {
    return false;
  }
}

/* ─── 主流程 ─── */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();

  console.log("╔════════════════════════════════════════════╗");
  console.log("║  Build a Sentence — Batch Production Tool  ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log(`Mode: ${args.dryRun ? "validate-only" : args.append ? "append" : "overwrite"}`);
  console.log(`Target sets: ${args.sets}`);

  // Step 1: 检查现有题库
  const existingData = validateExisting();
  const existingSets = existingData?.question_sets || [];

  // 仅验证模式
  if (args.dryRun) {
    console.log("Dry-run mode — no generation performed.");
    process.exit(0);
  }

  // 检查 API key
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("ERROR: DEEPSEEK_API_KEY not found in environment or .env.local");
    process.exit(1);
  }

  // Step 2: 生成新题
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

  // Step 3: 合并（如果是追加模式）
  let finalSets;
  if (args.append && existingSets.length > 0) {
    finalSets = mergeSets(existingSets, newSets);
    console.log(`Merged: ${existingSets.length} existing + ${newSets.length} new = ${finalSets.length} total sets`);
  } else {
    finalSets = newSets;
  }

  // Step 4: 写入
  const output = {
    version: "1.2",
    generated_at: new Date().toISOString(),
    question_sets: finalSets,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`Saved ${finalSets.length} set(s) to ${OUTPUT_PATH}`);

  // Step 5: 最终验证
  const valid = finalValidate();
  if (!valid) {
    console.error("FINAL VALIDATION FAILED — check output above");
    process.exit(1);
  }

  // Step 6: 统计报告
  const finalData = JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
  printStats(finalData);

  console.log("Done. Ready to commit and deploy.");
}

main().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
