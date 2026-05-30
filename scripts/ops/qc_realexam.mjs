#!/usr/bin/env node
// Unified QC for data/realExam2026/. Per-type schema validity + junk detection
// (watermark / CJK-in-English / empty / too-short) + duplicate IDs + duplicate
// content. Prints a table, global flags, and sample problems.
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname, relative } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = resolve(ROOT, "data/realExam2026");

const WM = /闲鱼|盗卖|退款|店铺|甜茶|满分小屋|唯一闲/;
const CJK = /[一-鿿]/;            // unexpected Chinese in an English field
const JUNKPHRASE = /Read in Daily Life|Answer questions about|Choose the best|^\s*Module|Hide Time|Cut Paste/i;
const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

function walk(d) { let r = []; for (const f of readdirSync(d)) { const p = resolve(d, f); if (statSync(p).isDirectory()) r = r.concat(walk(p)); else if (f.endsWith(".json")) r.push(p); } return r; }

// collect CONTENT text only (exclude metadata: source has the Chinese set name)
const META = new Set(["id", "source", "date", "tier", "type", "source_kind", "subtype", "module", "n", "words", "difficulty", "sentence_count"]);
function texts(it) {
  const out = [];
  const pull = (v) => { if (typeof v === "string") out.push(v); else if (Array.isArray(v)) v.forEach(pull); else if (v && typeof v === "object") for (const [k, val] of Object.entries(v)) if (!META.has(k)) pull(val); };
  pull(it);
  return out;
}

// per-type validity rule -> null if OK, else reason string
function validate(file, it) {
  const t = texts(it);
  if (t.some((s) => WM.test(s))) return "watermark";
  if (t.some((s) => CJK.test(s) && /[a-zA-Z]/.test(s))) return "CJK-in-English";
  if (file.includes("conversations")) return (it.conversation?.[0]?.text || "").length > 40 ? null : "conv-too-short";
  if (file.includes("announcements") || file.includes("lectures")) return (it.transcript || "").length > 40 ? null : "transcript-too-short";
  if (file.includes("shortResponse")) return ((it.prompts?.length >= 3) || wc(it.text) >= 6) ? null : "short-empty";
  if (file.includes("completeTheWords")) return (it.paragraph?.length > 80 && /^[A-Z]/.test(it.paragraph) && !JUNKPHRASE.test(it.paragraph)) ? null : "ctw-bad";
  if (file.includes("academicPassage")) return ((it.passage || "").length > 80 && (it.questions?.length >= 1)) ? null : "ap-bad";
  if (file.includes("buildSentence-targets")) return wc(it.target) >= 3 ? null : "bs-target-short";
  if (file.includes("buildSentence.json")) return (it.target && it.prompt_context) ? null : "bs-missing";
  if (file.includes("academicDiscussion")) {
    if (!it.course) return "ad-no-course";
    if (!(it.professor_question || "").trim().endsWith("?")) return "ad-q-no?";
    if (!(it.students?.length >= 2 && it.students.every((s) => (s.text || "").length > 15))) return "ad-students<2";
    return null;
  }
  if (file.includes("email")) return ((it.scenario || "").length > 40 && it.recipient && it.bullets?.length >= 1) ? null : "email-incomplete";
  if (file.includes("repeat")) return (it.sentences?.length >= 5 || it.sentences?.length >= 1) ? null : "repeat-short";
  if (file.includes("interview")) return (it.setting && it.questions?.length >= 2) ? null : "interview-thin";
  return null;
}

let rows = [], totalItems = 0, totalValid = 0, wmHits = 0, cjkHits = 0, dupId = 0, dupContent = 0;
const samples = {};

for (const f of walk(BASE).sort()) {
  const rel = relative(BASE, f);
  const d = JSON.parse(readFileSync(f, "utf8"));
  const items = d.items || d.sets || [];
  let valid = 0; const reasons = {};
  const idSeen = new Map(), contentSeen = new Map();   // per-file dup check
  for (const it of items) {
    totalItems++;
    const r = validate(rel, it);
    if (r === null) { valid++; totalValid++; }
    else { reasons[r] = (reasons[r] || 0) + 1; if (r === "watermark") wmHits++; if (r === "CJK-in-English") cjkHits++; (samples[r] ||= []).push(`${rel} ${it.id || ""}`); }
    if (it.id) { if (idSeen.has(it.id)) dupId++; else idSeen.set(it.id, 1); }
    const key = (it.target || it.paragraph || it.passage || it.professor_question || it.conversation?.[0]?.text || it.transcript || JSON.stringify(it.sentences || it.questions || "")).slice(0, 120);
    if (key && key.length > 30) { if (contentSeen.has(key)) dupContent++; else contentSeen.set(key, 1); }
  }
  rows.push([rel, items.length, valid, items.length - valid, Object.entries(reasons).map(([k, v]) => `${k}:${v}`).join(" ")]);
}

const w = Math.max(...rows.map((r) => r[0].length));
console.log("FILE".padEnd(w) + "  TOT  OK  FLAG  reasons");
console.log("-".repeat(w + 30));
for (const r of rows) console.log(r[0].padEnd(w) + "  " + String(r[1]).padStart(3) + "  " + String(r[2]).padStart(3) + "  " + String(r[3]).padStart(4) + "  " + r[4]);
console.log("-".repeat(w + 30));
console.log(`TOTAL items=${totalItems}  valid=${totalValid} (${Math.round(totalValid / totalItems * 100)}%)  flagged=${totalItems - totalValid}`);
console.log(`\nGLOBAL: watermark=${wmHits}  CJK-in-English=${cjkHits}  dup-IDs=${dupId}  dup-content=${dupContent}`);
console.log("\nSAMPLE flagged (up to 3 each reason):");
for (const [r, arr] of Object.entries(samples)) console.log(`  [${r}] ` + arr.slice(0, 3).join(" | "));
