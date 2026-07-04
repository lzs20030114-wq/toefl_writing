const {
  segmentSpokenText,
  renderSpokenAudio,
  isSegmentedType,
  SEGMENT_MAX_CHARS,
  voicePresetForSpeaker,
  pickConversationVoices,
  renderConversationAudio,
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

// LC (听对话) multi-voice conversation render. Mapping is COPIED from generate-lc.mjs pickVoicePresets
// into this pure module (禁止改 script 本体); the two speakers must always get DISTINCT presets
// (single voice would make换人听不出来 — 拍板口径). Each turn is synthesized with ITS speaker's preset.
describe("pickConversationVoices (copied generate-lc mapping)", () => {
  test("female student + male staff → two DIFFERENT presets", () => {
    const v = pickConversationVoices([
      { name: "Woman", role: "student", gender: "female" },
      { name: "Man", role: "advising_staff", gender: "male" },
    ]);
    expect(v).toHaveLength(2);
    expect(v[0].name).toBe("Woman");
    expect(v[1].name).toBe("Man");
    expect(v[0].preset).not.toBe(v[1].preset);
  });

  test("same-gender speakers are FORCED to distinct presets (换人听得出来)", () => {
    const v = pickConversationVoices([
      { name: "Woman", gender: "female" },
      { name: "Woman2", gender: "female" },
    ]);
    expect(v[0].preset).not.toBe(v[1].preset);
  });

  test("staff role maps by gender; students map by gender", () => {
    expect(voicePresetForSpeaker({ role: "librarian", gender: "female" })).toBe("librarian");
    expect(voicePresetForSpeaker({ role: "advisor", gender: "male" })).toBe("advisor");
    expect(voicePresetForSpeaker({ role: "student", gender: "male" })).toBe("student_male");
    expect(voicePresetForSpeaker({ role: "student", gender: "female" })).toBe("student_female");
  });

  test("malformed speakers (not 2) → two distinct default presets", () => {
    const v = pickConversationVoices([{ name: "Solo", gender: "female" }]);
    expect(v[0].preset).not.toBe(v[1].preset);
  });
});

describe("renderConversationAudio (edge-tts injected, multi-voice)", () => {
  const speakers = [
    { name: "Woman", role: "student", gender: "female" },
    { name: "Man", role: "advising_staff", gender: "male" },
  ];
  const conversation = [
    { speaker: "Woman", text: "Hi, I have a question about my elective." },
    { speaker: "Man", text: "Sure, go ahead." },
    { speaker: "Woman", text: "Is Public Speaking still open?" },
    { speaker: "Man", text: "Yes, a few seats remain." },
  ];

  test("one synth call PER turn, each with its speaker's preset, mp3 frames concatenated in order", async () => {
    const calls = [];
    const synth = async (text, preset) => { calls.push({ text, preset }); return Buffer.from(preset + "|"); };
    const buf = await renderConversationAudio(conversation, speakers, synth);

    expect(calls).toHaveLength(4);                                   // one per turn
    expect(calls.map((c) => c.text)).toEqual(conversation.map((t) => t.text)); // in order
    // Woman turns and Man turns use DIFFERENT presets (two distinct voices).
    const womanPreset = calls[0].preset;
    const manPreset = calls[1].preset;
    expect(womanPreset).not.toBe(manPreset);
    expect(calls[2].preset).toBe(womanPreset); // 3rd turn = Woman again → same voice
    expect(calls[3].preset).toBe(manPreset);   // 4th turn = Man again → same voice
    expect(buf.toString()).toBe(calls.map((c) => c.preset + "|").join(""));
  });

  test("a turn whose speaker isn't in the roster falls back to the first speaker's preset (never throws)", async () => {
    const calls = [];
    const synth = async (text, preset) => { calls.push(preset); return Buffer.from("x"); };
    const conv = [...conversation.slice(0, 3), { speaker: "Ghost", text: "stray turn" }];
    await renderConversationAudio(conv, speakers, synth);
    expect(calls).toHaveLength(4);
    expect(calls[3]).toBe(calls[0]); // fallback = first speaker's (Woman) preset
  });

  test("empty conversation throws (caller fail-opens to browser TTS)", async () => {
    const synth = async () => Buffer.from("x");
    await expect(renderConversationAudio([], speakers, synth)).rejects.toThrow();
  });

  test("a turn's empty synth buffer throws (best-effort guard)", async () => {
    const synth = async () => Buffer.alloc(0);
    await expect(renderConversationAudio(conversation, speakers, synth)).rejects.toThrow();
  });
});
