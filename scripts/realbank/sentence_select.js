/**
 * 真题学术阅读「点选句子」题（Identify the sentence in paragraph N that …）的纯函数工具
 * —— 无 IO，供 build_bank.mjs、consolidate_reading.js、sentence_select_ledger.mjs、
 * audit_sentence_select.mjs 与单测共用。
 *
 * ── 这类题长什么样 ──────────────────────────────────────────────────────
 * 真考界面没有 A–D：题干说「在第 N 段里找出那句 …」，考生直接在左侧正文里点一句。
 * 答案页给的也不是字母，是那句话的开头几个词（"urban planners"、"however"、"some insist..."）。
 * 管线原先把它们当「选项数异常 / 答案不是单个字母」判 flagged 丢掉了。
 *
 * ── 题目契约（前端按此实现，一字不差）──────────────────────────────────
 *   { question_type: "sentence_selection",
 *     stem: "Identify the sentence in paragraph 4 that …",     // 去掉界面指令
 *     paragraph: 4,                                            // 题干里写的段号，只用于显示
 *     paragraph_index: 4,                                      // 该段在 paragraphs 里的 0 起下标，前端按它定位
 *     options: { S1: "…", S2: "…", … },                        // 该段逐句，按顺序
 *     correct_answer: "S3",
 *     q_number: 29 }
 * options 的每个值都必须是 paragraphs[paragraph_index] 的**精确子串**（空白原样保留），前端靠
 * 顺序 indexOf 在段落里定位高亮 —— 所以分句器只切边界、绝不改写句子内部的任何字符。
 * paragraph_index 不等于 paragraph：近半数 AP 条目的 paragraphs[0] 不是干净标题（没有标题 / 标题粘在首段），
 * 题干「第 N 段」得按标题检测换算（expectedParagraphIndex），且必须与正确句真正所在的那段一致。
 *
 * ── 正确句怎么定 ────────────────────────────────────────────────────────
 * 答案页的开头词在**该段**里做句首匹配，必须**唯一**命中；逐词比「答案词是句子对应词的前缀」
 * （答案页常把 "Rogers claimed" 抄成 "roger claimed"，所有格/复数被截掉）。命中不唯一就不收 ——
 * 宁可少一道题，不许把「some」猜到另一句 "Sometimes…" 上。
 */

const crypto = require("crypto");

/* ── 分句 ─────────────────────────────────────────────────────────────── */

// 句点后面跟空白也**不是**句子边界的缩写（小写比较）。
// 单个大写字母加点（人名缩写 "J. K. Rowling"）另行处理。
const ABBREVIATIONS = new Set([
  "u.s", "u.k", "u.n", "e.g", "i.e", "etc", "vs", "cf", "al", "approx", "fig", "figs", "no", "nos",
  "dr", "mr", "mrs", "ms", "prof", "st", "jr", "sr", "inc", "ltd", "co", "corp", "dept", "est",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "a.m", "p.m", "ph.d", "b.c", "a.d", "vol", "pp", "ed", "eds", "gen", "gov", "mt", "ft",
]);
// 这些缩写后面紧跟大写词时**可能**真的是句末（"… in the U.S. The study …"），
// 但我们宁可少切一刀（两句并成一个选项，正确句定位会失败 → 这道题不收），也不在人名/机构名中间切开。

const CLOSERS = `"'”’)]`;

/**
 * 段落 → 句子数组。每个元素都是 `text` 的精确子串（首尾不含句间空白）。
 *
 * 边界 = `.` `!` `?`（可跟若干个右引号/右括号），后面是空白，再后面是大写字母 / 数字 /
 * 左引号 / 左括号。例外：已知缩写（U.S. / Dr. / e.g. …）、单个大写字母缩写（J. K.）、
 * 小数（3.5 —— 点后没有空白，天然不切）。
 */
function splitSentences(text) {
  const s = String(text || "");
  const out = [];
  let start = 0;
  const pushSpan = (a, b) => {
    let i = a, j = b;
    while (i < j && /\s/.test(s[i])) i += 1;
    while (j > i && /\s/.test(s[j - 1])) j -= 1;
    if (j > i) out.push(s.slice(i, j));
  };
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    // 连续标点（"?!"、"..."）吃完再判
    let end = i + 1;
    while (end < s.length && /[.!?]/.test(s[end])) end += 1;
    while (end < s.length && CLOSERS.includes(s[end])) end += 1;
    // 后面必须是空白 + 句首字符
    let k = end;
    if (k >= s.length || !/\s/.test(s[k])) { i = end - 1; continue; }
    while (k < s.length && /\s/.test(s[k])) k += 1;
    if (k >= s.length) break;                       // 段尾：交给循环外收尾
    const next = s[k];
    if (!/[A-Z0-9"'“‘(\[]/.test(next)) { i = end - 1; continue; }
    if (ch === ".") {
      // 取句点前那个「词」（含内部点号，如 U.S / e.g / Ph.D）
      let w = i - 1;
      while (w >= 0 && /[A-Za-z.]/.test(s[w])) w -= 1;
      const word = s.slice(w + 1, i).toLowerCase();
      if (ABBREVIATIONS.has(word)) { i = end - 1; continue; }
      if (/^[a-z]$/i.test(word) && /[A-Z]/.test(s[i - 1] || "")) { i = end - 1; continue; }   // "J." 人名缩写
      // 省略号后面接大写：真考材料里几乎只出现在引语省略中，照切（句末省略号同样是句末）
    }
    pushSpan(start, end);
    start = k;
    i = k - 1;
  }
  pushSpan(start, s.length);
  return out;
}

/* ── 归一化 ───────────────────────────────────────────────────────────── */

const words = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").match(/[a-z0-9]+/g) || [];
const tokenSet = (s) => new Set(words(s).filter((w) => w.length > 2));
function jaccard(a, b) {
  const A = a instanceof Set ? a : tokenSet(a);
  const B = b instanceof Set ? b : tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/**
 * 答案页的原文 → 句首匹配用的词数组。
 * "however...（第二段最后一句）" → ["however"]；"some insist..." → ["some","insist"]。
 * 括号里的中文批注、省略号、标点一律去掉；剩下的英文词按顺序保留。
 */
function answerPrefixWords(raw) {
  const s = String(raw || "")
    .replace(/[（(][^）)]*[）)]/g, " ")      // 批注：（第二段最后一句） / (last sentence)
    .replace(/[\u3000-\u9fff\uff00-\uffef]+/g, " ")      // 残留的中日文字符 / 全角标点（U+3000–U+9FFF、U+FF00–U+FFEF）
    .replace(/\.{2,}|…/g, " ");
  return words(s);
}

/**
 * 在句子数组里找「以答案开头词起头」的那一句。返回 { index } 或 { error }。
 * 逐词比：答案第 k 个词必须是句子第 k 个词的前缀（"roger" 命中 "rogers"）。
 * 0 命中 → no_match；≥2 命中 → ambiguous（不猜）。
 */
function matchByPrefix(sentences, prefixWords) {
  const want = Array.isArray(prefixWords) ? prefixWords : answerPrefixWords(prefixWords);
  if (!want.length) return { error: "empty_prefix" };
  const hits = [];
  (sentences || []).forEach((sent, idx) => {
    const got = words(sent);
    if (got.length < want.length) return;
    for (let k = 0; k < want.length; k += 1) if (!got[k].startsWith(want[k])) return;
    hits.push(idx);
  });
  if (hits.length === 1) return { index: hits[0] };
  return { error: hits.length ? "ambiguous" : "no_match", hits };
}

/* ── 题干 ─────────────────────────────────────────────────────────────── */

/**
 * 去掉界面指令（"Select the sentence to make your choice."，含 OCR 截断的 "…to make your"），
 * 压空白。**不改写**题干本身的任何词。
 */
function cleanStem(raw) {
  let s = String(raw || "").replace(/\s+/g, " ").trim();
  s = s.replace(/\s*\bSelect\s+the\s+sentence\s+to\s+make\s+your(?:\s+choice)?\s*[.,;:]?\s*$/i, "");
  // 指令被截得更短（"Select the sentence"）但前面已经有一句完整题干时才去掉，免得把题干本身吃了
  s = s.replace(/([.?!])\s*Select\s+the\s+sentence\s*[.,;:]?\s*$/i, "$1");
  return s.trim();
}

const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, last: -1 };

/**
 * 题干里的段号（1 起）。认 "paragraph 4" / "paragraph4" / "the first paragraph"。
 * 认不出、或出现两个不同段号（"paragraphs 2 and 3"）→ null（不收，契约要求单段）。
 * "the last paragraph" 返回 -1，由调用方按实际段数换算。
 */
function paragraphOf(stem) {
  const s = String(stem || "");
  const found = new Set();
  // 不要求词边界：第一来源 OCR 粘字（"inparagraph2that"）时 "paragraph" 前面没有空格
  for (const m of s.matchAll(/paragraphs?\s*(\d+)/gi)) found.add(Number(m[1]));
  for (const m of s.matchAll(/\bthe\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|last)\s+paragraph\b/gi)) {
    found.add(ORDINALS[m[1].toLowerCase()]);
  }
  if (/paragraphs\s*\d+\s*(and|,|-|to)\s*\d+/i.test(s)) return null;
  if (found.size !== 1) return null;
  const n = [...found][0];
  return Number.isInteger(n) && (n >= 1 || n === -1) ? n : null;
}

/* ── 审计哈希 ─────────────────────────────────────────────────────────── */

/**
 * 盲审结论只对「这道题干 + 用户看到的那段文字」有效。文字变了（重新 OCR、复核 patch、
 * 合并换了代表）哈希就变，build 发现对不上就不收这道题，等 audit_sentence_select.mjs 重审。
 * 刻意对**原样**文本取哈希（不归一化）：多一个空格前端的 indexOf 就可能对不上，也该重审。
 */
function auditHash(stem, paragraphText) {
  return crypto.createHash("sha1").update(`${String(stem || "")}\u0000${String(paragraphText || "")}`, "utf8").digest("hex");
}

/* ── 组题 ─────────────────────────────────────────────────────────────── */

/** 契约里的「这是一道点选句子题」：题型对 + 选项键是 S1… */
function isSentenceSelectQuestion(q) {
  if (!q || q.question_type !== "sentence_selection" || !q.options || typeof q.options !== "object") return false;
  const keys = Object.keys(q.options);
  return keys.length >= 2 && keys.every((k) => /^S\d+$/.test(k));
}

/** 从一道点选句子题里取出正确句原文。 */
function correctSentenceOf(q) {
  return isSentenceSelectQuestion(q) ? String(q.options[q.correct_answer] || "") : "";
}

/**
 * paragraphs[0] 像不像标题：短（≤15 词）且末尾没有句末标点。
 * 与前端同一口径 —— 现有 AP 里近半数的 paragraphs[0] 不是干净标题（没有标题 / 标题与首段粘在一起），
 * 「题干第 N 段」在这些条目上是 paragraphs[N-1] 而不是 paragraphs[N]。
 */
function looksLikeTitle(p) {
  const s = String(p || "").trim();
  if (!s) return false;
  if (/[.!?]["'”’)\]]*$/.test(s)) return false;
  return s.split(/\s+/).filter(Boolean).length <= 15;
}

/**
 * 题干段号 → paragraphs 下标（按标题检测数正文段）。-1（the last paragraph）= 最后一段。
 * 越界返回 null。
 */
function expectedParagraphIndex(paragraphs, n) {
  const paras = Array.isArray(paragraphs) ? paragraphs : [];
  if (n === -1) return paras.length ? paras.length - 1 : null;
  if (!Number.isInteger(n) || n < 1) return null;
  const idx = looksLikeTitle(paras[0]) ? n : n - 1;
  return idx >= 0 && idx < paras.length ? idx : null;
}

/** 某段逐句 + 按序精确子串自检（契约：前端在 paragraphs[paragraph_index] 里顺序 indexOf）。 */
function sentencesOf(text) {
  const sentences = splitSentences(text);
  let cursor = 0;
  for (const sent of sentences) {
    const at = text.indexOf(sent, cursor);
    if (at < 0) return null;
    cursor = at + sent.length;
  }
  return sentences;
}

/**
 * 按账本条目在某个 AP 条目上组出一道点选句子题。
 *
 * @param {{stem, paragraph, answer_prefix?, answer_raw?, correct_sentence?, q_number}} entry
 * @param {{paragraphs: string[]}} item  宿主 AP 条目
 * @param {{sentenceJaccardMin?: number}} opts
 * @returns {{question, hash}|{error}}
 *
 * paragraph_index（契约必填，前端**按它**定位段落）= paragraphs 里真正含正确句的那一段的下标，
 * 且必须与题干段号一致（expectedParagraphIndex）。校验（任何一条不过就返回 error，不猜）：
 *   · 题干段号换算出的下标在范围内；
 *   · 正确句（答案开头词唯一命中句首；账本记了正确句原文的，还要与它词集 Jaccard ≥0.9）真正所在的段
 *     与题干段号一致 —— 在别的段 → paragraph_mismatch；同一句出现在多段 → sentence_in_multiple_paragraphs；
 *   · 该段至少切得出 2 句，且逐句按序是该段精确子串。
 */
function buildSentenceQuestion(entry, item, { sentenceJaccardMin = 0.9 } = {}) {
  const paras = Array.isArray(item && item.paragraphs) ? item.paragraphs.map((p) => String(p || "")) : [];
  const n = Number(entry && entry.paragraph);
  const expected = expectedParagraphIndex(paras, n);
  if (expected == null) return { error: "paragraph_out_of_range" };
  const prefix = entry.answer_prefix != null && entry.answer_prefix !== ""
    ? answerPrefixWords(entry.answer_prefix)
    : answerPrefixWords(entry.answer_raw);
  if (!prefix.length) return { error: "answer_empty_prefix" };

  // 每一段里「开头词命中 + （有正确句原文时）与它足够像」的句子
  const hitParas = [];
  let prefixOnlyElsewhere = false;
  paras.forEach((p, i) => {
    const sents = splitSentences(p);
    const m = matchByPrefix(sents, prefix);
    const idxs = m.error ? (m.hits || []) : [m.index];
    const good = idxs.filter((k) => !entry.correct_sentence || jaccard(entry.correct_sentence, sents[k]) >= sentenceJaccardMin);
    if (good.length) hitParas.push(i);
    else if (idxs.length && i !== expected) prefixOnlyElsewhere = true;
  });
  if (entry.correct_sentence && hitParas.length > 1) return { error: "sentence_in_multiple_paragraphs" };
  if (!hitParas.includes(expected)) {
    if (hitParas.length) return { error: "paragraph_mismatch" };
    const sents = splitSentences(paras[expected]);
    const m = matchByPrefix(sents, prefix);
    if (!m.error && entry.correct_sentence) return { error: "correct_sentence_mismatch" };
    return { error: m.error === "ambiguous" ? "answer_ambiguous" : "answer_no_match", ...(prefixOnlyElsewhere ? { note: "prefix_found_in_other_paragraph" } : {}) };
  }
  const text = paras[expected];
  const sentences = sentencesOf(text);
  if (!sentences) return { error: "option_not_substring" };
  if (sentences.length < 2) return { error: "too_few_sentences" };
  const m = matchByPrefix(sentences, prefix);
  if (m.error) return { error: `answer_${m.error}` };
  if (entry.correct_sentence && jaccard(entry.correct_sentence, sentences[m.index]) < sentenceJaccardMin) {
    return { error: "correct_sentence_mismatch" };
  }
  const options = {};
  sentences.forEach((sent, i) => { options[`S${i + 1}`] = sent; });
  const stem = cleanStem(entry.stem);
  const question = {
    question_type: "sentence_selection",
    stem,
    paragraph: n === -1 ? (looksLikeTitle(paras[0]) ? paras.length - 1 : paras.length) : n,
    paragraph_index: expected,
    options,
    correct_answer: `S${m.index + 1}`,
    q_number: entry.q_number,
  };
  return { question, hash: auditHash(stem, text) };
}

/**
 * 把一道已组好的点选句子题搬到另一个宿主（跨卷同篇合并）：按**代表条目**重新算 paragraph_index 并重新核对。
 * 代表那份里与原正确句词集 Jaccard ≥ 0.9 的句子必须恰好出现在一段里，且那一段就是题干段号换算出的那段 ——
 * 否则 { error }（sentence_not_in_rep / sentence_in_multiple_paragraphs / paragraph_mismatch / ambiguous）。
 */
function rehostSentenceQuestion(q, item, { sentenceJaccardMin = 0.9 } = {}) {
  if (!isSentenceSelectQuestion(q)) return { error: "not_sentence_select" };
  const paras = Array.isArray(item && item.paragraphs) ? item.paragraphs.map((p) => String(p || "")) : [];
  const expected = expectedParagraphIndex(paras, Number(q.paragraph));
  if (expected == null) return { error: "paragraph_out_of_range" };
  const want = correctSentenceOf(q);
  const where = [];
  paras.forEach((p, i) => {
    const hits = splitSentences(p).map((s, k) => [k, jaccard(want, s)]).filter(([, j]) => j >= sentenceJaccardMin);
    if (hits.length) where.push([i, hits]);
  });
  if (!where.length) return { error: "sentence_not_in_rep" };
  if (where.length > 1) return { error: "sentence_in_multiple_paragraphs" };
  const [idx, hits] = where[0];
  if (idx !== expected) return { error: "paragraph_mismatch" };
  if (hits.length !== 1) return { error: "ambiguous" };
  const text = paras[idx];
  const sentences = sentencesOf(text);
  if (!sentences) return { error: "option_not_substring" };
  if (sentences.length < 2) return { error: "too_few_sentences" };
  const options = {};
  sentences.forEach((sent, i) => { options[`S${i + 1}`] = sent; });
  const question = { ...q, paragraph_index: idx, options, correct_answer: `S${hits[0][0] + 1}` };
  return { question, hash: auditHash(q.stem, text) };
}

/* ── 账本 → 成品：挂题 / 上线闸（build_bank 与 audit_sentence_select 共用）─────── */

/** 与 lib/realExam/blueprint.normalizeQ 同口径（rf 卷 121 → 21；拼盘伪题号作废）。CJS 这边不引 ESM，自留一份。 */
function normalizeQ(q, module) {
  const n = Number(q);
  if (!Number.isFinite(n)) return null;
  if (n >= 100 && n < 1000) return n % 100 || n;
  if (n >= 1000) return null;
  if (module != null && module > 2) return null;
  return n;
}

/** 学术阅读题号带（M1 26-30 / 31-35，M2 11-15）；不在学术带 → null。 */
function apBandOf(module, q) {
  const n = normalizeQ(q, module);
  if (n == null) return null;
  if (Number(module) === 2) return n >= 11 && n <= 15 ? [11, 15] : null;
  if (Number(module) === 1) {
    if (n >= 26 && n <= 30) return [26, 30];
    if (n >= 31 && n <= 35) return [31, 35];
  }
  return null;
}

const idParts = (id) => {
  const m = /^real_(ap|rdl)_(.+)_(\d+)_(\d+)$/.exec(String(id || ""));
  return m ? { type: m[1], slug: m[2], module: Number(m[3]), q: Number(m[4]) } : null;
};

/**
 * 账本里「已通过盲审」的记录：Map<哈希, Set<当时审定的正确句原文>>。
 * 口径同 hold_policy.auditPassed：第一票一致，或第二票一致。
 * 带上正确句是为了防「哈希对上了、但这次组题定出的正确句与审的时候不是同一句」—— 理论上同一段文字 +
 * 同一套确定性规则不会变，但建库与审计是两条代码路径（合并换宿主 vs 直接组题），多核一句不花钱。
 */
function passingHashes(ledger) {
  const out = new Map();
  for (const e of (ledger && ledger.entries) || []) {
    for (const a of e.audits || []) {
      if (!a || !a.hash || !(a.agree === true || (a.second_vote && a.second_vote.agree === true))) continue;
      if (!out.has(a.hash)) out.set(a.hash, new Set());
      out.get(a.hash).add(String(a.expected_sentence || ""));
    }
  }
  return out;
}

/** 这道题（哈希 + 正确句）有没有通过记录。passes 是 passingHashes 的 Map；给 Set 时只核哈希（单测 / 旧调用）。 */
function auditPasses(passes, hash, sentence) {
  if (!passes || !hash) return false;
  if (passes instanceof Map) return passes.has(hash) && passes.get(hash).has(String(sentence || ""));
  return typeof passes.has === "function" && passes.has(hash);
}

/**
 * 在同卷同 module 同学术题号带的 AP 条目上找宿主：条目自有题（非并入）里至少一道落在该带。
 * 返回 { host } 或 { error }。多于一个宿主（同带两篇）→ ambiguous，不猜。
 */
function findHost(apItems, entry) {
  const band = apBandOf(entry.module, entry.q_number);
  if (!band) return { error: "not_ap_band" };
  const hosts = (apItems || []).filter((it) => {
    const p = idParts(it && it.id);
    if (!p || p.type !== "ap" || p.slug !== String(entry.slug) || p.module !== Number(entry.module)) return false;
    return (it.questions || []).some((q) => {
      if (q.merged_from) return false;
      const n = normalizeQ(q.q_number, p.module);
      return n != null && n >= band[0] && n <= band[1];
    });
  });
  if (hosts.length === 1) return { host: hosts[0] };
  return { error: hosts.length ? "host_ambiguous" : "host_missing" };
}

/**
 * 把账本里的点选句子题挂到成品 AP 条目上（build_bank 在跨卷合并**之前**调；就地改条目）。
 * 这一步只做结构校验，**不看盲审**：题要先挂上，跨卷合并才能判断它能不能跟着换宿主；
 * 盲审闸在落盘后的 gateSentenceSelect 里，对着用户最终看到的文字核哈希。
 * 返回 { attached, failed: {reason: n}, detail: [...] }。
 */
function attachSentenceSelect(apItems, ledger) {
  const failed = {};
  const detail = [];
  let attached = 0;
  for (const e of (ledger && ledger.entries) || []) {
    const key = e.key || `${e.set}#${e.module}#${e.q_number}`;
    const fail = (why) => { failed[why] = (failed[why] || 0) + 1; detail.push({ key, why }); };
    if (!e.stem || !e.paragraph || (!e.answer_prefix && !e.answer_raw)) { fail("incomplete_entry"); continue; }
    const h = findHost(apItems, e);
    if (h.error) { fail(h.error); continue; }
    if (h.host.questions.some((q) => q.q_number === e.q_number)) { fail("q_number_taken"); continue; }
    const r = buildSentenceQuestion(e, h.host);
    if (r.error) { fail(r.error); continue; }
    h.host.questions.push(r.question);
    // 自有题按题号排（真考屏序）；并入题仍垫在后面（consolidate_reading 的约定）
    const own = h.host.questions.filter((q) => !q.merged_from).sort((a, b) => (a.q_number ?? 1e9) - (b.q_number ?? 1e9));
    h.host.questions = [...own, ...h.host.questions.filter((q) => q.merged_from)];
    attached += 1;
    detail.push({ key, host: h.host.id, hash: r.hash });
  }
  return { attached, failed, detail };
}

/**
 * 上线闸：成品里每道点选句子题都要（1）结构仍成立（选项按序是该段精确子串、正确答案键存在），
 * （2）「题干 + 该段文字」的哈希有通过的盲审记录。不满足的**删掉那道题**（条目其余题照旧）。
 * 就地改 items；返回 { live, dropped: {reason: n}, pending: [{host, q_number, stem, paragraph, hash, why}] }。
 */
function gateSentenceSelect(items, passes) {
  const dropped = {};
  const pending = [];
  let live = 0;
  for (const it of items || []) {
    const keep = [];
    for (const q of it.questions || []) {
      if (!isSentenceSelectQuestion(q)) { keep.push(q); continue; }
      // 契约：前端按 paragraph_index 定位段落（paragraph 只是题干里的段号，用于显示）
      const okIdx = Number.isInteger(q.paragraph_index) && Array.isArray(it.paragraphs) && q.paragraph_index >= 0 && q.paragraph_index < it.paragraphs.length;
      const text = okIdx ? String(it.paragraphs[q.paragraph_index] || "") : "";
      let why = okIdx ? null : "structure_broken";
      let cursor = 0;
      for (const v of Object.values(q.options)) {
        const at = text.indexOf(v, cursor);
        if (at < 0) { why = "structure_broken"; break; }
        cursor = at + v.length;
      }
      if (!why && !(q.correct_answer in q.options)) why = "structure_broken";
      const hash = auditHash(q.stem, text);
      if (!why && !auditPasses(passes, hash, correctSentenceOf(q))) why = "unaudited";
      if (why) {
        dropped[why] = (dropped[why] || 0) + 1;
        // 带上整道题：audit_sentence_select 按建库真正放的位置审（段落下标、逐句、答案页定的正确句都在这里）
        pending.push({ host: it.id, q_number: q.q_number, stem: q.stem, paragraph: q.paragraph, hash, why, question: q });
        continue;
      }
      keep.push(q);
      live += 1;
    }
    it.questions = keep;
  }
  return { live, dropped, pending };
}

module.exports = {
  ABBREVIATIONS,
  splitSentences,
  answerPrefixWords,
  matchByPrefix,
  cleanStem,
  paragraphOf,
  auditHash,
  jaccard,
  isSentenceSelectQuestion,
  correctSentenceOf,
  looksLikeTitle,
  expectedParagraphIndex,
  buildSentenceQuestion,
  rehostSentenceQuestion,
  normalizeQ,
  apBandOf,
  passingHashes,
  auditPasses,
  findHost,
  attachSentenceSelect,
  gateSentenceSelect,
};
