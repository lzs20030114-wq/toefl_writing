// 原文里标出「在这篇里查词典收藏过的词」：单词本卡片的语境句（sentence / sentences）落在这篇原文里，
// 就把这个词在原文里的出现位置标出来。纯函数，DOM 上怎么画见 components/notes/useVocabMarks。

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 一个词在原文里的正则片段：词组里的空白放宽成任意空白，单词顺带认常见词尾变化。 */
export function wordPattern(word) {
  const w = String(word || "").trim();
  if (!w) return "";
  if (/\s/.test(w)) return esc(w).replace(/\s+/g, "\\s+");
  if (/[^aeiou]y$/i.test(w)) return `${esc(w.slice(0, -1))}(?:y|ies|ied|ying)`;
  if (/e$/i.test(w) && w.length > 3) return `${esc(w.slice(0, -1))}(?:e|es|ed|ing)`;
  return `${esc(w)}(?:s|es|ed|ing)?`;
}

/** 单词本里哪些词是在这篇原文里收藏的（语境句出现在原文里），返回要标的词（去重、长的在前）。 */
export function savedWordsInPassage(cards, passage) {
  const text = ` ${norm(passage)} `;
  if (text.trim() === "") return [];
  const words = new Set();
  for (const c of cards || []) {
    if (!c || c.deletedAt || !c.word) continue;
    const ctx = [c.sentence, ...(Array.isArray(c.sentences) ? c.sentences : [])].map(norm).filter((s) => s.length >= 8);
    if (!ctx.some((s) => text.includes(` ${s} `))) continue;
    words.add(String(c.word).toLowerCase());
    if (c.display) words.add(String(c.display).toLowerCase());
  }
  return [...words].sort((a, b) => b.length - a.length);
}
