/**
 * 真题阅读「跨卷同篇合并」（纯函数，无 IO —— 供 build_bank.mjs 与单测共用）。
 *
 * ── 为什么要有这一步 ────────────────────────────────────────────────────────
 * build_bank 的归并只在**卷内**做（groupByMaterial：同卷同 module、Jaccard≥0.8 或前 60 字相同）。
 * 跨卷的同一篇文章走的是另一条路 —— `<卷>.json files[].hash` 整科去重，或复核清单里的
 * `dup_of` 下架。两条路都是「留一份、扔一份」，**扔掉的那份多出来的题也一起扔了**。
 *
 * 实测代价：1.28A 卷的「Noise Control in Urban Areas」只抽到 1 道题，5.3 卷的同一篇抽到 2 道
 * （多出 "What can be inferred about noise pollution in the European cities…"）。两份都在线时
 * 用户连着做两遍同一篇；按老办法扔掉一份，那道多出来的题就永远不会上线。学术阅读（AP）
 * 普遍缺题的根因之一就在这里 —— 真考一篇 5 题，我们平均不到 4 题。
 *
 * 所以这里做的是**合并**而不是去重：同一篇只留一条（代表），别的副本里代表没有的题
 * 逐题并进代表，副本本身下架。
 *
 * ── 聚簇判据 ───────────────────────────────────────────────────────────────
 * AP：标题（paragraphs[0] 归一化）相同 **且** 正文词集 Jaccard ≥ 0.5，或正文 Jaccard ≥ 0.8。
 *     为什么要放宽到 0.5：同一篇在两个来源被 OCR 出来，后半截截断程度不同，实测
 *     1.28A vs 5.3 的 Noise Control 正文 Jaccard 只有 0.754、3.4 vs 5.10v2 的
 *     Sociocybernetics 0.746 —— 都落在 build_bank 的 0.8 之下，却是货真价实的同一篇。
 *     标题逐字相同是很强的约束（99 篇 AP 里只有 2 对同标题，且都确实是同篇），
 *     所以「同标题 + 正文过半重合」比裸 Jaccard 0.8 更可靠，而不是更松。
 * RDL：材料词集 Jaccard ≥ 0.8（通知/广告篇幅短，OCR 变体差异小，不放宽）。
 *
 * ── 为什么不直接放宽 build_bank 的 MATERIAL_JACCARD_MIN ───────────────────
 * 那个阈值管的是**卷内**归并，0.8 是拿同卷两两 39 对实测出来的（不同文章 ≤0.06、
 * 同篇变体 ≥0.896）。往下调会把同卷两篇不同文章糊成一篇。这里是跨卷、且额外要求标题
 * 逐字相同，是另一套约束，不能混用。
 *
 * ── 逐题守卫 ───────────────────────────────────────────────────────────────
 * 合并**只往代表里加题，绝不改代表的正文**（改了 material_image 的沿用判据「同 id 同文本」
 * 就会失配，一堆材料原图要重跑上传）。所以每道要并进来的题都得先证明它在代表的正文上
 * 答得了：插入句题要代表正文有 [A]~[D]/■；词汇题问的那个词要在代表正文里找得到；
 * 题干引用 "paragraph 3" 就得有第 3 段；选句题（Identify the sentence…）一律不并
 * （它的答案是原文里的某一句，跨副本对不上）。复核清单判过「歧义」的题干一律全局拒收。
 *
 * 去重分三层：**先看选项**（撞 3 个以上就是同一题，见 OPTION_OVERLAP_DUP —— 第二来源会把
 * 同一道题改写成另一套措辞，题干比对根本接不住），再看题干（见 isSameQuestion），最后看正确答案原文
 * （改写题干、换掉干扰项但正确答案一字不改，见 ANSWER_DUP_MIN_TOKENS）。
 * 最后还有题量上限（MAX_QUESTIONS）：学术一篇 5 题、日常阅读一篇最多 3 题，不许把题堆进同一篇。
 */

const { inferApQuestionType } = require("./question_type.js");
const SS = require("./sentence_select.js");

/* ── 阈值 ─────────────────────────────────────────────────────────────────── */
/** AP：标题相同时，正文词集 Jaccard 的下限。 */
const AP_TITLE_BODY_JACCARD_MIN = 0.5;
/** AP：标题对不上时，光靠正文词集 Jaccard 认同篇的下限。 */
const AP_BODY_JACCARD_MIN = 0.8;
/** RDL：材料词集 Jaccard 的下限。 */
const RDL_JACCARD_MIN = 0.8;
/**
 * 两道题算「同一道」的题干词集 Jaccard 下限 —— 但**光靠题干不够**。
 *
 * 实测反例：real_ap_rf0808_1_131 q132「All of the following are mentioned as uses of polarized
 * light in biology EXCEPT」与代表里的「…as applications of polarized light EXCEPT:」题干
 * Jaccard 0.63，但四个选项零重合 —— 那是同一篇里问法相近的**两道不同的题**，按 0.6 一刀切会
 * 把新题当重复扔掉（合并的全部意义就是把这种题找回来）。反过来「The word "Collectively" is
 * closest in meaning to」那一对 J=0.80 且选项有重合，确实是同一道。
 * 所以判据改成三段（见 isSameQuestion）：逐字相同 / 题干像且选项有重合 / 题干极像。
 */
const STEM_JACCARD_MIN = 0.6;
/** 题干**极其**相似时不再要求选项重合（选项自己被 OCR 串了栏的情况）。 */
const STEM_JACCARD_STRICT = 0.85;
/**
 * 选项重合到这个数就直接判同一题，**不看题干** —— 这条优先级最高。
 *
 * 第二来源（rf/rp 重排版机经）会把同一道题改写成另一套措辞，题干 Jaccard 压根到不了 0.6，
 * 上面那两条判据全部落空。实测三对硬重复：
 *   · real_ap_310_1_25「What is HealthGeek?」vs 并入的「What is Health Geek?」（4/4 选项相同）
 *   · real_ap_rf0620_2_211 自有插入题「There are four locations [] …」vs 并入的
 *     「There are four locations [A]-[D] …」（4/4 相同）
 *   · real_ap_411_1_31 自有「Why does the author mention Biorock technology…」与并入的
 *     「What is the main purpose of the passage?」四个选项完全相同 —— 这是源料串栏、
 *     题干配错了选项，更得拒收（上线就是一道答案对不上题干的死题）。
 * 四选一的题里三个选项逐字撞上，不可能是两道不同的题。
 */
const OPTION_OVERLAP_DUP = 3;
/**
 * 正确答案原文相同就判同一题 —— 前提是答案本身够长（长度 > 3 的词至少这么多个）。
 *
 * 第二来源改写得更狠的时候，题干和三个干扰项全换了，只有正确答案一字不改，上面两层都接不住。
 * 实测：real_rdl_rf0902_1_121 自有「What should a resident do last?」与并入的 real_rdl_318_1_22
 * 「What is the final step to resetting the router?」题干 Jaccard 0.13、选项只逐字撞 2 个（另两个措辞微调），正确答案都是
 * 「Wait until the router has completely started again」—— 同一篇里问两遍同一件事。
 * 同一篇里两道**不同**的题，正确答案逐字相同到一整句话，不会发生。
 * 短答案不算（"advanced"、"in a lab"、"[C]"）：词汇题 / 插入题的答案天然短，撞了也未必是同一题。
 */
const ANSWER_DUP_MIN_TOKENS = 3;

/**
 * 每篇最多留几道题（null = 不限）。
 * 真考一篇学术段落固定 5 题，真题专区的三档限时又是按题量折算时间的 —— 合并把 8 道题堆在
 * 一篇里，用户在同一篇文章上被多扣时间，不公平。代表自有的题一道不动（那是它本来就有的），
 * 上限只约束**并进来的**题。
 * 日常阅读（RDL）按蓝图一篇 2~3 题（lib/realExam/blueprint.mjs：M1 A 型 21-30 = 2+2+3+3，
 * B 型 21-25 = 2+3），上限 3。实测不设限时 real_rdl_rf0713_1_123（自有 3 题）把第二来源
 * real_rdl_rf0808_1_125 改写过的同三道题（题干、选项全换了措辞）又并进来一遍，一篇 6 题、三道重复。
 */
const MAX_QUESTIONS = { ap: 5, rdl: 3 };

/* ── 归一化 / 词集（口径与 build_bank 的 matNorm/matTokens/jaccard 一致）────── */
const matNorm = (s) => String(s || "").toLowerCase().replace(/[^a-z]+/g, " ").replace(/\s+/g, " ").trim();
/** 只取长度 > 3 的词：the/of/and 这类虚词在任意两篇英文里都撞，会把不同文章的 Jaccard 抬起来。 */
const tokens = (s) => new Set(matNorm(s).split(" ").filter((w) => w.length > 3));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}
/** 标题归一化：小写 + 去掉一切非字母数字（OCR 的空格/破折号/冒号最不稳）。 */
const titleKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
/** 「去空格与标点后的字母序列」—— 词汇题守卫比对用。 */
const letterSeq = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
/** 未知日期（setDate 认不出时是裸 "2026"）排到最后，别让它冒充最早的卷。 */
const dateKey = (d) => { const s = String(d || ""); return s.length === 4 ? `${s}-99-99` : s || "9999-99-99"; };
/** 缺题号的排最后。刻意不用 Infinity —— 两个 Infinity 相减是 NaN，比较器返回 NaN 排序就乱了。 */
const qnum = (q) => (Number.isFinite(q && q.q_number) ? q.q_number : Number.MAX_SAFE_INTEGER);

/* ── 条目形状适配（AP 有 paragraphs/passage，RDL 只有 text）──────────────── */
function paragraphsOf(item) {
  if (Array.isArray(item.paragraphs) && item.paragraphs.length) {
    return item.paragraphs.map((p) => String(p || "").trim()).filter(Boolean);
  }
  return String(item.passage || item.text || "").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
}
/** 代表正文（作答时用户看到的那份全文）。 */
function materialOf(item) {
  return String(item.passage != null ? item.passage : item.text != null ? item.text : paragraphsOf(item).join("\n\n"));
}
/** AP 的「正文」= 去掉标题段之后的部分；整篇没分段（只有一段）时退回全文，免得词集为空。 */
function bodyOf(item, type) {
  if (type !== "ap") return materialOf(item);
  const ps = paragraphsOf(item);
  const body = ps.slice(1).join("\n\n").trim();
  return body || materialOf(item);
}
/** 题干引用 "paragraph N" 时能定位的段落数（AP 不含标题段；RDL 没有标题概念）。 */
function bodyParagraphCount(item, type) {
  const n = paragraphsOf(item).length;
  return type === "ap" ? Math.max(0, n - 1) : n;
}

/**
 * 正文有没有可见的插入位标记。判据与 build_bank.hasInsertMarkers 一致：
 * 旧源（ETS 截图）用 ■；重排版源用 [A]-[D]，四个字母缺一个就不算。
 */
function hasInsertMarkers(material) {
  const s = String(material || "");
  if (/■/.test(s)) return true;
  return ["[A]", "[B]", "[C]", "[D]"].every((x) => s.includes(x));
}

/** 是不是插入句题（题干口径与 build_bank.looksLikeInsertQuestion 一致，外加推断出的题型）。 */
function isInsertQuestion(q) {
  const probe = [String(q && q.stem || ""), ...Object.values((q && q.options) || {}).map(String)].join(" ");
  if (/insert|slot\s*\d|■|four locations|where would the following sentence/i.test(probe)) return true;
  return inferApQuestionType(q && q.stem) === "insert_text";
}

/* ── 「这两道是不是同一道题」 ──────────────────────────────────────────── */
/** 正确答案原文（correct_answer 是选项键时取该选项；取不到返回空串）。 */
function correctText(q) {
  const opts = (q && q.options) || {};
  const k = String((q && q.correct_answer) || "").trim();
  return Object.prototype.hasOwnProperty.call(opts, k) ? String(opts[k] || "") : "";
}

/** 一道题的指纹：归一化题干 / 题干词集 / 选项的字母序列集合 / 够长的正确答案的字母序列（不够长为空串）。 */
const questionKey = (q) => {
  const answer = correctText(q);
  return {
    key: matNorm(q && q.stem),
    tokens: tokens(q && q.stem),
    options: new Set(Object.values((q && q.options) || {}).map((o) => letterSeq(o)).filter(Boolean)),
    answer: tokens(answer).size >= ANSWER_DUP_MIN_TOKENS ? letterSeq(answer) : "",
    sentenceSelect: SS.isSentenceSelectQuestion(q),
  };
};

const shareOption = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
const sharedOptionCount = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n += 1; return n; };

/**
 * 三段判据（顺序即优先级）：
 *   1. 题干归一化逐字相同 → 同一道；
 *   2. 题干词集 Jaccard ≥ 0.6 **且**两题至少有一个选项相同（去空格标点后按字母序列比）→ 同一道；
 *   3. 题干词集 Jaccard ≥ 0.85 → 同一道（题干几乎一字不差，选项那边多半是 OCR 串了栏）。
 * 都不满足就是两道不同的题，该并进来。
 */
function isSameQuestion(cand, prev) {
  if (cand.key && prev.key && cand.key === prev.key) return true;
  if (!cand.tokens.size || !prev.tokens.size) return false;
  const j = jaccard(cand.tokens, prev.tokens);
  if (j >= STEM_JACCARD_MIN && shareOption(cand.options, prev.options)) return true;
  return j >= STEM_JACCARD_STRICT;
}

/** 选句题：答案是原文里的某一句，换一份副本的正文就对不上，一律不并。 */
function isSentenceSelection(q) {
  // 口径与 question_type.js 的 sentence_selection 规则一致（含第二来源拍成 A–D 的「Which sentence in paragraph N」）
  return /identify\s+the\s+sentence|select\s+the\s+sentence|which\s+sentence\s+in\s+(?:the\s+\w+\s+)?paragraph/i.test(String(q && q.stem || ""));
}

/** 词汇题问的那个词/短语（"The word "grappling" in the passage…"）；不是词汇题返回 null。 */
function vocabTarget(stem) {
  const m = String(stem || "").match(/\b(?:words?|phrases?|expressions?)\s*[“”"'‘’]([^“”"'‘’]{1,80})[“”"'‘’]/i);
  return m ? m[1] : null;
}

/**
 * 题干引用到的最大段号。"the last paragraph" 按 2 算 —— 整篇不分段时「最后一段」无从定位
 * （复核清单已有一条 real_ap_rp0830_2001 就是栽在这上面）。认不出段号返回 0（不设限）。
 */
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8 };
function paragraphRefMax(stem) {
  const s = String(stem || "");
  let max = 0;
  for (const m of s.matchAll(/\bparagraphs?\s+(\d+)/gi)) max = Math.max(max, Number(m[1]));
  for (const m of s.matchAll(/\bparagraphs?\s+\d+\s+and\s+(\d+)/gi)) max = Math.max(max, Number(m[1]));
  for (const m of s.matchAll(/\bthe\s+(first|second|third|fourth|fifth|sixth|seventh|eighth)\s+paragraph\b/gi)) {
    max = Math.max(max, ORDINALS[m[1].toLowerCase()] || 0);
  }
  if (/\bthe\s+last\s+paragraph\b/i.test(s)) max = Math.max(max, 2);
  return max;
}

/* ── 聚簇 ─────────────────────────────────────────────────────────────────── */
/** 两条是不是同一篇。 */
function sameArticle(a, b, type) {
  const j = jaccard(a.bodyTokens, b.bodyTokens);
  if (type !== "ap") return j >= RDL_JACCARD_MIN;
  if (j >= AP_BODY_JACCARD_MIN) return true;
  return !!a.titleKey && a.titleKey === b.titleKey && j >= AP_TITLE_BODY_JACCARD_MIN;
}

/** 并查集聚簇，返回 [[node…], …]，簇内按原数组顺序。 */
function cluster(nodes, type) {
  const parent = nodes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (!sameArticle(nodes[i], nodes[j], type)) continue;
      const ra = find(i), rb = find(j);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }
  const byRoot = new Map();
  for (let i = 0; i < nodes.length; i += 1) {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(nodes[i]);
  }
  return [...byRoot.values()];
}

/* ── 代表（保留方）选择 ───────────────────────────────────────────────────── */
/** 末段没被截断（以 . ! ? ” " ) 收尾）= 正文更完整。 */
function endsComplete(node) {
  return /[.!?”"')]$/.test(node.body.trim());
}

/**
 * 选代表。顺序：
 *   1. 复核清单里被 dup_of 指着的那条（被指次数多的优先，再早的日期，再 id）——
 *      这条是**硬的**：__tests__/real-bank-review-holds.test.js 锁死「dup_of 指向的那条
 *      必须还在库里」，选别人当代表会把它合掉、测试报红。
 *   2. 排除已被复核清单整条下架的条目（它们马上要被 applyReview 删掉，当代表 = 并进去的题
 *      连同代表一起消失，比不合并还糟）。整簇都被下架就整簇不动。
 *   3. 簇里有插入句题时，优先选正文带 [A]~[D]/■ 的那条（否则插入题并不进来）。
 *   4. 正文最完整：末段未被截断 > 段落多 > 正文词数多。
 *   5. 题数多 → 6. 日期早 → 7. id 字典序（保证确定性）。
 */
function pickRepresentative(members, ctx) {
  const targets = members.filter((m) => ctx.dupPointers.get(m.id));
  let pool = targets.length
    ? targets
    : members.filter((m) => !ctx.unitHeld.has(m.id));
  if (!pool.length) return null;                        // 整簇都待下架 → 不动
  if (pool.length > 1 && members.some((m) => m.questions.some(isInsertQuestion))) {
    const marked = pool.filter((m) => hasInsertMarkers(m.material));
    if (marked.length) pool = marked;
  }
  const cmp = (a, b) => (
    (ctx.dupPointers.get(b.id) || 0) - (ctx.dupPointers.get(a.id) || 0)
    || (endsComplete(b) ? 1 : 0) - (endsComplete(a) ? 1 : 0)
    || b.paragraphCount - a.paragraphCount
    || b.bodyWords - a.bodyWords
    || b.questions.length - a.questions.length
    || dateKey(a.date).localeCompare(dateKey(b.date))
    || String(a.id).localeCompare(String(b.id))
  );
  return pool.slice().sort(cmp)[0];
}

/* ── 逐题守卫 ─────────────────────────────────────────────────────────────── */
/**
 * 这道题能不能并进代表。返回 null = 可以收；返回字符串 = 拒收原因。
 * 守卫顺序就是记账里 reason 的优先级，别随手调换（测试按 reason 断言）。
 */
function rejectReason(q, rep, type, ctx, accepted) {
  const stem = String(q && q.stem || "");
  const cand = questionKey(q);
  // 点选句子题（S1… 选项，见 sentence_select.js）另走一套：它的「选项」是该段逐句，同一段上的两道选句题
  // 选项天然全重合，不能拿选项判重；能不能换宿主要看代表那份第 N 段里有没有同一句、那段文字审过没有。
  if (SS.isSentenceSelectQuestion(q)) {
    for (const a of accepted) {
      if (a.sentenceSelect && ((cand.key && a.key === cand.key) || jaccard(cand.tokens, a.tokens) >= STEM_JACCARD_STRICT)) return "duplicate_stem";
    }
    if (ctx.heldStems.some((p) => p && stem.startsWith(p))) return "review_held_stem";
    const r = SS.rehostSentenceQuestion(q, rep.item);
    if (r.error) return `sentence_select_${r.error}`;
    if (!SS.auditPasses(ctx.sentencePasses, r.hash, SS.correctSentenceOf(r.question))) return "sentence_select_unaudited";
    return null;
  }
  // 优先级最高：选项撞到 3 个以上就是同一题（改写措辞的重复题 / 源料串栏配错题干，见 OPTION_OVERLAP_DUP）
  for (const a of accepted) if (!a.sentenceSelect && sharedOptionCount(cand.options, a.options) >= OPTION_OVERLAP_DUP) return "duplicate_options";
  for (const a of accepted) if (isSameQuestion(cand, a)) return "duplicate_stem";
  // 改写到题干、干扰项全换，正确答案一字没动（见 ANSWER_DUP_MIN_TOKENS）
  if (cand.answer) for (const a of accepted) if (!a.sentenceSelect && a.answer === cand.answer) return "duplicate_answer";
  // 题干以小写字母开头 = OCR 把前半截吃了（实测 real_ap_428_2_11 的 "all of the following EXCEPT"
  // 丢了主语，而同一簇里 real_ap_427_2_11 有完整版「According to the passage, dynamic stretching
  // may result in all of the following EXCEPT」—— 两者词集 Jaccard 只有 0.17，上面那道去重闸接不住）。
  // 合并是往库里**加**题，加一道没有主语的题比少一道糟；416 条候选里只有这 1 条命中，不是粗筛。
  if (/^[a-z]/.test(stem.trim())) return "truncated_stem";
  if (isInsertQuestion(q) && !hasInsertMarkers(rep.material)) return "insert_no_markers";
  const vocab = vocabTarget(stem);
  if (vocab && !letterSeq(rep.material).includes(letterSeq(vocab))) return "vocab_word_absent";
  const need = paragraphRefMax(stem);
  if (need > bodyParagraphCount(rep.item, type)) return "paragraph_out_of_range";
  if (isSentenceSelection(q)) return "sentence_selection";
  if (ctx.heldStems.some((p) => p && stem.startsWith(p))) return "review_held_stem";
  return null;
}

/* ── 主入口 ───────────────────────────────────────────────────────────────── */
/**
 * 跨卷同篇合并。
 *
 * 注意：代表条目的 `questions` 是**就地改**的（合并进来的题直接追加到它身上）；传进来的数组
 * 本身不动，返回的是过滤掉副本之后的新数组。build_bank 每次重建都新造条目对象，所以没有别名问题。
 *
 * @param {{ap: object[], rdl: object[]}} banks 建完的成品
 * @param {object} review  data/realBank/review-holds.json 的内容（缺省 = 空清单）
 * @param {{maxQuestions?: Record<string, number|null>, sentencePasses?: Set<string>}} opts
 *        maxQuestions 每篇题量上限（缺省 MAX_QUESTIONS）；
 *        sentencePasses 点选句子题「题干 + 段落文字」已通过盲审的哈希集合（缺省空 = 选句题一律不跨卷搬）
 * @returns {{ap, rdl, clusters, summary}} clusters 按 kept id 升序，可直接落 consolidation.json
 */
function consolidateReading(banks, review, { maxQuestions = MAX_QUESTIONS, sentencePasses = new Set() } = {}) {
  const holds = (review && review.holds) || [];
  const dupPointers = new Map();                        // 保留方 id → 被几条 dup_of 指着
  for (const h of holds) {
    if (h && h.scope === "unit" && h.dup_of) dupPointers.set(String(h.dup_of), (dupPointers.get(String(h.dup_of)) || 0) + 1);
  }
  const ctx = {
    dupPointers,
    unitHeld: new Set(holds.filter((h) => h && h.scope === "unit" && h.id).map((h) => String(h.id))),
    // 复核判过「歧义/残缺」的题干前缀：全局拒收（同一道题换个副本并进来还是同一道坏题）。
    heldStems: holds.filter((h) => h && h.scope === "question" && h.stem).map((h) => String(h.stem)),
    // Map<哈希, Set<正确句>>（SS.passingHashes）或 Set<哈希>（只核哈希）
    sentencePasses: sentencePasses instanceof Map || sentencePasses instanceof Set ? sentencePasses : new Set(sentencePasses || []),
  };

  const out = {};
  const clusters = [];
  const skipReasons = {};
  let mergedCount = 0, droppedCount = 0, conflicts = 0;
  const sentencePending = [];          // 因代表那段没审过而没搬的选句题（宿主 + 搬过去之后的题目 + 哈希）

  for (const type of ["ap", "rdl"]) {
    const items = Array.isArray(banks[type]) ? banks[type] : [];
    const nodes = items.map((item) => {
      const body = bodyOf(item, type);
      return {
        id: String(item.id), item, type, date: String(item.date || ""),
        material: materialOf(item),
        body,
        bodyTokens: tokens(body),
        titleKey: type === "ap" ? titleKey(paragraphsOf(item)[0] || "") : "",
        paragraphCount: paragraphsOf(item).length,
        bodyWords: body.split(/\s+/).filter(Boolean).length,
        questions: Array.isArray(item.questions) ? item.questions : [],
      };
    });

    const dropped = new Set();
    for (const members of cluster(nodes, type)) {
      if (members.length < 2) continue;                 // 单条簇 = 没有同篇副本，什么都不做（幂等靠这一行）
      const rep = pickRepresentative(members, ctx);
      if (!rep) continue;
      const others = members.filter((m) => m !== rep);
      // 复核清单为同一篇指定了**两个**不同的保留方 = 清单与合并判据打架。合掉其中一个会让
      // 「dup_of 指向的那条必须还在库里」失效（loadDupAliases 会顺着 consolidation.json
      // 把别名链接回来，测试也跟着放行），但这是要人看一眼的事，所以留个响。
      const extraTargets = others.filter((m) => ctx.dupPointers.get(m.id));
      if (extraTargets.length) conflicts += 1;

      const accepted = rep.questions.map(questionKey);
      const merged = [], skipped = [], appended = [];
      const pending = [];
      for (const m of others) for (const q of m.questions) pending.push({ from: m, q });
      // 每篇题量上限（真考一篇 5 题，见 MAX_QUESTIONS）。null = 不限。
      const cap = (maxQuestions && maxQuestions[type] != null) ? maxQuestions[type] : null;
      // 代表自有题里还没审过的点选句子题，落盘时会被上线闸摘掉 —— 不占名额，免得它挡住能并进来的题。
      const ownLive = rep.questions.filter((q) => {
        if (!SS.isSentenceSelectQuestion(q)) return true;
        const text = Array.isArray(rep.item.paragraphs) ? String(rep.item.paragraphs[q.paragraph_index] || "") : "";
        return SS.auditPasses(ctx.sentencePasses, SS.auditHash(q.stem, text), SS.correctSentenceOf(q));
      }).length;
      // 有上限时，先补代表里**没有的题型** —— 名额有限就该拿来补齐题型覆盖，而不是再来一道细节题。
      // 只有 AP 有题型体系；RDL 按（来源日期, 题号）排。
      const ownTypes = cap == null || type !== "ap" ? null : new Set(rep.questions.map(apType));
      pending.sort((a, b) => (
        (ownTypes == null ? 0 : (ownTypes.has(apType(a.q)) ? 1 : 0) - (ownTypes.has(apType(b.q)) ? 1 : 0))
        || dateKey(a.from.date).localeCompare(dateKey(b.from.date))
        || qnum(a.q) - qnum(b.q)
        || String(a.from.id).localeCompare(String(b.from.id))
      ));
      for (const { from, q } of pending) {
        const why = rejectReason(q, rep, type, ctx, accepted);
        const rec = { from: from.id, q_number: q.q_number ?? null, stem: String(q.stem || "") };
        if (why) {
          skipped.push({ ...rec, reason: why });
          skipReasons[why] = (skipReasons[why] || 0) + 1;
          // 只差「代表那段没审过」就能搬过来的选句题：记下来交给 audit_sentence_select 去审
          // （审计脚本按建库真正要放的位置审，不去猜宿主）。名额已满的不记 —— 审过了也会被 over_cap
          // 挡在门外，白花一次盲审（彩排实测 3.30 那道并往 real_ap_rp0822_2001_200101 的就是这样）。
          if (why === "sentence_select_unaudited" && (cap == null || ownLive + appended.length < cap)) {
            const moved = SS.rehostSentenceQuestion(q, rep.item);
            if (moved.question) sentencePending.push({ host: rep.id, from: from.id, question: { ...moved.question, merged_from: from.id }, hash: moved.hash });
          }
          continue;
        }
        // 上限只卡并进来的题：代表自有的一道不动（那是它本来就有的），但满了就不再补。
        if (cap != null && ownLive + appended.length >= cap) {
          skipped.push({ ...rec, reason: "over_cap" });
          skipReasons.over_cap = (skipReasons.over_cap || 0) + 1;
          continue;
        }
        accepted.push(questionKey(q));
        // 点选句子题换宿主：选项与正确答案按代表那段的分句重算（守卫里已确认能搬、且那段审过）
        const moved = SS.isSentenceSelectQuestion(q) ? SS.rehostSentenceQuestion(q, rep.item).question : q;
        appended.push({
          ...moved,
          ...(type === "ap" ? { question_type: apType(moved) } : {}),
          merged_from: from.id,
        });
        merged.push(rec);
        mergedCount += 1;
      }

      // 代表自有题按 q_number 升序在前，并进来的按（来源日期, q_number）在后。
      const own = rep.questions.slice().sort((a, b) => qnum(a) - qnum(b));
      rep.item.questions = [...own, ...appended];
      for (const m of others) dropped.add(m.id);
      droppedCount += others.length;
      clusters.push({
        kept: rep.id,
        dropped: others.map((m) => m.id).sort(),
        merged,
        skipped,
      });
    }
    out[type] = items.filter((it) => !dropped.has(String(it.id)));
  }

  clusters.sort((a, b) => a.kept.localeCompare(b.kept));
  sentencePending.sort((a, b) => a.host.localeCompare(b.host) || (a.question.q_number ?? 0) - (b.question.q_number ?? 0));
  return {
    ap: out.ap,
    rdl: out.rdl,
    clusters,
    sentencePending,
    summary: {
      clusters: clusters.length,
      dropped: droppedCount,
      merged: mergedCount,
      skipped: skipReasons,
      conflicts,
    },
  };
}

/** AP 题型：源料给的缺失或是占位 "detail" 才推断（口径与 build_bank 落库时一致）。 */
function apType(q) {
  const raw = String((q && q.question_type) || "").trim();
  return raw && raw !== "detail" ? raw : inferApQuestionType(q && q.stem);
}

module.exports = {
  AP_TITLE_BODY_JACCARD_MIN,
  AP_BODY_JACCARD_MIN,
  RDL_JACCARD_MIN,
  STEM_JACCARD_MIN,
  STEM_JACCARD_STRICT,
  OPTION_OVERLAP_DUP,
  ANSWER_DUP_MIN_TOKENS,
  MAX_QUESTIONS,
  consolidateReading,
  questionKey,
  isSameQuestion,
  sharedOptionCount,
  // 下面这些导出只为单测能逐条验守卫，不给外部当 API 用。
  jaccard,
  tokens,
  titleKey,
  hasInsertMarkers,
  isInsertQuestion,
  isSentenceSelection,
  vocabTarget,
  paragraphRefMax,
  pickRepresentative,
};
