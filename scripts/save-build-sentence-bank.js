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
  "v2",
  "build_sentence"
);

const PREP_OR_LINK_START = new Set([
  "to",
  "in",
  "on",
  "at",
  "for",
  "with",
  "from",
  "about",
  "into",
  "over",
  "under",
  "before",
  "after",
  "by",
  "of",
  "as",
  "than",
]);

const ARTICLES = new Set(["a", "an", "the", "this", "that", "these", "those"]);

function parseArgs(argv) {
  const out = { input: null, allowWarnings: false, shuffleRetries: 30 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input" || argv[i] === "-i") {
      out.input = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (argv[i] === "--allow-warnings") {
      out.allowWarnings = true;
      continue;
    }
    if (argv[i] === "--shuffle-retries") {
      out.shuffleRetries = Number(argv[i + 1] || 30) || 30;
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

function normalizeChunk(v) {
  return String(v || "").trim();
}

function words(v) {
  return normalizeChunk(v).toLowerCase().split(/\s+/).filter(Boolean);
}

function isHalfFunctionalStart(chunk) {
  const ws = words(chunk);
  if (ws.length === 0) return false;
  if (!PREP_OR_LINK_START.has(ws[0])) return false;
  if (ws.length === 1) return true;
  return ws.length <= 2 && ARTICLES.has(ws[1]);
}

function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function samePositionCount(a, b) {
  const n = Math.min(a.length, b.length);
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    if (a[i] === b[i]) count += 1;
  }
  return count;
}

function isLeakyOrder(bank, answerOrder) {
  if (bank.join("||") === answerOrder.join("||")) return true;
  return samePositionCount(bank, answerOrder) >= Math.ceil(answerOrder.length / 2);
}

function shuffleBankSafely(answerOrder, retries = 30) {
  for (let i = 0; i < retries; i += 1) {
    const candidate = shuffle(answerOrder);
    if (!isLeakyOrder(candidate, answerOrder)) return candidate;
  }
  return null;
}

function deriveGivenFromCorrectChunks(correctChunks) {
  const chunks = (correctChunks || []).map(normalizeChunk).filter(Boolean);
  const candidateIndexes = [];
  chunks.forEach((chunk, idx) => {
    const nWords = words(chunk).length;
    if (nWords < 1 || nWords > 3) return;
    if (isHalfFunctionalStart(chunk)) return;
    candidateIndexes.push(idx);
  });
  if (candidateIndexes.length === 0) return null;

  const chosen = candidateIndexes[Math.floor(Math.random() * candidateIndexes.length)];
  const given = chunks[chosen];
  const answerOrder = chunks.filter((_, idx) => idx !== chosen);
  return { given, givenIndex: chosen, answerOrder };
}

function normalizeItem(item, { shuffleRetries = 30 } = {}) {
  const out = { ...item };
  if (Array.isArray(item.correctChunks) && item.correctChunks.length > 0) {
    const derived = deriveGivenFromCorrectChunks(item.correctChunks);
    if (!derived) {
      throw new Error(`${item.id || "(unknown id)"}: cannot derive valid given from correctChunks`);
    }
    out.given = derived.given;
    out.givenIndex = derived.givenIndex;
    out.answerOrder = derived.answerOrder;
  }

  if (!Array.isArray(out.answerOrder) || out.answerOrder.length === 0) {
    throw new Error(`${out.id || "(unknown id)"}: missing answerOrder`);
  }
  if (!Number.isInteger(out.givenIndex) || out.givenIndex < 0 || out.givenIndex > out.answerOrder.length) {
    throw new Error(`${out.id || "(unknown id)"}: invalid givenIndex`);
  }

  const safeBank = shuffleBankSafely(out.answerOrder.map(normalizeChunk), shuffleRetries);
  if (!safeBank) {
    throw new Error(
      `${out.id || "(unknown id)"}: cannot build non-leaky bank order after ${shuffleRetries} retries`
    );
  }
  out.bank = safeBank;
  delete out.correctChunks;
  return out;
}

function normalizeItemsForSave(items, opts = {}) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => normalizeItem(item, opts));
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
  const { input, allowWarnings, shuffleRetries } = parseArgs(process.argv.slice(2));
  const rawItems = readInput(input);
  let items;
  try {
    items = normalizeItemsForSave(rawItems, { shuffleRetries });
  } catch (e) {
    console.error(`Input transform failed: ${e.message}`);
    process.exit(1);
  }

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
  console.log(path.join("data", "questionBank", "v2", "build_sentence", "easy.json"));
  console.log(path.join("data", "questionBank", "v2", "build_sentence", "medium.json"));
  console.log(path.join("data", "questionBank", "v2", "build_sentence", "hard.json"));
}

if (require.main === module) {
  main();
}

module.exports = {
  collectHardFails,
  collectWarnings,
  evaluateForSave,
  normalizeItemsForSave,
  isLeakyOrder,
};
