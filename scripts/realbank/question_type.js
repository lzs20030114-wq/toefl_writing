/**
 * 真题学术阅读（AP）题型推断（纯函数，无 IO —— 供 build_bank.mjs、consolidate_reading.js
 * 与单测共用）。
 *
 * 背景：真题的结构化产物（`.codex-tmp/realbank/<卷>.structured.json`）**从不带 question_type**
 * —— 解析器只抽题干/选项/答案键，题型不是源料里写着的东西。build_bank 于是一律落成
 * `question_type: "detail"`，前端 RDLTask 把这个字段原样印在题号行上（"(detail)"），
 * 385 道 AP 题全是同一个词 = 这个标签对用户零信息量。
 *
 * 这里按题干句式推回题型。判据只用**题干本身**（不看选项、不看正文），因为 TOEFL 的题型
 * 就是靠固定句式表达的：
 *   "…is closest in meaning to"            → 词汇题
 *   "The word 'it' refers to"              → 指代题
 *   "There are four locations…"            → 插入句题
 *   "All of the following… EXCEPT"         → 否定细节题
 * 认不出来的一律回落 factual_detail（细节题是 AP 的众数题型，猜错的代价最小）。
 *
 * 输出集合 = lib/readingGen/apValidator.js 的 VALID_QUESTION_TYPES（AI 生成题用的那套，
 * 前端标签映射也照它做），外加真题特有的 "sentence_selection"：
 * 「Identify the sentence in paragraph 3 that…」这类选句题在 AI 生成的题库里没有对应题型，
 * 但真题里确实存在（被拍成 A–D 四选项收进来的），不给它单独的名字就只能糊成细节题。
 *
 * 顺序敏感：规则自上而下**首个命中即返回**。改顺序前先看 __tests__/realbank-question-type.test.js
 * 里逐条锁住的样例 —— 例如 "What can be inferred about … cities mentioned in the passage?"
 * 必须落 inference 而不是 negative_factual（"mentioned" 前面没有 NOT）。
 */

/** AP 题型全集（apValidator 的 9 种 + 真题特有的选句题）。 */
const AP_QUESTION_TYPES = [
  "main_idea",
  "factual_detail",
  "negative_factual",
  "vocabulary_in_context",
  "inference",
  "rhetorical_purpose",
  "paragraph_relationship",
  "insert_text",
  "reference",
  // 真题特有：apValidator 的集合里没有，前端标签表要单独给它一个名字（选句）。
  "sentence_selection",
];

/**
 * 「in order to」要算修辞目的题，题干里得有作者/修辞的语境词。
 * 光看 "in order to" 会把细节题误标：「According to the passage, farmers rotate crops in order to」
 * 问的是事实（轮作是为了什么），不是「作者为什么这么写」。
 */
const RHETORICAL_CONTEXT = /(author|mention|example|paragraph|include|cite|refer)/i;

/**
 * 规则表。每条 [正则或谓词, 题型]，自上而下首个命中即返回。
 * 全部 case-insensitive；写在这里的先后顺序就是优先级，不要随手调换：
 *  · 词汇/指代/插入三条最靠前 —— 它们的句式是唯一的，不会被别的规则误吃；
 *  · negative_factual 必须排在 inference 前面（"NOT true" 类题干常带 "suggest"）；
 *  · inference 排在 rhetorical_purpose 前面（"What does the author suggest by mentioning…"
 *    在 ETS 口径里算推断题）；
 *  · sentence_selection 紧跟插入题 —— 选句是作答形式，题干后半截带 suggest/NOT 也仍是选句题
 *    （它的句式 identify/select/which sentence in paragraph 与段落关系题互不相交）；
 *  · 「purpose of paragraph N / the first paragraph」排在 main_idea 前面（否则 main purpose 被主旨题吃掉）。
 */
const RULES = [
  [/closest\s+in\s+meaning/i, "vocabulary_in_context"],
  [/\brefers?\s+to\b/i, "reference"],
  [/four\s+locations|four\s+squares|where\s+would\s+the\s+sentence\s+best\s+fit/i, "insert_text"],
  // 选句题是**作答形式**（在正文里点一句），不管题干后半截问的是推断还是细节，界面都得按选句渲染，
  // 所以排在推断/否定细节前面：「Identify the sentence in paragraph 3 that suggests …」不许被推断题吃掉。
  // 「Which sentence in paragraph 3 describes …」同属此类（第二来源把它拍成了 A–D，题型仍是选句）。
  [/identify\s+the\s+sentence|select\s+the\s+sentence|which\s+sentence\s+in\s+(?:the\s+\w+\s+)?paragraph/i, "sentence_selection"],
  [/\bEXCEPT\b|\bNOT\s+(mentioned|true|stated|discussed)\b/i, "negative_factual"],
  [/\binfer|\bimpl(?:y|ies|ied)\b|\bsuggests?\b|\bsuggested\b/i, "inference"],
  [/why\s+does\s+the\s+author|what\s+is\s+the\s+purpose\s+of\s+(mentioning|the\s+example)/i, "rhetorical_purpose"],
  // 问「某一段的作用」是修辞目的题，不是主旨题：「What is the purpose of the first paragraph?」
  // 「What is the main purpose of paragraph 3?」—— 必须排在 main_idea 前面（后者会吃掉 main purpose）。
  [/purpose\s+of\s+(?:the\s+(?:first|second|third|fourth|fifth|sixth|last|final|opening|concluding)\s+paragraph|paragraph\s*\d+)/i, "rhetorical_purpose"],
  [(s) => /in\s+order\s+to/i.test(s) && RHETORICAL_CONTEXT.test(s), "rhetorical_purpose"],
  // 问**整篇**的目的是主旨题：「What is the purpose of the passage?」「The primary purpose of the passage is to」。
  // 与上面「某一段的目的 → 修辞目的」分开：passage 级 → main_idea，paragraph 级 → rhetorical_purpose（段落规则排在前面先挑走）。
  [/main\s+(idea|topic|purpose)|\bprimary\s+purpose\b|purpose\s+of\s+(?:the|this)\s+(?:passage|article|text)\b|\bprimarily\b|mainly\s+(about|discuss)|best\s+describes\s+the\s+passage|\btitle\b/i, "main_idea"],
  [/relationship\s+between\s+paragraph|how\s+does\s+paragraph\s+\d+\s+relate|paragraphs\s+\d+\s+and\s+\d+/i, "paragraph_relationship"],
];

/**
 * 按题干推断 AP 题型。
 * @param {string} stem 题干原文
 * @returns {string} AP_QUESTION_TYPES 之一；认不出来回落 "factual_detail"
 */
function inferApQuestionType(stem) {
  const s = String(stem || "");
  if (!s.trim()) return "factual_detail";
  for (const [test, type] of RULES) {
    if (typeof test === "function" ? test(s) : test.test(s)) return type;
  }
  return "factual_detail";
}

/**
 * 落库口径：源料给的题型缺失或是占位值 "detail" 时才推断，否则原样沿用。
 * （结构化产物目前从不带 question_type，所以实际等价于「一律推断」；但将来解析器若开始
 *   抽题型，人写的值优先于我们猜的。）
 */
function apQuestionType(rawType, stem) {
  const raw = String(rawType || "").trim();
  if (raw && raw !== "detail") return raw;
  return inferApQuestionType(stem);
}

module.exports = { AP_QUESTION_TYPES, inferApQuestionType, apQuestionType };
