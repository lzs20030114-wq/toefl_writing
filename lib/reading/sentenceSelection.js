/**
 * 真题学术阅读「选句题」（question_type: "sentence_selection"）的纯函数层。
 *
 * 数据契约（流水线 scripts/realbank/** 按此产出，前端按此消费，字段不许改）：
 *   { question_type: "sentence_selection",
 *     stem: "Identify the sentence in paragraph 4 that …",
 *     paragraph: 4,
 *     paragraph_index: 4,
 *     options: { S1: "…", S2: "…", …, Sn: "…" },
 *     correct_answer: "S4", q_number: 29 }
 *   · paragraph_index（必填）：该段在条目 paragraphs 数组里的 0 起下标 —— **定位段落一律按它**。
 *     流水线保证 paragraphs[paragraph_index] 就是含正确句的那一段。
 *   · paragraph：题干里的段号（1 起），**只用于展示**（右栏「点击左侧文章第 N 段中的一句作答」/ 复盘）。
 *     为什么两个字段：paragraphs[0] 不一定是标题（真题库实测 99 篇 AP 里 47 篇第 0 段就是正文），
 *     「题干第 4 段 = paragraphs[4]」这个换算不成立，得由流水线直接给下标。
 *   · options 按顺序是该段的每一句，值是该段文字的**精确子串**（空白原样），按顺序 indexOf 定位；
 *     句数不定（2~8 句都可能），不是固定四项；
 *   · 作答值 = "S1".."Sn"，判分 `answer === correct_answer`（与四选一同口径）。
 *
 * 为什么 mapper（lib/realBank.js）和渲染（components/reading/RDLTask.js）必须共用这一份：
 * mapper 放行的题，RDLTask 必须能在正文里把每一句圈出来。两边各写一套切段 / 定位，
 * 迟早出现「mapper 放行、组件定位不到」—— 用户看到的就是一道点不了的死题。
 * 所以 mapper 的最后一道闸就是直接调 sentenceSelectionLayout：能排出版面才收。
 *
 * 纯函数、无 React、不碰题库 JSON —— 历史页 / 错题本也能放心引。
 */

export const SENTENCE_SELECTION_TYPE = "sentence_selection";

const SENTENCE_KEY_RE = /^S([1-9]\d*)$/;

/**
 * 「点选句子」作答形式 = 题型是 sentence_selection **且** 选项是 S1..Sn 句子键
 * （与流水线 scripts/realbank/sentence_select.js 的 isSentenceSelectQuestion 同口径）。
 * 只看题型不够：第二来源把一部分选句题拍成了 A–D 四选一（选项就是正文里的四句），
 * 建库按题干推断时同样标成 sentence_selection —— 那种题是普通选择题，照 A–D 渲染、题号行仍显示「选句」，
 * 若按点选处理会因为没有 paragraph_index 被 mapper 整题丢掉。
 */
export function isSentenceSelection(question) {
  if (String(question?.question_type || "").trim() !== SENTENCE_SELECTION_TYPE) return false;
  return sentenceOptionKeys(question?.options).length > 0;
}

/** options 里的 S 键按序号排好（S1, S2, … S10）；不是 S 键的不收。 */
export function sentenceOptionKeys(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return [];
  return Object.keys(options)
    .filter((k) => SENTENCE_KEY_RE.test(k))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

/** 取某个 S 键对应的句子原文（取不到返回空串）。 */
export function sentenceOptionText(question, key) {
  if (!key) return "";
  return String(question?.options?.[key] ?? "").trim();
}

/**
 * 条目的段落数组（paragraph_index 的下标空间）。
 * 有 item.paragraphs（且不全是空串）就用它：逐项 trim、**不滤空** —— 滤掉一个空段，后面每一段的下标
 * 都会错一位，与流水线写的 paragraph_index 对不上。没有时按空行切 text / passage（与 AP 条目同口径，
 * 标题若在正文开头也算一段）。
 */
export function readingParagraphs(item) {
  const own = Array.isArray(item?.paragraphs) ? item.paragraphs.map((p) => String(p ?? "").trim()) : [];
  if (own.some(Boolean)) return own;
  return String(item?.text ?? item?.passage ?? "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 选句题该在 paragraphs 的哪一段定位；给不出合法下标返回 -1。
 *   · 带 paragraph_index（契约必填）→ 一律按它，不再看 paragraph；不是 ≥0 整数或越界 → -1，不猜。
 *   · 不带（null / 缺字段）→ 兼容旧口径 paragraphs[paragraph]（假定第 0 段是标题）。
 *     这一支只可能来自没经过 mapper 的调用方（mapper 对缺 paragraph_index 的题直接拒收）；
 *     标题假设不成立时句子在那一段里找不到，照样退回列表作答 —— 精确子串按序匹配，不会圈错句。
 */
export function selectionParagraphIndex(question, paragraphs) {
  const count = Array.isArray(paragraphs) ? paragraphs.length : 0;
  const idx = question?.paragraph_index != null ? question.paragraph_index : question?.paragraph;
  return Number.isInteger(idx) && idx >= 0 && idx < count ? idx : -1;
}

/**
 * 在全文 text 里定位 paragraphs[n] 的字符区间 { start, end }；定位不到返回 null。
 * 先按顺序逐段往后找（同样的文字在文中出现两次也不会认错段）；前面某段在全文里找不到
 * （passage 没带标题段，或复核补丁只改了 passage 没同步 paragraphs）时，退回直接找这一段。
 * 空段不占位置（按下标对齐保留下来的空串）。
 */
export function locateParagraph(text, paragraphs, n) {
  const src = String(text ?? "");
  const list = Array.isArray(paragraphs) ? paragraphs.map((p) => String(p ?? "")) : [];
  const target = Number.isInteger(n) ? list[n] : "";
  if (!target) return null;
  let from = 0;
  for (let k = 0; k <= n; k += 1) {
    if (!list[k]) continue;
    const at = src.indexOf(list[k], from);
    if (at < 0) break;
    if (k === n) return { start: at, end: at + target.length };
    from = at + list[k].length;
  }
  const at = src.indexOf(target);
  return at < 0 ? null : { start: at, end: at + target.length };
}

/**
 * 选句题在全文里的版面：
 *   { paragraph, paragraphIndex, start, end, sentences: [{ key, text, start, end }] }
 * paragraph 是展示用段号；paragraphIndex 是实际定位用的 paragraphs 下标；
 * start/end 是该段在 item.text（缺省 item.passage）里的区间，sentences 按 S1..Sn 顺序。
 * 任何一步对不上都返回 null —— 组件据此降级成右栏列表作答，mapper 据此拒收。
 */
export function sentenceSelectionLayout(item, question) {
  if (!isSentenceSelection(question)) return null;
  const n = question?.paragraph;
  if (!Number.isInteger(n) || n < 1) return null;
  const keys = sentenceOptionKeys(question.options);
  if (keys.length < 2 || keys.some((k, i) => k !== `S${i + 1}`)) return null;

  const text = String(item?.text ?? item?.passage ?? "");
  const paragraphs = readingParagraphs(item);
  const index = selectionParagraphIndex(question, paragraphs);
  if (index < 0) return null;
  const span = locateParagraph(text, paragraphs, index);
  if (!span) return null;

  const sentences = [];
  let from = span.start;
  for (const key of keys) {
    const sentence = sentenceOptionText(question, key);
    if (!sentence) return null;
    const at = text.indexOf(sentence, from);
    if (at < 0 || at + sentence.length > span.end) return null;
    sentences.push({ key, text: sentence, start: at, end: at + sentence.length });
    from = at + sentence.length;
  }
  return { paragraph: n, paragraphIndex: index, start: span.start, end: span.end, sentences };
}

/**
 * 按版面把全文切成三截：段前文字 / 目标段（句子与句间空白交替）/ 段后文字。
 * 没有版面时整篇都在 before 里。
 */
export function sentenceSelectionSegments(text, layout) {
  const src = String(text ?? "");
  if (!layout) return { before: src, paragraph: [], after: "" };
  const paragraph = [];
  let cursor = layout.start;
  for (const s of layout.sentences) {
    if (s.start > cursor) paragraph.push({ type: "text", text: src.slice(cursor, s.start) });
    paragraph.push({ type: "sentence", key: s.key, text: src.slice(s.start, s.end) });
    cursor = s.end;
  }
  if (layout.end > cursor) paragraph.push({ type: "text", text: src.slice(cursor, layout.end) });
  return { before: src.slice(0, layout.start), paragraph, after: src.slice(layout.end) };
}

/**
 * 选句题体检 + 归一化（lib/realBank.js 的 mapper 用），过不了返回 null：
 *   stem 非空；paragraph 为 ≥1 整数（展示用）；paragraph_index 为 ≥0 整数且 < paragraphs.length
 *   （缺失即拒收）；options 键恰为 S1..Sn 连续且 n≥2（不许混进别的键）；每句非空；
 *   correct_answer 在键里；每一句都能在 paragraphs[paragraph_index] 里按顺序找到，且该段在正文里定位得到。
 * item 形如 { text | passage, paragraphs? } —— 必须与组件实际拿到的正文、段落数组同源。
 */
export function normalizeSentenceSelection(rawQuestion, item) {
  const q = rawQuestion && typeof rawQuestion === "object" ? rawQuestion : {};
  if (!isSentenceSelection(q)) return null;
  const stem = String(q.stem || "").trim();
  if (!stem) return null;
  if (!Number.isInteger(q.paragraph) || q.paragraph < 1) return null;
  const paragraphCount = readingParagraphs(item).length;
  if (!Number.isInteger(q.paragraph_index) || q.paragraph_index < 0 || q.paragraph_index >= paragraphCount) return null;

  const rawOptions = q.options && typeof q.options === "object" && !Array.isArray(q.options) ? q.options : null;
  if (!rawOptions) return null;
  const keys = sentenceOptionKeys(rawOptions);
  if (keys.length < 2 || keys.length !== Object.keys(rawOptions).length) return null;
  if (keys.some((k, i) => k !== `S${i + 1}`)) return null;

  const options = {};
  for (const key of keys) {
    const v = String(rawOptions[key] ?? "").trim();
    if (!v) return null;
    options[key] = v;
  }
  const answer = String(q.correct_answer || "").trim().toUpperCase();
  if (!keys.includes(answer)) return null;

  const normalized = {
    question_type: SENTENCE_SELECTION_TYPE,
    stem,
    paragraph: q.paragraph,
    paragraph_index: q.paragraph_index,
    options,
    correct_answer: answer,
    ...(String(q.explanation || "").trim() && { explanation: String(q.explanation).trim() }),
  };
  return sentenceSelectionLayout(item, normalized) ? normalized : null;
}
