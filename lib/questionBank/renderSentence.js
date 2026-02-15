const { renderResponseSentence } = require("./renderResponseSentence");

function renderSentence(input, filledChunks) {
  if (Array.isArray(input)) {
    return "";
  }
  const { userSentenceFull } = renderResponseSentence(input, filledChunks);
  return userSentenceFull;
}

module.exports = {
  renderSentence,
};
