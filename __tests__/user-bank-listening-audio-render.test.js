const {
  segmentSpokenText,
  renderSpokenAudio,
  isSegmentedType,
  SEGMENT_MAX_CHARS,
} = require("../lib/userBank/listeningAudioRender");

// Pure segmentation + mp3-concat helpers for /api/user-bank/render-audio. LAT lectures render as
// multiple ~600-char edge-tts synths then byte-concat (研究 附录 C, LAT §5「长文本 TTS 分段」);
// lcr/la render as one call. edge-tts is injected (mock) so no network/WS.
describe("segmentSpokenText", () => {
  test("empty / whitespace → []", () => {
    expect(segmentSpokenText("")).toEqual([]);
    expect(segmentSpokenText("   ")).toEqual([]);
  });

  test("short text → single segment (whole text)", () => {
    const segs = segmentSpokenText("Hello there. How are you?");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toBe("Hello there. How are you?");
  });

  test("long text splits into multiple ≤maxChars segments on sentence boundaries", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} has several words in it here.`).join(" ");
    const segs = segmentSpokenText(long, 200);
    expect(segs.length).toBeGreaterThan(1);
    expect(segs.every((s) => s.length <= 200)).toBe(true);
    // Concatenated segments cover every sentence (no content dropped).
    expect(segs.join(" ").replace(/\s+/g, " ")).toContain("Sentence number 39");
  });

  test("a run-on sentence longer than the cap is split on word boundaries (never mid-word)", () => {
    const runOn = Array.from({ length: 80 }, () => "word").join(" "); // no sentence punctuation
    const segs = segmentSpokenText(runOn, 50);
    expect(segs.length).toBeGreaterThan(1);
    expect(segs.every((s) => s.length <= 50)).toBe(true);
    // No fragment word — every token is the intact "word".
    expect(segs.every((s) => s.split(/\s+/).every((w) => w === "word"))).toBe(true);
  });

  test("default cap is SEGMENT_MAX_CHARS", () => {
    expect(SEGMENT_MAX_CHARS).toBe(600);
  });
});

describe("isSegmentedType", () => {
  test("lat is segmented; lcr/la/others are not", () => {
    expect(isSegmentedType("lat")).toBe(true);
    expect(isSegmentedType("LAT")).toBe(true);
    expect(isSegmentedType("lcr")).toBe(false);
    expect(isSegmentedType("la")).toBe(false);
    expect(isSegmentedType("")).toBe(false);
  });
});

describe("renderSpokenAudio (edge-tts injected)", () => {
  test("non-segmented → exactly one synth call, returns its buffer", async () => {
    const calls = [];
    const synth = async (t) => { calls.push(t); return Buffer.from("MP3-" + t); };
    const buf = await renderSpokenAudio("hello world", synth, { segmented: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("hello world");
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  test("segmented (lat) → one synth call PER segment, Buffer.concat of the mp3 frames", async () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} has several words in it here.`).join(" ");
    const expectedSegs = segmentSpokenText(long);
    const calls = [];
    // each frame's byte length equals its text length so we can assert the concat is ordered.
    const synth = async (t) => { calls.push(t); return Buffer.from(t); };
    const buf = await renderSpokenAudio(long, synth, { segmented: true });

    expect(calls.length).toBeGreaterThan(1);
    expect(calls).toEqual(expectedSegs);                          // one call per segment, in order
    expect(buf.length).toBe(expectedSegs.reduce((n, s) => n + Buffer.from(s).length, 0)); // concat length
    expect(buf.toString()).toBe(expectedSegs.join(""));           // frames concatenated in order
  });

  test("segment failure throws (caller fail-opens to browser TTS)", async () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} has several words in it here.`).join(" ");
    let n = 0;
    const synth = async () => { n += 1; if (n === 2) throw new Error("ws drop"); return Buffer.from("x"); };
    await expect(renderSpokenAudio(long, synth, { segmented: true })).rejects.toThrow("ws drop");
  });

  test("empty segment buffer throws (best-effort guard)", async () => {
    const synth = async () => Buffer.alloc(0);
    await expect(renderSpokenAudio("hello world", synth, { segmented: false })).rejects.toThrow();
  });
});
