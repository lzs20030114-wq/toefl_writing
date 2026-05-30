#!/usr/bin/env node
// CRITICAL self-audit: 44 of 48 "authentic" Discussion items are RECALLED
// (third-party reconstructed wording). Before calibrating wording/style
// dimensions to them, check whether OFFICIAL (verbatim ETS, n=4) and RECALLED
// (n=44) AGREE. If they diverge on a dimension, the recalled items are a
// reconstruction artifact for that dimension — don't calibrate to them.

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function profOpening(text) {
  const t = String(text || "").trim().toLowerCase();
  if (t.startsWith("today")) return "today";
  if (t.startsWith("for this week") || t.startsWith("this week")) return "this_week";
  if (t.startsWith("as we") || t.startsWith("as i") || t.startsWith("last week")) return "as_discussed";
  if (t.startsWith("over the")) return "over_weeks";
  return "other";
}
const CONTRACTION = /\b(can't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|it's|that's|let's|we're|they're|i'm|you're|we've|you've|here's)\b/i;

function load() {
  const off = [], rec = [];
  const ref = JSON.parse(readFileSync(resolve(ROOT, "data/academicWriting/real_tpo_reference.json"), "utf8"));
  for (const x of (Array.isArray(ref) ? ref : ref.items || [])) {
    if (x.tier === "official") off.push(x);
    else if (x.tier === "recalled") rec.push(x);
  }
  if (existsSync(resolve(ROOT, "data/academicWriting/recalled_supplement.json"))) {
    const s = JSON.parse(readFileSync(resolve(ROOT, "data/academicWriting/recalled_supplement.json"), "utf8"));
    for (const x of (Array.isArray(s) ? s : s.items || [])) {
      if (x.tier === "official") off.push(x); else rec.push(x);
    }
  }
  const ok = (a) => a.filter((x) => x && x.professor && Array.isArray(x.students) && x.students.length >= 2);
  return { off: ok(off), rec: ok(rec) };
}

function measure(items, label) {
  if (!items.length) { console.log(`${label}: (none)`); return; }
  const profLen = items.map((q) => (q.professor?.text || "").length);
  const ops = {};
  let contraction = 0, s2ref = 0;
  for (const q of items) {
    const op = profOpening(q.professor?.text); ops[op] = (ops[op] || 0) + 1;
    if (CONTRACTION.test(q.professor?.text || "")) contraction += 1;
    const s1n = String(q.students[0]?.name || "").replace(/[^a-z]/gi, "");
    if (s1n && new RegExp("\\b" + s1n + "\\b", "i").test(q.students[1]?.text || "")) s2ref += 1;
  }
  const N = items.length;
  const mean = Math.round(profLen.reduce((a, b) => a + b, 0) / N);
  const todayPct = Math.round((ops.today || 0) / N * 100);
  console.log(`${label} (n=${N}):`);
  console.log(`  professor len mean: ${mean} chars`);
  console.log(`  opening "today": ${todayPct}%   (full: ${JSON.stringify(ops)})`);
  console.log(`  prof contraction: ${Math.round(contraction / N * 100)}%`);
  console.log(`  s2 references s1 by name: ${Math.round(s2ref / N * 100)}%`);
}

const { off, rec } = load();
console.log("=== OFFICIAL (verbatim ETS — gold standard) ===");
measure(off, "official");
console.log("\n=== RECALLED (reconstructed wording — may be artifact) ===");
measure(rec, "recalled");
console.log("\nIf these DIVERGE, the recalled items are a wording-style artifact —");
console.log("trust official for style/length, recalled only for topic coverage.");
