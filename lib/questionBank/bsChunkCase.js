// 造句题词块的句首大写 —— 真题界面里词块一律小写（专有名词和 I 除外），
// 句首那块如果照抄答案句写成大写（"Which" / "Do you"），等于直接告诉考生哪块放第一个，
// 白送一半排序。主库靠 buildSentenceSchema.hasAllowedChunkCase 在出题时拦；真题专区
// （看图/文本抽题）和个人题库（用户截图抽题）都是照抄原句，要在这里统一改回小写。
//
// 只动「首词 = 答案句首词」的那块，且首词确实大写：句中的大写词块全是专有名词
// （Tokyo / Sam / English professor），不碰。句首词本身是专有名词时保留，判据见 keepsCapital。
// 前端 BuildSentenceTask 会在句首槽位填入后自动大写，所以改小写不影响成句展示；
// 判分 evaluateBuildSentenceOrder 大小写无关，也不影响对错。

const PRONOUN_I = new Set(["I", "I'm", "I've", "I'll", "I'd"]);

// 与 buildSentenceSchema.PROPER_NOUNS 同一批（星期/月份），外加句首常见的语言/国籍词。
const ALWAYS_CAPITAL = new Set([
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
  "English", "Chinese", "Spanish", "French", "German", "Japanese", "Korean",
  "Italian", "Russian", "Arabic", "American", "British", "European", "Asian", "African",
]);

function stripPunct(token) {
  return String(token || "").replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, "");
}

function isCapitalized(word) {
  return /^[A-Z]/.test(word);
}

function tokens(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean);
}

// 句中（非句首）出现过的大写词：句首 = 文本开头或 .!? 之后的第一个词。
function midSentenceCapitals(text) {
  const out = new Set();
  let sentenceStart = true;
  for (const raw of tokens(text)) {
    const w = stripPunct(raw);
    if (w && !sentenceStart && isCapitalized(w)) out.add(w);
    if (w) sentenceStart = false;
    if (/[.!?]["')\]]*$/.test(raw)) sentenceStart = true;
  }
  return out;
}

/**
 * 句首词是否应保留大写：I 系列、星期月份语言国籍、在题干/答案句中间也以大写出现（人名地名），
 * 或同一词块里后面还跟着大写词（"Professor Lee" / "New York"）。
 */
function keepsCapital(word, chunk, context) {
  if (PRONOUN_I.has(word) || ALWAYS_CAPITAL.has(word)) return true;
  if (context.has(word)) return true;
  return tokens(chunk).slice(1).some((t) => {
    const w = stripPunct(t);
    return w && isCapitalized(w) && !PRONOUN_I.has(w);
  });
}

function lowerFirst(chunk) {
  const i = chunk.search(/[A-Za-z]/);
  return i < 0 ? chunk : chunk.slice(0, i) + chunk[i].toLowerCase() + chunk.slice(i + 1);
}

/**
 * 找出「句首词块被大写」的词块。
 * @param {{answer:string, prompt?:string, chunks:string[]}} q
 * @returns {Array<{index:number, from:string, to:string}>}
 */
function findSentenceInitialCapChunks(q) {
  const chunks = Array.isArray(q?.chunks) ? q.chunks : [];
  const first = stripPunct(tokens(q?.answer)[0]);
  if (!first || !isCapitalized(first)) return [];
  const context = new Set([...midSentenceCapitals(q?.answer), ...midSentenceCapitals(q?.prompt)]);
  const out = [];
  chunks.forEach((chunk, index) => {
    if (typeof chunk !== "string") return;
    const w = stripPunct(tokens(chunk)[0]);
    if (w !== first || keepsCapital(w, chunk, context)) return;
    out.push({ index, from: chunk, to: lowerFirst(chunk) });
  });
  return out;
}

/**
 * 返回句首词块改成小写后的新题（不改原对象）；没有要改的就原样返回同一个对象。
 * 干扰项与被改的词块同文时一起改（两种形状都认：真题 distractors[] / 主库与个人题库 distractor）。
 */
function normalizeSentenceInitialChunkCase(q) {
  const fixes = findSentenceInitialCapChunks(q);
  if (fixes.length === 0) return q;
  const renamed = new Map(fixes.map((f) => [f.from, f.to]));
  const next = { ...q, chunks: q.chunks.map((c, i) => (fixes.some((f) => f.index === i) ? lowerFirst(c) : c)) };
  if (Array.isArray(q.distractors)) next.distractors = q.distractors.map((d) => renamed.get(d) ?? d);
  if (typeof q.distractor === "string" && renamed.has(q.distractor)) next.distractor = renamed.get(q.distractor);
  return next;
}

module.exports = { findSentenceInitialCapChunks, normalizeSentenceInitialChunkCase };
