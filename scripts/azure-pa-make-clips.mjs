#!/usr/bin/env node
/**
 * azure-pa-make-clips.mjs — generate test audio for the Azure Pronunciation
 * Assessment spike (see scripts/azure-pa-spike.mjs + scripts/azure-pa-spike.README.md).
 *
 * WHAT IT DOES
 *   Takes 5 official "Listen and Repeat" example sentences from
 *   data/speakingScoring/officialSamples.json and, for each, synthesizes 4
 *   variants with the project's own edge-tts basis (lib/tts/edgeTts.js):
 *     A = clean read of the original sentence            → expect high scores, no errors
 *     B = 1–2 function words omitted                     → expect Omission detection
 *     C = 1 content word swapped                         → expect miscue / Mispronunciation
 *     D = slowed (-35%) + 1 inserted word                → expect Insertion + slow prosody
 *   For every variant the *reference text* handed to Azure is the ORIGINAL
 *   sentence; only the *spoken* audio is mutated. That is how Azure's
 *   miscue/omission/insertion machinery gets exercised.
 *
 *   Plus one UNSCRIPTED clip (~25s, referenceText left EMPTY) to record what
 *   Azure returns with no reference — one of the three open questions.
 *
 * OUTPUT FORMATS
 *   - WAV 16 kHz / 16-bit / mono PCM  → the Azure-native "safe" format (all clips).
 *   - webm/opus copy of each sentence's A-variant → this is exactly what the
 *     browser's MediaRecorder produces in the real app, kept so the real Azure
 *     run can test whether the compressed browser format is accepted directly.
 *
 * WHY THE DECODE STEP
 *   The free Edge "Read Aloud" endpoint that edge-tts rides only returns audio
 *   for mp3 and webm/opus here — riff/raw/ogg formats come back empty (verified
 *   2026-07-16). So we synth mp3, decode it to PCM with the small pure-WASM
 *   mpg123-decoder, resample 24k→16k, and write a canonical WAV ourselves.
 *
 * PREREQUISITE (one-time, not saved to package.json — clips are gitignored):
 *   npm install --no-save mpg123-decoder
 *
 * RUN:
 *   node scripts/azure-pa-make-clips.mjs
 *
 * LIMITATION (state this to anyone reading the results): TTS speech is
 * NATIVE-accent. These clips validate pipeline connectivity + omission/swap/
 * insertion detection ONLY. They do NOT validate how Azure scores real L2
 * (non-native) pronunciation — that needs real learner recordings.
 */

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const { generateSpeech } = require(path.join(ROOT, "lib/tts/edgeTts.js"));
const { buildWav } = require(path.join(ROOT, "lib/tts/wavTools.js"));

// mpg123-decoder is optional-at-install; fail loudly with a fix hint.
let MPEGDecoder;
try {
  ({ MPEGDecoder } = await import("mpg123-decoder"));
} catch {
  console.error(
    "\n[make-clips] Missing decoder dependency 'mpg123-decoder'.\n" +
      "The free Edge TTS endpoint only emits mp3/webm here, so we decode mp3 → PCM → WAV.\n" +
      "Install it (not saved to package.json, clips are gitignored):\n\n" +
      "    npm install --no-save mpg123-decoder\n"
  );
  process.exit(1);
}

const OUT_DIR = path.join(ROOT, "data/claudeGen/spike-audio");
const VOICE = "en-US-AriaNeural";
const TARGET_SR = 16000;

// ── The 5 sentences + explicit, reviewable per-variant transforms ──
// spoken = what the TTS says; reference = original (what Azure compares against).
const SENTENCES = [
  {
    key: "s1",
    lengthTag: "short",
    reference: "Fill out the form to request your transcript.",
    variants: {
      A: { spoken: "Fill out the form to request your transcript.", rate: "+0%", expected: "clean read — high AccuracyScore, all ErrorType=None" },
      B: { spoken: "Fill out form to request transcript.", rate: "+0%", expected: "omitted function words 'the','your' → ErrorType=Omission on those" },
      C: { spoken: "Fill out the form to request your document.", rate: "+0%", expected: "content swap transcript→document → miscue (Omission 'transcript' + Insertion 'document')" },
      D: { spoken: "Fill out the form to please request your transcript.", rate: "-35%", expected: "inserted 'please' → Insertion; slow read → low/'-' ProsodyScore" },
    },
  },
  {
    key: "s2",
    lengthTag: "medium",
    reference: "Ensure your name on the form matches the records before submitting.",
    variants: {
      A: { spoken: "Ensure your name on the form matches the records before submitting.", rate: "+0%", expected: "clean read — high scores" },
      B: { spoken: "Ensure name on form matches the records before submitting.", rate: "+0%", expected: "omitted 'your','the' → Omission" },
      C: { spoken: "Ensure your name on the form matches the grades before submitting.", rate: "+0%", expected: "content swap records→grades → miscue" },
      D: { spoken: "Ensure your name on the form carefully matches the records before submitting.", rate: "-35%", expected: "inserted 'carefully' → Insertion; slow prosody" },
    },
  },
  {
    key: "s3",
    lengthTag: "medium",
    reference: "We will stamp your transcript with our seal before mailing it.",
    variants: {
      A: { spoken: "We will stamp your transcript with our seal before mailing it.", rate: "+0%", expected: "clean read — high scores" },
      B: { spoken: "We will stamp your transcript with seal before mailing.", rate: "+0%", expected: "omitted 'our','it' → Omission" },
      C: { spoken: "We will stamp your transcript with our logo before mailing it.", rate: "+0%", expected: "content swap seal→logo → miscue" },
      D: { spoken: "We will stamp your official transcript with our seal before mailing it.", rate: "-35%", expected: "inserted 'official' → Insertion; slow prosody" },
    },
  },
  {
    key: "s4",
    lengthTag: "long",
    reference: "If you need an unofficial transcript, which you can keep for your own records, check this box.",
    variants: {
      A: { spoken: "If you need an unofficial transcript, which you can keep for your own records, check this box.", rate: "+0%", expected: "clean read — high scores" },
      B: { spoken: "If you need unofficial transcript, which you can keep for your own records, check box.", rate: "+0%", expected: "omitted 'an','this' → Omission" },
      C: { spoken: "If you need an unofficial transcript, which you can keep for your own records, check this option.", rate: "+0%", expected: "content swap box→option → miscue" },
      D: { spoken: "If you need an unofficial transcript, which you can keep for your own records, simply check this box.", rate: "-35%", expected: "inserted 'simply' → Insertion; slow prosody" },
    },
  },
  {
    key: "s5",
    lengthTag: "long",
    reference: "Email the registrar's office to resolve issues, such as missing courses, right away.",
    variants: {
      A: { spoken: "Email the registrar's office to resolve issues, such as missing courses, right away.", rate: "+0%", expected: "clean read — high scores" },
      B: { spoken: "Email registrar's office resolve issues, such as missing courses, right away.", rate: "+0%", expected: "omitted 'the','to' → Omission" },
      C: { spoken: "Email the registrar's office to resolve issues, such as missing classes, right away.", rate: "+0%", expected: "content swap courses→classes → miscue" },
      D: { spoken: "Please email the registrar's office to resolve issues, such as missing courses, right away.", rate: "-35%", expected: "inserted 'Please' → Insertion; slow prosody" },
    },
  },
];

// ~25s unscripted excerpt (from an official interview sample response, trimmed to fit
// the <=30s short-audio endpoint). ReferenceText is intentionally empty.
const UNSCRIPTED_TEXT =
  "Um, I think it depends on the situation, but most of the time, I take my time to think before I decide. " +
  "If it's something small, I might just choose quickly, but for bigger things, I need to consider more options. " +
  "For example, when I have to choose a history course, I ask my classmates before I choose.";

// ── audio helpers ──
function decodeMp3ToMonoPcm(mp3Buf, decoder) {
  const { channelData, samplesDecoded, sampleRate } = decoder.decode(new Uint8Array(mp3Buf));
  const ch = channelData.length;
  const out = new Float32Array(samplesDecoded);
  if (ch <= 1) {
    out.set(channelData[0].subarray(0, samplesDecoded));
  } else {
    for (let i = 0; i < samplesDecoded; i++) {
      let s = 0;
      for (let c = 0; c < ch; c++) s += channelData[c][i];
      out[i] = s / ch;
    }
  }
  return { pcm: out, sampleRate };
}

function resampleLinear(pcm, srIn, srOut) {
  if (srIn === srOut) return pcm;
  const ratio = srIn / srOut;
  const outLen = Math.floor(pcm.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, pcm.length - 1);
    const frac = pos - i0;
    out[i] = pcm[i0] * (1 - frac) + pcm[i1] * frac;
  }
  return out;
}

function floatToInt16(pcm) {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let s = Math.max(-1, Math.min(1, pcm[i]));
    out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return out;
}

// text → 16k mono WAV buffer (via mp3 → decode → resample). Returns { wav, durSec }.
async function synthWav(text, rate) {
  const mp3 = await generateSpeech(text, { voice: VOICE, rate, format: "mp3" });
  const decoder = new MPEGDecoder();
  await decoder.ready;
  let wav, durSec;
  try {
    const { pcm, sampleRate } = decodeMp3ToMonoPcm(mp3, decoder);
    const pcm16k = resampleLinear(pcm, sampleRate, TARGET_SR);
    const i16 = floatToInt16(pcm16k);
    wav = buildWav(i16, TARGET_SR, 1);
    durSec = i16.length / TARGET_SR;
  } finally {
    decoder.free();
  }
  return { wav, durSec };
}

async function synthWebm(text, rate) {
  return generateSpeech(text, { voice: VOICE, rate, format: "webm" });
}

// ── main ──
fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest = [];
const rows = [];

console.log(`[make-clips] output → ${OUT_DIR}`);
console.log(`[make-clips] voice=${VOICE}  target=WAV ${TARGET_SR}Hz/16-bit/mono\n`);

for (const s of SENTENCES) {
  for (const v of ["A", "B", "C", "D"]) {
    const { spoken, rate, expected } = s.variants[v];
    const id = `${s.key}-${v}`;
    const { wav, durSec } = await synthWav(spoken, rate);
    const fname = `${id}.wav`;
    fs.writeFileSync(path.join(OUT_DIR, fname), wav);
    manifest.push({
      id,
      audio: fname,
      contentFormat: "wav",
      sampleRate: TARGET_SR,
      variant: v,
      lengthTag: s.lengthTag,
      rate,
      referenceText: s.reference,
      spokenText: spoken,
      expected,
    });
    rows.push({ id, fmt: "wav", durSec, bytes: wav.length });
    console.log(`  ${id.padEnd(6)} wav  ${durSec.toFixed(2)}s  ${String(wav.length).padStart(7)}B  [${v}] ${expected}`);
  }

  // browser-native webm copy of the clean A variant (for the compressed-path test)
  const aSpoken = s.variants.A.spoken;
  const webm = await synthWebm(aSpoken, "+0%");
  const wfname = `${s.key}-A.webm`;
  fs.writeFileSync(path.join(OUT_DIR, wfname), webm);
  manifest.push({
    id: `${s.key}-A-webm`,
    audio: wfname,
    contentFormat: "webm",
    variant: "A",
    lengthTag: s.lengthTag,
    rate: "+0%",
    referenceText: s.reference,
    spokenText: aSpoken,
    expected: "compressed browser-native format — tests whether Azure REST accepts audio/webm;codecs=opus directly",
  });
  rows.push({ id: `${s.key}-A-webm`, fmt: "webm", durSec: null, bytes: webm.length });
  console.log(`  ${(s.key + "-A").padEnd(6)} webm ${String(webm.length).padStart(7)}B  (browser-native copy)`);
}

// unscripted clip — guard <=29s, speed up if needed
{
  let rate = "+0%";
  let { wav, durSec } = await synthWav(UNSCRIPTED_TEXT, rate);
  if (durSec > 29) {
    rate = "+12%";
    ({ wav, durSec } = await synthWav(UNSCRIPTED_TEXT, rate));
  }
  fs.writeFileSync(path.join(OUT_DIR, "unscripted.wav"), wav);
  manifest.push({
    id: "unscripted",
    audio: "unscripted.wav",
    contentFormat: "wav",
    sampleRate: TARGET_SR,
    variant: "unscripted",
    lengthTag: `~${durSec.toFixed(0)}s`,
    rate,
    referenceText: "", // <-- the point of this case
    spokenText: UNSCRIPTED_TEXT,
    expected: "ReferenceText empty → unscripted mode; record whether it returns per-word scores, Completeness, and whether Omission/Insertion are absent",
  });
  rows.push({ id: "unscripted", fmt: "wav", durSec, bytes: wav.length });
  console.log(`\n  unscripted.wav  ${durSec.toFixed(2)}s  ${wav.length}B  rate=${rate}  (referenceText="")`);
  if (durSec > 30) console.warn(`  [warn] unscripted clip ${durSec.toFixed(1)}s > 30s — Azure short-audio endpoint requires <=30s. Trim UNSCRIPTED_TEXT.`);
}

fs.writeFileSync(
  path.join(OUT_DIR, "manifest.json"),
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      note: "Consumed by scripts/azure-pa-spike.mjs. referenceText is the ORIGINAL sentence; spokenText is the (possibly mutated) audio. TTS is native-accent — validates pipeline + miscue detection only, NOT L2 pronunciation scoring.",
      voice: VOICE,
      clips: manifest,
    },
    null,
    2
  )
);

console.log(`\n[make-clips] done. ${manifest.length} clips + manifest.json → ${OUT_DIR}`);
console.log(`[make-clips] next: node scripts/azure-pa-spike.mjs   (needs AZURE_SPEECH_KEY / AZURE_SPEECH_REGION)`);
