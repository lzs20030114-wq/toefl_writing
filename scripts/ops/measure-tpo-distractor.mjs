#!/usr/bin/env node
// Measure the REAL distractor pattern in 60 TPO items — ground truth, not
// the historical bank (which may itself be miscalibrated) and not the prompt's
// claim ("mainly did/do/does").
//
// Distractor detection: the offered chunks total more words than the answer
// has blank slots. distractorWordCount = sum(chunk words) - blankSlots.
// The distractor chunk is the unused one — detected via the "twin" heuristic
// (TPO distractors are usually a morphological or function-word twin of a word
// that IS used, e.g. no/not, do/does/did, took/taken, stay/staying).

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
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

const AUX = new Set(["do", "does", "did", "is", "are", "was", "were", "has", "have", "had", "am", "be", "been", "will", "would", "can", "could", "should"]);
const NEG = new Set(["no", "not", "never", "none"]);

function stem(w) { return w.replace(/[^a-z]/gi, "").toLowerCase().slice(0, 4); }

const classes = { aux: 0, negation: 0, "morphological-twin": 0, content: 0, "unknown": 0 };
const distractorWords = {};
let withDistractor = 0;
const detail = [];

for (const it of items) {
  if (!it.chunks) continue;
  // blank slots = runs of 2+ underscores in unescaped template
  let t = it.template.replace(/\\_/g, "_");
  const blankRuns = (t.match(/_{2,}/g) || []).length;
  const chunks = it.chunks.split(" / ").map((c) => c.trim()).filter(Boolean);
  const chunkWordCounts = chunks.map((c) => c.split(/\s+/).length);
  const totalChunkWords = chunkWordCounts.reduce((a, b) => a + b, 0);
  const D = totalChunkWords - blankRuns; // number of distractor words (usually 1)

  if (D <= 0) { detail.push({ chunks: it.chunks, distractor: "(none detected)", cls: "none" }); continue; }

  // Candidate distractors = single-word chunks (distractor is always 1 word in TPO)
  const singles = chunks.filter((c) => c.split(/\s+/).length === 1).map((c) => c.toLowerCase());
  // All chunk tokens for twin detection
  const allTokens = chunks.flatMap((c) => c.toLowerCase().split(/\s+/));

  // Pick the distractor: prefer a single-word chunk that is (a) an aux with
  // another aux twin present, (b) a negation twin, or (c) shares a stem with
  // another token. Fall back to the last single-word aux/neg, else first single.
  let pick = null, cls = "unknown";
  // aux twin (do/does/did all present etc.)
  const auxSingles = singles.filter((w) => AUX.has(w));
  const negSingles = singles.filter((w) => NEG.has(w));
  // morphological twin: a single word sharing 4-char stem with a DIFFERENT token
  const morphTwin = singles.find((w) => allTokens.filter((t2) => t2 !== w && stem(t2) === stem(w) && stem(w).length >= 3).length > 0);

  if (negSingles.length && allTokens.filter((t2) => NEG.has(t2)).length >= 2) { pick = negSingles[0]; cls = "negation"; }
  else if (auxSingles.length >= 2) { pick = auxSingles[auxSingles.length - 1]; cls = "aux"; }
  else if (morphTwin) { pick = morphTwin; cls = "morphological-twin"; }
  else if (auxSingles.length === 1) { pick = auxSingles[0]; cls = "aux"; }
  else if (singles.length) { pick = singles[singles.length - 1]; cls = "content"; }

  if (pick) {
    withDistractor++;
    classes[cls]++;
    distractorWords[pick] = (distractorWords[pick] || 0) + 1;
    detail.push({ chunks: it.chunks, distractor: pick, cls });
  } else {
    detail.push({ chunks: it.chunks, distractor: "(undetected)", cls: "unknown" });
  }
}

console.log(`Parsed ${items.length} TPO items; detected distractor in ${withDistractor}.\n`);
console.log("=== Distractor CLASS distribution (real TPO) ===");
const clsTotal = Object.values(classes).reduce((a, b) => a + b, 0);
for (const [k, v] of Object.entries(classes).sort((a, b) => b[1] - a[1])) {
  if (v) console.log(`  ${k.padEnd(20)} ${v}/${clsTotal} = ${Math.round(v / clsTotal * 100)}%`);
}
console.log("\n=== Distractor WORD distribution (real TPO) ===");
const wsorted = Object.entries(distractorWords).sort((a, b) => b[1] - a[1]);
console.log("  distinct words:", wsorted.length);
console.log("  " + wsorted.map(([w, n]) => `${w}×${n}`).join(", "));
const didCount = (distractorWords["did"] || 0) + (distractorWords["do"] || 0) + (distractorWords["does"] || 0);
console.log(`\n  did/do/does share: ${didCount}/${withDistractor} = ${Math.round(didCount / withDistractor * 100)}%`);

console.log("\n=== Per-item detail (first 30) ===");
detail.slice(0, 30).forEach((d, i) => console.log(`  ${String(i + 1).padStart(2)} [${d.cls.padEnd(18)}] distractor="${d.distractor}"  chunks: ${d.chunks}`));
