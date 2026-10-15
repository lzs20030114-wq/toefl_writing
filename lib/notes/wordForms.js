// 「列出所有词形」的结构化回答：AI 在回答里写一段
//   [词形]
//   analysis｜n.｜分析｜原词，复数 analyses｜Further analysis is needed.
//   analyze｜v.｜分析｜动词｜Engineers analyze the signal.
//   [/词形]
// 前端把这段拆成一行一个词形的列表，每个词形都能直接收藏进单词本。
// 没写这段（旧笔记、AI 没照格式）就整段按普通回答显示。

export const FORMS_OPEN = "[词形]";
export const FORMS_CLOSE = "[/词形]";

const BLOCK_RE = /\[\s*词形\s*\]([\s\S]*?)(?:\[\s*\/\s*词形\s*\]|$)/;
const WORD_RE = /^[A-Za-z][A-Za-z'’-]*(?: [A-Za-z][A-Za-z'’-]*){0,2}$/;
const MAX_FORMS = 24;

function clean(s) {
  return String(s || "").replace(/\*\*/g, "").trim();
}

/** 解析一行「词形｜词性｜中文｜说明｜例句」。词形不像英文单词 / 短语就丢掉。 */
export function parseFormLine(line) {
  const raw = String(line || "").replace(/^\s*(?:[-*•·]|\d+[.)、])\s*/, "").trim();
  if (!raw) return null;
  const cells = raw.split(/\s*[｜|]\s*/).map(clean);
  const word = cells[0];
  if (!word || !WORD_RE.test(word) || cells.length < 2) return null;
  const [, pos = "", zh = "", note = "", ...rest] = cells;
  return { word, pos, zh, note, example: rest.join(" | ").trim() };
}

/**
 * 把回答拆成 { before, forms, after }。没有词形段、或段里一行都解析不出来时返回 null。
 * 同一个词形只留第一行。
 */
export function splitWordForms(text) {
  const src = String(text || "");
  const m = src.match(BLOCK_RE);
  if (!m) return null;
  const seen = new Set();
  const forms = [];
  for (const line of m[1].split(/\n/)) {
    const f = parseFormLine(line);
    if (!f) continue;
    const key = f.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    forms.push(f);
    if (forms.length >= MAX_FORMS) break;
  }
  if (!forms.length) return null;
  return {
    before: src.slice(0, m.index).trim(),
    forms,
    after: src.slice(m.index + m[0].length).trim(),
  };
}

/** 例句里有没有这个词形（整词、忽略大小写）。 */
export function exampleHasForm(example, word) {
  const w = String(word || "").trim();
  if (!w || !example) return false;
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^A-Za-z])${esc}([^A-Za-z]|$)`, "i").test(example);
}

/**
 * 收藏一个词形时交给 vocabStore.saveWord 的 entry。
 * 释义写成「v. 分析」（带词性，单词本就不会再去词典补释义）；例句里有这个词形才当语境句存。
 * dict：ECDICT 词条（查到的就是这个词本身时才用它的音标）。
 */
export function formVocabEntry(form, { dict = null, family = "" } = {}) {
  const word = String(form?.word || "").trim();
  const def = [clean(form?.pos), clean(form?.zh)].filter(Boolean).join(" ");
  const sameWord = dict && String(dict.word || "").toLowerCase() === word.toLowerCase();
  return {
    word: word.toLowerCase(),
    display: word,
    phonetic: sameWord ? dict.p || "" : "",
    def,
    defFull: def,
    tag: "",
    sentence: exampleHasForm(form?.example, word) ? clean(form.example).slice(0, 400) : "",
    source: "passage-note",
    definitionLocked: !!def,
    reviewMode: "reading",
    // 词形组：复习时同组词连着出现（见 lib/vocab/book.js clusterFamilies）。
    family: String(family || "").trim().toLowerCase(),
  };
}

/**
 * 这张词形表成组时用的组名：学生选中的那个词在表里就用它（machinery），
 * 否则用表里第一个词形（AI 按格式把原词写在第一行）。
 */
export function familyHead(forms, quote = "") {
  const list = Array.isArray(forms) ? forms : [];
  const q = String(quote || "").trim().toLowerCase();
  const hit = q && list.find((f) => String(f?.word || "").toLowerCase() === q);
  return String((hit || list[0])?.word || "").trim().toLowerCase();
}
