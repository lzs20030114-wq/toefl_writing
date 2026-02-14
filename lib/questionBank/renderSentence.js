function renderSentence(promptTokens, filledWords) {
  const tokens = Array.isArray(promptTokens) ? promptTokens : [];
  const words = Array.isArray(filledWords) ? filledWords : [];

  const parts = [];
  let blankIndex = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i] || {};
    const type = t.t || t.type;
    const value = (t.v || t.value || "").trim();

    if (type === "blank") {
      const filled = String(words[blankIndex] || "").trim();
      parts.push(filled || "___");
      blankIndex += 1;
      continue;
    }

    if ((type === "text" || type === "given") && value) {
      parts.push(value);
    }
  }

  let out = "";
  for (let i = 0; i < parts.length; i += 1) {
    const cur = parts[i];
    if (!cur) continue;
    if (!out) {
      out = cur;
      continue;
    }

    const noSpaceBefore =
      /^[,.;:!?%)\]}]+$/.test(cur) ||
      /^['’](s|re|ve|d|ll|m|t)\b/i.test(cur) ||
      /^['’][^ ]+$/.test(cur);
    const noSpaceAfterPrev = /[(\[{]$/.test(out);
    out += (noSpaceBefore || noSpaceAfterPrev ? "" : " ") + cur;
  }

  return out
    .replace(/\s+([,.;:!?%)\]}])/g, "$1")
    .replace(/([(\[{])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

module.exports = {
  renderSentence,
};
