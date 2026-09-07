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
import RB_LISTENING_LCR from "../data/realBank/listening/lcr.json";
import RB_LISTENING_LC from "../data/realBank/listening/lc.json";
import RB_LISTENING_LA from "../data/realBank/listening/la.json";
import RB_LISTENING_LAT from "../data/realBank/listening/lat.json";
import RB_LISTENING_COUNTS from "../data/realBank/listening/counts.json";
import RB_SPEAKING_REPEAT from "../data/realBank/speaking/repeat.json";
import RB_SPEAKING_INTERVIEW from "../data/realBank/speaking/interview.json";
import RB_SPEAKING_COUNTS from "../data/realBank/speaking/counts.json";
export { materialImageSrc } from "./reading/materialImage";

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

/**
 * 选题卡片上的考试日期：`2026-06-10` → `2026.06.10`（点分更像「日期戳」而不是数据字段，
 * 也与卡片里的等宽数字对齐）。不是 ISO 日期的原样返回，空值返回空串。
 */
export function formatExamDate(date) {
  const d = String(date || "").trim();
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : d;
}

/**
 * 真题选题卡片统一只露「第 N 套 + 哪天考的」（用户不需要在选题时读题面）：
 *   title    = 「第 N 套」，N 是该题型列表里的稳定序号（源库只追加不重排，序号不会漂）；
 *   subtitle = 「考试日期 · 来源分档」；没有日期的（参考版 / 邮件）只剩来源分档，卡片永远不空一行；
 *   no       = 数字序号，TopicPicker 紧凑模式拿它做视觉强调；
 *   badge    = 仅 ETS 官方题带一枚小徽章（「真题」是敏感宣称，官方 / 回忆 / 参考不能混着看）。
 */
function compactCard(item, index, subtitleFallback) {
  const date = formatExamDate(item?.date);
  return {
    id: item.id,
    no: index + 1,
    title: `第 ${index + 1} 套`,
    subtitle: date ? `${date} · ${realTierLabel(item?.tier)}` : (subtitleFallback || realTierLabel(item?.tier)),
    ...(item?.tier === "official" && { badge: REAL_TIER_LABELS.official }),
  };
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
 * 撑成 56 个几乎全为「(1)」的 pill —— 所以回忆版统一归到「回忆版」这一类。
 * 卡片本身只露「第 N 套 + 考试日期」（见 compactCard）；参考版没有日期，第二行退回「参考版」，
 * 来源分档在 tag 或 subtitle 里总有一处可见。
 */
export function mapRealDiscussionToPicker(items) {
  return (Array.isArray(items) ? items : []).map((p, i) => {
    const tierLabel = realTierLabel(p.tier);
    const isRecalled = p.tier === "recalled";
    return {
      ...compactCard(p, i, tierLabel),
      tag: isRecalled ? tierLabel : (p.course || tierLabel),
    };
  });
}

/** 邮件题：tag = TPO（13 题、单一分类 → picker 自动不显示筛选栏）；没有考试日期，第二行标来源分档。 */
export function mapRealEmailToPicker(items) {
  return (Array.isArray(items) ? items : []).map((p, i) => ({
    ...compactCard(p, i, realTierLabel(p.tier)),
    tag: "TPO",
  }));
}

/** 造句题：2 张批次卡（每批 10 题），id = __sourceGroupId，与已练 key 同源。 */
export function mapRealBSToPicker(batches) {
  return (Array.isArray(batches) ? batches : []).map((b, i) => ({
    id: b.id,
    no: i + 1,
    tag: REAL_TIER_LABELS.official,
    title: `第 ${i + 1} 套 · ${b.questions.length} 题`,
    subtitle: b.label,
    badge: REAL_TIER_LABELS.official,
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
    source_flags: readingSourceFlags(raw),
  };
}

/**
 * 该题所属考试套次的已知源料缺陷（build_bank.mjs 从 data/realBank/source-flags.json 写入）。
 * 逐条重建而不是直接透传 raw.source_flags —— 库文件是构建产物，形状坏了不该顺着流进 UI。
 * 缺字段或形状不对一律降级成空数组：标记是给人看的附加信息，不该把题本身拦掉。
 */
function readingSourceFlags(raw) {
  const src = Array.isArray(raw?.source_flags) ? raw.source_flags : [];
  return src
    .filter((f) => f && typeof f.code === "string" && f.code)
    .map((f) => ({
      code: f.code,
      severity: f.severity === "blocking" ? "blocking" : "warn",
      detail: String(f.detail || "").trim(),
    }));
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

/**
 * 材料框原图（可选）。真题界面左侧的材料是有版面的（邮件表头 / 短信气泡 / 海报分栏 /
 * 柱状图），纯文本全丢了 —— scripts/realbank/crop_materials.py 把那块框裁成 WebP 传上
 * Supabase，这里把 { url, w, h, source_page } 透传给 RDLTask。
 * 字段可选：缺了或形状不对就当没有，前端照旧渲染文本（老库、个人题库、AI 生成题都走这一支）。
 */
function mapMaterialImage(raw) {
  const url = String(raw?.url || "").trim();
  if (!url) return null;
  const w = Number(raw?.w);
  const h = Number(raw?.h);
  return {
    url,
    ...(Number.isFinite(w) && w > 0 && { w: Math.round(w) }),
    ...(Number.isFinite(h) && h > 0 && { h: Math.round(h) }),
  };
}

function mapRealRDL(raw) {
  const id = readingId(raw?.id);
  const text = String(raw?.text || raw?.passage || "").trim();
  const questions = mapMcqQuestions(raw?.questions);
  if (!id || !text || !questions) return null;
  const materialImage = mapMaterialImage(raw?.material_image);
  return {
    id,
    genre: String(raw?.genre || "").trim(),
    text,
    questions,
    ...(materialImage && { material_image: materialImage }),
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
  const materialImage = mapMaterialImage(raw?.material_image);
  return {
    id,
    ...(materialImage && { material_image: materialImage }),
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
 * 查不到只会渲染出一堆生词。真题唯一稳定且对用户有意义的分类是「考试日期」——
 * tag 只放日期（筛选条一眼扫过去全是日期，按时间排），来源分档放在每张卡的第二行（compactCard）。
 */
function readingTag(item) {
  return formatExamDate(item?.date) || realTierLabel(item?.tier);
}

export function mapRealCTWToPicker(items) {
  return (Array.isArray(items) ? items : []).map((it, i) => ({ ...compactCard(it, i), tag: readingTag(it) }));
}

export function mapRealRDLToPicker(items) {
  return (Array.isArray(items) ? items : []).map((it, i) => ({ ...compactCard(it, i), tag: readingTag(it) }));
}

export function mapRealAPToPicker(items) {
  return (Array.isArray(items) ? items : []).map((it, i) => ({ ...compactCard(it, i), tag: readingTag(it) }));
}

/* ── 听力真题（LCR / LC / LA / LAT） ─────────────────────────────── */
//
// 三期：data/realBank/listening/*.json 与 data/realBank/speaking/*.json 同样是
// scripts/realbank/build_bank.mjs 的**构建产物**（题面来自机经重排版 docx，音频来自
// merge_vendor_asr.py 的转写合流 + render_real_audio.mjs 配音），来源分档一律 recalled。
//
// 这一段沿用阅读那一套「防御性适配」哲学：每条按消费方组件（LCRTask / ListeningMCQTask /
// RepeatTask / InterviewTask）的硬契约体检，过不了的整条丢掉 —— 宁可少题，不许出死题。
// 与 __tests__/real-bank-listening-speaking-data.test.js 的关系是互补：那边拿**出题
// validator**（生成侧口径，含字数 / 题数画像）卡落库，这边拿**渲染侧口径**卡上屏。
//
// 音频：audio_url 是 Supabase listening_audio 桶的公开 URL，播放链路零改动 ——
// AudioPlayer 内部 sameOriginAudio() 会把它改写成 /api/audio/… 同源代理（国内可达），
// 所以这里**原样透传**，不许自己拼 URL。audio_url 为 null（配音未完成）时组件回退浏览器 TTS。

const REAL_LISTENING_TIER = "recalled";

/** 与 readingProvenance 同形，只是 tier 常量换成听力 / 口语这一支（两边都钉死 recalled）。 */
function listeningProvenance(raw) {
  return {
    real: true,
    tier: REAL_LISTENING_TIER,
    source: String(raw?.source || "").trim(),
    date: String(raw?.date || "").trim(),
    source_flags: readingSourceFlags(raw),
  };
}

/** 音频 URL 只接受绝对 http(s)（本地 /listening-audio 兜底路径线上 404）；其余一律 null → 组件回退 TTS。 */
function audioUrl(raw) {
  const u = String(raw?.audio_url || "").trim();
  return /^https?:\/\//.test(u) ? u : null;
}

/**
 * 听力选择题体检（LA / LC / LAT 共用）。契约来自 components/listening/ListeningMCQTask.js：
 * 每题渲染 A/B/C/D 四个键，`answer` 必须落在这四个键里，否则用户怎么点都错。
 * 注意听力题的答案键叫 `answer`（阅读那边叫 `correct_answer`），不能照抄 mapMcqQuestions。
 */
function mapListeningQuestions(rawQuestions) {
  const src = Array.isArray(rawQuestions) ? rawQuestions : [];
  if (src.length === 0) return null;
  const out = [];
  for (const q of src) {
    const stem = String(q?.stem || "").trim();
    const answer = String(q?.answer || "").trim().toUpperCase();
    const options = {};
    for (const key of ["A", "B", "C", "D"]) {
      const v = String(q?.options?.[key] ?? "").trim();
      if (!v) return null;
      options[key] = v;
    }
    if (!stem) return null;
    if (!["A", "B", "C", "D"].includes(answer)) return null;
    out.push({
      type: String(q?.type || "detail"),
      stem,
      options,
      answer,
      ...(String(q?.explanation || "").trim() && { explanation: String(q.explanation).trim() }),
    });
  }
  return out;
}

/** LCR：一条 = 一句口播 + 四个应答选项（LCRTask 的 item 契约）。 */
function mapRealLCR(raw) {
  const id = readingId(raw?.id);
  const speaker = String(raw?.speaker || "").trim();
  const answer = String(raw?.answer || "").trim().toUpperCase();
  const options = {};
  for (const key of ["A", "B", "C", "D"]) {
    const v = String(raw?.options?.[key] ?? "").trim();
    if (!v) return null;
    options[key] = v;
  }
  if (!id || !speaker || !["A", "B", "C", "D"].includes(answer)) return null;
  return {
    id,
    speaker,
    options,
    answer,
    context: String(raw?.context || "").trim(),
    pragmatic_function: String(raw?.pragmatic_function || "").trim(),
    explanation: String(raw?.explanation || "").trim(),
    difficulty: String(raw?.difficulty || "medium"),
    audio_url: audioUrl(raw),
    ...listeningProvenance(raw),
  };
}

/** LC：双人对话 + 若干选择题。ListeningMCQTask 用 conversation 拼 TTS 兜底文本。 */
function mapRealLC(raw) {
  const id = readingId(raw?.id);
  const conversation = (Array.isArray(raw?.conversation) ? raw.conversation : [])
    .map((t) => ({ speaker: String(t?.speaker || "").trim(), text: String(t?.text || "").trim() }))
    .filter((t) => t.speaker && t.text);
  const questions = mapListeningQuestions(raw?.questions);
  if (!id || conversation.length === 0 || !questions) return null;
  return {
    id,
    context: String(raw?.context || "").trim(),
    situation: String(raw?.situation || "").trim(),
    speakers: (Array.isArray(raw?.speakers) ? raw.speakers : []).map((s) => ({
      name: String(s?.name || "").trim(),
      role: String(s?.role || "").trim(),
      gender: String(s?.gender || "").trim(),
    })),
    conversation,
    questions,
    difficulty: String(raw?.difficulty || "medium"),
    audio_url: audioUrl(raw),
    ...listeningProvenance(raw),
  };
}

/** LA：校园通知（announcement 同时是 TTS 兜底文本）。 */
function mapRealLA(raw) {
  const id = readingId(raw?.id);
  const announcement = String(raw?.announcement || "").trim();
  const questions = mapListeningQuestions(raw?.questions);
  if (!id || !announcement || !questions) return null;
  return {
    id,
    context: String(raw?.context || "").trim(),
    situation: String(raw?.situation || "").trim(),
    speaker_role: String(raw?.speaker_role || "").trim(),
    announcement,
    questions,
    difficulty: String(raw?.difficulty || "medium"),
    audio_url: audioUrl(raw),
    ...listeningProvenance(raw),
  };
}

/** LAT：学术讲座（transcript 同时是 TTS 兜底文本）。 */
function mapRealLAT(raw) {
  const id = readingId(raw?.id);
  const transcript = String(raw?.transcript || "").trim();
  const questions = mapListeningQuestions(raw?.questions);
  if (!id || !transcript || !questions) return null;
  return {
    id,
    subject: String(raw?.subject || "").trim(),
    topic: String(raw?.topic || "").trim(),
    transcript,
    questions,
    difficulty: String(raw?.difficulty || "medium"),
    audio_url: audioUrl(raw),
    ...listeningProvenance(raw),
  };
}

export function getRealLCRItems() {
  return bankItems(RB_LISTENING_LCR).map(mapRealLCR).filter(Boolean);
}
export function getRealLCItems() {
  return bankItems(RB_LISTENING_LC).map(mapRealLC).filter(Boolean);
}
export function getRealLAItems() {
  return bankItems(RB_LISTENING_LA).map(mapRealLA).filter(Boolean);
}
export function getRealLATItems() {
  return bankItems(RB_LISTENING_LAT).map(mapRealLAT).filter(Boolean);
}

/* ── 口语真题（Repeat / Interview） ──────────────────────────────── */
//
// 口语库的一条 item = 一「套」（repeat 一套 N 句、interview 一套 N 问），与 live 库同构；
// RepeatTask 吃 sentences[]、InterviewTask 吃 questions[]，逐条自带 audio_url。

/** Repeat：逐句 {id, sentence, audio_url}；句子文本是 STT 打分的参照，缺了整套作废。 */
function mapRealRepeatSet(raw) {
  const id = readingId(raw?.id);
  const sentences = (Array.isArray(raw?.sentences) ? raw.sentences : [])
    .map((s, i) => ({
      id: readingId(s?.id) || `${id}_s${i + 1}`,
      sentence: String(s?.sentence || "").trim(),
      difficulty: String(s?.difficulty || "medium"),
      word_count:
        Number(s?.word_count) ||
        String(s?.sentence || "").trim().split(/\s+/).filter(Boolean).length,
      timing_seconds: Number(s?.timing_seconds) || 8,
      audio_url: audioUrl(s),
    }))
    .filter((s) => s.sentence);
  if (!id || sentences.length === 0) return null;
  return {
    id,
    scenario: String(raw?.scenario || "").trim(),
    speaker_role: String(raw?.speaker_role || "").trim(),
    topic: String(raw?.topic || "").trim(),
    sentences,
    ...listeningProvenance(raw),
  };
}

/** Interview：逐题 {id, question, audio_url}；参考答案原样带上（结果页展示）。 */
function mapRealInterviewSet(raw) {
  const id = readingId(raw?.id);
  const questions = (Array.isArray(raw?.questions) ? raw.questions : [])
    .map((q, i) => ({
      id: readingId(q?.id) || `${id}_q${i + 1}`,
      position: String(q?.position || `Q${i + 1}`),
      question: String(q?.question || "").trim(),
      difficulty: String(q?.difficulty || "medium"),
      word_count: Number(q?.word_count) || 0,
      ...(String(q?.reference_answer || "").trim() && {
        reference_answer: String(q.reference_answer).trim(),
      }),
      audio_url: audioUrl(q),
    }))
    .filter((q) => q.question);
  if (!id || questions.length === 0) return null;
  return {
    id,
    topic: String(raw?.topic || "").trim(),
    intro: String(raw?.intro || "").trim(),
    questions,
    ...listeningProvenance(raw),
  };
}

export function getRealRepeatSets() {
  return bankItems(RB_SPEAKING_REPEAT).map(mapRealRepeatSet).filter(Boolean);
}
export function getRealInterviewSets() {
  return bankItems(RB_SPEAKING_INTERVIEW).map(mapRealInterviewSet).filter(Boolean);
}

/* ── 听力 / 口语的 picker 映射 ──────────────────────────────────── */
//
// 与阅读同理：真题的 context / subject 是机经里抽出来的自由文本，查 app 那几张固定枚举表
// 只会渲染出生词 —— 唯一稳定且对用户有意义的分类还是「考试日期」（readingTag）。

export function mapRealLCRToPicker(items) {
  return (Array.isArray(items) ? items : []).map((it, i) => ({ ...compactCard(it, i), tag: readingTag(it) }));
}

export function mapRealLCToPicker(items) {
  return (Array.isArray(items) ? items : []).map((it, i) => ({ ...compactCard(it, i), tag: readingTag(it) }));
}

export function mapRealLAToPicker(items) {
  return (Array.isArray(items) ? items : []).map((it, i) => ({ ...compactCard(it, i), tag: readingTag(it) }));
}

export function mapRealLATToPicker(items) {
  return (Array.isArray(items) ? items : []).map((it, i) => ({ ...compactCard(it, i), tag: readingTag(it) }));
}

export function mapRealRepeatToPicker(sets) {
  return (Array.isArray(sets) ? sets : []).map((s, i) => ({ ...compactCard(s, i), tag: readingTag(s) }));
}

export function mapRealInterviewToPicker(sets) {
  return (Array.isArray(sets) ? sets : []).map((s, i) => ({ ...compactCard(s, i), tag: readingTag(s) }));
}

/* ── 题量（首页卡片用；首页不许 import 本模块，直接读同一份 counts.json） ── */

export const REAL_LISTENING_COUNTS = { ...RB_LISTENING_COUNTS };
export const REAL_SPEAKING_COUNTS = { ...RB_SPEAKING_COUNTS };

/**
 * 源料缺陷 → 给用户看的一句人话补充说明。
 * 目前只有 vendor_reformatted 一种（商家把原卷重排版、答案页是 AI 补写的），
 * 这批题的答案后来过了「双票复核」才落库，所以补一句让用户知道答案可信度的来源。
 */
export function realSourceFlagNote(item) {
  const flags = Array.isArray(item?.source_flags) ? item.source_flags : [];
  return flags.some((f) => f?.code === "vendor_reformatted")
    ? "回忆重排版，答案经双票复核"
    : "";
}
