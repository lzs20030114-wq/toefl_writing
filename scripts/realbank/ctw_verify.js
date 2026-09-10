/**
 * 真题 CTW（C-test 单词补全）结构化产物的逐空校验（纯函数，无 IO ——
 * structure_set.mjs 与 __tests__/realbank-ctw-verify.test.js 共用）。
 *
 * 模型只负责把 OCR 汤还原成 {passage, blanks:[{word, given}]}，答案来自官方答案页。
 * 这里逐空核对「模型还原的词」与「答案页给的词」对不对得上；过不了整块 flagged、不入库。
 *
 * 答案页有两种写法，都是真题源料的原样：
 *
 *  1. **整词**（绝大多数卷）：答案页写 "male"，屏幕残留 "ma" → word="male"、given="ma"。
 *     判据：word === 答案词，且 given 是它的真前缀。
 *
 *  2. **后半截**（source-flags 标 ctw_answer_truncated 的 13 套第一来源卷）：答案页只写考生要填的
 *     那半截 "le"。旧判据把它当「答案词首被砍」，这 13 套的填词一篇都没进库。
 *     2026-09-10 看原始残片后确认不是乱砍：C-test 屏幕保留前 floor(n/2) 个字母，答案页给的恰是
 *     剩下那半截 —— 13 套现存 200 条残片**全部**同时满足
 *         word === given + 答案残片      且      given.length === floor(word.length / 2)
 *     所以按这两条确定性还原；任何一条不成立，仍按旧口径报错。
 *     第二条专防「整词 + 前缀重复」的假阳性（"pl" + "place" = "plplace"：前缀只占 2/7，过不了）。
 *
 * floor(n/2) **不能**反过来当整词写法的判据：线上库 870 个空只有 92% 满足（OCR 残留字母数本身
 * 有出入），它只在「答案页给的是残片」这个分支里当第二道锁。
 */
const CJK = /[一-鿿]/;

const countWords = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const low = (s) => String(s == null ? "" : s).trim().toLowerCase();

/**
 * 单个空：答案页词 × 模型还原的词 × 屏幕前缀 → 对不对得上。
 *
 * @param {string} answer 答案页给的（整词或后半截）
 * @param {string} word   模型还原的完整词
 * @param {string} given  屏幕上保留的前缀
 * @param {number} index  第几个空（0 起，只用于报错文案）
 * @returns {{ok: boolean, form: "full"|"suffix"|null, word: string, problems: string[]}}
 *   word 是这个空的完整词（小写）；form=suffix 表示答案页给的是后半截。
 */
function resolveBlank(answer, word, given, index = 0) {
  const want = low(answer);
  const got = low(word);
  const g = low(given);
  if (got === want && g && want.startsWith(g) && g.length < want.length) {
    return { ok: true, form: "full", word: got, problems: [] };
  }
  if (g && want && got && got === g + want && g.length === Math.floor(got.length / 2)) {
    return { ok: true, form: "suffix", word: got, problems: [] };
  }
  const n = index + 1;
  const problems = [];
  if (got !== want) problems.push(`第 ${n} 空：还原成 "${got}"，答案是 "${want}"`);
  if (!g || !want.startsWith(g)) problems.push(`第 ${n} 空：给定前缀 "${g}" 不是 "${want}" 的前缀`);
  if (g.length >= want.length) problems.push(`第 ${n} 空：前缀 "${g}" 没留下要填的部分`);
  return { ok: false, form: null, word: got, problems };
}

/**
 * 整块 CTW 校验。返回问题清单（空数组 = 通过）。
 *
 * @param {{passage?: string, blanks?: Array<{word: string, given: string}>}} item 模型产出
 * @param {string[]} answerWords 答案页给的词（按出现顺序）
 */
function verifyCtw(item, answerWords) {
  const p = [];
  const blanks = Array.isArray(item && item.blanks) ? item.blanks : [];
  const answers = Array.isArray(answerWords) ? answerWords : [];
  if (blanks.length !== answers.length) {
    p.push(`空位数 ${blanks.length} ≠ 答案词数 ${answers.length}`);
    return p;
  }
  const resolved = [];
  blanks.forEach((b, i) => {
    const r = resolveBlank(answers[i], b && b.word, b && b.given, i);
    p.push(...r.problems);
    // 段落里要找的是完整词：后半截写法下答案页的 "le" 本来就不会单独出现在原文里。
    resolved.push(r.ok ? r.word : low(answers[i]));
  });
  const passage = String((item && item.passage) || "");
  if (countWords(passage) < 30) p.push("还原段落过短");
  if (CJK.test(passage)) p.push("段落里混入中文");
  for (const w of resolved) {
    if (!new RegExp(`\\b${w.replace(/[^\w]/g, "")}\\b`, "i").test(passage)) {
      p.push(`还原段落里找不到答案词 "${w}"`);
      break;
    }
  }
  return p;
}

module.exports = { resolveBlank, verifyCtw };
