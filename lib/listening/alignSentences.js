/**
 * alignSentences — 把「已知的句子列表」对到「ASR 词级时间戳」上，得出每句在音频里的起止秒。
 *
 * 用在存量音频补 `sentence_timings`（docs/listening-sentence-timings.md）：产线只给新配的音频
 * 顺带写时间戳；已经上线的 TTS 配音和真题原声没有，要靠这里补。
 *
 * 做法：目标文本按句切（**必须**与产线同一把刀：lib/tts/wavTools.splitSentences，否则句子列表
 * 与渲染时的不一致），全部 token 串成一条与 ASR 词序列做半全局编辑距离对齐（ASR 两端多出来的
 * 旁白 / 静音免费跳过），回溯得到「目标第 i 个词 ↔ ASR 第 j 个词」的精确命中；每句取它第一个
 * 与最后一个命中词的时刻。命中太少（ASR 漏了半句以上）的句子记 null（列出但不可点）；一条音频
 * 里定位到的句子占比不够就整条不写，宁缺毋滥。
 *
 * 纯函数、零依赖（sentence 切分由调用方传入），单测见 __tests__/listening-align-sentences.test.js。
 * CommonJS（与 lib/tts 同一约定）：脚本用 createRequire 拿，Next/jest 直接 import 也行。
 */
"use strict";

/** 词 → 对齐用 token：小写，去撇号，连字符并词，其余非字母数字全剥掉。空串 = 不参与对齐。 */
function normalizeToken(w) {
  return String(w || "")
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/[‘’']/g, "")
    .replace(/([a-z0-9])[-–—]([a-z0-9])/g, "$1$2")
    .replace(/[^a-z0-9]+/g, "");
}

/** 一段文本 → token 列表（空 token 丢掉）。 */
function tokenize(text) {
  return String(text || "").split(/\s+/).map(normalizeToken).filter(Boolean);
}

/**
 * 半全局对齐 + 回溯：target 必须整条走完，asr 两端多余的词免费。
 * @param {string[]} target
 * @param {string[]} asr
 * @returns {Int32Array} 长度 = target.length；命中的目标词给 ASR 下标，否则 -1
 */
function alignTokens(target, asr) {
  const n = target.length, m = asr.length;
  const map = new Int32Array(n).fill(-1);
  if (!n || !m) return map;
  // cost[i][j]：target 前 i 个词对 asr 前 j 个词的最小代价；第 0 行全 0 = 前置免费。
  const W = m + 1;
  const cost = new Int32Array((n + 1) * W);
  const move = new Uint8Array((n + 1) * W); // 0 = 对角(命中/替换) 1 = 删 target 词 2 = 跳 asr 词
  for (let i = 1; i <= n; i++) { cost[i * W] = i; move[i * W] = 1; }
  for (let i = 1; i <= n; i++) {
    const t = target[i - 1];
    const row = i * W, prev = (i - 1) * W;
    for (let j = 1; j <= m; j++) {
      const diag = cost[prev + j - 1] + (t === asr[j - 1] ? 0 : 1);
      const del = cost[prev + j] + 1;
      const ins = cost[row + j - 1] + 1;
      let best = diag, mv = 0;
      if (del < best) { best = del; mv = 1; }
      if (ins < best) { best = ins; mv = 2; }
      cost[row + j] = best; move[row + j] = mv;
    }
  }
  // 后置免费：从最后一行代价最小的列开始回溯（并列取最靠左，少吞尾巴）。
  let j = 0, bestCost = Infinity;
  for (let k = 0; k <= m; k++) if (cost[n * W + k] < bestCost) { bestCost = cost[n * W + k]; j = k; }
  let i = n;
  while (i > 0 && j > 0) {
    const mv = move[i * W + j];
    if (mv === 0) { if (target[i - 1] === asr[j - 1]) map[i - 1] = j - 1; i--; j--; }
    else if (mv === 1) i--;
    else j--;
  }
  return map;
}

const round3 = (x) => Math.round(x * 1000) / 1000;

const ALIGN_DEFAULTS = Object.freeze({
  /** 一句里至少命中这么大比例的词才算定位到（短句另有下限 1 词）。 */
  minMatchRatio: 0.5,
  /** 一条音频里定位到的句子占比低于此就整条不写。 */
  minLocatedRatio: 0.8,
  /** 单个词的 ASR 时长上限：超过多半是 whisper 把词拖进了静音，用作末词收尾的护栏。 */
  maxWordSec: 2.5,
});

/**
 * 句子列表 + ASR 词 → 句级时间戳。
 * @param {Array<{text:string, turn?:number, speaker?:string}>} sentences 与渲染同一把刀切出来的句子
 * @param {Array<{w:string, start:number, end:number}>} asrWords 词级时间戳（asr_words.py 的 words[]）
 * @param {object} [opts] ALIGN_DEFAULTS 的覆盖
 * @returns {{ timings: Array|null, located: number, total: number, reasons: string[] }}
 *   timings 为 null 表示这条不该写（句子太少定位到 / 没有句子 / 没有 ASR 词）。
 */
function alignSentences(sentences, asrWords, opts = {}) {
  const O = { ...ALIGN_DEFAULTS, ...opts };
  const list = Array.isArray(sentences) ? sentences.filter((s) => s && String(s.text || "").trim()) : [];
  const words = Array.isArray(asrWords) ? asrWords.filter((w) => w && Number.isFinite(w.start) && Number.isFinite(w.end)) : [];
  if (!list.length) return { timings: null, located: 0, total: 0, reasons: ["no sentences"] };
  if (!words.length) return { timings: null, located: 0, total: list.length, reasons: ["no asr words"] };

  // 所有句子的 token 串成一条，记住每个 token 属于哪句。
  const target = [];
  const owner = [];
  list.forEach((s, si) => { for (const tok of tokenize(s.text)) { target.push(tok); owner.push(si); } });
  const asr = words.map((w) => normalizeToken(w.w));
  const map = alignTokens(target, asr);

  const first = new Array(list.length).fill(-1);
  const last = new Array(list.length).fill(-1);
  const hits = new Array(list.length).fill(0);
  const sizes = new Array(list.length).fill(0);
  for (let k = 0; k < target.length; k++) {
    const si = owner[k];
    sizes[si] += 1;
    const j = map[k];
    if (j < 0) continue;
    hits[si] += 1;
    if (first[si] < 0) first[si] = j;
    last[si] = j;
  }

  const timings = [];
  const reasons = [];
  let located = 0;
  list.forEach((s, si) => {
    const base = { text: String(s.text).trim() };
    if (Number.isInteger(s.turn) && s.turn >= 0) base.turn = s.turn;
    if (typeof s.speaker === "string" && s.speaker.trim()) base.speaker = s.speaker.trim();
    const need = Math.max(1, Math.ceil(sizes[si] * O.minMatchRatio));
    if (!(sizes[si] > 0 && hits[si] >= need && first[si] >= 0)) {
      reasons.push(`#${si} unlocated (${hits[si]}/${sizes[si]} words)`);
      timings.push({ ...base, start: null, end: null });
      return;
    }
    const w0 = words[first[si]], w1 = words[last[si]];
    const start = w0.start;
    // 末词时长护栏：whisper 偶尔把最后一个词的 end 拖进后面的静音里。
    let end = Math.min(w1.end, w1.start + O.maxWordSec);
    if (!(end > start)) end = start + 0.05;
    located += 1;
    timings.push({ ...base, start, end });
  });
  // 定位到的句子按 ASR 下标递增，start 天然单调；只有 end 可能外溢到下一句头上
  // （词尾时间戳偶有几十毫秒甚至更长的拖尾）。把前一句的 end 削到下一句的 start，
  // 而不是把下一句往后推——推后会把短句推没了。
  let prev = -1;
  timings.forEach((t, i) => {
    if (t.start == null) return;
    if (prev >= 0 && timings[prev].end > t.start) timings[prev].end = t.start;
    prev = i;
  });
  for (const t of timings) if (t.start != null) { t.start = round3(t.start); t.end = round3(t.end); }

  if (located === 0 || located / list.length < O.minLocatedRatio) {
    reasons.unshift(`located ${located}/${list.length} below ${O.minLocatedRatio}`);
    return { timings: null, located, total: list.length, reasons };
  }
  return { timings, located, total: list.length, reasons };
}

module.exports = { normalizeToken, tokenize, alignTokens, alignSentences, ALIGN_DEFAULTS };
