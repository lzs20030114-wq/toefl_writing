"use strict";
/**
 * mp3Frames.js — 数 MP3 帧、算时长（纯函数，不解码）。
 *
 * 用途：个人题库的听力配音是 edge-tts 逐段 / 逐轮合成后把 mp3 **按字节直接拼接**的
 * （lib/userBank/listeningAudioRender）。要给拼接后的音频写句级时间戳，得知道每一段在
 * 整条里从第几秒开始 —— 播放器按帧顺序解码，每帧固定采样数，所以「前面各段的帧数 ×
 * 每帧采样 / 采样率」就是这一段的起点。
 *
 * 规则：跳过 ID3v2 头；识别 MPEG-1/2/2.5 Layer I/II/III 帧头；首帧若是 Xing/Info 信息帧
 * （解码器会跳过，不出声）不计；同步丢失时逐字节重新找同步字。
 */

const BITRATES = {
  // [version][layer] → kbps 表（index 1..14）
  1: { 1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
       2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
       3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] },
  2: { 1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
       2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
       3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] },
};
const SAMPLE_RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };

/** 解析 off 处的帧头；不是合法帧头返回 null。 */
function parseFrameHeader(buf, off) {
  if (off + 4 > buf.length) return null;
  const b1 = buf[off], b2 = buf[off + 1], b3 = buf[off + 2], b4 = buf[off + 3];
  if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) return null;
  const verBits = (b2 >> 3) & 3;      // 00=2.5 01=保留 10=2 11=1
  const layerBits = (b2 >> 1) & 3;    // 01=III 10=II 11=I
  if (verBits === 1 || layerBits === 0) return null;
  const version = verBits === 3 ? 1 : verBits === 2 ? 2 : 25; // 25 = MPEG-2.5
  const layer = 4 - layerBits;
  const brIdx = (b3 >> 4) & 0xf, srIdx = (b3 >> 2) & 3, padding = (b3 >> 1) & 1;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null; // free / bad bitrate、保留采样率
  const table = BITRATES[version === 1 ? 1 : 2][layer];
  const bitrate = table[brIdx] * 1000;
  const sampleRate = SAMPLE_RATES[version][srIdx];
  const channelMode = (b4 >> 6) & 3;   // 3 = mono
  const samples = layer === 1 ? 384 : layer === 2 ? 1152 : (version === 1 ? 1152 : 576);
  const length = layer === 1
    ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
    : Math.floor((samples / 8) * bitrate / sampleRate) + padding;
  if (length < 4) return null;
  return { version, layer, bitrate, sampleRate, samples, length, mono: channelMode === 3 };
}

function id3v2Length(buf) {
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return 0; // "ID3"
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  const footer = (buf[5] & 0x10) ? 10 : 0;
  return 10 + size + footer;
}

/** 首帧是否 Xing/Info 信息帧（帧头 + side info 之后紧跟 "Xing" / "Info"）。 */
function isInfoFrame(buf, off, h) {
  if (h.layer !== 3) return false;
  const side = h.version === 1 ? (h.mono ? 17 : 32) : (h.mono ? 9 : 17);
  const p = off + 4 + side;
  if (p + 4 > buf.length) return false;
  const tag = buf.toString("ascii", p, p + 4);
  return tag === "Xing" || tag === "Info";
}

/**
 * @param {Buffer} buf
 * @returns {{ frames: number, seconds: number, sampleRate: number|null }}
 */
function mp3Info(buf) {
  if (!buf || !buf.length) return { frames: 0, seconds: 0, sampleRate: null };
  let off = id3v2Length(buf);
  let frames = 0, seconds = 0, sampleRate = null, first = true;
  while (off + 4 <= buf.length) {
    const h = parseFrameHeader(buf, off);
    if (!h) { off += 1; continue; } // 失步：逐字节找下一个同步字
    // 帧头合法但下一帧头对不上（除非已到末尾）→ 大概率是误同步，跳一字节
    const next = off + h.length;
    if (next + 4 <= buf.length && !parseFrameHeader(buf, next)) { off += 1; continue; }
    if (!(first && isInfoFrame(buf, off, h))) {
      frames += 1;
      seconds += h.samples / h.sampleRate;
      if (sampleRate == null) sampleRate = h.sampleRate;
    }
    first = false;
    off = next;
  }
  return { frames, seconds, sampleRate };
}

/** 整条 mp3 的时长（秒，按帧数算，不解码）。非 mp3 / 空 → 0。 */
function mp3DurationSec(buf) {
  return mp3Info(buf).seconds;
}

module.exports = { parseFrameHeader, mp3Info, mp3DurationSec };
