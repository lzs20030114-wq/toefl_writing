"use strict";
/**
 * mp3Encode.js — pure-JS WAV(PCM s16le) → MP3 transcode for the persona render path.
 *
 * Why: the gpt-4o-mini-tts persona path (lib/tts/renderListening) produces WAV. A single
 * LAT lecture is ~7 min ≈ 20MB of 24kHz mono WAV; the whole listening bank as WAV would be
 * ~3GB — unusable for storage/CDN/mobile. 56kbps mono MP3 shrinks that ~15x with no
 * perceptible speech-quality loss. We stay in-process (the build host has NO ffmpeg) using
 * @breezystack/lamejs — the maintained lamejs fork that fixes the original's MPEG2
 * low-sample-rate frame-header bug.
 *
 * Sample rate: gpt-4o-mini-tts emits 24000 Hz mono s16le for response_format:"wav"
 * (OpenAI TTS spec — verified against wavTools.parseWav on real output). 24000 Hz is a
 * native MPEG2 Layer III rate that lamejs encodes directly, so NO resampling is needed on
 * the production path. Any other rate would require integer-ratio resampling before
 * encoding; rather than emit a corrupt stream we detect and reject it loudly (see below).
 */
const fs = require("fs");
const vm = require("vm");
const { parseWav } = require("./wavTools");

// Sample rates @breezystack/lamejs' Mp3Encoder accepts (MPEG1 / MPEG2 / MPEG2.5 tables).
const LAME_SAMPLE_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);
const MP3_BLOCK = 1152; // lame frame size (samples per channel)

// Loading @breezystack/lamejs is awkward: its package "exports" maps `require` → an IIFE
// bundle (`var lamejs = (function(){…})({})`) that assigns to a LOCAL var and never touches
// module.exports, so require() yields {}. The `import` condition is a real ESM module, but
// jest transpiles dynamic import() to the require condition and hits the same empty IIFE.
// So we resolve the bundle path, read the IIFE source, and eval it in a sandbox — capturing
// the `lamejs` global it defines. This is environment-agnostic (identical under jest + Node)
// and depends on nothing but the file being an IIFE that binds `lamejs`. Loaded once, cached.
let _lame;
function getLame() {
  if (_lame) return _lame;
  const code = fs.readFileSync(require.resolve("@breezystack/lamejs"), "utf8");
  const sandbox = {};
  vm.createContext(sandbox);
  // The bundle ends with `var lamejs = …;` — evaluate it, then hand back that binding.
  vm.runInContext(`${code}\n;globalThis.__lamejs = lamejs;`, sandbox);
  _lame = sandbox.__lamejs && sandbox.__lamejs.Mp3Encoder ? sandbox.__lamejs : (sandbox.__lamejs && sandbox.__lamejs.default);
  if (!_lame || typeof _lame.Mp3Encoder !== "function") {
    throw new Error("mp3Encode: failed to load @breezystack/lamejs Mp3Encoder");
  }
  return _lame;
}

/**
 * @param {Buffer} wavBuffer  a PCM s16le WAV (mono) — e.g. from renderSingleSpeaker/renderConversation
 * @param {{ kbps?: number }} [opts]
 * @returns {Promise<Buffer>} MP3 bytes
 */
async function encodeWavToMp3(wavBuffer, opts = {}) {
  const kbps = opts.kbps || 56;
  const { pcm, sampleRate, channels } = parseWav(wavBuffer);

  if (channels !== 1) {
    // The persona render path only ever produces mono; refuse stereo rather than silently
    // mis-encode interleaved samples as mono.
    throw new Error(`encodeWavToMp3: expected mono PCM, got ${channels} channels`);
  }
  if (!LAME_SAMPLE_RATES.has(sampleRate)) {
    throw new Error(
      `encodeWavToMp3: unsupported sample rate ${sampleRate}Hz — lamejs supports ` +
      `${[...LAME_SAMPLE_RATES].join("/")}. Resample (integer ratio) to a supported rate first.`
    );
  }

  const lame = getLame();
  const enc = new lame.Mp3Encoder(1, sampleRate, kbps);
  const out = [];
  for (let i = 0; i < pcm.length; i += MP3_BLOCK) {
    const chunk = pcm.subarray(i, i + MP3_BLOCK);
    const buf = enc.encodeBuffer(chunk);
    if (buf.length > 0) out.push(Buffer.from(buf));
  }
  const tail = enc.flush();
  if (tail.length > 0) out.push(Buffer.from(tail));
  return Buffer.concat(out);
}

module.exports = { encodeWavToMp3, LAME_SAMPLE_RATES };
