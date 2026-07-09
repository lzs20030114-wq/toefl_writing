/**
 * CTW Uniqueness Checker — 掐掉「多解空」的生成期门禁 + 存量复核工具。
 *
 * 背景（L3 决策块 C，2026-07-09）：C-test 挖空题里，若某个空按显示的碎片
 * (displayed_fragment) 存在第二个「语法+语义都通」的常见英文单词，用户填那个词
 * 也合理，但判分严格匹配原词会判错——多解 = 真扣分不公。
 *
 * 注意：真题本身就挖功能词、给 1-2 字母碎片（data/realExam2026 里
 * "Th_ can cha_ landscapes thr_..."），所以**不能**一刀切禁短碎片/功能词。
 * 真题的短碎片空基本都被上下文（主谓一致、指代、搭配）锁死唯一解。本检查器
 * 判的正是「这个空有没有被锁死」，而不是碎片长短。
 *
 * 用法：
 *   const { multiSolutionBlanks } = await checkItemUniqueness(item, callAI);
 *   - 生成/合库期：multiSolutionBlanks.length > 0 → 该题嫌疑，换词重挖或人审。
 *   - 存量复核：scripts/audit/ctw-uniqueness.mjs 跑批产出 accepted_words 补丁。
 *
 * 纯函数(buildUniquenessPrompt/parseAlternatives/analyzeBlank)可单测，不吃网络。
 */

// 归一：小写、去非字母。判「同词」用。
function norm(w) {
  return String(w || "").toLowerCase().replace(/[^a-z]/g, "");
}

// 碎片匹配：候选词必须以碎片开头（碎片本身是题目给出的、不可改的前缀）。
function matchesFragment(candidate, fragment) {
  const c = norm(candidate);
  const f = norm(fragment);
  return f.length > 0 && c.startsWith(f) && c.length > f.length;
}

// 屈折变体：同词根的单复数/时态/所有格等（原词与候选共享较长前缀且长度接近）。
// 用于分类，不用于判定——判定一律以「AI 认定语义也通」为准。
function isInflectionalVariant(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  const shared = i;
  const shorter = Math.min(x.length, y.length);
  return shared >= shorter - 3 && shared >= Math.min(4, shorter);
}

function classify(fragment, original, alt) {
  const FUNCTION_WORDS = new Set([
    "the", "this", "that", "these", "those", "a", "an", "of", "on", "in", "at", "to",
    "for", "by", "as", "is", "are", "was", "were", "be", "and", "or", "but", "if", "it",
    "its", "their", "his", "her", "have", "has", "had", "not", "so", "than", "then",
    "with", "from", "into", "over", "off", "out", "up", "far", "they", "them", "we",
    "you", "he", "she", "also", "both", "each", "all", "any", "some", "such", "only",
  ]);
  if (isInflectionalVariant(original, alt)) return "inflection";
  if (FUNCTION_WORDS.has(norm(original)) || FUNCTION_WORDS.has(norm(alt))) return "function";
  return "content";
}

/**
 * 组装 AI 提示：给整段 + 逐空(碎片)，要 AI 枚举每个空里「以碎片开头 且 语法语义都通」
 * 的所有常见词。故意不告诉 AI 原词，避免它只复述答案。
 */
function buildUniquenessPrompt(item) {
  const sentences = [];
  item.blanks.forEach((b, i) => {
    sentences.push(`Blank ${i + 1}: shown letters "${b.displayed_fragment}" (the full word starts with exactly these letters)`);
  });
  return `You are auditing a C-test (word-completion) passage for UNIQUENESS. Some words have only their first letters shown; the reader must complete each to the ONE word the author intended.

For each blank, list EVERY common English word that BOTH:
  (a) starts with exactly the shown letters, AND
  (b) fits the sentence grammatically AND makes sense in context here.
Only include words a careful reader would accept as genuinely correct in THIS context — not merely words that start with those letters. If the context (subject-verb agreement, reference, collocation, meaning) locks the blank to a single word, return just that one word.

## PASSAGE (blanks shown with their given letters)
${item.blanked_text}

## BLANKS
${sentences.join("\n")}

## OUTPUT
Return ONLY JSON mapping each blank number to the array of acceptable words, most-likely first:
{ "1": ["word"], "2": ["worda", "wordb"], ... }`;
}

function parseAlternatives(raw) {
  const cleaned = String(raw).replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const obj = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const idx = Number(String(k).replace(/\D/g, "")) - 1;
    if (!Number.isInteger(idx) || idx < 0) continue;
    out[idx] = Array.isArray(v) ? v.map(String) : [String(v)];
  }
  return out;
}

/**
 * 分析单个空：AI 列的候选里，凡「以碎片开头 且 ≠ 原词」的，都算一个第二解。
 * 返回 { multiSolution, alternatives:[{word,kind}], original, fragment }。
 */
function analyzeBlank(blank, aiWords) {
  const original = blank.original_word;
  const fragment = blank.displayed_fragment;
  const alternatives = [];
  for (const w of aiWords || []) {
    if (!matchesFragment(w, fragment)) continue;   // 不合碎片 = AI 手滑，丢弃
    if (norm(w) === norm(original)) continue;        // 就是原词，跳过
    if (alternatives.some((a) => norm(a.word) === norm(w))) continue; // 去重
    alternatives.push({ word: w, kind: classify(fragment, original, w) });
  }
  return { fragment, original, multiSolution: alternatives.length > 0, alternatives };
}

/**
 * 检查整题。callAI: (prompt) => Promise<string>。
 * 返回 { blanks:[analyzeBlank...], multiSolutionBlanks:[{index,...}], error? }。
 */
async function checkItemUniqueness(item, callAI) {
  let raw;
  try {
    raw = await callAI(buildUniquenessPrompt(item));
  } catch (err) {
    return { error: "AI call failed: " + err.message, blanks: [], multiSolutionBlanks: [] };
  }
  let alts;
  try {
    alts = parseAlternatives(raw);
  } catch (err) {
    return { error: "parse failed: " + err.message, blanks: [], multiSolutionBlanks: [] };
  }
  const blanks = item.blanks.map((b, i) => ({ index: i, ...analyzeBlank(b, alts[i]) }));
  return { blanks, multiSolutionBlanks: blanks.filter((b) => b.multiSolution) };
}

module.exports = {
  norm,
  matchesFragment,
  isInflectionalVariant,
  classify,
  buildUniquenessPrompt,
  parseAlternatives,
  analyzeBlank,
  checkItemUniqueness,
};
