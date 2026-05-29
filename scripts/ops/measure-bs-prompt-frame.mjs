#!/usr/bin/env node
// Sharper prompt-frame measurement. The old classifier only caught
// "What did X ASK" — it missed "What did X want to know / find out / learn",
// undercounting the over-used "What did <subject>...?" frame.
// Also measures 2nd-person ("you") interaction share — TPO is heavy on
// "Did YOU...", "Where did YOU...", which our 3rd-person prompts may lack.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

function frame(prompt) {
  const p = String(prompt || "").trim();
  if (!/[?]$/.test(p)) return "statement";
  // "What did/does/do <X> ..." — the whole family regardless of the verb
  if (/^what (did|does|do|was|were)\b/i.test(p)) return "what-did-X";
  if (/^(where|when|why|how|who|which)\b/i.test(p)) return "other-wh";
  if (/^(did|do|does|is|are|was|were|have|has|will|would|can|could|have|had)\b/i.test(p)) return "yes-no";
  return "other-Q";
}
function isSecondPerson(prompt) {
  return /\b(you|your|you're|you've)\b/i.test(String(prompt || ""));
}

function measure(prompts, label) {
  const frames = {};
  let secondP = 0;
  for (const p of prompts) {
    const f = frame(p);
    frames[f] = (frames[f] || 0) + 1;
    if (isSecondPerson(p)) secondP += 1;
  }
  return { label, N: prompts.length, frames, secondPersonFrac: secondP / prompts.length };
}

// TPO
const raw = readFileSync(resolve(ROOT, "data/buildSentence/tpo_source.md"), "utf8").split(/\r?\n/);
const tpoPrompts = [];
for (const line of raw) {
  const m = line.match(/^__(\d+)\\?\.__\s*(.*)/);
  if (m && m[2].trim()) tpoPrompts.push(m[2].trim());
}

function loadStaging(session) {
  try { return JSON.parse(readFileSync(resolve(ROOT, `data/buildSentence/staging/${session}.json`), "utf8")).items.map((q) => q.prompt); }
  catch { return []; }
}

const sessions = process.argv.slice(2);
const sets = [measure(tpoPrompts, "TPO")];
for (const s of sessions) sets.push(measure(loadStaging(s), s.slice(-13)));

const FRAMES = ["what-did-X", "other-wh", "yes-no", "statement", "other-Q"];
console.log("BS prompt FRAME (corrected — full 'What did X' family) — TPO vs ours\n");
console.log("frame".padEnd(16) + sets.map((s) => s.label.padStart(15)).join(""));
console.log("-".repeat(16 + 15 * sets.length));
for (const fr of FRAMES) {
  console.log(fr.padEnd(16) + sets.map((s) => {
    const n = s.frames[fr] || 0;
    return `${n} (${Math.round(n / s.N * 100)}%)`.padStart(15);
  }).join(""));
}
console.log("");
console.log("2nd-person 'you'".padEnd(16) + sets.map((s) => `${Math.round(s.secondPersonFrac * 100)}%`.padStart(15)).join(""));
console.log("\nTPO N=" + tpoPrompts.length);
