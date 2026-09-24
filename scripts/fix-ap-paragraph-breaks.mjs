#!/usr/bin/env node
/**
 * 把 AP（学术阅读）题库里丢掉的段落空行补回 passage。
 *
 * 用法:
 *   node scripts/fix-ap-paragraph-breaks.mjs            # 修并写回
 *   node scripts/fix-ap-paragraph-breaks.mjs --dry      # 只看会改什么，不落盘
 *
 * 背景见 lib/reading/passageLayout.js 的头注：passage 是渲染用的权威正文，paragraphs[] 是它的
 * 段落切分；模型偶尔给出用单空格拼起来的 passage，渲染层（pre-wrap）只认空行，整篇就糊成一坨。
 *
 * 两道工序，都自带验收（改完必须 isParagraphLayoutSynced 才算数，否则原样留着报人工）：
 *   1. 补空行 —— restoreParagraphBreaks，只动段间空白，段内逐字不碰。
 *   2. 删重复尾块 —— 正文末尾整块重复了某一段的结尾（模型把末句又抄了一遍）。这是删内容，
 *      不在纯函数职责内，所以单独一道，且只在「删掉之后正好与 paragraphs 对上」时才动手。
 *
 * 脚本是幂等的：修好的库再跑一次输出「0 处改动」。
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { restoreParagraphBreaks, isParagraphLayoutSynced, paragraphBlocks, cleanParagraphs } =
  require("../lib/reading/passageLayout.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const BANK = join(__dirname, "..", "data", "reading", "bank", "ap.json");
const DRY = process.argv.slice(2).some((a) => a === "--dry" || a === "--dry-run");

/**
 * 正文末尾那一块整块重复了前面某段的结尾 → 删掉它。
 * 只认「删完正好对上」的情况，别的一律不动（返回 null = 不处理）。
 */
function dropDuplicateTailBlock(passage, paragraphs) {
  const blocks = paragraphBlocks(passage);
  const list = cleanParagraphs(paragraphs);
  if (blocks.length !== list.length + 1) return null;
  const tail = blocks[blocks.length - 1];
  if (!tail || !list.some((p) => p.endsWith(tail))) return null;
  const cut = passage.lastIndexOf(tail);
  if (cut < 0) return null;
  const trimmed = passage.slice(0, cut).replace(/\s+$/, "");
  return isParagraphLayoutSynced(trimmed, paragraphs) ? trimmed : null;
}

const raw = readFileSync(BANK, "utf8");
const bank = JSON.parse(raw);
const items = bank.items || [];

const fixed = [];
const deduped = [];
const manual = [];

for (const item of items) {
  if (isParagraphLayoutSynced(item.passage, item.paragraphs)) continue;

  const restored = restoreParagraphBreaks(item.passage, item.paragraphs);
  if (isParagraphLayoutSynced(restored, item.paragraphs)) {
    item.passage = restored;
    fixed.push(item.id);
    continue;
  }

  const cut = dropDuplicateTailBlock(item.passage, item.paragraphs);
  if (cut) {
    item.passage = cut;
    deduped.push(item.id);
    continue;
  }

  manual.push(item.id);
}

// 落盘前再全库验一遍 —— 凡是 paragraphs 给了 2 段以上的条目，版面必须对得上。
const stillBroken = items.filter((it) => !isParagraphLayoutSynced(it.passage, it.paragraphs)).map((it) => it.id);

console.log(`AP 题库 ${items.length} 条`);
console.log(`  补回段落空行: ${fixed.length}${fixed.length ? " → " + fixed.join(", ") : ""}`);
console.log(`  删掉重复尾块: ${deduped.length}${deduped.length ? " → " + deduped.join(", ") : ""}`);
console.log(`  仍需人工处理: ${manual.length}${manual.length ? " → " + manual.join(", ") : ""}`);

if (stillBroken.length !== manual.length) {
  console.error("✗ 自检失败：改完之后仍有条目版面对不上，且不在人工清单里", stillBroken);
  process.exit(1);
}

if (!fixed.length && !deduped.length) {
  console.log("\n无改动。");
  process.exit(manual.length ? 1 : 0);
}

if (DRY) {
  console.log("\n--dry：未写回。");
  process.exit(0);
}

writeFileSync(BANK, JSON.stringify(bank, null, 2) + "\n", "utf8");
console.log(`\n✓ 已写回 ${BANK}`);
process.exit(manual.length ? 1 : 0);
