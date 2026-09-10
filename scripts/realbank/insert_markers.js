/**
 * 真题阅读「插入句题的 ■ 标记」找回判据（纯函数，无 IO —— 供 build_bank.mjs、
 * insert_markers_apply.mjs 与单测共用）。
 *
 * 背景：真考 AP 簇的最后一题多半是**插入句题**
 * （"Look at the four squares [■] that indicate where the following sentence could be added…
 *   Where would the sentence best fit?"），插入位靠材料正文里的 4 个 ■ 定位。
 * 我们的材料是从考场截图逐字 OCR 出来的，RapidOCR / Qwen 转写都会把 ■ 丢掉 ——
 * 于是 build_bank.mjs 的 buildMcqGroup 把这类题当「无法作答的死题」丢弃
 * （stats.droppedInsert）。实测 99 篇 AP 每篇应 5 题，入库平均 3.77 题，
 * 缺的 60 次落在簇内第 5 题、29 次第 4 题，绝大部分就是这一刀。
 *
 * 题本身在 `.codex-tmp/realbank/<卷>.structured.json` 里是 status=ok 的
 * （题干 + 选项 + 答案键都在），**只缺材料里的 ■**。所以找回的办法是给材料补标记，
 * 而不是重新出题：拿源截图重新过一遍 Qwen3-VL（它看得见黑方块），得到一份
 * 「带 ■ 的同一段正文」，人工/机器校验通过后存进
 * `data/realBank/reading/insert-markers.json`，build_bank 落库时查表换材料。
 *
 * 三条判据都在这个文件里，因为它们决定「一段带 ■ 的文本能不能替换掉库里的材料」，
 * 判错一次就会把**另一篇文章**的正文塞进这道题：
 *
 *  1. `validateMarked` —— 恰好 4 个 ■（真题固定四个插入位；多/少都说明转写没转对）、
 *     ■ 不在开头结尾且两两之间至少 3 个词（连着的 ■ 是 OCR 把装饰符当标记）、
 *     与原材料的 token 覆盖率 ≥ 0.92（同一段文本，不是另一篇）。
 *  2. `findMarkedPassage` —— **按文本匹配，不按 id**。build_bank 生成的 id 形如
 *     `real_ap_<slug>_<module>_<簇内首题号>`，插入题被丢会让簇的题号集合变化，
 *     id 里的 q_start 跟着漂移；等我们把题救回来，id 又会变回去。用 id 做键
 *     等于用一个「会因为这次修复而改变」的东西做键，必然自相矛盾。
 *  3. `applyMarkers` —— 段落分隔（`\n\n`）必须保住。AP 的 `paragraphs` 字段就是
 *     `passage.split(/\n{2,}/)`，前端按段渲染；Qwen 重新转写出来的正文常常是
 *     一整块，直接替换会把一篇多段文章压成一坨（BACKLOG 里「题池阅读 parse 阶段
 *     要保住段落分隔」是同一件事）。所以按句子尾部对齐，把原材料的段界还原上去；
 *     还原不了就**不改段落**并标 paragraphs_lost，由调用方决定收不收。
 */

/** 真题插入位标记。OCR 掉的就是它。 */
const SQUARE = "■";

/** 插入位的固定个数（ETS 的插入句题永远是四选一）。 */
const SQUARE_COUNT = 4;

/** App 里插入句题靠 A–D 四个选项作答（RDLTask）；入库时 ■ 按顺序标成这四个，选项也固定是它们。 */
const INSERT_LABELS = ["[A]", "[B]", "[C]", "[D]"];

/** 两个 ■ 之间至少要隔开这么多个词（连着的方块 = 把装饰符/表格线当成了标记）。 */
const MIN_WORDS_BETWEEN = 3;

/** 「带 ■ 版本」与原材料的最低 token 覆盖率：低于这个就不认是同一段文本。 */
const COVERAGE_MIN = 0.92;

/** 查表时「非逐字相同」的兜底阈值：只有唯一一条 ≥ 这个覆盖率才敢认。 */
const LOOKUP_COVERAGE_MIN = 0.95;

/** 还原段落分隔时，拿每段末尾的几个词当锚点。 */
const PARAGRAPH_ANCHOR_WORDS = 4;

/**
 * 比对用的归一化：**先**去掉 ■ 与 `[A]`~`[D]` 这类插入位标记，再小写、
 * 只留字母数字与空格、压缩空白。
 *
 * 顺序是要紧的：`[A]` 不先删掉，后一步会把它压成一个孤零零的词 "a"，
 * 带标记版和不带标记版就再也对不上了。
 */
function normalizeForMatch(text) {
  return String(text == null ? "" : text)
    .replace(/■|▪|◼/g, " ")
    .replace(/\[\s*[A-Da-d]\s*\]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** 归一化后的词序列。 */
function tokensForMatch(text) {
  const s = normalizeForMatch(text);
  return s ? s.split(" ") : [];
}

/**
 * 覆盖率口径（**多重集合**，不是集合）：
 *   material 的每一个 token（含重复）在 marked 的 token 多重集合里能否领走一个，
 *   领到的次数 / material 的 token 总数。
 *
 * 用多重集合而不是集合，是因为正文里 the/of 这种词出现几十次；按集合算的话，
 * 一段只抄了开头两句的残文也能靠虚词把覆盖率刷到 0.9 以上。
 *
 * @param {string} marked   带 ■ 的那一版（词的来源池）
 * @param {string} material 库里原本的材料（被覆盖的一方，算分母）
 */
function coverage(marked, material) {
  const want = tokensForMatch(material);
  if (!want.length) return 0;
  const pool = new Map();
  for (const t of tokensForMatch(marked)) pool.set(t, (pool.get(t) || 0) + 1);
  let hit = 0;
  for (const t of want) {
    const left = pool.get(t) || 0;
    if (left > 0) {
      pool.set(t, left - 1);
      hit += 1;
    }
  }
  return hit / want.length;
}

/**
 * 「这一版带 ■ 的正文能不能拿来替换库里的材料」。
 *
 * @param {string} marked   候选正文（应含 4 个 ■）
 * @param {string} material 库里的材料原文（OCR 版，无 ■）
 * @returns {{ok: boolean, problems: string[], squares: number}}
 */
function validateMarked(marked, material) {
  const s = String(marked == null ? "" : marked);
  const problems = [];
  const squares = (s.match(/■/g) || []).length;

  if (squares !== SQUARE_COUNT) {
    problems.push(`squares=${squares}!=${SQUARE_COUNT}`);
  }

  // 段与段：以 ■ 切开后，第 0 段是首个 ■ 之前的正文，最后一段是末个 ■ 之后的正文。
  const segments = s.split(SQUARE);
  if (squares > 0) {
    const wordsOf = (x) => tokensForMatch(x).length;
    if (wordsOf(segments[0]) === 0) problems.push("square_at_start");
    if (wordsOf(segments[segments.length - 1]) === 0) problems.push("square_at_end");
    for (let i = 1; i < segments.length - 1; i += 1) {
      if (wordsOf(segments[i]) < MIN_WORDS_BETWEEN) {
        problems.push(`squares_too_close@${i}`);
        break;
      }
    }
  }

  const cov = coverage(s, material);
  if (cov < COVERAGE_MIN) problems.push(`coverage=${cov.toFixed(3)}<${COVERAGE_MIN}`);

  return { ok: problems.length === 0, problems, squares };
}

/**
 * 在标记表里找「这段材料」的带 ■ 版本。**按文本匹配，不按 id**（理由见文件头第 2 条）。
 *
 * 先认归一化后逐字相同的；没有再退一步找覆盖率 ≥ LOOKUP_COVERAGE_MIN 的，
 * 且**必须唯一**——两条都够像就说明表里有重复/近似条目，宁可不换也不猜。
 *
 * @param {string} material 库里的材料原文
 * @param {Array<object>} table insert-markers.json 的 entries
 * @returns {object|null} 命中的 entry
 */
function findMarkedPassage(material, table) {
  const entries = Array.isArray(table) ? table.filter((e) => e && typeof e.marked === "string") : [];
  if (!entries.length) return null;
  const key = normalizeForMatch(material);
  if (!key) return null;

  const exact = entries.filter((e) => normalizeForMatch(e.marked) === key);
  if (exact.length) return exact[0];

  const near = entries.filter((e) => coverage(e.marked, material) >= LOOKUP_COVERAGE_MIN);
  if (near.length === 1) return near[0];
  // 多条都够像时仍然不猜。唯一例外：这几条带 ■ 的原文**逐字相同**（空白归一化后，■ 保留）——
  // 那是同一份源文件在两场考试里各录了一次（source-flags 的 identical_file，如 3.21 与 4.1），
  // 正文与插入位都一样，取哪条结果都相同，谈不上「猜」。差一个词或 ■ 挪一个位置都照旧返回 null。
  const sameText = (e) => String(e.marked).replace(/\s+/g, " ").trim();
  if (near.length > 1 && new Set(near.map(sameText)).size === 1) return near[0];
  return null;
}

/** 词 + 它在原串里的字符区间（■ 不是字母数字，天然被跳过）。 */
function tokenSpans(text) {
  const out = [];
  const re = /[A-Za-z0-9]+/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    out.push({ tok: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** needle（词序列）在 hay 里从 from 起的首个出现位置；没有返回 -1。 */
function findTokenSeq(hay, needle, from) {
  if (!needle.length) return -1;
  for (let i = Math.max(0, from); i + needle.length <= hay.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j].tok !== needle[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

/**
 * 把带 ■ 的正文变成「可以直接进库的材料」：正文用 marked，段落分隔用 material 的。
 *
 * material 是多段（含 `\n\n`）而 marked 是一整块时，按**每段末尾几个词**当锚点，
 * 在 marked 的词流里顺序找回段界，在锚点词后（连同紧跟的句号/引号）切开。
 * 任何一个段界找不回来就整体放弃 —— 返回原样的 marked 并标 paragraphs_lost:true，
 * 由调用方决定「宁可少段落也要救回这道题」还是「不收」。
 *
 * @returns {{text: string, paragraphs_lost: boolean}}
 */
function applyMarkers(material, marked) {
  const src = String(marked == null ? "" : marked);
  const paras = String(material == null ? "" : material)
    .split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  // 原材料本来就是一段，或者 marked 自己已经带着段落分隔 → 不用动。
  if (paras.length <= 1 || /\n{2,}/.test(src)) return { text: src, paragraphs_lost: false };

  const hay = tokenSpans(src);
  const cuts = [];
  let cursor = 0;
  for (let p = 0; p < paras.length - 1; p += 1) {
    const pt = tokensForMatch(paras[p]);
    if (!pt.length) return { text: src, paragraphs_lost: true };
    const anchor = pt.slice(Math.max(0, pt.length - PARAGRAPH_ANCHOR_WORDS));
    const at = findTokenSeq(hay, anchor, cursor);
    if (at < 0) return { text: src, paragraphs_lost: true };
    let off = hay[at + anchor.length - 1].end;
    // 句末标点（. ” ) 之类）留在上一段里。紧跟其后、还在同一行上的 ■ 也一并留下：
    // 屏幕上那个方块就画在句号右边，切到下一段开头会让人以为插入位在段首之前。
    // （两者本来就是同一个插入点，归到哪一段不影响作答，归到上一段更像原版面。）
    const eat = () => { while (off < src.length && !/[\s■A-Za-z0-9]/.test(src[off])) off += 1; };
    eat();
    for (;;) {
      const m = /^[ \t]*■/.exec(src.slice(off));
      if (!m) break;
      off += m[0].length;
      eat();
    }
    if (off <= (cuts.length ? cuts[cuts.length - 1] : 0) || off >= src.length) {
      return { text: src, paragraphs_lost: true };
    }
    cuts.push(off);
    cursor = at + anchor.length;
  }

  let out = "";
  let prev = 0;
  for (const off of cuts) {
    out += src.slice(prev, off);
    out += "\n\n";
    prev = off;
    while (prev < src.length && /\s/.test(src[prev])) prev += 1;
  }
  out += src.slice(prev);
  return { text: out, paragraphs_lost: false };
}

/**
 * 查表 → 校验 → 套用，一把梭。build_bank.mjs 落库时调它，测试也调它。
 *
 * @param {string} material 库里的材料原文（无 ■）
 * @param {Array<object>} table insert-markers.json 的 entries
 * @returns {{material: string, restored: boolean, entry: object|null, problems: string[]}}
 *   restored=false 时 material 原样返回（调用方照旧丢弃插入题）。
 */
function decideInsertMaterial(material, table) {
  const original = String(material == null ? "" : material);
  const entry = findMarkedPassage(original, table);
  if (!entry) return { material: original, restored: false, entry: null, problems: ["no_entry"] };

  const v = validateMarked(entry.marked, original);
  if (!v.ok) return { material: original, restored: false, entry, problems: v.problems };

  const applied = applyMarkers(original, entry.marked);
  return {
    material: applied.text,
    restored: true,
    entry,
    problems: applied.paragraphs_lost ? ["paragraphs_lost"] : [],
  };
}

/**
 * 正文里恰好 4 个 ■ → 按出现顺序换成 [A]~[D]。
 *
 * 为什么要换：App 里作答是点 A/B/C/D 四个选项，不是点方块。正文里只画四个一模一样的黑方块，
 * 用户得自己数「第三个方块 = C」。重排版源（rf*）的材料本来就写 [A]~[D]、选项写 [A]~[D]，
 * 两种来源统一成同一个样子。■ 不是恰好 4 个就原样返回（不猜）。
 */
function labelSquares(text) {
  const s = String(text == null ? "" : text);
  if ((s.match(/■/g) || []).length !== SQUARE_COUNT) return s;
  let i = 0;
  return s.replace(/■/g, () => INSERT_LABELS[i++]);
}

// 与 structure_set.mjs verifyMcq 同一份词表：转正的题绕过了结构化校验，这两条要在这里补查。
const CJK = /[一-鿿]/;
const WATERMARK = /闲鱼|盗卖|退款|店铺|甜茶|满分小屋|唯一闲/;

/**
 * 把一道「0 个选项、被结构化判 flagged」的插入句题转正（insert_promote.mjs 调）。
 *
 * 结构化器按普通选择题要 3~5 个文字选项；插入句题考场上没有文字选项（点四个方块作答），于是整条
 * flagged、build_bank 连看都不看。第一来源这样丢了 27 道，答案页字母都在。
 * 转正的前提与 build_bank 换材料**同一套判据**（decideInsertMaterial：标记表里有这段材料的带 ■ 版本、
 * validateMarked 过）。过了才把材料换成标好 [A]~[D] 的正文、选项固定 [A]~[D]、按答案页字母盖 answer_index；
 * 之后照常走盲审闸，不因为转正而免审。
 *
 * @param {object} item   structured 里那道题（要有 stem / material）
 * @param {Array<object>} table insert-markers.json 的 entries
 * @param {string} answerLetter 答案页字母（a~d，大小写不限）
 * @returns {{ok: boolean, item: object|null, problems: string[]}}
 */
function promoteInsertItem(item, table, answerLetter) {
  const problems = [];
  const letter = String(answerLetter == null ? "" : answerLetter).trim().toUpperCase();
  const idx = ["A", "B", "C", "D"].indexOf(letter);
  if (letter.length !== 1 || idx < 0) problems.push(`answer_not_a_to_d:${JSON.stringify(answerLetter)}`);
  const stem = String((item && item.stem) || "").trim();
  if (tokensForMatch(stem).length < 2) problems.push("stem_missing");
  const d = decideInsertMaterial(String((item && item.material) || ""), table);
  if (!d.restored) problems.push(...d.problems);
  const blob = `${stem} ${d.material}`;
  if (CJK.test(blob)) problems.push("cjk_in_text");
  if (WATERMARK.test(blob)) problems.push("watermark_in_text");
  if (problems.length) return { ok: false, item: null, problems };
  const options = INSERT_LABELS.slice();
  return {
    ok: true,
    problems: d.problems, // 可能带 paragraphs_lost（与 build_bank 同口径：记账但照收）
    item: {
      ...item,
      stem: stem.replace(/\[\s*■\s*\]/g, "[A]-[D]"),
      material: labelSquares(d.material),
      options,
      answer_index: idx,
      answer_text: options[idx],
      insert_restored: {
        by: (d.entry && d.entry.by) || null,
        paragraphs_lost: d.problems.includes("paragraphs_lost"),
      },
    },
  };
}

module.exports = {
  SQUARE,
  SQUARE_COUNT,
  INSERT_LABELS,
  labelSquares,
  promoteInsertItem,
  MIN_WORDS_BETWEEN,
  COVERAGE_MIN,
  LOOKUP_COVERAGE_MIN,
  normalizeForMatch,
  tokensForMatch,
  coverage,
  validateMarked,
  findMarkedPassage,
  applyMarkers,
  decideInsertMaterial,
};
