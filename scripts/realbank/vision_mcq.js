/**
 * 真题阅读选择题「看图重抽」的判据（纯函数，无 IO —— 供 vision_restructure_mcq.mjs 与单测共用）。
 *
 * 背景（2026-09-13 第二轮补缺）：第一来源 AP/RDL 里有一批题**源截图上题干和四个选项都在、答案页字母也在**，
 * 却因为结构化阶段（deepseek-v4-flash 读 OCR 汤）出了岔子没进库：
 *   · flagged_json    —— 模型输出坏 JSON / 修复轮不是数组，items 为空；
 *   · flagged_content —— 题干缺失 / 选项数 2 / 选项重复（左右分栏串了）；
 *   · bad_options     —— 结构化判 ok，但只转出 3 个或 5 个选项（build_bank 要恰好 A–D 四个，直接丢）；
 *   · misrouted_ctw   —— 这一屏的 OCR 带上了下一屏的「Fill in the missing letters」，被路由成填词块；
 *   · passage_screen  —— OCR 没认出右栏选项，整屏被当成材料屏；
 *   · audit_disagree  —— 结构化 ok、两票盲审都与答案页不一致（可能是转写把选项顺序弄错了）。
 * 办法：按题号找回那一屏源截图，让 Qwen3-VL **只转写**题干 + 从上到下的选项 + 左栏材料，然后走与结构化阶段
 * **同一套**盖答案（stampAnswer）与结构校验（verifyMcq），再照常进盲审闸 —— 不因为看了图就免审。
 *
 * 为什么 stampAnswer / verifyMcq 是复制而不是 import：structure_set.mjs 是 CLI，import 即执行 main()。
 * 复制件与原件逐字比对由 __tests__/realbank-vision-mcq.test.js 锁死，原件一改测试就红。
 */

/* ── 与 structure_set.mjs 共用的常量（原样） ─────────────────────────────── */
const countWords = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const LETTERS = "abcdefgh";
const CJK = /[一-鿿]/;
const WATERMARK = /闲鱼|盗卖|退款|店铺|甜茶|满分小屋|唯一闲/;

/* ↓↓↓ 原样复制自 scripts/realbank/structure_set.mjs 行 253-289（2026-09-13 版），逐字比对见单测 ↓↓↓ */
function stampAnswer(item, answerLetter) {
  const problems = [];
  const letter = String(answerLetter || "").trim().toLowerCase();
  if (!/^[a-h]$/.test(letter)) {
    problems.push(`答案不是单个字母：${JSON.stringify(answerLetter)}`);
    return problems;
  }
  const idx = LETTERS.indexOf(letter);
  if (!Array.isArray(item.options) || item.options.length < 2) {
    problems.push("选项数组缺失或不足 2 个");
    return problems;
  }
  if (idx >= item.options.length) {
    problems.push(`答案 ${letter} 越界：只转写出 ${item.options.length} 个选项`);
    return problems;
  }
  item.answer_index = idx;
  item.answer_text = item.options[idx];
  return problems;
}

function verifyMcq(item) {
  const p = [];
  if (!item.stem || countWords(item.stem) < 2) p.push("题干缺失或过短");
  if (!Array.isArray(item.options)) p.push("options 不是数组");
  else {
    if (item.options.length < 3 || item.options.length > 5) p.push(`选项数异常：${item.options.length}`);
    if (new Set(item.options.map((o) => String(o).trim().toLowerCase())).size !== item.options.length) {
      p.push("存在重复选项（多半是分栏没理干净）");
    }
    item.options.forEach((o, i) => { if (!String(o || "").trim()) p.push(`第 ${i + 1} 个选项为空`); });
  }
  const blob = [item.stem, item.material, ...(item.options || [])].join(" ");
  if (CJK.test(blob)) p.push("英文字段里混入中文");
  if (WATERMARK.test(blob)) p.push("水印未清干净");
  return p;
}
/* ↑↑↑ 复制结束 ↑↑↑ */

/* ── 屏幕文本判据 ─────────────────────────────────────────────────────────── */
/**
 * 考试界面顶栏：「Reading | Question 26 of 35」。OCR 常把竖线认成 1 / I / l、把空格吃掉
 * （"Reading1Question24of35"、"ReadingQuestion29of35"），所以两词之间容忍一个竖线替身。
 * 返回 [{q, qEnd, total}]，q 是区段首题号（CTW 屏是 "1-10"）。
 */
const HEADER_RE = /reading\W{0,6}[I1l|/]?\W{0,6}questions?\W{0,3}(\d{1,2})\W{0,3}(?:-\W{0,3}(\d{1,2})\W{0,3})?of\W{0,3}(\d{1,2})/gi;

function screenHeaders(text) {
  const out = [];
  for (const m of String(text || "").matchAll(HEADER_RE)) {
    out.push({ q: Number(m[1]), qEnd: m[2] ? Number(m[2]) : Number(m[1]), total: Number(m[3]) });
  }
  return out;
}

/**
 * 屏幕文本像不像插入句题（四个方块选插入位）：这一条链不管，交给 restore_insert_markers.py。
 * 判的是整屏 OCR（含正文），所以不认裸词 insert（正文里出现 insert 很正常）。
 */
function isInsertText(t) {
  const s = String(t || "");
  return /four\s*(locations|squares)|where\s*would\s*the\s*(following\s*)?sentence\s*best\s*fit/i.test(s.replace(/\s+/g, " "))
    || /fourlocations|foursquares|wherewouldthe(following)?sentencebestfit/i.test(s.replace(/\s+/g, ""));
}

/** 与 build_bank.mjs looksLikeInsertQuestion（行 386-389）同一判据：命中的题落库时没有插入位标记就会被丢。 */
function looksLikeInsertQuestion(it) {
  const probe = [String((it && it.stem) || ""), ...(Array.isArray(it && it.options) ? it.options : []).map(String)].join(" ");
  return /insert|slot\s*\d|■|four locations|where would the following sentence/i.test(probe);
}

/** 选句题（点正文里的一句话作答）：系统没有这个题型，本轮不做。 */
function isSelectText(t) {
  const s = String(t || "");
  return /(identify|select)\s*the\s*sentence/i.test(s) || /identifythesentence|selectthesentence/i.test(s.replace(/\s+/g, ""));
}

/* ── 目标分类（--plan） ───────────────────────────────────────────────────── */
/**
 * 一道有答案页字母的阅读选择题，在 structured 里是什么状态。
 *
 * @param {object|null} rec   structured 里装着这道题的那条记录（按 module + q_number / q_start 找到的）
 * @param {number} q          题号
 * @param {object|null} audit .audit.json 里这道题的明细（reading#q）
 * @param {boolean} passed    hold_policy.auditPassed(audit)
 * @returns {string} ok | no_audit | no_record | misrouted_ctw | passage_screen | bad_options
 *                   | flagged_json | flagged_content | audit_disagree
 */
function classifyTarget(rec, q, audit, passed) {
  if (!rec) return "no_record";
  if (rec.type === "ctw") return "misrouted_ctw";
  if (rec.status === "passage_screen") return "passage_screen";
  if (rec.status === "ok") {
    const items = Array.isArray(rec.items) ? rec.items : [];
    const it = items.find((i) => i && Number(i.q_number) === Number(q)) || items[0];
    const opts = Array.isArray(it && it.options) ? it.options.map((o) => String(o == null ? "" : o).trim()) : [];
    const ai = it && it.answer_index;
    if (opts.length !== 4 || opts.some((o) => !o) || !Number.isInteger(ai) || ai < 0 || ai > 3) return "bad_options";
    if (!audit) return "no_audit";
    return passed ? "ok" : "audit_disagree";
  }
  const ps = (rec.problems || []).join(" ");
  return /选项|题干|答案/.test(ps) ? "flagged_content" : "flagged_json";
}

/** 看图重抽要处理的分类（no_audit 交给 --only-missing 盲审，ok / no_record 不动）。 */
const VISION_CATS = Object.freeze(["flagged_json", "flagged_content", "bad_options", "misrouted_ctw", "passage_screen", "audit_disagree"]);

/* ── 材料：沿用同篇已 ok 记录的正文（与 build_bank.mjs 卷内归并同一口径） ─────── */
// 与 build_bank.mjs 的 matNorm / matTokens / jaccard / isSameMaterial 同一口径（行 226-241、313-317）。
const MATERIAL_JACCARD_MIN = 0.8;
const MATERIAL_PREFIX_CHARS = 60;
const MATERIAL_MIN_KEY_CHARS = 30;
const matNorm = (s) => String(s || "").toLowerCase().replace(/[^a-z]+/g, " ").replace(/\s+/g, " ").trim();
const matTokens = (s) => new Set(matNorm(s).split(" ").filter((w) => w.length > 3));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}
/** build_bank 会不会把这两段材料并成同一篇。 */
function buildWouldMerge(a, b) {
  const ka = matNorm(a), kb = matNorm(b);
  if (ka.length < MATERIAL_MIN_KEY_CHARS || kb.length < MATERIAL_MIN_KEY_CHARS) return false;
  if (ka.slice(0, MATERIAL_PREFIX_CHARS) === kb.slice(0, MATERIAL_PREFIX_CHARS)) return true;
  return jaccard(matTokens(a), matTokens(b)) >= MATERIAL_JACCARD_MIN;
}
/** inner 的实词有多大比例出现在 outer 里（截图只露出长文的一截时，Jaccard 会被长度差拉低，所以另看包含度）。 */
function containment(inner, outer) {
  const a = matTokens(inner);
  if (!a.size) return 0;
  const b = matTokens(outer);
  let hit = 0;
  for (const t of a) if (b.has(t)) hit += 1;
  return hit / a.size;
}
/** 包含度判同篇的门槛：同卷同 module 两篇**不同**文章的实词重合实测 ≤0.06（build_bank 注释），0.7 远在空档里。 */
const CONTAINMENT_MIN = 0.7;
const CONTAINMENT_MIN_TOKENS = 15;

/**
 * 给看图转写出来的题挑材料。
 *
 * pool 是同卷同 module 已经 ok 的记录的材料（外加本轮先处理的同篇新题已经选定的材料）。
 * 与转写正文是同一篇的（build_bank 会并的，或包含度 ≥0.7）→ **逐字沿用**池里那份：
 * 这样 build_bank 卷内归并必然把新题并进已有的那一篇，已有条目的正文与代表材料一个字都不变。
 * 池里没有同一篇 → 用转写正文（一篇全新的文章，或同篇题此前全军覆没）。
 *
 * @param {string} transcribed 转写出的材料
 * @param {Array<{material:string, material_kind?:string, type?:string, key?:string}>} pool
 * @returns {{material:string, material_kind:string|null, type:string|null, from:string|null, score:number}}
 */
function pickMaterial(transcribed, pool) {
  let best = null;
  const tTok = matTokens(transcribed);
  for (const p of pool || []) {
    if (!p || !String(p.material || "").trim()) continue;
    const merge = buildWouldMerge(transcribed, p.material);
    const cont = tTok.size >= CONTAINMENT_MIN_TOKENS ? Math.max(containment(transcribed, p.material), containment(p.material, transcribed)) : 0;
    if (!merge && cont < CONTAINMENT_MIN) continue;
    const score = (merge ? 1 : 0) + cont;
    const len = String(p.material).length;
    if (!best || score > best.score || (score === best.score && len > best.len)) {
      best = { material: p.material, material_kind: p.material_kind || null, type: p.type || null, from: p.key || null, score, len };
    }
  }
  if (best) return { material: best.material, material_kind: best.material_kind, type: best.type, from: best.from, score: best.score };
  return { material: String(transcribed || "").trim(), material_kind: null, type: null, from: null, score: 0 };
}

/* ── 转写比对（audit_disagree 只在「转写确实变了」时才替换） ─────────────────── */
const qNorm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * 两份转写是不是同一道题的同一种写法：题干归一化后相同，且选项**按顺序**归一化后逐个相同。
 * 选项顺序或内容有一处不同，就说明原来的转写错位/串栏 —— 这正是两票盲审都不一致时唯一值得救的情形。
 */
function sameQuestion(a, b) {
  if (!a || !b) return false;
  if (qNorm(a.stem) !== qNorm(b.stem)) return false;
  const oa = Array.isArray(a.options) ? a.options.map(qNorm) : [];
  const ob = Array.isArray(b.options) ? b.options.map(qNorm) : [];
  return oa.length === ob.length && oa.every((x, i) => x === ob[i]);
}

/** 选项集合相同但顺序不同（最典型的错位）。 */
function sameOptionsDifferentOrder(a, b) {
  const oa = Array.isArray(a && a.options) ? a.options.map(qNorm) : [];
  const ob = Array.isArray(b && b.options) ? b.options.map(qNorm) : [];
  if (oa.length !== ob.length || !oa.length) return false;
  // 归一化后的选项只含字母数字与空格，用 "|" 拼接不会串
  const sa = [...oa].sort().join("|"), sb = [...ob].sort().join("|");
  return sa === sb && oa.join("|") !== ob.join("|");
}

/** 题干没说完（closest in / closest in meaning），或某个选项只是题干的尾巴（meaning to / to）。 */
function stemWrappedIntoOptions(stem, options) {
  if (/\bclosest\s+in(\s+meaning)?\s*[:.]?\s*$/i.test(String(stem || ""))) return true;
  return Array.isArray(options) && options.some((o) => /^\s*(in\s+)?(meaning\s+)?to\s*[.:]?\s*$/i.test(String(o || "")) || /^\s*meaning\s*$/i.test(String(o || "")));
}

/* ── 由转写构造题（--apply） ──────────────────────────────────────────────── */
/**
 * 转写 JSON + 答案页字母 → 结构化阶段同形状的 item，外加过闸结果。
 * 插入句题 / 选句题直接拒（它们各有各的链）。不改入参。
 *
 * @returns {{ok:boolean, item:object|null, problems:string[]}}
 */
function buildItem(parsed, { q, answer, material, material_kind }) {
  const problems = [];
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, item: null, problems: ["转写不是 JSON 对象"] };
  const stem = String(parsed.stem == null ? "" : parsed.stem).replace(/\s+/g, " ").trim();
  const options = Array.isArray(parsed.options)
    ? parsed.options.map((o) => String(o == null ? "" : o).replace(/\s+/g, " ").trim())
    : parsed.options;
  if (isInsertText(stem) || looksLikeInsertQuestion({ stem, options })) {
    return { ok: false, item: null, problems: ["插入句题（交给 restore_insert_markers 链）"] };
  }
  if (isSelectText(stem)) return { ok: false, item: null, problems: ["选句题（系统无此题型）"] };
  // 题干折行被切成了第一个选项：「…is closest in」+ A「meaning to」。2026-09-13 实跑 103 张里 5 张如此，
  // 同时真正的四个选项只剩三个 —— 盖上去的字母很可能错一位，一律不收。
  if (stemWrappedIntoOptions(stem, options)) {
    return { ok: false, item: null, problems: ["题干折行被当成了选项（…closest in / meaning to）"] };
  }
  const item = {
    material: String(material == null ? (parsed.material || "") : material).trim(),
    material_kind: material_kind || String(parsed.material_kind || "passage"),
    stem,
    options,
  };
  problems.push(...verifyMcq(item), ...stampAnswer(item, answer));
  // verifyMcq 放行 3~5 个选项（结构化阶段的口径），但 build_bank 只收恰好 A–D 四个 —— 写回 3/5 个选项的题没有意义。
  if (Array.isArray(options) && options.length !== 4) problems.push(`选项不是恰好 4 个（${options.length}），build_bank 只收 A–D`);
  if (problems.length) return { ok: false, item: null, problems };
  item.q_number = Number(q);
  item.answer_key = answer;
  return { ok: true, item, problems: [] };
}

/**
 * 看图重抽后的记录（不改入参）。原状态、原 problems、原 items 全部留在 vision_restored 上，可追溯、可回滚。
 */
function restoredRecord(rec, item, meta) {
  const m = meta || {};
  return {
    ...rec,
    type: m.type || rec.type,
    status: "ok",
    problems: [],
    items: [item],
    vision_restored: {
      by: "qwen3-vl",
      model: m.model || null,
      at: m.at || new Date().toISOString(),
      category: m.category || null,
      source_page: m.source_page || null,
      material_from: m.material_from || null,
      prev_status: rec.status,
      prev_problems: rec.problems || [],
      prev_type: rec.type,
      prev_items: rec.items || [],
    },
  };
}

module.exports = {
  LETTERS,
  stampAnswer,
  verifyMcq,
  HEADER_RE,
  screenHeaders,
  isInsertText,
  looksLikeInsertQuestion,
  isSelectText,
  classifyTarget,
  VISION_CATS,
  buildWouldMerge,
  containment,
  pickMaterial,
  sameQuestion,
  sameOptionsDifferentOrder,
  buildItem,
  restoredRecord,
  CONTAINMENT_MIN,
};
