/**
 * AP（学术阅读）正文的「段落版面」纯函数层。
 *
 * 为什么要有这一层：AP 条目有两个正文字段 —— passage（渲染用的整篇文字）与
 * paragraphs[]（段落数组，既是选句题 paragraph_index 的下标空间，也是题干「paragraph N」
 * 数出来的那个 N）。出题模型是分别产出这两个字段的，偶尔给出一个用单空格拼起来、
 * 不带空行的 passage；而渲染层（components/reading/RDLTask.js 的 whiteSpace: "pre-wrap"）
 * 只认 passage 里的空行 —— 于是整篇糊成一坨。AP 505 道题里有 398 道题干写着
 * 「According to paragraph 2」，糊成一坨的那篇基本没法做。
 * 2026-09-18 实测常规库 101 条里 15 条中招（14 条整篇无空行 + 1 条段落错序）。
 *
 * 口径三条，改之前先读完：
 *  1. **passage 是权威正文，paragraphs 是它的段落切分**。库里有 7 条带插入句标记 [■] 的条目，
 *     标记只写在 passage 里、paragraphs 里被剥掉了 —— 所以补分段一律是「往 passage 里插空行」，
 *     绝不能写成 paragraphs.join("\n\n")：那样会把 [■] 吃掉，插入句题当场没有位置可选。
 *  2. **只动段落之间的空白，段内一个字符都不碰**。选句题的 locateParagraph()
 *     （lib/reading/sentenceSelection.js）是拿 paragraphs[i] 去正文里做精确 indexOf 定位的，
 *     段内文字一旦被改写，那道题就地变成点不了的死题。
 *  3. **对不上就原样返回，不猜**。段落在正文里错序时（有过一条：第 2 段的尾句被甩到文末）
 *     定位会失败，此时保持原样 + 让 validator 报错交给人看，比自动重排安全。
 *
 * 纯函数、CommonJS —— apValidator / merge-staging 要 require，前端组件按命名导入
 * （precedent: lib/questionBank/renderResponseSentence.js）。
 */

// 段落定位只看字母与数字：空白、标点、插入句标记 [■] 一律不参与匹配，
// 于是「passage 带标记 / paragraphs 不带」也能对得上。
const ALNUM_RE = /[\p{L}\p{N}]/u;

// 段首可能粘着的开引号 / 开括号 —— 定位点落在首个字母上，这些要一起划给本段。
// 故意不收 "["：正文里的 [■] 属于它前面那一段，收了会在无空格相接时把标记拽到下一段。
const OPENING_PUNCT = new Set(['"', "'", "“", "‘", "(", "«", "《"]);

/** 正文按空行切出的段落块（trim 过、不留空块）—— 与 sentenceSelection.readingParagraphs 同口径。 */
function paragraphBlocks(passage) {
  return String(passage ?? "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 取字符串的「字母数字键」+ 每个键字符回原串的下标，用于跨标点/空白/标记的定位。 */
function alnumKey(s) {
  const src = String(s ?? "");
  let key = "";
  const map = [];
  for (let i = 0; i < src.length; i += 1) {
    if (ALNUM_RE.test(src[i])) {
      key += src[i].toLowerCase();
      map.push(i);
    }
  }
  return { key, map };
}

/** paragraphs 数组归一：逐项 trim、丢掉空项（空段不占正文位置）。 */
function cleanParagraphs(paragraphs) {
  if (!Array.isArray(paragraphs)) return [];
  return paragraphs.map((p) => String(p ?? "").trim()).filter(Boolean);
}

/**
 * passage 的空行分段与 paragraphs 数组是否对得上（段数相同 + 逐段字母数字一致）。
 * 比的是字母数字键而不是原串：带 [■] 的条目 passage 与 paragraphs 本来就不逐字相等。
 * 段落数组给不出 2 段以上时视为「没有可校验的版面」，返回 true（不制造假阳性）。
 */
function isParagraphLayoutSynced(passage, paragraphs) {
  const list = cleanParagraphs(paragraphs);
  if (list.length < 2) return true;
  const blocks = paragraphBlocks(passage);
  if (blocks.length !== list.length) return false;
  return blocks.every((b, i) => alnumKey(b).key === alnumKey(list[i]).key);
}

/** 段落真正的起点：定位点落在首个字母上，往前把粘着的开引号 / 开括号带上。 */
function paragraphStart(src, at) {
  let i = at;
  while (i > 0 && OPENING_PUNCT.has(src[i - 1])) i -= 1;
  return i;
}

/**
 * 按 paragraphs 的边界把空行补回 passage；补不了就原样返回（本函数永不抛）。
 *
 * 只往段与段之间写 "\n\n"，段内文字逐字保留 —— 返回值与入参的**非空白字符序列完全相同**，
 * 函数末尾那道 bare() 断言就是钉这件事的，任何一步定位出偏差都会在那里退回原文。
 */
function restoreParagraphBreaks(passage, paragraphs) {
  const src = String(passage ?? "");
  const list = cleanParagraphs(paragraphs);
  if (list.length < 2 || !src.trim()) return src;
  if (isParagraphLayoutSynced(src, list)) return src;

  const { key, map } = alnumKey(src);
  const starts = [];
  let cursor = 0;
  for (let i = 0; i < list.length; i += 1) {
    const paraKey = alnumKey(list[i]).key;
    if (!paraKey) return src;
    const at = key.indexOf(paraKey, cursor);
    if (at < 0) return src; // 这一段在正文里找不到（错序 / 文字对不上）→ 不猜
    if (i > 0) starts.push(paragraphStart(src, map[at]));
    cursor = at + paraKey.length;
  }
  if (!starts.length) return src;

  const pieces = [];
  let prev = 0;
  for (const start of starts) {
    if (start <= prev) return src; // 段落重叠 → 定位不可信
    pieces.push(src.slice(prev, start));
    prev = start;
  }
  pieces.push(src.slice(prev));
  const rebuilt = pieces.map((s) => s.trim()).join("\n\n");

  // 唯一允许的改动就是空白。非空白字符只要有一处对不上就退回原文。
  const bare = (s) => String(s).replace(/\s+/g, "");
  return bare(rebuilt) === bare(src) ? rebuilt : src;
}

/**
 * 渲染侧入口：把条目的正文取成「该显示的样子」。
 * 组件拿到的 AP 适配对象是 { ...item, text: apPassageText(item) } —— 数据已经修好的条目
 * 原样透传，漏网的（旧存档、以后又出岔子的新题）在这里当场补回分段。
 */
function apPassageText(item) {
  const raw = item?.text || item?.passage || "";
  return restoreParagraphBreaks(raw, item?.paragraphs);
}

module.exports = {
  paragraphBlocks,
  cleanParagraphs,
  isParagraphLayoutSynced,
  restoreParagraphBreaks,
  apPassageText,
};
