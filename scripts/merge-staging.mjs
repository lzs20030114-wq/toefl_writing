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

// 2026-06-02 FIX: vet() above only checks STRUCTURE (schema/profile). It cannot
// catch a mis-keyed or ambiguous answer — a structurally-valid AP/RDL item with the
// wrong correct_answer, or a CTW blank with two words that fit. The generate-*.mjs
// scripts run an AI "second examiner" audit, but the bulk of the bank arrives here
// from "*-routine-*" staging files that never ran it. So merge now ALSO answer-audits
// every reading item (AP/RDL/CTW) and drops criticals — see auditAndKeep() below.
const { auditItems } = require('../lib/readingGen/answerAuditor.js');

// Pull DEEPSEEK_API_KEY (+ proxy) from .env.local for local merges. In CI the key
// comes from the step's env, which takes precedence (we only fill what's unset).
function loadEnv() {
  try {
    const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, 'utf8').split('\n')) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
      }
    }
  } catch {}
}
loadEnv();

const TRUTHY = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());
const SKIP_AUDIT = TRUTHY(process.env.SKIP_AUDIT);
const DRY_RUN = TRUTHY(process.env.DRY_RUN) || process.argv.includes('--dry-run');
const AUDIT_CONCURRENCY = Math.max(1, parseInt(process.env.AUDIT_CONCURRENCY || '5', 10) || 5);
const HAS_KEY = !!String(process.env.DEEPSEEK_API_KEY || '').trim();
// CTW (C-test) tolerance: max ambiguous blanks allowed in a 10-blank item before reject.
// The real exam reveals only floor(len/2) letters + grades each blank by exact match, so a
// short/function word is inherently ambiguous — it ships those and absorbs them cumulatively,
// never discarding a passage for one. So tolerate a few; reject only pervasive ambiguity.
// AP/RDL are unaffected (any mis-keyed multiple-choice answer is always rejected).
const CTW_AMBIGUITY_LIMIT = Math.max(0, parseInt(process.env.CTW_AMBIGUITY_LIMIT ?? '2', 10) || 0);

// prefix → audit type. Only reading items are answer-audited; listening/speaking
// (lcr/la/lc/lat/repeat/interview) have no second-examiner auditor → null = skip.
function auditTypeFor(prefix) {
  if (prefix === 'ap') return 'ap';
  if (prefix === 'rdl') return 'rdl';
  if (prefix === 'ctw') return 'ctw';
  return null;
}

// Answer-audit a vetted batch and return only the items that pass. Logs each
// rejection and each fail-open (kept-despite-AI-error). No-ops when audit is
// disabled/skipped or the prefix isn't a reading type.
async function auditAndKeep(prefix, file, items) {
  const type = auditTypeFor(prefix);
  if (!type || items.length === 0 || SKIP_AUDIT) return items;
  if (!HAS_KEY) {
    console.log(`  ⚠ ${file}: DEEPSEEK_API_KEY not set — merged WITHOUT answer audit (set SKIP_AUDIT=1 to silence)`);
    return items;
  }
  let rejected = 0, errored = 0;
  const results = await auditItems(type, items, {
    concurrency: AUDIT_CONCURRENCY,
    ctwLimit: CTW_AMBIGUITY_LIMIT,
    onResult: (r) => {
      if (r.audit && r.audit.error) { errored++; console.log(`    ⚠ audit ${r.item.id || '?'}: ${r.reason} (kept — could not verify)`); }
      else if (!r.ok) { rejected++; console.log(`    ⊘ audit ${r.item.id || '?'}: ${r.reason}`); }
    },
  });
  const kept = results.filter((r) => r.ok).map((r) => r.item);
  if (rejected || errored) {
    console.log(`  ${file}: ${rejected}/${items.length} rejected by answer audit` + (errored ? `, ${errored} kept on audit error` : ''));
  }
  return kept;
}

// Vet one staging item for a prefix → { ok, item, reason }.
// CTW is special: it must be run through the mechanical blanker first (the staging
// item is just a passage), then validated. A validator THROW means the item is
// malformed enough to crash validation, so we REJECT it (see catch below) rather
// than ship an unvalidated item to the bank.
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
    // A validator throw means the item is malformed enough to crash validation — that is
    // per-item (well-formed items don't throw: verified across 8 types × hundreds of
    // adversarial inputs), so REJECT it rather than ship unvalidated garbage to the bank.
    return { ok: false, reason: 'validator threw: ' + e.message };
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

// NEWBANK_ROOT (optional): when set (e.g. NEWBANK_ROOT=data/newBank), validated+deduped
// output is written to the NEW bank under that root instead of the live bank — so a fresh
// bank can be staged for a one-shot replacement without ever touching production. Staging is
// still read from the normal data/<section>/staging dirs. Default (unset) = live bank.
const NEWBANK_ROOT = (process.env.NEWBANK_ROOT || "").trim()
  ? resolve(ROOT, (process.env.NEWBANK_ROOT || "").trim())
  : null;
if (NEWBANK_ROOT) {
  for (const section of SECTIONS) {
    // section.bankDir is join(ROOT, 'data/<x>/bank'); redirect the 'data' prefix to NEWBANK_ROOT.
    section.bankDir = section.bankDir.replace(join(ROOT, "data"), NEWBANK_ROOT);
  }
  console.log(`NEWBANK_ROOT set → writing banks to ${NEWBANK_ROOT} (live bank untouched)`);
}

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

const auditStatus = SKIP_AUDIT ? 'SKIPPED (SKIP_AUDIT=1)'
  : !HAS_KEY ? 'DISABLED — no DEEPSEEK_API_KEY'
  : `enabled (concurrency ${AUDIT_CONCURRENCY}, CTW tolerates ≤${CTW_AMBIGUITY_LIMIT} ambiguous blanks)`;
console.log(`Answer audit: ${auditStatus}${DRY_RUN ? '  |  DRY-RUN (no bank writes)' : ''}`);

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

    // Answer-correctness audit (the merge gate). Runs the same AI second-examiner
    // check the generators do, dropping mis-keyed/ambiguous items that vet() can't
    // catch. No-op for listening/speaking, or when SKIP_AUDIT=1 / no API key.
    const merged = await auditAndKeep(prefix, file, items);
    if (merged.length === 0) { console.log(`  ${file}: 0 items survived answer audit, skipping`); continue; }

    if (prefix === 'rdl') {
      // Special handling for RDL: classify into long/short
      const counts = {};
      for (const item of merged) {
        const bankFile = classifyRdlItem(item);
        pendingItems[bankFile] = (pendingItems[bankFile] || []).concat(item);
        counts[bankFile] = (counts[bankFile] || 0) + 1;
      }
      const parts = Object.entries(counts).map(([k, v]) => `${v}→${k}`).join(', ');
      console.log(`  ${file}: ${merged.length} merged (${parts})`);
    } else {
      const bankFile = section.prefixMap[prefix];
      pendingItems[bankFile] = (pendingItems[bankFile] || []).concat(merged);
      console.log(`  ${file}: ${merged.length} merged → ${bankFile}`);
    }
  }

  // Merge into banks
  for (const [bankFile, newItems] of Object.entries(pendingItems)) {
    if (!DRY_RUN) mkdirSync(section.bankDir, { recursive: true });
    const bankPath = join(section.bankDir, bankFile);
    let bank = existsSync(bankPath) ? readJSON(bankPath) : { version: 1, items: [] };
    // Normalize: a legacy bank stored as a bare array → wrap into { version, items }.
    // Must REASSIGN (not assign .items onto the Array): JSON.stringify drops non-index
    // properties of an array, so the old `Object.assign(bank, {})` no-op would have
    // silently dropped every newly-merged item on write.
    if (Array.isArray(bank)) {
      bank = { version: 1, items: bank };
    }
    if (!bank.items) bank.items = [];

    const existingIds = new Set(bank.items.map(i => i.id));
    const before = bank.items.length;

    let added = 0;
    let duplicates = 0;
    for (const item of newItems) {
      // Mint an id for id-less items. Generators sometimes omit `id` (it isn't a quality
      // signal), and without this EVERY id-less item collapses to a single "duplicate"
      // against `undefined`/`null` — silently destroying a batch's yield. CTW already gets
      // an id from the blanker; this covers AP/RDL/listening/speaking.
      if (item.id == null || item.id === "") {
        const stem = bankFile.replace(/\.json$/, "");
        item.id = `${stem}_${Date.now().toString(36)}_${added + duplicates}`;
      }
      if (existingIds.has(item.id)) {
        duplicates++;
        continue;
      }
      existingIds.add(item.id);
      bank.items.push(item);
      added++;
    }

    if (!DRY_RUN) writeJSON(bankPath, bank);
    allSummary.push({ section: section.name, bankFile, before, added, duplicates, after: bank.items.length });
    console.log(`  ${bankFile}: ${before} → ${bank.items.length} (+${added} new, ${duplicates} duplicates skipped)` + (DRY_RUN ? '  [DRY-RUN: not written]' : ''));
    grandTotal += added;
  }
}

console.log('\n--- Summary ---');
for (const s of allSummary) {
  console.log(`  ${s.bankFile}: ${s.before} → ${s.after}  (+${s.added})`);
}
console.log(`\nTotal items added: ${grandTotal}`);
