const fs = require("fs");
const path = require("path");
const { validateBuildSentenceBank } = require("../lib/questionBank/buildSentenceSchema");
const { renderSentence } = require("../lib/questionBank/renderSentence");

const ROOT = path.resolve(__dirname, "..");
const BANK_DIR = path.join(
  ROOT,
  "data",
  "questionBank",
  "v1",
  "build_sentence"
);
const TARGET_FILES = ["easy.json", "medium.json", "hard.json"];

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function collectWarnings(items) {
  const warnings = [];

  items.forEach((item, index) => {
    if (!item || typeof item !== "object") return;

    const id = item.id || `item[${index}]`;
    const issues = [];
    const tokens = Array.isArray(item.promptTokens) ? item.promptTokens : [];
    const givenIndex = tokens.findIndex((t) => (t?.type || t?.t) === "given");

    if (givenIndex === 0 || givenIndex === tokens.length - 1) {
      issues.push("given chunk is at sentence boundary (start/end)");
    }

    const sentence = renderSentence(tokens, item.answerOrder || []);
    if (/\s+[,.!?;:]/.test(sentence)) {
      issues.push("space before punctuation");
    }
    if (/\s{2,}/.test(sentence)) {
      issues.push("double spaces");
    }

    if (issues.length > 0) warnings.push({ id, issues });
  });

  return warnings;
}

function main() {
  const failures = [];
  const warningByFile = [];

  TARGET_FILES.forEach((name) => {
    const filePath = path.join(BANK_DIR, name);
    if (!fs.existsSync(filePath)) {
      failures.push(`${name}: file not found`);
      return;
    }
    try {
      const data = readJson(filePath);
      const result = validateBuildSentenceBank(data);
      if (!result.ok) {
        failures.push(`${name}:`);
        result.errors.forEach((e) => failures.push(`  - ${e}`));
      }

      const warnings = collectWarnings(data);
      if (warnings.length > 0) {
        warningByFile.push({ file: name, warnings });
      }
    } catch (e) {
      failures.push(`${name}: invalid JSON (${e.message})`);
    }
  });

  if (failures.length > 0) {
    console.error("Question bank validation failed:");
    failures.forEach((f) => console.error(f));
    process.exit(1);
  }

  if (warningByFile.length > 0) {
    console.warn("Question bank warnings (non-blocking):");
    warningByFile.forEach(({ file, warnings }) => {
      console.warn(`${file}: ${warnings.length} warning item(s)`);
      warnings.forEach((w) => {
        console.warn(`  - ${w.id}: ${w.issues.join("; ")}`);
      });
      console.warn(`  ids: ${warnings.map((w) => w.id).join(", ")}`);
    });
  }

  console.log("Question bank validation passed.");
}

main();
