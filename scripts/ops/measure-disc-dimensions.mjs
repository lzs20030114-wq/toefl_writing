#!/usr/bin/env node
// Calibration-fix Phase 2/3 for Academic Discussion.
// Measures the SAME dimensions on real TPO (48 authentic items) vs our recent
// generated output, apples-to-apples. Do NOT trust the prompt's stated targets
// (they may be stale, like embeddedRatio was) — measure the authentic items.

import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

// ── load authentic TPO Discussion ────────────────────────────────────────
function loadAuthentic() {
  let auth = [];
  const ref = JSON.parse(readFileSync(resolve(ROOT, "data/academicWriting/real_tpo_reference.json"), "utf8"));
  const refA = Array.isArray(ref) ? ref : ref.items || [];
  auth = auth.concat(refA.filter((x) => x.tier === "official" || x.tier === "recalled"));
  if (existsSync(resolve(ROOT, "data/academicWriting/recalled_supplement.json"))) {
    const s = JSON.parse(readFileSync(resolve(ROOT, "data/academicWriting/recalled_supplement.json"), "utf8"));
    const sA = Array.isArray(s) ? s : s.items || [];
    auth = auth.concat(sA.filter((x) => !x.tier || x.tier === "recalled" || x.tier === "official"));
  }
  return auth.filter((x) => x && x.professor && Array.isArray(x.students) && x.students.length >= 2);
}

// ── load our recent generated output (aggregate recent batches) ───────────
function loadOurs(nBatches = 12) {
  const dir = resolve(ROOT, "data/academicWriting/staging");
  const files = readdirSync(dir).filter((f) => /^routine-\d.*\.json$/.test(f) && !f.includes("r2")).sort().reverse().slice(0, nBatches);
  let items = [];
  for (const f of files) {
    try { items = items.concat(JSON.parse(readFileSync(resolve(dir, f), "utf8")).items || []); } catch {}
  }
  return items.filter((x) => x && x.professor && Array.isArray(x.students) && x.students.length >= 2);
}

// ── classifiers ───────────────────────────────────────────────────────────
function profOpening(text) {
  const t = String(text || "").trim().toLowerCase();
  if (t.startsWith("today")) return "today";
  if (t.startsWith("for this week") || t.startsWith("this week")) return "this_week";
  if (t.startsWith("as we") || t.startsWith("as i") || t.startsWith("last week") || t.startsWith("as discussed")) return "as_discussed";
  if (t.startsWith("over the")) return "over_weeks";
  if (/^[a-z'’]+[^.?!]*\?/.test(t.split(/[.?!]/)[0] + "?") && t.indexOf("?") < 60) return "question_first";
  return "natural";
}
const CONTRACTION = /\b\w+'(s|re|ve|ll|d|t|m)\b|\b(can't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|it's|that's|let's|we're|they're|i'm|you're)\b/i;
function hasContraction(t) { return CONTRACTION.test(String(t || "")); }
function hasQuestion(t) { return /\?/.test(String(t || "")); }

function stats(arr) {
  if (!arr.length) return { n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  return { mean: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length), min: s[0], max: s[s.length - 1], p10: s[Math.floor(arr.length * 0.1)], p90: s[Math.floor(arr.length * 0.9)] };
}

function measure(items, label) {
  const profLen = [], s1Len = [], s2Len = [];
  const courses = {}, names = {}, openings = {};
  let s2RefS1 = 0, profContraction = 0, profQuestion = 0;
  for (const q of items) {
    const prof = q.professor?.text || "";
    const s1 = q.students[0] || {}, s2 = q.students[1] || {};
    profLen.push(prof.length);
    s1Len.push((s1.text || "").length);
    s2Len.push((s2.text || "").length);
    const c = String(q.course || "").toLowerCase().trim(); courses[c] = (courses[c] || 0) + 1;
    [s1.name, s2.name].forEach((n) => { if (n) names[String(n).trim()] = (names[String(n).trim()] || 0) + 1; });
    const op = profOpening(prof); openings[op] = (openings[op] || 0) + 1;
    if (s1.name && new RegExp("\\b" + String(s1.name).trim().replace(/[^a-z]/gi, "") + "\\b", "i").test(s2.text || "")) s2RefS1 += 1;
    if (hasContraction(prof)) profContraction += 1;
    if (hasQuestion(prof)) profQuestion += 1;
  }
  const N = items.length;
  const claire = (names["Claire"] || 0) + (names["Paul"] || 0);
  const totalNames = Object.values(names).reduce((a, b) => a + b, 0);
  return {
    label, N,
    profLen: stats(profLen), s1Len: stats(s1Len), s2Len: stats(s2Len),
    distinctCourses: Object.keys(courses).length,
    distinctNames: Object.keys(names).length,
    clairePaulShare: totalNames ? claire / totalNames : 0,
    openings,
    s2RefS1Frac: s2RefS1 / N,
    profContractionFrac: profContraction / N,
    profQuestionFrac: profQuestion / N,
  };
}

const tpo = measure(loadAuthentic(), "TPO-auth");
const ours = measure(loadOurs(), "ours");

console.log("Academic Discussion — TPO(authentic) vs ours\n");
const row = (k, f) => console.log(k.padEnd(26) + String(f(tpo)).padStart(16) + String(f(ours)).padStart(16));
console.log("dimension".padEnd(26) + "TPO-auth".padStart(16) + "ours".padStart(16));
console.log("-".repeat(58));
console.log("N".padEnd(26) + String(tpo.N).padStart(16) + String(ours.N).padStart(16));
row("professor len (chars)", (x) => `${x.profLen.mean} [${x.profLen.p10}-${x.profLen.p90}]`);
row("student1 len", (x) => `${x.s1Len.mean} [${x.s1Len.p10}-${x.s1Len.p90}]`);
row("student2 len", (x) => `${x.s2Len.mean} [${x.s2Len.p10}-${x.s2Len.p90}]`);
row("distinct courses", (x) => `${x.distinctCourses}/${x.N}`);
row("distinct student names", (x) => `${x.distinctNames}`);
row("Claire+Paul share", (x) => `${Math.round(x.clairePaulShare * 100)}%`);
row("s2 references s1", (x) => `${Math.round(x.s2RefS1Frac * 100)}%`);
row("prof uses contraction", (x) => `${Math.round(x.profContractionFrac * 100)}%`);
row("prof post has '?'", (x) => `${Math.round(x.profQuestionFrac * 100)}%`);
console.log("\nopening styles:");
const allOps = new Set([...Object.keys(tpo.openings), ...Object.keys(ours.openings)]);
for (const op of allOps) {
  const t = tpo.openings[op] || 0, o = ours.openings[op] || 0;
  console.log("  " + op.padEnd(20) + `TPO ${Math.round(t / tpo.N * 100)}%`.padStart(12) + `  ours ${Math.round(o / ours.N * 100)}%`.padStart(14));
}
