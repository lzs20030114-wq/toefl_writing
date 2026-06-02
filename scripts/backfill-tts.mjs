#!/usr/bin/env node
/**
 * backfill-tts.mjs — generate audio for listening/speaking bank items that lack it.
 *
 * The Claude routine (R1) generates listening/speaking TEXT only; the audio route serves
 * pre-generated files, so text-only items 404 and break in the app. This script is the
 * missing production step: it scans the banks, synthesizes audio (edge-tts, free) for any
 * item without audio_url, writes the .mp3, and sets audio_url. Idempotent — items that
 * already have audio_url are skipped, so it can run after every routine / on a cron.
 *
 * Usage: node scripts/backfill-tts.mjs [--limit N] [--only lat,lc,la,lcr,repeat]
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { generateSpeech, generateConversation } = require('../lib/tts/edgeTts.js');
const { uploadAudio } = require('../lib/tts/storage.js');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const LIMIT_RAW = (argv.find(a => a.startsWith('--limit=')) || '').split('=')[1];
const LIMIT = (LIMIT_RAW == null || LIMIT_RAW === '') ? Infinity : (parseInt(LIMIT_RAW, 10) || 0);
const ONLY = (argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
const ONLY_SET = ONLY ? new Set(ONLY.split(',')) : null;

const CONV_VOICE = { Woman: 'lcr_staff_female', Man: 'lcr_staff_male' };
let budget = LIMIT;

function load(p) { return JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')); }
function save(p, d) { writeFileSync(resolve(ROOT, p), JSON.stringify(d, null, 2) + '\n'); }

const ALLOW_LOCAL = process.env.TTS_ALLOW_LOCAL === '1';

// Guard against silently persisting a local-fallback URL into a committed bank.
// lib/tts/storage.js#uploadAudio returns { local:true, url:"/listening-audio/..." }
// when Supabase isn't configured; those .mp3s are .gitignored, never committed, and
// 404 in production. Treat that as a FATAL error so a missing-creds run can never
// write a broken audio_url — fail the whole job instead.
async function uploadChecked(storagePath, buffer) {
  const res = await uploadAudio(storagePath, buffer);
  if (!ALLOW_LOCAL && (res.local === true || String(res.url || '').startsWith('/'))) {
    const err = new Error(
      `local-fallback audio URL ("${res.url}") — Supabase upload did not run. Set ` +
      `NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or TTS_ALLOW_LOCAL=1 to override).`
    );
    err.fatal = true;
    throw err;
  }
  return res;
}

async function backfillSingle(bankPath, textFn, prefix, preset) {
  if (!existsSync(resolve(ROOT, bankPath))) return;
  const b = load(bankPath); let done = 0, fail = 0, skip = 0;
  for (const it of (b.items || [])) {
    if (it.audio_url) { skip++; continue; }
    if (budget <= 0) break;
    const text = textFn(it);
    if (!text || !it.id) { fail++; continue; }
    try {
      const buf = await generateSpeech(String(text), { preset, format: 'mp3' });
      const { url } = await uploadChecked(`${prefix}/${it.id}.mp3`, buf);
      it.audio_url = url; done++; budget--;
    } catch (e) { if (e.fatal) throw e; fail++; console.log(`  ✗ ${it.id}: ${e.message.slice(0, 80)}`); }
  }
  save(bankPath, b);
  console.log(`${bankPath.split('/').pop()}: +${done} audio (${skip} already had, ${fail} failed)`);
}

async function backfillConversation(bankPath, prefix) {
  if (!existsSync(resolve(ROOT, bankPath))) return;
  const b = load(bankPath); let done = 0, fail = 0, skip = 0;
  for (const it of (b.items || [])) {
    if (it.audio_url) { skip++; continue; }
    if (budget <= 0) break;
    const turns = it.conversation || it.turns || [];
    if (!turns.length || !it.id) { fail++; continue; }
    try {
      const segments = turns.map(t => ({ text: t.text, preset: CONV_VOICE[t.speaker] || 'lcr_staff_female' }));
      const buf = await generateConversation(segments, { format: 'mp3' });
      const { url } = await uploadChecked(`${prefix}/${it.id}.mp3`, buf);
      it.audio_url = url; done++; budget--;
    } catch (e) { if (e.fatal) throw e; fail++; console.log(`  ✗ ${it.id}: ${e.message.slice(0, 80)}`); }
  }
  save(bankPath, b);
  console.log(`${bankPath.split('/').pop()}: +${done} audio (${skip} already had, ${fail} failed)`);
}

async function backfillRepeat(bankPath) {
  if (!existsSync(resolve(ROOT, bankPath))) return;
  const b = load(bankPath); let sets = 0, sents = 0, fail = 0;
  const VMAP = { easy: 'lcr_staff_female', medium: 'lcr_staff_male', hard: 'lcr_campus_female' };
  for (const set of (b.items || [])) {
    const ss = set.sentences || [];
    if (!ss.length) continue;
    if (ss.every(s => s.audio_url)) continue;
    if (budget <= 0) break;
    let any = false;
    for (const s of ss) {
      if (s.audio_url || !s.sentence) continue;
      if (budget <= 0) break;
      try {
        const buf = await generateSpeech(s.sentence, { preset: VMAP[s.difficulty] || 'lcr_staff_male', format: 'mp3' });
        const sid = s.id || `${set.id}_s${ss.indexOf(s) + 1}`;
        const { url } = await uploadChecked(`speaking/repeat/${sid}.mp3`, buf);
        s.audio_url = url; sents++; any = true; budget--;
      } catch (e) { if (e.fatal) throw e; fail++; console.log(`  ✗ ${set.id}: ${e.message.slice(0, 80)}`); }
    }
    if (any) sets++;
  }
  save(bankPath, b);
  console.log(`repeat.json: +${sents} sentence-audio across ${sets} sets (${fail} failed)`);
}

const want = (k) => !ONLY_SET || ONLY_SET.has(k);

(async () => {
  console.log(`TTS backfill (edge-tts) — limit ${LIMIT === Infinity ? '∞' : LIMIT}${ONLY ? ', only ' + ONLY : ''}\n`);

  // Preflight: without Supabase creds every upload falls back to a local path that
  // 404s in production and is never committed. Fail fast with an actionable message
  // instead of spending minutes on TTS only to write broken URLs into the bank.
  if (!ALLOW_LOCAL && !(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    console.error(
      '✗ Supabase credentials missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n' +
      '  uploadAudio() would fall back to local /listening-audio/* paths that are .gitignored,\n' +
      '  never committed, and 404 in production. Refusing to write broken audio_urls into the bank.\n' +
      '  → CI: add them as repo secrets and inject them into the workflow step.\n' +
      '  → Intentional local run: set TTS_ALLOW_LOCAL=1.'
    );
    process.exit(1);
  }

  try {
    if (want('lat')) await backfillSingle('data/listening/bank/lat.json', it => it.transcript || it.lecture, 'lecture', 'lecture_male');
    if (want('la')) await backfillSingle('data/listening/bank/la.json', it => it.announcement || it.transcript, 'announcement', 'lecture_female');
    if (want('lcr')) await backfillSingle('data/listening/bank/lcr.json', it => it.speaker || it.prompt, 'choose-response', 'lcr_staff_male');
    if (want('lc')) await backfillConversation('data/listening/bank/lc.json', 'conversation');
    if (want('repeat')) await backfillRepeat('data/speaking/bank/repeat.json');
  } catch (e) {
    if (e.fatal) { console.error(`\n✗ Aborting: ${e.message}`); process.exit(1); }
    throw e;
  }
  console.log('\nbackfill done.');
})();
