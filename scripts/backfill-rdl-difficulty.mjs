#!/usr/bin/env node

/**
 * Backfill measured difficulty labels onto the live RDL banks.
 *
 * The pre-2026-07 RDL prompt never assigned difficulty — the model parroted
 * the few-shot placeholder "easy" (rdl-short ended up 207/229 "easy", zero
 * "hard"). This script relabels every item with lib/readingGen/rdlDifficulty
 * (the same estimator the generation pipeline now uses), so bank labels and
 * new-item labels share one measured scale.
 *
 * Relabeling is honest classification, not upgrading: items generated with
 * no difficulty targeting mostly measure easy/medium. The hard pool grows
 * through new tilted generation, not through this script.
 *
 * Usage: node scripts/backfill-rdl-difficulty.mjs [--dry-run]
 * Idempotent — safe to re-run after estimator threshold changes.
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { estimateRdlDifficulty } = require("../lib/readingGen/rdlDifficulty.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

const BANKS = [
  { path: join(ROOT, "data", "reading", "bank", "rdl-short.json"), variant: "short" },
  { path: join(ROOT, "data", "reading", "bank", "rdl-long.json"), variant: "long" },
];

for (const { path, variant } of BANKS) {
  const bank = JSON.parse(readFileSync(path, "utf-8"));
  const items = bank.items || [];

  const before = {};
  const after = {};
  let changed = 0;

  for (const item of items) {
    const old = item.difficulty || "(none)";
    before[old] = (before[old] || 0) + 1;

    const { difficulty } = estimateRdlDifficulty({ ...item, variant });
    if (item.difficulty !== difficulty) {
      item.difficulty = difficulty;
      changed++;
    }
    after[difficulty] = (after[difficulty] || 0) + 1;
  }

  console.log(`${path.split(/[\\/]/).pop()} (${items.length} items, ${changed} relabeled)`);
  console.log(`  before: ${JSON.stringify(before)}`);
  console.log(`  after:  ${JSON.stringify(after)}`);

  if (!DRY_RUN) {
    writeFileSync(path, JSON.stringify(bank, null, 2) + "\n");
  }
}

console.log(DRY_RUN ? "\n(dry-run — nothing written)" : "\nBanks updated.");
