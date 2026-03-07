const { readFileSync } = require("fs");
const { resolve } = require("path");
const {
  getStructuredPromptParts,
  validateStructuredPromptParts,
  classifyPromptSurface,
  hasExplicitTaskInLegacyPrompt,
} = require("../lib/questionBank/buildSentencePromptContract");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function collectItems() {
  const questionsPath = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
  const reservePath = resolve(__dirname, "..", "data", "buildSentence", "reserve_pool.json");
  const questions = readJson(questionsPath);
  const reserve = readJson(reservePath);

  const items = [];
  for (const set of questions.question_sets || []) {
    for (const q of set.questions || []) {
      items.push({ source: "questions.json", set_id: set.set_id, ...q });
    }
  }
  for (const q of reserve || []) {
    items.push({ source: "reserve_pool.json", set_id: null, ...q });
  }
  return items;
}

const items = collectItems();
const report = items.map((q) => {
  const parts = getStructuredPromptParts(q);
  const structured = validateStructuredPromptParts(q, { requireStructured: false });
  const legacyHasTask = hasExplicitTaskInLegacyPrompt(q.prompt);
  return {
    source: q.source,
    set_id: q.set_id,
    id: q.id,
    prompt: q.prompt,
    answer: q.answer,
    surface: classifyPromptSurface(q.prompt),
    hasStructured: parts.hasStructured,
    structuredFatal: structured.fatal,
    legacyHasExplicitTask: legacyHasTask,
  };
});

const badLegacy = report.filter((x) => !x.hasStructured && !x.legacyHasExplicitTask);
const badStructured = report.filter((x) => x.hasStructured && x.structuredFatal.length > 0);

console.log(`total: ${report.length}`);
console.log(`legacy-without-explicit-task: ${badLegacy.length}`);
console.log(`structured-invalid: ${badStructured.length}`);

if (badLegacy.length > 0) {
  console.log("\nLegacy prompt issues:");
  badLegacy.slice(0, 50).forEach((x) => {
    console.log(`- ${x.source}${x.set_id ? ` set ${x.set_id}` : ""} ${x.id}`);
    console.log(`  prompt: ${x.prompt}`);
    console.log(`  answer: ${x.answer}`);
  });
}

if (badStructured.length > 0) {
  console.log("\nStructured prompt issues:");
  badStructured.slice(0, 50).forEach((x) => {
    console.log(`- ${x.source}${x.set_id ? ` set ${x.set_id}` : ""} ${x.id}`);
    console.log(`  prompt: ${x.prompt}`);
    console.log(`  errors: ${x.structuredFatal.join("; ")}`);
  });
}
