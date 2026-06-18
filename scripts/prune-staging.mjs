#!/usr/bin/env node
/**
 * prune-staging.mjs — delete old routine staging files so they don't accumulate
 * forever. Staging is committed (R1/R2 commit data/) and is only ever read by the
 * merge for its own session (MERGE_RUN_ID-scoped), so old files are dead weight —
 * but they pile up (hundreds, going back months) and clutter the repo + slow scans.
 *
 * SAFE by construction:
 *   - Only deletes files whose name carries a routine date older than the cutoff:
 *       <prefix>-routine-YYYYMMDD-...json   and  <prefix>-routine-r2-YYYYMMDD-...json
 *     (this is how R1/R2 name every staging file). Files without a parseable routine
 *     date — one-off WAVE / epoch fixtures — are LEFT ALONE.
 *   - Uses the date embedded in the FILENAME, not mtime, so it works in a fresh CI
 *     checkout (where every file's mtime is the checkout time).
 *
 * The deletion criteria (routineDate / isPrunable) are exported and regression-
 * tested (__tests__/pipeline-regression.test.js) — this is the destructive step, so
 * its "what counts as old" logic must not silently drift. Importing this module does
 * NOT run the prune (guarded below), so tests can import the pure functions safely.
 *
 * Usage: node scripts/prune-staging.mjs [--days N] [--dry]
 *   --days N : keep files newer than N days (default 14)
 *   --dry    : print what would be deleted, delete nothing
 */

import { readdirSync, unlinkSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STAGING_DIRS = [
  "data/buildSentence/staging",
  "data/academicWriting/staging",
  "data/emailWriting/staging",
  "data/reading/staging",
  "data/listening/staging",
  "data/speaking/staging",
].map((d) => join(ROOT, d));

// Extract the routine date (UTC midnight) from a staging filename (R1 or R2),
// else null for one-off / non-routine names. PURE — unit-tested.
export function routineDate(name) {
  const m = String(name).match(/routine-(?:r2-)?(\d{4})(\d{2})(\d{2})-/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

// Should this filename be pruned given a cutoff date? Only dated routine files
// strictly OLDER than the cutoff. No date → never prune. PURE — unit-tested.
export function isPrunable(name, cutoff) {
  if (!String(name).endsWith(".json")) return false;
  const d = routineDate(name);
  return d != null && d < cutoff;
}

export function cutoffFrom(days, now = new Date()) {
  const c = new Date(now);
  c.setUTCDate(c.getUTCDate() - days);
  return c;
}

function runPrune({ days, dry }) {
  const cutoff = cutoffFrom(days);
  let deleted = 0, kept = 0, skipped = 0;
  for (const dir of STAGING_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      if (routineDate(f) == null) { skipped += 1; continue; } // no routine date → leave alone
      if (!isPrunable(f, cutoff)) { kept += 1; continue; }     // recent → keep
      const p = join(dir, f);
      if (dry) console.log(`  would delete ${p}`);
      else { unlinkSync(p); console.log(`  deleted ${p}`); }
      deleted += 1;
    }
  }
  console.log(`prune-staging: ${dry ? "would delete" : "deleted"} ${deleted} file(s) older than ${days}d; kept ${kept} recent; left ${skipped} non-routine file(s) untouched.`);
}

// CLI guard: only prune when run directly (node scripts/prune-staging.mjs), NOT
// when imported by a test — importing must have no side effects.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const daysIdx = argv.indexOf("--days");
  const days = daysIdx >= 0 ? Number(argv[daysIdx + 1]) || 14 : 14;
  runPrune({ days, dry });
}
