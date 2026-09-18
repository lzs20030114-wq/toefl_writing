/**
 * 存量音频补句级时间戳的对齐核心（lib/listening/alignSentences.js）。
 * 合成 ASR：按句子造词级时间戳，再加扰动（漏词 / 错词 / 多词 / 旁白），看每句起止还对不对。
 */
const { alignTokens, alignSentences, normalizeToken, tokenize, ALIGN_DEFAULTS } = require("../lib/listening/alignSentences");

// 把句子列表变成「完美 ASR」：每词 0.3s，词间 0.05s，句间 gap 秒。
function synth(sentences, { gap = 0.3, perWord = 0.3 } = {}) {
  const words = [];
  const spans = [];
  let t = 0;
  for (const s of sentences) {
    const toks = String(s.text).split(/\s+/).filter(Boolean);
    const start = t;
    for (const w of toks) { words.push({ w, start: t, end: t + perWord }); t += perWord + 0.05; }
    spans.push({ start, end: t - 0.05 });
    t += gap;
  }
  return { words, spans };
}
const r3 = (x) => Math.round(x * 1000) / 1000;

describe("normalizeToken / tokenize", () => {
  test("小写、去撇号、并连字符、剥标点；数字保留", () => {
    expect(normalizeToken("Don't")).toBe("dont");
    expect(normalizeToken("e-mail,")).toBe("email");
    expect(normalizeToken("7:30")).toBe("730");
    expect(normalizeToken("—")).toBe("");
    expect(tokenize("Hey, I just got back. Wow!")).toEqual(["hey", "i", "just", "got", "back", "wow"]);
  });
});

describe("alignTokens —— 半全局对齐", () => {
  test("完全一致：逐词命中", () => {
    expect(Array.from(alignTokens(["a", "b", "c"], ["a", "b", "c"]))).toEqual([0, 1, 2]);
  });
  test("ASR 两端多出的旁白免费跳过", () => {
    expect(Array.from(alignTokens(["a", "b", "c"], ["listen", "to", "a", "b", "c", "bye"]))).toEqual([2, 3, 4]);
  });
  test("替换 / 漏词 / 多词：其余词仍各归其位", () => {
    // target: a b c d e；asr 把 c 认错成 x，漏了 d，b 后多了个 z
    expect(Array.from(alignTokens(["a", "b", "c", "d", "e"], ["a", "b", "z", "x", "e"]))).toEqual([0, 1, -1, -1, 4]);
  });
  test("空输入不炸", () => {
    expect(Array.from(alignTokens([], ["a"]))).toEqual([]);
    expect(Array.from(alignTokens(["a"], []))).toEqual([-1]);
  });
});

describe("alignSentences —— 句级时间戳", () => {
  const sentences = [
    { text: "Hey, I just got back from the library." },
    { text: "Did you find the book?" },
    { text: "Not yet, but the librarian said it might be on hold." },
  ];

  test("完美 ASR：每句起止 = 首词 start / 末词 end，3 位小数", () => {
    const { words, spans } = synth(sentences);
    const res = alignSentences(sentences, words);
    expect(res.located).toBe(3);
    expect(res.timings.map((t) => [t.start, t.end])).toEqual(spans.map((s) => [r3(s.start), r3(s.end)]));
    expect(res.timings.map((t) => t.text)).toEqual(sentences.map((s) => s.text));
  });

  test("ASR 前面多了 ETS 旁白、词有错有漏：起止仍对，句子不串", () => {
    const { words, spans } = synth(sentences);
    const narration = [{ w: "Listen", start: 0, end: 0.3 }, { w: "to", start: 0.35, end: 0.5 }, { w: "a", start: 0.55, end: 0.6 }, { w: "conversation.", start: 0.65, end: 1.2 }];
    const shift = 1.6;
    const shifted = words.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift }));
    // 扰动：第二句 "find" 认成 "fine"，第三句漏掉 "might"
    shifted[9] = { ...shifted[9], w: "fine" };
    const perturbed = [...narration, ...shifted.filter((w) => w.w !== "might")];
    const res = alignSentences(sentences, perturbed);
    expect(res.located).toBe(3);
    res.timings.forEach((t, i) => {
      expect(t.start).toBeCloseTo(spans[i].start + shift, 3);
      expect(t.end).toBeCloseTo(spans[i].end + shift, 3);
    });
  });

  test("对话：turn / speaker 原样带到每句上", () => {
    const conv = [
      { turn: 0, speaker: "Woman", text: "Hi there." },
      { turn: 0, speaker: "Woman", text: "Quick question." },
      { turn: 1, speaker: "Man", text: "Sure." },
    ];
    const { words } = synth(conv);
    const res = alignSentences(conv, words);
    expect(res.timings.map((t) => [t.turn, t.speaker])).toEqual([[0, "Woman"], [0, "Woman"], [1, "Man"]]);
  });

  test("一句几乎整句没被认出来：那句 null（列出但不可点），其余照写", () => {
    const five = [
      ...sentences,
      { text: "Okay, I will check the front desk then." },
      { text: "Thanks a lot for your help today." },
    ];
    const { words, spans } = synth(five);
    // 把第二句（词 8..12）全换成乱码；5 句里 4 句可定位 = 80%，恰好过线
    const bad = words.map((w, i) => (i >= 8 && i <= 12 ? { ...w, w: "zzz" } : w));
    const res = alignSentences(five, bad);
    expect(res.located).toBe(4);
    expect(res.timings[1]).toEqual({ text: "Did you find the book?", start: null, end: null });
    expect(res.timings[0].end).toBeCloseTo(spans[0].end, 3);
    expect(res.timings[2].start).toBeCloseTo(spans[2].start, 3);
    expect(res.timings[4].end).toBeCloseTo(spans[4].end, 3);
    expect(res.reasons).toEqual(["#1 unlocated (0/5 words)"]);
  });

  test("定位率低于 80% 整条不写（timings=null）", () => {
    const five = [1, 2, 3, 4, 5].map((i) => ({ text: `Sentence number ${i} here.` }));
    const { words } = synth(five);
    const bad = words.map((w, i) => (i >= 8 ? { ...w, w: "zzz" } : w)); // 只剩前两句可认
    const res = alignSentences(five, bad);
    expect(res.timings).toBeNull();
    expect(res.reasons[0]).toMatch(/located 2\/5 below 0.8/);
  });

  test("末词被 whisper 拖进静音：削到下一句开头，下一句原位不动；最后一句按 maxWordSec 收尾", () => {
    const { words, spans } = synth(sentences);
    const lastIdx = words.length - 1;
    // "library." 拖了 5 秒（压到第二句头上）；最后一句的 "hold." 也拖了 5 秒（后面没有句子可削）
    const stretched = words.map((w, i) => (i === 7 || i === lastIdx ? { ...w, end: w.end + 5 } : w));
    const res = alignSentences(sentences, stretched);
    expect(res.located).toBe(3);
    expect(res.timings[0].end).toBeCloseTo(spans[1].start, 3);
    expect(res.timings[1].start).toBeCloseTo(spans[1].start, 3);
    expect(res.timings[1].end).toBeCloseTo(spans[1].end, 3);
    expect(res.timings[2].end).toBeCloseTo(stretched[lastIdx].start + ALIGN_DEFAULTS.maxWordSec, 3);
  });

  test("没有句子 / 没有 ASR 词 → null 并说明", () => {
    expect(alignSentences([], [{ w: "a", start: 0, end: 1 }]).reasons).toEqual(["no sentences"]);
    expect(alignSentences(sentences, []).reasons).toEqual(["no asr words"]);
  });

  test("写回的形状通过 normalizeSentenceTimings 体检（与 lib/realBank 透传同一把尺）", () => {
    const { normalizeSentenceTimings } = require("../lib/listening/sentenceTimings");
    const { words } = synth(sentences);
    const res = alignSentences(sentences, words);
    expect(normalizeSentenceTimings(res.timings)).toEqual(res.timings);
  });
});

describe("align-sentence-timings.mjs —— 句子切分与产线同一把刀", () => {
  test("sentencesOf 用 wavTools.splitSentences：lc 逐轮带 turn/speaker，单人整段", async () => {
    const { sentencesOf } = await import("../scripts/align-sentence-timings.mjs");
    const lc = { conversation: [{ speaker: "Woman", text: "Hi. Are you free?" }, { speaker: "Man", text: "Sure." }] };
    expect(sentencesOf(lc, "lc")).toEqual([
      { turn: 0, speaker: "Woman", text: "Hi." },
      { turn: 0, speaker: "Woman", text: "Are you free?" },
      { turn: 1, speaker: "Man", text: "Sure." },
    ]);
    expect(sentencesOf({ transcript: "Be there by 7 a.m. Please don't be late." }, "lat")).toEqual([
      { text: "Be there by 7 a.m." }, { text: "Please don't be late." },
    ]);
    expect(sentencesOf({ speaker: "Could you help?" }, "lcr")).toEqual([{ text: "Could you help?" }]);
  });
});
