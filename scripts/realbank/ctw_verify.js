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
 *
 * ── 2026-09-14 补充判据（verifyCtwDetailed 的 opts.isWord 给了才生效）──────────────────────
 * 阅读缺题逐块核对时，还原与答案页对不上的 12 块里有 7 块是**答案页自己的毛病**，模型还原的词没错：
 *   · 答案页错字：promiting / strcutures / impluses（整词写法，屏幕前缀与上下文都指向 promoting…）；
 *   · 残片被 OCR 糊了一个字母 / 粘了标点：ys，（ways）、used（produced 的 uced）、lit（ability 的 lity）；
 *   · 屏幕前缀不是一半：屏幕上真的印着 "When the__ is"（there 露 3 个字母），floor 锁把它拒了。
 * 旧判据只能整块扔。放宽的前提是**两份独立证据**同时成立，缺一份照旧 flagged：
 *   1. 词典（opts.isWord，站内划词词典 public/dict 的 5.5 万词形）：还原的词必须是真词；
 *      判答案页错字时，答案页那个拼写还必须**不是**真词（carve / cover 两个都是词 → 不收）。
 *   2. 屏幕 OCR（opts.body）：按还原段落里这个空**左右两个完整词**在 OCR 正文里定位，读出屏幕上
 *      实际露出的前缀（screenFragments）。残片类判据必须拿到屏幕前缀才判；模型给的前缀与屏幕不一致时
 *      以屏幕为准并改正（1.28A 模型为了凑 "ing" 把前缀写成 Study，屏幕上是 "Stud extinctions"）。
 * 编辑距离只放宽到 1（相邻换位算 1）；一块里最多放宽 MAX_RELAXED 个空，再多就是整块没对齐，不是笔误。
 * 整词错字要求同块已有 ≥ MIN_SAME_FORM 个空按整词写法严格对上，残片同理 —— 版式先确认了，才谈得上笔误。
 */
const CJK = /[一-鿿]/;

const countWords = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const low = (s) => String(s == null ? "" : s).trim().toLowerCase();
/** 答案页原文清洗：OCR 会把全角标点粘到残片上（1.28A 的 "ys，"）。只留字母、撇号、连字符。 */
const cleanAnswer = (s) => low(s).replace(/[^a-z'-]/g, "");
const letters = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z]/g, "");

/** 一块里最多放宽几个空（见头注）。 */
const MAX_RELAXED = 2;
/** 判「笔误」之前，同块至少要有几个空按同一种写法严格对上。 */
const MIN_SAME_FORM = 5;

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

/** 编辑距离（相邻换位算一步，即 OSA / 受限 Damerau-Levenshtein）。答案页错字多是换位：impluses、strcutures。 */
function editDistance(a, b) {
  const s = String(a || ""), t = String(b || "");
  const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...new Array(t.length).fill(0)]);
  for (let j = 0; j <= t.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[s.length][t.length];
}

/**
 * 屏幕上每个空实际露出来的前缀（读不出来的给 null）。
 *
 * C-test 的空是「隔一个词挖一个」，所以每个空左右两边都是屏幕上完整印着的词。OCR 正文常常把空格吃掉
 * （"catast events. Stud extinctions"、"Humancognitionrefersto…"），所以两边都压成纯字母串再找：
 * 在 OCR 里按顺序找到「左词 + X + 右词」，X 就是屏幕上这个空露出的字母。
 * 只认 X 是还原词的真前缀、且不长于还原词的那一处；左右词不足 2 个字母（a / I）不当锚，宁可读不出。
 * 游标只前进：同一个 "the" 在段落里出现多次，靠顺序区分。
 *
 * @param {string} passage 还原后的整段
 * @param {Array<{word:string}>} blanks 按出现顺序
 * @param {string} body 这块屏幕的 OCR 正文
 * @returns {Array<string|null>} 与 blanks 等长，小写
 */
function screenFragments(passage, blanks, body) {
  const list = Array.isArray(blanks) ? blanks : [];
  const out = list.map(() => null);
  const B = letters(body);
  const toks = String(passage || "").trim().split(/\s+/).filter(Boolean);
  if (!B || !toks.length) return out;
  let cursor = 0;
  let bpos = 0;
  list.forEach((b, i) => {
    const want = letters(b && b.word);
    if (!want) return;
    let at = -1;
    for (let t = cursor; t < toks.length; t += 1) {
      if (toks[t].split(/[—–]/).some((seg) => letters(seg) === want)) { at = t; break; }
    }
    if (at < 0) return;
    cursor = at + 1;
    const prev = at > 0 ? letters(toks[at - 1]) : "";
    const next = at + 1 < toks.length ? letters(toks[at + 1]) : "";
    if (prev.length < 2 || next.length < 2) return;
    for (let p = B.indexOf(prev, bpos); p >= 0; p = B.indexOf(prev, p + 1)) {
      const start = p + prev.length;
      const q = B.indexOf(next, start);
      if (q < 0 || q - start > want.length) continue;
      const frag = B.slice(start, q);
      if (frag && frag.length < want.length && want.startsWith(frag)) {
        out[i] = frag;
        bpos = q;
        return;
      }
    }
  });
  return out;
}

/**
 * 补充判据（见头注）：旧判据没过的一个空，能不能靠「词典 + 屏幕」证明是答案页的毛病。
 * @returns {{ok:boolean, rule?:string, word?:string, given?:string}}  given 是改正后的前缀（保留原大小写）
 */
function relaxBlank({ answer, word, given, screen, isWord, formCounts }) {
  const got = low(word);
  const want = cleanAnswer(answer);
  const g0 = low(given);
  if (!got || !want) return { ok: false };
  // 屏幕读得出前缀就以屏幕为准；读不出只能信模型给的
  const g = screen != null ? screen : g0;
  if (!g || g.length >= got.length || !got.startsWith(g)) return { ok: false };
  const fixGiven = String(word).trim().slice(0, g.length);
  const corrected = g !== g0;
  const done = (rule) => ({ ok: true, rule, word: got, given: fixGiven, corrected });

  // R0 只是洗掉粘上的标点 / 用屏幕前缀，判据仍是旧的两条
  const strict = resolveBlank(want, got, g);
  if (strict.ok) return done(corrected || want !== low(answer) ? `${strict.form}_cleaned` : strict.form);
  if (!isWord(got)) return { ok: false };
  // R1 残片、前缀不是一半：屏幕上确实印着这个前缀，且答案不是「以前缀开头的整词」（防 plplace）
  if (screen != null && got === g + want && !want.startsWith(g)) return done("suffix_screen");
  // R2 整词写法的答案页错字：同块整词写法已确认，差 1 步，答案页那个拼写不是词
  if (formCounts.full >= MIN_SAME_FORM && got.length >= 5 && editDistance(got, want) === 1 && !isWord(want)) {
    return done("full_typo");
  }
  // R3 残片被 OCR 糊了 1 个字母：同块残片写法已确认，屏幕前缀读得出。
  // 「屏幕前缀 + 答案残片」若本身拼成一个真词（co + ver = cover，模型却还原成 cower），错的是模型不是答案页 → 不收。
  const hidden = got.slice(g.length);
  if (screen != null && formCounts.suffix >= MIN_SAME_FORM && hidden.length >= 2 && want.length >= 2
    && editDistance(hidden, want) === 1 && !isWord(g + want)) {
    return done("suffix_fuzzy");
  }
  return { ok: false };
}

/**
 * 整块 CTW 校验，带改正结果。
 *
 * @param {{passage?: string, blanks?: Array<{word: string, given: string}>}} item 模型产出
 * @param {string[]} answerWords 答案页给的词（按出现顺序）
 * @param {{isWord?: (w: string) => boolean, body?: string}} [opts] 给了 isWord 才启用补充判据；body = 屏幕 OCR 正文
 * @returns {{problems: string[], blanks: Array<{word:string, given:string}>, relaxed: Array<object>}}
 *   problems 空数组 = 通过；blanks 是改正前缀之后的逐空结果（没改动就与入参相同）；
 *   relaxed 记下每个靠补充判据放行的空（落进结构化产物，留给人复核）。
 */
function verifyCtwDetailed(item, answerWords, opts = {}) {
  const p = [];
  const blanks = Array.isArray(item && item.blanks) ? item.blanks : [];
  const answers = Array.isArray(answerWords) ? answerWords : [];
  if (blanks.length !== answers.length) {
    p.push(`空位数 ${blanks.length} ≠ 答案词数 ${answers.length}`);
    return { problems: p, blanks, relaxed: [] };
  }
  const passage = String((item && item.passage) || "");
  const first = blanks.map((b, i) => resolveBlank(answers[i], b && b.word, b && b.given, i));
  const isWord = typeof (opts && opts.isWord) === "function" ? opts.isWord : null;
  const fixed = blanks.map((b) => ({ ...b }));
  const relaxed = [];
  if (isWord && first.some((r) => !r.ok)) {
    const screens = opts.body ? screenFragments(passage, blanks, opts.body) : blanks.map(() => null);
    // 版式计数用洗过标点的答案（"ys，" 这类不该让整块的残片写法少算一个）
    const formCounts = { full: 0, suffix: 0 };
    blanks.forEach((b, i) => {
      const r = first[i].ok ? first[i] : resolveBlank(cleanAnswer(answers[i]), b && b.word, b && b.given, i);
      if (r.ok) formCounts[r.form] += 1;
    });
    const tries = [];
    first.forEach((r, i) => {
      if (r.ok) return;
      const b = blanks[i] || {};
      tries.push({ i, res: relaxBlank({ answer: answers[i], word: b.word, given: b.given, screen: screens[i], isWord, formCounts }) });
    });
    const healed = tries.filter((t) => t.res.ok);
    const loosened = healed.filter((t) => !/^(full|suffix)$/.test(t.res.rule));
    if (healed.length === tries.length && loosened.length <= MAX_RELAXED) {
      for (const { i, res } of healed) {
        first[i] = { ok: true, form: res.rule, word: res.word, problems: [] };
        if (res.corrected) fixed[i] = { ...fixed[i], given: res.given };
        relaxed.push({
          blank: i + 1, rule: res.rule, word: res.word, answer: String(answers[i]),
          given: res.given, ...(res.corrected ? { given_was: String((blanks[i] || {}).given || "") } : {}),
        });
      }
    }
  }
  const resolved = [];
  first.forEach((r, i) => {
    p.push(...r.problems);
    // 段落里要找的是完整词：后半截写法下答案页的 "le" 本来就不会单独出现在原文里。
    resolved.push(r.ok ? r.word : low(answers[i]));
  });
  if (countWords(passage) < 30) p.push("还原段落过短");
  if (CJK.test(passage)) p.push("段落里混入中文");
  for (const w of resolved) {
    if (!new RegExp(`\\b${w.replace(/[^\w]/g, "")}\\b`, "i").test(passage)) {
      p.push(`还原段落里找不到答案词 "${w}"`);
      break;
    }
  }
  return { problems: p, blanks: p.length ? blanks : fixed, relaxed: p.length ? [] : relaxed };
}

/**
 * 整块 CTW 校验。返回问题清单（空数组 = 通过）。不给 opts 时与 2026-09-10 版逐字相同。
 *
 * @param {{passage?: string, blanks?: Array<{word: string, given: string}>}} item 模型产出
 * @param {string[]} answerWords 答案页给的词（按出现顺序）
 * @param {{isWord?: Function, body?: string}} [opts] 见 verifyCtwDetailed
 */
function verifyCtw(item, answerWords, opts) {
  return verifyCtwDetailed(item, answerWords, opts).problems;
}

module.exports = {
  resolveBlank, verifyCtw, verifyCtwDetailed, screenFragments, editDistance, cleanAnswer,
  MAX_RELAXED, MIN_SAME_FORM,
};
