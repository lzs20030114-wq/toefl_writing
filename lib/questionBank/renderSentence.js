const { renderResponseSentence } = require("./renderResponseSentence");

function renderSentence(input, filledWords) {
  if (Array.isArray(input)) {
    return "";
  }
  const { userSentenceFull } = renderResponseSentence(input, filledWords);
  return userSentenceFull;
}

module.exports = {
  renderSentence,
};
