#!/usr/bin/env node
/**
 * voice-ab-sample.mjs — generate the two A/B試听 clips for the "听力语音惊喜升级" vote.
 *
 * Reads the transcript from data/voiceAbSample.json, synthesizes the SAME passage with
 * BOTH engines (same lecture role, so the only variable is the engine), writes both mp3s
 * into public/voice-ab/, and fills the public URLs back into the JSON. The vote modal
 * stays hidden until both URLs are present.
 *
 *   A = edge-tts          (current production engine — free, no key)
 *   B = gpt-4o-mini-tts   (the proposed upgrade — needs OPENAI_API_KEY)
 *
 * Output goes to public/ (served as a static asset on Vercel) — no Supabase needed for
 * a two-file sample. Commit public/voice-ab/*.mp3 + data/voiceAbSample.json to ship it.
 *
 * Env:
 *   OPENAI_API_KEY                                   — required (for the B clip)
 *   OPENAI_PROXY_URL  (or DEEPSEEK_PROXY_URL)        — optional; set if OpenAI is blocked
 *                                                      from your network (http CONNECT proxy,
 *                                                      e.g. http://127.0.0.1:7890)
 *
 * Usage (Windows PowerShell):
 *   $env:OPENAI_API_KEY="sk-..."
 *   node scripts/voice-ab-sample.mjs                 # default voice for B: ash
 *   node scripts/voice-ab-sample.mjs --voice onyx    # try a different OpenAI voice
 *
 * Safe OpenAI voices for gpt-4o-mini-tts: alloy, ash, ballad, coral, echo, fable,
 * onyx, nova, sage, shimmer, verse.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const edge = require("../lib/tts/edgeTts.js");
const openai = require("../lib/tts/openaiTts.js");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE_PATH = resolve(ROOT, "data/voiceAbSample.json");
const OUT_DIR = resolve(ROOT, "public/voice-ab");

const argv = process.argv.slice(2);
const arg = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

// Same role for both engines → fair A/B. Both edgeTts and openaiTts define this preset.
const PRESET = arg("preset") || "lecture_male";
// The openaiTts lecture preset's default voice ("cedar") is a realtime-only voice that
// gpt-4o-mini-tts may reject — override with a known-good one. Keep the preset's rich
// speaking-style instructions either way.
const OPENAI_VOICE = arg("voice") || "ash";
// Optional speaking-style override for B. Plain-language tone/pace/emotion/accent
// instructions (gpt-4o-mini-tts only). When omitted, the preset's own instructions
// are used. e.g. --instructions "Warm, friendly professor chatting with students;
// measured pace for English learners; clear emphasis on key terms."
const INSTRUCTIONS = arg("instructions");

(async () => {
  const sample = JSON.parse(readFileSync(SAMPLE_PATH, "utf8"));
  const text = (arg("text") || sample.transcript || "").trim();
  if (!text) {
    console.error("✗ No transcript. Set data/voiceAbSample.json#transcript or pass --text.");
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("✗ OPENAI_API_KEY missing — needed for the B (gpt-4o-mini-tts) clip.");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Preset: ${PRESET}   OpenAI voice (B): ${OPENAI_VOICE}`);
  console.log(`Text:   ${text.slice(0, 90)}${text.length > 90 ? "…" : ""}\n`);

  console.log("→ A: edge-tts (current engine) …");
  const aBuf = await edge.generateSpeech(text, { preset: PRESET, format: "mp3" });
  writeFileSync(resolve(OUT_DIR, "a.mp3"), aBuf);
  sample.voiceA = { label: "现在的引擎", engine: "edge", url: "/voice-ab/a.mp3" };
  console.log(`  ✓ public/voice-ab/a.mp3 (${(aBuf.length / 1024).toFixed(0)} KB)`);

  console.log("→ B: gpt-4o-mini-tts (upgrade) …");
  const bBuf = await openai.generateSpeech(text, { preset: PRESET, voice: OPENAI_VOICE, instructions: INSTRUCTIONS, format: "mp3" });
  writeFileSync(resolve(OUT_DIR, "b.mp3"), bBuf);
  sample.voiceB = { label: "升级版（GPT-4o）", engine: "openai", url: "/voice-ab/b.mp3" };
  console.log(`  ✓ public/voice-ab/b.mp3 (${(bBuf.length / 1024).toFixed(0)} KB)`);

  writeFileSync(SAMPLE_PATH, JSON.stringify(sample, null, 2) + "\n");
  console.log(
    `\n✓ Done. URLs written into data/voiceAbSample.json — the vote modal will now show.\n` +
    `  Listen: open public/voice-ab/a.mp3 vs b.mp3, or reload the dev server homepage.\n` +
    `  Ship:   commit public/voice-ab/*.mp3 + data/voiceAbSample.json, then deploy.`
  );
})().catch((e) => {
  const msg = e?.message || String(e);
  console.error(`\n✗ Failed: ${msg}`);
  if (/voice/i.test(msg) && /400|invalid|unknown|not/i.test(msg)) {
    console.error(`  ↳ The voice "${OPENAI_VOICE}" may not be enabled — retry with --voice onyx (or alloy/echo/nova/sage).`);
  }
  if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|socket/i.test(msg)) {
    console.error(`  ↳ Network can't reach OpenAI — set $env:OPENAI_PROXY_URL to your local proxy (e.g. http://127.0.0.1:7890).`);
  }
  process.exit(1);
});
