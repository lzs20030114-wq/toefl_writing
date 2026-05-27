#!/usr/bin/env node
// Analyze data/emailWriting/tpo_reference.json (real TPO Email items) and
// report distributions on dimensions the project prompt tries to control:
//   - scenario word count
//   - scenario opening pattern (You are... / You recently... / Your X...)
//   - goal verb distribution
//   - goal count per item (project says exactly 3)
//   - "to" field naming style
//   - subject line patterns

import { readFileSync } from "fs";
import { resolve } from "path";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const items = JSON.parse(
  readFileSync(resolve(repoRoot, "data/emailWriting/tpo_reference.json"), "utf8"),
);

console.log(`Total real TPO Email items: ${items.length}\n`);

// ── Scenario word count ──
function wordCount(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}
const wcs = items.map((q) => wordCount(q.scenario));
const wcMean = wcs.reduce((a, b) => a + b, 0) / wcs.length;
const wcMin = Math.min(...wcs);
const wcMax = Math.max(...wcs);
console.log("=== Scenario word count ===");
console.log(`  min=${wcMin}  mean=${wcMean.toFixed(1)}  max=${wcMax}`);
console.log(`  (project prompt requires 35–45 words)`);
const inRange = wcs.filter((w) => w >= 35 && w <= 45).length;
const below = wcs.filter((w) => w < 35).length;
const above = wcs.filter((w) => w > 45).length;
console.log(`  Within 35-45: ${inRange}, below: ${below}, above: ${above}`);

// ── Scenario opening pattern ──
function classifyOpening(s) {
  const t = String(s || "").trim().toLowerCase();
  if (/^you are/.test(t)) return "You are...";
  if (/^you recently|^you have recently/.test(t)) return "You recently...";
  if (/^your /.test(t)) return "Your X...";
  if (/^you /.test(t)) return "You [other verb]...";
  return "other (third-person / passive / setup)";
}
const openings = {};
for (const q of items) {
  const o = classifyOpening(q.scenario);
  openings[o] = (openings[o] || 0) + 1;
}
console.log("\n=== Scenario opening pattern ===");
console.log(`  (project requires: "You are…" or "You recently…" or "Your [person]…")`);
Object.entries(openings)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) =>
    console.log(`  ${k.padEnd(40)} ${v}  (${((v / items.length) * 100).toFixed(0)}%)`),
  );

// ── Goal verb distribution ──
const verbCounts = {};
let totalGoals = 0;
for (const q of items) {
  for (const g of q.goals || []) {
    const first = String(g || "").trim().split(/\s+/)[0];
    if (first) {
      verbCounts[first] = (verbCounts[first] || 0) + 1;
      totalGoals += 1;
    }
  }
}
console.log("\n=== Goal opening verbs ===");
console.log(`  (project allows: Describe, Explain, Suggest, Ask, Thank, Tell, Mention, Offer, Give)`);
Object.entries(verbCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([v, c]) =>
    console.log(`  ${v.padEnd(14)} ${c}`),
  );

// ── Goal count per item ──
const goalCounts = {};
for (const q of items) {
  const n = (q.goals || []).length;
  goalCounts[n] = (goalCounts[n] || 0) + 1;
}
console.log("\n=== Goals per item ===");
console.log(`  (project requires EXACTLY 3 goals)`);
Object.entries(goalCounts).forEach(([n, c]) => console.log(`  ${n} goals: ${c} items`));

// ── "to" field analysis ──
console.log("\n=== Recipient ('to') field samples ===");
for (const q of items.slice(0, 8)) {
  console.log(`  ${(q.to || "").padEnd(30)} - ${(q.subject || "").slice(0, 50)}`);
}
console.log("  ...");

// ── First sentence opening of scenario — verify project's "establishes who/what" rule ──
const adjectiveBanList = ["specific", "concise", "detailed", "workable", "reasonable", "clear", "thorough"];
let bannedAdjUsage = 0;
for (const q of items) {
  for (const g of q.goals || []) {
    if (adjectiveBanList.some((w) => g.toLowerCase().includes(w))) {
      bannedAdjUsage += 1;
    }
  }
}
console.log(`\n=== Project's FORBIDDEN goal adjectives ===`);
console.log(`  (project bans: specific, concise, detailed, workable, reasonable, clear, thorough)`);
console.log(`  Goals containing these words in real TPO: ${bannedAdjUsage} / ${totalGoals}`);

// ── Recipient name distribution (creative vs common) ──
const namePatterns = {};
for (const q of items) {
  const t = String(q.to || "").trim();
  if (/^(professor|mr\.?|ms\.?|mrs\.?|dr\.?)\s/i.test(t)) {
    namePatterns["title + surname"] = (namePatterns["title + surname"] || 0) + 1;
  } else if (/^the /i.test(t)) {
    namePatterns["the [role]"] = (namePatterns["the [role]"] || 0) + 1;
  } else if (/manager|director|editor|coordinator|secretary|representative/i.test(t)) {
    namePatterns["role/title"] = (namePatterns["role/title"] || 0) + 1;
  } else {
    namePatterns["first name / other"] = (namePatterns["first name / other"] || 0) + 1;
  }
}
console.log(`\n=== Recipient naming pattern ===`);
Object.entries(namePatterns).forEach(([k, v]) =>
  console.log(`  ${k.padEnd(25)} ${v}  (${((v / items.length) * 100).toFixed(0)}%)`),
);
