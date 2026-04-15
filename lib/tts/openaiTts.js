/**
 * OpenAI TTS client v2 — high-quality speech generation.
 *
 * Uses gpt-4o-mini-tts (latest model) with instructions parameter
 * for natural, controllable speech output.
 *
 * Key upgrade from v1:
 *  - Model: tts-1-hd → gpt-4o-mini-tts (35% lower word error rate)
 *  - Instructions: control tone, pace, emotion, accent per utterance
 *  - Voices: 13 voices available (recommend marin/cedar for best quality)
 *  - Multi-role: different voices + instructions for conversation segments
 *
 * Voice guide for TOEFL listening:
 *   - "marin"   — warm female, best quality, ideal for announcements/narration
 *   - "cedar"   — clear male, best quality, ideal for professors/lecturers
 *   - "nova"    — professional female, good for campus staff
 *   - "echo"    — calm male, good for students
 *   - "shimmer" — friendly female, good for students
 *   - "ash"     — young male, casual, good for student conversations
 *   - "coral"   — bright female, good for student conversations
 *   - "onyx"    — deep male, authoritative, good for formal announcements
 *   - "sage"    — neutral, measured, good for instructions
 *
 * Pricing: ~$0.60/1M text input tokens + $12/1M audio output tokens
 *   ≈ $0.003-0.005 per short sentence (LCR)
 *   ≈ $0.01-0.02 per announcement/conversation
 */

const https = require("https");
const http = require("http");
const tls = require("tls");
const { URL } = require("url");

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

// ── Voice presets for different TOEFL listening roles ──

const VOICE_PRESETS = {
  // LCR: single-sentence prompts
  lcr_campus_female: {
    voice: "marin",
    instructions: "Speak naturally like a college student in a casual conversation. Use natural rhythm and intonation with slight emphasis on key words. Moderate pace, friendly tone. This is a single spoken sentence in a real campus setting.",
  },
  lcr_campus_male: {
    voice: "cedar",
    instructions: "Speak naturally like a college student having a casual conversation on campus. Relaxed pace, natural pauses, friendly but not overly enthusiastic. This is one sentence from a real everyday interaction.",
  },
  lcr_staff_female: {
    voice: "nova",
    instructions: "Speak as a campus staff member or librarian helping a student. Professional but approachable, clear enunciation, moderate pace. Helpful tone.",
  },
  lcr_staff_male: {
    voice: "cedar",
    instructions: "Speak as a campus administrative staff member or advisor. Professional, clear, patient tone. Moderate pace with natural pauses.",
  },

  // Announcements
  announcement_formal: {
    voice: "onyx",
    instructions: "Speak as someone making an official campus announcement over a PA system. Clear, measured pace, authoritative but not stern. Slight pauses between key information like dates, times, and locations. Project clearly.",
  },
  announcement_classroom: {
    voice: "cedar",
    instructions: "Speak as a professor making a classroom announcement. Conversational but clear, slight emphasis on important details like deadlines and room changes. Natural teaching cadence.",
  },
  announcement_ra: {
    voice: "marin",
    instructions: "Speak as a college resident advisor making a dorm announcement. Friendly, approachable, slightly upbeat. Clear about rules and schedules but not stern.",
  },

  // Conversations — student roles
  student_female: {
    voice: "coral",
    instructions: "Speak as a female college student in a casual conversation. Natural, relaxed pace with conversational fillers and rhythm. Young, friendly energy. Sometimes slightly unsure or asking questions.",
  },
  student_male: {
    voice: "ash",
    instructions: "Speak as a male college student in a casual conversation. Relaxed, natural cadence. Sometimes hesitant, sometimes enthusiastic. Young, informal energy.",
  },

  // Conversations — authority roles
  professor: {
    voice: "cedar",
    instructions: "Speak as a university professor during office hours or after class. Knowledgeable, patient, encouraging. Natural academic speaking style with thoughtful pauses. Slightly slower pace when explaining concepts.",
  },
  librarian: {
    voice: "nova",
    instructions: "Speak as a helpful university librarian. Quiet, professional, informative. Moderate pace, clear pronunciation of titles and locations.",
  },
  advisor: {
    voice: "sage",
    instructions: "Speak as a college academic advisor. Professional, encouraging, clear. Moderate pace. Emphasis on important information like deadlines and requirements.",
  },

  // Academic talks / lectures
  lecture_male: {
    voice: "cedar",
    instructions: "Speak as a university professor giving a short lecture. Engaged, informative speaking style with natural academic cadence. Use discourse markers like 'so', 'now', 'actually' naturally. Vary pace — slower for key concepts, slightly faster for background. Occasional emphasis for important terms. Sound genuinely interested in the topic.",
  },
  lecture_female: {
    voice: "marin",
    instructions: "Speak as a university professor delivering an engaging lecture. Warm, authoritative, intellectually curious tone. Natural pauses for emphasis. Use the rhythm of real academic speech — build up to key points, slow down for definitions, speed up slightly for examples. Sound passionate about the subject.",
  },

  // Fallback generic
  default: {
    voice: "marin",
    instructions: "Speak naturally in clear, standard American English. Moderate pace, friendly tone.",
  },
};

/**
 * Generate speech audio from text.
 *
 * @param {string} text — text to convert to speech
 * @param {object} opts
 * @param {string} [opts.voice="marin"] — voice ID (13 available)
 * @param {string} [opts.model="gpt-4o-mini-tts"] — model ID
 * @param {string} [opts.instructions] — speaking style instructions (gpt-4o-mini-tts only)
 * @param {string} [opts.preset] — use a VOICE_PRESETS key instead of voice+instructions
 * @param {string} [opts.format="mp3"] — output format: mp3, opus, aac, flac, wav, pcm
 * @param {number} [opts.timeoutMs=120000] — timeout
 * @returns {Promise<Buffer>} audio data
 */
async function generateSpeech(text, opts = {}) {
  const {
    preset,
    voice: voiceOverride,
    model = "gpt-4o-mini-tts",
    instructions: instrOverride,
    format = "mp3",
    timeoutMs = 120000,
  } = opts;

  // Resolve voice + instructions from preset or direct params
  let voice, instructions;
  if (preset && VOICE_PRESETS[preset]) {
    voice = voiceOverride || VOICE_PRESETS[preset].voice;
    instructions = instrOverride || VOICE_PRESETS[preset].instructions;
  } else {
    voice = voiceOverride || "marin";
    instructions = instrOverride || VOICE_PRESETS.default.instructions;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const body = JSON.stringify({
    model,
    input: text,
    voice,
    instructions,
    response_format: format,
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
      const proxy = new URL(proxyUrl);
      const target = new URL(OPENAI_TTS_URL);

      const connectReq = http.request({
        host: proxy.hostname,
        port: proxy.port || 1080,
        method: "CONNECT",
        path: `${target.hostname}:443`,
      });

      connectReq.on("connect", (_res, socket) => {
        const tlsSocket = tls.connect({
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
 * Generate multi-voice conversation audio.
 *
 * Each segment can have its own voice and instructions, creating
 * natural-sounding multi-person dialogues.
 *
 * @param {Array<{text: string, voice?: string, preset?: string, instructions?: string}>} segments
 * @param {object} opts — default options for all segments
 * @returns {Promise<Buffer>} concatenated mp3 audio
 */
async function generateConversation(segments, opts = {}) {
  const buffers = [];
  for (const seg of segments) {
    const buf = await generateSpeech(seg.text, {
      ...opts,
      voice: seg.voice,
      preset: seg.preset,
      instructions: seg.instructions,
    });
    buffers.push(buf);
  }
  return Buffer.concat(buffers);
}

/**
 * Estimate cost of TTS generation.
 * gpt-4o-mini-tts: ~$0.60/1M text tokens + $12/1M audio tokens
 * Rough estimate: ~$0.003-0.005 per short sentence
 *
 * @param {string} text
 * @returns {{ chars: number, estimatedCost: number }}
 */
function estimateCost(text) {
  const chars = text.length;
  // Rough: 1 token ≈ 4 chars for text, audio tokens ≈ 2x text tokens
  const textTokens = chars / 4;
  const audioTokens = textTokens * 2;
  const cost = (textTokens * 0.60 / 1_000_000) + (audioTokens * 12 / 1_000_000);
  return { chars, estimatedCost: Math.round(cost * 10000) / 10000 };
}

module.exports = { generateSpeech, generateConversation, estimateCost, VOICE_PRESETS };
