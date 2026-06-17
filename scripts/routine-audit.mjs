#!/usr/bin/env node
/**
 * routine-audit.mjs — Claude-in-the-routine MCQ answer audit (no API key needed).
 *
 * The routine model itself is the independent "second examiner": it re-answers
 * every MCQ blind (without the answer key) and this script does the deterministic
 * compare. Replaces the DeepSeek-over-HTTP audit on the primary path, which was
 * silently SKIPPED because the routine environment has no DEEPSEEK_API_KEY.
 *
 * Two phases, run by the routine between writing staging and merging:
 *
 *   1) node scripts/routine-audit.mjs extract <SESSION_ID>
 *        Scans reading + listening staging for this session, writes the blind
 *        questions (stem + options + passage/conversation, NO keys) to
 *        data/.audit-blind.json.
 *
 *   2) <the routine reads data/.audit-blind.json, answers every question using
 *      ONLY the provided context, and writes data/.audit-solved.json:
 *        { "answers": { "<key>": "B", "<key>": "D", ... } } >
 *
 *   3) node scripts/routine-audit.mjs apply <SESSION_ID>
 *        Compares the routine's answers to the marked keys, DROPS any item with a
 *        mismatch from its staging file (so the later merge only sees clean items),
 *        and writes a receipt to data/.audit-report.json.
 *
 * Covers MCQ banks: ap, rdl (reading) + la, lat, lc, lcr (listening). CTW is not
 * MCQ and is handled by the c-test blanker / ctwValidator.
 *
 * Exit codes: 0 on success (mismatches are reported, not an error). 1 only on a
 * hard failure (bad args, missing solved file in apply, unreadable staging).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { MCQ_CONFIG, prefixOf, extractBlind, applyVerdict } from "../lib/quality/mcqAudit.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STAGING_DIRS = [
  join(ROOT, "data/reading/staging"),
  join(ROOT, "data/listening/staging"),
];
const BLIND_PATH = join(ROOT, "data/.audit-blind.json");
const SOLVED_PATH = join(ROOT, "data/.audit-solved.json");
const REPORT_PATH = join(ROOT, "data/.audit-report.json");

const cmd = (process.argv[2] || "").trim();
const sessionArg = (process.argv[3] || "").trim();

function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (!["extract", "apply"].includes(cmd)) {
  die("Usage:\n  node scripts/routine-audit.mjs extract [SESSION_ID]\n  node scripts/routine-audit.mjs apply [SESSION_ID]\n  (SESSION_ID defaults to session_id [+ r2_session_id] in data/.routine-meta.json)");
}

// SESSION_ID is optional. When omitted, the dedicated audit routine audits BOTH
// R1's batch (session_id) and, on retry nights, R2's supplement (r2_session_id) —
// so one pass covers everything pending. An explicit arg overrides to a single one.
let sessions;
if (sessionArg) {
  sessions = [sessionArg];
} else {
  const metaPath = join(ROOT, "data/.routine-meta.json");
  sessions = [];
  if (existsSync(metaPath)) {
    try {
      const m = JSON.parse(readFileSync(metaPath, "utf8"));
      for (const s of [m.session_id, m.r2_session_id]) {
        if (s && String(s).trim()) sessions.push(String(s).trim());
      }
    } catch { /* fall through */ }
  }
}
if (sessions.length === 0) die(`No SESSION_ID given and none found in data/.routine-meta.json.`);
// Primary id used for the receipt's `session` field (compute-quality-report matches it).
const session = sessions[0];

// Staging files for any of the target sessions that map to an auditable MCQ bank.
function matchingFiles() {
  const out = [];
  for (const dir of STAGING_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      if (!sessions.some((s) => f.includes(s))) continue;
      const prefix = prefixOf(f);
      if (!MCQ_CONFIG[prefix]) continue; // not an MCQ bank (e.g. ctw, speaking)
      out.push({ file: f, prefix, path: join(dir, f) });
    }
  }
  return out;
}

function readJSON(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}
function writeJSON(p, data) {
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ── extract ──────────────────────────────────────────────────────────
if (cmd === "extract") {
  const files = matchingFiles();
  const questions = [];
  for (const { file, prefix, path } of files) {
    let staging;
    try { staging = readJSON(path); } catch (e) { die(`Cannot read ${path}: ${e.message}`); }
    questions.push(...extractBlind(staging.items || [], prefix, file));
  }

  writeJSON(BLIND_PATH, {
    session,
    generated_at: new Date().toISOString(),
    count: questions.length,
    instructions:
      "You are an independent second examiner. Answer EACH question below using ONLY its `context` " +
      "(the passage / conversation / prompt) — do not use outside knowledge, and you have NOT seen any answer key. " +
      "Pick the single best option letter. Write your answers to data/.audit-solved.json as " +
      '{ "answers": { "<key>": "B", "<key>": "D", ... } } using each question\'s `key` verbatim, ' +
      "then run: node scripts/routine-audit.mjs apply " + session,
    questions,
  });

  console.log(`🔍 routine-audit extract: ${questions.length} question(s) across ${files.length} file(s) → data/.audit-blind.json`);
  if (questions.length === 0) {
    console.log("   (nothing to audit this session — apply is a no-op)");
  } else {
    console.log("   Next: solve every question in data/.audit-blind.json, write data/.audit-solved.json, then run apply.");
  }
  process.exit(0);
}

// ── apply ────────────────────────────────────────────────────────────
if (cmd === "apply") {
  const files = matchingFiles();

  // No MCQ files this session → write an empty receipt and succeed (keeps the
  // routine flow uniform whether or not reading/listening were generated).
  if (files.length === 0) {
    writeJSON(REPORT_PATH, {
      session, generated_at: new Date().toISOString(),
      note: "no auditable MCQ staging files for this session",
      totals: { questions: 0, matched: 0, mismatched: 0, skipped: 0, rejected_items: 0 },
      files: [], rejected: [],
    });
    console.log("✅ routine-audit apply: no MCQ staging files this session — nothing to audit.");
    process.exit(0);
  }

  if (!existsSync(SOLVED_PATH)) {
    die(`✗ data/.audit-solved.json not found. Run extract, solve the questions, write the answers, then apply.`);
  }
  let solved;
  try { solved = readJSON(SOLVED_PATH); } catch (e) { die(`Cannot parse data/.audit-solved.json: ${e.message}`); }

  const report = {
    session,
    generated_at: new Date().toISOString(),
    totals: { questions: 0, matched: 0, mismatched: 0, skipped: 0, rejected_items: 0 },
    files: [],
    rejected: [],
  };

  for (const { file, prefix, path } of files) {
    let staging;
    try { staging = readJSON(path); } catch (e) { die(`Cannot read ${path}: ${e.message}`); }
    const items = staging.items || [];
    const v = applyVerdict(items, prefix, file, solved);

    if (v.rejectedItems.length > 0) {
      staging.items = v.keptItems;
      writeJSON(path, staging); // drop mis-keyed items so the merge never sees them
    }

    report.totals.questions += v.totalQ;
    report.totals.matched += v.matched;
    report.totals.mismatched += v.mismatches.length;
    report.totals.skipped += v.skipped.length;
    report.totals.rejected_items += v.rejectedItems.length;
    report.files.push({
      file, prefix,
      questions: v.totalQ,
      matched: v.matched,
      mismatched: v.mismatches.length,
      skipped: v.skipped.length,
      rejected_items: v.rejectedItems.length,
    });
    for (const m of v.mismatches) report.rejected.push({ file, ...m });

    const tag = v.rejectedItems.length ? `✗ dropped ${v.rejectedItems.length} item(s)` : "✓ clean";
    console.log(`  ${file}: ${v.matched}/${v.totalQ} matched, ${v.skipped.length} unanswered — ${tag}`);
  }

  writeJSON(REPORT_PATH, report);
  const t = report.totals;
  console.log(`\n✅ routine-audit apply: ${t.matched}/${t.questions} matched, ${t.mismatched} mismatch(es), ${t.rejected_items} item(s) dropped. Receipt → data/.audit-report.json`);
  if (t.skipped > 0) {
    console.log(`   ⚠ ${t.skipped} question(s) were left unanswered (kept, not audited) — re-run extract/apply to cover them.`);
  }
  process.exit(0);
}
