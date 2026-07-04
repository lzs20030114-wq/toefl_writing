// Pure helpers for personal-bank listening audio RENDERING (used by /api/user-bank/render-audio;
// unit-tested). Kept dependency-free (edge-tts is injected) so the segmentation + mp3-concat logic
// can be tested without a network/WS call.
//
// 口径 (2026-07-04 研究 附录 C, LAT §5「长文本 TTS 分段」):
//   * LCR/LA render as ONE synth call (short单段).
//   * LAT transcripts run 250-800 words; a single edge-tts synth of a long稿 can truncate
//     (Microsoft 端点对超长文本偶发截断). So LAT is split into ≤SEGMENT_MAX_CHARS chunks on
//     sentence boundaries, each synthesized串行, then the mp3 frames are byte-concatenated
//     (edge mp3 concatenation is exactly what edgeTts.generateConversation does).
//   * best-effort: any segment failure throws → caller softFails to browser TTS.

const SEGMENT_MAX_CHARS = 600; // ~90-110 words/segment — safely under edge-tts truncation risk
const SEGMENTED_TYPES = new Set(["lat"]); // types that render segmented; others = single call

function isSegmentedType(type) {
  return SEGMENTED_TYPES.has(String(type || "").toLowerCase());
}

// ── LC (听对话) multi-voice mapping ──
// Two speakers, each a distinct edge-tts preset chosen by role+gender. This mirrors
// scripts/generate-lc.mjs pickVoicePresets (the主库 LC render), COPIED (not imported) into this
// pure/unit-tested module because generate-lc.mjs is a frozen ESM script (禁止修改本体). Keeping the
// mapping here lets /api/user-bank/render-audio assign the same voices without touching the script.
// Presets reference edgeTts.js EDGE_VOICE_PRESETS keys.
function voicePresetForSpeaker(sp) {
  const role = String((sp && sp.role) || "").toLowerCase();
  const gender = String((sp && sp.gender) || "").toLowerCase();
  // Staff roles (map to distinct staff voices by gender).
  if (role.includes("library") || role === "librarian") return "librarian";
  if (role.includes("advisor") || role.includes("counselor")) return "advisor";
  if (role.includes("staff") || role.includes("assistant") || role.includes("clerk") || role.includes("receptionist")) {
    return gender === "female" ? "librarian" : "advisor";
  }
  // Student / default roles by gender.
  if (gender === "male") return "student_male";
  if (gender === "female") return "student_female";
  return "student_female";
}

// Return [{ name, preset }, { name, preset }] for the two speakers, guaranteeing the two presets
// are DIFFERENT (single-voice would make the conversation indistinguishable — 拍板口径). Falls back
// to two distinct defaults when speakers are malformed.
function pickConversationVoices(speakers) {
  const list = Array.isArray(speakers) ? speakers : [];
  if (list.length !== 2) {
    return [{ name: list[0] && list[0].name, preset: "student_female" }, { name: list[1] && list[1].name, preset: "student_male" }];
  }
  const v1 = voicePresetForSpeaker(list[0]);
  let v2 = voicePresetForSpeaker(list[1]);
  if (v1 === v2) {
    // Force a different voice for speaker 2 so换人听得出来.
    v2 = v1 === "student_female" ? "student_male" : "student_female";
  }
  return [
    { name: list[0].name, preset: v1 },
    { name: list[1].name, preset: v2 },
  ];
}

// Render a two-speaker conversation to an mp3 Buffer. `synth(text, preset) => Promise<Buffer>` is
// injected (edge-tts in prod). Each turn is synthesized串行 with ITS speaker's preset, then the mp3
// frames are byte-concatenated (same trick as generateConversation / the LAT segment concat). A turn
// whose speaker isn't in the map falls back to the first speaker's preset. Any synth failure / empty
// buffer throws → caller softFails to browser TTS (兜底文本已含说话人前缀).
async function renderConversationAudio(conversation, speakers, synth) {
  const turns = Array.isArray(conversation) ? conversation.filter((t) => t && String(t.text || "").trim()) : [];
  if (turns.length === 0) throw new Error("no conversation turns to render");
  const voices = pickConversationVoices(speakers);
  const presetByName = new Map(voices.map((v) => [v.name, v.preset]));
  const fallbackPreset = voices[0].preset;
  const buffers = [];
  for (const turn of turns) {
    const preset = presetByName.get(turn.speaker) || fallbackPreset;
    const buf = await synth(String(turn.text).trim(), preset);
    if (!buf || !buf.length) throw new Error("empty turn audio");
    buffers.push(buf);
  }
  return Buffer.concat(buffers);
}

// Split long spoken text into ≤maxChars chunks on sentence boundaries (fall back to word
// boundaries for a run-on sentence longer than the cap). Never splits mid-word. Returns [] for
// empty text, else always ≥1 segment.
function segmentSpokenText(text, maxChars = SEGMENT_MAX_CHARS) {
  const whole = String(text || "").trim();
  if (!whole) return [];
  const sentences = whole.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [];
  const segments = [];
  let cur = "";
  const flush = () => { if (cur.trim()) segments.push(cur.trim()); cur = ""; };
  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    if (piece.length > maxChars) {
      // A single over-long sentence: pack its words into cap-sized chunks.
      flush();
      let wordChunk = "";
      for (const w of piece.split(/\s+/)) {
        if ((wordChunk + " " + w).trim().length > maxChars && wordChunk) {
          segments.push(wordChunk.trim());
          wordChunk = w;
        } else {
          wordChunk = (wordChunk + " " + w).trim();
        }
      }
      if (wordChunk.trim()) segments.push(wordChunk.trim());
      continue;
    }
    if ((cur + " " + piece).trim().length > maxChars && cur) flush();
    cur = (cur + " " + piece).trim();
  }
  flush();
  return segments.length > 0 ? segments : [whole];
}

// Render `text` to an mp3 Buffer. `synth(text) => Promise<Buffer>` is injected (edge-tts in prod).
//   segmented=false → one synth call.
//   segmented=true  → synth each ≤600-char segment串行, byte-concat the mp3 frames.
// Any synth failure / empty segment buffer throws → caller softFails to browser TTS.
async function renderSpokenAudio(text, synth, { segmented = false } = {}) {
  if (!segmented) {
    const buf = await synth(String(text || ""));
    if (!buf || !buf.length) throw new Error("empty audio");
    return buf;
  }
  const segments = segmentSpokenText(text);
  if (segments.length === 0) throw new Error("no segments to render");
  const buffers = [];
  for (const seg of segments) {
    const buf = await synth(seg);
    if (!buf || !buf.length) throw new Error("empty segment audio");
    buffers.push(buf);
  }
  return Buffer.concat(buffers);
}

module.exports = {
  SEGMENT_MAX_CHARS,
  SEGMENTED_TYPES,
  isSegmentedType,
  segmentSpokenText,
  renderSpokenAudio,
  voicePresetForSpeaker,
  pickConversationVoices,
  renderConversationAudio,
};
