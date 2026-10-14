// 「常见搭配」的结构化回答：AI 在回答里写一段
//   [搭配]
//   different frequency｜不同的频率｜Each station uses a different frequency.
//   differ from｜与……不同｜Cats differ from dogs in many ways.
//   [/搭配]
// 前端拆成一行一个搭配的列表（和词形表同一个组件，每行能收藏进单词本）。没写这段就整段按普通回答显示。

const BLOCK_RE = /\[\s*搭配\s*\]([\s\S]*?)(?:\[\s*\/\s*搭配\s*\]|$)/;
const PHRASE_RE = /^[A-Za-z][A-Za-z'’-]*(?:\s+(?:[A-Za-z][A-Za-z'’-]*|sth\.?|sb\.?|…|\.\.\.|\/))*$/;
const MAX_ROWS = 8;

const clean = (s) => String(s || "").replace(/\*\*/g, "").trim();

/** 解析一行「搭配｜中文｜例句」。搭配不像英文短语（最多 7 个词）就丢掉。 */
export function parseCollocationLine(line) {
  const raw = String(line || "").replace(/^\s*(?:[-*•·]|\d+[.)、])\s*/, "").trim();
  if (!raw) return null;
  const cells = raw.split(/\s*[｜|]\s*/).map(clean);
  const phrase = cells[0];
  if (!phrase || cells.length < 2 || !PHRASE_RE.test(phrase) || phrase.split(/\s+/).length > 7) return null;
  const [, zh = "", ...rest] = cells;
  return { word: phrase, pos: "", zh, note: "", example: rest.join(" | ").trim() };
}

/** 把回答拆成 { before, forms, after }（forms 与词形表同形，给 WordFormList 用）。没有搭配段时返回 null。 */
export function splitCollocations(text) {
  const src = String(text || "");
  const m = src.match(BLOCK_RE);
  if (!m) return null;
  const seen = new Set();
  const forms = [];
  for (const line of m[1].split(/\n/)) {
    const f = parseCollocationLine(line);
    if (!f) continue;
    const key = f.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    forms.push(f);
    if (forms.length >= MAX_ROWS) break;
  }
  if (!forms.length) return null;
  return { before: src.slice(0, m.index).trim(), forms, after: src.slice(m.index + m[0].length).trim() };
}
