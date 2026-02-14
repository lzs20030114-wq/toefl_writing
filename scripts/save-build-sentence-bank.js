const fs = require("fs");
const path = require("path");
const {
  DIFFICULTIES,
  validateBuildSentenceBank,
} = require("../lib/questionBank/buildSentenceSchema");
const { renderSentence } = require("../lib/questionBank/renderSentence");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(
  ROOT,
  "data",
  "questionBank",
  "v1",
  "build_sentence"
);

function parseArgs(argv) {
  const out = { input: null, rejectOnWarning: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input" || argv[i] === "-i") {
      out.input = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (argv[i] === "--reject_on_warning" || argv[i] === "--reject-on-warning") {
      out.rejectOnWarning = true;
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

function wordCount(text) {
  if (typeof text !== "string") return 0;
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function collectDifficultyViolations(items) {
  const violations = [];

  items.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const id = item.id || `item[${index}]`;
    const difficulty = item.difficulty;
    const bankLen = Array.isArray(item.bank) ? item.bank.length : 0;
    const tokenList = Array.isArray(item.promptTokens) ? item.promptTokens : [];
    const givenTokens = tokenList.filter((t) => (t?.type || t?.t) === "given");
    const givenValue = givenTokens[0] ? String(givenTokens[0].value || givenTokens[0].v || "") : "";
    const givenWords = wordCount(givenValue);
    const reasons = [];

    if (difficulty === "easy" && bankLen !== 4) {
      reasons.push(`easy bank length must be 4 (got ${bankLen})`);
    }
    if (difficulty === "medium" && (bankLen < 5 || bankLen > 6)) {
      reasons.push(`medium bank length must be 5-6 (got ${bankLen})`);
    }
    if (difficulty === "hard" && (bankLen < 6 || bankLen > 7)) {
      reasons.push(`hard bank length must be 6-7 (got ${bankLen})`);
    }
    if (givenWords < 1 || givenWords > 2) {
      reasons.push(`given chunk must be 1-2 words (got ${givenWords})`);
    }

    if (reasons.length > 0) {
      violations.push({ id, reasons });
    }
  });

  return violations;
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
  const { input, rejectOnWarning } = parseArgs(process.argv.slice(2));
  const items = readInput(input);
  const result = validateBuildSentenceBank(items);
  if (!result.ok) {
    console.error("Input question bank is invalid:");
    result.errors.forEach((e) => console.error(`- ${e}`));
    process.exit(1);
  }

  const violations = collectDifficultyViolations(items);
  if (violations.length > 0) {
    console.error("Input question bank violates difficulty strategy:");
    violations.forEach((v) => console.error(`- ${v.id}: ${v.reasons.join("; ")}`));
    console.error(`ids: ${violations.map((v) => v.id).join(", ")}`);
    process.exit(1);
  }

  const warnings = collectWarnings(items);
  if (warnings.length > 0) {
    console.warn("Input question bank warnings:");
    warnings.forEach((w) => console.warn(`- ${w.id}: ${w.issues.join("; ")}`));
    console.warn(`ids: ${warnings.map((w) => w.id).join(", ")}`);

    if (rejectOnWarning) {
      console.error("reject_on_warning is enabled; aborting save.");
      process.exit(1);
    }
  }

  writeBuckets(items);
  console.log("Saved build_sentence question bank:");
  console.log(path.join("data", "questionBank", "v1", "build_sentence", "easy.json"));
  console.log(path.join("data", "questionBank", "v1", "build_sentence", "medium.json"));
  console.log(path.join("data", "questionBank", "v1", "build_sentence", "hard.json"));
}

main();
