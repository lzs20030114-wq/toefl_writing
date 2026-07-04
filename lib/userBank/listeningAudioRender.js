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
};
