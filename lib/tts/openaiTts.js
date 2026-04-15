/**
 * OpenAI TTS client — generates speech audio from text.
 *
 * Uses the OpenAI API directly via fetch (no SDK dependency).
 * Supports proxy for environments that need it.
 *
 * Voices:
 *   - "nova"    — clear, professional, academic tone (lectures/announcements)
 *   - "shimmer" — warm, friendly (conversations - female)
 *   - "echo"    — calm, neutral (conversations - male)
 *   - "onyx"    — deep, authoritative (professors)
 *   - "fable"   — expressive, storytelling
 *   - "alloy"   — balanced, neutral
 *
 * Models:
 *   - "tts-1"    — faster, lower quality (~$15/1M chars)
 *   - "tts-1-hd" — slower, higher quality (~$30/1M chars)
 */

const https = require("https");
const http = require("http");
const { URL } = require("url");

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

/**
 * Generate speech audio from text.
 *
 * @param {string} text — text to convert to speech
 * @param {object} opts
 * @param {string} [opts.voice="nova"] — voice ID
 * @param {string} [opts.model="tts-1-hd"] — model ID
 * @param {string} [opts.format="mp3"] — output format: mp3, opus, aac, flac
 * @param {number} [opts.speed=1.0] — speed 0.25-4.0
 * @param {number} [opts.timeoutMs=120000] — timeout
 * @returns {Promise<Buffer>} audio data
 */
async function generateSpeech(text, opts = {}) {
  const {
    voice = "nova",
    model = "tts-1-hd",
    format = "mp3",
    speed = 1.0,
    timeoutMs = 120000,
  } = opts;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const body = JSON.stringify({
    model,
    input: text,
    voice,
    response_format: format,
    speed,
  });

  const proxyUrl = (process.env.OPENAI_PROXY_URL || process.env.DEEPSEEK_PROXY_URL || "").trim();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TTS request timeout")), timeoutMs);

    function handleResponse(res) {
      if (res.statusCode !== 200) {
        let errBody = "";
        res.on("data", (d) => (errBody += d));
        res.on("end", () => {
          clearTimeout(timer);
          reject(new Error(`OpenAI TTS error ${res.statusCode}: ${errBody}`));
        });
        return;
      }
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      });
    }

    if (proxyUrl) {
      // Use HTTP CONNECT proxy
      const proxy = new URL(proxyUrl);
      const target = new URL(OPENAI_TTS_URL);

      const connectReq = http.request({
        host: proxy.hostname,
        port: proxy.port || 1080,
        method: "CONNECT",
        path: `${target.hostname}:443`,
      });

      connectReq.on("connect", (_res, socket) => {
        const tlsSocket = require("tls").connect({
          host: target.hostname,
          socket,
          servername: target.hostname,
        });

        const req = https.request(
          {
            hostname: target.hostname,
            path: target.pathname,
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            },
            socket: tlsSocket,
            createConnection: () => tlsSocket,
          },
          handleResponse
        );

        req.on("error", (e) => { clearTimeout(timer); reject(e); });
        req.write(body);
        req.end();
      });

      connectReq.on("error", (e) => { clearTimeout(timer); reject(e); });
      connectReq.end();
    } else {
      // Direct request
      const target = new URL(OPENAI_TTS_URL);
      const req = https.request(
        {
          hostname: target.hostname,
          path: target.pathname,
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        handleResponse
      );

      req.on("error", (e) => { clearTimeout(timer); reject(e); });
      req.write(body);
      req.end();
    }
  });
}

/**
 * Generate multi-voice conversation audio by concatenating segments.
 *
 * @param {Array<{text: string, voice: string}>} segments
 * @param {object} opts — same as generateSpeech opts (except voice)
 * @returns {Promise<Buffer>} concatenated mp3 audio
 */
async function generateConversation(segments, opts = {}) {
  const buffers = [];
  for (const seg of segments) {
    const buf = await generateSpeech(seg.text, { ...opts, voice: seg.voice });
    buffers.push(buf);
  }
  // Simple concatenation for mp3 — works because mp3 frames are self-contained
  return Buffer.concat(buffers);
}

/**
 * Estimate cost of TTS generation.
 * OpenAI TTS-1: $15/1M chars, TTS-1-HD: $30/1M chars
 *
 * @param {string} text
 * @param {string} model
 * @returns {{ chars: number, cost: number }}
 */
function estimateCost(text, model = "tts-1-hd") {
  const chars = text.length;
  const rate = model === "tts-1-hd" ? 30 / 1_000_000 : 15 / 1_000_000;
  return { chars, cost: chars * rate };
}

module.exports = { generateSpeech, generateConversation, estimateCost };
