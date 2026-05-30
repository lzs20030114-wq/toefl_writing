#!/usr/bin/env node
// Build data/academicWriting/recalled_supplement.json from the verbatim
// examword scrape (.research/collected/ad_recalled_raw.json). These are Tier-2
// "recalled" real-exam TOPICS from 2026 administrations (examword-reconstructed
// wording). Kept SEPARATE from real_tpo_reference.json so the verbose
// reconstruction style does not skew the generation/style calibration that the
// 85-item ground-truth reference drives. Pure JSON array (docs in README).
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..", "..");
const raw = JSON.parse(readFileSync(resolve(root, ".research/collected/ad_recalled_raw.json"), "utf8"));
const ref = JSON.parse(readFileSync(resolve(root, "data/academicWriting/real_tpo_reference.json"), "utf8"));

const normKey = (t) =>
  String(t || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
const seen = new Set(ref.map((q) => normKey(q.professor?.text)));

const out = [];
let n = 0, dup = 0;
for (const it of raw) {
  const key = normKey(it.professor?.text);
  if (seen.has(key)) { dup++; continue; }
  seen.add(key);
  n++;
  out.push({
    id: `adr${String(n).padStart(2, "0")}`,
    course: it.course,
    professor: it.professor,
    students: it.students,
    source: it._source,
    date: it._date,
    tier: "recalled",
  });
}
writeFileSync(
  resolve(root, "data/academicWriting/recalled_supplement.json"),
  JSON.stringify(out, null, 2) + "\n",
);
console.log(`Wrote recalled_supplement.json: ${out.length} items (dup-skipped vs reference: ${dup})`);
const dated = out.filter((o) => o.date).length;
console.log(`With exam date: ${dated}; date range: ${out.filter(o=>o.date).map(o=>o.date).sort().at(0)} .. ${out.filter(o=>o.date).map(o=>o.date).sort().at(-1)}`);
