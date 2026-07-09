#!/usr/bin/env node
// CTW 唯一解复核跑批（L3 决策块 C 执行）。
// 对 ctw 库跑 checkItemUniqueness：找出「按碎片存在第二个语法语义都通的词」的多解空，
// 按 inflection/function/content 分类，产出报告 + 保守的 accepted_words 补丁提议。
//
//   default: 只复核 L1 嫌疑涉及的 ctw 题（suspect-input.json，109 题，省钱）
//   --all:   全库 355 题都查（更全，~¥5）
//
// 断点续跑：state 每 5 题落盘；重跑跳过已有结论、只重试 error。
// 补丁默认 dry：只写 ctw-uniqueness-report.md + ctw-accepted-words-patch.json，
// 不动题库。落库(加 accepted_words)由人看完报告后单独执行（--apply-inflections 只落
// 最安全的屈折变体那一类）。
// 用法：DEEPSEEK_API_KEY=... node scripts/audit/ctw-uniqueness.mjs [--all] [--limit=N] [--apply-inflections]
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(ROOT, "data/claudeGen/reports/FULL-AUDIT-2026-07-09/l3");
const BANK_PATH = join(ROOT, "data/reading/bank/ctw.json");
const STATE_PATH = join(OUT_DIR, "ctw-uniqueness-state.json");

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const MAX_MS = (Number(process.env.MAX_MINUTES) || 90) * 60000;
const T0 = Date.now();

const { checkItemUniqueness, classify } = require("../../lib/readingGen/ctwUniqueness.js");

async function callAI(prompt, maxTokens = 2000) {
  const { callDeepSeekViaCurl } = require("../../lib/ai/deepseekHttp.js");
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");
  const payload = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "You are a meticulous C-test setter. Return only valid JSON." },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    max_tokens: maxTokens,
  };
  const result = await callDeepSeekViaCurl({ apiKey, payload, timeoutMs: 60000 });
  return typeof result === "string" ? result : (result?.choices?.[0]?.message?.content || JSON.stringify(result));
}

const bank = JSON.parse(readFileSync(BANK_PATH, "utf8"));
const allItems = bank.items || [];

// 复核范围：默认取 L1 嫌疑涉及的 ctw 题
let targetIds;
if (args.all) {
  targetIds = allItems.map((it) => it.id);
} else {
  const suspects = JSON.parse(readFileSync(join(OUT_DIR, "suspect-input.json"), "utf8"));
  targetIds = (suspects.ctw || []).map((s) => s.id);
}
const targets = allItems.filter((it) => targetIds.includes(it.id)).slice(0, LIMIT);

const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {};
const saveState = () => writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));

console.log(`复核 ${targets.length} 题（${args.all ? "全库" : "L1 嫌疑范围"}）`);
let n = 0;
for (const item of targets) {
  if (Date.now() - T0 > MAX_MS) { console.log("⏱ 到时间预算, 优雅收尾"); break; }
  if (state[item.id] && !state[item.id].error) continue;
  const res = await checkItemUniqueness(item, callAI);
  state[item.id] = res.error
    ? { error: res.error }
    : { multi: res.multiSolutionBlanks.map((b) => ({ index: b.index, original: b.original, fragment: b.fragment, alternatives: b.alternatives })) };
  n++;
  if (n % 5 === 0) { saveState(); console.log(`  … ${n}/${targets.length}`); }
}
saveState();

// ── 汇总 + 补丁 ─────────────────────────────────────────────────────
const kindCount = { inflection: 0, function: 0, content: 0 };
const patch = {};            // id -> [{ blankIndex, original, add: [words] }]
const perItemLines = [];
let itemsWithMulti = 0, errCount = 0, done = 0;

for (const item of allItems) {
  const r = state[item.id];
  if (!r) continue;
  done++;
  if (r.error) { errCount++; continue; }
  if (!r.multi || !r.multi.length) continue;
  itemsWithMulti++;
  const lines = [`### ${item.id} — ${item.topic}/${item.subtopic}`];
  for (const b of r.multi) {
    // 重算 kind：不信 state 里旧的（旧 isInflectionalVariant 会把 the/these 误判 inflection），
    // 用当前(修严后)的 classify 现算，这样存量 state 无需重跑 AI 即享修复。
    const alts = b.alternatives.map((a) => ({ word: a.word, kind: classify(b.fragment, b.original, a.word) }));
    for (const alt of alts) kindCount[alt.kind] = (kindCount[alt.kind] || 0) + 1;
    lines.push(`- 空 ${b.index + 1} 碎片\`${b.fragment}\` 原词 **${b.original}** ← 第二解: ${alts.map((a) => `${a.word}(${a.kind})`).join(", ")}`);
    // 补丁：只把「屈折变体」列进自动可落项（最安全）；function/content 仅标记待人/待重挖
    const inflOnly = alts.filter((a) => a.kind === "inflection").map((a) => a.word);
    if (inflOnly.length) (patch[item.id] ||= []).push({ blankIndex: b.index, original: b.original, add: inflOnly });
  }
  perItemLines.push(lines.join("\n"));
}

const md = [
  `# CTW 唯一解复核报告 — ${new Date().toISOString().slice(0, 10)}`, "",
  `范围: ${args.all ? "全库 " + allItems.length : "L1 嫌疑 " + targets.length} 题 · 已复核 ${done} · error ${errCount}`,
  `多解题数: ${itemsWithMulti} · 第二解按类: 屈折 ${kindCount.inflection} / 功能词 ${kindCount.function} / 内容近义 ${kindCount.content}`, "",
  "## 处置口径",
  "- **屈折变体**（sugar/sugars）: 判分应接受等价形式 → 已进 `ctw-accepted-words-patch.json`，`--apply-inflections` 一键落 accepted_words。",
  "- **功能词短碎片**（on/of, the/this）: 真题靠上下文锁死；我们这些锁不住 → 建议生成器换词重挖（不宜只放宽判分，否则失去区分度）。清单见下，标 `function`。",
  "- **内容近义**（murky/muddy）: 逐个看语境能否锁定；锁不住重挖或补 accepted_words。清单标 `content`。", "",
  "## 多解明细", "",
  ...perItemLines, "",
  done < targets.length ? "**状态：未完 — 再次运行续跑。**" : "**状态：复核完成。**",
];
writeFileSync(join(OUT_DIR, "ctw-uniqueness-report.md"), md.join("\n") + "\n");
writeFileSync(join(OUT_DIR, "ctw-accepted-words-patch.json"), JSON.stringify(patch, null, 1));
console.log(`\n多解题 ${itemsWithMulti} · 屈折 ${kindCount.inflection} / 功能词 ${kindCount.function} / 内容 ${kindCount.content} · error ${errCount}`);

if (args["apply-inflections"]) {
  let applied = 0;
  const byId = new Map(allItems.map((it) => [it.id, it]));
  for (const [id, entries] of Object.entries(patch)) {
    const it = byId.get(id);
    for (const e of entries) {
      const blank = it.blanks[e.blankIndex];
      const set = new Set([...(blank.accepted_words || [])]);
      for (const w of e.add) if (w.toLowerCase() !== String(blank.original_word).toLowerCase()) { set.add(w); applied++; }
      if (set.size) blank.accepted_words = [...set];
    }
  }
  writeFileSync(BANK_PATH, JSON.stringify(bank, null, 1));
  console.log(`✓ 已落 ${applied} 个 accepted_words（仅屈折变体）到 ctw.json`);
} else {
  console.log("(dry — 报告+补丁已写; --apply-inflections 落屈折变体判分宽容)");
}
