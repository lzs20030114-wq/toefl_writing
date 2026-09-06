/**
 * 「真题专区 · 听力 / 口语」映射层契约测试（lib/realBank.js 的 LCR / LC / LA / LAT /
 * repeat / interview 六支），范式照 __tests__/real-bank-reading-data.test.js。
 *
 * 与 __tests__/real-bank-listening-speaking-data.test.js 的分工：
 *   那边拿**出题 validator**（生成侧口径）卡「库里的题合不合格」；
 *   这边卡「mapper 吐出来的东西，四个渲染组件能不能直接吃」——
 *   两者一起才覆盖「落库 → 上屏」整条路。
 *
 * 硬不变量（每条都是「不成立就会有用户看到坏题」）：
 *   1. 六类都得有题 —— 空 = 用户点进去只看到「暂无可用题目」，功能等于没上线；
 *   2. id 带 real_ 前缀、不与写作真题 / 阅读真题 / 个人题库 id 相交（已练与历史不互相污染）；
 *   3. tier 恒为 recalled，real=true —— 这批是机经回忆版，不许冒充 ETS 官方；
 *   4. 每道选择题恰好 A–D 四个非空选项 + `answer` 落在 A–D（听力答案键叫 answer，
 *      不是阅读那边的 correct_answer）—— ListeningMCQTask / LCRTask 硬编码渲染这四个键；
 *   5. audio_url 要么是绝对 http(s)，要么是 null（组件回退 TTS）；
 *      **绝不许是 `/listening-audio/…` 这类本地相对路径 —— 线上 404，用户点了没声音**；
 *   6. picker 卡片每张都有非空 id / tag / title（TopicPicker 靠这三个字段渲染与去重）。
 */

import {
  getRealAPItems,
  getRealCTWItems,
  getRealInterviewSets,
  getRealLAItems,
  getRealLATItems,
  getRealLCItems,
  getRealLCRItems,
  getRealRDLItems,
  getRealRepeatSets,
  mapRealInterviewToPicker,
  mapRealLAToPicker,
  mapRealLATToPicker,
  mapRealLCRToPicker,
  mapRealLCToPicker,
  mapRealRepeatToPicker,
  REAL_LISTENING_COUNTS,
  REAL_SPEAKING_COUNTS,
  realSourceFlagNote,
} from "../lib/realBank";

const LCR = getRealLCRItems();
const LC = getRealLCItems();
const LA = getRealLAItems();
const LAT = getRealLATItems();
const REPEAT = getRealRepeatSets();
const INTERVIEW = getRealInterviewSets();

const LISTENING = { lcr: LCR, lc: LC, la: LA, lat: LAT };
const MCQ_BANKS = { lc: LC, la: LA, lat: LAT };

describe("真题听力 / 口语：库非空且题量与 counts.json 对得上", () => {
  test.each([["lcr", LCR], ["lc", LC], ["la", LA], ["lat", LAT]])(
    "%s 至少有一条能上屏的题",
    (_type, items) => { expect(items.length).toBeGreaterThan(0); }
  );

  test("repeat / interview 各至少一套", () => {
    expect(REPEAT.length).toBeGreaterThan(0);
    expect(INTERVIEW.length).toBeGreaterThan(0);
  });

  // mapper 会丢掉渲染不了的题，所以「≤ counts」而不是「= counts」；
  // 但真掉一条就说明库里躺着 App 吃不下的数据 —— 这里同时把差额钉成 0，出现即红。
  test("mapper 一条都没丢（丢了 = 库里有 App 渲染不了的题）", () => {
    expect({
      lcr: LCR.length, lc: LC.length, la: LA.length, lat: LAT.length,
    }).toEqual(REAL_LISTENING_COUNTS);
    expect({
      repeat: REPEAT.length, interview: INTERVIEW.length,
    }).toEqual(REAL_SPEAKING_COUNTS);
  });
});

describe("真题听力 / 口语：id 空间", () => {
  const allIds = [
    ...Object.values(LISTENING).flat().map((x) => x.id),
    ...REPEAT.map((x) => x.id),
    ...INTERVIEW.map((x) => x.id),
  ];

  test("全部 real_ 前缀，没有 real_real_ / usr_", () => {
    expect(allIds.filter((id) => !id.startsWith("real_"))).toEqual([]);
    expect(allIds.filter((id) => id.startsWith("real_real_"))).toEqual([]);
    expect(allIds.filter((id) => id.includes("usr_"))).toEqual([]);
  });

  test("与写作 / 阅读真题 id 不相交（已练与历史记录不互相污染）", () => {
    const reading = new Set([
      ...getRealCTWItems().map((x) => x.id),
      ...getRealRDLItems().map((x) => x.id),
      ...getRealAPItems().map((x) => x.id),
    ]);
    expect(allIds.filter((id) => reading.has(id))).toEqual([]);
  });

  test("口语子条目 id 也唯一（RepeatTask / InterviewTask 用它做 React key 和录音索引）", () => {
    const sub = [
      ...REPEAT.flatMap((s) => s.sentences.map((x) => x.id)),
      ...INTERVIEW.flatMap((s) => s.questions.map((x) => x.id)),
    ];
    expect(new Set(sub).size).toBe(sub.length);
  });
});

describe("真题听力 / 口语：来源分档诚实", () => {
  test("全部 recalled + real=true，一条都不冒充官方", () => {
    const all = [...Object.values(LISTENING).flat(), ...REPEAT, ...INTERVIEW];
    expect(all.every((x) => x.tier === "recalled")).toBe(true);
    expect(all.every((x) => x.real === true)).toBe(true);
  });

  test("source_flags 原样带上；vendor_reformatted 有对应的人话说明", () => {
    const all = [...Object.values(LISTENING).flat(), ...REPEAT, ...INTERVIEW];
    expect(all.every((x) => Array.isArray(x.source_flags))).toBe(true);
    const flagged = all.find((x) =>
      x.source_flags.some((f) => f.code === "vendor_reformatted")
    );
    if (flagged) expect(realSourceFlagNote(flagged)).toContain("双票复核");
    expect(realSourceFlagNote({ source_flags: [] })).toBe("");
    expect(realSourceFlagNote(null)).toBe("");
  });
});

describe("真题听力：渲染组件的硬契约", () => {
  test("LCR 每条：speaker 非空 + A–D 四选项 + answer 落在 A–D", () => {
    for (const it of LCR) {
      expect(it.speaker.length).toBeGreaterThan(0);
      expect(Object.keys(it.options).sort()).toEqual(["A", "B", "C", "D"]);
      expect(Object.values(it.options).every((v) => v.trim().length > 0)).toBe(true);
      expect(["A", "B", "C", "D"]).toContain(it.answer);
    }
  });

  test.each(Object.keys(MCQ_BANKS))("%s 每题：A–D 四选项 + answer 合法 + stem 非空", (type) => {
    for (const it of MCQ_BANKS[type]) {
      expect(it.questions.length).toBeGreaterThan(0);
      for (const q of it.questions) {
        expect(q.stem.length).toBeGreaterThan(0);
        expect(Object.keys(q.options).sort()).toEqual(["A", "B", "C", "D"]);
        expect(Object.values(q.options).every((v) => v.trim().length > 0)).toBe(true);
        expect(["A", "B", "C", "D"]).toContain(q.answer);
      }
    }
  });

  test("LC 有对话轮次、LA 有 announcement、LAT 有 transcript（同时是 TTS 兜底文本）", () => {
    for (const it of LC) {
      expect(it.conversation.length).toBeGreaterThan(0);
      expect(it.conversation.every((t) => t.speaker && t.text)).toBe(true);
    }
    expect(LA.every((it) => it.announcement.length > 0)).toBe(true);
    expect(LAT.every((it) => it.transcript.length > 0)).toBe(true);
  });
});

describe("真题听力 / 口语：音频 URL", () => {
  const urls = [
    ...Object.values(LISTENING).flat().map((x) => x.audio_url),
    ...REPEAT.flatMap((s) => s.sentences.map((x) => x.audio_url)),
    ...INTERVIEW.flatMap((s) => s.questions.map((x) => x.audio_url)),
  ];

  test("要么绝对 http(s)，要么 null —— 相对路径线上 404", () => {
    const bad = urls.filter((u) => u !== null && !/^https?:\/\//.test(String(u)));
    expect(bad).toEqual([]);
  });

  test("至少一部分题真的配了音（全 null = 只能听浏览器朗读，不算真题录音）", () => {
    expect(urls.filter(Boolean).length).toBeGreaterThan(0);
  });
});

describe("真题口语：任务组件吃的形状", () => {
  test("repeat：每套 sentences 非空，每句有 id / sentence / timing_seconds", () => {
    for (const s of REPEAT) {
      expect(s.sentences.length).toBeGreaterThan(0);
      for (const x of s.sentences) {
        expect(x.id).toBeTruthy();
        expect(x.sentence.length).toBeGreaterThan(0);
        expect(Number.isFinite(x.timing_seconds)).toBe(true);
      }
    }
  });

  test("interview：每套 questions 非空，每题有 id / question / position", () => {
    for (const s of INTERVIEW) {
      expect(s.questions.length).toBeGreaterThan(0);
      for (const q of s.questions) {
        expect(q.id).toBeTruthy();
        expect(q.question.length).toBeGreaterThan(0);
        expect(q.position).toBeTruthy();
      }
    }
  });
});

describe("真题听力 / 口语：picker 卡片", () => {
  const cases = [
    ["lcr", mapRealLCRToPicker(LCR), LCR.length],
    ["lc", mapRealLCToPicker(LC), LC.length],
    ["la", mapRealLAToPicker(LA), LA.length],
    ["lat", mapRealLATToPicker(LAT), LAT.length],
    ["repeat", mapRealRepeatToPicker(REPEAT), REPEAT.length],
    ["interview", mapRealInterviewToPicker(INTERVIEW), INTERVIEW.length],
  ];

  test.each(cases)("%s：每张卡都有 id / tag / title，张数与题量一致", (_t, cards, n) => {
    expect(cards.length).toBe(n);
    for (const c of cards) {
      expect(c.id).toBeTruthy();
      expect(String(c.tag).length).toBeGreaterThan(0);
      expect(String(c.title).trim().length).toBeGreaterThan(0);
      // tag 是「来源分档 · 考试日期」，必须带回忆版字样（真题专区的诚实标注贯穿到 picker）。
      expect(String(c.tag)).toContain("回忆版");
    }
  });

  test("空输入 / 脏输入不炸（picker 映射对上游产物零信任）", () => {
    for (const fn of [
      mapRealLCRToPicker, mapRealLCToPicker, mapRealLAToPicker,
      mapRealLATToPicker, mapRealRepeatToPicker, mapRealInterviewToPicker,
    ]) {
      expect(fn(null)).toEqual([]);
      expect(fn([])).toEqual([]);
    }
  });
});
