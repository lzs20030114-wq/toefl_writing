/**
 * run-deterministic-checks.mjs — 对删后各库全量跑确定性检查（不调用任何 AI）
 *
 * 覆盖 11 库：ap/ctw/rdl-short/rdl-long（阅读）、lcr/lc/la/lat（听力）、
 * repeat/interview（口语）、bs（造句）。每条 item 跑对应题型 validator：
 *   - hardFail  = validator 判定的硬错误（BS 只算 fatal；format/content 归 warnings）
 *   - flavor    = 听力四型/口语两型 validator 的 scoreFlavor 总分（其余题型 null）
 *   - warnings  = validator 的软告警
 *   - validator_threw = validator 自身抛异常的 message（不算题目 hardFail，单独列，
 *                       collect-verdicts.mjs 会把这类条目放进独立清单、不删）
 * CTW 附加机械一致性：blanked_text + blanks 能否还原 passage，不能 → hardFail。
 *
 * 用法：
 *   node scripts/ops/review/run-deterministic-checks.mjs --out <file>
 *
 * 输出 JSON（--out 指定路径，建议放 scratchpad）：
 *   { bankType: { itemId: { hardFail:[...], flavor:number|null, warnings:[...],
 *                           validator_threw?: string } } }
 * 不做 git commit。
 */

import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { createRequire } from "module";
import { repoRoot, parseArgs } from "../_shared.mjs";
import {
  MCQ_BANKS, CTW_FILE, REPEAT_FILE, INTERVIEW_FILE,
  loadBankItems, loadBSQuestions,
} from "./_reviewShared.mjs";

const require = createRequire(import.meta.url);
const { validateAPItem } = require(resolve(repoRoot, "lib/readingGen/apValidator.js"));
const { validateRDLItem } = require(resolve(repoRoot, "lib/readingGen/rdlValidator.js"));
const { validateCTWItem } = require(resolve(repoRoot, "lib/readingGen/ctwValidator.js"));
const { validateLCR } = require(resolve(repoRoot, "lib/listeningGen/lcrValidator.js"));
const { validateLC } = require(resolve(repoRoot, "lib/listeningGen/lcValidator.js"));
const { validateLA } = require(resolve(repoRoot, "lib/listeningGen/laValidator.js"));
const { validateLAT } = require(resolve(repoRoot, "lib/listeningGen/latValidator.js"));
const { validateRepeatSet, validateInterviewSet } = require(resolve(repoRoot, "lib/speakingGen/speakingValidator.js"));
const { validateQuestion } = require(resolve(repoRoot, "lib/questionBank/buildSentenceSchema.js"));

// ── 结果归一化：把各 validator 的返回形状统一成 { hardFail, flavor, warnings } ──
// 实际导出签名（已逐一核对）：
//   validateAPItem/validateRDLItem/validateCTWItem(item) → { pass, errors[], warnings[] }
//   validateLCR/LC/LA/LAT(item)                          → { valid, errors[], warnings[], flavor:{total}|null }
//   validateRepeatSet/validateInterviewSet(set)          → { valid, errors[], warnings[], flavor:{total}|null }
//   validateQuestion(q)  (BS)                            → { fatal[], format[], content[] }
function fromPassShape(res) {
  return {
    hardFail: res.pass ? [] : (res.errors || []),
    flavor: null,
    warnings: res.warnings || [],
  };
}
function fromValidShape(res) {
  return {
    hardFail: res.valid ? [] : (res.errors || []),
    flavor: res.flavor && typeof res.flavor.total === "number" ? res.flavor.total : null,
    warnings: res.warnings || [],
  };
}
function fromBSShape(res) {
  return {
    hardFail: res.fatal || [],
    flavor: null,
    warnings: [
      ...(res.format || []).map((w) => `format: ${w}`),
      ...(res.content || []).map((w) => `content: ${w}`),
    ],
  };
}

// ── CTW 机械一致性：blanked_text + blanks 能否还原 passage ───────────────────
// blanks[i] = { position(全文词下标), original_word, displayed_fragment, ... }
// blanked_text 中被挖词呈现为 fragment + "_"×(word长-fragment长)（标点原样保留）。
// 还原 = 逐词把 fragment+下划线段替换回 original_word 后与 passage 完全一致。
function ctwReconstructCheck(item) {
  const failures = [];
  const warnings = [];
  if (typeof item.passage !== "string" || typeof item.blanked_text !== "string" || !Array.isArray(item.blanks)) {
    return { failures: ["ctw_reconstruct: missing passage/blanked_text/blanks"], warnings };
  }
  const pTok = item.passage.split(/\s+/).filter(Boolean);
  const bTok = item.blanked_text.split(/\s+/).filter(Boolean);
  if (pTok.length !== bTok.length) {
    return { failures: [`ctw_reconstruct: token count mismatch (passage=${pTok.length}, blanked=${bTok.length})`], warnings };
  }
  const byPos = new Map();
  for (const b of item.blanks) {
    if (!b || typeof b.position !== "number") {
      failures.push("ctw_reconstruct: blank missing numeric position");
      continue;
    }
    byPos.set(b.position, b);
  }
  for (let i = 0; i < pTok.length; i += 1) {
    if (bTok[i] === pTok[i]) {
      const b = byPos.get(i);
      if (b && String(b.original_word || "").length > String(b.displayed_fragment || "").length) {
        // blanks 声明挖了词但 blanked_text 没挖：还原虽然平凡成立，但数据自相矛盾 → 告警。
        warnings.push(`ctw_reconstruct: blank at position ${i} not applied in blanked_text`);
      }
      continue;
    }
    const b = byPos.get(i);
    if (!b) {
      failures.push(`ctw_reconstruct: token ${i} differs ("${bTok[i]}" vs "${pTok[i]}") with no blank declared`);
      continue;
    }
    const word = String(b.original_word || "");
    const frag = String(b.displayed_fragment || "");
    const hole = frag + "_".repeat(Math.max(0, word.length - frag.length));
    const rebuilt = bTok[i].replace(hole, word);
    if (rebuilt !== pTok[i]) {
      failures.push(`ctw_reconstruct: blank at position ${i} does not rebuild ("${bTok[i]}" + "${word}" ≠ "${pTok[i]}")`);
    }
  }
  return { failures, warnings };
}

// ── 单库执行 ─────────────────────────────────────────────────────────────────
function runBank(items, validateFn, normalizeFn, extraFn) {
  const perItem = {};
  const stats = { total: 0, hardFail: 0, threw: 0, flavorVals: [] };
  for (const item of items) {
    const id = item && item.id != null ? String(item.id) : `(noid#${stats.total})`;
    stats.total += 1;
    const rec = { hardFail: [], flavor: null, warnings: [] };
    try {
      const res = validateFn(item);
      const norm = normalizeFn(res);
      rec.hardFail = norm.hardFail;
      rec.flavor = norm.flavor;
      rec.warnings = norm.warnings;
    } catch (err) {
      rec.validator_threw = err && err.message ? String(err.message) : String(err);
    }
    if (extraFn && !rec.validator_threw) {
      const extra = extraFn(item);
      rec.hardFail = [...rec.hardFail, ...extra.failures];
      rec.warnings = [...rec.warnings, ...extra.warnings];
    }
    if (rec.validator_threw) stats.threw += 1;
    else if (rec.hardFail.length > 0) stats.hardFail += 1;
    if (typeof rec.flavor === "number") stats.flavorVals.push(rec.flavor);
    perItem[id] = rec;
  }
  return { perItem, stats };
}

function flavorSummary(vals) {
  if (vals.length === 0) return "flavor=n/a";
  const min = Math.min(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return `flavor min=${min.toFixed(2)} avg=${avg.toFixed(2)} n=${vals.length}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outFile = args.get("--out");
  if (!outFile || outFile === true) {
    console.error("用法: node scripts/ops/review/run-deterministic-checks.mjs --out <file>");
    process.exitCode = 1;
    return;
  }

  console.log("\n=== 确定性检查（validator + CTW 机械一致性；零 AI 调用）===\n");

  // [bankType, items, validateFn, normalizeFn, extraFn?]
  const RUNS = [
    ["ap", loadBankItems("data/reading/bank/ap.json"), validateAPItem, fromPassShape, null],
    ["ctw", loadBankItems(CTW_FILE), validateCTWItem, fromPassShape, ctwReconstructCheck],
    ["rdl-short", loadBankItems("data/reading/bank/rdl-short.json"), validateRDLItem, fromPassShape, null],
    ["rdl-long", loadBankItems("data/reading/bank/rdl-long.json"), validateRDLItem, fromPassShape, null],
    ["lcr", loadBankItems("data/listening/bank/lcr.json"), validateLCR, fromValidShape, null],
    ["lc", loadBankItems("data/listening/bank/lc.json"), validateLC, fromValidShape, null],
    ["la", loadBankItems("data/listening/bank/la.json"), validateLA, fromValidShape, null],
    ["lat", loadBankItems("data/listening/bank/lat.json"), validateLAT, fromValidShape, null],
    ["repeat", loadBankItems(REPEAT_FILE), validateRepeatSet, fromValidShape, null],
    ["interview", loadBankItems(INTERVIEW_FILE), validateInterviewSet, fromValidShape, null],
    ["bs", loadBSQuestions(), validateQuestion, fromBSShape, null],
  ];
  // 保险：MCQ_BANKS 配置与本清单如有漂移，宁可显式炸掉也不静默漏库。
  const covered = new Set(RUNS.map((r) => r[0]));
  for (const b of MCQ_BANKS) {
    if (!covered.has(b.type)) throw new Error(`RUNS 漏配库: ${b.type}`);
  }

  const output = {};
  let grandHard = 0;
  let grandThrew = 0;
  for (const [bankType, items, validateFn, normalizeFn, extraFn] of RUNS) {
    const { perItem, stats } = runBank(items, validateFn, normalizeFn, extraFn);
    output[bankType] = perItem;
    grandHard += stats.hardFail;
    grandThrew += stats.threw;
    console.log(
      `[${bankType}] 条目=${stats.total} hardFail=${stats.hardFail} validator_threw=${stats.threw} | ${flavorSummary(stats.flavorVals)}`
    );
  }

  const full = resolve(String(outFile));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`\n合计: hardFail 条目=${grandHard} validator_threw=${grandThrew}`);
  console.log(`结果已写入: ${full}`);
}

main();
