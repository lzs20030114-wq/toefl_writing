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

// ── 句级时间戳（docs/listening-sentence-timings.md）────────────────────────
// *Timed 渲染：注入的 synth 返回 { buffer, words }；各段 mp3 按帧时长平移词时刻再与句子对齐。
// 这里的 mp3 是 lamejs 真编码的静音（帧数真实），词时刻是按词数造的。
const { renderSpokenAudioTimed, renderConversationAudioTimed } = require("../lib/userBank/listeningAudioRender");
const { encodeWavToMp3 } = require("../lib/tts/mp3Encode");
const { buildWav } = require("../lib/tts/wavTools");
const { mp3DurationSec } = require("../lib/tts/mp3Frames");

async function silentMp3(sec) {
  return encodeWavToMp3(buildWav(new Int16Array(Math.round(24000 * sec)), 24000, 1));
}
// 假词时刻（相对该段开头）：第 i 个词 [lead + i*step, lead + i*step + dur]
function fakeWords(text, { lead = 0.05, step = 0.25, dur = 0.2 } = {}) {
  return String(text).split(/\s+/).filter(Boolean).map((w, i) => ({ text: w, start: lead + i * step, end: lead + i * step + dur }));
}

describe("renderSpokenAudioTimed / renderConversationAudioTimed —— 句级时间戳", () => {
  test("非分段：句子起止来自该次合成的词时刻", async () => {
    const text = "Hello there, students. The pool reopens Monday!";
    const synth = async (t) => ({ buffer: await silentMp3(0.8), words: fakeWords(t) });
    const { buffer, sentences } = await renderSpokenAudioTimed(text, synth, { segmented: false });
    expect(mp3DurationSec(buffer)).toBeGreaterThan(0.7);
    expect(sentences.map((s) => s.text)).toEqual(["Hello there, students.", "The pool reopens Monday!"]);
    expect(sentences[0]).toMatchObject({ start: 0.05, end: 0.75 });      // 3 词：0.05 → 0.05+2*0.25+0.2
    expect(sentences[1]).toMatchObject({ start: 0.8, end: 1.75 });       // 第 4~7 词：0.05+3*0.25 → 0.05+6*0.25+0.2
  });

  test("分段（lat）：第二段的句子按第一段 mp3 的帧时长平移", async () => {
    const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} has several words in it here.`).join(" ");
    const segs = segmentSpokenText(long);
    expect(segs.length).toBeGreaterThan(1);
    const bufs = [];
    // 每段约 100 个词要落在 1.0s 的片段里：词步 8ms
    const synth = async (t) => { const buffer = await silentMp3(1.0); bufs.push(buffer); return { buffer, words: fakeWords(t, { lead: 0.005, step: 0.008, dur: 0.006 }) }; };
    const { buffer, sentences } = await renderSpokenAudioTimed(long, synth, { segmented: true });
    expect(buffer.length).toBe(bufs.reduce((n, b) => n + b.length, 0));
    expect(sentences).toHaveLength(30);
    const firstSegSentences = segs[0].match(/[^.!?]+[.!?]+/g).length;
    const seg1 = mp3DurationSec(bufs[0]);
    expect(sentences[firstSegSentences - 1].end).toBeLessThan(seg1);          // 第一段最后一句在第一段里
    expect(sentences[firstSegSentences].start).toBeCloseTo(seg1 + 0.005, 3);  // 第二段第一句 = 平移量 + 首词
    // 单调不重叠
    for (let i = 1; i < sentences.length; i++) expect(sentences[i].start).toBeGreaterThanOrEqual(sentences[i - 1].end);
  });

  test("对话：逐轮平移，每句带 turn / speaker；旧接口 renderConversationAudio 仍只返回 Buffer", async () => {
    const conv = [
      { speaker: "Woman", text: "Hi there. Quick question?" },
      { speaker: "Man", text: "Sure, go ahead." },
    ];
    const speakers = [{ name: "Woman", gender: "female", role: "student" }, { name: "Man", gender: "male", role: "staff" }];
    const bufs = [];
    const synth = async (t) => { const buffer = await silentMp3(0.9); bufs.push(buffer); return { buffer, words: fakeWords(t) }; };
    const { buffer, sentences } = await renderConversationAudioTimed(conv, speakers, synth);
    expect(buffer.length).toBe(bufs[0].length + bufs[1].length);
    expect(sentences.map((s) => [s.turn, s.speaker, s.text])).toEqual([
      [0, "Woman", "Hi there."], [0, "Woman", "Quick question?"], [1, "Man", "Sure, go ahead."],
    ]);
    expect(sentences[2].start).toBeCloseTo(mp3DurationSec(bufs[0]) + 0.05, 3);

    const plain = await renderConversationAudio(conv, speakers, async () => Buffer.from("x"));
    expect(Buffer.isBuffer(plain)).toBe(true);
  });

  test("合成没报词（或对不上）→ sentences 为 null，音频照常", async () => {
    const synth = async () => ({ buffer: await silentMp3(0.5), words: [] });
    const { buffer, sentences } = await renderSpokenAudioTimed("Hello there. Bye now.", synth, { segmented: false });
    expect(buffer.length).toBeGreaterThan(0);
    expect(sentences).toBeNull();
    const garbled = async (t) => ({ buffer: await silentMp3(0.5), words: fakeWords(t).map((w) => ({ ...w, text: "zzz" })) });
    expect((await renderSpokenAudioTimed("Hello there. Bye now.", garbled, { segmented: false })).sentences).toBeNull();
  });

  test("旧接口 renderSpokenAudio 的错误语义不变（空 buffer 抛「empty audio」/「empty segment audio」）", async () => {
    await expect(renderSpokenAudio("hello", async () => Buffer.alloc(0), { segmented: false })).rejects.toThrow("empty audio");
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} has several words in it here.`).join(" ");
    await expect(renderSpokenAudio(long, async () => Buffer.alloc(0), { segmented: true })).rejects.toThrow("empty segment audio");
  });
});
