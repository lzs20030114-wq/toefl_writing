const { encodeWavToMp3, LAME_SAMPLE_RATES } = require("../lib/tts/mp3Encode");
const { buildWav } = require("../lib/tts/wavTools");

// A 1s 440Hz sine at 24kHz mono — the shape gpt-4o-mini-tts emits for response_format:"wav".
function sineWav(sampleRate = 24000, seconds = 1) {
  const N = Math.round(sampleRate * seconds);
  const pcm = new Int16Array(N);
  for (let i = 0; i < N; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000);
  return buildWav(pcm, sampleRate, 1);
}

describe("encodeWavToMp3", () => {
  test("emits a valid MP3 (frame-sync magic bytes) much smaller than the WAV", async () => {
    const wav = sineWav();
    const mp3 = await encodeWavToMp3(wav, { kbps: 56 });
    expect(Buffer.isBuffer(mp3)).toBe(true);
    expect(mp3.length).toBeGreaterThan(0);
    // MP3 frame header: 11 sync bits — byte0 = 0xFF, top 3 bits of byte1 set.
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1] & 0xe0).toBe(0xe0);
    // 56kbps mono is dramatically smaller than 24kHz s16le PCM.
    expect(mp3.length).toBeLessThan(wav.length / 2);
  });

  test("24000Hz is a supported (native MPEG2) rate — no resample needed on the prod path", () => {
    expect(LAME_SAMPLE_RATES.has(24000)).toBe(true);
  });

  test("rejects an unsupported sample rate loudly rather than corrupting the stream", async () => {
    const wav = buildWav(new Int16Array(1000), 23000, 1); // 23000 not in lame tables
    await expect(encodeWavToMp3(wav)).rejects.toThrow(/unsupported sample rate/);
  });

  test("rejects non-mono PCM (persona path is always mono)", async () => {
    const wav = buildWav(new Int16Array(2000), 24000, 2);
    await expect(encodeWavToMp3(wav)).rejects.toThrow(/mono/);
  });
});
