#!/usr/bin/env node
/**
 * Estimate GPT TTS audio cost for the routine listening pipeline.
 *
 * Reads the live listening banks to get the REAL average spoken-word count per
 * item type, multiplies by the routine's fixed daily output, and prices the
 * resulting audio with the gpt-4o-mini-tts rate card. Re-run it any time the
 * banks evolve, the speaking rate changes, or OpenAI re-prices the model.
 *
 * Usage:
 *   node scripts/estimate-tts-cost.mjs                 # daily routine cost
 *   node scripts/estimate-tts-cost.mjs --wpm 150       # override speaking rate
 *   node scripts/estimate-tts-cost.mjs --model gpt-4o-tts
 *   node scripts/estimate-tts-cost.mjs --full-bank     # one-time re-render of whole bank
 *   node scripts/estimate-tts-cost.mjs --cny 7.1       # USD->CNY rate for the ¥ column
 *
 * Cost model (gpt-4o-mini-tts):
 *   audio output ≈ $0.015/min (the dominant term)  +  text input $0.60/1M tokens
 * The audio term is computed from words ÷ wpm × $/min so it tracks real content.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── CLI args ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function getArg(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
}
const WPM = parseFloat(getArg("wpm", "140"));            // TOEFL listening pace
const CNY = parseFloat(getArg("cny", "7.1"));            // USD -> CNY
const MODEL = getArg("model", "gpt-4o-mini-tts");
const FULL_BANK = argv.includes("--full-bank");

// ── Pricing presets (USD) ───────────────────────────────────────────────
// audioPerMin is OpenAI's own per-minute estimate; textPer1M prices the input
// text + per-utterance `instructions` string (a near-negligible term).
const PRICING = {
  "gpt-4o-mini-tts": { audioPerMin: 0.015, textPer1M: 0.60 },
  // Heavier instructable voice tier — kept here so `--model` can compare.
  "gpt-4o-tts":      { audioPerMin: 0.030, textPer1M: 2.50 },
};
const price = PRICING[MODEL];
if (!price) {
  console.error(`Unknown model "${MODEL}". Known: ${Object.keys(PRICING).join(", ")}`);
  process.exit(1);
}

const INSTRUCTION_TOKENS = 70; // ~ per-sentence persona/style instruction sent with each render call

// ── Bank definitions: file + how to pull spoken text + daily routine count ──
// dailyCount = items the routine reliably accepts per day (observed across ~20 runs).
const TYPES = [
  {
    key: "LAT", label: "学术讲座 (lecture)", file: "data/listening/bank/lat.json",
    dailyCount: 4, spoken: (it) => it.transcript || "",
  },
  {
    key: "LC", label: "对话 (conversation)", file: "data/listening/bank/lc.json",
    dailyCount: 5, spoken: (it) => (it.conversation || []).map((t) => t.text || "").join(" "),
  },
  {
    key: "LA", label: "校园通知 (announcement)", file: "data/listening/bank/la.json",
    dailyCount: 5, spoken: (it) => it.announcement || "",
  },
  {
    key: "LCR", label: "单句应答 (single sentence)", file: "data/listening/bank/lcr.json",
    dailyCount: 8, spoken: (it) => it.speaker || it.prompt || "",
  },
];

function loadItems(rel) {
  const d = JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));
  return d.items || d.questions || (Array.isArray(d) ? d : Object.values(d).find(Array.isArray)) || [];
}
const countWords = (s) => String(s).split(/\s+/).filter(Boolean).length;
const countSentences = (s) => Math.max(1, (String(s).match(/[.!?]+/g) || []).length);

// ── Cost of one item given its spoken word + sentence count ─────────────
function itemCost(words, sentences) {
  const audioMin = words / WPM;
  const audioCost = audioMin * price.audioPerMin;
  // text input = spoken text (~1.3 tok/word) + one instruction string per utterance
  const textTokens = words * 1.3 + sentences * INSTRUCTION_TOKENS;
  const textCost = (textTokens / 1_000_000) * price.textPer1M;
  return { audioMin, audioCost, textCost, total: audioCost + textCost };
}

// ── Aggregate a set of {count, avgWords, avgSentences} rows ─────────────
function summarize(rows) {
  let words = 0, audioMin = 0, audioCost = 0, textCost = 0;
  const out = rows.map((r) => {
    const per = itemCost(r.avgWords, r.avgSentences);
    const dayWords = r.avgWords * r.count;
    words += dayWords;
    audioMin += per.audioMin * r.count;
    audioCost += per.audioCost * r.count;
    textCost += per.textCost * r.count;
    return { ...r, words: dayWords, audioMin: per.audioMin * r.count, total: per.total * r.count };
  });
  return { rows: out, words, audioMin, audioCost, textCost, total: audioCost + textCost };
}

const usd = (n) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const cny = (n) => `¥${(n * CNY).toFixed(n * CNY < 10 ? 2 : 0)}`;

// ── Build per-type rows from the live banks ─────────────────────────────
const banks = TYPES.map((t) => {
  const items = loadItems(t.file);
  const wArr = items.map((it) => countWords(t.spoken(it))).filter((w) => w > 0);
  const sArr = items.map((it) => countSentences(t.spoken(it)));
  const avgWords = Math.round(wArr.reduce((a, b) => a + b, 0) / wArr.length);
  const avgSentences = Math.max(1, Math.round(sArr.reduce((a, b) => a + b, 0) / sArr.length));
  return { ...t, total: items.length, avgWords, avgSentences };
});

console.log("");
console.log(`GPT TTS 成本估算  ·  model=${MODEL}  wpm=${WPM}  rate=$${price.audioPerMin}/min 音频 + $${price.textPer1M}/1M 文本`);
console.log("=".repeat(78));

if (!FULL_BANK) {
  // ── Daily routine cost ──
  const rows = banks.map((b) => ({ key: b.key, label: b.label, count: b.dailyCount, avgWords: b.avgWords, avgSentences: b.avgSentences }));
  const s = summarize(rows);

  console.log("每天 routine 新增听力题(固定产量):\n");
  console.log("  题型   每天题数  平均词数/题   口播词数   音频时长     每天成本     单题成本");
  console.log("  " + "-".repeat(74));
  for (const r of s.rows) {
    const perItem = r.total / r.count;
    console.log(
      `  ${r.key.padEnd(5)}  ${String(r.count).padStart(6)}  ${String(r.avgWords).padStart(10)}` +
      `  ${String(Math.round(r.words)).padStart(9)}  ${(r.audioMin).toFixed(1).padStart(7)}min` +
      `  ${usd(r.total).padStart(10)}  ${usd(perItem).padStart(11)}`
    );
  }
  console.log("  " + "-".repeat(74));
  console.log(
    `  合计   ${String(banks.reduce((a, b) => a + b.dailyCount, 0)).padStart(6)}` +
    `  ${"".padStart(10)}  ${String(Math.round(s.words)).padStart(9)}  ${s.audioMin.toFixed(1).padStart(7)}min` +
    `  ${usd(s.total).padStart(10)}`
  );
  console.log("");
  console.log(`  其中  音频输出 ${usd(s.audioCost)}  +  文本输入 ${usd(s.textCost)}  (文本输入可忽略)`);
  console.log("");
  console.log("汇总:");
  console.log(`  每天   ${usd(s.total).padEnd(10)} ${cny(s.total)}`);
  console.log(`  每月   ${usd(s.total * 30).padEnd(10)} ${cny(s.total * 30)}   (×30)`);
  console.log(`  每年   ${usd(s.total * 365).padEnd(10)} ${cny(s.total * 365)}   (×365)`);
  console.log("");
  console.log("提示: 只是 GPT 音频成本;出题文本走 DeepSeek,另算。加 --full-bank 看整库一次性重渲染成本。");
} else {
  // ── One-time full-bank re-render ──
  const rows = banks.map((b) => ({ key: b.key, label: b.label, count: b.total, avgWords: b.avgWords, avgSentences: b.avgSentences }));
  const s = summarize(rows);

  console.log("一次性:把现有整库全部切到 GPT 重渲染:\n");
  console.log("  题型   库存量   平均词数/题   口播词数    音频时长      成本");
  console.log("  " + "-".repeat(68));
  for (const r of s.rows) {
    console.log(
      `  ${r.key.padEnd(5)}  ${String(r.count).padStart(6)}  ${String(r.avgWords).padStart(10)}` +
      `  ${String(Math.round(r.words)).padStart(9)}  ${(r.audioMin / 60).toFixed(1).padStart(6)}h` +
      `  ${usd(r.total).padStart(9)}`
    );
  }
  console.log("  " + "-".repeat(68));
  console.log(
    `  合计   ${String(banks.reduce((a, b) => a + b.total, 0)).padStart(6)}` +
    `  ${"".padStart(10)}  ${String(Math.round(s.words)).padStart(9)}  ${(s.audioMin / 60).toFixed(1).padStart(6)}h` +
    `  ${usd(s.total).padStart(9)}`
  );
  console.log("");
  console.log(`一次性总成本: ${usd(s.total)}  (${cny(s.total)})  ·  ${(s.audioMin / 60).toFixed(1)} 小时音频`);
  console.log("");
}
