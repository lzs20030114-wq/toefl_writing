// Spike: does @andresaya/edge-tts render to an in-memory Buffer in a plain Node
// process (no disk writes, no script-only env)? This is the first-hand evidence for
// whether /api/user-bank/render-audio can run edge-tts inside a Vercel serverless
// function. The render endpoint uses generateSpeech(...).toBuffer() — same path.
//
// Run:  node scripts/spike-edge-tts.mjs
// Prints byte count + elapsed ms. Non-zero bytes = the memory-Buffer path works.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { generateSpeech } = require("../lib/tts/edgeTts.js");

const SAMPLE = "Where should I submit the revised essay by Friday?"; // a real LCR speaker line

async function main() {
  console.log("edge-tts spike — rendering one LCR speaker line to an in-memory Buffer");
  console.log(`text: "${SAMPLE}"`);
  const t0 = Date.now();
  let buf;
  try {
    buf = await generateSpeech(SAMPLE, { preset: "lcr_campus_female", format: "mp3" });
  } catch (e) {
    console.error("FAILED:", e && e.message ? e.message : e);
    process.exit(1);
  }
  const ms = Date.now() - t0;
  const ok = Buffer.isBuffer(buf) && buf.length > 0;
  console.log(`result: ${ok ? "OK" : "EMPTY"} — ${buf ? buf.length : 0} bytes in ${ms} ms`);
  console.log(`is Buffer: ${Buffer.isBuffer(buf)}`);
  // First bytes of an MP3 frame usually start with 0xFF 0xFB / ID3 tag "ID3".
  if (buf && buf.length >= 3) {
    console.log(`first 3 bytes: ${[buf[0], buf[1], buf[2]].map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
  }
  process.exit(ok ? 0 : 2);
}

main();
