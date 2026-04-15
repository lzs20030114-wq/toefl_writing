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
async function generateSpeech(text, opts = {}) {
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

  // Use toBuffer() directly — toFile() has issues with sequential calls
  const buffer = await tts.toBuffer();

  return buffer;
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

module.exports = { generateSpeech, generateConversation, listEnglishVoices, EDGE_VOICE_PRESETS };
