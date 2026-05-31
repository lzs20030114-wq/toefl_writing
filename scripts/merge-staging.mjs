#!/usr/bin/env node
/**
 * merge-staging.mjs
 *
 * Merges staging JSON files into main question bank files.
 *
 * Supports three sections:
 *   Reading:   data/reading/staging/  → data/reading/bank/
 *   Listening: data/listening/staging/ → data/listening/bank/
 *   Speaking:  data/speaking/staging/  → data/speaking/bank/
 *
 * Reading mapping:
 *   ap-*.json  → ap.json
 *   ctw-*.json → ctw.json
 *   rdl-*.json → rdl-long.json / rdl-short.json
 *
 * Listening mapping:
 *   lcr-*.json → lcr.json
 *   la-*.json  → la.json
 *   lc-*.json  → lc.json
 *   lat-*.json → lat.json
 *
 * Speaking mapping:
 *   repeat-*.json    → repeat.json
 *   interview-*.json → interview.json
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join, basename, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// 2026-06-01 FIX: merge-staging previously merged reading/listening/speaking items
// with NO per-item validation (only dedup-by-id). That shipped broken items — most
// severely CTW passages with ZERO blanks (the mechanical C-test blanker was never run
// on the routine path), plus over-length / guessable AP items. Now each item is
// VETTED here: CTW passages are blanked + validated, every other type runs its
// calibrated validator, and invalid items are dropped before they reach the bank.
const require = createRequire(import.meta.url);
const VALIDATORS = {
  ap:     (it) => require('../lib/readingGen/apValidator.js').validateAPItem(it),
  rdl:    (it) => require('../lib/readingGen/rdlValidator.js').validateRDLItem(it),
  lat:    (it) => require('../lib/listeningGen/latValidator.js').validateLAT(it),
  lc:     (it) => require('../lib/listeningGen/lcValidator.js').validateLC(it),
  la:     (it) => require('../lib/listeningGen/laValidator.js').validateLA(it),
  lcr:    (it) => require('../lib/listeningGen/lcrValidator.js').validateLCR(it),
  repeat: (it) => require('../lib/speakingGen/speakingValidator.js').validateRepeatSet(it),
  rpt:    (it) => require('../lib/speakingGen/speakingValidator.js').validateRepeatSet(it),
};

// Vet one staging item for a prefix → { ok, item, reason }.
// CTW is special: it must be run through the mechanical blanker first (the staging
// item is just a passage), then validated. A validator THROW (a bug) keeps the item
// (with a warning) so one bad validator can't silently nuke a whole bank.
function vet(prefix, item) {
  try {
    if (prefix === 'ctw') {
      const { processPassage } = require('../lib/readingGen/cTestBlanker.js');
      const { validateCTWItem } = require('../lib/readingGen/ctwValidator.js');
      const id = item.id || ('ctw_' + Date.now() + '_' + Math.floor(Math.random() * 1e6));
      const { item: blanked, error } = processPassage(item, id);
      if (error) return { ok: false, reason: 'blank: ' + error };
      const v = validateCTWItem(blanked);
      return v.pass ? { ok: true, item: blanked } : { ok: false, reason: (v.errors || []).join('; ') };
    }
    const fn = VALIDATORS[prefix];
    if (!fn) return { ok: true, item }; // no validator (e.g. interview) → pass through
    const r = fn(item) || {};
    const bad = r.pass === false || r.valid === false;
    return bad ? { ok: false, reason: (r.errors || []).join('; ') } : { ok: true, item };
  } catch (e) {
    return { ok: true, item, warn: 'validator threw (kept): ' + e.message };
  }
}

// Portable repo-root resolution: this file lives at scripts/merge-staging.mjs,
// so the parent of scripts/ is the repo root. Works on both local Windows
// dev and the Linux GitHub Actions runner.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Section configurations
const SECTIONS = [
  {
    name: 'Reading',
    stagingDir: join(ROOT, 'data/reading/staging'),
    bankDir: join(ROOT, 'data/reading/bank'),
    prefixMap: {
      ap: 'ap.json',
      ctw: 'ctw.json',
      rdl: null, // special handling
    },
  },
  {
    name: 'Listening',
    stagingDir: join(ROOT, 'data/listening/staging'),
    bankDir: join(ROOT, 'data/listening/bank'),
    prefixMap: {
      lcr: 'lcr.json',
      la: 'la.json',
      lc: 'lc.json',
      lat: 'lat.json',
    },
  },
  {
    name: 'Speaking',
    stagingDir: join(ROOT, 'data/speaking/staging'),
    bankDir: join(ROOT, 'data/speaking/bank'),
    prefixMap: {
      repeat: 'repeat.json',
      interview: 'interview.json',
      rpt: 'repeat.json',
      intv: 'interview.json',
    },
  },
];

// Legacy aliases
const STAGING_DIR = join(ROOT, 'data/reading/staging');
const BANK_DIR = join(ROOT, 'data/reading/bank');

// ── helpers ──────────────────────────────────────────────────────────

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJSON(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function loadBank(filename) {
  const path = join(BANK_DIR, filename);
  if (!existsSync(path)) {
    return { version: '1.0', items: [] };
  }
  const data = readJSON(path);
  // Bank files are objects with an items array
  return data;
}

function classifyRdlItem(item) {
  if (item.variant === 'long') return 'rdl-long.json';
  if (item.variant === 'short') return 'rdl-short.json';
  // No variant field — use word count heuristic
  if (item.word_count && item.word_count > 75) return 'rdl-long.json';
  if (item.word_count && item.word_count <= 75) return 'rdl-short.json';
  // Ultimate fallback
  return 'rdl-long.json';
}

// ── main ─────────────────────────────────────────────────────────────

// ── process all sections ─────────────────────────────────────────────

// MERGE_RUN_ID lets a nightly workflow merge only the staging file it just
// generated (e.g. "ap-1776234654231.json"), leaving every other unreviewed
// staging file untouched. Unset = merge everything in staging (legacy mode).
const ONLY_RUN_ID = String(process.env.MERGE_RUN_ID || "").trim();

const allSummary = [];
let grandTotal = 0;

for (const section of SECTIONS) {
  if (!existsSync(section.stagingDir)) continue;

  let stagingFiles = readdirSync(section.stagingDir).filter(f => f.endsWith('.json'));
  if (ONLY_RUN_ID) {
    stagingFiles = stagingFiles.filter(f => f.includes(ONLY_RUN_ID));
  }
  if (stagingFiles.length === 0) continue;

  console.log(`\n═══ ${section.name} (${stagingFiles.length} staging files) ═══\n`);

  const pendingItems = {}; // bankFile → item[]

  for (const file of stagingFiles) {
    const path = join(section.stagingDir, file);
    const staging = readJSON(path);
    const rawItems = staging.items || [];

    if (rawItems.length === 0) {
      console.log(`  ${file}: 0 items, skipping`);
      continue;
    }

    // Extract leading alpha prefix: "lcr-123.json" → "lcr",
    // "rdl-123.json" → "rdl", "rdl-123-short.json" → "rdl"
    const prefix = (file.match(/^([a-z]+)-/) || [])[1] || '';
    if (prefix !== 'rdl' && !section.prefixMap[prefix]) {
      console.log(`  ${file}: unknown prefix '${prefix}', skipping`);
      continue;
    }

    // Vet every item (CTW gets blanked first); drop invalid before it reaches the bank.
    const items = [];
    let rejected = 0;
    for (const raw of rawItems) {
      const r = vet(prefix, raw);
      if (!r.ok) { rejected++; console.log(`    ✗ ${raw.id || '?'}: ${r.reason}`); continue; }
      if (r.warn) console.log(`    ⚠ ${raw.id || '?'}: ${r.warn}`);
      items.push(r.item || raw);
    }
    if (rejected) console.log(`  ${file}: ${rejected}/${rawItems.length} rejected by validator`);
    if (items.length === 0) { console.log(`  ${file}: 0 valid items after validation, skipping`); continue; }

    if (prefix === 'rdl') {
      // Special handling for RDL: classify into long/short
      const counts = {};
      for (const item of items) {
        const bankFile = classifyRdlItem(item);
        pendingItems[bankFile] = (pendingItems[bankFile] || []).concat(item);
        counts[bankFile] = (counts[bankFile] || 0) + 1;
      }
      const parts = Object.entries(counts).map(([k, v]) => `${v}→${k}`).join(', ');
      console.log(`  ${file}: ${items.length} valid (${parts})`);
    } else {
      const bankFile = section.prefixMap[prefix];
      pendingItems[bankFile] = (pendingItems[bankFile] || []).concat(items);
      console.log(`  ${file}: ${items.length} valid → ${bankFile}`);
    }
  }

  // Merge into banks
  for (const [bankFile, newItems] of Object.entries(pendingItems)) {
    mkdirSync(section.bankDir, { recursive: true });
    const bankPath = join(section.bankDir, bankFile);
    const bank = existsSync(bankPath) ? readJSON(bankPath) : { version: 1, items: [] };
    // Normalize: if bank is an array, wrap it
    if (Array.isArray(bank)) {
      const wrapped = { version: 1, items: bank };
      Object.assign(bank, {});
    }
    if (!bank.items) bank.items = [];

    const existingIds = new Set(bank.items.map(i => i.id));
    const before = bank.items.length;

    let added = 0;
    let duplicates = 0;
    for (const item of newItems) {
      if (existingIds.has(item.id)) {
        duplicates++;
        continue;
      }
      existingIds.add(item.id);
      bank.items.push(item);
      added++;
    }

    writeJSON(bankPath, bank);
    allSummary.push({ section: section.name, bankFile, before, added, duplicates, after: bank.items.length });
    console.log(`  ${bankFile}: ${before} → ${bank.items.length} (+${added} new, ${duplicates} duplicates skipped)`);
    grandTotal += added;
  }
}

console.log('\n--- Summary ---');
for (const s of allSummary) {
  console.log(`  ${s.bankFile}: ${s.before} → ${s.after}  (+${s.added})`);
}
console.log(`\nTotal items added: ${grandTotal}`);
