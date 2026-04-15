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
import { join, basename } from 'path';

const ROOT = 'D:/toefl_writing';

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

const allSummary = [];
let grandTotal = 0;

for (const section of SECTIONS) {
  if (!existsSync(section.stagingDir)) continue;

  const stagingFiles = readdirSync(section.stagingDir).filter(f => f.endsWith('.json'));
  if (stagingFiles.length === 0) continue;

  console.log(`\n═══ ${section.name} (${stagingFiles.length} staging files) ═══\n`);

  const pendingItems = {}; // bankFile → item[]

  for (const file of stagingFiles) {
    const path = join(section.stagingDir, file);
    const staging = readJSON(path);
    const items = staging.items || [];

    if (items.length === 0) {
      console.log(`  ${file}: 0 items, skipping`);
      continue;
    }

    // Extract prefix: "lcr-123.json" → "lcr", "rdl-123.json" → "rdl"
    const prefix = file.replace(/-\d+\.json$/, '');

    if (prefix === 'rdl') {
      // Special handling for RDL: classify into long/short
      const counts = {};
      for (const item of items) {
        const bankFile = classifyRdlItem(item);
        pendingItems[bankFile] = (pendingItems[bankFile] || []).concat(item);
        counts[bankFile] = (counts[bankFile] || 0) + 1;
      }
      const parts = Object.entries(counts).map(([k, v]) => `${v}→${k}`).join(', ');
      console.log(`  ${file}: ${items.length} items (${parts})`);
    } else if (section.prefixMap[prefix]) {
      const bankFile = section.prefixMap[prefix];
      pendingItems[bankFile] = (pendingItems[bankFile] || []).concat(items);
      console.log(`  ${file}: ${items.length} items → ${bankFile}`);
    } else {
      console.log(`  ${file}: unknown prefix '${prefix}', skipping`);
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
