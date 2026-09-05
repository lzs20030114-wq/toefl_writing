// 「真题专区」（Real Questions）数据层 —— 一期只覆盖写作三题型。
//
// 这些真题此前只作为「出题参考语料」存在（few-shot + 校准锚），从不进练习题库；本模块把它们
// 只读地映射成练习页能直接消费的形状，供 app/real-bank 使用。四个源文件**只读**，本模块不写回。
//
// 为什么要加 `real_` id 前缀：
//   - `real_tpo_reference.json` 里有 27 条 `ad*` id 与 live 库 data/academicWriting/prompts.json
//     重叠（历史上被 integrate 脚本合并过），不加前缀会让「已练」记录与历史记录互相污染；
//   - `usr_` 是个人题库的保留前缀，真题另用 `real_`，三套 id 空间互不相交。
//
// 诚实标注（重要）：来源分档严格按 data/REFERENCE_BANKS.md 的口径，不许把未核验的语料标成官方。
//   official — ETS 官方 PDF 逐字收录（BS 20 题 + 邮件 tpo1/tpo2）
//   recalled — 2026 真实考试回忆重构（AD recalled_supplement 44 题）
//   legacy   — 审计之前收集、来源未核验（AD real_tpo_reference 81 题无 tier 字段 + 邮件 tpo3–tpo13）
//              REFERENCE_BANKS.md 明确写：「Items with no tier field are legacy（provenance
//              unverified）」，所以这 81 条**不能**标成官方。
//
// 二期（阅读）：data/realBank/reading/{ctw,rdl,ap}.json 由 scripts/realbank/build_bank.mjs 从
// 闲鱼来源的 2026 机经 OCR 产物汇出，只收「盲审一致」的题，来源分档一律 recalled（回忆版）。
// 这三个文件是**构建产物**（不是手写语料），可能为空；本模块对每一条做防御性校验，
// 适配不了的整条作废 —— 出题宁可少，不许出用户答不了的死题。
import AD_TPO_REFERENCE from "../data/academicWriting/real_tpo_reference.json";
import AD_RECALLED from "../data/academicWriting/recalled_supplement.json";
import EM_TPO_REFERENCE from "../data/emailWriting/tpo_reference.json";
import BS_TPO_OFFICIAL from "../data/buildSentence/tpo_official.json";
import RB_READING_CTW from "../data/realBank/reading/ctw.json";
import RB_READING_RDL from "../data/realBank/reading/rdl.json";
import RB_READING_AP from "../data/realBank/reading/ap.json";
import { extractShortTitle } from "./academicWriting/topicTitle";

export const REAL_BANK_ID_PREFIX = "real_";

/** 真题 id 判定（历史 / 已练记录里区分真题与 live 题、个人题）。 */
export function isRealBankId(id) {
  return String(id || "").startsWith(REAL_BANK_ID_PREFIX);
}

function realId(rawId) {
  return `${REAL_BANK_ID_PREFIX}${String(rawId || "").trim()}`;
}

/** 来源分档 → 中文标签。未知 tier 一律当 legacy 处理（宁可少吹，不许多吹）。 */
export const REAL_TIER_LABELS = {
  official: "ETS官方",
  recalled: "回忆版",
  legacy: "参考版",
};

export const REAL_TIER_NOTE =
  "ETS官方 = ETS 官方 PDF 原题；回忆版 = 2026 考生回忆整理；参考版 = 早期收集，来源未核验。";

export function realTierLabel(tier) {
  return REAL_TIER_LABELS[tier] || REAL_TIER_LABELS.legacy;
}

function normalizeTier(rawTier) {
  const t = String(rawTier || "").trim();
  return t === "official" || t === "recalled" ? t : "legacy";
}

function truncate(text, max) {
  const s = String(text || "").trim();
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

/* ── 学术讨论真题（81 参考版 + 44 回忆版 = 125） ─────────────────── */

function mapDiscussion(raw) {
  const students = (Array.isArray(raw?.students) ? raw.students : []).map((s) => ({
    name: String(s?.name || "").trim(),
    text: String(s?.text || "").trim(),
  }));
  return {
    id: realId(raw?.id),
    course: String(raw?.course || "").trim(),
    professor: {
      name: String(raw?.professor?.name || "").trim(),
      text: String(raw?.professor?.text || "").trim(),
    },
    students,
    tier: normalizeTier(raw?.tier),
    source: String(raw?.source || "").trim(),
    date: String(raw?.date || "").trim(),
    real: true,
  };
}

/**
 * 125 条学术讨论真题（regular 参考版在前、回忆版在后 —— 回忆版是 2026 真实考试题，
 * 更贴近当下考情，所以放在列表更显眼的位置）。
 */
export function getRealDiscussionPrompts() {
  const recalled = (Array.isArray(AD_RECALLED) ? AD_RECALLED : []).map(mapDiscussion);
  const reference = (Array.isArray(AD_TPO_REFERENCE) ? AD_TPO_REFERENCE : []).map(mapDiscussion);
  return [...recalled, ...reference].filter(
    (p) => p.id && p.professor.name && p.professor.text && p.students.length >= 2
  );
}

/* ── 邮件真题（2 ETS 官方 + 11 参考版 = 13） ─────────────────────── */

function mapEmail(raw) {
  return {
    id: realId(raw?.id),
    to: String(raw?.to || "Professor").trim() || "Professor",
    scenario: String(raw?.scenario || "").trim(),
    direction: String(raw?.direction || "").trim(),
    goals: (Array.isArray(raw?.goals) ? raw.goals : [])
      .map((g) => String(g || "").trim())
      .filter(Boolean)
      .slice(0, 3),
    ...(String(raw?.subject || "").trim() && { subject: String(raw.subject).trim() }),
    tier: normalizeTier(raw?.tier),
    source: String(raw?.source || "").trim(),
    real: true,
  };
}

export function getRealEmailPrompts() {
  return (Array.isArray(EM_TPO_REFERENCE) ? EM_TPO_REFERENCE : [])
    .map(mapEmail)
    .filter((p) => p.id && p.scenario && p.direction && p.goals.length >= 3);
}

/* ── 造句官方真题（20 条 ETS 官方） ─────────────────────────────── */
//
// tpo_official.json 是「模板 + 词块 + 答案」形状，与 runtime（lib/questionBank/runtimeModel.js）
// 期望的形状差一层：runtime 靠 prefilled_positions（固定词在 answer 里的词下标）锁死题干给定词，
// 而真题文件用 `blanks` 模板（"The _____ _____ fantastic."）表达同一件事。下面把模板里的固定词
// 对齐到 answer 的词下标，得到 prefilled / prefilled_positions；其余字段按 runtime 契约补齐。

const REAL_BS_GROUP_PREFIX = "real-bs-set-";

function bsNormWord(s) {
  // 与 runtimeModel.normalizeWord / sentenceEngine.words 同口径：只剥 .,!?;: ，保留撇号。
  return String(s || "").toLowerCase().replace(/[.,!?;:]/g, "").trim();
}

function stripEdgePunct(word) {
  return String(word || "")
    .replace(/^[^\w'’]+/, "")
    .replace(/[^\w'’]+$/, "");
}

/** 把 `blanks` 模板切成 [固定词段 | 空位] 序列（保留原始大小写用于展示）。 */
function parseBlanksTemplate(blanks) {
  const segments = String(blanks || "").split(/_{2,}/);
  const tokens = [];
  segments.forEach((segment, i) => {
    const words = segment.split(/\s+/).map(stripEdgePunct).filter(Boolean);
    if (words.length > 0) tokens.push({ type: "literal", words });
    if (i < segments.length - 1) tokens.push({ type: "blank" });
  });
  return { tokens, blankCount: segments.length - 1 };
}

/**
 * 由 `blanks` 模板 + `answer` 推出固定词位置。
 * 每个空位至少吃掉 answer 的一个词，所以下一段固定词的搜索起点 = 上一段结束位置 + 中间空位数，
 * 这个下界让「固定词在 answer 里多次出现」时也不会对齐到错误的那一次。
 */
function deriveBsPrefilled(answer, blanks) {
  const { tokens } = parseBlanksTemplate(blanks);
  const answerWords = String(answer || "").trim().split(/\s+/).map(bsNormWord).filter(Boolean);
  const prefilled = [];
  const prefilledPositions = {};
  let lowerBound = 0;
  let pendingBlanks = 0;

  for (const token of tokens) {
    if (token.type === "blank") {
      pendingBlanks += 1;
      continue;
    }
    const target = token.words.map(bsNormWord);
    let found = -1;
    for (let i = lowerBound + pendingBlanks; i + target.length <= answerWords.length; i += 1) {
      let ok = true;
      for (let j = 0; j < target.length; j += 1) {
        if (answerWords[i + j] !== target[j]) { ok = false; break; }
      }
      if (ok) { found = i; break; }
    }
    const key = token.words.join(" ");
    if (found < 0) {
      throw new Error(`真题造句适配失败：固定词「${key}」无法对齐到 answer`);
    }
    if (Object.prototype.hasOwnProperty.call(prefilledPositions, key)) {
      throw new Error(`真题造句适配失败：固定词「${key}」在模板中重复出现`);
    }
    prefilled.push(key);
    prefilledPositions[key] = found;
    lowerBound = found + target.length;
    pendingBlanks = 0;
  }

  return { prefilled, prefilledPositions };
}

function mapBuildSentence(raw) {
  // runtime 只支持单个 distractor；多余的干扰块（目前数据里没有）从 chunks 里剔除，
  // 否则 bank 长度校验会直接判整题数据异常。
  const distractors = (Array.isArray(raw?.distractors) ? raw.distractors : [])
    .map((d) => String(d || "").trim())
    .filter(Boolean);
  const distractor = distractors.length > 0 ? distractors[0] : null;
  const dropped = new Set(distractors.slice(1));
  const chunks = (Array.isArray(raw?.chunks) ? raw.chunks : [])
    .map((c) => String(c || "").trim())
    .filter((c) => c && !dropped.has(c));

  const answer = String(raw?.answer || "").trim();
  const { prefilled, prefilledPositions } = deriveBsPrefilled(answer, raw?.blanks);

  return {
    id: realId(raw?.id),
    prompt: String(raw?.prompt || "").trim(),
    answer,
    chunks,
    prefilled,
    prefilled_positions: prefilledPositions,
    distractor,
    has_question_mark: /\?\s*$/.test(answer),
    grammar_points: [],
    difficulty: "medium",
    tier: normalizeTier(raw?.tier || "official"),
    source: String(raw?.source || "").trim(),
    source_label: String(raw?.source_label || "").trim(),
    real: true,
  };
}

/**
 * 20 条造句官方真题，已按 source_label（Full-Length Practice Test 1 / 2）分成 2 批各 10 题，
 * 每题带 `__sourceGroupId`（"real-bs-set-1" / "real-bs-set-2"）—— useBuildSentenceSession
 * 完成后按该字段写 DONE_STORAGE_KEYS.BUILD_SENTENCE_GP，picker 因此零改动就有「已练」标记。
 */
export function getRealBSBatches() {
  const adapted = (Array.isArray(BS_TPO_OFFICIAL) ? BS_TPO_OFFICIAL : []).map(mapBuildSentence);
  const order = [];
  const byLabel = new Map();
  adapted.forEach((q) => {
    const label = q.source_label || "ETS 官方真题";
    if (!byLabel.has(label)) { byLabel.set(label, []); order.push(label); }
    byLabel.get(label).push(q);
  });
  return order.map((label, i) => {
    const groupId = `${REAL_BS_GROUP_PREFIX}${i + 1}`;
    return {
      id: groupId,
      label,
      questions: byLabel.get(label).map((q) => ({ ...q, __sourceGroupId: groupId })),
    };
  });
}

/** 扁平的 20 条（已带 __sourceGroupId）。 */
export function getRealBSQuestions() {
  return getRealBSBatches().flatMap((b) => b.questions);
}

/* ── TopicPicker 映射（类比 lib/userBank/personalBank.js 的 mapPersonalToPicker） ── */

/**
 * 讨论题：tag 驱动 TopicPicker 的分类筛选栏，所以只能放**低基数**的值。
 * 参考版 81 条用的是一套干净的 12 门课程词表 → 直接拿 course 当分类（保留话题筛选）；
 * 回忆版 44 条的 course 是逐题一句话描述（43 个互不相同的取值），拿它当分类会把筛选栏
 * 撑成 56 个几乎全为「(1)」的 pill —— 所以回忆版统一归到「回忆版」这一类，course 移到 subtitle。
 * 两种卡片都始终同时展示「来源分档 + 课程」，信息不丢。
 */
export function mapRealDiscussionToPicker(items) {
  return (Array.isArray(items) ? items : []).map((p) => {
    const tierLabel = realTierLabel(p.tier);
    const excerpt = truncate(p.professor?.text, 110);
    const isRecalled = p.tier === "recalled";
    return {
      id: p.id,
      tag: isRecalled ? tierLabel : (p.course || tierLabel),
      title: extractShortTitle(p.professor?.text) || "(真题讨论)",
      subtitle: isRecalled
        ? `${p.course ? `${p.course} · ` : ""}${excerpt}`
        : `${tierLabel} · ${excerpt}`,
    };
  });
}

/** 邮件题：tag = TPO（13 题、单一分类 → picker 自动不显示筛选栏）。 */
export function mapRealEmailToPicker(items) {
  return (Array.isArray(items) ? items : []).map((p) => {
    const sentences = String(p.scenario || "").split(/(?<=[.!?])\s+/).filter(Boolean);
    const first = sentences[0]?.trim() || p.scenario || "";
    return {
      id: p.id,
      tag: "TPO",
      title: truncate(first, 70) || "(真题邮件)",
      subtitle: `${realTierLabel(p.tier)} · ${truncate(sentences.slice(1).join(" ") || p.scenario, 110)}`,
    };
  });
}

/** 造句题：2 张批次卡（每批 10 题），id = __sourceGroupId，与已练 key 同源。 */
export function mapRealBSToPicker(batches) {
  return (Array.isArray(batches) ? batches : []).map((b, i) => ({
    id: b.id,
    tag: REAL_TIER_LABELS.official,
    title: `第 ${i + 1} 套 · ${b.questions.length} 题`,
    subtitle: b.label,
  }));
}

/* ── 阅读真题（CTW / RDL / AP） ──────────────────────────────────── */
//
// 这一段全是**防御性适配**：源文件是脚本产物，一条数据坏了不该让整个真题专区白屏，
// 更不该把「怎么答都错」的死题摆给用户。所以每条都按消费方（CTWTask / RDLTask）的硬契约
// 逐项体检，过不了的整条丢掉（与 deriveBsPrefilled 同哲学：适配失败 = 这条不存在）。
//
// 来源分档：build_bank.mjs 只产 recalled；这里再钉一次，防止源文件被手工改坏后冒充官方。

const REAL_READING_TIER = "recalled";

function bankItems(bank) {
  return Array.isArray(bank?.items) ? bank.items : [];
}

/** id 已由 build_bank 内置 `real_` 前缀；缺前缀的才补，绝不重复加（否则 real_real_…）。 */
function readingId(rawId) {
  const id = String(rawId || "").trim();
  if (!id) return "";
  return isRealBankId(id) ? id : realId(id);
}

function readingProvenance(raw) {
  return {
    real: true,
    tier: REAL_READING_TIER,
    source: String(raw?.source || "").trim(),
    date: String(raw?.date || "").trim(),
  };
}

function firstSentence(text) {
  const s = String(text || "").trim();
  if (!s) return "";
  const m = s.match(/^[^.!?\n]+[.!?]?/);
  return (m ? m[0] : s).trim();
}

/**
 * CTW 一条题的硬契约（全部来自 components/reading/CTWTask.js）：
 *   - passage 非空；渲染用 `passage.split(/\s+/)`，blanks[].position 是这套下标；
 *   - blanks 非空、position 升序且互不重复（渲染按出现顺序逐个消费 blanks，乱序会串位）；
 *   - original_word 以 displayed_fragment 开头（忽略大小写），且**不带尾标点** ——
 *     输入框宽度 / maxLength = original_word.length - fragment.length，多一位就永远填不满；
 *   - 屏幕上那个词也要以 fragment 开头，否则用户看到的前缀和答案对不上。
 */
function mapRealCTW(raw) {
  const id = readingId(raw?.id);
  const passage = String(raw?.passage || "").trim();
  const srcBlanks = Array.isArray(raw?.blanks) ? raw.blanks : [];
  if (!id || !passage || srcBlanks.length === 0) return null;

  const tokens = passage.split(/\s+/);
  const blanks = [];
  let prevPosition = -1;
  for (const b of srcBlanks) {
    const position = Number(b?.position);
    const originalWord = String(b?.original_word || "");
    const fragment = String(b?.displayed_fragment || "");
    if (!Number.isInteger(position) || position <= prevPosition || position >= tokens.length) return null;
    if (!originalWord || !fragment) return null;
    if (/[.,;:!?]$/.test(originalWord)) return null;                       // 尾标点没剥干净
    if (!originalWord.toLowerCase().startsWith(fragment.toLowerCase())) return null;
    if (originalWord.length - fragment.length < 1) return null;            // 没有空可填
    if (!tokens[position].toLowerCase().startsWith(fragment.toLowerCase())) return null;
    blanks.push({ position, original_word: originalWord, displayed_fragment: fragment });
    prevPosition = position;
  }

  return {
    id,
    passage,
    first_sentence: String(raw?.first_sentence || "").trim() || firstSentence(passage),
    topic: String(raw?.topic || "").trim(),
    subtopic: String(raw?.subtopic || "").trim(),
    blanks,
    blank_count: blanks.length,
    word_count: tokens.length,
    difficulty: String(raw?.difficulty || "medium"),
    ...readingProvenance(raw),
  };
}

/**
 * RDL / AP 共用的选择题体检：RDLTask:262 硬编码渲染 A/B/C/D 四个键，
 * 少一个选项或答案键不在 A-D 里，正确答案就渲染不出来 —— 用户怎么点都错。
 * 任一题不合格 = 整条材料作废（同一屏的其它题也一起丢，宁可少题不许出死题）。
 */
function mapMcqQuestions(rawQuestions) {
  const src = Array.isArray(rawQuestions) ? rawQuestions : [];
  if (src.length === 0) return null;
  const out = [];
  for (const q of src) {
    const stem = String(q?.stem || "").trim();
    const answer = String(q?.correct_answer || "").trim().toUpperCase();
    const rawOptions = q?.options || {};
    const options = {};
    for (const key of ["A", "B", "C", "D"]) {
      const v = String(rawOptions?.[key] ?? "").trim();
      if (!v) return null;
      options[key] = v;
    }
    if (!stem) return null;
    if (!["A", "B", "C", "D"].includes(answer)) return null;
    out.push({
      question_type: String(q?.question_type || "detail"),
      stem,
      options,
      correct_answer: answer,
      ...(String(q?.explanation || "").trim() && { explanation: String(q.explanation).trim() }),
    });
  }
  return out;
}

function mapRealRDL(raw) {
  const id = readingId(raw?.id);
  const text = String(raw?.text || raw?.passage || "").trim();
  const questions = mapMcqQuestions(raw?.questions);
  if (!id || !text || !questions) return null;
  return {
    id,
    genre: String(raw?.genre || "").trim(),
    text,
    questions,
    format_metadata: raw?.format_metadata && typeof raw.format_metadata === "object"
      ? { ...raw.format_metadata }
      : {},
    difficulty: String(raw?.difficulty || "medium"),
    ...readingProvenance(raw),
  };
}

function mapRealAP(raw) {
  const id = readingId(raw?.id);
  const passage = String(raw?.passage || raw?.text || "").trim();
  const questions = mapMcqQuestions(raw?.questions);
  if (!id || !passage || !questions) return null;
  return {
    id,
    topic: String(raw?.topic || "").trim(),
    subtopic: String(raw?.subtopic || "").trim(),
    passage,
    paragraphs: (Array.isArray(raw?.paragraphs) ? raw.paragraphs : [])
      .map((p) => String(p || "").trim())
      .filter(Boolean),
    questions,
    difficulty: String(raw?.difficulty || "medium"),
    ...readingProvenance(raw),
  };
}

/** 阅读填词（Complete the Words）真题。 */
export function getRealCTWItems() {
  return bankItems(RB_READING_CTW).map(mapRealCTW).filter(Boolean);
}

/**
 * 日常阅读（Read in Daily Life）真题。
 * live 库按题数拆 rdl-short / rdl-long 双池；真题不分池 —— 一屏材料带几道题是既成事实，
 * 按题数硬切只会把同一场考试的题拆到两个列表里，用户找不着。
 */
export function getRealRDLItems() {
  return bankItems(RB_READING_RDL).map(mapRealRDL).filter(Boolean);
}

/** 学术阅读（Academic Passage）真题。 */
export function getRealAPItems() {
  return bankItems(RB_READING_AP).map(mapRealAP).filter(Boolean);
}

/**
 * 阅读真题的 picker 标签：**不走** app/reading/page.js 的 TOPIC_LABELS / GENRE_LABELS ——
 * 那两张表是给 AI 生成题的固定学科 / 体裁枚举查的，真题的 topic 是 OCR 抽出来的自由文本，
 * 查不到只会渲染出一堆生词。真题唯一稳定且对用户有意义的分类是「来源分档 + 考试日期」。
 */
function readingTag(item) {
  const label = realTierLabel(item?.tier);
  return item?.date ? `${label} · ${item.date}` : label;
}

function readingSubtitle(item, tail) {
  return [item?.date, tail].filter(Boolean).join(" · ");
}

export function mapRealCTWToPicker(items) {
  return (Array.isArray(items) ? items : []).map((it) => ({
    id: it.id,
    tag: readingTag(it),
    title: truncate(it.first_sentence || it.passage, 70) || "(真题填词)",
    subtitle: readingSubtitle(it, `${it.blank_count} 空 · ${it.word_count} 词`),
  }));
}

export function mapRealRDLToPicker(items) {
  return (Array.isArray(items) ? items : []).map((it) => ({
    id: it.id,
    tag: readingTag(it),
    title: truncate(it.format_metadata?.title || it.format_metadata?.subject || firstSentence(it.text), 70)
      || "(真题日常阅读)",
    subtitle: readingSubtitle(it, `${it.questions.length} 题`),
  }));
}

export function mapRealAPToPicker(items) {
  return (Array.isArray(items) ? items : []).map((it) => ({
    id: it.id,
    tag: readingTag(it),
    title: truncate(firstSentence(it.passage), 70) || "(真题学术阅读)",
    subtitle: readingSubtitle(it, `${it.questions.length} 题`),
  }));
}
