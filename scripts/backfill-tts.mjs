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
const LIMIT = parseInt((argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10) || Infinity;
const ONLY = (argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
const ONLY_SET = ONLY ? new Set(ONLY.split(',')) : null;

const CONV_VOICE = { Woman: 'lcr_staff_female', Man: 'lcr_staff_male' };
let budget = LIMIT;

function load(p) { return JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')); }
function save(p, d) { writeFileSync(resolve(ROOT, p), JSON.stringify(d, null, 2) + '\n'); }

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
      const { url } = await uploadAudio(`${prefix}/${it.id}.mp3`, buf);
      it.audio_url = url; done++; budget--;
    } catch (e) { fail++; console.log(`  ✗ ${it.id}: ${e.message.slice(0, 80)}`); }
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
      const { url } = await uploadAudio(`${prefix}/${it.id}.mp3`, buf);
      it.audio_url = url; done++; budget--;
    } catch (e) { fail++; console.log(`  ✗ ${it.id}: ${e.message.slice(0, 80)}`); }
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
      try {
        const buf = await generateSpeech(s.sentence, { preset: VMAP[s.difficulty] || 'lcr_staff_male', format: 'mp3' });
        const sid = s.id || `${set.id}_s${ss.indexOf(s) + 1}`;
        const { url } = await uploadAudio(`speaking/repeat/${sid}.mp3`, buf);
        s.audio_url = url; sents++; any = true;
      } catch (e) { fail++; console.log(`  ✗ ${set.id}: ${e.message.slice(0, 80)}`); }
    }
    if (any) sets++;
  }
  save(bankPath, b);
  console.log(`repeat.json: +${sents} sentence-audio across ${sets} sets (${fail} failed)`);
}

const want = (k) => !ONLY_SET || ONLY_SET.has(k);

(async () => {
  console.log(`TTS backfill (edge-tts) — limit ${LIMIT === Infinity ? '∞' : LIMIT}${ONLY ? ', only ' + ONLY : ''}\n`);
  if (want('lat')) await backfillSingle('data/listening/bank/lat.json', it => it.transcript || it.lecture, 'lecture', 'lecture_male');
  if (want('la')) await backfillSingle('data/listening/bank/la.json', it => it.announcement || it.transcript, 'announcement', 'lecture_female');
  if (want('lcr')) await backfillSingle('data/listening/bank/lcr.json', it => it.speaker || it.prompt, 'choose-response', 'lcr_staff_male');
  if (want('lc')) await backfillConversation('data/listening/bank/lc.json', 'conversation');
  if (want('repeat')) await backfillRepeat('data/speaking/bank/repeat.json');
  console.log('\nbackfill done.');
})();
