const { parseWav, buildWav, concatWavSegments, concatWavSegmentsTimed, splitSentences } = require("../lib/tts/wavTools");

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

  // 句级时间戳的地基：拼接时每段落在输出里的秒数必须是精确的采样数换算，间隙不算进句内。
  test("concatWavSegmentsTimed reports each segment's start/end in seconds, gaps excluded", () => {
    const a = makeWav(new Array(2400).fill(100)); // 0.1s
    const b = makeWav(new Array(4800).fill(100)); // 0.2s
    const c = makeWav(new Array(1200).fill(100)); // 0.05s
    const { wav, sampleRate, channels, segments } = concatWavSegmentsTimed([a, b, c], { gapMs: 120 });
    expect(sampleRate).toBe(24000);
    expect(channels).toBe(1);
    expect(segments).toEqual([
      { start: 0, end: 0.1 },
      { start: 0.22, end: 0.42 }, // 0.1 + 0.12 gap
      { start: 0.54, end: 0.59 }, // 0.42 + 0.12 gap
    ]);
    // Total length = last end (no trailing gap).
    expect(parseWav(wav).pcm.length).toBe(Math.round(0.59 * 24000));
  });

  test("concatWavSegmentsTimed: gapMs 0 makes segments back-to-back; a single segment starts at 0", () => {
    const a = makeWav(new Array(240).fill(5));
    const b = makeWav(new Array(240).fill(5));
    expect(concatWavSegmentsTimed([a, b], { gapMs: 0 }).segments).toEqual([
      { start: 0, end: 0.01 },
      { start: 0.01, end: 0.02 },
    ]);
    expect(concatWavSegmentsTimed([a]).segments).toEqual([{ start: 0, end: 0.01 }]);
  });

  test("concatWavSegments is byte-identical to concatWavSegmentsTimed().wav", () => {
    const a = makeWav([100, 200, 300, 400]);
    const b = makeWav([500, 600]);
    const plain = concatWavSegments([a, b], { gapMs: 100 });
    const timed = concatWavSegmentsTimed([a, b], { gapMs: 100 }).wav;
    expect(Buffer.compare(plain, timed)).toBe(0);
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

  // 2026-09-07 线上反馈：LC「leave at seven a.m.」被切成 "seven a." + "m." 两次 TTS，中间停顿。
  // 缩写/小数/网址里的句号不是句界。
  test("splitSentences keeps a.m./p.m. together and only splits after them before a capital", () => {
    expect(splitSentences("Just be ready to leave at seven a.m.")).toEqual(["Just be ready to leave at seven a.m."]);
    expect(splitSentences("The shuttle runs from 7 a.m. to 9 p.m. daily.")).toEqual(["The shuttle runs from 7 a.m. to 9 p.m. daily."]);
    expect(splitSentences("Be there by 7 a.m. Please don't be late.")).toEqual(["Be there by 7 a.m.", "Please don't be late."]);
    expect(splitSentences("Doors open at 10:30 A.M. sharp.")).toEqual(["Doors open at 10:30 A.M. sharp."]);
  });

  test("splitSentences never splits after titles, e.g./i.e., initials, U.S.", () => {
    expect(splitSentences("Dr. Lee said the U.S. team arrives at 3 p.m. tomorrow.")).toEqual([
      "Dr. Lee said the U.S. team arrives at 3 p.m. tomorrow.",
    ]);
    expect(splitSentences("Our meeting, e.g. the one on Friday, moved. Mr. J. Smith agreed.")).toEqual([
      "Our meeting, e.g. the one on Friday, moved.",
      "Mr. J. Smith agreed.",
    ]);
  });

  test("splitSentences keeps decimals, times and URLs intact", () => {
    expect(splitSentences("It cost $4.50 on www.example.com yesterday. Version 2.1 is out!")).toEqual([
      "It cost $4.50 on www.example.com yesterday.",
      "Version 2.1 is out!",
    ]);
  });

  test("splitSentences keeps a closing quote with the sentence it closes", () => {
    expect(splitSentences('She said, "No way." Then she left.')).toEqual(['She said, "No way."', "Then she left."]);
  });
});
