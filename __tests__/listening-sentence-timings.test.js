/**
 * 句级时间戳契约（docs/listening-sentence-timings.md）：
 *   · normalizeSentenceTimings 是唯一的体检口——真题 mapper 与播放器都只认它放行的列表；
 *   · 半份错位的时间戳比没有更糟（点哪句放哪句全串），所以任何一条不合格就整份判 null；
 *   · 各配音脚本 / build_bank 沿用必须把它和 audio_url 绑在一起写、一起作废。
 */
const fs = require("fs");
const path = require("path");
const {
  SENTENCE_TIMINGS_FIELD, SENTENCE_SEEK_LEAD_SEC, normalizeSentenceTimings, playableSentences,
} = require("../lib/listening/sentenceTimings");

const REPO = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

describe("normalizeSentenceTimings —— 体检口", () => {
  test("合格列表原样放行（去掉多余键，text 去首尾空白）", () => {
    const out = normalizeSentenceTimings([
      { text: " First. ", start: 0, end: 1.2, extra: "x" },
      { text: "Second?", start: 1.32, end: 2.0, turn: 1, speaker: "Man" },
    ]);
    expect(out).toEqual([
      { text: "First.", start: 0, end: 1.2 },
      { text: "Second?", start: 1.32, end: 2.0, turn: 1, speaker: "Man" },
    ]);
  });

  test("没有 / 空 / 不是数组 → null", () => {
    expect(normalizeSentenceTimings(undefined)).toBeNull();
    expect(normalizeSentenceTimings(null)).toBeNull();
    expect(normalizeSentenceTimings([])).toBeNull();
    expect(normalizeSentenceTimings({ text: "x", start: 0, end: 1 })).toBeNull();
  });

  test("任一条不合格 → 整份 null（缺 text / 负数 / end < start / NaN / 字符串数字）", () => {
    const good = { text: "ok.", start: 0, end: 1 };
    expect(normalizeSentenceTimings([good, { start: 1.2, end: 2 }])).toBeNull();
    expect(normalizeSentenceTimings([good, { text: "", start: 1.2, end: 2 }])).toBeNull();
    expect(normalizeSentenceTimings([good, { text: "b.", start: -0.1, end: 2 }])).toBeNull();
    expect(normalizeSentenceTimings([good, { text: "b.", start: 2, end: 1.5 }])).toBeNull();
    expect(normalizeSentenceTimings([good, { text: "b.", start: NaN, end: 2 }])).toBeNull();
    expect(normalizeSentenceTimings([good, { text: "b.", start: "1.2", end: 2 }])).toBeNull();
    expect(normalizeSentenceTimings([good, null])).toBeNull();
  });

  test("时间倒流 → null（后一句不能比前一句早开始）", () => {
    expect(normalizeSentenceTimings([
      { text: "a.", start: 2, end: 3 },
      { text: "b.", start: 1, end: 1.5 },
    ])).toBeNull();
  });

  test("对齐没定位到的句子：start/end 都是 null 时保留（列出来但不可点），只给一半 → null", () => {
    expect(normalizeSentenceTimings([
      { text: "a.", start: 0, end: 1 },
      { text: "b.", start: null, end: null },
      { text: "c.", start: 2, end: 3 },
    ])).toEqual([
      { text: "a.", start: 0, end: 1 },
      { text: "b.", start: null, end: null },
      { text: "c.", start: 2, end: 3 },
    ]);
    expect(normalizeSentenceTimings([{ text: "a.", start: 0, end: null }])).toBeNull();
    expect(normalizeSentenceTimings([{ text: "a.", start: null, end: 1 }])).toBeNull();
  });

  test("turn 必须是非负整数、speaker 必须是非空字符串，否则丢掉该键（不判整份）", () => {
    expect(normalizeSentenceTimings([{ text: "a.", start: 0, end: 1, turn: -1, speaker: "  " }]))
      .toEqual([{ text: "a.", start: 0, end: 1 }]);
    expect(normalizeSentenceTimings([{ text: "a.", start: 0, end: 1, turn: 1.5, speaker: 3 }]))
      .toEqual([{ text: "a.", start: 0, end: 1 }]);
  });

  test("playableSentences 只留能定位的句子；坏列表 → []", () => {
    expect(playableSentences([
      { text: "a.", start: 0, end: 1 },
      { text: "b.", start: null, end: null },
    ])).toEqual([{ text: "a.", start: 0, end: 1 }]);
    expect(playableSentences([{ text: "", start: 0, end: 1 }])).toEqual([]);
    expect(playableSentences(undefined)).toEqual([]);
  });

  test("字段名与播放提前量常量", () => {
    expect(SENTENCE_TIMINGS_FIELD).toBe("sentence_timings");
    // MP3 编解码前置延迟上限约 46ms，提前量要盖住它，又不能吃进上一句（句间静音 ≥120ms）。
    expect(SENTENCE_SEEK_LEAD_SEC).toBeGreaterThanOrEqual(0.046);
    expect(SENTENCE_SEEK_LEAD_SEC).toBeLessThan(0.12);
  });
});

/**
 * 配音脚本与 build_bank 是 IIFE / 主脚本，加载即执行，只能用源码结构钉住「时间戳与 audio_url 绑定」。
 */
describe("sentence_timings 与 audio_url 同生同灭 —— 各写入口", () => {
  test("rerender-listening-audio.mjs：Timed 渲染 + 随 audio_url 一起赋值", () => {
    const src = read("scripts/rerender-listening-audio.mjs");
    expect(src).toMatch(/renderConversationTimed\(it\)/);
    expect(src).toMatch(/renderSingleSpeakerTimed\(it, bank\.type\)/);
    expect(src).toMatch(/it\.audio_url = versionedAudioUrl\(url\);\s*\n\s*it\.sentence_timings = sentences;/);
  });

  test("realbank/render_real_audio.mjs：听力四型 Timed 渲染，assign 同时写 audio_url + sentence_timings", () => {
    const src = read("scripts/realbank/render_real_audio.mjs");
    expect(src).toMatch(/type === "lc" \? renderConversationTimed\(it\) : renderSingleSpeakerTimed\(it, type\)/);
    expect(src).toMatch(/it\.audio_url = versionedAudioUrl\(url\);\s*\n\s*it\.sentence_timings = sentences;/);
    expect(src).toMatch(/j\.assign\(url, sentences\)/);
  });

  test("realbank/build_bank.mjs：配音沿用时 timings 随 url 接过来，口播文本变了就一起作废", () => {
    const src = read("scripts/realbank/build_bank.mjs");
    const block = src.slice(src.indexOf("function carryAudioUrls"), src.indexOf("function recarryOnDisk"));
    expect(block).toMatch(/timings: it\.sentence_timings/);
    expect(block).toMatch(/if \(Array\.isArray\(hit\.timings\)\) it\.sentence_timings = hit\.timings; else delete it\.sentence_timings;/);
  });

  test("lib/realBank.js：四个听力 mapper 都经 sentenceTimingsOf 透传，且只在有 audio_url 时", () => {
    const src = read("lib/realBank.js");
    expect(src).toMatch(/import \{ normalizeSentenceTimings \} from "\.\/listening\/sentenceTimings"/);
    expect((src.match(/\.\.\.sentenceTimingsOf\(raw\),/g) || []).length).toBe(4);
    const fn = src.slice(src.indexOf("function sentenceTimingsOf"), src.indexOf("function mapListeningQuestions"));
    expect(fn).toMatch(/if \(!audioUrl\(raw\)\) return \{\};/);
    expect(fn).toMatch(/normalizeSentenceTimings\(raw\?\.sentence_timings\)/);
  });
});
