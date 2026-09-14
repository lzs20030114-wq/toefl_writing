// CTW（Complete the Words）挖空词在正文 token 里的切分：token = lead + 词 + tail。
//
// 各处渲染都是 `passage.split(/\s+/)` 后按 blanks[].position 找到挖空的那个 token，再印
// 「灰底前缀 + 输入框」。token 上粘着的标点得原样印在两边，否则屏幕上的原文就少字：
//   · 绝大多数是尾标点："word." / "word,"（2026-09-14 前各处只认 /[.,;:!?]+$/ 这一种）；
//   · 真题里还有 "(like" / "rain)."（括号）、"region—not"（破折号连写，挖的是 region）——
//     这几篇以前在建库时就整篇扔掉了，scripts/realbank/build_bank.mjs 现在按「词芯」收下它们，
//     original_word 只存词本身，括号和破折号后半截留在 token 里，靠这里切回来。
//
// 兜底 = 旧行为：original_word 在 token 里找不到，或切出来的前后缀里夹着字母（说明 token 与词对不上，
// 不是标点问题），就退回「无前缀 + 尾标点」—— 线上库 5529 个空全部是 token = 词 + 尾标点，
// 切出来与旧写法逐字相同（__tests__/ctw-token.test.js 对全库锁死）。

const TRAILING_PUNCT = /[.,;:!?]+$/;

/**
 * @param {string} token        passage.split(/\s+/)[position]
 * @param {string} originalWord blank.original_word
 * @returns {{lead: string, tail: string}}
 */
export function splitBlankToken(token, originalWord) {
  const t = String(token || "");
  const w = String(originalWord || "");
  const fallback = { lead: "", tail: (t.match(TRAILING_PUNCT) || [""])[0] };
  if (!w) return fallback;
  const at = t.toLowerCase().indexOf(w.toLowerCase());
  if (at < 0) return fallback;
  const lead = t.slice(0, at);
  const tail = t.slice(at + w.length);
  // 前缀不许有字母数字；后缀不许以字母数字开头（"region—not" 的 "—not" 可以，"likes" 的 "s" 不行）
  if (/[A-Za-z0-9]/.test(lead) || /^[A-Za-z0-9]/.test(tail)) return fallback;
  return { lead, tail };
}
