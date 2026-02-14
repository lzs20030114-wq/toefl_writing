const fs = require("fs");
const path = require("path");
const {
  DIFFICULTIES,
  validateBuildSentenceBank,
} = require("../lib/questionBank/buildSentenceSchema");
const {
  hardFailReasons,
  warnings: qualityWarnings,
} = require("../lib/questionBank/qualityGateBuildSentence");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(
  ROOT,
  "data",
  "questionBank",
  "v1",
  "build_sentence"
);

function parseArgs(argv) {
  const out = { input: null, allowWarnings: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input" || argv[i] === "-i") {
      out.input = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (argv[i] === "--allow-warnings") {
      out.allowWarnings = true;
    }
  }
  return out;
}

function readInput(inputPath) {
  if (!inputPath) {
    throw new Error("Missing --input <json-file>");
  }
  const abs = path.isAbsolute(inputPath) ? inputPath : path.join(ROOT, inputPath);
  const raw = fs.readFileSync(abs, "utf8");
  return JSON.parse(raw);
}

function writeBuckets(items) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const buckets = { easy: [], medium: [], hard: [] };
  items.forEach((item) => {
    if (DIFFICULTIES.has(item.difficulty)) buckets[item.difficulty].push(item);
  });
  Object.keys(buckets).forEach((difficulty) => {
    const outFile = path.join(OUT_DIR, `${difficulty}.json`);
    fs.writeFileSync(outFile, `${JSON.stringify(buckets[difficulty], null, 2)}\n`, "utf8");
  });
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

function evaluateForSave(items, { allowWarnings = false } = {}) {
  const schemaResult = validateBuildSentenceBank(items);
  if (!schemaResult.ok) {
    return {
      ok: false,
      kind: "schema",
      errors: schemaResult.errors,
      hardFails: [],
      warnings: [],
    };
  }

  const hardFails = collectHardFails(items);
  if (hardFails.length > 0) {
    return {
      ok: false,
      kind: "hard_fail",
      errors: [],
      hardFails,
      warnings: [],
    };
  }

  const warnings = collectWarnings(items);
  if (warnings.length > 0 && !allowWarnings) {
    return {
      ok: false,
      kind: "warning_blocked",
      errors: [],
      hardFails: [],
      warnings,
    };
  }

  return {
    ok: true,
    kind: "ok",
    errors: [],
    hardFails: [],
    warnings,
  };
}

function main() {
  const { input, allowWarnings } = parseArgs(process.argv.slice(2));
  const items = readInput(input);
  const evalResult = evaluateForSave(items, { allowWarnings });

  if (!evalResult.ok) {
    if (evalResult.kind === "schema") {
      console.error("Input question bank is invalid:");
      evalResult.errors.forEach((e) => console.error(`- ${e}`));
      process.exit(1);
    }
    if (evalResult.kind === "hard_fail") {
      console.error("Input question bank failed quality gate:");
      evalResult.hardFails.forEach((v) => console.error(`- ${v.id}: ${v.reasons.join("; ")}`));
      console.error(`ids: ${evalResult.hardFails.map((v) => v.id).join(", ")}`);
      process.exit(1);
    }
    if (evalResult.kind === "warning_blocked") {
      console.warn("Input question bank warnings:");
      evalResult.warnings.forEach((w) => console.warn(`- ${w.id}: ${w.reasons.join("; ")}`));
      console.warn(`ids: ${evalResult.warnings.map((w) => w.id).join(", ")}`);
      console.error("Warnings are blocked by default. Re-run with --allow-warnings to save anyway.");
      process.exit(1);
    }
  }

  if (evalResult.warnings.length > 0) {
    console.warn("Input question bank warnings:");
    evalResult.warnings.forEach((w) => console.warn(`- ${w.id}: ${w.reasons.join("; ")}`));
    console.warn(`ids: ${evalResult.warnings.map((w) => w.id).join(", ")}`);
  }

  writeBuckets(items);
  console.log("Saved build_sentence question bank:");
  console.log(path.join("data", "questionBank", "v1", "build_sentence", "easy.json"));
  console.log(path.join("data", "questionBank", "v1", "build_sentence", "medium.json"));
  console.log(path.join("data", "questionBank", "v1", "build_sentence", "hard.json"));
}

if (require.main === module) {
  main();
}

module.exports = {
  collectHardFails,
  collectWarnings,
  evaluateForSave,
};
