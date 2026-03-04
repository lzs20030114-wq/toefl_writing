/**
 * One-time fix: correct prompts that are logically inconsistent with their answers.
 * Run: node scripts/fix-bad-prompts.js
 */
const fs = require("fs");
const path = require("path");

const QUESTIONS_PATH = path.resolve(__dirname, "../data/buildSentence/questions.json");

// Map: normalized answer → corrected prompt
// Key = answer.toLowerCase().trim()
const PROMPT_FIXES = {
  "julian wanted to know why i left early.":
    "What did Julian ask you?",
  "mariana wanted to know where i went last weekend.":
    "What did Mariana want to know?",
  "emma wanted to know where i went last weekend.":
    "What did Emma want to know?",
  "alison wanted to know if i enjoyed the concert.":
    "What did Alison want to know?",
  "she wanted to know if i enjoyed the concert.":
    "What did Emma want to know?",
  // Subject reversal: "Where did Mariana go?" → answer is about where I went
  "she was curious about where i went last weekend.":
    "What was Mariana curious about?",
  // "she" is ambiguous / prompt doesn't match
  "she was wondering if i had chosen a hotel yet.":
    "What was your friend wondering about your trip?",
};

const data = JSON.parse(fs.readFileSync(QUESTIONS_PATH, "utf8"));
let fixed = 0;

for (const set of data.question_sets || []) {
  for (const q of set.questions || []) {
    const key = String(q.answer || "").toLowerCase().trim();
    if (PROMPT_FIXES[key]) {
      console.log(`Fixing [${q.id}]:`);
      console.log(`  old prompt: ${q.prompt}`);
      console.log(`  new prompt: ${PROMPT_FIXES[key]}`);
      console.log(`  answer:     ${q.answer}`);
      q.prompt = PROMPT_FIXES[key];
      fixed++;
    }
  }
}

fs.writeFileSync(QUESTIONS_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`\nFixed ${fixed} questions.`);
