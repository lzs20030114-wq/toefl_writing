/**
 * extract-blind-batches.mjs — 从删后题库抽「盲卷批次」+「答案 sidecar」+「manifest」
 *
 * 盲审第一步：把 7 个 MCQ 库（ap/rdl-short/rdl-long/lcr/lc/la/lat）+ BS 主库
 * 做成 AI 盲答用的批次文件——盲卷不含任何标答/解析/泄答字段，选项字母顺序不动；
 * 标答另存 keys/ sidecar 供 collect-verdicts.mjs 判分。CTW 无标答选择题形态，不出盲卷。
 *
 * 用法：
 *   node scripts/ops/review/extract-blind-batches.mjs --out <dir>
 *
 * 产出（<dir>/ 下，不进 git，建议放 scratchpad）：
 *   <type>-batch-NNN.json            盲卷批次 { type, batch, items:[...] }
 *   keys/<type>-batch-NNN.keys.json  标答 sidecar { itemId: {q0:"B",...} }（bs 为 {answer:"..."}）
 *   manifest.json                    每批 type/条数/题数/路径 汇总
 *
 * 批次大小：lat 12 / ap 12 / rdl-long 15 / lc 20 / la 20 / rdl-short 25 / bs 25 / lcr 40。
 * 不做 git commit。
 */

import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "../_shared.mjs";
import {
  MCQ_BANKS, BATCH_SIZES,
  loadBankItems, loadBSQuestions,
  buildBlindMCQItem, buildBlindBSItem,
  extractAnswerKey, extractBSKey,
  chunk, pad3,
} from "./_reviewShared.mjs";

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.get("--out");
  if (!outDir || outDir === true) {
    console.error("用法: node scripts/ops/review/extract-blind-batches.mjs --out <dir>");
    process.exitCode = 1;
    return;
  }
  const out = resolve(String(outDir));
  const keysDir = resolve(out, "keys");
  mkdirSync(keysDir, { recursive: true });

  console.log(`\n=== 抽取盲卷批次 → ${out} ===\n`);

  const manifest = { generated_at: new Date().toISOString(), batches: [], totals: null };
  const byType = {};
  let skippedNoId = 0;

  // sources: [{ type, entries: [{ id, blind, key, questionCount }] }]
  const sources = [];

  for (const bank of MCQ_BANKS) {
    const items = loadBankItems(bank.file);
    const entries = [];
    for (const item of items) {
      if (!item || typeof item.id !== "string" || item.id === "") {
        skippedNoId += 1;
        continue;
      }
      const key = extractAnswerKey(bank.type, item);
      entries.push({
        id: item.id,
        blind: buildBlindMCQItem(item),
        key,
        questionCount: Object.keys(key).length,
      });
    }
    sources.push({ type: bank.type, entries });
  }

  {
    const questions = loadBSQuestions();
    const entries = [];
    for (const q of questions) {
      if (!q || typeof q.id !== "string" || q.id === "") {
        skippedNoId += 1;
        continue;
      }
      entries.push({ id: q.id, blind: buildBlindBSItem(q), key: extractBSKey(q), questionCount: 1 });
    }
    sources.push({ type: "bs", entries });
  }

  for (const src of sources) {
    const size = BATCH_SIZES[src.type];
    const batches = chunk(src.entries, size);
    let typeQuestions = 0;
    batches.forEach((batchEntries, idx) => {
      const batchNo = idx + 1;
      const base = `${src.type}-batch-${pad3(batchNo)}`;
      const file = `${base}.json`;
      const keysFile = `keys/${base}.keys.json`;
      writeJson(resolve(out, file), {
        type: src.type,
        batch: batchNo,
        items: batchEntries.map((e) => e.blind),
      });
      const keys = {};
      for (const e of batchEntries) keys[e.id] = e.key;
      writeJson(resolve(out, keysFile), keys);

      const questions = batchEntries.reduce((s, e) => s + e.questionCount, 0);
      typeQuestions += questions;
      manifest.batches.push({
        type: src.type,
        batch: batchNo,
        items: batchEntries.length,
        questions,
        file,
        keysFile,
      });
    });
    byType[src.type] = {
      batches: batches.length,
      items: src.entries.length,
      questions: typeQuestions,
      batchSize: size,
    };
    console.log(
      `[${src.type}] 条目=${src.entries.length} 批次=${batches.length}（每批≤${size}） 题数=${typeQuestions}`
    );
  }

  manifest.totals = {
    batches: manifest.batches.length,
    items: Object.values(byType).reduce((s, t) => s + t.items, 0),
    questions: Object.values(byType).reduce((s, t) => s + t.questions, 0),
    byType,
  };
  writeJson(resolve(out, "manifest.json"), manifest);

  console.log(
    `\n合计: 批次=${manifest.totals.batches} 盲卷条目=${manifest.totals.items} 题数=${manifest.totals.questions}` +
    (skippedNoId ? ` | 无 id 跳过=${skippedNoId}` : "")
  );
  console.log(`manifest: ${resolve(out, "manifest.json")}`);
  console.log("（CTW 无标答选择题形态，不出盲卷，只走 run-deterministic-checks.mjs。）");
}

main();
