const fs = require("fs");
const path = require("path");
const { validateBuildSentenceBank } = require("../lib/questionBank/buildSentenceSchema");
const {
  hardFailReasons,
  warnings: qualityWarnings,
} = require("../lib/questionBank/qualityGateBuildSentence");

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

function parseArgs(argv) {
  return {
    strict: argv.includes("--strict"),
  };
}

function collectHardFails(items) {
  const out = [];
  items.forEach((item, index) => {
    const id = item?.id || `item[${index}]`;
    const reasons = hardFailReasons(item || {});
    if (reasons.length > 0) out.push({ id, reasons });
  });
  return out;
}

function collectWarnings(items) {
  const out = [];
  items.forEach((item, index) => {
    const id = item?.id || `item[${index}]`;
    const reasons = qualityWarnings(item || {});
    if (reasons.length > 0) out.push({ id, reasons });
  });
  return out;
}

function main() {
  const { strict } = parseArgs(process.argv.slice(2));
  const failures = [];
  const warningByFile = [];
  const hardFailByFile = [];
  let strictFailed = false;

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

      if (strict) {
        const hardFails = collectHardFails(data);
        const warnings = collectWarnings(data);
        if (hardFails.length > 0) {
          strictFailed = true;
          hardFailByFile.push({ file: name, entries: hardFails });
        }
        if (warnings.length > 0) {
          strictFailed = true;
          warningByFile.push({ file: name, entries: warnings });
        }
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

  if (strict && hardFailByFile.length > 0) {
    console.error("Strict mode hard-fail list:");
    hardFailByFile.forEach(({ file, entries }) => {
      console.error(`${file}: ${entries.length} rejected item(s)`);
      entries.forEach((w) => {
        console.error(`  - ${w.id}: ${w.reasons.join("; ")}`);
      });
      console.error(`  ids: ${entries.map((w) => w.id).join(", ")}`);
    });
  }

  if (strict && warningByFile.length > 0) {
    console.error("Strict mode warning list:");
    warningByFile.forEach(({ file, entries }) => {
      console.error(`${file}: ${entries.length} warning item(s)`);
      entries.forEach((w) => {
        console.error(`  - ${w.id}: ${w.reasons.join("; ")}`);
      });
      console.error(`  ids: ${entries.map((w) => w.id).join(", ")}`);
    });
  }

  if (strict && strictFailed) {
    process.exit(1);
  }

  console.log("Question bank validation passed.");
}

main();
