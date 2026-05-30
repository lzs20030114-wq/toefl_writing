#!/usr/bin/env node
// Test-group bookkeeping for calibration test batches.
// Any item generated to TEST a recalibrated prompt is tagged `test_group: "<tag>"`
// (and test staging files are named staging/TESTGROUP-<tag>.json). This tool lists
// or deletes those tagged items so unqualified test batches can be removed later.
//
//   node scripts/ops/purge-test-groups.mjs --list
//   node scripts/ops/purge-test-groups.mjs --delete <tag>
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { resolve } from "path";

const ROOT = process.cwd();
const SCAN = ["data/buildSentence", "data/academicWriting", "data/emailWriting",
  "data/reading/bank", "data/listening/bank", "data/speaking/bank"];

function jsonFiles(dir) {
  const out = [];
  const walk = (d) => { let s; try { s = readdirSync(resolve(ROOT, d)); } catch { return; }
    for (const f of s) { const p = resolve(ROOT, d, f);
      if (statSync(p).isDirectory()) walk(resolve(d, f));
      else if (f.endsWith(".json")) out.push(p); } };
  walk(dir); return out;
}
function arraysIn(obj) { // yield mutable item arrays found in a bank/staging file
  const res = [];
  if (Array.isArray(obj)) res.push(obj);
  for (const k of ["items", "questions", "sets", "question_sets"]) if (Array.isArray(obj?.[k])) res.push(obj[k]);
  for (const a of res.length ? [] : Object.values(obj || {})) if (Array.isArray(a)) res.push(a);
  return res;
}
const tagOf = (it) => it?.test_group || it?.meta?.test_group;

const mode = process.argv.includes("--delete") ? "delete" : "list";
const delTag = process.argv[process.argv.indexOf("--delete") + 1];
const tally = {};

for (const dir of SCAN) for (const f of jsonFiles(dir)) {
  let data; try { data = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
  let changed = false;
  for (const arr of arraysIn(data)) {
    for (const it of arr) { const t = tagOf(it); if (t) (tally[t] ||= []).push(f); }
    if (mode === "delete" && delTag) {
      const before = arr.length;
      const kept = arr.filter((it) => tagOf(it) !== delTag);
      if (kept.length !== before) { arr.length = 0; arr.push(...kept); changed = true; }
    }
  }
  if (changed) writeFileSync(f, JSON.stringify(data, null, 2));
}

if (mode === "list") {
  const tags = Object.keys(tally);
  if (!tags.length) { console.log("no test-group-tagged items found."); }
  else for (const t of tags) console.log(`${t}: ${tally[t].length} item-locations  (files: ${[...new Set(tally[t])].length})`);
} else {
  console.log(`deleted items with test_group="${delTag}" from ${[...new Set((tally[delTag] || []))].length} files.`);
}
