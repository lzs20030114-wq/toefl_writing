#!/usr/bin/env node
/**
 * voice-ab-conversation.mjs — conversation A/B demo for the "听力语音惊喜升级" vote.
 *
 * Real bank item lc.json #lc_mpvfq0s1_5 — an overwhelmed student asks an academic
 * advisor whether to drop a course. Woman (student) + Man (advisor).
 *
 *   A = THE ACTUAL DEPLOYED AUDIO users hear now (downloaded verbatim from audio_url):
 *       two flat staff voices (Jenny + Guy) — one woman, one man, no per-line affect.
 *   B = gpt-4o-mini-tts — two distinct voices (coral=anxious student, echo=calm advisor)
 *       + per-speaker persona + per-line tone; an overwhelm→relief arc. Exam pace.
 *
 * B is built per-segment so we can LOUDNESS-NORMALIZE each turn (gpt-4o voices differ in
 * level — coral renders quieter than echo), then concat with a small inter-turn gap.
 * No ffmpeg: we request WAV (PCM) and normalize in pure Node (RMS target + peak limiter).
 *
 * Writes public/voice-ab/a.mp3 + b.wav and fills data/voiceAbSample.json.
 * Needs OPENAI_API_KEY (+ OPENAI_PROXY_URL if OpenAI is blocked).
 */
import { writeFileSync, mkdirSync, readFileSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const openai = require("../lib/tts/openaiTts.js");
const bank = require("../data/listening/bank/lc.json");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/voice-ab");
const SAMPLE = resolve(ROOT, "data/voiceAbSample.json");

const SRC = bank.items.find((x) => x.id === "lc_mpvfq0s1_5");
const A_URL = SRC && SRC.audio_url;

const OPENAI_VOICE = { Woman: "coral", Man: "echo" };
const PERSONA = {
  Woman: "You are an overwhelmed, anxious female undergraduate asking for advice. Speak with an earnest, slightly hurried, worried energy that visibly eases as she is reassured.",
  Man: "You are a calm, experienced male academic advisor. Speak with a steady, warm, reassuring tone and unhurried confidence.",
};
const TURNS = [
  { speaker: "Woman", text: "Hi, I'm taking six courses this term, and I'm completely overwhelmed. I'm thinking of dropping one, but I'm worried about falling behind.", instructions: "Overwhelmed and earnest, the worry spilling out a little quickly; genuinely anxious about falling behind." },
  { speaker: "Man", text: "Six is a lot. Which one are you considering dropping?", instructions: "Calm and acknowledging — a steady, unhurried question that already feels reassuring." },
  { speaker: "Woman", text: "Probably the elective, the art history one. It's interesting, but it's the heaviest reading load.", instructions: "Thinking aloud, a little torn — she likes the class but feels the weight of the reading." },
  { speaker: "Man", text: "Here's the thing: dropping an elective won't delay your graduation at all, since you've already met your core requirements for the year. You can always retake it later.", instructions: "Reassuring and clear, laying out the helpful fact with quiet confidence." },
  { speaker: "Woman", text: "Oh, that's reassuring. So it won't hurt me down the line?", instructions: "Relief washing in on 'Oh, that's reassuring,' then a hopeful check for final confirmation." },
  { speaker: "Man", text: "Not at all. And the drop deadline is Friday, so you have time to think it over before deciding.", instructions: "Warm and confident, closing with a helpful, no-pressure note about the deadline." },
];

// ── WAV (PCM s16le) helpers ──
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
// Normalize one segment to a common RMS target, limited so peaks never clip.
function normalize(pcm, targetRms = 0.12, peakCeil = 0.95) {
  let sumsq = 0, peak = 1e-9;
  for (const v of pcm) { const f = v / 32768; sumsq += f * f; const a = Math.abs(f); if (a > peak) peak = a; }
  const rms = Math.sqrt(sumsq / pcm.length) || 1e-9;
  const gain = Math.min(targetRms / rms, peakCeil / peak);
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) { let f = (pcm[i] / 32768) * gain; out[i] = Math.max(-32767, Math.min(32767, Math.round(f * 32767))); }
  return out;
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

(async () => {
  if (!process.env.OPENAI_API_KEY) { console.error("✗ OPENAI_API_KEY missing."); process.exit(1); }
  if (!A_URL) { console.error("✗ source item has no audio_url."); process.exit(1); }
  mkdirSync(OUT, { recursive: true });

  console.log(`→ A: downloading the REAL deployed audio (${A_URL.split("/").pop()}) …`);
  const res = await fetch(A_URL);
  if (!res.ok) { console.error(`✗ download failed: HTTP ${res.status}`); process.exit(1); }
  const aBuf = Buffer.from(await res.arrayBuffer());
  writeFileSync(resolve(OUT, "a.mp3"), aBuf);
  console.log(`  ✓ public/voice-ab/a.mp3 (${(aBuf.length / 1024).toFixed(0)} KB) — verbatim live audio (Jenny + Guy)`);

  console.log("→ B: gpt-4o-mini-tts per-segment (WAV) → loudness-normalize → concat …");
  let sampleRate = 24000, channels = 1;
  const segs = [];
  for (const t of TURNS) {
    const wav = await openai.generateSpeech(t.text, { voice: OPENAI_VOICE[t.speaker], instructions: `${PERSONA[t.speaker]} ${t.instructions}`, format: "wav" });
    const { pcm, sampleRate: sr, channels: ch } = parseWav(wav);
    sampleRate = sr; channels = ch;
    segs.push(normalize(pcm));
    process.stdout.write(`  · ${t.speaker} ${pcm.length} samples\n`);
  }
  const gap = new Int16Array(Math.round(sampleRate * 0.18) * channels); // ~180ms inter-turn pause
  let total = 0; for (let i = 0; i < segs.length; i++) total += segs[i].length + (i < segs.length - 1 ? gap.length : 0);
  const all = new Int16Array(total);
  let pos = 0;
  for (let i = 0; i < segs.length; i++) { all.set(segs[i], pos); pos += segs[i].length; if (i < segs.length - 1) { all.set(gap, pos); pos += gap.length; } }
  const bWav = buildWav(all, sampleRate, channels);
  writeFileSync(resolve(OUT, "b.wav"), bWav);
  try { rmSync(resolve(OUT, "b.mp3")); } catch {}
  console.log(`  ✓ public/voice-ab/b.wav (${(bWav.length / 1024).toFixed(0)} KB) — normalized, ${segs.length} turns`);

  const sample = JSON.parse(readFileSync(SAMPLE, "utf8"));
  sample.transcript = TURNS.map((t) => `${t.speaker}: ${t.text}`).join("\n");
  sample.voiceA = { label: "现在线上正在用的版本", engine: "deployed", url: "/voice-ab/a.mp3" };
  sample.voiceB = { label: "升级版（GPT-4o）", engine: "openai", url: "/voice-ab/b.wav" };
  writeFileSync(SAMPLE, JSON.stringify(sample, null, 2) + "\n");
  console.log("\n✓ Done — A = real deployed audio, B = loudness-normalized upgrade; JSON updated.");
})().catch((e) => {
  const msg = e?.message || String(e);
  console.error(`\n✗ Failed: ${msg}`);
  if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|socket/i.test(msg)) console.error("  ↳ set $env:OPENAI_PROXY_URL=http://127.0.0.1:10808");
  process.exit(1);
});
