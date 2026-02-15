const { validateQuestion, validateQuestionSet } = require("./buildSentenceSchema");

/**
 * Hard fail reasons for a single question (fatal errors only).
 */
function hardFailReasons(question) {
  const result = validateQuestion(question);
  return result.fatal;
}

/**
 * Warnings for a single question (format + content issues).
 */
function warnings(question) {
  const result = validateQuestion(question);
  return [...result.format, ...result.content];
}

module.exports = {
  hardFailReasons,
  warnings,
  validateQuestionSet,
};
