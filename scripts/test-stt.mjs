#!/usr/bin/env node
/**
 * Phase -1 vendor evaluation: compare OpenAI's two transcription models on
 * the same audio clip. We use this to decide whether GPT-4o Mini Transcribe
 * is accurate enough to be our default STT, or whether we should pay 2x for
 * Whisper-1 / GPT-4o Transcribe.
 *
 * Usage:
 *   # PowerShell
 *   $env:OPENAI_API_KEY = "sk-..."
 *   node scripts/test-stt.mjs path/to/audio.webm
 *
 *   # macOS / Linux
 *   OPENAI_API_KEY=sk-... node scripts/test-stt.mjs path/to/audio.webm
 *
 * Supports: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm
 *
 * Output: side-by-side transcripts + latency + estimated cost for each model.
 * Pass `--ref "expected text"` to also print a rough WER comparison.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ProxyAgent, setGlobalDispatcher } from "undici";

// Local dev in mainland China: Node's global fetch ignores HTTPS_PROXY env
// vars by default, so we wire it up explicitly via undici's ProxyAgent.
// Vercel won't have these env vars set — production goes direct.
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.error(`[proxy] using ${proxyUrl}`);
}

const MODELS = [
  { id: "gpt-4o-mini-transcribe", priceUsdPerMin: 0.003 },
  { id: "whisper-1",              priceUsdPerMin: 0.006 },
];

const MIME_BY_EXT = {
  flac: "audio/flac",
  m4a:  "audio/mp4",
  mp3:  "audio/mpeg",
  mp4:  "audio/mp4",
  mpeg: "audio/mpeg",
  mpga: "audio/mpeg",
  oga:  "audio/ogg",
  ogg:  "audio/ogg",
  wav:  "audio/wav",
  webm: "audio/webm",
};

function parseArgs(argv) {
  const out = { file: null, ref: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ref") out.ref = argv[++i] || null;
    else if (!a.startsWith("-")) out.file = a;
  }
  return out;
}

/** Strip punctuation, lowercase, collapse whitespace. */
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Simple WER via Levenshtein on token arrays. O(N*M). */
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
      if (ref[i - 1] === hyp[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return { wer: dp[n][m] / n, refLen: n, hypLen: m, edits: dp[n][m] };
}

async function transcribe(model, audioBuffer, filename) {
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mime = MIME_BY_EXT[ext] || "application/octet-stream";

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: mime }), filename);
  form.append("model", model);
  form.append("language", "en");
  // response_format=json gives just { text }. Verbose includes segments+timestamps
  // but Mini only supports json, so stay on json for parity.
  form.append("response_format", "json");

  const t0 = Date.now();
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  const latencyMs = Date.now() - t0;

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 400)}`);
  }
  const json = await res.json();
  return { transcript: json.text || "", latencyMs };
}

function fmtCost(seconds, pricePerMin) {
  const usd = (seconds / 60) * pricePerMin;
  const cny = usd * 7.2;
  return { usd, cny };
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Set OPENAI_API_KEY environment variable.");
    process.exit(1);
  }
  const { file, ref } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error("Usage: node scripts/test-stt.mjs <audio-file> [--ref \"expected text\"]");
    process.exit(1);
  }

  const absPath = path.resolve(file);
  const buf = await readFile(absPath);
  const st = await stat(absPath);
  const filename = path.basename(absPath);
  const sizeKB = (st.size / 1024).toFixed(1);

  console.log();
  console.log("Audio file:", absPath);
  console.log("Size:      ", `${sizeKB} KB`);
  if (ref) console.log("Reference: ", ref);
  console.log("─".repeat(70));

  // Rough audio duration estimate (assumes typical compressed bitrate ~32-48 kbps for Opus)
  // We can't easily decode without ffprobe, so this is just informational.
  // Treat the audio as 30s for cost estimation if you don't know — adjust as needed.

  const results = [];
  for (const { id, priceUsdPerMin } of MODELS) {
    process.stdout.write(`\n→ ${id} ... `);
    try {
      const { transcript, latencyMs } = await transcribe(id, buf, filename);
      const w = ref ? wer(ref, transcript) : null;
      results.push({ id, priceUsdPerMin, transcript, latencyMs, wer: w });
      console.log(`${latencyMs} ms`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      results.push({ id, priceUsdPerMin, error: e.message });
    }
  }

  console.log("\n" + "═".repeat(70));
  console.log("RESULTS");
  console.log("═".repeat(70));

  for (const r of results) {
    console.log(`\n[${r.id}]`);
    console.log(`  Price:   $${r.priceUsdPerMin}/min`);
    if (r.error) {
      console.log(`  ❌ ERROR: ${r.error}`);
      continue;
    }
    console.log(`  Latency: ${r.latencyMs} ms`);
    if (r.wer) {
      const pct = (r.wer.wer * 100).toFixed(1);
      console.log(`  WER:     ${pct}%  (${r.wer.edits} edits over ${r.wer.refLen} reference words; got ${r.wer.hypLen} words)`);
    }
    console.log(`  Text:    ${r.transcript}`);
  }

  // Cost table assuming a few sample lengths
  console.log("\n" + "─".repeat(70));
  console.log("COST PROJECTION (per question)");
  console.log("─".repeat(70));
  console.log("Duration |  Mini ($0.003/min) | Whisper-1 ($0.006/min)");
  for (const sec of [30, 45, 60]) {
    const mini    = fmtCost(sec, 0.003);
    const whisper = fmtCost(sec, 0.006);
    console.log(
      `   ${sec}s   |  $${mini.usd.toFixed(4)} ≈ ¥${mini.cny.toFixed(3)}  |  $${whisper.usd.toFixed(4)} ≈ ¥${whisper.cny.toFixed(3)}`,
    );
  }
  console.log();
}

main().catch((e) => {
  console.error("\nFATAL:", e.message);
  process.exit(1);
});
