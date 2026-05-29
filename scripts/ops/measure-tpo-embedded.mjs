#!/usr/bin/env node
// Resolve the conflict: BS prompt says indirect-Q ~44%, etsProfile says 63%.
// Measure embedded-Q markers directly in TPO chunks+given text (these words
// appear LITERALLY, so detection is reliable — no answer reconstruction).
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = readFileSync(resolve(ROOT, "data/buildSentence/tpo_source.md"), "utf8").split(/\r?\n/);

const items = [];
let cur = null;
for (const line of raw) {
  const m = line.match(/^__(\d+)\\?\.__/);
  if (m) { if (cur) items.push(cur); cur = { t: "", c: "" }; continue; }
  if (!cur) continue;
  if (line.includes("\\_")) cur.t += " " + line;
  else if (line.includes(" / ") && !line.startsWith("__")) cur.c += " " + line;
}
if (cur) items.push(cur);

const EMB = /\b(if|whether|wondered|wondering|wonder|curious|wanted to know|want to know|found out|find out|to know|asked|unsure|figure out|needed to know)\b/i;
const NEG = /\b(not|n't|no longer|never|no idea|none)\b/i;

let emb = 0, neg = 0;
for (const it of items) {
  const txt = (it.t + " " + it.c).replace(/\\_/g, " ").replace(/\\\./g, ".").replace(/_/g, " ");
  if (EMB.test(txt)) emb += 1;
  if (NEG.test(txt)) neg += 1;
}
console.log("TPO items parsed:", items.length);
console.log(`embedded-Q markers: ${emb}/${items.length} = ${Math.round(emb / items.length * 100)}%`);
console.log(`negation markers:   ${neg}/${items.length} = ${Math.round(neg / items.length * 100)}%`);
console.log("");
console.log("Conflict: BS prompt says indirect-Q ~44%; etsProfile.embeddedRatio says 63%.");
