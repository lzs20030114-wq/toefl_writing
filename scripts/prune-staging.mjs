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

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const daysIdx = argv.indexOf("--days");
const DAYS = daysIdx >= 0 ? Number(argv[daysIdx + 1]) || 14 : 14;

const cutoff = new Date();
cutoff.setUTCDate(cutoff.getUTCDate() - DAYS);

// Extract YYYYMMDD from a routine staging filename (R1 or R2), else null.
function routineDate(name) {
  const m = name.match(/routine-(?:r2-)?(\d{4})(\d{2})(\d{2})-/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d) ? null : d;
}

let deleted = 0, kept = 0, skipped = 0;
for (const dir of STAGING_DIRS) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const d = routineDate(f);
    if (!d) { skipped += 1; continue; }          // no routine date → leave alone
    if (d >= cutoff) { kept += 1; continue; }     // recent → keep
    const p = join(dir, f);
    if (dry) {
      console.log(`  would delete ${p}`);
    } else {
      unlinkSync(p);
      console.log(`  deleted ${p}`);
    }
    deleted += 1;
  }
}

console.log(`prune-staging: ${dry ? "would delete" : "deleted"} ${deleted} file(s) older than ${DAYS}d; kept ${kept} recent; left ${skipped} non-routine file(s) untouched.`);
