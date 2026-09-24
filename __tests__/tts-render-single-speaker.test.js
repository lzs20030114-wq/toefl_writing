const {
  renderSingleSpeaker, renderSingleSpeakerTimed, renderConversation, renderConversationTimed,
  singleSpeakerText, instructionsForSentence, INTRA_TURN_GAP_MS, INTER_TURN_GAP_MS,
} = require("../lib/tts/renderListening");
const { buildWav, parseWav } = require("../lib/tts/wavTools");
const { TEMPERAMENT_BASELINE, PACE_CLAUSE, QUESTION_RISE_CLAUSE } = require("../lib/tts/toneDirector");
const { ALL_SAFE_VOICES } = require("../lib/tts/openaiTts");

// A minimal valid WAV so the concat/parse machinery has something real to stitch.
function tinyWav() {
  const pcm = new Int16Array(2400); // 0.1s @ 24kHz
  for (let i = 0; i < pcm.length; i++) pcm[i] = 1200;
  return buildWav(pcm, 24000, 1);
}

// The persona TTS call is injected (opts.generate) so nothing hits the network.
function spyGenerate() {
  const calls = [];
  const fn = async (text, o) => { calls.push({ text, voice: o.voice, instructions: o.instructions }); return tinyWav(); };
  return { fn, calls };
}

describe("singleSpeakerText — per-type text source", () => {
  test("lat=transcript, la=announcement, lcr=speaker", () => {
    expect(singleSpeakerText({ transcript: "T" }, "lat")).toBe("T");
    expect(singleSpeakerText({ announcement: "A" }, "la")).toBe("A");
    expect(singleSpeakerText({ speaker: "S" }, "lcr")).toBe("S");
  });
});

describe("renderSingleSpeaker — assembly", () => {
  test("one TTS call PER sentence, in order", async () => {
    const { fn, calls } = spyGenerate();
    const item = { id: "lat_x_2", transcript: "First sentence. Second one! A third?" };
    await renderSingleSpeaker(item, "lat", { generate: fn });
    expect(calls.map((c) => c.text)).toEqual(["First sentence.", "Second one!", "A third?"]);
  });

  test("persona-only instructions are passed to every call (lat → engaged-measured)", async () => {
    const { fn, calls } = spyGenerate();
    await renderSingleSpeaker({ id: "lat_x_2", transcript: "One. Two." }, "lat", { generate: fn });
    const expected = `${TEMPERAMENT_BASELINE["engaged-measured"]} ${PACE_CLAUSE}`;
    for (const c of calls) {
      expect(c.instructions).toBe(expected);
      expect(c.instructions.endsWith(PACE_CLAUSE)).toBe(true);
      expect(ALL_SAFE_VOICES).toContain(c.voice); // gender-locked safe voice
    }
    // A single speaker uses ONE voice for the whole monologue.
    expect(new Set(calls.map((c) => c.voice)).size).toBe(1);
  });

  test("output is a parseable, non-empty WAV", async () => {
    const { fn } = spyGenerate();
    const buf = await renderSingleSpeaker({ id: "la_1", announcement: "Hello students. Please note." }, "la", { generate: fn });
    const { pcm, sampleRate, channels } = parseWav(buf);
    expect(pcm.length).toBeGreaterThan(0);
    expect(sampleRate).toBe(24000);
    expect(channels).toBe(1);
  });

  test("empty text throws (caller/generateTTS catches and skips)", async () => {
    const { fn } = spyGenerate();
    await expect(renderSingleSpeaker({ id: "lcr_1", speaker: "   " }, "lcr", { generate: fn })).rejects.toThrow(/no lcr text/);
  });

  test("deriveSpeakerMeta gender is stable → same voice on re-render of same id", async () => {
    const a = spyGenerate(), b = spyGenerate();
    await renderSingleSpeaker({ id: "lcr_stable_7", speaker: "Sure." }, "lcr", { generate: a.fn });
    await renderSingleSpeaker({ id: "lcr_stable_7", speaker: "Sure." }, "lcr", { generate: b.fn });
    expect(a.calls[0].voice).toBe(b.calls[0].voice);
  });
});

describe("instructionsForSentence — question-rise classification (2026-07-18)", () => {
  const base = "BASE_INSTR";
  const withRise = `${base} ${QUESTION_RISE_CLAUSE}`;

  test("yes/no question gets the rise clause", () => {
    expect(instructionsForSentence(base, "Did the schedule change?")).toBe(withRise);
  });

  test("wh-question does NOT get the clause (wh falls in English)", () => {
    expect(instructionsForSentence(base, "What changed?")).toBe(base);
  });

  test("wh-question behind a discourse marker still counts as wh (no clause)", () => {
    expect(instructionsForSentence(base, "So what changed?")).toBe(base);
  });

  test("short elliptical / tag questions get the clause", () => {
    expect(instructionsForSentence(base, "Oh yeah?")).toBe(withRise);
    expect(instructionsForSentence(base, "Any downsides I should know about?")).toBe(withRise);
  });

  test("statements are left on the plain persona instructions", () => {
    expect(instructionsForSentence(base, "The library closes at ten.")).toBe(base);
    expect(instructionsForSentence(base, "Please note the new hours.")).toBe(base);
  });
});

describe("renderSingleSpeaker — question rise wired per sentence", () => {
  test("appends the rise clause only to non-wh question sentences", async () => {
    const { fn, calls } = spyGenerate();
    await renderSingleSpeaker(
      { id: "la_q", announcement: "The pool reopens Monday. Any questions? What time, you ask?" },
      "la",
      { generate: fn }
    );
    const byText = Object.fromEntries(calls.map((c) => [c.text, c.instructions]));
    expect(byText["The pool reopens Monday."].includes(QUESTION_RISE_CLAUSE)).toBe(false);
    expect(byText["Any questions?"].includes(QUESTION_RISE_CLAUSE)).toBe(true);
    expect(byText["What time, you ask?"].includes(QUESTION_RISE_CLAUSE)).toBe(false); // wh-question
  });
});

describe("renderConversation — type param default preserves lc behavior", () => {
  const item = {
    id: "lc_x",
    speakers: [
      { name: "Woman", gender: "female", role: "student" },
      { name: "Man", gender: "male", role: "advising_staff" },
    ],
    conversation: [
      { speaker: "Woman", text: "Hi, quick question." },
      { speaker: "Man", text: "Sure. Go ahead." },
    ],
  };

  test("defaults to lc when no type passed; produces a parseable WAV", async () => {
    const { fn } = spyGenerate();
    const buf = await renderConversation(item, { generate: fn });
    expect(parseWav(buf).pcm.length).toBeGreaterThan(0);
  });

  test("explicit opts.type='lc' behaves the same", async () => {
    const a = spyGenerate(), b = spyGenerate();
    await renderConversation(item, { generate: a.fn });
    await renderConversation(item, { generate: b.fn, type: "lc" });
    expect(a.calls.map((c) => c.text)).toEqual(b.calls.map((c) => c.text));
  });
});

/**
 * 句级时间戳（docs/listening-sentence-timings.md）：一句一次 TTS，拼接时就知道每句的起止，
 * *Timed 渲染把它随 WAV 一起交出来。这里的 tinyWav 每句恰好 0.1s，所以数值可以手算钉死。
 */
describe("renderSingleSpeakerTimed — sentence timings ride along with the WAV", () => {
  test("one entry per sentence, text == what was sent to TTS, start/end from the 0.1s clips + 120ms gaps", async () => {
    const { fn, calls } = spyGenerate();
    const item = { id: "lat_t_1", transcript: "First sentence. Second one! A third?" };
    const { wav, sentences } = await renderSingleSpeakerTimed(item, "lat", { generate: fn });
    expect(parseWav(wav).pcm.length).toBeGreaterThan(0);
    expect(INTRA_TURN_GAP_MS).toBe(120);
    expect(sentences).toEqual([
      { text: "First sentence.", start: 0, end: 0.1 },
      { text: "Second one!", start: 0.22, end: 0.32 },
      { text: "A third?", start: 0.44, end: 0.54 },
    ]);
    expect(sentences.map((s) => s.text)).toEqual(calls.map((c) => c.text));
  });

  test("the WAV is the same bytes renderSingleSpeaker returns (legacy callers unchanged)", async () => {
    const item = { id: "la_t_2", announcement: "Hello students. Please note." };
    const plain = await renderSingleSpeaker(item, "la", { generate: spyGenerate().fn });
    const { wav } = await renderSingleSpeakerTimed(item, "la", { generate: spyGenerate().fn });
    expect(Buffer.compare(plain, wav)).toBe(0);
  });

  test("timings are rounded to milliseconds", async () => {
    // 7 samples @ 24kHz = 0.000291666… s — must come back as 0 (3 decimals), not a float tail.
    const odd = async () => buildWav(Int16Array.from(new Array(7).fill(900)), 24000, 1);
    const { sentences } = await renderSingleSpeakerTimed({ id: "lcr_t_3", speaker: "Sure. Fine." }, "lcr", { generate: odd });
    for (const s of sentences) {
      expect(Number.isInteger(s.start * 1000)).toBe(true);
      expect(Number.isInteger(s.end * 1000)).toBe(true);
    }
  });
});

describe("renderConversationTimed — per-turn offsets + inter-turn gap folded into absolute seconds", () => {
  const item = {
    id: "lc_t",
    speakers: [
      { name: "Woman", gender: "female", role: "student" },
      { name: "Man", gender: "male", role: "advising_staff" },
    ],
    conversation: [
      { speaker: "Woman", text: "Hi, quick question. Are you free?" },
      { speaker: "Man", text: "Sure." },
    ],
  };

  test("turn index + speaker on every entry; second turn starts after turn one plus the 280ms gap", async () => {
    const { fn } = spyGenerate();
    const { sentences } = await renderConversationTimed(item, { generate: fn });
    expect(INTER_TURN_GAP_MS).toBe(280);
    // Turn 0: two 0.1s sentences with a 120ms gap → ends at 0.32; turn 1 starts at 0.32 + 0.28 = 0.6.
    expect(sentences).toEqual([
      { turn: 0, speaker: "Woman", text: "Hi, quick question.", start: 0, end: 0.1 },
      { turn: 0, speaker: "Woman", text: "Are you free?", start: 0.22, end: 0.32 },
      { turn: 1, speaker: "Man", text: "Sure.", start: 0.6, end: 0.7 },
    ]);
  });

  test("the WAV is the same bytes renderConversation returns", async () => {
    const plain = await renderConversation(item, { generate: spyGenerate().fn });
    const { wav } = await renderConversationTimed(item, { generate: spyGenerate().fn });
    expect(Buffer.compare(plain, wav)).toBe(0);
    // Last sentence ends exactly where the clip ends (no trailing gap).
    const { sentences } = await renderConversationTimed(item, { generate: spyGenerate().fn });
    expect(sentences[sentences.length - 1].end).toBeCloseTo(parseWav(wav).pcm.length / 24000, 3);
  });
});
