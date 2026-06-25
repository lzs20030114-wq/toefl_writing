const { parseWav, buildWav, concatWavSegments, splitSentences } = require("../lib/tts/wavTools");

function makeWav(samples, sampleRate = 24000) {
  return buildWav(Int16Array.from(samples), sampleRate, 1);
}

describe("wavTools", () => {
  test("buildWav -> parseWav roundtrips samples + rate", () => {
    const samples = [0, 1000, -1000, 32767, -32767, 50];
    const { pcm, sampleRate, channels } = parseWav(makeWav(samples, 24000));
    expect(sampleRate).toBe(24000);
    expect(channels).toBe(1);
    expect(Array.from(pcm)).toEqual(samples);
  });

  test("concatWavSegments length = sum of segments + gaps", () => {
    const a = makeWav([100, 200, 300, 400]); // 4 samples
    const b = makeWav([500, 600]); // 2 samples
    const gapMs = 100;
    const gapSamples = Math.round((24000 * gapMs) / 1000); // 2400
    const out = parseWav(concatWavSegments([a, b], { gapMs }));
    expect(out.pcm.length).toBe(4 + gapSamples + 2);
  });

  test("concatWavSegments throws on no segments", () => {
    expect(() => concatWavSegments([])).toThrow();
  });

  test("splitSentences splits on . ? ! and keeps terminators", () => {
    expect(splitSentences("Are you free? I need to plan. Okay!")).toEqual([
      "Are you free?",
      "I need to plan.",
      "Okay!",
    ]);
  });

  test("splitSentences returns the whole string when there is no terminator", () => {
    expect(splitSentences("no punctuation here")).toEqual(["no punctuation here"]);
  });
});
