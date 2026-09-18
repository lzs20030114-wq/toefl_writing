/**
 * lib/tts/mp3Frames —— 数帧算时长（个人题库 mp3 字节拼接后给各段定起点用）。
 * 用 lamejs 真编码出来的 mp3 验：帧数 × 每帧采样 / 采样率 ≈ 源 WAV 时长（编码器首尾填充 ≤ 3 帧）。
 */
const { mp3Info, mp3DurationSec, parseFrameHeader } = require("../lib/tts/mp3Frames");
const { encodeWavToMp3 } = require("../lib/tts/mp3Encode");
const { buildWav } = require("../lib/tts/wavTools");

function toneWav(sec, hz = 440) {
  const n = Math.round(24000 * sec);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.round(8000 * Math.sin((2 * Math.PI * hz * i) / 24000));
  return buildWav(pcm, 24000, 1);
}

describe("mp3Frames", () => {
  test("lamejs 编码的 24kHz 单声道 mp3：时长与源 WAV 相差不超过 3 帧（0.075s）", async () => {
    for (const sec of [0.5, 1.0, 2.5]) {
      const mp3 = await encodeWavToMp3(toneWav(sec));
      const info = mp3Info(mp3);
      expect(info.sampleRate).toBe(24000);
      expect(info.frames).toBeGreaterThan(0);
      expect(Math.abs(info.seconds - sec)).toBeLessThanOrEqual(0.075);
    }
  });

  test("按字节拼接的两段：时长 = 两段之和（播放器就是这么按帧顺序解码的）", async () => {
    const a = await encodeWavToMp3(toneWav(1.0));
    const b = await encodeWavToMp3(toneWav(0.7, 660));
    const both = mp3DurationSec(Buffer.concat([a, b]));
    expect(both).toBeCloseTo(mp3DurationSec(a) + mp3DurationSec(b), 6);
  });

  test("前面挂着 ID3v2 标签也能算；非 mp3 / 空 → 0", async () => {
    const mp3 = await encodeWavToMp3(toneWav(0.6));
    const payload = Buffer.alloc(20, 0x41);
    const size = payload.length; // syncsafe
    const id3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
    expect(mp3DurationSec(Buffer.concat([id3, payload, mp3]))).toBeCloseTo(mp3DurationSec(mp3), 6);
    expect(mp3DurationSec(Buffer.from("MP3-hello world"))).toBe(0);
    expect(mp3DurationSec(Buffer.alloc(0))).toBe(0);
    expect(mp3DurationSec(null)).toBe(0);
  });

  test("parseFrameHeader：MPEG-2 Layer III 24kHz 56kbps 单声道帧 = 576 采样 / 168 字节", () => {
    // 0xFF 0xF3: sync + MPEG-2 + Layer III + no CRC；0x74: bitrate idx 7 (56k) + sr idx 1 (24k) + no pad；0xC0: mono
    const h = parseFrameHeader(Buffer.from([0xff, 0xf3, 0x74, 0xc0]), 0);
    expect(h).toMatchObject({ version: 2, layer: 3, bitrate: 56000, sampleRate: 24000, samples: 576, length: 168, mono: true });
    expect(parseFrameHeader(Buffer.from([0x00, 0xf3, 0x48, 0xc0]), 0)).toBeNull();
    expect(parseFrameHeader(Buffer.from([0xff, 0xf3, 0x08, 0xc0]), 0)).toBeNull(); // free bitrate 不认
  });
});
