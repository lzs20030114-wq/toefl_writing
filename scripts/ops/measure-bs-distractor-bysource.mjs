#!/usr/bin/env node
// Measure the BS distractor RATE separately for the two reference subsets that
// coexist in data/buildSentence/tpo_source.md, using the SAME tile-level method
// on both so the comparison is apples-to-apples:
//
//   distractor count per item = (# of offered tiles) - (# of blanks)
//
// A Build-a-Sentence item gives the test-taker N tiles to drop into M blanks; a
// distractor is an extra tile with no slot, so (tiles - blanks) is the distractor
// count. This is the RELIABLE method (it's what the official answer key encodes).
//
//   (a) 60 RECALLED items (6 sets, 机经 reconstructions of REAL administrations)
//   (b) 20 OFFICIAL items (ETS 2026 Full-Length Practice Tests 1 & 2; verbatim)
//
// PITFALL (why an earlier pass got a wrong number): do NOT count *words*
// (sum of chunk words - blanks). Recalled tiles are often multi-word, so word
// counting massively overcounts (it reported recalled ~98%). Tile counting gives
// the true ~82%. See lib/questionBank/etsProfile.js for the calibration decision.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// ── (b) OFFICIAL: ground-truth distractors from the structured JSON ──────────
const official = JSON.parse(readFileSync(resolve(ROOT, "data/buildSentence/tpo_official.json"), "utf8"));
const offByTest = {};
let offWith = 0;
for (const it of official) {
  const test = it.source_label || "official";
  offByTest[test] = offByTest[test] || { n: 0, withD: 0 };
  offByTest[test].n++;
  if (Array.isArray(it.distractors) && it.distractors.length > 0) { offByTest[test].withD++; offWith++; }
}

// ── (a) RECALLED: tiles - blanks, on the items ABOVE the official marker ──────
const lines = readFileSync(resolve(ROOT, "data/buildSentence/tpo_source.md"), "utf8").split(/\r?\n/);
const officialStart = lines.findIndex((l) => /\(Official ETS/.test(l));
const recalledLines = officialStart === -1 ? lines : lines.slice(0, officialStart);

const items = [];
let cur = null;
for (const line of recalledLines) {
  const qm = line.match(/^__(\d+)\\?\.__\s*(.*)/);
  if (qm) { if (cur) items.push(cur); cur = { tmpl: "", tiles: "" }; continue; }
  if (!cur) continue;
  if (line.includes("\\_")) cur.tmpl += " " + line;
  else if (line.includes(" / ") && !line.startsWith("__")) cur.tiles = line.trim();
}
if (cur) items.push(cur);

const dist = { "0": 0, "1": 0, "2": 0 };
let recWith = 0, recParsed = 0;
for (const it of items) {
  if (!it.tiles) continue;
  recParsed++;
  const blanks = (it.tmpl.replace(/\\_/g, "_").match(/_{2,}/g) || []).length;
  const tiles = it.tiles.split(" / ").map((c) => c.trim()).filter(Boolean).length;
  const d = Math.max(0, tiles - blanks); // tile-level distractor count (blank counts ±1 noisy)
  dist[String(Math.min(d, 2))] = (dist[String(Math.min(d, 2))] || 0) + 1;
  if (d >= 1) recWith++;
}

console.log("=== (a) RECALLED 60 — real-exam 机经, tile-level (tiles - blanks) ===");
console.log(`  ${recWith}/${recParsed} items have a distractor = ${pct(recWith, recParsed)}%   (per-item count 0→${dist["0"]}, 1→${dist["1"]}, 2→${dist["2"]})`);
console.log();
console.log("=== (b) OFFICIAL 20 — ETS practice tests, verbatim ground truth ===");
for (const [test, s] of Object.entries(offByTest)) console.log(`  ${test}: ${s.withD}/${s.n} = ${pct(s.withD, s.n)}%`);
console.log(`  TOTAL: ${offWith}/${official.length} = ${pct(offWith, official.length)}%   tiles: ${official.flatMap((i) => i.distractors || []).map((d) => `"${d}"`).join(", ")}`);
console.log();
console.log("=== Finding & decision ===");
console.log(`  recalled (real exams)  ${pct(recWith, recParsed)}%  — drives etsProfile distractorRatio 0.88 / distractorMin 6`);
console.log(`  official (practice)    ${pct(offWith, official.length)}%  — verbatim, but ETS practice tests ("not an exact replica") run sparser/easier`);
console.log(`  DECISION (2026-05-30): KEEP the recalled density. ETS practice tests differ from real`);
console.log(`  administrations; the 机经 reflect what students actually face. Do NOT recalibrate to 10%.`);
