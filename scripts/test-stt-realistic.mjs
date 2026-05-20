#!/usr/bin/env node
/**
 * Realistic STT eval — generates TTS samples that mimic real TOEFL responses
 * (disfluencies, self-corrections, academic vocab), then runs both Whisper-1
 * and GPT-4o Mini Transcribe and compares WER.
 *
 * We can't simulate actual Chinese phonetic accent without real human
 * recordings, but disfluency + vocabulary complexity are the two biggest
 * recognition challenges, and we can simulate those with TTS.
 *
 * Usage:
 *   $env:OPENAI_API_KEY = "sk-..."
 *   node scripts/test-stt-realistic.mjs
 */

import { writeFile, readFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.error(`[proxy] using ${proxyUrl}`);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Set OPENAI_API_KEY.");
  process.exit(1);
}

// Test cases — each is a plausible TOEFL Speaking response with the kind of
// imperfections real test-takers produce. Comments note the recognition risk.
const CASES = [
  {
    id: "01-clean-baseline",
    label: "Clean fluent baseline (control)",
    voice: "alloy",
    speed: 1.0,
    // Standard academic English, no filler — should be 0% WER from both.
    text: "Photosynthesis is the process by which plants convert sunlight, water, and carbon dioxide into glucose and oxygen. This reaction occurs in the chloroplasts and is essential for sustaining life on Earth.",
  },
  {
    id: "02-disfluent-esl",
    label: "Disfluent ESL response (hesitations + self-correction)",
    voice: "nova",
    speed: 0.85,  // slower, like a non-native speaker thinking
    // Lots of fillers, repeats, self-correction. Tests filler/repeat handling.
    text: "Um, in my opinion, uh, the most important thing is, is that, the teacher should give us, um, more time to, to think about the question. Because, you know, when we, when we don't have enough time, we cannot, uh, organize our, our thoughts clearly. So, I think the time is, is very important for, for learning.",
  },
  {
    id: "03-academic-complex",
    label: "Complex academic vocabulary + mid-sentence pauses",
    voice: "echo",
    speed: 0.9,
    // Hard vocabulary (chloroplasts, metamorphosis, photosynthesis) with breaks.
    text: "Well, the professor was discussing, um, the concept of metamorphosis, specifically how, how organisms undergo dramatic structural changes during development. For example, uh, butterflies transform from caterpillars through a process called holometabolism, which is, you know, quite different from incomplete metamorphosis seen in grasshoppers.",
  },
];

const STT_MODELS = [
  { id: "gpt-4o-mini-transcribe", priceUsdPerMin: 0.003, short: "Mini" },
  { id: "whisper-1",              priceUsdPerMin: 0.006, short: "Whisper" },
];

const TMP = path.resolve("tmp/stt-test");

function normalize(s) {
  return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
}

function wer(reference, hypothesis) {
  const ref = normalize(reference).split(" ").filter(Boolean);
  const hyp = normalize(hypothesis).split(" ").filter(Boolean);
  if (ref.length === 0) return null;
  const n = ref.length, m = hyp.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = ref[i - 1] === hyp[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return { wer: dp[n][m] / n, refLen: n, hypLen: m, edits: dp[n][m] };
}

async function generateTTS(text, voice, speed, outPath) {
  const t0 = Date.now();
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      voice,
      input: text,
      speed,
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(outPath, buf);
  return { latencyMs: Date.now() - t0, bytes: buf.length };
}

async function transcribe(model, filePath) {
  const buf = await readFile(filePath);
  const filename = path.basename(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "audio/mpeg" }), filename);
  form.append("model", model);
  form.append("language", "en");
  form.append("response_format", "json");

  const t0 = Date.now();
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return { transcript: json.text || "", latencyMs: Date.now() - t0 };
}

async function main() {
  await mkdir(TMP, { recursive: true });

  const results = [];

  for (const c of CASES) {
    console.log("\n" + "═".repeat(70));
    console.log(`CASE: ${c.label}`);
    console.log("═".repeat(70));
    const mp3Path = path.join(TMP, `${c.id}.mp3`);

    // Generate TTS once and reuse for both models
    let mp3Stat = null;
    try {
      mp3Stat = await stat(mp3Path);
      console.log(`  [tts] cached: ${(mp3Stat.size / 1024).toFixed(1)} KB`);
    } catch {
      process.stdout.write(`  [tts] generating ${c.voice} @ speed=${c.speed} ... `);
      const { latencyMs, bytes } = await generateTTS(c.text, c.voice, c.speed, mp3Path);
      console.log(`${latencyMs} ms, ${(bytes / 1024).toFixed(1)} KB`);
    }

    console.log(`  [reference] ${c.text}`);

    const caseRes = { ...c, models: {} };

    for (const m of STT_MODELS) {
      process.stdout.write(`  [stt:${m.short}] ... `);
      try {
        const { transcript, latencyMs } = await transcribe(m.id, mp3Path);
        const w = wer(c.text, transcript);
        const pct = w ? (w.wer * 100).toFixed(1) : "?";
        console.log(`${latencyMs} ms · WER ${pct}%`);
        console.log(`    → ${transcript}`);
        caseRes.models[m.id] = { transcript, latencyMs, wer: w };
      } catch (e) {
        console.log(`FAILED — ${e.message}`);
        caseRes.models[m.id] = { error: e.message };
      }
    }
    results.push(caseRes);
  }

  // Summary table
  console.log("\n" + "═".repeat(70));
  console.log("SUMMARY");
  console.log("═".repeat(70));
  console.log("Case                                          | Mini WER  | Whisper WER");
  console.log("─".repeat(70));
  for (const r of results) {
    const mini = r.models["gpt-4o-mini-transcribe"];
    const wsp = r.models["whisper-1"];
    const mw = mini?.wer ? (mini.wer.wer * 100).toFixed(1) + "%" : "ERR";
    const ww = wsp?.wer ? (wsp.wer.wer * 100).toFixed(1) + "%" : "ERR";
    const label = r.label.padEnd(46).slice(0, 46);
    console.log(`${label}|  ${mw.padStart(7)}  |  ${ww.padStart(7)}`);
  }
  console.log();
  console.log(`(Audio samples saved to ${TMP})`);
}

main().catch((e) => {
  console.error("\nFATAL:", e.stack || e.message);
  process.exit(1);
});
