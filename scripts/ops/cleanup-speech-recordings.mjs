#!/usr/bin/env node
/**
 * 90-day cleanup for retained口语 recordings.
 *
 * Deletes speech_recordings rows (and their objects in the private
 * `speech_recordings` bucket) whose created_at is older than the retention
 * window (default 90 days). Dry-run by default — pass --execute to actually delete.
 * NOT wired to any cron; run manually or from a routine later.
 *
 * Usage:
 *   node scripts/ops/cleanup-speech-recordings.mjs              # dry-run (list only)
 *   node scripts/ops/cleanup-speech-recordings.mjs --execute    # actually delete
 *   node scripts/ops/cleanup-speech-recordings.mjs --days 30 --execute
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

const BUCKET = "speech_recordings";
const TABLE = "speech_recordings";
const DELETE_BATCH = 100; // storage .remove() + row .delete() page size

const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");
const daysArg = argv.indexOf("--days");
const RETENTION_DAYS = daysArg >= 0 ? Number(argv[daysArg + 1]) : 90;

if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS <= 0) {
  console.error(`Invalid --days value: ${argv[daysArg + 1]}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  console.log(`=== cleanup-speech-recordings ===`);
  console.log(`mode: ${EXECUTE ? "EXECUTE (will delete)" : "DRY-RUN (list only)"}`);
  console.log(`window: ${RETENTION_DAYS} days  →  deleting created_at < ${cutoff}\n`);

  const { data: rows, error } = await sb
    .from(TABLE)
    .select("id, user_code, storage_path, created_at")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log("Nothing to clean up. ✅");
    return;
  }

  console.log(`Found ${rows.length} recording(s) past the retention window:`);
  for (const r of rows) {
    console.log(`  ${r.created_at}  ${r.user_code}  ${r.storage_path}`);
  }

  if (!EXECUTE) {
    console.log(`\nDry-run — nothing deleted. Re-run with --execute to delete these ${rows.length} recording(s).`);
    return;
  }

  let objectsRemoved = 0;
  let rowsDeleted = 0;

  for (const batch of chunk(rows, DELETE_BATCH)) {
    const paths = batch.map((r) => r.storage_path).filter(Boolean);
    const ids = batch.map((r) => r.id);

    if (paths.length) {
      const { error: rmErr } = await sb.storage.from(BUCKET).remove(paths);
      if (rmErr) {
        console.error(`  Storage remove failed for a batch (${paths.length} objects):`, rmErr.message);
        console.error("  Aborting before deleting rows so nothing is orphaned as an untracked object.");
        process.exit(1);
      }
      objectsRemoved += paths.length;
    }

    const { error: delErr } = await sb.from(TABLE).delete().in("id", ids);
    if (delErr) {
      console.error(`  Row delete failed for a batch (${ids.length} rows):`, delErr.message);
      process.exit(1);
    }
    rowsDeleted += ids.length;
  }

  console.log(`\nDeleted ${objectsRemoved} object(s) and ${rowsDeleted} row(s). ✅`);
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e);
  process.exit(1);
});
