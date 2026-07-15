/**
 * Interview scoring guardrails + parsing + median selection — pure functions.
 *
 * 2026-07-15 官方锚定改造的护栏层。评分后应用规则护栏，把单路幻觉 / 过短 / 跑题 /
 * 复读题干等系统性高分泄漏压回官方档位。全部纯函数以便 jest 直测，且被
 * scripts/speaking-scoring-gate.mjs 直接复用（gate 跑生产本体）。
 *
 * 依据（data/speakingScoring/officialRubrics.json → takeAnInterview）：
 *   - 官方满分样例 45 秒作答约 110-135 词（decision-making 4 份：约 111/121/108/132）。
 *   - 2 档「minimally connected... little or no relevant elaboration or consists
 *     mainly of language from the question」→ 跑题 / 复读题干封顶 2.0。
 *   - 词数护栏为工程近似：45 秒里说得太少 → 无从展开，官方 holistic 必然落低档。
 */

// ── 常量（写成命名常量 + 注释，便于校准时调参与自解释）─────────────────────────
// 词数封顶：45 秒官方满分约 110-135 词。远低于此说明展开严重不足，据官方档位封顶。
// 阈值取「严格小于」：wc < maxWords 时封到 cap。取命中的最小桶（最严格）。
export const WORD_CAPS = [
  { maxWords: 10, cap: 1.0 }, // <10 词：几乎没说什么 → 1 档
  { maxWords: 25, cap: 2.5 }, // <25 词：内容单薄 → 至多 2.5
  { maxWords: 45, cap: 3.5 }, // <45 词：展开有限 → 至多 3.5
];
// 跑题（on_topic=false）：对齐官方 2 档 minimally connected。
export const OFF_TOPIC_CAP = 2.0;
// 复读题干：对齐官方 2 档「consists mainly of language from the question」。
export const ECHO_CAP = 2.0;
// 维度均值与 overall 差异过大 → 疑似单路幻觉，收缩到中间值。
export const CONSISTENCY_TOL = 1.5;
// 复读检测阈值：作答里「不来自题干的新内容词」不超过这么多，且题干词占比超过 overlap 阈值。
const ECHO_MAX_NEW_CONTENT_WORDS = 3;
const ECHO_MIN_OVERLAP_RATIO = 0.7;

// 英文常见虚词 + STT filler，参与复读检测时剔除，避免 the/a/um 之类拉高重叠率。
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "so", "if", "of", "to", "in", "on",
  "for", "with", "at", "by", "from", "as", "is", "are", "was", "were", "be",
  "been", "being", "am", "do", "does", "did", "you", "i", "it", "he", "she",
  "they", "we", "me", "my", "your", "this", "that", "these", "those", "what",
  "how", "when", "why", "who", "which", "some", "any", "can", "could", "would",
  "will", "shall", "should", "may", "might", "there", "here", "about", "um",
  "uh", "like", "yeah", "well", "okay", "ok", "hmm", "er", "mm",
]);

export function clampHalf(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(5, Math.max(0, n)) * 2) / 2;
}

export function countWords(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function contentTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && w.length >= 3 && !STOP_WORDS.has(w));
}

// 复读题干检测：作答几乎全部由题干里的词构成、且几乎没有引入新内容词。
// 对齐官方 2 档「consists mainly of language from the question」。保守设计：
// 需同时满足「新内容词极少」+「题干词占比高」，避免误伤自然复用了题干词的正常作答。
export function isQuestionEcho(transcript, question) {
  const tTokens = contentTokens(transcript);
  if (tTokens.length === 0) return false;
  const qSet = new Set(contentTokens(question));
  if (qSet.size === 0) return false;

  const uniqueT = [...new Set(tTokens)];
  const fromQuestion = uniqueT.filter((w) => qSet.has(w)).length;
  const newContent = uniqueT.length - fromQuestion;
  const overlapRatio = fromQuestion / uniqueT.length;

  return newContent <= ECHO_MAX_NEW_CONTENT_WORDS && overlapRatio >= ECHO_MIN_OVERLAP_RATIO;
}

// 命中的最严格词数封顶（升序桶，取第一个 wc < maxWords 命中的 cap）。无命中返回 null。
function wordCapFor(wordCount) {
  for (const bucket of WORD_CAPS) {
    if (wordCount < bucket.maxWords) return bucket;
  }
  return null;
}

/**
 * 评分后护栏。输入 overall + 维度分 + 转写 + 题目 + on_topic，返回护栏后的分数、
 * 收缩后的维度分、以及触发了哪些护栏。
 *
 * 顺序：
 *   1) base = clampHalf(overall)
 *   2) 一致性收缩：|dim 均值 - base| > tol → base 收缩到中间值（单路幻觉防线）
 *   3) 硬封顶（取最小）：词数 cap / 跑题 cap / 复读 cap；binding（真正压低了）才记录，
 *      并把每个维度分一并 clamp 到该 ceiling，保证「维度条 ≤ 总分」的报告自洽。
 *   4) 全部 clamp 到 [0,5]、0.5 步进。
 *
 * @returns {{ score:number, dimensions:Object, guardrails:string[] }}
 */
export function applyGuardrails({ overall, dimensions, transcript, question, onTopic }) {
  const guardrails = [];
  const dims = normalizeDimensions(dimensions);

  let base = clampHalf(overall);

  // 2) 一致性收缩
  const dimScores = ["fluency", "intelligibility", "language", "organization"]
    .map((k) => Number(dims[k]?.score))
    .filter((n) => Number.isFinite(n));
  if (dimScores.length > 0) {
    const mean = dimScores.reduce((a, b) => a + b, 0) / dimScores.length;
    if (Math.abs(mean - base) > CONSISTENCY_TOL) {
      base = clampHalf((mean + base) / 2);
      guardrails.push("consistency_shrink");
    }
  }

  // 3) 硬封顶：收集所有适用 ceiling，取最小值。
  const caps = [];
  const wc = countWords(transcript);
  const wordBucket = wordCapFor(wc);
  if (wordBucket) caps.push({ name: `word_cap_lt_${wordBucket.maxWords}`, ceil: wordBucket.cap });
  if (onTopic === false) caps.push({ name: "off_topic_cap", ceil: OFF_TOPIC_CAP });
  if (isQuestionEcho(transcript, question)) caps.push({ name: "question_echo_cap", ceil: ECHO_CAP });

  let ceiling = Infinity;
  let binding = null;
  for (const c of caps) {
    if (c.ceil < ceiling) {
      ceiling = c.ceil;
      binding = c;
    }
  }
  // 记录所有 binding（真正压低了 base）的护栏名，便于诊断触发了哪些。
  if (Number.isFinite(ceiling) && ceiling < base) {
    for (const c of caps) {
      if (c.ceil < base) guardrails.push(c.name);
    }
    base = clampHalf(ceiling);
    // 维度条一并压到 ceiling，保持报告自洽（避免总分 1.0 而维度条显示 4）。
    for (const k of Object.keys(dims)) {
      if (Number(dims[k].score) > base) dims[k] = { ...dims[k], score: base };
    }
  }

  // 4) 最终 clamp
  const score = clampHalf(base);
  for (const k of Object.keys(dims)) {
    dims[k] = { ...dims[k], score: clampHalf(dims[k].score) };
  }

  return { score, dimensions: dims, guardrails };
}

// 归一化四维度为 { score, feedback } 形状（容忍缺失）。
function normalizeDimensions(dimensions) {
  const keys = ["fluency", "intelligibility", "language", "organization"];
  const out = {};
  for (const k of keys) {
    const d = dimensions && dimensions[k];
    out[k] = {
      score: clampHalf(d?.score),
      feedback: String(d?.feedback || ""),
    };
  }
  return out;
}

/**
 * 三路取中位：从成功解析的候选报告里选一份完整报告返回。
 * 语义参照 lib/ai/writingEval.js 的 pickMedianCandidate：
 *   n=0 → null（调用方走 fallback）
 *   n=1 → 直接用
 *   n=2 → 取 overall 较低者（保守，防垃圾作答靠方差侧漏高分）
 *   n>=3 → 取中位（升序后中间那份）
 * 按 overall 升序排序，原索引做 tie-breaker 保证并列稳定。
 *
 * @param {Array<{overall:number}>} reports
 * @returns {object|null} 被选中的原始报告对象
 */
export function pickMedianReport(reports) {
  const list = Array.isArray(reports) ? reports : [];
  const n = list.length;
  if (n === 0) return null;
  if (n === 1) return list[0];
  const ordered = list
    .map((r, i) => ({ r, i, overall: Number(r?.overall) }))
    .sort((a, b) => (a.overall - b.overall) || (a.i - b.i));
  if (n === 2) return ordered[0].r; // 取较低
  return ordered[Math.floor(n / 2)].r; // n>=3：中位（n=3 → 索引 1）
}

/**
 * 解析单路 AI JSON 输出为规范化候选报告（纯函数，gate 与生产共用）。
 * 稳健处理 markdown 围栏、额外文本。抽出 overall / on_topic / 四维度 / summary /
 * suggestions。overall 缺失时退回 score，再退回维度均值。
 *
 * @throws 解析失败时抛错（无有效 JSON / 缺 dimensions）。
 * @returns {{ overall:number, onTopic:boolean, dimensions:Object, summary:string, suggestions:string[] }}
 */
export function parseInterviewResponse(raw) {
  let text = String(raw || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");

  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error("No JSON object found in AI response");
  }
  const data = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  if (!data.dimensions || typeof data.dimensions !== "object") {
    throw new Error("Missing dimensions in AI response");
  }

  const keys = ["fluency", "intelligibility", "language", "organization"];
  const dimensions = {};
  const dimScores = [];
  for (const k of keys) {
    const d = data.dimensions[k] || {};
    const s = clampHalf(d.score);
    dimensions[k] = { score: s, feedback: String(d.feedback || "") };
    if (Number.isFinite(Number(d.score))) dimScores.push(s);
  }

  // overall：优先 overall，退回 score，再退回维度均值。
  let overall = data.overall;
  if (!Number.isFinite(Number(overall))) overall = data.score;
  if (!Number.isFinite(Number(overall))) {
    overall = dimScores.length ? dimScores.reduce((a, b) => a + b, 0) / dimScores.length : 0;
  }
  overall = clampHalf(overall);

  // on_topic：默认 true（未标注时不误伤）；显式 false 才 false。
  const onTopic = data.on_topic === false ? false : true;

  const suggestions = Array.isArray(data.suggestions)
    ? data.suggestions.map((s) => String(s)).filter(Boolean).slice(0, 3)
    : [];

  return {
    overall,
    onTopic,
    dimensions,
    summary: String(data.summary || ""),
    suggestions,
  };
}

// 跑题 / 复读命中时，若 summary 未点明，前置一句中文提示（对齐「跑题→在 summary 指出」）。
export function annotateOffTopicSummary(summary, guardrails) {
  const s = String(summary || "");
  const offTopic = guardrails.includes("off_topic_cap") || guardrails.includes("question_echo_cap");
  if (!offTopic) return s;
  if (/跑题|偏题|离题|复读|不切题|未回应/.test(s)) return s;
  const note = "回答偏离了问题主题或主要在复述题干，总分已按官方档位受限。";
  return s ? `${note} ${s}` : note;
}
