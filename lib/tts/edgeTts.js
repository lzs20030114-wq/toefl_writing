/**
 * Edge TTS client — FREE high-quality neural speech generation.
 *
 * Uses Microsoft Edge Read Aloud API via @andresaya/edge-tts package.
 * No API key needed, no cost, no rate limit.
 *
 * Voice quality is comparable to commercial APIs (neural voices).
 * Supports pitch, rate, volume customization.
 *
 * Best English voices (tested):
 *   Female:
 *     - en-US-AriaNeural       — warm, expressive, versatile (best female)
 *     - en-US-JennyNeural      — friendly, clear, great for announcements
 *     - en-US-MichelleNeural   — professional, confident
 *     - en-US-EmmaNeural       — young, casual, student-like
 *     - en-GB-SoniaNeural      — British, professional
 *   Male:
 *     - en-US-GuyNeural        — clear, neutral, great for lectures (best male)
 *     - en-US-ChristopherNeural — warm, friendly, good for conversations
 *     - en-US-EricNeural       — deep, authoritative
 *     - en-US-RogerNeural      — calm, measured
 *     - en-GB-RyanNeural       — British, professional
 */

const { EdgeTTS } = require("@andresaya/edge-tts");
const path = require("path");
const fs = require("fs");

// ── Voice presets for TOEFL listening roles ──

const EDGE_VOICE_PRESETS = {
  // LCR: single-sentence prompts
  lcr_campus_female: {
    voice: "en-US-AriaNeural",
    rate: "-5%",
    pitch: "+0Hz",
    volume: "+0%",
  },
  lcr_campus_male: {
    voice: "en-US-ChristopherNeural",
    rate: "-5%",
    pitch: "+0Hz",
    volume: "+0%",
  },
  lcr_staff_female: {
    voice: "en-US-JennyNeural",
    rate: "-8%",
    pitch: "+0Hz",
    volume: "+0%",
  },
  lcr_staff_male: {
    voice: "en-US-GuyNeural",
    rate: "-8%",
    pitch: "+0Hz",
    volume: "+0%",
  },

  // Announcements
  announcement_formal: {
    voice: "en-US-EricNeural",
    rate: "-12%",
    pitch: "-5Hz",
    volume: "+10%",
  },
  announcement_classroom: {
    voice: "en-US-GuyNeural",
    rate: "-10%",
    pitch: "+0Hz",
    volume: "+0%",
  },
  announcement_ra: {
    voice: "en-US-AriaNeural",
    rate: "-5%",
    pitch: "+5Hz",
    volume: "+0%",
  },

  // Conversations — student roles
  student_female: {
    voice: "en-US-EmmaNeural",
    rate: "+0%",
    pitch: "+5Hz",
    volume: "+0%",
  },
  student_male: {
    voice: "en-US-ChristopherNeural",
    rate: "+0%",
    pitch: "+0Hz",
    volume: "+0%",
  },

  // Authority roles
  professor_male: {
    voice: "en-US-GuyNeural",
    rate: "-15%",
    pitch: "-3Hz",
    volume: "+0%",
  },
  professor_female: {
    voice: "en-US-MichelleNeural",
    rate: "-12%",
    pitch: "+0Hz",
    volume: "+0%",
  },
  librarian: {
    voice: "en-US-JennyNeural",
    rate: "-10%",
    pitch: "+0Hz",
    volume: "-5%",
  },
  advisor: {
    voice: "en-US-RogerNeural",
    rate: "-10%",
    pitch: "+0Hz",
    volume: "+0%",
  },

  // Academic lectures
  lecture_male: {
    voice: "en-US-GuyNeural",
    rate: "-12%",
    pitch: "-2Hz",
    volume: "+5%",
  },
  lecture_female: {
    voice: "en-US-AriaNeural",
    rate: "-10%",
    pitch: "+0Hz",
    volume: "+5%",
  },

  // Default
  default: {
    voice: "en-US-AriaNeural",
    rate: "-5%",
    pitch: "+0Hz",
    volume: "+0%",
  },
};

/**
 * Generate speech audio from text using Edge TTS.
 *
 * @param {string} text — text to speak
 * @param {object} opts
 * @param {string} [opts.voice] — voice name (e.g. "en-US-AriaNeural")
 * @param {string} [opts.preset] — EDGE_VOICE_PRESETS key
 * @param {string} [opts.rate] — speech rate (e.g. "-10%", "+20%")
 * @param {string} [opts.pitch] — pitch adjustment (e.g. "+5Hz", "-10Hz")
 * @param {string} [opts.volume] — volume adjustment (e.g. "+10%", "-5%")
 * @param {string} [opts.format] — output format, default "mp3"
 * @returns {Promise<Buffer>} audio data
 */
async function synthesizeEdge(text, opts = {}) {
  const {
    preset,
    voice: voiceOverride,
    rate: rateOverride,
    pitch: pitchOverride,
    volume: volumeOverride,
    format = "mp3",
  } = opts;

  // Resolve from preset
  const p = (preset && EDGE_VOICE_PRESETS[preset]) || EDGE_VOICE_PRESETS.default;
  const voice = voiceOverride || p.voice;
  const rate = rateOverride || p.rate || "+0%";
  const pitch = pitchOverride || p.pitch || "+0Hz";
  const volume = volumeOverride || p.volume || "+0%";

  const tts = new EdgeTTS();

  const outputFormat = format === "mp3"
    ? "audio-24khz-96kbitrate-mono-mp3"
    : format === "wav"
    ? "riff-24khz-16bit-mono-pcm"
    : "webm-24khz-16bit-mono-opus";

  await tts.synthesize(text, voice, {
    rate,
    pitch,
    volume,
    outputFormat,
  });
  return tts;
}

async function generateSpeech(text, opts = {}) {
  const tts = await synthesizeEdge(text, opts);
  // Use toBuffer() directly — toFile() has issues with sequential calls
  const buffer = await tts.toBuffer();
  return buffer;
}

const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * Edge 的 audio.metadata WordBoundary → 词级时间戳（秒）。offset / duration 是 100ns 刻度
 * （Azure 语音服务口径：1e7 刻度 = 1 秒），相对这一次合成的音频开头。
 * @param {Array<{offset:number,duration:number,text:string}>} boundaries
 * @returns {Array<{text:string,start:number,end:number}>}
 */
function wordsFromBoundaries(boundaries) {
  const out = [];
  for (const b of Array.isArray(boundaries) ? boundaries : []) {
    const text = String((b && b.text) || "").trim();
    const offset = Number(b && b.offset), duration = Number(b && b.duration);
    if (!text || !Number.isFinite(offset) || !Number.isFinite(duration) || offset < 0 || duration < 0) continue;
    out.push({ text, start: round3(offset / 1e7), end: round3((offset + duration) / 1e7) });
  }
  return out;
}

/**
 * generateSpeechTimed — 与 generateSpeech 相同的合成，另带 Edge 报回来的词级时间戳
 * （个人题库配音据此写 sentence_timings，见 docs/listening-sentence-timings.md）。
 * @returns {Promise<{ buffer: Buffer, words: Array<{text:string,start:number,end:number}> }>}
 */
async function generateSpeechTimed(text, opts = {}) {
  const tts = await synthesizeEdge(text, opts);
  const buffer = await tts.toBuffer();
  const boundaries = typeof tts.getWordBoundaries === "function" ? tts.getWordBoundaries() : [];
  return { buffer, words: wordsFromBoundaries(boundaries) };
}

/**
 * Generate multi-voice conversation audio.
 *
 * @param {Array<{text: string, voice?: string, preset?: string}>} segments
 * @param {object} opts — default options
 * @returns {Promise<Buffer>} concatenated audio
 */
async function generateConversation(segments, opts = {}) {
  const buffers = [];
  for (const seg of segments) {
    const buf = await generateSpeech(seg.text, {
      ...opts,
      voice: seg.voice,
      preset: seg.preset,
    });
    buffers.push(buf);
  }
  return Buffer.concat(buffers);
}

/**
 * List available English voices.
 * @returns {Promise<Array>}
 */
async function listEnglishVoices() {
  const tts = new EdgeTTS();
  const voices = await tts.getVoices();
  return voices.filter(v => v.Locale && v.Locale.startsWith("en-"));
}

module.exports = { generateSpeech, generateSpeechTimed, wordsFromBoundaries, generateConversation, listEnglishVoices, EDGE_VOICE_PRESETS };
