#!/usr/bin/env node

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING = join(__dirname, "..", "data", "reading", "staging");

const { TOPIC_POOL } = require("../lib/readingGen/ctwPromptBuilder.js");
const { GENRE_SPECS } = require("../lib/readingGen/rdlPromptBuilder.js");

// Load items
const ctwItems = [], rdlItems = [];
for (const f of readdirSync(STAGING).filter(f => f.endsWith(".json"))) {
  const d = JSON.parse(readFileSync(join(STAGING, f), "utf-8"));
  if (d.type === "completeTheWords") ctwItems.push(...(d.items || []));
  else if (d.type === "readInDailyLife") rdlItems.push(...(d.items || []));
}

console.log("╔══════════════════════════════════════════════════════════╗");
console.log("║            Topic Breadth & Repetition Analysis          ║");
console.log("╚══════════════════════════════════════════════════════════╝\n");

// ═══ CTW ═══
console.log("━━━ CTW: " + ctwItems.length + " items ━━━\n");

// 1. Actual passage subjects (extract key nouns from first sentence)
console.log("Passage subjects:");
const ctwSubjects = [];
ctwItems.forEach((item, idx) => {
  const first = item.passage.split(/[.!?]/)[0].trim();
  // Extract the grammatical subject (first noun phrase before "is/are/has/have")
  const match = first.match(/^(.+?)\s+(?:is|are|has|have|was|were)\b/i);
  const subject = match ? match[1].replace(/^the\s+/i, "") : first.split(/\s+/).slice(0, 4).join(" ");
  ctwSubjects.push(subject);
  console.log("  " + (idx+1) + ". " + subject);
});

// Count duplicates
const subjectFreq = {};
ctwSubjects.forEach(s => {
  const norm = s.toLowerCase().replace(/[^a-z\s]/g, "").trim();
  subjectFreq[norm] = (subjectFreq[norm] || 0) + 1;
});
const dupes = Object.entries(subjectFreq).filter(([, c]) => c > 1);
console.log("\nDuplicate subjects:", dupes.length > 0 ? dupes.map(([s, c]) => `"${s}"(${c}x)`).join(", ") : "none");

// 2. Topic pool utilization
const usedTopics = new Set(ctwItems.map(i => i.topic));
const usedSubtopics = new Set(ctwItems.map(i => i.topic + "/" + (i.subtopic || "")));
const allSubtopics = TOPIC_POOL.flatMap(t => t.subtopics.map(s => t.topic + "/" + s));
console.log("\nTopic pool utilization:");
console.log("  Topics used: " + usedTopics.size + "/" + TOPIC_POOL.length);
console.log("  Subtopics used: " + usedSubtopics.size + "/" + allSubtopics.length + " (" + (usedSubtopics.size / allSubtopics.length * 100).toFixed(0) + "%)");

// 3. Unused topics
const unusedTopics = TOPIC_POOL.filter(t => !usedTopics.has(t.topic));
if (unusedTopics.length > 0) {
  console.log("  Never-used topics: " + unusedTopics.map(t => t.topic).join(", "));
}

// 4. Pairwise passage similarity
console.log("\nCross-passage similarity (Jaccard, content words):");
let highSimCount = 0;
for (let i = 0; i < ctwItems.length; i++) {
  for (let j = i + 1; j < ctwItems.length; j++) {
    const a = new Set(ctwItems[i].passage.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(w => w.length > 4));
    const b = new Set(ctwItems[j].passage.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(w => w.length > 4));
    const inter = [...a].filter(w => b.has(w)).length;
    const union = new Set([...a, ...b]).size;
    const sim = union > 0 ? inter / union : 0;
    if (sim > 0.2) {
      highSimCount++;
      console.log("  ⚠️ #" + (i+1) + " ↔ #" + (j+1) + ": " + (sim * 100).toFixed(0) + "% overlap");
      console.log("     " + ctwSubjects[i].substring(0, 40) + " ↔ " + ctwSubjects[j].substring(0, 40));
      // Show shared words
      const shared = [...a].filter(w => b.has(w));
      console.log("     Shared: " + shared.slice(0, 10).join(", "));
    }
  }
}
if (highSimCount === 0) console.log("  ✅ No high-similarity pairs (>20%)");

// 5. Most repeated content words across all passages
const ctwWordFreq = {};
ctwItems.forEach(i => {
  const words = new Set(i.passage.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(w => w.length > 5));
  words.forEach(w => ctwWordFreq[w] = (ctwWordFreq[w] || 0) + 1);
});
const overusedWords = Object.entries(ctwWordFreq).filter(([, c]) => c >= Math.ceil(ctwItems.length * 0.5)).sort((a, b) => b[1] - a[1]);
console.log("\nWords appearing in 50%+ of passages:");
overusedWords.forEach(([w, c]) => console.log("  " + w.padEnd(20) + c + "/" + ctwItems.length));

// ═══ RDL ═══
console.log("\n━━━ RDL: " + rdlItems.length + " items ━━━\n");

// 1. Scenario classification
const categories = {};
rdlItems.forEach(item => {
  const t = item.text.toLowerCase();
  let cat;
  if (t.match(/locker|clean.out|checkout|check.out|dorm.*out/)) cat = "locker/checkout";
  else if (t.match(/shift.*swap|swap.*shift/)) cat = "shift swap";
  else if (t.match(/wi.fi|wifi|certificate|network.*update/)) cat = "wifi/IT";
  else if (t.match(/e.waste|recycl|electronic.*drive/)) cat = "e-waste/recycling";
  else if (t.match(/food.*truck|menu|café|coffee|burger|bowl|sandwich/)) cat = "food/menu";
  else if (t.match(/makerspace|tool.*library|maker/)) cat = "makerspace/tools";
  else if (t.match(/print|kiosk|quota/)) cat = "printing";
  else if (t.match(/film|screening|festival|concert|performance/)) cat = "event/entertainment";
  else if (t.match(/maintenance|plumb|repair|technician|fix/)) cat = "maintenance";
  else if (t.match(/commute|transit|bicycle|bike|parking/)) cat = "commute/transport";
  else if (t.match(/garden|plant|compost/)) cat = "garden";
  else if (t.match(/buyback|textbook|bookstore/)) cat = "textbook buyback";
  else if (t.match(/gym|recreation|fitness|locker.*room/)) cat = "recreation/fitness";
  else if (t.match(/mail|package|delivery/)) cat = "mail/packages";
  else if (t.match(/laundry|washing/)) cat = "laundry";
  else cat = "other";
  categories[cat] = (categories[cat] || 0) + 1;
});

console.log("Scenario categories:");
for (const [k, v] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
  const bar = "█".repeat(v);
  const flag = v >= 3 ? " ⚠️ OVERREPRESENTED" : "";
  console.log("  " + k.padEnd(25) + bar + " " + v + flag);
}

// What categories are NEVER generated?
const POSSIBLE_CATEGORIES = [
  "locker/checkout", "shift swap", "wifi/IT", "e-waste/recycling", "food/menu",
  "makerspace/tools", "printing", "event/entertainment", "maintenance",
  "commute/transport", "garden", "textbook buyback", "recreation/fitness",
  "mail/packages", "laundry", "library hours", "course registration",
  "study group", "tutoring", "parking permit", "health clinic",
  "career fair", "internship", "club meeting", "volunteer",
];
const missing = POSSIBLE_CATEGORIES.filter(c => !categories[c]);
console.log("\nMissing categories (" + missing.length + "):");
missing.forEach(c => console.log("  ❌ " + c));

// 2. Available scenario pool
console.log("\nScenario pool in prompt:");
let totalScenarios = 0;
for (const [genre, spec] of Object.entries(GENRE_SPECS)) {
  totalScenarios += spec.scenarios.length;
  console.log("  " + genre.padEnd(15) + spec.scenarios.length + " scenarios");
}
console.log("  Total: " + totalScenarios + " scenarios");

// 3. RDL pairwise similarity
console.log("\nCross-item similarity:");
let rdlHighSim = 0;
for (let i = 0; i < rdlItems.length; i++) {
  for (let j = i + 1; j < rdlItems.length; j++) {
    const a = new Set(rdlItems[i].text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(w => w.length > 4));
    const b = new Set(rdlItems[j].text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(w => w.length > 4));
    const inter = [...a].filter(w => b.has(w)).length;
    const union = new Set([...a, ...b]).size;
    const sim = union > 0 ? inter / union : 0;
    if (sim > 0.15) {
      rdlHighSim++;
      const catI = Object.entries(categories).find(([, v]) => v > 0)?.[0] || "?";
      console.log("  ⚠️ #" + (i+1) + " ↔ #" + (j+1) + ": " + (sim * 100).toFixed(0) + "% overlap (" + rdlItems[i].genre + "/" + rdlItems[j].genre + ")");
      const shared = [...a].filter(w => b.has(w)).slice(0, 8);
      console.log("     Shared: " + shared.join(", "));
    }
  }
}
if (rdlHighSim === 0) console.log("  ✅ No high-similarity pairs (>15%)");

// ═══ VERDICT ═══
console.log("\n━━━ TOPIC BREADTH VERDICT ━━━\n");

const problems = [];
if (dupes.length > 0) problems.push("CTW: " + dupes.length + " duplicate passage subjects — " + dupes.map(([s]) => s).join(", "));
if (highSimCount > 0) problems.push("CTW: " + highSimCount + " high-similarity passage pairs");
if (Object.values(categories).some(v => v >= 3)) {
  const over = Object.entries(categories).filter(([, v]) => v >= 3).map(([k, v]) => k + "(" + v + ")");
  problems.push("RDL: overrepresented categories: " + over.join(", "));
}
if (missing.length > 10) problems.push("RDL: " + missing.length + " possible categories never generated");
if (unusedTopics.length > 2) problems.push("CTW: " + unusedTopics.length + " topic categories never used");

if (problems.length === 0) {
  console.log("  ✅ Topic breadth looks adequate for " + (ctwItems.length + rdlItems.length) + " items");
} else {
  problems.forEach(p => console.log("  ⚠️ " + p));
}
