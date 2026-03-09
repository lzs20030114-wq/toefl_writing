#!/usr/bin/env node
/**
 * 一键生成 + 质量对比报告
 *
 * Usage:
 *   node scripts/produce-and-report.mjs              # 默认生成 5 套
 *   node scripts/produce-and-report.mjs --sets 10    # 生成 10 套
 *   node scripts/produce-and-report.mjs --report-only # 仅对已有 bank 出报告
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const OUTPUT_PATH = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const POOL_PATH = resolve(__dirname, "..", "data", "buildSentence", "reserve_pool.json");

// ─── Args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { sets: 5, reportOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sets" && argv[i + 1]) {
      args.sets = Math.max(1, parseInt(argv[i + 1], 10) || 5);
      i++;
    }
    if (argv[i] === "--report-only") args.reportOnly = true;
  }
  return args;
}

// ─── Load .env ───────────────────────────────────────────────────────────────
function loadEnv() {
  for (const p of [resolve(__dirname, "..", ".env.local"), resolve(__dirname, "..", ".env")]) {
    try {
      readFileSync(p, "utf8").split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch { /* ignore */ }
  }
}

// ─── Generation ──────────────────────────────────────────────────────────────
function clearBank() {
  writeFileSync(OUTPUT_PATH, JSON.stringify({ question_sets: [], generated_at: new Date().toISOString() }, null, 2));
  if (existsSync(POOL_PATH)) writeFileSync(POOL_PATH, "[]");
  console.log("[prepare] Cleared questions.json and reserve_pool.json\n");
}

function runGeneration(sets) {
  const rounds = Math.max(8, sets * 5);
  const genScript = resolve(__dirname, "generateBSQuestions.mjs");

  console.log(`[generate] Target: ${sets} sets, max ${rounds} rounds\n`);

  const env = {
    ...process.env,
    BS_TARGET_SETS: String(sets),
    BS_CANDIDATE_ROUNDS: String(rounds),
  };

  execSync(`node "${genScript}"`, {
    env,
    stdio: "inherit",
    timeout: 45 * 60 * 1000,
    cwd: resolve(__dirname, ".."),
  });
}

function runValidation() {
  const script = resolve(__dirname, "validate-bank.js");
  try {
    execSync(`node "${script}" --strict`, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────
function generateReport(data) {
  const { isEmbeddedQuestion, isNegation, TPO_REFERENCE_PROFILE: T } = require("../lib/questionBank/etsProfile.js");
  const { estimateQuestionDifficulty } = require("../lib/questionBank/difficultyControl.js");

  const sets = data.question_sets || [];
  const all = sets.flatMap((s) => s.questions);
  const N = all.length;
  if (N === 0) { console.log("No questions to report."); return; }

  // ── Helpers ──
  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : "0.0") + "%";
  const bar = (label, w = 60) => {
    const pad = Math.max(0, w - label.length - 4);
    return "── " + label + " " + "─".repeat(pad);
  };
  const fmtRow = (label, value, tpo, unit = "") => {
    const vStr = typeof value === "number" ? value.toFixed(1) : String(value);
    const tStr = typeof tpo === "number" ? tpo.toFixed(1) : String(tpo);
    const diff = typeof value === "number" && typeof tpo === "number" ? value - tpo : null;
    const diffStr = diff !== null ? (diff >= 0 ? "+" : "") + diff.toFixed(1) : "";
    return `  ${label.padEnd(22)} ${(vStr + unit).padStart(8)}   ${("TPO: " + tStr + unit).padStart(14)}   ${diffStr.padStart(7)}`;
  };

  // ── 1. Basic Style Metrics ──
  const prefilled = all.filter((q) => q.prefilled.length > 0).length;
  const distractor = all.filter((q) => q.distractor).length;
  const qmark = all.filter((q) => q.has_question_mark).length;
  const embedded = all.filter((q) => isEmbeddedQuestion(q.grammar_points)).length;
  const negation = all.filter((q) => isNegation(q.grammar_points)).length;
  const avgAnswer = all.reduce((s, q) => s + q.answer.split(/\s+/).length, 0) / N;

  let totalChunks = 0;
  let multiWordChunks = 0;
  let effectiveChunks = 0;
  all.forEach((q) => {
    const dist = q.distractor ? q.distractor.toLowerCase() : null;
    q.chunks.forEach((c) => {
      totalChunks++;
      const isDist = dist && c.toLowerCase() === dist;
      if (!isDist) effectiveChunks++;
      if (c.split(/\s+/).length >= 2) multiWordChunks++;
    });
  });
  const avgEffective = effectiveChunks / N;
  const multiWordPct = (multiWordChunks / totalChunks) * 100;

  console.log("\n" + "═".repeat(60));
  console.log("  QUESTION BANK QUALITY REPORT");
  console.log("  " + N + " questions, " + sets.length + " sets");
  console.log("═".repeat(60));

  console.log("\n" + bar("Style Metrics vs TPO"));
  console.log("  Metric                    Ours        TPO       Diff");
  console.log("  " + "─".repeat(54));
  console.log(fmtRow("Prefilled ratio", (prefilled / N) * 100, T.givenWordRatio * 100, "%"));
  console.log(fmtRow("Distractor ratio", (distractor / N) * 100, T.distractorRatio * 100, "%"));
  console.log(fmtRow("Question mark", (qmark / N) * 100, T.qmarkRatio * 100, "%"));
  console.log(fmtRow("Embedded Q", (embedded / N) * 100, T.embeddedRatio * 100, "%"));
  console.log(fmtRow("Negation", (negation / N) * 100, T.negationRatio * 100, "%"));
  console.log(fmtRow("Multi-word chunks", multiWordPct, 23.0, "%"));
  console.log(fmtRow("Avg answer words", avgAnswer, T.avgAnswerWords));
  console.log(fmtRow("Avg effective chunks", avgEffective, T.avgEffectiveChunks));

  // ── 2. Difficulty Distribution ──
  const diffCounts = { easy: 0, medium: 0, hard: 0 };
  all.forEach((q) => { diffCounts[estimateQuestionDifficulty(q).bucket]++; });

  console.log("\n" + bar("Difficulty Distribution"));
  console.log("  Bucket       Ours        TPO       Diff");
  console.log("  " + "─".repeat(44));
  console.log(fmtRow("Easy", (diffCounts.easy / N) * 100, 10, "%"));
  console.log(fmtRow("Medium", (diffCounts.medium / N) * 100, 70, "%"));
  console.log(fmtRow("Hard", (diffCounts.hard / N) * 100, 20, "%"));

  // ── 3. Type Distribution ──
  function classifyType(q) {
    const gps = (q.grammar_points || []).join(" ").toLowerCase();
    const a = (q.answer || "").toLowerCase();
    if (isNegation(q.grammar_points) && !isEmbeddedQuestion(q.grammar_points)) return "negation-only";
    if (isNegation(q.grammar_points) && isEmbeddedQuestion(q.grammar_points)) return "negation+embedded";
    if (/1st.embedded|1st.person/.test(gps) || (/^i\b/.test(a) && /\b(what|when|where|who|how|whether|if|why)\b/.test(a)))
      return "1st-embedded";
    if (/3rd.report|indirect.question|reported/.test(gps) ||
        /\b(wanted to know|asked|was curious|needs to know|wants to know|wondered|inquired|needed to find out)\b/.test(a))
      return "3rd-reporting";
    if (q.has_question_mark || /interrogative|polite.*question|question frame/.test(gps) ||
        /^(can you|could you|do you know|would you)/.test(a))
      return "interrogative";
    if (/relative|contact clause/.test(gps)) return "relative";
    return "direct";
  }

  const typeCounts = {};
  all.forEach((q) => { const t = classifyType(q); typeCounts[t] = (typeCounts[t] || 0) + 1; });

  console.log("\n" + bar("Answer Type Distribution"));
  console.log("  Type                      Count    Ratio");
  console.log("  " + "─".repeat(44));
  Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
    console.log(`  ${t.padEnd(24)} ${String(c).padStart(4)}    ${pct(c, N).padStart(6)}`);
  });

  // ── 4. Prefilled Distribution ──
  const pfLen = { "0w (none)": 0, "1w": 0, "2w": 0, "3w": 0 };
  const pfValues = {};
  all.forEach((q) => {
    if (q.prefilled.length === 0) { pfLen["0w (none)"]++; return; }
    const wc = q.prefilled[0].trim().split(/\s+/).length;
    const key = wc + "w";
    pfLen[key] = (pfLen[key] || 0) + 1;
    const v = q.prefilled[0].toLowerCase();
    pfValues[v] = (pfValues[v] || 0) + 1;
  });

  console.log("\n" + bar("Prefilled Word-Length Distribution"));
  console.log("  Length       Ours        TPO       Diff");
  console.log("  " + "─".repeat(44));
  console.log(fmtRow("0w (none)", (pfLen["0w (none)"] / N) * 100, 15, "%"));
  console.log(fmtRow("1w", (pfLen["1w"] / N) * 100, 10, "%"));
  console.log(fmtRow("2w", (pfLen["2w"] / N) * 100, 56, "%"));
  console.log(fmtRow("3w", (pfLen["3w"] / N) * 100, 34, "%"));

  console.log("\n  Top prefilled values:");
  Object.entries(pfValues).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => {
    console.log(`    "${k}": ${v}`);
  });

  // ── 5. Distractor Distribution ──
  const dtValues = {};
  let dtMorpho = 0;
  let dtFuncWord = 0;
  all.forEach((q) => {
    if (!q.distractor) return;
    const d = q.distractor.toLowerCase();
    dtValues[d] = (dtValues[d] || 0) + 1;
    if (/^(did|do|does|was|were|is|are|has|have|had|that|which|who|whom|where|when|if|whether)$/.test(d)) dtFuncWord++;
    else dtMorpho++;
  });

  console.log("\n" + bar("Distractor Distribution"));
  console.log(`  Morphological variants: ${dtMorpho}  (${pct(dtMorpho, distractor)})`);
  console.log(`  Function-word swaps:    ${dtFuncWord}  (${pct(dtFuncWord, distractor)})`);
  console.log("\n  Top distractor values:");
  Object.entries(dtValues).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => {
    console.log(`    "${k}": ${v}`);
  });

  // ── 6. Per-Set Summary ──
  console.log("\n" + bar("Per-Set Summary"));
  console.log("  Set   E/M/H   PF  DT  QM  EMB NEG  AvgWords");
  console.log("  " + "─".repeat(52));
  sets.forEach((s) => {
    const d = { easy: 0, medium: 0, hard: 0 };
    let sw = 0;
    s.questions.forEach((q) => {
      d[estimateQuestionDifficulty(q).bucket]++;
      sw += q.answer.split(/\s+/).length;
    });
    const pf = s.questions.filter((q) => q.prefilled.length > 0).length;
    const dt = s.questions.filter((q) => q.distractor).length;
    const qm = s.questions.filter((q) => q.has_question_mark).length;
    const em = s.questions.filter((q) => isEmbeddedQuestion(q.grammar_points)).length;
    const ng = s.questions.filter((q) => isNegation(q.grammar_points)).length;
    const aw = (sw / s.questions.length).toFixed(1);
    console.log(`  ${String(s.set_id).padStart(3)}   ${d.easy}/${d.medium}/${d.hard}   ${String(pf).padStart(2)}  ${String(dt).padStart(2)}  ${String(qm).padStart(2)}  ${String(em).padStart(3)} ${String(ng).padStart(3)}  ${String(aw).padStart(8)}`);
  });

  // ── 7. Overall Grade ──
  const checks = [
    { name: "Prefilled ratio", ok: Math.abs(prefilled / N - T.givenWordRatio) < 0.15 },
    { name: "Distractor ratio", ok: Math.abs(distractor / N - T.distractorRatio) < 0.15 },
    { name: "Embedded Q ratio", ok: Math.abs(embedded / N - T.embeddedRatio) < 0.2 },
    { name: "Negation ratio", ok: Math.abs(negation / N - T.negationRatio) < 0.15 },
    { name: "Avg answer words", ok: Math.abs(avgAnswer - T.avgAnswerWords) < 2 },
    { name: "Avg effective chunks", ok: Math.abs(avgEffective - T.avgEffectiveChunks) < 1.5 },
    { name: "Difficulty balance", ok: diffCounts.medium / N >= 0.5 && diffCounts.medium / N <= 0.85 },
    { name: "Multi-word chunk %", ok: multiWordPct < 40 },
  ];

  const passed = checks.filter((c) => c.ok).length;
  console.log("\n" + bar("Overall Grade"));
  checks.forEach((c) => {
    console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
  });
  console.log(`\n  Result: ${passed}/${checks.length} checks passed`);
  console.log("═".repeat(60) + "\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();

  console.log("══════════════════════════════════════════════════════════════");
  console.log("  Build a Sentence — Produce & Report");
  console.log("══════════════════════════════════════════════════════════════");

  if (!args.reportOnly) {
    if (!process.env.DEEPSEEK_API_KEY) {
      console.error("ERROR: DEEPSEEK_API_KEY not found in environment or .env.local");
      process.exit(1);
    }

    clearBank();
    runGeneration(args.sets);

    console.log("\n[validate] Running strict validation...");
    if (!runValidation()) {
      console.error("[validate] FAILED — check output above.");
      process.exit(1);
    }
    console.log("[validate] PASSED\n");
  } else {
    console.log("  --report-only mode: skipping generation\n");
  }

  if (!existsSync(OUTPUT_PATH)) {
    console.error("No question bank found at " + OUTPUT_PATH);
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
  generateReport(data);
}

main().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
