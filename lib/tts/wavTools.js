"use strict";
/**
 * wavTools.js — PCM s16le WAV glue for stitching gpt-4o-mini-tts per-segment audio.
 *
 * Why: rendering each SENTENCE/turn as its own generateSpeech call (format 'wav') and
 * concatenating them — with (a) loudness normalization so segments match level, and
 * (b) a small silence gap between them — keeps question intonation from bleeding into
 * the next sentence and evens out per-voice loudness differences. Request 'wav' from the
 * TTS, parse here, normalize, concat, write one wav.
 */

function parseWav(buf) {
  let off = 12, fmt = null, dataOff = null, dataLen = null; // skip RIFF/WAVE
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === "fmt ") fmt = { channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    else if (id === "data") { dataOff = off + 8; dataLen = sz; }
    off += 8 + sz + (sz % 2);
  }
  if (!fmt || dataOff == null) throw new Error("not a parseable WAV");
  if (fmt.bits !== 16) throw new Error("expected 16-bit PCM, got " + fmt.bits);
  const usable = Math.min(dataLen, buf.length - dataOff); // OpenAI's data size can run 1-2 bytes past EOF
  const n = Math.floor(usable / 2), pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = buf.readInt16LE(dataOff + i * 2);
  return { pcm, sampleRate: fmt.sampleRate, channels: fmt.channels };
}

// Normalize one segment to a common RMS target, peak-limited so it never clips.
function normalize(pcm, targetRms = 0.12, peakCeil = 0.95) {
  let sumsq = 0, peak = 1e-9;
  for (const v of pcm) { const f = v / 32768; sumsq += f * f; const a = Math.abs(f); if (a > peak) peak = a; }
  const rms = Math.sqrt(sumsq / Math.max(1, pcm.length)) || 1e-9;
  const gain = Math.min(targetRms / rms, peakCeil / peak);
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-32767, Math.min(32767, Math.round((pcm[i] / 32768) * gain * 32767)));
  return out;
}

function silence(ms, sampleRate, channels) {
  return new Int16Array(Math.max(0, Math.round((sampleRate * ms) / 1000)) * channels);
}

function buildWav(pcm, sampleRate, channels) {
  const dataLen = pcm.length * 2, buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28); buf.writeUInt16LE(channels * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return buf;
}

/**
 * Stitch an ordered list of per-segment WAV buffers into one WAV: optionally
 * loudness-normalize each, then concat with a `gapMs` silence between segments.
 * @param {Buffer[]} wavBuffers
 * @param {{ gapMs?: number, normalizeSegments?: boolean }} [opts]
 * @returns {Buffer}
 */
function concatWavSegments(wavBuffers, opts = {}) {
  const gapMs = opts.gapMs == null ? 160 : opts.gapMs;
  const doNorm = opts.normalizeSegments !== false;
  if (!wavBuffers.length) throw new Error("concatWavSegments: no segments");
  let sampleRate = 24000, channels = 1;
  const segs = wavBuffers.map((b) => {
    const { pcm, sampleRate: sr, channels: ch } = parseWav(b);
    sampleRate = sr; channels = ch;
    return doNorm ? normalize(pcm) : pcm;
  });
  const gap = silence(gapMs, sampleRate, channels);
  let total = 0;
  for (let i = 0; i < segs.length; i++) total += segs[i].length + (i < segs.length - 1 ? gap.length : 0);
  const all = new Int16Array(total);
  let pos = 0;
  for (let i = 0; i < segs.length; i++) {
    all.set(segs[i], pos); pos += segs[i].length;
    if (i < segs.length - 1) { all.set(gap, pos); pos += gap.length; }
  }
  return buildWav(all, sampleRate, channels);
}

// Split a turn into sentence-level chunks at . ? ! so each is synthesized separately
// (keeps a question's rising intonation from bleeding into the next sentence).
function splitSentences(text) {
  const out = (String(text || "").match(/[^.!?]+[.!?]*/g) || []).map((s) => s.trim()).filter(Boolean);
  return out.length ? out : [String(text || "").trim()].filter(Boolean);
}

module.exports = { parseWav, normalize, silence, buildWav, concatWavSegments, splitSentences };
