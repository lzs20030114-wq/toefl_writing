/**
 * CTW 判分（唯一真源）—— 判「用户补全某个空是否正确」。
 *
 * 原来判分散在 CTWTask.js / AdaptiveExamShell.js / ReadingProgressView 各自
 * 内联 `userFull === original_word`，严格只认原词。L3 决策块 C 之后，空可带
 * `accepted_words`（唯一解校验器复核出的等价合法词，如单复数变体、语境等价词），
 * 用户填其中任一都算对。此模块统一口径，避免三处漂移。
 *
 * 判分保持保守：只接受 original_word + 显式登记的 accepted_words；不做任何
 * 模糊/词干匹配，杜绝「把错答案判对」。accepted_words 由跑批复核产出，不是运行时猜。
 */

export function normalizeWord(w) {
  return String(w == null ? "" : w).toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * @param {object} blank —— { original_word, displayed_fragment, accepted_words? }
 * @param {string} userSuffix —— 用户在碎片后补的字母
 * @returns {boolean}
 */
export function isBlankCorrect(blank, userSuffix) {
  const fragment = blank.displayed_fragment || "";
  const userFull = normalizeWord(fragment + (userSuffix || ""));
  if (!userFull) return false;
  const accepted = new Set([blank.original_word, ...(blank.accepted_words || [])].map(normalizeWord));
  return accepted.has(userFull);
}
