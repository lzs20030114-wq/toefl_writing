const fs = require("fs");
const path = require("path");
const {
  DIFFICULTIES,
  validateBuildSentenceBank,
} = require("../lib/questionBank/buildSentenceSchema");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(
  ROOT,
  "data",
  "questionBank",
  "v1",
  "build_sentence"
);

function parseArgs(argv) {
  const out = { input: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input" || argv[i] === "-i") {
      out.input = argv[i + 1] || null;
      i += 1;
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

function main() {
  const { input } = parseArgs(process.argv.slice(2));
  const items = readInput(input);
  const result = validateBuildSentenceBank(items);
  if (!result.ok) {
    console.error("Input question bank is invalid:");
    result.errors.forEach((e) => console.error(`- ${e}`));
    process.exit(1);
  }
  writeBuckets(items);
  console.log("Saved build_sentence question bank:");
  console.log(path.join("data", "questionBank", "v1", "build_sentence", "easy.json"));
  console.log(path.join("data", "questionBank", "v1", "build_sentence", "medium.json"));
  console.log(path.join("data", "questionBank", "v1", "build_sentence", "hard.json"));
}

main();

