const fs = require("fs");
const path = require("path");
const { validateBuildSentenceBank } = require("../lib/questionBank/buildSentenceSchema");

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

function main() {
  const failures = [];
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
    } catch (e) {
      failures.push(`${name}: invalid JSON (${e.message})`);
    }
  });

  if (failures.length > 0) {
    console.error("Question bank validation failed:");
    failures.forEach((f) => console.error(f));
    process.exit(1);
  }

  console.log("Question bank validation passed.");
}

main();

