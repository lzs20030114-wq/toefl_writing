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
 * Usage: node scripts/backfill-tts.mjs [--limit N] [--only lat,lc,la,lcr,repeat,interview]
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { generateSpeech, generateConversation } = require('../lib/tts/edgeTts.js');
const { uploadAudio } = require('../lib/tts/storage.js');
// Persona render path — used ONLY in --tts-provider=openai mode, listening types only.
const { renderSingleSpeaker, renderConversation } = require('../lib/tts/renderListening.js');
const { encodeWavToMp3 } = require('../lib/tts/mp3Encode.js');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const LIMIT_RAW = (argv.find(a => a.startsWith('--limit=')) || '').split('=')[1];
const LIMIT = (LIMIT_RAW == null || LIMIT_RAW === '') ? Infinity : (parseInt(LIMIT_RAW, 10) || 0);
const ONLY = (argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
const ONLY_SET = ONLY ? new Set(ONLY.split(',')) : null;
// Provider switch: default edge (unchanged). openai = gpt-4o-mini-tts persona render → MP3,
// LISTENING types only; speaking always stays edge (see backfillRepeat/backfillInterview).
const PROVIDER = ((argv.find(a => a.startsWith('--tts-provider=')) || '').split('=')[1] || 'edge').trim();
const OPENAI = PROVIDER === 'openai';

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

async function backfillSingle(bankPath, textFn, prefix, preset, type) {
  if (!existsSync(resolve(ROOT, bankPath))) return;
  const b = load(bankPath); let done = 0, fail = 0, skip = 0;
  for (const it of (b.items || [])) {
    if (it.audio_url) { skip++; continue; }
    if (budget <= 0) break;
    const text = textFn(it);
    if (!text || !it.id) { fail++; continue; }
    try {
      let buf, storagePath;
      if (OPENAI) {
        // Persona render → MP3 at a NEW .p1.mp3 path (never overwrites the old edge file).
        const wav = await renderSingleSpeaker(it, type);
        buf = await encodeWavToMp3(wav);
        storagePath = `${prefix}/${it.id}.p1.mp3`;
      } else {
        buf = await generateSpeech(String(text), { preset, format: 'mp3' });
        storagePath = `${prefix}/${it.id}.mp3`;
      }
      const { url } = await uploadChecked(storagePath, buf);
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
      let buf, storagePath;
      if (OPENAI) {
        // Persona multi-voice render → MP3 at a NEW .p1.mp3 path.
        const wav = await renderConversation(it);
        buf = await encodeWavToMp3(wav);
        storagePath = `${prefix}/${it.id}.p1.mp3`;
      } else {
        const segments = turns.map(t => ({ text: t.text, preset: CONV_VOICE[t.speaker] || 'lcr_staff_female' }));
        buf = await generateConversation(segments, { format: 'mp3' });
        storagePath = `${prefix}/${it.id}.mp3`;
      }
      const { url } = await uploadChecked(storagePath, buf);
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

// Interview (Speaking Task 2): each set holds .questions; voice the interviewer's
// question with a steady professional voice. Mirrors backfillRepeat (per-question
// audio_url, keyed by question id) so the app plays a real MP3 instead of relying
// on the browser's Web Speech API, which is silent on much of mainland mobile.
async function backfillInterview(bankPath) {
  if (!existsSync(resolve(ROOT, bankPath))) return;
  const b = load(bankPath); let sets = 0, qs = 0, fail = 0;
  for (const set of (b.items || [])) {
    const qq = set.questions || [];
    if (!qq.length) continue;
    if (qq.every(q => q.audio_url)) continue;
    if (budget <= 0) break;
    let any = false;
    for (const q of qq) {
      if (q.audio_url || !q.question) continue;
      if (budget <= 0) break;
      try {
        const buf = await generateSpeech(q.question, { preset: 'lcr_staff_female', format: 'mp3' });
        const qid = q.id || `${set.id}_${qq.indexOf(q) + 1}`;
        const { url } = await uploadChecked(`speaking/interview/${qid}.mp3`, buf);
        q.audio_url = url; qs++; any = true; budget--;
      } catch (e) { if (e.fatal) throw e; fail++; console.log(`  ✗ ${set.id}: ${e.message.slice(0, 80)}`); }
    }
    if (any) sets++;
  }
  save(bankPath, b);
  console.log(`interview.json: +${qs} question-audio across ${sets} sets (${fail} failed)`);
}

const want = (k) => !ONLY_SET || ONLY_SET.has(k);

(async () => {
  console.log(`TTS backfill (${PROVIDER}) — limit ${LIMIT === Infinity ? '∞' : LIMIT}${ONLY ? ', only ' + ONLY : ''}\n`);

  // Preflight: openai mode MUST have a key. Never silently fall back to edge — that would
  // let the upgrade quietly no-op and re-write edge audio while claiming to be persona.
  if (OPENAI && !process.env.OPENAI_API_KEY) {
    console.error(
      '✗ --tts-provider=openai requires OPENAI_API_KEY. Refusing to fall back to edge-tts\n' +
      '  (a silent fallback would make the persona upgrade a no-op). Set OPENAI_API_KEY and retry.'
    );
    process.exit(1);
  }

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
    if (want('lat')) await backfillSingle('data/listening/bank/lat.json', it => it.transcript || it.lecture, 'lecture', 'lecture_male', 'lat');
    if (want('la')) await backfillSingle('data/listening/bank/la.json', it => it.announcement || it.transcript, 'announcement', 'lecture_female', 'la');
    if (want('lcr')) await backfillSingle('data/listening/bank/lcr.json', it => it.speaker || it.prompt, 'choose-response', 'lcr_staff_male', 'lcr');
    if (want('lc')) await backfillConversation('data/listening/bank/lc.json', 'conversation');
    // Speaking ALWAYS stays on edge — this persona upgrade excludes口语 (repeat/interview).
    if (want('repeat')) await backfillRepeat('data/speaking/bank/repeat.json');
    if (want('interview')) await backfillInterview('data/speaking/bank/interview.json');
  } catch (e) {
    if (e.fatal) { console.error(`\n✗ Aborting: ${e.message}`); process.exit(1); }
    throw e;
  }
  console.log('\nbackfill done.');
})();
