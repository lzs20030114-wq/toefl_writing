const fs = require("fs");
const path = require("path");
const { validateQuestionSet } = require("../lib/questionBank/buildSentenceSchema");
const {
  hardFailReasons,
  warnings: qualityWarnings,
} = require("../lib/questionBank/qualityGateBuildSentence");

const ROOT = path.resolve(__dirname, "..");
const QUESTIONS_FILE = path.join(ROOT, "data", "buildSentence", "questions.json");

function readQuestionsFile() {
  const raw = fs.readFileSync(QUESTIONS_FILE, "utf8");
  return JSON.parse(raw);
}

function parseArgs(argv) {
  return {
    strict: argv.includes("--strict"),
  };
}

function validateAllSets(data, { strict = false } = {}) {
  const failures = [];
  const strictHardFails = [];
  const strictWarnings = [];
  const sets = Array.isArray(data?.question_sets) ? data.question_sets : [];

  if (sets.length === 0) {
    failures.push("question_sets is empty or missing");
    return { ok: false, failures, strictHardFails, strictWarnings };
  }

  sets.forEach((set, setIndex) => {
    const setId = set?.set_id ?? `index-${setIndex}`;
    const res = validateQuestionSet(set);
    if (!res.ok) {
      failures.push(`set ${setId}:`);
      res.errors.forEach((e) => failures.push(`  - ${e}`));
    }

    if (!strict) return;
    const questions = Array.isArray(set?.questions) ? set.questions : [];
    questions.forEach((q, qIndex) => {
      const qLabel = `set ${setId} q[${qIndex}] ${q?.id || "(no-id)"}`;
      const hf = hardFailReasons(q || {});
      if (hf.length > 0) strictHardFails.push({ label: qLabel, reasons: hf });
      const ws = qualityWarnings(q || {});
      if (ws.length > 0) strictWarnings.push({ label: qLabel, reasons: ws });
    });
  });

  const ok = failures.length === 0 && (!strict || (strictHardFails.length === 0 && strictWarnings.length === 0));
  return { ok, failures, strictHardFails, strictWarnings };
}

function main() {
  const { strict } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(QUESTIONS_FILE)) {
    console.error(`Question file not found: ${QUESTIONS_FILE}`);
    process.exit(1);
  }

  let data;
  try {
    data = readQuestionsFile();
  } catch (e) {
    console.error(`Invalid JSON: ${QUESTIONS_FILE}`);
    console.error(e.message);
    process.exit(1);
  }

  const result = validateAllSets(data, { strict });
  if (result.failures.length > 0) {
    console.error("Question bank validation failed:");
    result.failures.forEach((line) => console.error(line));
  }

  if (strict && result.strictHardFails.length > 0) {
    console.error("Strict mode hard-fail list:");
    result.strictHardFails.forEach((entry) => {
      console.error(`- ${entry.label}: ${entry.reasons.join("; ")}`);
    });
  }

  if (strict && result.strictWarnings.length > 0) {
    console.error("Strict mode warning list:");
    result.strictWarnings.forEach((entry) => {
      console.error(`- ${entry.label}: ${entry.reasons.join("; ")}`);
    });
  }

  if (!result.ok) {
    process.exit(1);
  }

  console.log("Question bank validation passed.");
}

if (require.main === module) {
  main();
}

module.exports = {
  validateAllSets,
};
