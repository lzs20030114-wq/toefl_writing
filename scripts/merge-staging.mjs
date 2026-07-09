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
// 合库层通用内容去重（id 去重之外再拦「同/近内容不同 id」）。CJS 默认导入再解构。
import contentDedup from '../lib/gen/contentDedup.js';
const { createDedupIndex, checkDuplicate, addToIndex } = contentDedup;

// bankFile → contentDedup 题型名（extractText 用）：rdl-long/rdl-short 归一为 rdl，其余取文件名主干。
function dedupTypeForBankFile(bankFile) {
  const stem = String(bankFile).replace(/\.json$/, '');
  return stem.startsWith('rdl') ? 'rdl' : stem;
}

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
  // 2026-07-09: interview wired into the automated pipeline (was the last unmapped type).
  interview: (it) => require('../lib/speakingGen/speakingValidator.js').validateInterviewSet(it),
  intv:      (it) => require('../lib/speakingGen/speakingValidator.js').validateInterviewSet(it),
};

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
    if (!fn) {
      // FAIL-CLOSED: a prefix with no validator mapping used to pass straight through
      // UNVETTED — the same "admin bypass" class of hole as the deploy button: content
      // shipped to the live bank with zero structural checks. Reject instead so any
      // FUTURE unmapped type can never merge silently (every current type is mapped
      // as of 2026-07-09, interview being the last). See QUESTION-PIPELINE-REVIEW §7 P0-4/P1-11.
      return { ok: false, reason: `no validator mapped for prefix "${prefix}" — fail-closed (未接入自动化校验)` };
    }
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

// ── Answer-correctness audit (READING MCQ only), fail-closed ─────────────────
// 2026-06-17: re-audit reading items at merge with an independent AI "second examiner"
// (answerAuditor) so a mis-keyed / guessable item that reached staging is caught BEFORE
// it ships — not just at generation time. FAIL-CLOSED:
//   - critical answer mismatch → REJECT (drop, never merged)
//   - transient audit error    → HOLD (not merged this run; the staging file persists, so
//                                it is re-audited on the next run)
// SKIPPED (NOT fail-closed) when the audit infra is unavailable — no DEEPSEEK_API_KEY, or
// SKIP_AUDIT=1 — because failing closed on infra-absence would block ALL reading merges.
// Only reading (ap/rdl/ctw) is wired: the listening auditors exist but have never run in
// the pipeline and use a different interface, so they are intentionally not enabled yet.
const AUDITABLE = new Set(['ap', 'rdl', 'ctw']);
let auditDisabled = String(process.env.SKIP_AUDIT || '').trim() === '1';
async function auditReadingItems(prefix, items) {
  if (auditDisabled || !AUDITABLE.has(prefix) || items.length === 0) return items;
  const { auditRDLItem, auditCTWItem } = require('../lib/readingGen/answerAuditor.js');
  const kept = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let audit;
    try {
      audit = prefix === 'ctw'
        ? await auditCTWItem(item)
        : await auditRDLItem(prefix === 'ap' ? { ...item, text: item.passage } : item); // AP reuses the RDL auditor (maps passage→text)
    } catch (e) {
      audit = { error: String((e && e.message) || e) };
    }
    if (audit.error) {
      if (/api[_ ]?key|not set|deepseek_api_key/i.test(audit.error)) {
        console.log(`  ⓘ answer-audit skipped — DEEPSEEK_API_KEY unavailable; merging ${prefix} on structural validation only.`);
        auditDisabled = true;
        return kept.concat(items.slice(i)); // keep already-passed + current + remaining, unaudited
      }
      console.log(`    ⏸ ${item.id || '?'}: audit error — held for retry (${audit.error})`);
      continue; // fail-closed: transient error → don't merge this run
    }
    if ((audit.criticalFlags || 0) > 0) {
      console.log(`    ✗ ${item.id || '?'}: ${audit.criticalFlags} critical answer mismatch(es) — rejected`);
      continue; // fail-closed: drop the mis-keyed item
    }
    kept.push(item);
  }
  return kept;
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

    // Answer-correctness audit (reading MCQ only), fail-closed — see auditReadingItems.
    const audited = await auditReadingItems(prefix, items);
    const heldOrRejected = items.length - audited.length;
    if (heldOrRejected > 0) console.log(`  ${file}: ${heldOrRejected} item(s) held/rejected by answer-audit (fail-closed)`);
    if (audited.length === 0) { console.log(`  ${file}: 0 items after answer-audit, skipping`); continue; }

    if (prefix === 'rdl') {
      // Special handling for RDL: classify into long/short
      const counts = {};
      for (const item of audited) {
        const bankFile = classifyRdlItem(item);
        pendingItems[bankFile] = (pendingItems[bankFile] || []).concat(item);
        counts[bankFile] = (counts[bankFile] || 0) + 1;
      }
      const parts = Object.entries(counts).map(([k, v]) => `${v}→${k}`).join(', ');
      console.log(`  ${file}: ${audited.length} merged (${parts})`);
    } else {
      const bankFile = section.prefixMap[prefix];
      pendingItems[bankFile] = (pendingItems[bankFile] || []).concat(audited);
      console.log(`  ${file}: ${audited.length} merged → ${bankFile}`);
    }
  }

  // Merge into banks
  for (const [bankFile, newItems] of Object.entries(pendingItems)) {
    mkdirSync(section.bankDir, { recursive: true });
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

    // Content-dedup index seeded from the live bank. id-dedup alone let identical content
    // ship twice (different minted ids); this catches same/near content regardless of id,
    // AND — because we addToIndex each accepted item below — dedups within this batch too.
    const dedupType = dedupTypeForBankFile(bankFile);
    const dedupIndex = createDedupIndex(bank.items, dedupType);

    let added = 0;
    let duplicates = 0;
    let contentDup = 0;
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
      // Content-level dedup (exact fingerprint O(1), then near jaccard). id-novel items
      // that duplicate existing/earlier content are skipped here.
      const dup = checkDuplicate(dedupIndex, item, dedupType);
      if (dup.dup) {
        contentDup++;
        console.log(`    skip content-dup ${item.id} ~= ${dup.matchId} (${dup.reason})`);
        continue;
      }
      existingIds.add(item.id);
      addToIndex(dedupIndex, item, dedupType);
      bank.items.push(item);
      added++;
    }

    writeJSON(bankPath, bank);
    allSummary.push({ section: section.name, bankFile, before, added, duplicates, contentDup, after: bank.items.length });
    console.log(`  ${bankFile}: ${before} → ${bank.items.length} (+${added} new, ${duplicates} id-dup, ${contentDup} content-dup skipped)`);
    grandTotal += added;
  }
}

console.log('\n--- Summary ---');
let grandContentDup = 0;
for (const s of allSummary) {
  grandContentDup += s.contentDup || 0;
  const cd = s.contentDup ? `, ${s.contentDup} content-dup` : '';
  console.log(`  ${s.bankFile}: ${s.before} → ${s.after}  (+${s.added}${cd})`);
}
console.log(`\nTotal items added: ${grandTotal}  (content-dups skipped: ${grandContentDup})`);
