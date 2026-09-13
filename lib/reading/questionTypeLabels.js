/**
 * 阅读题型的中文标签。
 *
 * 题库里的 question_type 是英文枚举（lib/readingGen/apValidator.js 的 VALID_QUESTION_TYPES，
 * 外加真题特有的 sentence_selection，见 scripts/realbank/question_type.js）。
 * 做题页此前把这个枚举**原样**印在题号行上（"第 2 题 / 共 5 题 (factual_detail)"）——
 * 对备考的用户来说这既不是中文也不是 ETS 的官方叫法，等于一串噪声。
 *
 * 单独成模块（而不是写死在 RDLTask 里）：错题本 / 历史复盘 / 真题练习记录将来要显示题型时
 * 得是同一套叫法，两处各写一份必然会漂。
 *
 * 认不出来的类型**原样返回**，不吞掉：题库里冒出新枚举时屏幕上会直接看见那个英文词，
 * 比静默显示空白容易发现。
 */
const LABELS = {
  factual_detail: "细节",
  detail: "细节",              // 落库前的占位值（结构化产物不带题型时 build_bank 写的就是它）
  negative_factual: "否定细节",
  vocabulary_in_context: "词汇",
  inference: "推断",
  rhetorical_purpose: "修辞目的",
  main_idea: "主旨",
  paragraph_relationship: "段落关系",
  insert_text: "插入句",
  reference: "指代",
  sentence_selection: "选句",
};

/**
 * @param {string} type question_type 枚举值
 * @returns {string} 中文标签；认不出来回落原字符串；空值回落空串（调用方据此决定要不要渲染）
 */
export function questionTypeLabel(type) {
  const key = String(type || "").trim();
  if (!key) return "";
  return LABELS[key] || key;
}

export const QUESTION_TYPE_LABELS = LABELS;
