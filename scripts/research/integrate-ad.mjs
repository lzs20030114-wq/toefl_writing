#!/usr/bin/env node
// Merge authentic Academic Discussion questions into
// data/academicWriting/real_tpo_reference.json:
//   - existing items (kept verbatim, untouched)
//   - .research/collected/ad_official.json   (Tier-1 ETS official)
//   - .research/collected/ad_recalled.json   (Tier-2 recalled real-exam topics) [optional]
// Dedup is by normalized professor-post prefix. New items get sequential ad-IDs
// and provenance fields (source / source_label / date / tier). Existing items
// are left exactly as they are.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..", "..");
const refPath = resolve(root, "data/academicWriting/real_tpo_reference.json");
const existing = JSON.parse(readFileSync(refPath, "utf8"));

const load = (p) => (existsSync(resolve(root, p)) ? JSON.parse(readFileSync(resolve(root, p), "utf8")) : []);
const official = load(".research/collected/ad_official.json");
const recalled = load(".research/collected/ad_recalled.json");

const normKey = (t) =>
  String(t || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

// seed dedup set with existing professor posts
const seen = new Set(existing.map((q) => normKey(q.professor?.text)));

// highest existing ad-number
let maxId = 0;
for (const q of existing) {
  const m = String(q.id || "").match(/^ad(\d+)$/);
  if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
}

function clean(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/--/g, "—") // ETS uses -- for em dash
    .trim();
}

function normalizeItem(it, tier) {
  const prof = it.professor || {};
  const students = Array.isArray(it.students) ? it.students : [];
  return {
    course: (it.course || "social studies").toLowerCase().trim(),
    professor: { name: prof.name || "Professor", text: clean(prof.text) },
    students: students.slice(0, 2).map((s, i) => ({
      name: s.name || `Student ${i + 1}`,
      text: clean(s.text),
    })),
    _src: it._source || it.source || null,
    _srcLabel: it._source_label || it.source_label || null,
    _date: it._date || it.date || null,
    _tier: it._tier || it.tier || tier,
  };
}

const added = [];
let dropNoProf = 0, dropFewStudents = 0, dropDup = 0;

function consider(rawItem, defaultTier) {
  const it = normalizeItem(rawItem, defaultTier);
  if (!it.professor.text || it.professor.text.length < 40) { dropNoProf++; return; }
  if (it.students.length < 2) { dropFewStudents++; return; }
  const key = normKey(it.professor.text);
  if (seen.has(key)) { dropDup++; return; }
  seen.add(key);
  maxId += 1;
  added.push({
    id: `ad${maxId}`,
    course: it.course,
    professor: it.professor,
    students: it.students,
    source: it._src,
    source_label: it._srcLabel,
    date: it._date,
    tier: it._tier,
  });
}

for (const it of official) consider(it, "official");
for (const it of recalled) consider(it, "recalled");

const merged = [...existing, ...added];
writeFileSync(refPath, JSON.stringify(merged, null, 2) + "\n");

console.log(`Existing: ${existing.length}`);
console.log(`Official candidates: ${official.length}  Recalled candidates: ${recalled.length}`);
console.log(`Added: ${added.length}  (dup-skipped: ${dropDup}, no-prof: ${dropNoProf}, <2-students: ${dropFewStudents})`);
console.log(`New total: ${merged.length}`);
const tierHist = {};
for (const a of added) tierHist[a.tier] = (tierHist[a.tier] || 0) + 1;
console.log("Added by tier:", tierHist);
console.log("New ID range:", added.length ? `${added[0].id} .. ${added[added.length - 1].id}` : "(none)");
