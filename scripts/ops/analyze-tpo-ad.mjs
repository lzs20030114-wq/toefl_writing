#!/usr/bin/env node
// Analyze data/academicWriting/real_tpo_reference.json (81 real TPO items)
// and report distributions on dimensions the project prompt tries to control:
//   - course distribution (which fields are tested?)
//   - professor length (chars)
//   - student length & length differential (one longer than the other?)
//   - opening style of professor post
//   - whether student 2 references student 1 by name
//   - whether professor uses contractions (project bans them)

import { readFileSync } from "fs";
import { resolve } from "path";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const items = JSON.parse(
  readFileSync(resolve(repoRoot, "data/academicWriting/real_tpo_reference.json"), "utf8"),
);

console.log(`Total real TPO AD items: ${items.length}\n`);

// ── COURSE distribution ──
const courseCounts = {};
for (const q of items) {
  const c = (q.course || "unknown").toLowerCase().trim();
  courseCounts[c] = (courseCounts[c] || 0) + 1;
}
console.log("=== Course distribution ===");
Object.entries(courseCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) =>
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(3)}  (${((v / items.length) * 100).toFixed(0)}%)`),
  );

// ── Professor opener style ──
function detectOpening(text) {
  const s = String(text || "").trim();
  if (/^today/i.test(s)) return "today";
  if (/^as (we|i) (discussed|mentioned)/i.test(s)) return "as_discussed";
  if (/^over the (next|past|last)/i.test(s)) return "over_weeks";
  if (/^for this week|^this week|^let'?s (think|talk)/i.test(s)) return "this_week";
  if (/^in (recent|the past) (years|decades?|months?)|^recently/i.test(s)) return "recent";
  // Factual: starts with a factual claim like "The number of ...", "Many countries ...", etc.
  if (/^(the |many |most |some |a |an |\d|in some |currently)/i.test(s)) return "factual";
  return "other";
}
const openingCounts = {};
for (const q of items) {
  const o = detectOpening(q.professor?.text);
  openingCounts[o] = (openingCounts[o] || 0) + 1;
}
console.log("\n=== Professor opening style ===");
Object.entries(openingCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) =>
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(3)}  (${((v / items.length) * 100).toFixed(0)}%)`),
  );

// ── Length stats ──
const profLens = items.map((q) => String(q.professor?.text || "").length);
const profMean = profLens.reduce((a, b) => a + b, 0) / profLens.length;
const profMin = Math.min(...profLens);
const profMax = Math.max(...profLens);

const stuLens = items.flatMap((q) => (q.students || []).map((s) => String(s.text || "").length));
const stuMean = stuLens.reduce((a, b) => a + b, 0) / stuLens.length;
const stuMin = Math.min(...stuLens);
const stuMax = Math.max(...stuLens);

const lenDiffs = items
  .filter((q) => (q.students || []).length === 2)
  .map((q) => Math.abs(q.students[0].text.length - q.students[1].text.length));
const diffMean = lenDiffs.reduce((a, b) => a + b, 0) / lenDiffs.length;

console.log("\n=== Length stats (characters) ===");
console.log(`  Professor: min=${profMin}, mean=${profMean.toFixed(0)}, max=${profMax}`);
console.log(`  Student:   min=${stuMin}, mean=${stuMean.toFixed(0)}, max=${stuMax}`);
console.log(`  |S1 - S2| (length diff): mean=${diffMean.toFixed(0)}`);

const diffBuckets = { "<30": 0, "30-100": 0, "100-200": 0, "200+": 0 };
for (const d of lenDiffs) {
  if (d < 30) diffBuckets["<30"]++;
  else if (d < 100) diffBuckets["30-100"]++;
  else if (d < 200) diffBuckets["100-200"]++;
  else diffBuckets["200+"]++;
}
console.log("\n  Length diff bucket distribution:");
for (const [k, v] of Object.entries(diffBuckets)) {
  console.log(`    ${k.padEnd(8)} ${v}  (${((v / lenDiffs.length) * 100).toFixed(0)}%)`);
}

// ── S2 references S1 by name ──
let s2References = 0;
let totalPairs = 0;
for (const q of items) {
  if ((q.students || []).length !== 2) continue;
  totalPairs += 1;
  const s1Name = q.students[0]?.name || "";
  const s2Text = q.students[1]?.text || "";
  if (s1Name && s2Text.includes(s1Name)) s2References += 1;
}
console.log(`\n=== S2 references S1 by name ===`);
console.log(`  ${s2References} / ${totalPairs} (${((s2References / totalPairs) * 100).toFixed(0)}%)`);

// ── Contractions in professor text ──
const contractionRegex = /\b(don't|doesn't|isn't|aren't|wasn't|weren't|haven't|hasn't|hadn't|won't|wouldn't|can't|couldn't|shouldn't|it's|that's|there's|we're|they're|you're|I'm|he's|she's|I've|we've|they've|you've|I'll|we'll|they'll|you'll|he'll|she'll|I'd|we'd|they'd|you'd|he'd|she'd)\b/i;
let withContractions = 0;
for (const q of items) {
  if (contractionRegex.test(q.professor?.text || "")) withContractions += 1;
}
console.log(`\n=== Professor uses contractions (project prompt bans) ===`);
console.log(`  ${withContractions} / ${items.length} (${((withContractions / items.length) * 100).toFixed(0)}%)`);

// ── Student names ──
const studentNames = {};
for (const q of items) {
  for (const s of q.students || []) {
    const n = s.name || "";
    if (n) studentNames[n] = (studentNames[n] || 0) + 1;
  }
}
const topNames = Object.entries(studentNames)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12);
console.log(`\n=== Top student names (${Object.keys(studentNames).length} unique) ===`);
for (const [n, c] of topNames) {
  console.log(`  ${n.padEnd(14)} ${c}`);
}

// ── Professor name (project prompt says "Professor" 92%) ──
const profNames = {};
for (const q of items) {
  const n = q.professor?.name || "";
  if (n) profNames[n] = (profNames[n] || 0) + 1;
}
console.log(`\n=== Professor name field ===`);
Object.entries(profNames)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .forEach(([n, c]) =>
    console.log(`  "${n}" ${c}  (${((c / items.length) * 100).toFixed(0)}%)`),
  );
