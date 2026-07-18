#!/usr/bin/env node
/**
 * rerender-listening-audio.mjs — FULL re-render of the listening bank to the
 * gpt-4o-mini-tts persona voice, MP3-encoded, at NEW `.p1.mp3` storage paths.
 *
 * Unlike backfill-tts.mjs (fills only MISSING audio), this REPLACES every item's audio
 * with the persona render, rewrites each item's audio_url to the new `.p1.mp3` path, and
 * checkpoints the bank JSON to disk every 10 items so an interrupted run resumes cleanly.
 *
 * Idempotent / resumable: an item whose audio_url already ends with `.p1.mp3` is skipped,
 * so re-running the script picks up where it left off (and re-runs cost nothing for
 * already-migrated items).
 *
 * Usage:
 *   node scripts/rerender-listening-audio.mjs [--only=lat,lc,la,lcr] [--limit=N] [--dry-run]
 *
 * ⚠ COSTS REAL MONEY (OpenAI TTS). NOT run by CI or this task's author — the main thread
 * runs it manually and watches the per-10-item progress lines.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { loadEnv } from './ops/_shared.mjs';

const require = createRequire(import.meta.url);
const { renderSingleSpeaker, renderConversation } = require('../lib/tts/renderListening.js');
const { encodeWavToMp3 } = require('../lib/tts/mp3Encode.js');
const { uploadAudio } = require('../lib/tts/storage.js');
const { estimateCost } = require('../lib/tts/openaiTts.js');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(); // pulls OPENAI_API_KEY / Supabase creds from .env.local

// ── CLI args ──
const argv = process.argv.slice(2);
function flag(name) {
  const withEq = argv.find(a => a.startsWith(`--${name}=`));
  if (withEq) return withEq.split('=')[1];
  return argv.includes(`--${name}`) ? true : undefined;
}
const ONLY = flag('only');
const ONLY_SET = ONLY && ONLY !== true ? new Set(String(ONLY).split(',')) : null;
const LIMIT_RAW = flag('limit');
const LIMIT = (LIMIT_RAW == null || LIMIT_RAW === true) ? Infinity : (parseInt(LIMIT_RAW, 10) || 0);
const DRY = argv.includes('--dry-run');

const CONCURRENCY = 2;
const CHECKPOINT_EVERY = 10;
const ALLOW_LOCAL = process.env.TTS_ALLOW_LOCAL === '1';

const BANKS = [
  { type: 'lat', path: 'data/listening/bank/lat.json', prefix: 'lecture',         textOf: it => it.transcript || it.lecture },
  { type: 'la',  path: 'data/listening/bank/la.json',  prefix: 'announcement',    textOf: it => it.announcement || it.transcript },
  { type: 'lcr', path: 'data/listening/bank/lcr.json', prefix: 'choose-response', textOf: it => it.speaker || it.prompt },
  { type: 'lc',  path: 'data/listening/bank/lc.json',  prefix: 'conversation',    textOf: it => (it.conversation || []).map(t => t.text).join(' ') },
];

function load(p) { return JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')); }
function save(p, d) { writeFileSync(resolve(ROOT, p), JSON.stringify(d, null, 2) + '\n'); }
const isRendered = (u) => typeof u === 'string' && u.endsWith('.p1.mp3');

// Same safety valve as backfill-tts.mjs: a local-fallback URL means Supabase wasn't
// configured — abort rather than write a .gitignored path that 404s in production.
async function uploadChecked(storagePath, buffer) {
  const res = await uploadAudio(storagePath, buffer, 'audio/mpeg');
  if (!ALLOW_LOCAL && (res.local === true || String(res.url || '').startsWith('/'))) {
    console.error(`\n✗ local-fallback URL ("${res.url}") — Supabase not configured. Aborting (TTS_ALLOW_LOCAL=1 to override).`);
    process.exit(1);
  }
  return res;
}

async function renderItem(bank, it) {
  const wav = bank.type === 'lc' ? await renderConversation(it) : await renderSingleSpeaker(it, bank.type);
  const mp3 = await encodeWavToMp3(wav);
  const { url } = await uploadChecked(`${bank.prefix}/${it.id}.p1.mp3`, mp3);
  return url;
}

// Exponential backoff on 429 / 5xx / transient socket errors.
async function withBackoff(fn, label) {
  // "fetch failed" is undici's generic network TypeError — seen on flaky direct
  // supabase.co uploads from mainland networks; always worth retrying.
  const RETRYABLE = /\b429\b|\b50\d\b|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket|rate.?limit|fetch failed/i;
  let delay = 2000;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === 4 || !RETRYABLE.test(String(e && e.message))) throw e;
      console.log(`   ↻ ${label} retry ${attempt + 1} after ${delay}ms (${String(e.message).slice(0, 60)})`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

(async () => {
  if (!DRY && !process.env.OPENAI_API_KEY) {
    console.error('✗ OPENAI_API_KEY not set (needed for the persona render). Set it in .env.local or the environment.');
    process.exit(1);
  }
  if (!DRY && !ALLOW_LOCAL && !(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    console.error('✗ Supabase creds missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Refusing to write local-fallback URLs. (TTS_ALLOW_LOCAL=1 to override.)');
    process.exit(1);
  }

  const started = Date.now();
  let totalRendered = 0, totalCostEst = 0;

  for (const bank of BANKS) {
    if (ONLY_SET && !ONLY_SET.has(bank.type)) continue;
    if (!existsSync(resolve(ROOT, bank.path))) { console.log(`skip ${bank.type}: no bank file`); continue; }

    const data = load(bank.path);
    const items = data.items || [];
    const pending = items.filter(it => it.id && !isRendered(it.audio_url) && bank.textOf(it));
    const willDo = Number.isFinite(LIMIT) ? pending.slice(0, LIMIT) : pending;

    let costEst = 0;
    for (const it of willDo) costEst += estimateCost(String(bank.textOf(it) || '')).estimatedCost;
    totalCostEst += costEst;
    console.log(`\n[${bank.type}] ${willDo.length}/${items.length} to render (${items.length - pending.length} already .p1.mp3, est ~$${costEst.toFixed(3)})`);

    if (DRY) continue;

    // Simple promise pool (concurrency=2). JS is single-threaded so `idx++` is race-free.
    let idx = 0, completedSinceSave = 0, doneCount = 0;
    async function worker() {
      while (true) {
        const my = idx++;
        if (my >= willDo.length) return;
        const it = willDo[my];
        try {
          const url = await withBackoff(() => renderItem(bank, it), `${bank.type} ${it.id}`);
          it.audio_url = url;
          totalRendered++; doneCount++;
        } catch (e) {
          console.log(`   ✗ ${it.id}: ${String(e.message).slice(0, 80)}`);
        }
        completedSinceSave++;
        if (completedSinceSave >= CHECKPOINT_EVERY) {
          save(bank.path, data); // checkpoint: persists every audio_url assigned so far
          completedSinceSave = 0;
          const secs = Math.round((Date.now() - started) / 1000);
          console.log(`   … [${bank.type}] ${doneCount}/${willDo.length} done — checkpoint saved (${secs}s elapsed)`);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    save(bank.path, data);
    console.log(`[${bank.type}] complete: ${doneCount} rendered, bank saved.`);
  }

  if (DRY) {
    console.log(`\nDRY RUN — nothing rendered/uploaded. Total to do est ~$${totalCostEst.toFixed(2)}.`);
    return;
  }
  console.log(`\nAll done: ${totalRendered} items rendered in ${Math.round((Date.now() - started) / 1000)}s.`);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
