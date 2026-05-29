#!/usr/bin/env node
// Measure the REAL person-reference rate in TPO prefilled/given words.
// This is the ground-truth target we should be calibrating toward — NOT
// the estimated PREFILLED_PROFILE numbers.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

const raw = readFileSync(resolve(ROOT, "data/buildSentence/tpo_source.md"), "utf8");
const lines = raw.split(/\r?\n/);

const items = [];
let cur = null;
for (const line of lines) {
  const qm = line.match(/^__(\d+)\\?\.__\s*(.*)/);
  if (qm) {
    if (cur && cur.template) items.push(cur);
    cur = { num: qm[1], prompt: qm[2], template: "", chunks: "" };
    continue;
  }
  if (!cur) continue;
  // Template lines contain escaped underscores: \_
  if (line.includes("\\_")) {
    cur.template += (cur.template ? " " : "") + line.trim();
  } else if (line.includes(" / ") && !line.startsWith("__")) {
    cur.chunks = line.trim();
  }
}
if (cur && cur.template) items.push(cur);

console.log("Parsed TPO items:", items.length);

function getGivenSegments(template) {
  // Unescape \_ -> _ and \. -> .
  let t = template.replace(/\\_/g, "_").replace(/\\\./g, ".").replace(/\s+/g, " ").trim();
  // strip embedded headers like "__TPO Build a Sentence__ __下一套__"
  t = t.replace(/__[^_]*__/g, " ").replace(/\s+/g, " ").trim();
  // Split on runs of 2+ underscores (blanks)
  const parts = t.split(/_{2,}/);
  const segs = [];
  parts.forEach((p, pi) => {
    const cleaned = p.replace(/[.?!,;:]/g, "").trim();
    if (cleaned) {
      const pos = pi === 0 ? "START" : pi === parts.length - 1 ? "END" : "MID";
      segs.push({ text: cleaned, pos });
    }
  });
  return segs;
}

const PRONOUN = /^(i|he|she|they|we|you|i'm|i've|i'll|i'd)$/i;
const COMMON_CAP_START = new Set([
  "unfortunately", "yes", "no", "some", "the", "this", "that", "these", "those",
  "many", "few", "several", "all", "most", "every", "each", "could", "would",
  "should", "can", "will", "did", "do", "does", "is", "was", "were", "have", "has",
]);

function classifyGiven(seg) {
  const words = seg.text.trim().split(/\s+/);
  // Person ref if any word is a pronoun, OR a capitalized proper name
  // (capitalized AND not a common sentence-opener word)
  for (let i = 0; i < words.length; i++) {
    const wRaw = words[i].replace(/[^A-Za-z']/g, "");
    if (!wRaw) continue;
    if (PRONOUN.test(wRaw)) return "person";
    // Capitalized name (not a common opener word). Names appear mid-sentence
    // capitalized too. Only count if it's NOT a common word.
    if (/^[A-Z][a-z]+$/.test(wRaw) && !COMMON_CAP_START.has(wRaw.toLowerCase())) {
      return "person"; // proper name
    }
  }
  return "other";
}

let withGiven = 0, personItems = 0, noGiven = 0;
let startWithGiven = 0, startPerson = 0;
const detail = [];

for (const it of items) {
  const segs = getGivenSegments(it.template);
  if (segs.length === 0) { noGiven++; detail.push({ num: it.num, given: "(none)", cls: "EMPTY" }); continue; }
  withGiven++;
  const hasPerson = segs.some((s) => classifyGiven(s) === "person");
  if (hasPerson) personItems++;
  const startSeg = segs.find((s) => s.pos === "START");
  if (startSeg) {
    startWithGiven++;
    if (classifyGiven(startSeg) === "person") startPerson++;
  }
  detail.push({ num: it.num, given: segs.map((s) => `${s.text}[${s.pos}]`).join(" + "), cls: hasPerson ? "PERSON" : "other" });
}

console.log("\n=== TPO given/prefilled person-reference rate ===");
console.log("Items with given:", withGiven, "| no given (all blank):", noGiven);
console.log("Person-ref present (of items with given):", `${personItems}/${withGiven} = ${Math.round(personItems / withGiven * 100)}%`);
console.log("Person-ref present (of ALL items):", `${personItems}/${items.length} = ${Math.round(personItems / items.length * 100)}%`);
console.log("START-position given is person-ref:", `${startPerson}/${startWithGiven} = ${Math.round(startPerson / startWithGiven * 100)}%`);

console.log("\n=== All items ===");
detail.forEach((d) => console.log(`  Q${String(d.num).padStart(2)} [${d.cls.padEnd(6)}] ${d.given}`));
