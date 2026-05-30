#!/usr/bin/env node
// Pull the final JSON array out of a background sub-agent's .output transcript
// WITHOUT loading the transcript into the orchestrator's context. Recursively
// collects string values from each JSONL line, finds the text that contains the
// harvested array, strips ```json fences, and bracket-matches the array.
import { readFileSync, writeFileSync } from "fs";

const [, , outputPath, destPath, marker = '"professor"'] = process.argv;
if (!outputPath || !destPath) {
  console.error("usage: node extract-agent-output.mjs <transcript.output> <dest.json> [marker]");
  process.exit(1);
}

const raw = readFileSync(outputPath, "utf8");
const lines = raw.split(/\r?\n/).filter(Boolean);

const texts = [];
function collect(v) {
  if (typeof v === "string") texts.push(v);
  else if (Array.isArray(v)) v.forEach(collect);
  else if (v && typeof v === "object") Object.values(v).forEach(collect);
}
for (const ln of lines) {
  try { collect(JSON.parse(ln)); } catch { texts.push(ln); }
}

// candidate texts that look like they hold the harvested array
const cands = texts.filter((t) => t.includes(marker) && t.includes("_tier"));
if (!cands.length) {
  console.error(`No text containing marker ${marker} + _tier found. texts=${texts.length}, fileBytes=${raw.length}`);
  process.exit(2);
}
let text = cands.sort((a, b) => b.length - a.length)[0];

// strip code fences if present
const fence = text.match(/```json\s*([\s\S]*?)```/);
if (fence) text = fence[1];

// bracket-match the first top-level [ ... ] (string-aware)
function extractArray(s) {
  const start = s.indexOf("[");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) return s.slice(start, i + 1); }
    }
  }
  return null;
}
const arrStr = extractArray(text);
if (!arrStr) { console.error("Could not bracket-match an array."); process.exit(3); }

let parsed;
try { parsed = JSON.parse(arrStr); }
catch (e) { console.error("Array did not parse:", e.message); process.exit(4); }

writeFileSync(destPath, JSON.stringify(parsed, null, 2));
console.log(`Extracted ${parsed.length} items -> ${destPath}`);
const tiers = {};
for (const it of parsed) tiers[it._tier || it.tier || "?"] = (tiers[it._tier || it.tier || "?"] || 0) + 1;
console.log("By tier:", tiers);
