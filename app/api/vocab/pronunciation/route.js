import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { isOriginAllowed } from "../../../../lib/ai/routeGuards";
const { generateSpeech } = require("../../../../lib/tts/edgeTts");

export const runtime = "nodejs";
export const maxDuration = 30;
const limiter = createRateLimiter("vocab-pronunciation", { window: 60000, max: 240 });
const cache = new Map();
const inflight = new Map();
let running = 0;
const error = (status, message) => Response.json({ ok: false, error: message }, { status });

async function synthesize(word) {
  if (cache.has(word)) return cache.get(word);
  if (inflight.has(word)) return inflight.get(word);
  if (running >= 4) throw new Error("Busy");
  running++;
  const job = (async () => {
    let timer;
    try {
      // Keep the slot until the actual upstream settles, even after the response times out.
      const upstream = Promise.resolve().then(() => generateSpeech(word, { voice: "en-US-AriaNeural", rate: "-10%", format: "mp3" }));
      upstream.finally(() => { running--; }).catch(() => {});
      const buffer = await Promise.race([upstream, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Timeout")), 20000); })]);
      if (!buffer?.length || buffer.length > 1024 * 1024) throw new Error("Invalid audio");
      cache.set(word, buffer);
      while (cache.size > 120) cache.delete(cache.keys().next().value);
      return buffer;
    } finally { clearTimeout(timer); inflight.delete(word); }
  })();
  inflight.set(word, job);
  return job;
}

export async function GET(request) {
  const site = request.headers.get("sec-fetch-site");
  // Same-origin GETs usually omit Origin; the shared POST guard requires one.
  if (site === "cross-site" || (request.headers.get("origin") && !isOriginAllowed(request))) return error(403, "Forbidden origin.");
  const word = String(new URL(request.url).searchParams.get("word") || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!word || word.length > 60 || word.split(" ").length > 6 || !/^[a-z]+(?:['’-][a-z]+)*(?: [a-z]+(?:['’-][a-z]+)*)*$/.test(word)) return error(400, "Invalid vocabulary word.");
  if (limiter.isLimited(getIp(request))) return error(429, "Too many pronunciation requests.");
  try {
    const buffer = await synthesize(word);
    return new Response(buffer, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400, s-maxage=604800", "X-Pronunciation-Version": "1", "X-Content-Type-Options": "nosniff" } });
  } catch { return error(503, "Pronunciation temporarily unavailable."); }
}
