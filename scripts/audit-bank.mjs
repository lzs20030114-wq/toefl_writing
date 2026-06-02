#!/usr/bin/env node

/**
 * audit-bank.mjs — answer-correctness audit of the EXISTING reading bank.
 *
 * merge-staging.mjs now gates every NEW reading item through the AI second-examiner
 * audit, but items merged BEFORE that gate existed (especially the *-routine-* AP
 * batches produced by a separate Claude routine) were never answer-audited. This
 * script re-runs the same audit over the live bank and reports every item with a
 * critical flag — a mis-keyed answer (AP/RDL) or an ambiguous blank (CTW).
 *
 * READ-ONLY: it never writes to the bank. Flagged items are printed (and optionally
 * dumped to a JSON report) for manual review.
 *
 * Usage:
 *   node scripts/audit-bank.mjs                         # audit all four banks
 *   node scripts/audit-bank.mjs --bank ap              # one bank only
 *   node scripts/audit-bank.mjs --limit 10             # first N items per bank (smoke test)
 *   node scripts/audit-bank.mjs --concurrency 8        # parallel audits (default 6)
 *   node scripts/audit-bank.mjs --json audit-report.json
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { auditItems, CTW_DEFAULT_AMBIGUITY_LIMIT } = require("../lib/readingGen/answerAuditor.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Load .env.local (key + proxy) for local runs; CI env wins (only fill what's unset).
(function loadEnv() {
  try {
    const p = join(ROOT, ".env.local");
    if (existsSync(p)) {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
      }
    }
  } catch {}
})();

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ONLY = getArg("bank", "");
const LIMIT = parseInt(getArg("limit", "0"), 10) || 0;
const CONCURRENCY = Math.max(1, parseInt(getArg("concurrency", "6"), 10) || 6);
const JSON_OUT = getArg("json", "");
// CTW tolerance for the GATE decision (max ambiguous blanks before reject). Defaults to the
// same value merge-staging uses. The backfill still REPORTS every item with ≥1 ambiguous
// blank for diagnostics — it just marks which ones actually exceed the gate.
const CTW_LIMIT = Math.max(0, parseInt(getArg("ctw-limit", String(CTW_DEFAULT_AMBIGUITY_LIMIT)), 10) || 0);

const BANKS = [
  { key: "ap",        file: "ap.json",        type: "ap" },
  { key: "rdl-short", file: "rdl-short.json", type: "rdl" },
  { key: "rdl-long",  file: "rdl-long.json",  type: "rdl" },
  { key: "ctw",       file: "ctw.json",       type: "ctw" },
];

if (!String(process.env.DEEPSEEK_API_KEY || "").trim()) {
  console.error("DEEPSEEK_API_KEY not set (in env or .env.local). Aborting — nothing to audit against.");
  process.exit(1);
}

// Pull just the critical detail lines out of an audit result, for human-readable output.
function criticalDetail(type, audit) {
  if (!audit || !Array.isArray(audit.results)) return [];
  if (type === "ctw") {
    return audit.results
      .filter((r) => (r.flags || []).some((f) => f.severity === "critical"))
      .map((r) => `blank ${r.blank} "${r.fragment}…" expected="${r.expected}" ai="${r.aiAnswer}"`);
  }
  return audit.results
    .filter((r) => (r.flags || []).some((f) => f.severity === "critical"))
    .map((r) => `${r.question} [${r.type}] marked=${r.markedAnswer} ai=${r.aiAnswer} — ${r.stem}…`);
}

const report = {
  generated_at: new Date().toISOString(),
  concurrency: CONCURRENCY,
  ctwLimit: CTW_LIMIT,
  banks: {},
  flagged: [],   // exceed the gate → would be REJECTED at merge
  tolerated: [], // have ambiguity but within tolerance → SHIP (real-exam-normal)
  errors: [],
};

console.log("╔══════════════════════════════════════════════════╗");
console.log("║   Reading Bank — Answer Audit Backfill           ║");
console.log("╚══════════════════════════════════════════════════╝");

for (const b of BANKS) {
  if (ONLY && ONLY !== b.key) continue;
  const path = join(ROOT, "data/reading/bank", b.file);
  if (!existsSync(path)) { console.log(`\n(skip ${b.file}: not found)`); continue; }

  let items = (JSON.parse(readFileSync(path, "utf8")).items) || [];
  if (LIMIT) items = items.slice(0, LIMIT);

  console.log(`\n═══ ${b.file} — ${items.length} items (type=${b.type}, concurrency=${CONCURRENCY}) ═══`);

  let done = 0, rejectN = 0, toleratedN = 0, erroredN = 0;
  const results = await auditItems(b.type, items, {
    concurrency: CONCURRENCY,
    ctwLimit: CTW_LIMIT,
    failOpen: false, // backfill: an AI failure is "could not verify", NOT "clean"
    onResult: (r) => {
      done++;
      const crit = (r.audit && r.audit.criticalFlags) || 0;
      if (r.audit && r.audit.error) {
        erroredN++;
      } else if (!r.ok) {
        // exceeds the gate → would be REJECTED at merge
        rejectN++;
        const detail = criticalDetail(b.type, r.audit);
        console.log(`\n  🔴 ${r.item.id}: ${r.reason}`);
        detail.forEach((d) => console.log(`       ${d}`));
        report.flagged.push({ bank: b.key, id: r.item.id, reason: r.reason, detail });
      } else if (crit > 0) {
        // ambiguity within tolerance → SHIPS (real-exam-normal); recorded for visibility
        toleratedN++;
        const detail = criticalDetail(b.type, r.audit);
        console.log(`\n  ⚠ ${r.item.id}: ${crit} ambiguous blank(s) — within tolerance (≤${CTW_LIMIT}), ships`);
        detail.forEach((d) => console.log(`       ${d}`));
        report.tolerated.push({ bank: b.key, id: r.item.id, ambiguous: crit, detail });
      }
      if (done % 10 === 0 || done === items.length) {
        process.stdout.write(`  …${done}/${items.length}  (${rejectN} reject, ${toleratedN} tolerated, ${erroredN} unverified)\r`);
      }
    },
  });

  results.forEach((r) => {
    if (r.audit && r.audit.error) report.errors.push({ bank: b.key, id: r.item.id, error: r.reason });
  });

  report.banks[b.key] = {
    total: items.length,
    reject: rejectN,
    tolerated: toleratedN,
    unverified: erroredN,
    clean: items.length - rejectN - toleratedN - erroredN,
  };
  console.log(`\n  → ${b.file}: ${rejectN} reject · ${toleratedN} tolerated · ${erroredN} unverified · ${items.length - rejectN - toleratedN - erroredN} clean`);
}

console.log("\n──────── BACKFILL AUDIT SUMMARY ────────");
console.log(`  (CTW tolerance = ${CTW_LIMIT} ambiguous blanks/item; AP/RDL reject on any mis-key)`);
for (const [k, v] of Object.entries(report.banks)) {
  console.log(`  ${k.padEnd(10)} reject ${String(v.reject).padStart(3)} · tolerated ${String(v.tolerated).padStart(3)} · unverified ${String(v.unverified).padStart(3)} / ${v.total}`);
}
console.log(`  ─────`);
console.log(`  TOTAL GATE-REJECT: ${report.flagged.length}  |  TOLERATED (ship): ${report.tolerated.length}`);
if (report.errors.length) console.log(`  TOTAL UNVERIFIED (AI errors): ${report.errors.length}`);

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.log(`\nFull report written → ${JSON_OUT}`);
}
