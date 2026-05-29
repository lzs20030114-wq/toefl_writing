#!/usr/bin/env node
// Measure BS structural dimensions (answer length, effective chunk count,
// chunk word-length, single-word-chunk ratio) on REAL TPO vs our batches.
// Apples-to-apples per the calibration-fix methodology.

import { readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

function stats(arr) {
  if (!arr.length) return { n: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    n: arr.length,
    mean: Number(mean.toFixed(2)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p10: sorted[Math.floor(arr.length * 0.1)],
    p90: sorted[Math.floor(arr.length * 0.9)],
  };
}

// ── Real TPO ─────────────────────────────────────────────────────────────
function measureTPO() {
  const raw = readFileSync(resolve(ROOT, "data/buildSentence/tpo_source.md"), "utf8").split(/\r?\n/);
  const items = [];
  let cur = null;
  for (const line of raw) {
    const qm = line.match(/^__(\d+)\\?\.__\s*(.*)/);
    if (qm) { if (cur) items.push(cur); cur = { template: "", chunks: "" }; continue; }
    if (!cur) continue;
    if (line.includes("\\_")) cur.template += (cur.template ? " " : "") + line.trim();
    else if (line.includes(" / ") && !line.startsWith("__")) cur.chunks = line.trim();
  }
  if (cur) items.push(cur);

  const answerLens = [], effChunks = [], chunkWordLens = [], singleWordRatios = [];
  for (const it of items) {
    if (!it.chunks) continue;
    let t = it.template.replace(/\\_/g, "_").replace(/__[^_]*__/g, " ");
    // NOTE: each _____ in a TPO template is a CHUNK slot, not a word slot.
    // So answer length ≠ blankRuns + given. Compute it from words instead:
    // answer words = given words + (all chunk words − the 1 distractor word).
    const givenWords = t.split(/_{2,}/).join(" ").replace(/[.?!,;:]/g, "").trim().split(/\s+/).filter(Boolean).length;
    const chunks = it.chunks.split(" / ").map((c) => c.trim()).filter(Boolean);
    const chunkWords = chunks.map((c) => c.split(/\s+/).length);
    const totalChunkWords = chunkWords.reduce((a, b) => a + b, 0);
    const answerLen = givenWords + totalChunkWords - 1; // TPO distractor is 1 word
    const eff = chunks.length - 1;                       // minus 1 distractor chunk
    answerLens.push(answerLen);
    effChunks.push(eff);
    chunkWords.forEach((w) => chunkWordLens.push(w));
    const singles = chunkWords.filter((w) => w === 1).length;
    singleWordRatios.push(singles / chunks.length);
  }
  return {
    label: `TPO (${answerLens.length} items)`,
    answerLen: stats(answerLens),
    effChunks: stats(effChunks),
    chunkWordLen: stats(chunkWordLens),
    pctSingleWordChunks: Math.round(chunkWordLens.filter((w) => w === 1).length / chunkWordLens.length * 100),
    avgSingleWordRatioPerItem: Math.round(singleWordRatios.reduce((a, b) => a + b, 0) / singleWordRatios.length * 100),
  };
}

// ── Our output ───────────────────────────────────────────────────────────
function measureOurItems(items, label) {
  const answerLens = [], effChunks = [], chunkWordLens = [];
  for (const q of items) {
    const ans = String(q.answer || "").trim().replace(/[.?!,;:]/g, "").split(/\s+/).filter(Boolean).length;
    answerLens.push(ans);
    const chunks = Array.isArray(q.chunks) ? q.chunks : [];
    const eff = chunks.length - (q.distractor ? 1 : 0);
    effChunks.push(eff);
    chunks.forEach((c) => chunkWordLens.push(String(c).trim().split(/\s+/).length));
  }
  return {
    label: `${label} (${answerLens.length} items)`,
    answerLen: stats(answerLens),
    effChunks: stats(effChunks),
    chunkWordLen: stats(chunkWordLens),
    pctSingleWordChunks: chunkWordLens.length ? Math.round(chunkWordLens.filter((w) => w === 1).length / chunkWordLens.length * 100) : 0,
  };
}

function loadStaging(session) {
  try { return JSON.parse(readFileSync(resolve(ROOT, `data/buildSentence/staging/${session}.json`), "utf8")).items || []; }
  catch { return []; }
}

// ── Report ────────────────────────────────────────────────────────────────
const tpo = measureTPO();

// recent sessions to compare (newest new-prompt batch + an older one)
const sessions = process.argv.slice(2);
const ours = [];
if (sessions.length) {
  for (const s of sessions) ours.push(measureOurItems(loadStaging(s), s));
} else {
  // default: newest 2 routine staging files
  const files = readdirSync(resolve(ROOT, "data/buildSentence/staging"))
    .filter((f) => /^routine-\d.*\.json$/.test(f) && !f.includes("r2"))
    .sort().reverse().slice(0, 2);
  for (const f of files) ours.push(measureOurItems(loadStaging(f.replace(".json", "")), f.replace(".json", "")));
}

const all = [tpo, ...ours];
console.log("BS structural dimensions — TPO calibration target: answer 7-15 (mean 10.6), eff chunks 4-7 (mean 5.8)\n");
const col = (v) => String(v).padStart(13);
console.log("metric".padEnd(22) + all.map((a) => col(a.label.split(" (")[0].slice(0, 12))).join(""));
console.log("-".repeat(22 + 13 * all.length));
console.log("answer mean (7-15)".padEnd(22) + all.map((a) => col(a.answerLen.mean)).join(""));
console.log("answer p10-p90".padEnd(22) + all.map((a) => col(`${a.answerLen.p10}-${a.answerLen.p90}`)).join(""));
console.log("answer min-max".padEnd(22) + all.map((a) => col(`${a.answerLen.min}-${a.answerLen.max}`)).join(""));
console.log("eff chunks mean (4-7)".padEnd(22) + all.map((a) => col(a.effChunks.mean)).join(""));
console.log("eff chunks min-max".padEnd(22) + all.map((a) => col(`${a.effChunks.min}-${a.effChunks.max}`)).join(""));
console.log("chunk wordlen mean".padEnd(22) + all.map((a) => col(a.chunkWordLen.mean)).join(""));
console.log("% single-word chunks".padEnd(22) + all.map((a) => col(a.pctSingleWordChunks + "%")).join(""));
